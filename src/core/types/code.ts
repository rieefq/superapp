import type { ID, Timestamp } from './common'
import type { Autonomy } from './permissions'
import type { FileChange } from './runs'

export interface RepoFile {
  path: string
  type: 'file' | 'dir'
  size?: number
  sha?: string
}

export interface Repo {
  id: ID
  /** 'github' = read live from the GitHub REST API; 'demo' = bundled sample repository. */
  provider: 'github' | 'demo'
  owner: string
  name: string
  fullName: string
  description?: string
  defaultBranch: string
  url?: string
  language?: string
  stars?: number
  /** 'live' when files are fetched from a real service; 'simulated' for bundled demo content. */
  mode: 'live' | 'simulated'
  projectId: ID | null
  /** Cached file tree (may be truncated for very large repos). */
  tree?: RepoFile[]
  treeTruncated?: boolean
  connectedAt: Timestamp
  lastSyncedAt?: Timestamp
}

export type SessionStatus = 'idle' | 'working' | 'needs_review' | 'approved' | 'merged' | 'failed' | 'archived'

export interface CheckResult {
  id: ID
  name: string
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  durationMs?: number
  output?: string
}

export interface PullRequest {
  number: number
  title: string
  url?: string
  status: 'draft' | 'open' | 'merged' | 'closed'
  /** PRs are only real when a write-capable GitHub integration is connected. */
  simulated: boolean
}

export interface CodeTurn {
  id: ID
  /** The instruction the user gave the coding agent. */
  prompt: string
  runId?: ID
  summary?: string
  createdAt: Timestamp
}

export interface CodeSession {
  id: ID
  repoId: ID
  title: string
  projectId: ID | null
  taskId?: ID
  agentId?: ID
  branch: string
  baseBranch: string
  status: SessionStatus
  /** Approval policy for this session; overrides the agent's autonomy for its runs. */
  autonomy?: Autonomy
  turns: CodeTurn[]
  /** The current proposed change set, aggregated across turns. */
  changes: FileChange[]
  checks: CheckResult[]
  pr?: PullRequest
  createdAt: Timestamp
  updatedAt: Timestamp
}
