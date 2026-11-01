import { isRunActive, type Approval, type ID, type Run, type Task } from '@/core/types'
import { addLocalDays } from './time'

/**
 * Home's one-line state ("2 agents working · 1 waiting on you · 3 due today"). Pure; pass `now`.
 */

export interface HomeSummary {
  /** Distinct agents with a queued or running run. */
  working: number
  /** Pending approvals. */
  waitingOnYou: number
  /** My open tasks due later today (not yet past due). */
  dueToday: number
  /** My open tasks whose due time has passed. */
  overdue: number
  /** Runs that are queued, running, waiting on an approval or paused. */
  activeRuns: number
}

export interface HomeSummaryInput {
  runs: readonly Run[]
  approvals: readonly Approval[]
  tasks: readonly Task[]
  now: number
  /** Restrict to one project; null/undefined = all work. */
  projectId?: ID | null
}

export const EMPTY_HOME_SUMMARY: HomeSummary = { working: 0, waitingOnYou: 0, dueToday: 0, overdue: 0, activeRuns: 0 }

/** Open tasks that are mine: assigned to a user (me) or unassigned, not done or cancelled. Same rule as `useMyTasks`. */
export function isMyOpenTask(task: Pick<Task, 'assignee' | 'status'>): boolean {
  return (!task.assignee || task.assignee.type === 'user') && task.status !== 'done' && task.status !== 'cancelled'
}

export function computeHomeSummary(input: HomeSummaryInput): HomeSummary {
  const projectId = input.projectId || null
  const workingAgents = new Set<ID>()
  const projectOfRun = new Map<ID, ID | null>()
  let activeRuns = 0
  for (const run of input.runs) {
    if (projectId !== null) {
      projectOfRun.set(run.id, run.projectId)
      if (run.projectId !== projectId) continue
    }
    if (isRunActive(run.status)) activeRuns++
    if (run.agentId && (run.status === 'running' || run.status === 'queued')) workingAgents.add(run.agentId)
  }

  let waitingOnYou = 0
  for (const a of input.approvals) {
    if (a.status !== 'pending') continue
    if (projectId !== null && projectOfRun.get(a.runId) !== projectId) continue
    waitingOnYou++
  }

  const startOfTomorrow = addLocalDays(input.now, 1)
  let dueToday = 0
  let overdue = 0
  for (const t of input.tasks) {
    if (t.dueAt === undefined || !isMyOpenTask(t)) continue
    if (projectId !== null && t.projectId !== projectId) continue
    if (t.dueAt < input.now) overdue++
    else if (t.dueAt < startOfTomorrow) dueToday++
  }

  return { working: workingAgents.size, waitingOnYou, dueToday, overdue, activeRuns }
}
