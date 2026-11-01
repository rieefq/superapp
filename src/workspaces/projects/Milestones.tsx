import { memo, useId, useMemo, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Check, Ellipsis, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useMinuteNow } from '@/core/analytics'
import { useDB, type Tables } from '@/core/db'
import { addMilestone, removeMilestone, updateMilestone } from '@/core/services'
import type { Milestone, Project } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, confirm, Field, IconButton, Input, Menu, Popover, SegmentedControl, Textarea, TickMeter, Tooltip } from '@/ui'
import { dateInputValue, dueFromDateInput, milestoneProgress, rulerLayout, type MilestoneProgress } from './logic'
import { DueText, QuietLine, SectionLabel } from './parts'
import { MilestoneSquare } from './task/fields'

/**
 * Milestones on the Overview (§6.9): the ruler — a tick scale with square milestone markers at their
 * due dates and an ink "today" hairline — and the milestone list beneath it. Clicking a milestone
 * filters Tasks to it.
 */
export function MilestonesBlock({ project }: { project: Project }) {
  const navigate = useNavigate()
  const now = useMinuteNow()
  const taskList = useDB(useShallow((s: Tables) => Object.values(s.tasks).filter((t) => t.projectId === project.id)))
  const progress = useMemo(() => milestoneProgress(taskList), [taskList])
  const ruler = useMemo(() => rulerLayout(project.milestones, now), [project.milestones, now])
  const sorted = useMemo(() => [...project.milestones].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)), [project.milestones])
  const next = sorted.find((m) => m.status !== 'done')
  const done = sorted.filter((m) => m.status === 'done').length
  const filter = (m: Milestone) => navigate(`/projects/${encodeURIComponent(project.id)}/tasks?milestone=${encodeURIComponent(m.id)}`)

  return (
    <section aria-labelledby="project-milestones">
      <SectionLabel
        id="project-milestones"
        title="Milestones"
        count={sorted.length}
        action={
          <>
            {sorted.length > 0 && (
              <span className="type-meta text-ink-3 tabular">
                {done} of {sorted.length} reached
              </span>
            )}
            <MilestoneEditor project={project} />
          </>
        }
      />
      {sorted.length === 0 ? (
        <QuietLine>No milestones yet. Add one to see the project on a ruler and group its tasks.</QuietLine>
      ) : (
        <div className="flex flex-col gap-3">
          {ruler && ruler.marks.length > 0 && <Ruler layout={ruler} next={next} progress={progress} onPick={filter} />}
          <ul className="-mx-2 flex flex-col" aria-label="Milestones">
            {sorted.map((m) => (
              <MilestoneRow key={m.id} project={project} milestone={m} isNext={m.id === next?.id} progress={progress.get(m.id)} onPick={() => filter(m)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ ruler

function Ruler({
  layout,
  next,
  progress,
  onPick,
}: {
  layout: NonNullable<ReturnType<typeof rulerLayout>>
  next: Milestone | undefined
  progress: Map<string, MilestoneProgress>
  onPick: (m: Milestone) => void
}) {
  const { axis, marks } = layout
  const pct = (x: number) => `${(x * 100).toFixed(3)}%`
  // Labels near the edges would overflow; the today label hides when it would collide with a tick label.
  const ticks = axis.ticks.filter((t) => t.x > 0.04 && t.x < 0.96 && Math.abs(t.x - axis.today) > 0.05)
  return (
    <div role="group" aria-label="Milestone ruler" className="relative mx-1.5 h-[60px] select-none">
      {/* today */}
      <div aria-hidden className="absolute top-0 bottom-3 w-px bg-ink" style={{ left: pct(axis.today) }}>
        <span className="type-meta-caps absolute -top-0.5 left-1.5 text-[10px] whitespace-nowrap text-ink">Today</span>
      </div>
      {/* baseline and ticks */}
      <div aria-hidden className="absolute inset-x-0 top-[30px] h-px bg-line-strong" />
      {axis.ticks.map((t) => (
        <div key={t.at} aria-hidden className="absolute top-[27px] h-[7px] w-px bg-line-strong" style={{ left: pct(t.x) }} />
      ))}
      {ticks.map((t) => (
        <span key={`l${t.at}`} aria-hidden className="type-meta absolute top-[40px] -translate-x-1/2 whitespace-nowrap text-ink-3" style={{ left: pct(t.x) }}>
          {t.label}
        </span>
      ))}
      {/* markers */}
      {marks.map(({ milestone: m, x }) => {
        const p = progress.get(m.id)
        const isNext = m.id === next?.id
        const due = m.dueAt ? new Date(m.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'no date'
        const label = `${m.title}, due ${due}${m.status === 'done' ? ', reached' : isNext ? ', next' : ''}${p ? `, ${p.done} of ${p.total} tasks done` : ''}. Show its tasks`
        return (
          <Tooltip key={m.id} content={`${m.title} · ${due}${p ? ` · ${p.done}/${p.total} tasks` : ''}`}>
            <button
              type="button"
              aria-label={label}
              onClick={() => onPick(m)}
              className="group/mark absolute top-[30px] grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-xs focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
              style={{ left: pct(x) }}
            >
              <span
                className={cn(
                  'block rounded-[2px] bg-canvas transition-transform duration-(--dur-1) group-hover/mark:scale-125',
                  m.status === 'done' ? 'size-2.5 bg-done' : isNext ? 'size-3 border-2 border-ink' : 'size-2.5 border-[1.5px] border-ink-2',
                )}
              />
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ rows

const MilestoneRow = memo(function MilestoneRow({
  project,
  milestone: m,
  isNext,
  progress,
  onPick,
}: {
  project: Project
  milestone: Milestone
  isNext: boolean
  progress?: MilestoneProgress
  onPick: () => void
}) {
  const done = m.status === 'done'
  const reveal = 'opacity-0 group-hover/ms:opacity-100 group-focus-within/ms:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100'
  const remove = async () => {
    const ok = await confirm({
      title: `Remove “${m.title}”?`,
      description: progress?.total ? `Its ${progress.total} task${progress.total === 1 ? '' : 's'} stay in the project without a milestone.` : 'No tasks belong to it.',
      confirmLabel: 'Remove milestone',
      tone: 'danger',
    })
    if (ok) removeMilestone(project.id, m.id)
  }
  return (
    <li className="group/ms relative flex h-11 items-center gap-3 rounded-sm px-2 transition-colors duration-(--dur-1) hover:bg-hover">
      <button
        type="button"
        onClick={onPick}
        aria-label={`${m.title}: show its tasks`}
        className="absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
      />
      <MilestoneSquare done={done} className={cn('pointer-events-none', isNext && !done && 'border-ink')} />
      <span className="pointer-events-none flex min-w-0 flex-1 items-center gap-2">
        <span className={cn('type-body-sm truncate', done ? 'text-ink-3' : isNext ? 'font-medium text-ink' : 'text-ink-2')}>{m.title}</span>
        {isNext && <span className="type-meta-caps shrink-0 text-[10px] text-ink-3">Next</span>}
      </span>
      {progress && progress.total > 0 && (
        <span className="pointer-events-none hidden shrink-0 items-center gap-2 sm:flex">
          <TickMeter value={progress.done} max={progress.total} width={64} label={`${m.title} tasks`} valueText={`${progress.done} of ${progress.total} tasks done`} thresholds={{ attn: 2, fail: 3 }} />
          <span className="type-meta w-9 text-ink-3 tabular">
            {progress.done}/{progress.total}
          </span>
        </span>
      )}
      <span className="pointer-events-none w-24 shrink-0 text-right">
        {m.dueAt !== undefined ? <DueText dueAt={m.dueAt} done={done} /> : <span className="type-meta text-ink-3">No date</span>}
      </span>
      <span className="relative z-10 flex shrink-0">
        <MilestoneEditor project={project} milestone={m} trigger={<IconButton icon={Pencil} size="sm" label={`Edit ${m.title}`} className={reveal} />} />
        <Menu
          aria-label={`${m.title} actions`}
          placement="bottom-end"
          items={[
            done
              ? { id: 'reopen', label: 'Reopen', icon: RotateCcw, onSelect: () => updateMilestone(project.id, m.id, { status: 'active' }) }
              : { id: 'done', label: 'Mark reached', icon: Check, onSelect: () => updateMilestone(project.id, m.id, { status: 'done' }) },
            { type: 'separator' },
            { id: 'remove', label: 'Remove…', icon: Trash2, danger: true, onSelect: () => void remove() },
          ]}
          trigger={<IconButton icon={Ellipsis} size="sm" label={`More actions for ${m.title}`} className={reveal} />}
        />
      </span>
    </li>
  )
})

// ------------------------------------------------------------------------------------------------ editor

/** Add (no `milestone`) or edit a milestone in a popover: title, due date, status and a note. */
function MilestoneEditor({ project, milestone, trigger }: { project: Project; milestone?: Milestone; trigger?: ReactElement }) {
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [status, setStatus] = useState<Milestone['status']>('upcoming')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const formId = useId()
  const reset = () => {
    setTitle(milestone?.title ?? '')
    setDue(dateInputValue(milestone?.dueAt))
    setStatus(milestone?.status ?? 'upcoming')
    setDescription(milestone?.description ?? '')
    setError(null)
  }
  const save = (close: () => void) => {
    if (!title.trim()) {
      setError('Give the milestone a title.')
      return
    }
    const input = { title: title.trim(), dueAt: dueFromDateInput(due), status, description: description.trim() || undefined }
    if (milestone) updateMilestone(project.id, milestone.id, input)
    else addMilestone(project.id, input)
    close()
  }
  return (
    <Popover
      onOpenChange={(o) => {
        if (o) reset()
      }}
      placement="bottom-end"
      aria-label={milestone ? `Edit ${milestone.title}` : 'Add a milestone'}
      className="w-[min(340px,calc(100vw-16px))] p-4"
      trigger={
        trigger ?? (
          <Button size="xs" variant="ghost" leadingIcon={Plus}>
            Add milestone
          </Button>
        )
      }
    >
      {({ close }) => (
        <form
          id={formId}
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save(close)
          }}
        >
          <Field label="Title" error={error ?? undefined}>
            <Input value={title} onValueChange={setTitle} autoFocus placeholder="Public launch" autoComplete="off" />
          </Field>
          <Field label="Due" optional>
            <Input type="date" value={due} onValueChange={setDue} />
          </Field>
          <Field label="Status">
            <SegmentedControl
              size="sm"
              fullWidth
              value={status}
              onValueChange={setStatus}
              options={[
                { value: 'upcoming', label: 'Upcoming' },
                { value: 'active', label: 'Active' },
                { value: 'done', label: 'Reached' },
              ]}
            />
          </Field>
          <Field label="Note" optional>
            <Textarea value={description} onValueChange={setDescription} autosize minRows={2} maxRows={5} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" type="submit">
              {milestone ? 'Save' : 'Add milestone'}
            </Button>
          </div>
        </form>
      )}
    </Popover>
  )
}
