import { announce } from '@/app/shell/Announcer'
import { openStartSheet } from '@/app/shell/store'
import { createThread } from '@/core/ai'
import { db } from '@/core/db'
import { getSettings } from '@/core/settings'
import { deleteTask, markDerived, moveTask, TASK_STATUS_LABEL, updateTask } from '@/core/services'
import { ME, type EntityRef, type Task, type TaskStatus } from '@/core/types'
import { confirm, toast } from '@/ui'

/*
 * Task actions shared by the board, the list, My tasks and the task drawer. Writes go through the
 * task service (activity, links and notifications stay consistent); the UI adds Undo and announcements.
 */

const taskRef = (id: string): EntityRef => ({ kind: 'task', id })

/** Quick complete with an 8-second Undo (it restores the previous status). */
export function completeWithUndo(task: Pick<Task, 'id' | 'title' | 'status'>): void {
  const previous = task.status
  if (previous === 'done') {
    updateTask(task.id, { status: 'todo' })
    toast({ title: `Reopened “${task.title}”` })
    return
  }
  updateTask(task.id, { status: 'done' })
  announce(`Marked “${task.title}” done`)
  toast({
    title: `Done: “${task.title}”`,
    duration: 8000,
    action: { label: 'Undo', onClick: () => updateTask(task.id, { status: previous }) },
  })
}

/** Move to a column (the "Move to…" menu, the keyboard alternative to dragging). */
export function moveToStatus(task: Pick<Task, 'id' | 'title' | 'status'>, status: TaskStatus, beforeId?: string | null): void {
  if (task.status === status && beforeId === undefined) return
  moveTask(task.id, status, beforeId)
  announce(`Moved “${task.title}” to ${TASK_STATUS_LABEL[status]}`)
}

/** Delete with a plain confirm (when Settings › Safety › confirm destructive actions is on). */
export async function deleteWithConfirm(task: Pick<Task, 'id' | 'title' | 'subtasks'>): Promise<boolean> {
  if (getSettings().safety.confirmDestructive) {
    const subtasks = task.subtasks.length
    const ok = await confirm({
      title: 'Delete this task?',
      description: `“${task.title}”${subtasks ? ` and its ${subtasks} subtask${subtasks === 1 ? '' : 's'}` : ''} will be deleted. Runs it started and the project history are kept.`,
      confirmLabel: 'Delete task',
      tone: 'danger',
    })
    if (!ok) return false
  }
  deleteTask(task.id)
  toast({ title: `Deleted “${task.title}”` })
  return true
}

/** Discuss: a new conversation in the task's project with the task attached (Turn into's lighter sibling). */
export function discussTask(task: Pick<Task, 'id' | 'title' | 'projectId'>, navigate: (to: string) => void, opts: { title?: string } = {}): void {
  try {
    const thread = createThread({ projectId: task.projectId, title: opts.title ?? `Discuss: ${task.title}`, contextRefs: [taskRef(task.id)] })
    markDerived({ kind: 'thread', id: thread.id }, taskRef(task.id))
    navigate(`/chat/${encodeURIComponent(thread.id)}`)
  } catch (err) {
    toast({ tone: 'error', title: 'Couldn’t start the conversation', description: err instanceof Error ? err.message : String(err) })
  }
}

/**
 * Start your own task (§6.9): a coding session when the project has a repository (through the Start
 * sheet, so the session links back to the task), otherwise a conversation with the task attached.
 * An open task moves to In progress and is assigned to you when nobody has it.
 */
export function startTask(task: Task, navigate: (to: string) => void): void {
  const project = task.projectId ? db.get('projects', task.projectId) : undefined
  const repoId = project?.repoIds.find((id) => db.get('repos', id))
  if (repoId) {
    openStartSheet('session', {
      source: taskRef(task.id),
      prefill: { repoId, taskId: task.id, projectId: task.projectId, title: task.title, brief: task.description ? `${task.title}\n\n${task.description}` : task.title },
    })
    return
  }
  if (task.status === 'backlog' || task.status === 'todo') updateTask(task.id, { status: 'in_progress', ...(task.assignee ? {} : { assignee: ME }) })
  discussTask(task, navigate, { title: task.title })
}

/** Research from a task: the Start sheet with the task as the source. */
export function researchTask(task: Pick<Task, 'id'>): void {
  openStartSheet('research', { source: taskRef(task.id) })
}
