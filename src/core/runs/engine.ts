import { estimateReferenceCost } from '@/core/ai/models'
import { db, TABLE_NAMES, type TableName } from '@/core/db'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { evaluatePermission } from '@/core/permissions/evaluate'
import { logActivity } from '@/core/services/activity'
import { link } from '@/core/services/links'
import { notify } from '@/core/services/notifications'
import { getSettings } from '@/core/settings'
import {
  ME,
  type ActorRef, type Approval, type ApprovalPreview, type Capability, type EntityRef, type FileChange, type ID, type RiskLevel,
  type Run, type RunScriptState, type RunStep, type StepKind, type StepStatus, type Usage,
} from '@/core/types'
import { truncate } from '@/lib/format'
import { newId } from '@/lib/id'
import { createRng, hashString, type Rng } from '@/lib/rng'
import { getRunFactory, registerRunFactory } from './registry'
import {
  __resetRunServiceForTests, addRunOutput, addUsage, appendStep, cancelRun, completeRun, createRun, failRun, isRunTerminal,
  isSessionRun, patchRun, updateStep,
} from './service'
import type { RunEngine, RunFactory, RunPlan, StartRunInput, StepContext, StepPlan } from './types'

/**
 * The simulation run engine.
 *
 * A run's script is re-plannable: `factory(params, createRng(seed))` always yields the same
 * plan, and `run.script.cursor` records how far it got. The database row is the source of
 * truth; this module only keeps timers and a plan cache in memory, so any run survives a
 * reload (`resumeInterrupted`) and approvals can be resolved in a later session.
 *
 * Step lifecycle: a RunStep is appended when the engine reaches it (never upfront). The
 * last step of a run is its "in-flight" step while it is pending/running/waiting.
 */

export const DEFAULT_SIM_MODEL_ID = 'sim-deep'
export const INTERRUPTED_REASON = 'Interrupted: simulation script unavailable'
export const RELOAD_INTERRUPTED_REASON = 'Interrupted: the page was reloaded before this run finished'
export const REJECTED_REASON = 'Rejected by you'

type Timer = ReturnType<typeof setTimeout>

interface Execution {
  readonly runId: ID
  readonly plan: RunPlan
  readonly seed: number
  /** Factory + seed of the script this execution was planned from. */
  readonly scriptKey: string
  readonly timers: Set<Timer>
  /** The RunStep currently running under this execution (undefined between steps). */
  stepId?: ID
}

/** Runs with live timers in this page session. A run is never driven twice. */
const executions = new Map<ID, Execution>()
/** Plans cached per run; keyed by script so a replaced database re-plans. */
const plans = new Map<ID, { key: string; plan: RunPlan }>()

const IN_FLIGHT: readonly StepStatus[] = ['pending', 'running', 'waiting']

const runRef = (id: ID): EntityRef => ({ kind: 'run', id })
const quoted = (title: string) => `“${truncate(title, 90)}”`
const scriptKeyOf = (script: RunScriptState) => `${script.factory}#${script.seed}`
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)) || 'Step failed'

function randomSeed(): number {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]
}

/** Deterministic rng for one purpose of one step (index -1 = the run as a whole). */
function derivedRng(seed: number, index: number, purpose: string): Rng {
  return createRng(hashString(`${seed}:${index}:${purpose}`))
}

/** Who asks for approval: the run's agent, its workflow, or the system. */
function requester(run: Run): ActorRef {
  if (run.agentId) return { type: 'agent', id: run.agentId }
  if (run.workflowId) return { type: 'workflow', id: run.workflowId }
  return { type: 'system', id: 'system' }
}

/** Simulated tokens are split 70% input / 30% output and costed at reference pricing (an estimate). */
export function splitTokens(tokens: number): Usage {
  const inputTokens = Math.round(tokens * 0.7)
  const outputTokens = tokens - inputTokens
  return { inputTokens, outputTokens, costUsd: estimateReferenceCost(inputTokens, outputTokens) }
}

/**
 * How a step's output is revealed: between 4 and 12 increments (at most one per line),
 * evenly spread over the step. `at` is the fraction of the duration, `lines` how many
 * lines are visible after that increment. The last increment lands at completion.
 */
export function revealSchedule(lineCount: number, rng: Rng): Array<{ at: number; lines: number }> {
  if (lineCount <= 0) return []
  const n = Math.min(lineCount, rng.int(4, 12))
  return Array.from({ length: n }, (_, i) => ({ at: (i + 1) / n, lines: Math.round(((i + 1) * lineCount) / n) }))
}

function stepDurationMs(plan: StepPlan): number {
  const speed = getSettings().simulation?.speed
  const factor = Math.max(0.25, typeof speed === 'number' && speed > 0 ? speed : 1)
  return Math.max(0, Number.isFinite(plan.durationMs) ? plan.durationMs : 0) / factor
}

function inFlightStep(run: Run): RunStep | undefined {
  const last = run.steps[run.steps.length - 1]
  return last && IN_FLIGHT.includes(last.status) ? last : undefined
}

function stepFromPlan(sp: StepPlan): Omit<RunStep, 'id'> {
  return {
    kind: sp.kind,
    title: sp.title,
    status: 'pending',
    ...(sp.detail !== undefined && { detail: sp.detail }),
    ...(sp.tool !== undefined && { tool: sp.tool }),
    ...(sp.capability !== undefined && { capability: sp.capability }),
    ...(sp.integrationId !== undefined && { integrationId: sp.integrationId }),
    ...(sp.input !== undefined && { input: sp.input }),
    ...(sp.refs !== undefined && { refs: sp.refs }),
    ...(sp.fileChanges !== undefined && { fileChanges: sp.fileChanges }),
    ...(sp.nodeId !== undefined && { nodeId: sp.nodeId }),
  }
}

// ------------------------------------------------------------------ plans & timers

function planFor(run: Run): RunPlan | undefined {
  const script = run.script
  if (!script) return undefined
  const key = scriptKeyOf(script)
  const cached = plans.get(run.id)
  if (cached?.key === key) return cached.plan
  const factory = getRunFactory(script.factory)
  if (!factory) return undefined
  try {
    const plan = factory(script.params, createRng(script.seed))
    plans.set(run.id, { key, plan })
    if (run.plannedSteps !== plan.steps.length) db.update('runs', run.id, { plannedSteps: plan.steps.length })
    return plan
  } catch (error) {
    console.error(`[runs] could not re-plan ${run.id} with "${script.factory}"`, error)
    return undefined
  }
}

const isCurrent = (exec: Execution) => executions.get(exec.runId) === exec

function schedule(exec: Execution, delayMs: number, fn: () => void): void {
  if (!isCurrent(exec)) return
  const timer = setTimeout(() => {
    exec.timers.delete(timer)
    if (isCurrent(exec)) fn()
  }, Math.max(0, delayMs))
  exec.timers.add(timer)
}

/** Stop driving a run in this session (clears its timers; the DB row is untouched). */
function release(runId: ID): void {
  const exec = executions.get(runId)
  if (!exec) return
  for (const timer of exec.timers) clearTimeout(timer)
  exec.timers.clear()
  executions.delete(runId)
}

function setCursor(runId: ID, cursor: number, total: number, patch?: Partial<Run>): void {
  db.update('runs', runId, (run) =>
    run.script
      ? { ...run, ...patch, script: { ...run.script, cursor }, progress: total > 0 ? Math.min(1, cursor / total) : 1 }
      : run,
  )
}

function context(runId: ID, rng: Rng): Omit<StepContext, 'step'> {
  const snapshot = db.get('runs', runId)
  return {
    get run(): Run {
      return db.get('runs', runId) ?? (snapshot as Run)
    },
    rng,
    addOutput: (ref) => addRunOutput(runId, ref),
    patchRun: (patch) => {
      patchRun(runId, patch)
    },
  }
}

function runFailureHook(plan: RunPlan | undefined, runId: ID, seed: number, reason: string): void {
  if (!plan?.onFailure) return
  try {
    plan.onFailure(Object.assign(context(runId, derivedRng(seed, -1, 'failure')), { reason }))
  } catch (error) {
    console.error(`[runs] onFailure of ${runId} threw`, error)
  }
}

// ------------------------------------------------------------------ execution

/** Begin (or continue) driving a running/queued scripted run at its cursor. Idempotent. */
function drive(runId: ID): void {
  if (executions.has(runId)) return
  const run = db.get('runs', runId)
  if (!run?.script || (run.status !== 'running' && run.status !== 'queued')) return
  const plan = planFor(run)
  if (!plan) {
    failRun(runId, INTERRUPTED_REASON)
    return
  }
  const exec: Execution = { runId, plan, seed: run.script.seed, scriptKey: scriptKeyOf(run.script), timers: new Set() }
  executions.set(runId, exec)
  if (run.status === 'queued') patchRun(runId, { status: 'running', startedAt: run.startedAt ?? Date.now() })
  schedule(exec, 0, () => advance(exec))
}

/** Execute the plan step at the run's cursor (reusing its in-flight RunStep after a pause/reload). */
function advance(exec: Execution): void {
  const run = db.get('runs', exec.runId)
  if (!run?.script || run.status !== 'running') {
    release(exec.runId)
    return
  }
  const index = run.script.cursor
  if (index >= exec.plan.steps.length) {
    succeed(exec)
    return
  }
  const sp = exec.plan.steps[index]
  const step = inFlightStep(run) ?? appendStep(run.id, stepFromPlan(sp))

  if (step.approvalId) {
    const approval = db.get('approvals', step.approvalId)
    if (approval?.status === 'approved') return runStep(exec, index, step.id)
    if (approval?.status === 'pending') return awaitApproval(run, step.id)
    if (approval?.status === 'rejected') return applyRejection(run, exec.plan, index, step.id)
    // expired or missing: evaluate again below
  }
  if (sp.approval) {
    const capability = sp.capability ?? 'shell.execute'
    const sessionAutonomy = run.origin?.kind === 'session' ? db.get('sessions', run.origin.id)?.autonomy : undefined
    const decision = evaluatePermission({
      capability,
      risk: sp.approval.risk,
      agentId: run.agentId,
      integrationId: sp.integrationId,
      autonomy: sessionAutonomy,
    })
    if (decision.outcome === 'ask') return requestApproval(run, step.id, sp, decision.reason)
    if (decision.outcome === 'deny') return denyStep(exec, run, index, step.id, decision.reason)
  }
  runStep(exec, index, step.id)
}

function runStep(exec: Execution, index: number, stepId: ID): void {
  const sp = exec.plan.steps[index]
  const duration = stepDurationMs(sp)
  updateStep(exec.runId, stepId, {
    status: 'running',
    startedAt: Date.now(),
    endedAt: undefined,
    error: undefined,
    ...(sp.output !== undefined && { output: '' }),
  })
  exec.stepId = stepId

  const lines = sp.output ? sp.output.split('\n') : []
  const increments = revealSchedule(lines.length, derivedRng(exec.seed, index, 'reveal'))
  // The final increment coincides with completion, which writes the full output.
  for (const inc of increments.slice(0, -1)) {
    schedule(exec, duration * inc.at, () => updateStep(exec.runId, stepId, { output: lines.slice(0, inc.lines).join('\n') }))
  }
  schedule(exec, duration, () => finishStep(exec, index, stepId))
}

function finishStep(exec: Execution, index: number, stepId: ID): void {
  const { runId } = exec
  const run = db.get('runs', runId)
  if (!run || run.status !== 'running') {
    release(runId)
    return
  }
  const sp = exec.plan.steps[index]
  const now = Date.now()
  const tokens = Math.max(0, Math.round(sp.tokens ?? 0))
  const failed = !!sp.failChance && derivedRng(exec.seed, index, 'fail').chance(sp.failChance)
  exec.stepId = undefined

  if (tokens) addUsage(runId, splitTokens(tokens))
  if (sp.integrationId) {
    db.update('connections', sp.integrationId, (c) => ({ ...c, usageCount: (c.usageCount ?? 0) + 1, lastUsedAt: now }))
  }
  const final: Partial<RunStep> = {
    endedAt: now,
    ...(sp.output !== undefined && { output: sp.output }),
    ...(tokens > 0 && { tokens }),
  }

  if (failed) {
    const error = sp.failMessage ?? 'Step failed'
    updateStep(runId, stepId, { ...final, status: 'failed', error })
    failExecution(exec, error)
    return
  }

  updateStep(runId, stepId, { ...final, status: 'done' })
  if (sp.onComplete) {
    try {
      const step = db.get('runs', runId)?.steps.find((s) => s.id === stepId)
      if (step) sp.onComplete(Object.assign(context(runId, derivedRng(exec.seed, index, 'complete')), { step }))
    } catch (error) {
      const message = errorMessage(error)
      updateStep(runId, stepId, { status: 'failed', error: message })
      failExecution(exec, message)
      return
    }
  }
  // onComplete may have paused or cancelled the run.
  if (!isCurrent(exec)) return
  setCursor(runId, index + 1, exec.plan.steps.length)
  // Chaining synchronously is safe: every step's completion is itself timer-driven.
  advance(exec)
}

function succeed(exec: Execution): void {
  const { runId, plan, seed } = exec
  release(runId)
  completeRun(runId, plan.summary !== undefined ? { summary: plan.summary } : undefined)
  if (plan.onSuccess) {
    try {
      plan.onSuccess(context(runId, derivedRng(seed, -1, 'success')))
    } catch (error) {
      console.error(`[runs] onSuccess of ${runId} threw`, error)
    }
  }
  plans.delete(runId)
}

function failExecution(exec: Execution, reason: string): void {
  release(exec.runId)
  failRun(exec.runId, reason)
  runFailureHook(exec.plan, exec.runId, exec.seed, reason)
  plans.delete(exec.runId)
}

// ------------------------------------------------------------------ approvals

function requestApproval(run: Run, stepId: ID, sp: StepPlan, reason: string): void {
  const gate = sp.approval
  if (!gate) return
  const approval: Approval = {
    id: newId('apv'),
    runId: run.id,
    stepId,
    title: gate.title,
    capability: sp.capability ?? 'shell.execute',
    risk: gate.risk,
    requestedBy: requester(run),
    status: 'pending',
    reason,
    createdAt: Date.now(),
    ...(gate.description !== undefined && { description: gate.description }),
    ...(gate.preview !== undefined && { preview: gate.preview }),
  }
  db.insert('approvals', approval)
  updateStep(run.id, stepId, { status: 'waiting', approvalId: approval.id })
  patchRun(run.id, { status: 'waiting' })
  release(run.id)
  logActivity({
    actor: approval.requestedBy,
    verb: 'requested',
    target: { kind: 'approval', id: approval.id },
    summary: `Requested approval: ${quoted(approval.title)}`,
    projectId: run.projectId,
    meta: { runId: run.id, capability: approval.capability, risk: approval.risk },
  })
  if (getSettings().notifications.approvals) {
    notify({
      kind: 'approval.requested',
      title: `Approval needed: ${approval.title}`,
      body: reason,
      ref: { kind: 'approval', id: approval.id },
      tone: 'warning',
    })
  }
}

/** The in-flight step already has a pending approval: make sure the run shows as waiting. */
function awaitApproval(run: Run, stepId: ID): void {
  updateStep(run.id, stepId, { status: 'waiting' })
  if (run.status !== 'waiting') patchRun(run.id, { status: 'waiting' })
  release(run.id)
}

function denyStep(exec: Execution, run: Run, index: number, stepId: ID, reason: string): void {
  const now = Date.now()
  const sp = exec.plan.steps[index]
  updateStep(run.id, stepId, { status: 'failed', error: reason, endedAt: now })
  logActivity({
    actor: requester(run),
    verb: 'blocked',
    target: runRef(run.id),
    summary: `Blocked ${quoted(sp.title)}: ${reason}`,
    projectId: run.projectId,
    meta: { capability: sp.capability ?? 'shell.execute' },
  })
  if (sp.approval?.onReject === 'skip') {
    setCursor(run.id, index + 1, exec.plan.steps.length)
    advance(exec)
  } else {
    failExecution(exec, reason)
  }
}

/** A rejected step is skipped; the run continues when the plan allows skipping, otherwise it is cancelled. */
function applyRejection(run: Run, plan: RunPlan | undefined, index: number, stepId: ID): void {
  updateStep(run.id, stepId, { status: 'skipped', endedAt: Date.now() })
  const canSkip = plan?.steps[index]?.approval?.onReject === 'skip'
  if (canSkip && plan && run.script) {
    release(run.id)
    setCursor(run.id, index + 1, plan.steps.length, { status: 'running' })
    drive(run.id)
    return
  }
  release(run.id)
  cancelRun(run.id, REJECTED_REASON)
  runFailureHook(plan, run.id, run.script?.seed ?? 0, REJECTED_REASON)
  plans.delete(run.id)
}

// ------------------------------------------------------------------ public API

function start(input: StartRunInput): Run {
  const factory = getRunFactory(input.factory)
  if (!factory) throw new Error(`Unknown run factory "${input.factory}"`)
  // Stored params must be plain JSON so the run can be re-planned after a reload.
  const params = JSON.parse(JSON.stringify(input.params ?? {})) as Record<string, unknown>
  const seed = randomSeed()
  const plan = factory(params, createRng(seed))
  const script: RunScriptState = { factory: input.factory, params, seed, cursor: 0 }
  const run = createRun({
    kind: input.kind,
    title: input.title,
    projectId: input.projectId ?? null,
    agentId: input.agentId,
    workflowId: input.workflowId,
    parentRunId: input.parentRunId,
    origin: input.origin,
    initiator: input.initiator,
    modelId: input.modelId ?? DEFAULT_SIM_MODEL_ID,
    simulated: true,
    script,
  })
  plans.set(run.id, { key: scriptKeyOf(script), plan })
  const planned = db.update('runs', run.id, { plannedSteps: plan.steps.length }) ?? run
  drive(run.id)
  return planned
}

function cancel(runId: ID, reason?: string): void {
  release(runId)
  const run = db.get('runs', runId)
  if (!run || isRunTerminal(run.status)) return
  const plan = planFor(run)
  // cancelRun skips the in-flight step and expires the run's pending approvals.
  cancelRun(runId, reason)
  runFailureHook(plan, runId, run.script?.seed ?? 0, reason ?? 'Cancelled')
  plans.delete(runId)
}

function pause(runId: ID): void {
  const run = db.get('runs', runId)
  if (!run?.script || (run.status !== 'running' && run.status !== 'queued')) return
  release(runId)
  const step = inFlightStep(run)
  if (step?.status === 'running') updateStep(runId, step.id, { status: 'pending' })
  patchRun(runId, { status: 'paused' })
  logActivity({ actor: ME, verb: 'paused', target: runRef(runId), summary: `Paused ${quoted(run.title)}`, projectId: run.projectId })
}

function resume(runId: ID): void {
  const run = db.get('runs', runId)
  // Only scripted runs are paused by the engine; anything else has no driver to resume.
  if (!run?.script || run.status !== 'paused') return
  patchRun(runId, { status: 'running' })
  logActivity({ actor: ME, verb: 'resumed', target: runRef(runId), summary: `Resumed ${quoted(run.title)}`, projectId: run.projectId })
  drive(runId)
}

function retry(runId: ID): Run | undefined {
  const run = db.get('runs', runId)
  if (!run?.script || !getRunFactory(run.script.factory)) return undefined
  let next: Run
  try {
    next = start({
      kind: run.kind,
      title: run.title,
      factory: run.script.factory,
      params: run.script.params,
      projectId: run.projectId,
      agentId: run.agentId,
      workflowId: run.workflowId,
      parentRunId: run.parentRunId,
      origin: run.origin,
      modelId: run.modelId,
    })
  } catch (error) {
    console.error(`[runs] could not retry ${runId}`, error)
    return undefined
  }
  link(runRef(next.id), runRef(run.id), 'related')
  return next
}

function resolveApproval(approvalId: ID, decision: 'approved' | 'rejected', note?: string): void {
  const approval = db.get('approvals', approvalId)
  if (!approval || approval.status !== 'pending') return
  db.update('approvals', approvalId, {
    status: decision,
    resolvedAt: Date.now(),
    resolution: note ? { by: ME, note } : { by: ME },
  })
  const run = db.get('runs', approval.runId)
  logActivity({
    actor: ME,
    verb: decision,
    target: { kind: 'approval', id: approvalId },
    summary: `${decision === 'approved' ? 'Approved' : 'Rejected'} ${quoted(approval.title)}`,
    projectId: run?.projectId ?? null,
    meta: { runId: approval.runId, ...(note ? { note } : {}) },
  })
  if (!run || isRunTerminal(run.status)) return

  if (decision === 'approved') {
    // The waiting step now executes normally (re-planned from factory + params + seed if needed).
    if (run.status === 'waiting') patchRun(run.id, { status: 'running' })
    drive(run.id)
    return
  }
  applyRejection(run, planFor(run), run.script?.cursor ?? -1, approval.stepId)
}

function resumeInterrupted(): void {
  for (const run of db.all('runs')) {
    if (run.status !== 'running' && run.status !== 'queued') continue
    if (!run.script) {
      // Unscripted runs (chat turns) are driven by code that did not survive the reload.
      if (!isSessionRun(run.id)) failRun(run.id, RELOAD_INTERRUPTED_REASON)
      continue
    }
    const exec = executions.get(run.id)
    if (exec) {
      const inFlight = inFlightStep(run)
      const stale = exec.scriptKey !== scriptKeyOf(run.script) || (exec.stepId !== undefined && exec.stepId !== inFlight?.id)
      if (!stale) continue
      release(run.id)
    }
    drive(run.id)
  }
}

export const runEngine: RunEngine = { start, cancel, pause, resume, retry, resolveApproval, resumeInterrupted }

/** True while this session is actively driving the run (timers scheduled). */
export function isRunDriven(runId: ID): boolean {
  return executions.has(runId)
}

/** Test-only: drop all in-memory engine state (timers, plans), as a page reload would. */
export function __resetEngineForTests(): void {
  for (const id of [...executions.keys()]) release(id)
  plans.clear()
  __resetRunServiceForTests()
}

// ------------------------------------------------------------------ 'scripted' factory

/** A JSON-only step for the generic 'scripted' factory (no callbacks). */
export type ScriptedStep = Omit<StepPlan, 'onComplete'>

export interface ScriptedPatch {
  table: TableName
  id: ID
  /** Shallow patch. The string "$now" is replaced by the completion time; `updatedAt` is bumped when the row has one. */
  patch: Record<string, unknown>
}

/** Params of the 'scripted' factory: a declarative script used by seed data. */
export interface ScriptedRunParams {
  steps: ScriptedStep[]
  summary?: string
  outputs?: EntityRef[]
  onSuccessPatches?: ScriptedPatch[]
}

export const SCRIPTED_NOW = '$now'

const STEP_KINDS: Record<StepKind, true> = {
  plan: true, think: true, search: true, read: true, browse: true, write: true, edit: true, command: true, test: true,
  tool: true, message: true, approval: true, artifact: true, handoff: true, wait: true, generate: true,
}
const RISKS: Record<RiskLevel, true> = { low: true, medium: true, high: true }
const PREVIEW_KINDS: Record<ApprovalPreview['kind'], true> = { command: true, diff: true, message: true, text: true }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const optString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const optNumber = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const isEntityRef = (v: unknown): v is EntityRef => isRecord(v) && typeof v.kind === 'string' && typeof v.id === 'string'

function parseApprovalGate(raw: unknown, where: string): StepPlan['approval'] {
  if (raw === undefined) return undefined
  if (!isRecord(raw) || typeof raw.title !== 'string' || typeof raw.risk !== 'string' || !(raw.risk in RISKS)) {
    throw new Error(`${where}: approval needs a title and a risk of low, medium or high`)
  }
  const preview = isRecord(raw.preview) && typeof raw.preview.kind === 'string' && raw.preview.kind in PREVIEW_KINDS && typeof raw.preview.content === 'string'
    ? {
        kind: raw.preview.kind as ApprovalPreview['kind'],
        content: raw.preview.content,
        ...(typeof raw.preview.label === 'string' && { label: raw.preview.label }),
      }
    : undefined
  return {
    title: raw.title,
    risk: raw.risk as RiskLevel,
    ...(typeof raw.description === 'string' && { description: raw.description }),
    ...(preview && { preview }),
    ...((raw.onReject === 'skip' || raw.onReject === 'stop') && { onReject: raw.onReject }),
  }
}

function parseScriptedStep(raw: unknown, index: number): ScriptedStep {
  const where = `scripted step ${index}`
  if (!isRecord(raw)) throw new Error(`${where} must be an object`)
  if (typeof raw.kind !== 'string' || !(raw.kind in STEP_KINDS)) throw new Error(`${where} has an unknown kind "${String(raw.kind)}"`)
  if (typeof raw.title !== 'string' || !raw.title) throw new Error(`${where} needs a title`)
  if (raw.capability !== undefined && !(typeof raw.capability === 'string' && raw.capability in CAPABILITIES)) {
    throw new Error(`${where} has an unknown capability "${String(raw.capability)}"`)
  }
  const failChance = optNumber(raw.failChance)
  const tokens = optNumber(raw.tokens)
  const step: ScriptedStep = {
    kind: raw.kind as StepKind,
    title: raw.title,
    durationMs: Math.max(0, optNumber(raw.durationMs) ?? 1000),
    ...(optString(raw.detail) !== undefined && { detail: optString(raw.detail) }),
    ...(optString(raw.tool) !== undefined && { tool: optString(raw.tool) }),
    ...(raw.capability !== undefined && { capability: raw.capability as Capability }),
    ...(optString(raw.integrationId) !== undefined && { integrationId: optString(raw.integrationId) }),
    ...(optString(raw.input) !== undefined && { input: optString(raw.input) }),
    ...(optString(raw.output) !== undefined && { output: optString(raw.output) }),
    ...(optString(raw.nodeId) !== undefined && { nodeId: optString(raw.nodeId) }),
    ...(optString(raw.failMessage) !== undefined && { failMessage: optString(raw.failMessage) }),
    ...(tokens !== undefined && { tokens: Math.max(0, tokens) }),
    ...(failChance !== undefined && { failChance: Math.min(1, Math.max(0, failChance)) }),
    ...(Array.isArray(raw.refs) && { refs: raw.refs.filter(isEntityRef) }),
    ...(Array.isArray(raw.fileChanges) && {
      fileChanges: raw.fileChanges.filter((c): c is FileChange => isRecord(c) && typeof c.path === 'string'),
    }),
  }
  const approval = parseApprovalGate(raw.approval, where)
  if (approval) step.approval = approval
  return step
}

/** Validate untrusted JSON params for the 'scripted' factory. Throws with a precise message when malformed. */
export function parseScriptedParams(params: Record<string, unknown>): ScriptedRunParams {
  if (!Array.isArray(params.steps)) throw new Error('scripted: params.steps must be an array')
  const patches = params.onSuccessPatches
  if (patches !== undefined && !Array.isArray(patches)) throw new Error('scripted: onSuccessPatches must be an array')
  return {
    steps: params.steps.map(parseScriptedStep),
    ...(typeof params.summary === 'string' && { summary: params.summary }),
    ...(Array.isArray(params.outputs) && { outputs: params.outputs.filter(isEntityRef) }),
    ...(patches && {
      onSuccessPatches: patches.map((p, i): ScriptedPatch => {
        if (!isRecord(p) || typeof p.table !== 'string' || !TABLE_NAMES.includes(p.table as TableName) || typeof p.id !== 'string' || !isRecord(p.patch)) {
          throw new Error(`scripted: onSuccessPatches[${i}] needs a known table, an id and a patch object`)
        }
        return { table: p.table as TableName, id: p.id, patch: p.patch }
      }),
    }),
  }
}

function applyScriptedPatch({ table, id, patch }: ScriptedPatch, now: number): void {
  db.update(table, id, (row) => {
    const next: Record<string, unknown> = { ...row }
    for (const [key, value] of Object.entries(patch)) next[key] = value === SCRIPTED_NOW ? now : value
    if ('updatedAt' in row && !('updatedAt' in patch)) next.updatedAt = now
    return next as unknown as typeof row
  })
}

/** Generic declarative script: steps come from JSON params; success applies patches and records outputs. */
export const scriptedFactory: RunFactory = (params) => {
  const script = parseScriptedParams(params)
  return {
    steps: script.steps,
    ...(script.summary !== undefined && { summary: script.summary }),
    onSuccess: (ctx) => {
      const now = Date.now()
      for (const patch of script.onSuccessPatches ?? []) applyScriptedPatch(patch, now)
      for (const ref of script.outputs ?? []) ctx.addOutput(ref)
    },
  }
}

registerRunFactory('scripted', scriptedFactory)
