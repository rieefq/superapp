import { db } from '@/core/db'
import { logActivity } from '@/core/services/activity'
import { link } from '@/core/services/links'
import { notify } from '@/core/services/notifications'
import { getSettings } from '@/core/settings'
import {
  ME, ZERO_USAGE, refKey,
  type ActorRef, type EntityRef, type ID, type Run, type RunKind, type RunScriptState, type RunStatus, type RunStep, type Usage,
} from '@/core/types'
import { newId } from '@/lib/id'
import { truncate } from '@/lib/format'

/**
 * Run data operations. The run engine drives simulated runs through these; chat
 * orchestration drives live/simulated chat turns through them directly. They keep the
 * activity log, link graph and notifications consistent with every run transition.
 */
export interface CreateRunInput {
  kind: RunKind
  title: string
  projectId?: ID | null
  agentId?: ID
  workflowId?: ID
  parentRunId?: ID
  origin?: EntityRef
  initiator?: ActorRef
  modelId?: string
  simulated: boolean
  script?: RunScriptState
}

export const STEP_ID_PREFIX = 'stp'

const TERMINAL_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled']

export const isRunTerminal = (status: RunStatus): boolean => TERMINAL_STATUSES.includes(status)

/** Runs created by this page session. Anything else found 'running' at startup was interrupted by a reload. */
const sessionRunIds = new Set<ID>()

/** True when the run was created in this page session (its driver is still in memory). */
export function isSessionRun(runId: ID): boolean {
  return sessionRunIds.has(runId)
}

const runRef = (id: ID): EntityRef => ({ kind: 'run', id })

const quoted = (title: string) => `“${truncate(title, 90)}”`

/** Who executed the run: its agent, its workflow, or whoever started it. */
function executor(run: Run): ActorRef {
  if (run.agentId) return { type: 'agent', id: run.agentId }
  if (run.workflowId) return { type: 'workflow', id: run.workflowId }
  return run.initiator
}

export function createRun(input: CreateRunInput): Run {
  const now = Date.now()
  const run: Run = {
    id: newId('run'),
    kind: input.kind,
    title: input.title,
    status: 'running',
    projectId: input.projectId ?? null,
    initiator: input.initiator ?? ME,
    steps: [],
    outputs: [],
    simulated: input.simulated,
    usage: { ...ZERO_USAGE },
    progress: 0,
    createdAt: now,
    startedAt: now,
  }
  if (input.agentId) run.agentId = input.agentId
  if (input.workflowId) run.workflowId = input.workflowId
  if (input.parentRunId) run.parentRunId = input.parentRunId
  if (input.origin) run.origin = input.origin
  if (input.modelId) run.modelId = input.modelId
  if (input.script) run.script = input.script

  db.insert('runs', run)
  sessionRunIds.add(run.id)
  logActivity({
    actor: run.initiator,
    verb: 'started',
    target: runRef(run.id),
    summary: `Started ${quoted(run.title)}`,
    projectId: run.projectId,
    meta: { runKind: run.kind },
  })
  if (input.origin) link(runRef(run.id), input.origin, 'derived_from')
  return run
}

/** Shallow-merge a patch into a run (no activity). */
export function patchRun(runId: ID, patch: Partial<Run>): Run | undefined {
  return db.update('runs', runId, patch)
}

export function appendStep(runId: ID, step: Omit<RunStep, 'id'> & { id?: ID }): RunStep {
  const full: RunStep = { ...step, id: step.id ?? newId(STEP_ID_PREFIX) }
  db.update('runs', runId, (run) => ({ ...run, steps: [...run.steps, full] }))
  return full
}

export function updateStep(runId: ID, stepId: ID, patch: Partial<RunStep>): void {
  db.update('runs', runId, (run) => {
    let changed = false
    const steps = run.steps.map((s) => {
      if (s.id !== stepId) return s
      changed = true
      return { ...s, ...patch, id: s.id }
    })
    return changed ? { ...run, steps } : run
  })
}

export function addUsage(runId: ID, usage: Usage): void {
  if (!usage.inputTokens && !usage.outputTokens && !usage.costUsd) return
  db.update('runs', runId, (run) => ({
    ...run,
    usage: {
      inputTokens: run.usage.inputTokens + usage.inputTokens,
      outputTokens: run.usage.outputTokens + usage.outputTokens,
      costUsd: run.usage.costUsd + usage.costUsd,
    },
  }))
}

/** Record an entity produced by a run: appends to run.outputs (deduplicated) and links run —produced→ ref. */
export function addRunOutput(runId: ID, ref: EntityRef): void {
  const run = db.get('runs', runId)
  if (!run) return
  if (!run.outputs.some((o) => refKey(o) === refKey(ref))) {
    db.update('runs', runId, (r) => ({ ...r, outputs: [...r.outputs, ref] }))
  }
  link(runRef(runId), ref, 'produced')
}

type Outcome = 'succeeded' | 'failed' | 'cancelled'

/** A finished run has no in-flight steps: running steps end with the run, queued/waiting ones are skipped. */
function settleSteps(steps: RunStep[], outcome: Outcome, now: number, error?: string): RunStep[] {
  let changed = false
  const next = steps.map((s) => {
    if (s.status === 'running') {
      changed = true
      if (outcome === 'succeeded') return { ...s, status: 'done' as const, endedAt: now }
      if (outcome === 'failed') return { ...s, status: 'failed' as const, endedAt: now, error: s.error ?? error }
      return { ...s, status: 'skipped' as const, endedAt: now }
    }
    if (s.status === 'pending' || s.status === 'waiting') {
      changed = true
      return { ...s, status: 'skipped' as const, endedAt: now }
    }
    return s
  })
  return changed ? next : steps
}

/** Pending approvals of a run can no longer be acted on once it has finished. */
export function expirePendingApprovals(runId: ID): void {
  const now = Date.now()
  for (const a of db.filter('approvals', (x) => x.runId === runId && x.status === 'pending')) {
    db.update('approvals', a.id, { status: 'expired', resolvedAt: now })
  }
}

function finish(runId: ID, outcome: Outcome, patch: (run: Run, now: number) => Partial<Run>, error?: string): Run | undefined {
  const run = db.get('runs', runId)
  if (!run || isRunTerminal(run.status)) return undefined
  const now = Date.now()
  const next = db.update('runs', runId, (r) => ({
    ...r,
    ...patch(r, now),
    status: outcome,
    endedAt: now,
    steps: settleSteps(r.steps, outcome, now, error),
  }))
  expirePendingApprovals(runId)
  return next
}

export function completeRun(runId: ID, input?: { summary?: string; outputs?: EntityRef[] }): void {
  const run = finish(runId, 'succeeded', (r) => {
    const outputs = [...r.outputs]
    for (const ref of input?.outputs ?? []) if (!outputs.some((o) => refKey(o) === refKey(ref))) outputs.push(ref)
    return { progress: 1, outputs, ...(input?.summary !== undefined ? { summary: input.summary } : {}) }
  })
  if (!run) return
  for (const ref of input?.outputs ?? []) link(runRef(runId), ref, 'produced')
  logActivity({
    actor: executor(run),
    verb: 'completed',
    target: runRef(runId),
    summary: `Completed ${quoted(run.title)}`,
    projectId: run.projectId,
    meta: { runKind: run.kind },
  })
  if (run.kind !== 'chat' && getSettings().notifications.runCompleted) {
    notify({
      kind: 'run.completed',
      title: `Completed: ${run.title}`,
      body: run.summary ? truncate(run.summary, 240) : undefined,
      ref: runRef(runId),
      tone: 'success',
    })
  }
}

export function failRun(runId: ID, error: string): void {
  const run = finish(runId, 'failed', () => ({ error }), error)
  if (!run) return
  logActivity({
    actor: executor(run),
    verb: 'failed',
    target: runRef(runId),
    summary: `Failed ${quoted(run.title)}`,
    projectId: run.projectId,
    meta: { runKind: run.kind, error },
  })
  if (run.kind !== 'chat' && getSettings().notifications.runFailed) {
    notify({ kind: 'run.failed', title: `Failed: ${run.title}`, body: truncate(error, 240), ref: runRef(runId), tone: 'danger' })
  }
}

export function cancelRun(runId: ID, reason?: string): void {
  const run = finish(runId, 'cancelled', () => (reason ? { error: reason } : {}))
  if (!run) return
  logActivity({
    actor: ME,
    verb: 'cancelled',
    target: runRef(runId),
    summary: `Cancelled ${quoted(run.title)}`,
    projectId: run.projectId,
    meta: reason ? { runKind: run.kind, reason } : { runKind: run.kind },
  })
}

/** Test-only: forget which runs were created in this page session (simulates a reload). */
export function __resetRunServiceForTests(): void {
  sessionRunIds.clear()
}
