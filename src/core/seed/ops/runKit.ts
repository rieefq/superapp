import type { StepPlan } from '@/core/runs/types'
import type {
  ActorRef, Approval, ApprovalPreview, Capability, EntityRef, FileChange, ID, RiskLevel, Run, RunKind, RunStep,
  StepKind, Usage,
} from '@/core/types'
import { createRng } from '@/lib/rng'
import { SECOND } from './time'
import { SCRIPTED_FACTORY, type ScriptedRunParams, type SeedPatch } from './types'
import { sumUsage, usageOf } from './util'

/** A human decision on a historical approval gate. */
export interface ApprovalSpec {
  title: string
  description?: string
  capability: Capability
  risk: RiskLevel
  preview?: ApprovalPreview
  requestedBy: ActorRef
  decision: 'approved' | 'rejected'
  note?: string
  /** How long the request waited for the human. */
  waitMs: number
}

export interface StepSpec {
  kind: StepKind
  title: string
  detail?: string
  tool?: string
  capability?: Capability
  integrationId?: string
  input?: string
  output?: string
  refs?: EntityRef[]
  fileChanges?: FileChange[]
  nodeId?: string
  /** Execution time, excluding any wait for approval. */
  ms: number
  tokens?: number
  /** Defaults to 'done'. A 'failed' step ends the run. */
  status?: 'done' | 'failed' | 'skipped'
  error?: string
  approval?: ApprovalSpec
}

export interface RunSpec {
  id: ID
  kind: RunKind
  title: string
  status: 'succeeded' | 'failed' | 'cancelled'
  /** createdAt; the run starts ~1 s later. */
  at: number
  projectId: ID | null
  agentId?: ID
  workflowId?: ID
  origin?: EntityRef
  initiator: ActorRef
  modelId: string
  steps: StepSpec[]
  outputs?: EntityRef[]
  summary?: string
  error?: string
}

export interface Materialized {
  run: Run
  approvals: Approval[]
}

const stepId = (runId: ID, index: number) => `stp_${runId.replace(/^run_/, '')}_${index + 1}`
const approvalId = (runId: ID) => `apv_${runId.replace(/^run_/, '')}`

function baseStep(runId: ID, index: number, s: Omit<StepSpec, 'ms' | 'status' | 'approval'>): RunStep {
  const step: RunStep = { id: stepId(runId, index), kind: s.kind, title: s.title, status: 'pending' }
  if (s.detail !== undefined) step.detail = s.detail
  if (s.tool !== undefined) step.tool = s.tool
  if (s.capability !== undefined) step.capability = s.capability
  if (s.integrationId !== undefined) step.integrationId = s.integrationId
  if (s.input !== undefined) step.input = s.input
  if (s.output !== undefined) step.output = s.output
  if (s.refs !== undefined) step.refs = s.refs
  if (s.fileChanges !== undefined) step.fileChanges = s.fileChanges
  if (s.nodeId !== undefined) step.nodeId = s.nodeId
  if (s.tokens !== undefined) step.tokens = s.tokens
  if (s.error !== undefined) step.error = s.error
  return step
}

/** Turn a historical run spec into a finished Run (plus its resolved approvals). */
export function materializeRun(spec: RunSpec): Materialized {
  const rng = createRng(spec.id)
  const approvals: Approval[] = []
  const steps: RunStep[] = []
  const startedAt = spec.at + rng.int(700, 1_800)
  let t = startedAt
  let stoppedByRejection = false

  spec.steps.forEach((s, index) => {
    const step = baseStep(spec.id, index, s)
    step.startedAt = t
    let end = t + s.ms
    if (s.approval) {
      const a = s.approval
      const id = approvalId(spec.id)
      const createdAt = t + rng.int(200, 600)
      const resolvedAt = createdAt + a.waitMs
      const approval: Approval = {
        id,
        runId: spec.id,
        stepId: step.id,
        title: a.title,
        capability: a.capability,
        risk: a.risk,
        requestedBy: a.requestedBy,
        status: a.decision,
        createdAt,
        resolvedAt,
        resolution: a.note ? { by: { type: 'user', id: 'usr_me' }, note: a.note } : { by: { type: 'user', id: 'usr_me' } },
      }
      if (a.description) approval.description = a.description
      if (a.preview) approval.preview = a.preview
      approvals.push(approval)
      step.approvalId = id
      end = a.decision === 'approved' ? resolvedAt + s.ms : resolvedAt
      if (a.decision === 'rejected') stoppedByRejection = true
    }
    step.status = s.status ?? (stoppedByRejection ? 'skipped' : 'done')
    step.endedAt = end
    steps.push(step)
    t = end + rng.int(150, 900)
  })

  const last = steps[steps.length - 1]
  const endedAt = (last?.endedAt ?? startedAt) + rng.int(200, 700)
  const consumed = steps.filter((st) => st.status === 'done' || st.status === 'failed')
  const usage: Usage = sumUsage(consumed.map((st) => usageOf(st.tokens ?? 0)))
  const doneCount = steps.filter((st) => st.status === 'done').length

  const run: Run = {
    id: spec.id,
    kind: spec.kind,
    title: spec.title,
    status: spec.status,
    projectId: spec.projectId,
    initiator: spec.initiator,
    steps,
    outputs: spec.outputs ?? [],
    modelId: spec.modelId,
    simulated: true,
    usage,
    progress: spec.status === 'succeeded' ? 1 : Math.round((doneCount / Math.max(1, steps.length)) * 100) / 100,
    createdAt: spec.at,
    startedAt,
    endedAt,
  }
  if (spec.agentId) run.agentId = spec.agentId
  if (spec.workflowId) run.workflowId = spec.workflowId
  if (spec.origin) run.origin = spec.origin
  if (spec.summary) run.summary = spec.summary
  if (spec.error) run.error = spec.error
  return { run, approvals }
}

/** An active run the engine resumes with the 'scripted' factory at `cursor`. */
export interface InflightSpec {
  id: ID
  kind: RunKind
  title: string
  projectId: ID | null
  agentId?: ID
  workflowId?: ID
  origin?: EntityRef
  initiator: ActorRef
  modelId: string
  /** The full plan, including the steps that already ran. */
  plan: StepPlan[]
  /** Steps already completed (they appear in run.steps as 'done'). */
  done: number
  /**
   * When set, the step at index `done` is paused on this pending approval and the run is
   * 'waiting'; otherwise the run is 'running' and the engine starts step `done` next.
   */
  waiting?: { approvalId: ID; capability: Capability; requestedBy: ActorRef; sinceMinutes: number }
  summary: string
  outputs?: EntityRef[]
  onSuccessPatches?: SeedPatch[]
  seed: number
}

export function materializeInflight(spec: InflightSpec, now: number): Materialized {
  const rng = createRng(spec.seed)
  const doneSteps = spec.plan.slice(0, spec.done)
  const gaps = doneSteps.map(() => rng.int(150, 600))
  const busyMs = doneSteps.reduce((n, p, i) => n + p.durationMs + (gaps[i] ?? 0), 0)
  // Running: the last finished step ended a moment ago. Waiting: paused for `sinceMinutes`.
  const pausedAt = spec.waiting ? now - spec.waiting.sinceMinutes * 60 * SECOND : now - rng.int(900, 2_400)
  const startedAt = pausedAt - busyMs
  const createdAt = startedAt - rng.int(600, 1_500)

  const steps: RunStep[] = []
  let t = startedAt
  doneSteps.forEach((p, index) => {
    const step = planToStep(spec.id, index, p)
    step.status = 'done'
    step.startedAt = t
    step.endedAt = t + p.durationMs
    steps.push(step)
    t = step.endedAt + (gaps[index] ?? 0)
  })

  const approvals: Approval[] = []
  if (spec.waiting) {
    const p = spec.plan[spec.done]
    if (!p?.approval) throw new Error(`seed: ${spec.id} waits on a step without an approval gate`)
    const step = planToStep(spec.id, spec.done, p)
    step.status = 'waiting'
    step.startedAt = pausedAt
    step.approvalId = spec.waiting.approvalId
    steps.push(step)
    const approval: Approval = {
      id: spec.waiting.approvalId,
      runId: spec.id,
      stepId: step.id,
      title: p.approval.title,
      capability: spec.waiting.capability,
      risk: p.approval.risk,
      requestedBy: spec.waiting.requestedBy,
      status: 'pending',
      createdAt: pausedAt + rng.int(150, 400),
    }
    if (p.approval.description) approval.description = p.approval.description
    if (p.approval.preview) approval.preview = p.approval.preview
    approvals.push(approval)
  }

  const params: ScriptedRunParams = { steps: spec.plan, summary: spec.summary }
  if (spec.outputs) params.outputs = spec.outputs
  if (spec.onSuccessPatches) params.onSuccessPatches = spec.onSuccessPatches

  const run: Run = {
    id: spec.id,
    kind: spec.kind,
    title: spec.title,
    status: spec.waiting ? 'waiting' : 'running',
    projectId: spec.projectId,
    initiator: spec.initiator,
    steps,
    outputs: [],
    modelId: spec.modelId,
    simulated: true,
    usage: sumUsage(doneSteps.map((p) => usageOf(p.tokens ?? 0))),
    progress: Math.round((spec.done / spec.plan.length) * 100) / 100,
    script: { factory: SCRIPTED_FACTORY, params, seed: spec.seed, cursor: spec.done },
    createdAt,
    startedAt,
  }
  if (spec.agentId) run.agentId = spec.agentId
  if (spec.workflowId) run.workflowId = spec.workflowId
  if (spec.origin) run.origin = spec.origin
  return { run, approvals }
}

function planToStep(runId: ID, index: number, p: StepPlan): RunStep {
  const step = baseStep(runId, index, {
    kind: p.kind,
    title: p.title,
    detail: p.detail,
    tool: p.tool,
    capability: p.capability,
    integrationId: p.integrationId,
    input: p.input,
    output: p.output,
    refs: p.refs,
    fileChanges: p.fileChanges,
    nodeId: p.nodeId,
    tokens: p.tokens,
  })
  return step
}
