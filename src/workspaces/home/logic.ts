import type { Tables } from '@/core/db'
import {
  ACTIVE_RUN_STATUSES,
  type Approval, type CodeSession, type ID, type Notification, type RiskLevel, type Run, type Task,
} from '@/core/types'

/**
 * Home's rules — pure functions over a database snapshot (the sentence is derived from data,
 * never generated). Kept free of React so they are unit-tested directly.
 */

// ---------------------------------------------------------------- needs you

const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

export interface ReviewItem {
  kind: 'session' | 'task'
  id: ID
  title: string
  projectId: ID | null
  /** Who did the work under review (agent name), when known. */
  by?: string
  at: number
}

export interface NeedsYou {
  /** Pending approvals: risk high → low, then oldest first (§3.8). */
  approvals: Approval[]
  /** Sessions with needs_review, then tasks in review whose last run was an agent's (§3.8). */
  reviews: ReviewItem[]
  count: number
}

const inScope = (scope: ID | null, projectId: ID | null | undefined) => !scope || projectId === scope

/** What needs a decision from you, in scope. Mirrors the shell's Needs-you badge rule. */
export function computeNeedsYou(s: Tables, scope: ID | null): NeedsYou {
  const approvals = Object.values(s.approvals)
    .filter((a) => a.status === 'pending' && inScope(scope, s.runs[a.runId]?.projectId ?? null))
    .sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.createdAt - b.createdAt)

  const sessions: CodeSession[] = Object.values(s.sessions).filter((x) => x.status === 'needs_review' && inScope(scope, x.projectId))
  const sessionTasks = new Set(sessions.map((x) => x.taskId).filter(Boolean))
  const reviews: ReviewItem[] = sessions.map((x) => ({
    kind: 'session' as const,
    id: x.id,
    title: x.title,
    projectId: x.projectId,
    by: x.agentId ? s.agents[x.agentId]?.name : undefined,
    at: x.updatedAt,
  }))
  for (const t of Object.values(s.tasks) as Task[]) {
    if (t.status !== 'review' || sessionTasks.has(t.id) || !inScope(scope, t.projectId)) continue
    const lastRun = t.runIds.length ? s.runs[t.runIds[t.runIds.length - 1]] : undefined
    if (!lastRun?.agentId) continue
    reviews.push({ kind: 'task', id: t.id, title: t.title, projectId: t.projectId, by: s.agents[lastRun.agentId]?.name, at: t.updatedAt })
  }
  reviews.sort((a, b) => a.at - b.at)
  return { approvals, reviews, count: approvals.length + reviews.length }
}

// ---------------------------------------------------------------- in flight & landed

/** Runs that are queued, running, waiting or paused, in scope — waiting first, then newest. */
export function inFlightRuns(s: Tables, scope: ID | null): Run[] {
  const order = (r: Run) => (r.status === 'waiting' ? 0 : r.status === 'running' ? 1 : r.status === 'queued' ? 2 : 3)
  return Object.values(s.runs)
    .filter((r) => ACTIVE_RUN_STATUSES.includes(r.status) && inScope(scope, r.projectId))
    .sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt)
}

export interface RunGroup {
  projectId: ID | null
  runs: Run[]
}

/** Group runs by project (the scoped/first-seen order is kept; "No project" last). */
export function groupByProject(runs: readonly Run[]): RunGroup[] {
  const groups = new Map<ID | null, Run[]>()
  for (const r of runs) {
    const list = groups.get(r.projectId) ?? []
    list.push(r)
    groups.set(r.projectId, list)
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : 0))
    .map(([projectId, list]) => ({ projectId, runs: list }))
}

const LANDED_KINDS = new Set<Notification['kind']>(['run.completed', 'run.failed'])

/** Project of a notification's subject (for scope filtering). */
export function notificationProject(s: Tables, n: Notification): ID | null {
  const ref = n.ref
  if (!ref) return null
  switch (ref.kind) {
    case 'run':
      return s.runs[ref.id]?.projectId ?? null
    case 'session':
      return s.sessions[ref.id]?.projectId ?? null
    case 'task':
      return s.tasks[ref.id]?.projectId ?? null
    case 'investigation':
      return s.investigations[ref.id]?.projectId ?? null
    case 'asset':
      return s.assets[ref.id]?.projectId ?? null
    default:
      return null
  }
}

/** Unread run.completed / run.failed notifications in scope: failures first, then newest. */
export function landedNotifications(s: Tables, scope: ID | null): Notification[] {
  return Object.values(s.notifications)
    .filter((n) => LANDED_KINDS.has(n.kind) && !n.readAt && (!scope || notificationProject(s, n) === scope))
    .sort((a, b) => Number(b.kind === 'run.failed') - Number(a.kind === 'run.failed') || b.createdAt - a.createdAt)
}

// ---------------------------------------------------------------- the state sentence

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

/** "Two", "Twelve", "14" — numbers in running prose are spelled out up to twelve. */
export function numberWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : String(n)
}

export interface SentenceInput {
  needsYou: number
  /** The requester of the oldest pending request, when known ("Forge"). */
  oldestRequester?: string
  /** Distinct requesters among pending requests. */
  requesters: number
  running: number
  landed: number
}

/** At or above this many requests Home is "busy": the sentence names the oldest request. */
export const BUSY_THRESHOLD = 5

/**
 * Home's state sentence (§6.1). First matching rule wins:
 * needs you → in flight → landed → quiet.
 */
export function stateSentence(input: SentenceInput): { text: string; state: 'needs-you' | 'busy' | 'in-flight' | 'landed' | 'quiet' } {
  const { needsYou, oldestRequester, requesters, running, landed } = input
  if (needsYou > 0) {
    if (needsYou >= BUSY_THRESHOLD && oldestRequester) {
      return { text: `${numberWord(needsYou)} things are waiting on you, the oldest from ${oldestRequester}.`, state: 'busy' }
    }
    if (oldestRequester && requesters === 1) {
      return { text: needsYou === 1 ? `${oldestRequester} is waiting on you.` : `${oldestRequester} is waiting on you for ${numberWord(needsYou).toLowerCase()} things.`, state: 'needs-you' }
    }
    return { text: needsYou === 1 ? 'One thing is waiting on you.' : `${numberWord(needsYou)} things are waiting on you.`, state: 'needs-you' }
  }
  if (running > 0) {
    return { text: `${numberWord(running)} ${running === 1 ? 'run' : 'runs'} in flight. Nothing needs you.`, state: 'in-flight' }
  }
  if (landed > 0) {
    return { text: `${numberWord(landed)} ${landed === 1 ? 'result' : 'results'} landed while you were away.`, state: 'landed' }
  }
  return { text: 'All quiet. What’s next?', state: 'quiet' }
}

/** The requester of a pending approval or the worker behind a review, by name. */
export function requesterName(s: Tables, a: Approval): string | undefined {
  const by = a.requestedBy
  if (by.type === 'agent') return s.agents[by.id]?.name
  if (by.type === 'workflow') return s.workflows[by.id]?.name
  return undefined
}

/** Inputs for the sentence from Needs you + counts. */
export function sentenceInput(s: Tables, needs: NeedsYou, running: number, landed: number): SentenceInput {
  type Pending = { at: number; who?: string }
  const pending: Pending[] = [
    ...needs.approvals.map((a) => ({ at: a.createdAt, who: requesterName(s, a) })),
    ...needs.reviews.map((r) => ({ at: r.at, who: r.by })),
  ].sort((a, b) => a.at - b.at)
  const names = new Set(pending.map((p) => p.who ?? '?'))
  return { needsYou: needs.count, oldestRequester: pending[0]?.who, requesters: names.size, running, landed }
}

// ---------------------------------------------------------------- the status line

/** "SUN 1 NOV" (uppercased by the meta-caps role). */
export function statusDate(now: number, locale?: string): string {
  const d = new Date(now)
  const weekday = d.toLocaleDateString(locale ?? 'en-GB', { weekday: 'short' })
  const month = d.toLocaleDateString(locale ?? 'en-GB', { month: 'short' })
  return `${weekday} ${d.getDate()} ${month}`.replace(/\./g, '')
}

/** Spend today: live dollars, or the simulated estimate when nothing live ran today. */
export function spendToday(s: Tables, now: number, scope: ID | null): { usd: number; estimated: boolean } {
  const d = new Date(now)
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  let live = 0
  let sim = 0
  for (const r of Object.values(s.runs)) {
    const at = r.endedAt ?? r.startedAt ?? r.createdAt
    if (at < from || at > now || !inScope(scope, r.projectId)) continue
    if (r.simulated) sim += r.usage.costUsd
    else live += r.usage.costUsd
  }
  return live > 0 ? { usd: live, estimated: false } : { usd: sim, estimated: true }
}
