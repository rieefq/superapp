import type { Tables } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { routeIn } from '@/core/services/entities'
import {
  refKey,
  type ActorRef, type Agent, type Approval, type EntityRef, type ID, type Priority, type Run, type Task,
} from '@/core/types'
import { agoText, clip, clockTime, durationText, endOfLocalDay, joinList, plural, quoted, TIME_MS } from './text'
import type { NextAction, NextActionKind, NextActionKindMeta, NextActionsOptions, NextActionsState } from './types'

/**
 * “What should I do next?” — deterministic rules over workspace state (not AI):
 * pending approvals, overdue / due-today tasks of mine, coding sessions and research reports
 * waiting for review, runs that failed in the last 24h, broken integrations, conversations whose
 * last reply stopped or failed, and agents that have been idle for over a week.
 * Each rule yields at most a few items; results are deduped, priority-ordered and scope-aware.
 */

/** Routes for aggregate suggestions that are not about one entity. */
export const ASSIST_ROUTES = {
  /** Every pending approval (the Agents workspace approvals view). */
  approvals: '/agents?status=waiting',
} as const

export const NEXT_ACTION_KINDS: Record<NextActionKind, NextActionKindMeta> = {
  approve: { label: 'Approval', icon: 'ShieldCheck', tone: 'warning' },
  due: { label: 'Due', icon: 'CalendarClock', tone: 'warning' },
  review: { label: 'Review', icon: 'Eye', tone: 'accent' },
  retry: { label: 'Failed run', icon: 'RefreshCw', tone: 'danger' },
  reconnect: { label: 'Integration', icon: 'Plug', tone: 'danger' },
  resume: { label: 'Conversation', icon: 'MessageCircle', tone: 'info' },
  'idle-agent': { label: 'Idle agent', icon: 'Moon', tone: 'neutral' },
}

/** Base priorities (0..100, higher first). */
const P = {
  approve: 94,
  overdue: 86,
  reviewSession: 82,
  reviewReport: 78,
  retry: 72,
  dueToday: 66,
  reconnect: 60,
  resumeError: 46,
  resumeStopped: 42,
  idleScheduleOff: 14,
  idleNoSchedule: 10,
} as const

const TASK_BONUS: Record<Priority, number> = { urgent: 3, high: 2, medium: 1, low: 0.5, none: 0 }
const PRIORITY_WORD: Partial<Record<Priority, string>> = { urgent: 'Urgent', high: 'High priority' }

const FAILED_WINDOW = TIME_MS.DAY
const RESUME_WINDOW = 7 * TIME_MS.DAY
const IDLE_AFTER = 7 * TIME_MS.DAY
const USAGE_WINDOW = 30 * TIME_MS.DAY

interface Candidate {
  id: string
  kind: NextActionKind
  title: string
  reason: string
  ref?: EntityRef
  actionLabel: string
  priority: number
  /** Entity keys this item speaks for; lower-ranked items about the same entities are dropped. */
  covers: string[]
  /** Explicit route (aggregates); otherwise resolved from `ref`. */
  route?: string
}

interface RuleContext {
  s: Tables
  now: number
  scope: ID | null
  inScope: (projectId: ID | null | undefined) => boolean
}

type Rule = (ctx: RuleContext) => Candidate[]

const ref = (kind: EntityRef['kind'], id: ID): EntityRef => ({ kind, id })

function actorLabel(s: Tables, actor: ActorRef): string {
  switch (actor.type) {
    case 'agent':
      return s.agents[actor.id]?.name ?? 'An agent'
    case 'workflow':
      return s.workflows[actor.id] ? `The “${clip(s.workflows[actor.id].name, 40)}” workflow` : 'A workflow'
    case 'user':
      return 'You'
    case 'system':
      return 'Atrium'
  }
}

// ---------------------------------------------------------------- rules

/** Pending approvals: one item (the request itself, or “Decide on N approvals”). */
const approvalsRule: Rule = ({ s, now, inScope }) => {
  const pending = Object.values(s.approvals)
    .filter((a) => a.status === 'pending' && inScope(s.runs[a.runId]?.projectId ?? null))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  if (!pending.length) return []
  const highRisk = pending.some((a) => a.risk === 'high')
  const covers = pending.flatMap((a) => [refKey(ref('approval', a.id)), refKey(ref('run', a.runId))])
  if (pending.length === 1) {
    const a: Approval = pending[0]
    return [{
      id: `approve:${a.id}`,
      kind: 'approve',
      title: `Decide on ${quoted(a.title)}`,
      reason: `${actorLabel(s, a.requestedBy)} is waiting for your approval · ${a.risk} risk · asked ${agoText(now - a.createdAt)}.`,
      ref: ref('approval', a.id),
      actionLabel: 'Decide',
      priority: P.approve + (highRisk ? 0.5 : 0),
      covers,
    }]
  }
  const oldest = pending[0]
  const runs = new Set(pending.map((a) => a.runId)).size
  return [{
    id: 'approve:pending',
    kind: 'approve',
    title: `Decide on ${pending.length} approvals`,
    reason: `${plural(runs, 'run is', 'runs are')} paused until you approve or reject · oldest: ${quoted(oldest.title, 48)} (${agoText(now - oldest.createdAt)}).`,
    actionLabel: 'Review approvals',
    priority: P.approve + (highRisk ? 0.5 : 0) + Math.min(pending.length, 5) * 0.1,
    covers,
    route: ASSIST_ROUTES.approvals,
  }]
}

/** Coding sessions whose changes wait for review. */
const sessionsRule: Rule = ({ s, now, inScope }) =>
  Object.values(s.sessions)
    .filter((ses) => ses.status === 'needs_review' && inScope(ses.projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((ses, i) => {
      const pending = ses.changes.filter((c) => !c.review || c.review === 'pending').length
      const title =
        pending > 0
          ? `Review ${plural(pending, 'changed file')} in ${quoted(ses.title)}`
          : ses.changes.length
            ? `Finish reviewing ${quoted(ses.title)}`
            : `Review ${quoted(ses.title)}`
      const failed = ses.checks.filter((c) => c.status === 'failed').length
      const passed = ses.checks.filter((c) => c.status === 'passed').length
      const checks = ses.checks.length
        ? failed
          ? `${failed} of ${plural(ses.checks.length, 'check')} failed`
          : passed === ses.checks.length
            ? `all ${plural(ses.checks.length, 'check')} passed`
            : `${passed} of ${plural(ses.checks.length, 'check')} passed`
        : 'no checks ran'
      const who = ses.agentId ? s.agents[ses.agentId]?.name ?? 'The coding agent' : 'The coding agent'
      const linked = ses.taskId ? s.tasks[ses.taskId] : undefined
      const task = linked && linked.title.trim().toLowerCase() !== ses.title.trim().toLowerCase() ? linked : undefined
      const reason =
        pending > 0
          ? `${who} finished ${agoText(now - ses.updatedAt)} · ${checks}${task ? ` · for ${quoted(task.title, 40)}` : ''}.`
          : `${ses.changes.length === 1 ? 'The changed file is' : `All ${ses.changes.length} changed files are`} reviewed — apply or open a pull request · ${checks}.`
      return {
        id: `review:session:${ses.id}`,
        kind: 'review' as const,
        title,
        reason,
        ref: ref('session', ses.id),
        actionLabel: pending > 0 ? 'Review changes' : 'Open session',
        priority: P.reviewSession - i * 0.1,
        covers: [refKey(ref('session', ses.id)), ...(ses.taskId ? [refKey(ref('task', ses.taskId))] : [])],
      }
    })

/** Research reports waiting for review. */
const reportsRule: Rule = ({ s, now, inScope }) =>
  Object.values(s.investigations)
    .filter((inv) => inv.status === 'review' && inScope(inv.projectId))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, 2)
    .map((inv, i) => {
      const findings = inv.findings.length
      const sources = inv.sourceIds.length
      const what = findings
        ? `${plural(findings, 'finding')} from ${plural(sources, 'source')}`
        : sources
          ? `a draft report from ${plural(sources, 'source')}`
          : 'a draft report'
      return {
        id: `review:investigation:${inv.id}`,
        kind: 'review' as const,
        title: `Review the report ${quoted(inv.title)}`,
        reason: `Research finished ${agoText(now - inv.updatedAt)} with ${what}; it is waiting for your review.`,
        ref: ref('investigation', inv.id),
        actionLabel: 'Review report',
        priority: P.reviewReport - i * 0.1,
        covers: [refKey(ref('investigation', inv.id)), ...(inv.origin ? [refKey(inv.origin)] : [])],
      }
    })

function sameScript(a: Run, b: Run): boolean {
  if (!a.script || !b.script) return false
  return a.script.factory === b.script.factory && JSON.stringify(a.script.params) === JSON.stringify(b.script.params)
}

/** A newer run that retried the same work and succeeded (or is still going) resolves a failure. */
function isResolved(failed: Run, all: readonly Run[]): boolean {
  return all.some(
    (r) =>
      r.id !== failed.id &&
      r.createdAt > failed.createdAt &&
      r.status !== 'failed' &&
      r.status !== 'cancelled' &&
      (sameScript(r, failed) ||
        (!!failed.origin && !!r.origin && refKey(r.origin) === refKey(failed.origin) && r.title === failed.title && r.kind === failed.kind)),
  )
}

/** Failures of the same workflow / agent+origin / origin collapse into one item. */
function failureGroup(run: Run): string {
  if (run.workflowId) return `workflow:${run.workflowId}`
  if (run.origin) return `origin:${refKey(run.origin)}`
  return `run:${run.kind}:${run.agentId ?? ''}:${run.title}`
}

/** Top-level, non-chat runs that failed in the last 24h and were not retried successfully. */
const failedRunsRule: Rule = ({ s, now, inScope }) => {
  const runs = Object.values(s.runs)
  const recent = runs.filter(
    (r) =>
      r.status === 'failed' &&
      r.kind !== 'chat' &&
      !r.parentRunId &&
      now - (r.endedAt ?? r.createdAt) <= FAILED_WINDOW &&
      (r.endedAt ?? r.createdAt) <= now &&
      inScope(r.projectId),
  )
  const groups = new Map<string, Run[]>()
  for (const r of recent) {
    if (isResolved(r, runs)) continue
    const key = failureGroup(r)
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const at = (r: Run) => r.endedAt ?? r.createdAt
  return [...groups.values()]
    .map((list) => ({ latest: [...list].sort((a, b) => at(b) - at(a) || a.id.localeCompare(b.id))[0], count: list.length }))
    .sort((a, b) => at(b.latest) - at(a.latest) || a.latest.id.localeCompare(b.latest.id))
    .slice(0, 3)
    .map(({ latest, count }, i) => {
      const error = latest.error?.trim() || latest.steps.find((st) => st.status === 'failed')?.error?.trim()
      const task = latest.origin?.kind === 'task' ? s.tasks[latest.origin.id] : undefined
      const parts = [
        error ? clip(error, 90) : 'The run failed',
        `failed ${agoText(now - at(latest))}`,
        ...(count > 1 ? [`${count} failures in 24h`] : []),
        ...(task ? [`for ${quoted(task.title, 40)}`] : []),
      ]
      return {
        id: `retry:${latest.id}`,
        kind: 'retry' as const,
        title: `Retry or inspect ${quoted(latest.title)}`,
        reason: `${parts.join(' · ')}.`,
        ref: ref('run', latest.id),
        actionLabel: 'Inspect',
        priority: P.retry - i * 0.1,
        covers: [refKey(ref('run', latest.id))],
      }
    })
}

function usesIntegration(nodesOwner: { trigger: { integrationId?: string }; nodes: { integrationId?: string }[] }, id: string): boolean {
  return nodesOwner.trigger.integrationId === id || nodesOwner.nodes.some((n) => n.integrationId === id)
}

/** Connections in an error state, with who depends on them. */
const integrationsRule: Rule = ({ s, now, scope }) => {
  const workflows = Object.values(s.workflows)
  const agents = Object.values(s.agents).filter((a) => a.status === 'active')
  const recentRuns = scope ? Object.values(s.runs).filter((r) => r.projectId === scope && now - r.createdAt <= USAGE_WINDOW) : []
  return Object.values(s.connections)
    .filter((c) => c.status === 'error' && !!getIntegration(c.id))
    .map((conn) => {
      const def = getIntegration(conn.id)!
      const usingWorkflows = workflows.filter((w) => w.enabled && usesIntegration(w, conn.id))
      const usingAgents = agents.filter((a) => a.capabilities.some((g) => g.integrationId === conn.id && g.mode !== 'deny'))
      const relevant =
        !scope ||
        workflows.some((w) => w.projectId === scope && usesIntegration(w, conn.id)) ||
        recentRuns.some((r) => r.steps.some((st) => st.integrationId === conn.id))
      return { conn, def, usingWorkflows, usingAgents, relevant }
    })
    .filter((x) => x.relevant)
    .sort((a, b) => b.usingWorkflows.length + b.usingAgents.length - (a.usingWorkflows.length + a.usingAgents.length) || a.def.name.localeCompare(b.def.name))
    .slice(0, 2)
    .map(({ conn, def, usingWorkflows, usingAgents }, i) => {
      const users = [
        ...(usingWorkflows.length ? [plural(usingWorkflows.length, 'enabled workflow')] : []),
        ...(usingAgents.length ? [plural(usingAgents.length, 'agent')] : []),
      ]
      const error = conn.error?.trim() ? clip(conn.error, 90) : `${def.name} reported a connection error`
      return {
        id: `reconnect:${conn.id}`,
        kind: 'reconnect' as const,
        title: `Reconnect ${def.name}`,
        reason: `${error}${/[.!?]$/.test(error) ? '' : '.'}${users.length ? ` Used by ${joinList(users)}.` : ''}`,
        ref: ref('integration', conn.id),
        actionLabel: 'Reconnect',
        priority: P.reconnect + (users.length ? 4 : 0) - i * 0.1,
        covers: [refKey(ref('integration', conn.id))],
      }
    })
}

const isMine = (t: Task) => t.assignee === null || t.assignee.type === 'user'

/** My open tasks that are overdue or due today. */
const dueTasksRule: Rule = ({ s, now, inScope }) => {
  const endOfToday = endOfLocalDay(now)
  const rank: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }
  return Object.values(s.tasks)
    .filter(
      (t) => isMine(t) && t.status !== 'done' && t.status !== 'cancelled' && t.dueAt !== undefined && t.dueAt <= endOfToday && inScope(t.projectId),
    )
    .sort((a, b) => {
      const ao = a.dueAt! < now ? 0 : 1
      const bo = b.dueAt! < now ? 0 : 1
      return ao - bo || rank[a.priority] - rank[b.priority] || a.dueAt! - b.dueAt! || a.id.localeCompare(b.id)
    })
    .slice(0, 3)
    .map((t, i) => {
      const overdue = t.dueAt! < now
      const when = overdue ? `Overdue by ${durationText(now - t.dueAt!)}` : `Due today at ${clockTime(t.dueAt!)}`
      const project = t.projectId ? s.projects[t.projectId]?.name : undefined
      const parts = [when, ...(PRIORITY_WORD[t.priority] ? [PRIORITY_WORD[t.priority]!] : []), ...(project ? [project] : [])]
      return {
        id: `due:${t.id}`,
        kind: 'due' as const,
        title: `Finish ${quoted(t.title)}`,
        reason: `${parts.join(' · ')}.`,
        ref: ref('task', t.id),
        actionLabel: 'Open task',
        priority: (overdue ? P.overdue : P.dueToday) + TASK_BONUS[t.priority] - i * 0.1,
        covers: [refKey(ref('task', t.id))],
      }
    })
}

/** Conversations whose last reply was stopped or failed in the last week. */
const conversationsRule: Rule = ({ s, now, inScope }) =>
  Object.values(s.threads)
    .filter((t) => !t.archived && inScope(t.projectId))
    .flatMap((thread) => {
      const lastId = thread.messageIds[thread.messageIds.length - 1]
      const last = lastId ? s.messages[lastId] : undefined
      if (!last || last.role !== 'assistant' || (last.status !== 'stopped' && last.status !== 'error')) return []
      if (now - last.createdAt > RESUME_WINDOW) return []
      return [{ thread, last }]
    })
    .sort((a, b) => b.last.createdAt - a.last.createdAt || a.thread.id.localeCompare(b.thread.id))
    .slice(0, 2)
    .map(({ thread, last }, i) => {
      const what =
        last.status === 'error'
          ? `The last reply failed${last.error?.trim() ? `: ${clip(last.error, 80)}` : ''}`
          : 'The last reply was stopped before it finished'
      return {
        id: `resume:${thread.id}`,
        kind: 'resume' as const,
        title: `Resume ${quoted(thread.title)}`,
        reason: `${what.replace(/[.!?]$/, '')} · ${agoText(now - last.createdAt)}.`,
        ref: ref('thread', thread.id),
        actionLabel: 'Resume',
        priority: (last.status === 'error' ? P.resumeError : P.resumeStopped) - i * 0.1,
        covers: [refKey(ref('thread', thread.id)), refKey(ref('message', last.id)), ...(last.runId ? [refKey(ref('run', last.runId))] : [])],
      }
    })

/** Active agents with no enabled schedule and no runs for more than a week. */
const idleAgentsRule: Rule = ({ s, now, scope }) => {
  const lastRun = new Map<ID, number>()
  const ranInScope = new Set<ID>()
  for (const r of Object.values(s.runs)) {
    if (!r.agentId) continue
    const at = r.startedAt ?? r.createdAt
    if (at > (lastRun.get(r.agentId) ?? -Infinity)) lastRun.set(r.agentId, at)
    if (scope && r.projectId === scope) ranInScope.add(r.agentId)
  }
  const relevant = (a: Agent) => !scope || a.knowledgeScope.projectIds.includes(scope) || ranInScope.has(a.id)
  return Object.values(s.agents)
    .filter((a) => a.status === 'active' && !a.schedule?.enabled && relevant(a))
    .map((agent) => ({ agent, idle: now - Math.max(lastRun.get(agent.id) ?? -Infinity, agent.createdAt), ran: lastRun.has(agent.id) }))
    .filter((x) => x.idle > IDLE_AFTER)
    .sort((a, b) => Number(!!b.agent.schedule) - Number(!!a.agent.schedule) || b.idle - a.idle || a.agent.name.localeCompare(b.agent.name))
    .slice(0, 2)
    .map(({ agent, idle, ran }, i) => {
      const days = Math.floor(idle / TIME_MS.DAY)
      const since = ran ? `No runs in ${days} days` : `No runs since it was created ${days} days ago`
      const schedule = agent.schedule ? `its schedule (${agent.schedule.label}) is off` : 'it has no schedule'
      return {
        id: `idle-agent:${agent.id}`,
        kind: 'idle-agent' as const,
        title: `Put ${agent.name} to work`,
        reason: `${since} and ${schedule}.`,
        ref: ref('agent', agent.id),
        actionLabel: agent.schedule ? 'Review schedule' : 'Open agent',
        priority: (agent.schedule ? P.idleScheduleOff : P.idleNoSchedule) - i * 0.1,
        covers: [refKey(ref('agent', agent.id))],
      }
    })
}

/** Rule order also breaks priority ties. */
const RULES: readonly Rule[] = [
  approvalsRule, dueTasksRule, sessionsRule, reportsRule, failedRunsRule, integrationsRule, conversationsRule, idleAgentsRule,
]

/**
 * Suggested next actions for the workspace, most important first. Pure: everything time-based
 * uses `state.now`, and the same state always yields the same list.
 */
export function suggestNextActions(state: NextActionsState, opts: NextActionsOptions = {}): NextAction[] {
  const limit = Math.max(0, Math.floor(opts.limit ?? 10))
  if (!limit) return []
  const { tables: s, now, scopeProjectId: scope } = state
  const ctx: RuleContext = { s, now, scope, inScope: (projectId) => !scope || projectId === scope }

  const candidates = RULES.flatMap((rule, ruleIndex) => rule(ctx).map((c, i) => ({ c, order: ruleIndex * 100 + i })))
  candidates.sort((a, b) => b.c.priority - a.c.priority || a.order - b.order)

  const claimed = new Set<string>()
  const ids = new Set<string>()
  const out: NextAction[] = []
  for (const { c } of candidates) {
    const own = c.ref ? refKey(c.ref) : c.id
    if (ids.has(c.id) || claimed.has(own)) continue
    ids.add(c.id)
    claimed.add(own)
    for (const k of c.covers) claimed.add(k)
    out.push({
      id: c.id,
      kind: c.kind,
      title: c.title,
      reason: c.reason,
      ...(c.ref ? { ref: c.ref } : {}),
      actionLabel: c.actionLabel,
      route: c.route ?? (c.ref ? routeIn(s, c.ref) : '/'),
      priority: Math.round(c.priority * 10) / 10,
    })
    if (out.length >= limit) break
  }
  return out
}
