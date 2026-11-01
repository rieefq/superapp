import { memo, useMemo, type ReactNode } from 'react'
import { useMinuteNow } from '@/core/analytics'
import { TASK_STATUS_LABEL } from '@/core/services'
import type { ID, Milestone, Project, Task } from '@/core/types'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/ui'
import { axisX, timelineLayout, type TimeAxis } from './logic'
import { DueText, QuietLine, TaskStatusGlyph } from './parts'
import { MilestoneSquare } from './task/fields'

/**
 * Timeline (Tasks › Timeline): milestones and dated tasks on one time axis, grouped by milestone.
 * Each task sits at its due date; the ink hairline is today. Rows open the task in the Inspector.
 */
export function Timeline({ project, tasks, selectedId, onOpen }: { project: Project; tasks: readonly Task[]; selectedId: ID | null; onOpen: (id: ID) => void }) {
  const now = useMinuteNow()
  const layout = useMemo(() => timelineLayout(project, tasks, now), [project, tasks, now])
  const { axis } = layout
  const empty = layout.groups.every((g) => g.tasks.length === 0) && !project.milestones.some((m) => m.dueAt !== undefined)
  return (
    <div className="@container mx-auto flex w-full max-w-[1280px] flex-col px-4 py-5 md:px-6">
      {empty ? (
        <QuietLine>Nothing here has a date yet. Give tasks a due date, or add dated milestones, to see them on the timeline.</QuietLine>
      ) : (
        <div role="table" aria-label="Timeline" className="flex flex-col">
          <div role="row" className="sticky top-0 z-(--z-sticky) grid grid-cols-[minmax(120px,240px)_minmax(0,1fr)] border-b border-line bg-canvas">
            <span role="columnheader" className="type-label flex h-8 items-center text-ink-3">
              Task
            </span>
            <span role="columnheader" aria-label="Dates" className="relative h-8">
              <AxisLabels axis={axis} />
            </span>
          </div>
          {layout.groups.map((g) => (
            <div key={g.milestone?.id ?? 'none'} role="rowgroup" aria-label={g.milestone?.title ?? 'No milestone'}>
              <GroupRow milestone={g.milestone} axis={axis} count={g.tasks.length} />
              {g.tasks.map((t) => (
                <TaskRow key={t.id} task={t} axis={axis} milestone={g.milestone} selected={t.id === selectedId} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      )}
      {layout.undated > 0 && (
        <p className="type-caption mt-4 text-ink-3">
          {layout.undated} open {layout.undated === 1 ? 'task has' : 'tasks have'} no due date and {layout.undated === 1 ? 'is' : 'are'} not on the timeline. The List view shows every task.
        </p>
      )}
    </div>
  )
}

const pct = (x: number) => `${(x * 100).toFixed(3)}%`

function AxisLabels({ axis }: { axis: TimeAxis }) {
  return (
    <>
      {axis.ticks.map((t, i) => (
        <span
          key={t.at}
          aria-hidden
          className={cn(
            'type-meta absolute top-2 -translate-x-1/2 whitespace-nowrap text-ink-3',
            (t.x < 0.03 || t.x > 0.97 || Math.abs(t.x - axis.today) < 0.06) && 'hidden',
            i % 2 === 1 && '@max-[640px]:hidden',
          )}
          style={{ left: pct(t.x) }}
        >
          {t.label}
        </span>
      ))}
      <span aria-hidden className="type-meta-caps absolute top-2 ml-1.5 text-[10px] whitespace-nowrap text-ink" style={{ left: pct(axis.today) }}>
        Today
      </span>
    </>
  )
}

/** Gridlines in every axis cell: week ticks, the milestone's line and today's ink hairline. */
function AxisCell({ axis, milestone, children }: { axis: TimeAxis; milestone?: Milestone | null; children?: ReactNode }) {
  return (
    <span className="relative block h-full">
      {axis.ticks.map((t) => (
        <span key={t.at} aria-hidden className="absolute inset-y-0 w-px bg-line" style={{ left: pct(t.x) }} />
      ))}
      {milestone?.dueAt !== undefined && <span aria-hidden className="absolute inset-y-0 w-px bg-line-strong" style={{ left: pct(axisX(axis, milestone.dueAt)) }} />}
      <span aria-hidden className="absolute inset-y-0 w-px bg-ink" style={{ left: pct(axis.today) }} />
      {children}
    </span>
  )
}

function GroupRow({ milestone, axis, count }: { milestone: Milestone | null; axis: TimeAxis; count: number }) {
  return (
    <div role="row" className="grid h-9 grid-cols-[minmax(120px,240px)_minmax(0,1fr)] border-b border-line">
      <span role="rowheader" className="flex min-w-0 items-center gap-2 pr-3">
        {milestone ? <MilestoneSquare done={milestone.status === 'done'} size={9} /> : <span aria-hidden className="size-[9px]" />}
        <span className="type-label min-w-0 truncate text-ink-2">{milestone?.title ?? 'No milestone'}</span>
        <span className="type-meta shrink-0 text-ink-3">{count}</span>
      </span>
      <span role="cell" className="relative">
        <AxisCell axis={axis} milestone={milestone}>
          {milestone?.dueAt !== undefined && (
            <Tooltip content={`${milestone.title} · ${new Date(milestone.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}>
              <span
                tabIndex={0}
                aria-label={`${milestone.title}, due ${new Date(milestone.dueAt).toLocaleDateString()}`}
                className="absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xs focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
                style={{ left: pct(axisX(axis, milestone.dueAt)) }}
              >
                <MilestoneSquare done={milestone.status === 'done'} size={11} className={cn(milestone.status !== 'done' && 'border-2 border-ink bg-canvas')} />
              </span>
            </Tooltip>
          )}
        </AxisCell>
      </span>
    </div>
  )
}

const TaskRow = memo(function TaskRow({
  task,
  axis,
  milestone,
  selected,
  onOpen,
}: {
  task: Task
  axis: TimeAxis
  milestone: Milestone | null
  selected: boolean
  onOpen: (id: ID) => void
}) {
  const x = task.dueAt !== undefined ? axisX(axis, task.dueAt) : 0
  const right = x > 0.78
  const closed = task.status === 'done' || task.status === 'cancelled'
  return (
    <div role="row" className={cn('group/tl relative grid h-9 grid-cols-[minmax(120px,240px)_minmax(0,1fr)]', selected ? 'bg-accent-tint' : 'hover:bg-hover')}>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        aria-label={`${task.title}. ${TASK_STATUS_LABEL[task.status]}${task.dueAt ? `, due ${new Date(task.dueAt).toLocaleDateString()}` : ''}`}
        className="absolute inset-0 z-10 rounded-xs outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
      />
      <span role="rowheader" className="flex min-w-0 items-center gap-2 pr-3 pl-3">
        <TaskStatusGlyph task={task} decorative />
        <span className={cn('type-body-sm min-w-0 truncate', closed ? 'text-ink-3' : 'text-ink-2 group-hover/tl:text-ink')}>{task.title}</span>
      </span>
      <span role="cell" className="relative">
        <AxisCell axis={axis} milestone={milestone}>
          {task.dueAt !== undefined && (
            <span className="absolute top-1/2 flex -translate-y-1/2 items-center gap-1.5" style={right ? { right: `calc(${pct(1 - x)} - 6px)`, flexDirection: 'row-reverse' } : { left: `calc(${pct(x)} - 6px)` }}>
              <span className="grid size-3 place-items-center rounded-[3px] bg-canvas">
                <TaskStatusGlyph task={task} decorative />
              </span>
              <DueText dueAt={task.dueAt} done={closed} className="rounded-xs bg-canvas/80 px-0.5" />
            </span>
          )}
        </AxisCell>
      </span>
    </div>
  )
})
