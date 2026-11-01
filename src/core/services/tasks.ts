import { db, ID_PREFIX, useDB, useRow, useRows, useRowsByIds } from '@/core/db'
import { getSettings } from '@/core/settings'
import {
  ME,
  isRunActive,
  type ActorRef,
  type EntityRef,
  type ID,
  type Priority,
  type Run,
  type Subtask,
  type Task,
  type TaskStatus,
} from '@/core/types'
import { newId } from '@/lib/id'
import { logActivity } from './activity'
import { assertAgentCanRun, runAgent } from './agents'
import { describeRef, TASK_STATUS_LABEL } from './entities'
import { notify } from './notifications'
import { changedKeys, clipLine, forgetRef, markDerived } from './serviceHelpers'

export const PRIORITY_RANK: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
}

const taskRef = (id: ID): EntityRef => ({ kind: 'task', id })
const sameActor = (a: ActorRef | null | undefined, b: ActorRef | null | undefined) =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.type === b.type && a.id === b.id)

/** Display name for an actor in activity summaries. */
export function actorName(actor: ActorRef): string {
  switch (actor.type) {
    case 'user':
      return getSettings().profile.name || 'You'
    case 'agent':
      return db.get('agents', actor.id)?.name ?? 'an agent'
    case 'workflow':
      return db.get('workflows', actor.id)?.name ?? 'a workflow'
    case 'system':
      return 'Atrium'
  }
}

function normalizeLabels(labels: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (label && !out.includes(label)) out.push(label)
  }
  return out
}

const byOrder = (a: Task, b: Task) => a.order - b.order || a.createdAt - b.createdAt

/** Next sort order at the bottom of a kanban column (project + status). */
function nextOrder(projectId: ID | null, status: TaskStatus, excludeId?: ID): number {
  let max = -1
  for (const t of db.all('tasks')) {
    if (t.id !== excludeId && t.projectId === projectId && t.status === status && t.order > max) max = t.order
  }
  return max + 1
}

/** The instruction an agent receives for a task. */
function taskInstruction(task: Task): string {
  return task.description ? `${task.title}\n\n${task.description}` : task.title
}

function startAgentOnTask(task: Task, agentId: ID): Run {
  const run = runAgent(agentId, {
    instruction: taskInstruction(task),
    taskId: task.id,
    projectId: task.projectId,
    origin: taskRef(task.id),
  })
  const agentName = db.get('agents', agentId)?.name ?? 'The agent'
  notify({
    kind: 'task.assigned',
    title: `${agentName} picked up “${clipLine(task.title, 80)}”`,
    body: 'The agent is working on it and will move the task to Review when it finishes.',
    ref: taskRef(task.id),
    tone: 'info',
  })
  return run
}

// ---------------------------------------------------------------- create

export interface CreateTaskInput {
  title: string
  projectId?: ID | null
  description?: string
  priority?: Priority
  status?: TaskStatus
  assignee?: ActorRef | null
  dueAt?: number
  labels?: string[]
  origin?: EntityRef
  milestoneId?: ID
  /** Initial subtask titles. */
  subtasks?: string[]
  /** Who creates the task, for the activity log (defaults to the user). */
  actor?: ActorRef
}

/**
 * Create a task. Links it to its origin (and records it on the origin message), logs activity,
 * and — when assigned to an agent — starts the agent on it right away.
 */
export function createTask(input: CreateTaskInput): Task {
  const now = Date.now()
  const projectId = input.projectId ?? null
  const status = input.status ?? 'todo'
  const origin = input.origin ? { kind: input.origin.kind, id: input.origin.id } : undefined
  const task: Task = {
    id: newId(ID_PREFIX.tasks),
    projectId,
    title: input.title.trim() || 'Untitled task',
    description: input.description?.trim() || undefined,
    status,
    priority: input.priority ?? 'none',
    assignee: input.assignee ?? null,
    milestoneId: input.milestoneId,
    dueAt: input.dueAt,
    labels: normalizeLabels(input.labels ?? []),
    subtasks: (input.subtasks ?? [])
      .map((title) => title.trim())
      .filter(Boolean)
      .map((title) => ({ id: newId('sub'), title, done: false })),
    origin,
    runIds: [],
    order: nextOrder(projectId, status),
    createdAt: now,
    updatedAt: now,
    completedAt: status === 'done' ? now : undefined,
  }
  db.insert('tasks', task)
  if (origin) markDerived(taskRef(task.id), origin)

  const from = origin ? ` from ${describeRef(origin)}` : ''
  const to = task.assignee ? ` for ${actorName(task.assignee)}` : ''
  logActivity({
    actor: input.actor ?? ME,
    verb: 'created',
    target: taskRef(task.id),
    summary: `Created task “${task.title}”${from}${to}`,
    projectId,
    meta: origin ? { origin } : undefined,
  })

  if (task.assignee?.type === 'agent') {
    try {
      startAgentOnTask(task, task.assignee.id)
    } catch (err) {
      notify({
        kind: 'system',
        title: `“${clipLine(task.title, 60)}” wasn’t started`,
        body: err instanceof Error ? err.message : 'The agent could not start.',
        ref: taskRef(task.id),
        tone: 'warning',
      })
    }
  }
  return db.get('tasks', task.id) ?? task
}

// ---------------------------------------------------------------- update

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'assignee' | 'milestoneId' | 'dueAt' | 'labels' | 'subtasks' | 'projectId'>
>

/** Override how an update is recorded in the activity log (e.g. when an agent moves a task). */
export interface TaskActivityOptions {
  actor?: ActorRef
  verb?: string
  summary?: string
}

const FIELD_LABEL: Partial<Record<keyof Task, string>> = {
  title: 'title',
  description: 'description',
  priority: 'priority',
  milestoneId: 'milestone',
  dueAt: 'due date',
  labels: 'labels',
  subtasks: 'subtasks',
  projectId: 'project',
}

export function updateTask(id: ID, patch: TaskPatch, opts: TaskActivityOptions = {}): Task | undefined {
  const cur = db.get('tasks', id)
  if (!cur) return undefined
  const { assignee, ...rest } = patch
  if (rest.title !== undefined) rest.title = rest.title.trim() || cur.title
  if (rest.labels) rest.labels = normalizeLabels(rest.labels)
  const fields = changedKeys(cur, rest)
  let next: Task = cur

  if (fields.length) {
    const now = Date.now()
    const update: Partial<Task> = { ...rest, updatedAt: now }
    const status = rest.status ?? cur.status
    const projectId = rest.projectId !== undefined ? rest.projectId : cur.projectId
    const statusChanged = status !== cur.status
    const projectChanged = projectId !== cur.projectId
    if (statusChanged) update.completedAt = status === 'done' ? now : undefined
    if (statusChanged || projectChanged) update.order = nextOrder(projectId, status, id)
    if (projectChanged && rest.milestoneId === undefined) update.milestoneId = undefined
    next = db.update('tasks', id, update) ?? cur

    const title = next.title
    const others = fields.filter((f) => f !== 'status').map((f) => FIELD_LABEL[f] ?? String(f))
    logActivity({
      actor: opts.actor ?? ME,
      verb: opts.verb ?? (statusChanged ? (status === 'done' ? 'completed' : 'moved') : 'updated'),
      target: taskRef(id),
      summary:
        opts.summary ??
        (statusChanged
          ? `Moved “${title}” to ${TASK_STATUS_LABEL[status]}`
          : `Updated ${others.join(', ')} of “${title}”`),
      projectId: next.projectId,
      meta: statusChanged ? { from: cur.status, to: status, fields } : { fields },
    })
  }

  if (assignee !== undefined && !sameActor(assignee, cur.assignee)) return assignTask(id, assignee)?.task ?? next
  return next
}

/**
 * Kanban move: put a task into `status`, before `beforeTaskId` (or at the end), and
 * renumber the column. One store write for the whole column.
 */
export function moveTask(id: ID, status: TaskStatus, beforeTaskId?: ID | null): Task | undefined {
  const cur = db.get('tasks', id)
  if (!cur) return undefined
  // Dropping a card right where it already is (e.g. "before itself") changes nothing.
  if (beforeTaskId === id && cur.status === status) return cur
  const now = Date.now()
  const column = db.filter('tasks', (t) => t.id !== id && t.projectId === cur.projectId && t.status === status).sort(byOrder)
  const at = beforeTaskId ? column.findIndex((t) => t.id === beforeTaskId) : -1
  column.splice(at >= 0 ? at : column.length, 0, cur)
  const statusChanged = cur.status !== status
  const updates: Task[] = []
  column.forEach((t, order) => {
    if (t.id === id) {
      if (!statusChanged && t.order === order) return
      updates.push({
        ...cur,
        status,
        order,
        updatedAt: statusChanged ? now : cur.updatedAt,
        completedAt: statusChanged ? (status === 'done' ? now : undefined) : cur.completedAt,
      })
    } else if (t.order !== order) {
      updates.push({ ...t, order })
    }
  })
  db.insertMany('tasks', updates)
  if (statusChanged) {
    logActivity({
      actor: ME,
      verb: status === 'done' ? 'completed' : 'moved',
      target: taskRef(id),
      summary: `Moved “${cur.title}” to ${TASK_STATUS_LABEL[status]}`,
      projectId: cur.projectId,
      meta: { from: cur.status, to: status },
    })
  }
  return db.get('tasks', id)
}

/**
 * Assign a task to the user, an agent, or nobody. Assigning an agent starts it on the task
 * (task → In progress, 'task.assigned' notification). Throws a friendly error when the
 * agent is paused or archived, without changing the task.
 */
export function assignTask(id: ID, assignee: ActorRef | null): { task: Task; run?: Run } | undefined {
  const cur = db.get('tasks', id)
  if (!cur) return undefined
  if (assignee?.type === 'agent') assertAgentCanRun(assignee.id)
  const changed = !sameActor(cur.assignee, assignee)
  if (changed) {
    db.update('tasks', id, { assignee: assignee ? { ...assignee } : null, updatedAt: Date.now() })
    logActivity({
      actor: ME,
      verb: assignee ? 'assigned' : 'unassigned',
      target: taskRef(id),
      summary: assignee ? `Assigned “${cur.title}” to ${actorName(assignee)}` : `Unassigned “${cur.title}”`,
      projectId: cur.projectId,
      meta: { from: cur.assignee, to: assignee },
    })
  }
  if (assignee?.type === 'agent') {
    const hasActiveRun = cur.runIds.some((runId) => {
      const run = db.get('runs', runId)
      return !!run && run.agentId === assignee.id && isRunActive(run.status)
    })
    if (changed || !hasActiveRun) {
      const run = startAgentOnTask(db.get('tasks', id) ?? cur, assignee.id)
      return { task: db.get('tasks', id) ?? cur, run }
    }
  }
  return { task: db.get('tasks', id) ?? cur }
}

export function deleteTask(id: ID): void {
  const cur = db.get('tasks', id)
  if (!cur) return
  forgetRef(taskRef(id))
  db.remove('tasks', id)
  logActivity({
    actor: ME,
    verb: 'deleted',
    target: taskRef(id),
    summary: `Deleted task “${cur.title}”`,
    projectId: cur.projectId,
  })
}

// ---------------------------------------------------------------- review

/** Kanban columns, in order. Cancelled tasks live outside the board (list view only). */
export const BOARD_STATUSES: readonly TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done']

/** The most recent run attached to a task (runIds are kept most recent last). */
export function latestTaskRun(task: Pick<Task, 'runIds'>): Run | undefined {
  for (let i = task.runIds.length - 1; i >= 0; i--) {
    const run = db.get('runs', task.runIds[i])
    if (run) return run
  }
  return undefined
}

/**
 * Approve the work under review (§6.9): an agent's task never moves straight to Done — you approve
 * the review to complete it. No-op unless the task is in Review.
 */
export function approveTaskReview(id: ID): Task | undefined {
  const cur = db.get('tasks', id)
  if (!cur || cur.status !== 'review') return cur
  const by = latestTaskRun(cur)?.agentId
  const agentName = by ? db.get('agents', by)?.name : undefined
  return updateTask(
    id,
    { status: 'done' },
    {
      verb: 'approved',
      summary: agentName ? `Approved ${agentName}’s work on “${cur.title}” — done` : `Approved the review of “${cur.title}” — done`,
    },
  )
}

/**
 * Send a task in Review back with a note. When an agent did the work it gets a new run with the
 * note (the task returns to In progress while it works); otherwise the task simply goes back to
 * In progress. Throws the agent service's friendly error when the agent cannot take work.
 */
export function requestTaskChanges(id: ID, note: string): { task: Task; run?: Run } | undefined {
  const cur = db.get('tasks', id)
  if (!cur) return undefined
  const clean = note.trim()
  const agentId = cur.assignee?.type === 'agent' ? cur.assignee.id : undefined
  if (agentId) assertAgentCanRun(agentId)
  logActivity({
    actor: ME,
    verb: 'requested_changes',
    target: taskRef(id),
    summary: clean ? `Requested changes on “${cur.title}”: “${clipLine(clean, 140)}”` : `Requested changes on “${cur.title}”`,
    projectId: cur.projectId,
    meta: clean ? { note: clean } : undefined,
  })
  if (agentId) {
    const instruction = [taskInstruction(cur), clean ? `Changes requested in review:\n${clean}` : 'Changes were requested in review.'].join('\n\n')
    const run = runAgent(agentId, { instruction, taskId: id, projectId: cur.projectId, origin: taskRef(id) })
    return { task: db.get('tasks', id) ?? cur, run }
  }
  const task = cur.status === 'in_progress' ? cur : (updateTask(id, { status: 'in_progress' }) ?? cur)
  return { task }
}

// ---------------------------------------------------------------- subtasks

export function addSubtask(taskId: ID, title: string): Subtask | undefined {
  const cur = db.get('tasks', taskId)
  const clean = title.trim()
  if (!cur || !clean) return undefined
  const subtask: Subtask = { id: newId('sub'), title: clean, done: false }
  db.update('tasks', taskId, { subtasks: [...cur.subtasks, subtask], updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'updated',
    target: taskRef(taskId),
    summary: `Added subtask “${clean}” to “${cur.title}”`,
    projectId: cur.projectId,
    meta: { subtaskId: subtask.id },
  })
  return subtask
}

export function toggleSubtask(taskId: ID, subtaskId: ID): Subtask | undefined {
  const cur = db.get('tasks', taskId)
  const sub = cur?.subtasks.find((s) => s.id === subtaskId)
  if (!cur || !sub) return undefined
  const next: Subtask = { ...sub, done: !sub.done }
  db.update('tasks', taskId, { subtasks: cur.subtasks.map((s) => (s.id === subtaskId ? next : s)), updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: next.done ? 'completed' : 'reopened',
    target: taskRef(taskId),
    summary: `${next.done ? 'Completed' : 'Reopened'} subtask “${sub.title}” in “${cur.title}”`,
    projectId: cur.projectId,
    meta: { subtaskId },
  })
  return next
}

export function removeSubtask(taskId: ID, subtaskId: ID): void {
  const cur = db.get('tasks', taskId)
  const sub = cur?.subtasks.find((s) => s.id === subtaskId)
  if (!cur || !sub) return
  db.update('tasks', taskId, { subtasks: cur.subtasks.filter((s) => s.id !== subtaskId), updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'updated',
    target: taskRef(taskId),
    summary: `Removed subtask “${sub.title}” from “${cur.title}”`,
    projectId: cur.projectId,
    meta: { subtaskId },
  })
}

// ---------------------------------------------------------------- hooks

export interface TaskFilter {
  /** A project id, null for tasks without a project, or 'any' (default). */
  projectId?: ID | null | 'any'
  status?: TaskStatus | TaskStatus[]
  assigneeType?: 'user' | 'agent'
  assigneeId?: ID
}

/** Tasks matching a filter, in kanban order. */
export function useTasks(filter: TaskFilter = {}): Task[] {
  const { projectId = 'any', status, assigneeType, assigneeId } = filter
  const statuses = status === undefined ? undefined : Array.isArray(status) ? status : [status]
  return useRows(
    'tasks',
    (t) =>
      (projectId === 'any' || t.projectId === projectId) &&
      (!statuses || statuses.includes(t.status)) &&
      (!assigneeType || t.assignee?.type === assigneeType) &&
      (!assigneeId || t.assignee?.id === assigneeId),
    byOrder,
  )
}

/** Open tasks that are mine (assigned to me or unassigned), soonest due first, then by priority. */
export function useMyTasks(): Task[] {
  return useRows(
    'tasks',
    (t) => (t.assignee === null || t.assignee.type === 'user') && t.status !== 'done' && t.status !== 'cancelled',
    (a, b) =>
      (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      byOrder(a, b),
  )
}

export function useTask(id: ID | null | undefined): Task | undefined {
  return useRow('tasks', id)
}

/** A task's runs (its own runs, then coding-session turns linked to it), most recent last. */
export function useTaskRuns(task: Pick<Task, 'runIds'> | null | undefined): Run[] {
  return useRowsByIds('runs', task?.runIds)
}

/**
 * The run working on a task right now (queued, running, waiting or paused), if any — the live tape
 * on cards and rows. Selects one id, so callers re-render only when the active run changes.
 */
export function useActiveTaskRunId(task: Pick<Task, 'runIds'> | null | undefined): ID | undefined {
  const ids = task?.runIds
  return useDB((s) => {
    if (!ids) return undefined
    for (let i = ids.length - 1; i >= 0; i--) {
      const run = s.runs[ids[i]]
      if (run && isRunActive(run.status)) return run.id
    }
    return undefined
  })
}
