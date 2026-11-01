import type {
  ActorRef, ApprovalPreview, Capability, EntityRef, FileChange, ID, RiskLevel, Run, RunKind, RunStep, StepKind,
} from '@/core/types'
import type { Rng } from '@/lib/rng'

/**
 * A step in a simulated run's script. Scripts are produced by named factories from
 * serializable params + a seed, so a run can be re-planned identically after a reload
 * and resumed at `run.script.cursor`.
 */
export interface StepPlan {
  kind: StepKind
  title: string
  detail?: string
  /** Simulated duration at speed 1 (divided by settings.simulation.speed). */
  durationMs: number
  tool?: string
  capability?: Capability
  integrationId?: string
  input?: string
  /** Revealed progressively (line by line) while the step runs. */
  output?: string
  refs?: EntityRef[]
  fileChanges?: FileChange[]
  /** Simulated tokens consumed by this step (input+output split is estimated 70/30). */
  tokens?: number
  /**
   * Gate this step behind the permission service. If the decision is 'ask', the run
   * pauses with an Approval; 'deny' fails/skips the step.
   */
  approval?: {
    title: string
    description?: string
    risk: RiskLevel
    preview?: ApprovalPreview
    /** What happens if the human rejects: stop the run (default) or skip this step. */
    onReject?: 'stop' | 'skip'
  }
  /** Seeded probability that this step fails. */
  failChance?: number
  failMessage?: string
  /** Side effects once the step completes. Must be idempotent (may re-run after reload). */
  onComplete?: (ctx: StepContext) => void
}

export interface StepContext {
  run: Run
  step: RunStep
  rng: Rng
  /** Record an entity produced by the run (appends to run.outputs and links run —produced→ ref). */
  addOutput(ref: EntityRef): void
  patchRun(patch: Partial<Run>): void
}

export interface RunPlan {
  steps: StepPlan[]
  /** Summary written to run.summary on success. */
  summary?: string
  /** Called once when the run succeeds (after the last step). Must be idempotent. */
  onSuccess?: (ctx: Omit<StepContext, 'step'>) => void
  /** Called once when the run fails or is cancelled. */
  onFailure?: (ctx: Omit<StepContext, 'step'> & { reason: string }) => void
}

export type RunFactory = (params: Record<string, unknown>, rng: Rng) => RunPlan

export interface StartRunInput {
  kind: RunKind
  title: string
  /** Registered factory name, e.g. "research.investigate". */
  factory: string
  params?: Record<string, unknown>
  projectId?: ID | null
  agentId?: ID
  workflowId?: ID
  parentRunId?: ID
  origin?: EntityRef
  initiator?: ActorRef
  modelId?: string
}

export interface RunEngine {
  /** Create and start a simulated run. Returns the created run (status 'queued' → 'running'). */
  start(input: StartRunInput): Run
  cancel(runId: ID, reason?: string): void
  pause(runId: ID): void
  resume(runId: ID): void
  /** Start a fresh run with the same factory/params. */
  retry(runId: ID): Run | undefined
  /** Resolve a pending approval; resumes, skips or stops the paused run accordingly. */
  resolveApproval(approvalId: ID, decision: 'approved' | 'rejected', note?: string): void
  /** Called once at startup: re-plans and continues runs that were running before a reload. */
  resumeInterrupted(): void
}
