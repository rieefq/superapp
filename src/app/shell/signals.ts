/**
 * Derived shell signals: what needs you, what is working, which rail items carry badges.
 * Pure selectors over the database (unit-tested) plus thin hooks that subscribe with
 * primitive or shallow-compared results, so streaming runs don't re-render the chrome.
 */
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { useScope } from '@/core/context'
import type { Approval, CodeSession, ID, RiskLevel, Run, RunKind, Task } from '@/core/types'
import type { WorkspaceId } from '../types'

const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

/** Pending approvals sorted by risk (high → low), then oldest first (§3.8). */
export function sortApprovals(approvals: readonly Approval[]): Approval[] {
  return [...approvals].sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || a.createdAt - b.createdAt)
}

export interface NeedsYou {
  approvals: Approval[]
  /** Code sessions waiting for your review. */
  sessions: CodeSession[]
  /** Tasks in review whose last run was by an agent (minus tasks already represented by a session). */
  tasks: Task[]
}

/** The agent behind a task's most recent run, if any. */
function lastRunByAgent(s: Tables, task: Task): boolean {
  for (let i = task.runIds.length - 1; i >= 0; i--) {
    const run = s.runs[task.runIds[i]]
    if (run) return !!run.agentId || run.initiator.type === 'agent'
  }
  return false
}

let memo: { approvals: unknown; sessions: unknown; tasks: unknown; value: NeedsYou } | null = null

/**
 * Everything that interrupts you (§3.8): approvals, sessions needing review, agent work in review.
 * Memoized on the three tables it reads from, so streaming run updates cost nothing here (a run's
 * agent never changes, and a task gains runs only through a task update).
 */
export function selectNeedsYou(s: Tables): NeedsYou {
  if (memo && memo.approvals === s.approvals && memo.sessions === s.sessions && memo.tasks === s.tasks) return memo.value
  const value = computeNeedsYou(s)
  memo = { approvals: s.approvals, sessions: s.sessions, tasks: s.tasks, value }
  return value
}

function computeNeedsYou(s: Tables): NeedsYou {
  const approvals = sortApprovals(Object.values(s.approvals).filter((a) => a.status === 'pending'))
  const sessions = Object.values(s.sessions)
    .filter((x) => x.status === 'needs_review')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const sessionTasks = new Set(sessions.map((x) => x.taskId).filter((id): id is ID => !!id))
  const tasks = Object.values(s.tasks)
    .filter((t) => t.status === 'review' && !sessionTasks.has(t.id) && lastRunByAgent(s, t))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return { approvals, sessions, tasks }
}

export function needsYouCount(n: NeedsYou): number {
  return n.approvals.length + n.sessions.length + n.tasks.length
}

/** The badge count in the top bar, tab title and phone bars. */
export function useNeedsYouCount(): number {
  return useDB((s) => needsYouCount(selectNeedsYou(s)))
}

/** The three Needs-you lists (re-renders only when one of their rows changes). */
export function useNeedsYou(): NeedsYou {
  const approvals = useDB(useShallow((s: Tables) => selectNeedsYou(s).approvals))
  const sessions = useDB(useShallow((s: Tables) => selectNeedsYou(s).sessions))
  const tasks = useDB(useShallow((s: Tables) => selectNeedsYou(s).tasks))
  return { approvals, sessions, tasks }
}

/** idle · working (a run is running) · waiting (an approval is pending; wins over working). §5.4.1 */
export type ActivityState = 'idle' | 'working' | 'waiting'

export function selectActivityState(s: Tables): ActivityState {
  for (const a of Object.values(s.approvals)) if (a.status === 'pending') return 'waiting'
  for (const r of Object.values(s.runs)) if (r.status === 'running') return 'working'
  return 'idle'
}

export function useActivityState(): ActivityState {
  return useDB(selectActivityState)
}

/** Which workspace's rail item reflects a run of this kind. */
export const RUN_KIND_WORKSPACE: Record<RunKind, WorkspaceId> = {
  chat: 'chat',
  research: 'research',
  code: 'code',
  studio: 'studio',
  agent: 'agents',
  workflow: 'workflows',
}

export interface RailBadge {
  live: boolean
  attn: boolean
}

/**
 * Rail badges (§3.3): a live dot when a run of the workspace's kind is running in scope; an attn ◆
 * when something there needs you (pending approvals by run kind, sessions in review → Code, agent
 * tasks in review → Projects).
 */
export function selectRailBadges(s: Tables, scopeProjectId: ID | null): Partial<Record<WorkspaceId, RailBadge>> {
  const out: Partial<Record<WorkspaceId, RailBadge>> = {}
  const mark = (ws: WorkspaceId, key: keyof RailBadge) => {
    const cur = out[ws] ?? { live: false, attn: false }
    cur[key] = true
    out[ws] = cur
  }
  for (const r of Object.values(s.runs)) {
    if (r.status !== 'running') continue
    if (scopeProjectId && r.projectId !== scopeProjectId) continue
    mark(RUN_KIND_WORKSPACE[r.kind], 'live')
  }
  const needs = selectNeedsYou(s)
  for (const a of needs.approvals) {
    const run: Run | undefined = s.runs[a.runId]
    if (run) mark(RUN_KIND_WORKSPACE[run.kind], 'attn')
  }
  if (needs.sessions.length) mark('code', 'attn')
  if (needs.tasks.length) mark('projects', 'attn')
  return out
}

/** Encoded as a string so the rail re-renders only when a badge actually changes. */
export function useRailBadges(): Partial<Record<WorkspaceId, RailBadge>> {
  const scope = useScope()
  const key = useDB((s) => {
    const badges = selectRailBadges(s, scope)
    return Object.entries(badges)
      .map(([ws, b]) => `${ws}:${b?.live ? 'l' : ''}${b?.attn ? 'a' : ''}`)
      .sort()
      .join(',')
  })
  const out: Partial<Record<WorkspaceId, RailBadge>> = {}
  if (!key) return out
  for (const part of key.split(',')) {
    const [ws, flags] = part.split(':')
    out[ws as WorkspaceId] = { live: flags.includes('l'), attn: flags.includes('a') }
  }
  return out
}

/** Unread notifications other than approval requests (the Updates tab). */
export function useUnreadUpdates(): number {
  return useDB((s) => {
    let n = 0
    for (const x of Object.values(s.notifications)) if (!x.readAt && x.kind !== 'approval.requested') n++
    return n
  })
}
