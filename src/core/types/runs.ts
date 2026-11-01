import type { ActorRef, EntityRef, ID, RiskLevel, Timestamp, Usage } from './common'
import type { Capability } from './permissions'

/**
 * Every AI execution is a Run: a chat turn, coding session turn, agent task,
 * research investigation, workflow execution or creative generation.
 * One shape, one timeline component, one approvals model, one analytics source.
 */
export type RunKind = 'chat' | 'code' | 'agent' | 'research' | 'workflow' | 'studio'

export type RunStatus =
  | 'queued'
  | 'running'
  /** Paused on a pending approval. */
  | 'waiting'
  /** Paused by the user. */
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running', 'waiting', 'paused']
export const isRunActive = (s: RunStatus) => ACTIVE_RUN_STATUSES.includes(s)

export type StepKind =
  | 'plan'
  | 'think'
  | 'search'
  | 'read'
  | 'browse'
  | 'write'
  | 'edit'
  | 'command'
  | 'test'
  | 'tool'
  | 'message'
  | 'approval'
  | 'artifact'
  | 'handoff'
  | 'wait'
  | 'generate'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'waiting'

export interface FileChange {
  path: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  before?: string
  after?: string
  additions: number
  deletions: number
  language?: string
  /** Review state set by the human reviewer. */
  review?: 'pending' | 'accepted' | 'rejected'
}

export interface RunStep {
  id: ID
  kind: StepKind
  title: string
  detail?: string
  status: StepStatus
  startedAt?: Timestamp
  endedAt?: Timestamp
  /** Human-readable tool name, e.g. "terminal", "web.search", "github". */
  tool?: string
  capability?: Capability
  integrationId?: string
  /** e.g. the command that was run, the query that was searched. */
  input?: string
  /** e.g. terminal output, search results text, generated text. Plain text. */
  output?: string
  /** Entities read or produced by this step. */
  refs?: EntityRef[]
  fileChanges?: FileChange[]
  approvalId?: ID
  tokens?: number
  error?: string
  /** Workflow node this step executed (workflow runs only), for live canvas highlighting. */
  nodeId?: string
}

/** Persisted pointer into a simulator script so runs survive reloads. */
export interface RunScriptState {
  factory: string
  params: Record<string, unknown>
  seed: number
  cursor: number
}

export interface Run {
  id: ID
  kind: RunKind
  title: string
  status: RunStatus
  projectId: ID | null
  agentId?: ID
  workflowId?: ID
  parentRunId?: ID
  /** What started it: a message, task, workflow trigger, investigation… */
  origin?: EntityRef
  initiator: ActorRef
  steps: RunStep[]
  /** Entities produced by this run (reports, tasks, files, assets…). */
  outputs: EntityRef[]
  modelId?: string
  /** True when executed by the local simulation engine instead of a real model/tool. */
  simulated: boolean
  usage: Usage
  /** 0..1 */
  progress: number
  summary?: string
  error?: string
  script?: RunScriptState
  createdAt: Timestamp
  startedAt?: Timestamp
  endedAt?: Timestamp
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalPreview {
  kind: 'command' | 'diff' | 'message' | 'text'
  content: string
  /** e.g. destination channel, file path. */
  label?: string
}

export interface Approval {
  id: ID
  runId: ID
  stepId: ID
  title: string
  description?: string
  capability: Capability
  risk: RiskLevel
  requestedBy: ActorRef
  status: ApprovalStatus
  /** Why the permission policy asked for approval, e.g. "Your safety settings require approval to run commands". */
  reason?: string
  preview?: ApprovalPreview
  createdAt: Timestamp
  resolvedAt?: Timestamp
  resolution?: { by: ActorRef; note?: string }
}
