import { memo, useMemo, type ReactNode } from 'react'
import { ListRows } from '@/app/templates'
import { PRIORITY_RANK, TASK_STATUS_LABEL } from '@/core/services'
import { refKey, type EntityRef, type ID, type Project, type Task, type TaskStatus } from '@/core/types'
import { useDB, type Tables } from '@/core/db'
import { cn } from '@/lib/cn'
import { EntityChip, PriorityGlyph, Tooltip } from '@/ui'
import { lineageIn, milestoneProgress } from './logic'
import { ActorMark, DueText, RunLine, TaskStatusGlyph, useActorName, useTaskSignal } from './parts'
import { MilestoneSquare } from './task/fields'
import { completeWithUndo } from './taskActions'

/**
 * The task list (§6.9): grouped by milestone (by due date, then "No milestone"); rows carry the task
 * glyph (quick complete), title, origin chip, live tape, priority, assignee, subtasks and the due date.
 * Columns hide right to left as the stage narrows. ↑↓ / J K move, ⏎ opens, Space inspects.
 */

const STATUS_RANK: Record<TaskStatus, number> = { review: 0, in_progress: 1, todo: 2, backlog: 3, done: 4, cancelled: 5 }
const byStatusThenPriority = (a: Task, b: Task) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.order - b.order

export function TaskList({ project, tasks, selectedId, onOpen }: { project: Project; tasks: readonly Task[]; selectedId: ID | null; onOpen: (id: ID) => void }) {
  const groups = useMemo(() => {
    const milestones = [...project.milestones].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    const known = new Set(milestones.map((m) => m.id))
    const out = milestones.map((m) => ({ key: m.id, milestone: m, tasks: tasks.filter((t) => t.milestoneId === m.id).sort(byStatusThenPriority) }))
    out.push({ key: '', milestone: undefined as never, tasks: tasks.filter((t) => !t.milestoneId || !known.has(t.milestoneId)).sort(byStatusThenPriority) })
    return out.filter((g) => g.tasks.length > 0)
  }, [project.milestones, tasks])
  const progress = useMemo(() => milestoneProgress(tasks), [tasks])

  return (
    <div className="@container mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-5 md:px-6">
      <ListRows label="Tasks" className="gap-6 py-0">
        {groups.map((g) => {
          const p = progress.get(g.key)
          return (
            <section key={g.key || 'none'} aria-label={g.milestone ? g.milestone.title : 'No milestone'}>
              <h3 className="flex h-8 items-center gap-2 border-b border-line px-1">
                {g.milestone ? <MilestoneSquare done={g.milestone.status === 'done'} size={9} /> : <span aria-hidden className="size-[9px]" />}
                <span className="type-label min-w-0 truncate text-ink-2">{g.milestone ? g.milestone.title : 'No milestone'}</span>
                {p && (
                  <span className="type-meta shrink-0 text-ink-3 tabular">
                    {p.done}/{p.total}
                  </span>
                )}
                <span className="flex-1" />
                {g.milestone?.dueAt !== undefined && <DueText dueAt={g.milestone.dueAt} done={g.milestone.status === 'done'} />}
              </h3>
              <ul className="flex flex-col pt-1">
                {g.tasks.map((t) => (
                  <TaskListRow key={t.id} task={t} selected={t.id === selectedId} onOpen={onOpen} />
                ))}
              </ul>
            </section>
          )
        })}
      </ListRows>
    </div>
  )
}

/**
 * The origin chip: where the task came from. A run is plumbing, so show what the run came from (the
 * message or report) when there is one.
 */
function useOriginChip(task: Task): EntityRef | null {
  const key = useDB((s: Tables) => {
    const o = task.origin
    if (!o) return ''
    if (o.kind !== 'run') return refKey(o)
    const chain = lineageIn(s, { kind: 'task', id: task.id })
    return refKey(chain.length ? chain[chain.length - 1] : o)
  })
  return useMemo(() => {
    if (!key) return null
    const at = key.indexOf(':')
    return { kind: key.slice(0, at) as EntityRef['kind'], id: key.slice(at + 1) }
  }, [key])
}

export const TaskListRow = memo(function TaskListRow({
  task,
  selected,
  onOpen,
  showProject,
  compact,
  onToggleDone,
}: {
  task: Task
  selected: boolean
  onOpen: (id: ID) => void
  showProject?: { name: string; mark: ReactNode }
  /** My tasks: no assignee mark (it is always you) and no origin chip. */
  compact?: boolean
  /** Replace the glyph's quick complete (My tasks keeps completed rows in place). */
  onToggleDone?: (task: Task) => void
}) {
  const signal = useTaskSignal(task)
  const assignee = useActorName(task.assignee)
  const origin = useOriginChip(task)
  const done = task.subtasks.filter((s) => s.done).length
  const closed = task.status === 'done' || task.status === 'cancelled'
  return (
    <li className={cn('group/row relative flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-sm px-1.5 transition-colors duration-(--dur-1) pointer-coarse:h-11', selected ? 'bg-accent-tint' : 'hover:bg-hover')}>
      <button
        type="button"
        data-list-row=""
        data-inspect={`task:${task.id}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onOpen(task.id)}
        aria-label={`${task.title}. ${TASK_STATUS_LABEL[task.status]}. ${assignee}${showProject ? `. ${showProject.name}` : ''}`}
        className="absolute inset-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
      />
      <Tooltip content={closed ? 'Reopen' : 'Mark done'}>
        <button
          type="button"
          tabIndex={-1}
          aria-label={closed ? `Reopen “${task.title}”` : `Mark “${task.title}” done`}
          onClick={() => (onToggleDone ? onToggleDone(task) : completeWithUndo(task))}
          className="relative z-10 -my-1 grid size-6 shrink-0 place-items-center rounded-xs transition-colors duration-(--dur-1) hover:bg-press"
        >
          <TaskStatusGlyph task={task} decorative />
        </button>
      </Tooltip>
      <span className={cn('type-body-sm pointer-events-none min-w-0 flex-1 truncate', closed ? 'text-ink-3' : selected ? 'font-medium text-ink' : 'text-ink-2 group-hover/row:text-ink')}>{task.title}</span>
      {showProject && (
        <span className="pointer-events-none hidden min-w-0 shrink items-center gap-1.5 @min-[560px]:flex" title={showProject.name}>
          {showProject.mark}
          <span className="type-caption max-w-36 truncate text-ink-3">{showProject.name}</span>
        </span>
      )}
      {origin && !compact && (
        <span className="relative z-10 hidden max-w-48 shrink-0 @min-[760px]:flex">
          <EntityChip entity={origin} size="sm" variant="subtle" />
        </span>
      )}
      {signal.activeRunId && <RunLine runId={signal.activeRunId} showText={false} className="pointer-events-none hidden shrink-0 @min-[480px]:flex" />}
      {task.labels.length > 0 && (
        <span className="type-meta pointer-events-none hidden max-w-40 shrink-0 truncate text-ink-3 @min-[960px]:inline">
          {task.labels
            .slice(0, 2)
            .map((l) => `#${l}`)
            .join(' ')}
        </span>
      )}
      <span className="pointer-events-none flex w-4 shrink-0 justify-center">{task.priority !== 'none' && <PriorityGlyph priority={task.priority} />}</span>
      <span className="pointer-events-none hidden w-10 shrink-0 text-right @min-[520px]:block">
        {task.subtasks.length > 0 && (
          <span className="type-meta text-ink-3 tabular" aria-label={`${done} of ${task.subtasks.length} subtasks done`}>
            {done}/{task.subtasks.length}
          </span>
        )}
      </span>
      {!compact && (
        <span className="pointer-events-none flex shrink-0" title={assignee}>
          <ActorMark actor={task.assignee} size={18} live={signal.live} />
        </span>
      )}
      <span className="pointer-events-none w-[88px] shrink-0 text-right">
        <DueText dueAt={task.dueAt} done={closed} />
      </span>
    </li>
  )
})
