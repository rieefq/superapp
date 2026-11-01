import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Plus, X } from 'lucide-react'
import { Picker, PickerTrigger, ProjectPicker, type PickerOption } from '@/app/components'
import { useDB, type Tables } from '@/core/db'
import { assignTask, computeAgentLiveStatus, milestonesByDue, PRIORITY_LABEL, TASK_STATUS_LABEL, updateTask } from '@/core/services'
import { ME, type ID, type Priority, type Project, type Run, type Task, type TaskStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { Input, PriorityGlyph, TaskGlyph, toast, type PopoverTriggerProps } from '@/ui'
import { dateInputValue, dueFromDateInput, labelsIn } from '../logic'
import { ActorMark, DueText, useActorName } from '../parts'
import { moveToStatus } from '../taskActions'

/*
 * The task's properties in the drawer (Inspector › Item): quiet chip triggers on keyboard-friendly
 * pickers. Every change goes through the task service (activity is recorded).
 */

const STATUSES: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled']
const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none']

/** One property row: a 72px label column and the control (§3.5 Inspector rhythm). */
export function PropertyRow({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <div className="grid min-h-8 grid-cols-[76px_minmax(0,1fr)] items-center gap-x-3">
      <dt id={id} className="type-caption text-ink-3">
        {label}
      </dt>
      <dd className="flex min-w-0 items-center gap-1">{children}</dd>
    </div>
  )
}

/** The quiet chip trigger used by every property (28px, ink-2, hover wash). */
function chip(leading: ReactNode, text: ReactNode, placeholder = false, label?: string) {
  return (props: PopoverTriggerProps) => (
    <PickerTrigger {...props} variant="chip" leading={leading} placeholder={placeholder} aria-label={label} className="-ml-2 max-w-full">
      {text}
    </PickerTrigger>
  )
}

// ------------------------------------------------------------------------------------------------ status

export function StatusField({ task }: { task: Task }) {
  const options = useMemo<PickerOption<TaskStatus>[]>(
    () => STATUSES.map((s) => ({ value: s, label: TASK_STATUS_LABEL[s], leading: <TaskGlyph status={s} decorative /> })),
    [],
  )
  return (
    <Picker<TaskStatus>
      label="Status"
      placeholder="Set status…"
      options={options}
      value={task.status}
      width={240}
      onSelect={(s) => moveToStatus(task, s)}
      trigger={chip(<TaskGlyph status={task.status} decorative />, TASK_STATUS_LABEL[task.status], false, `Status: ${TASK_STATUS_LABEL[task.status]}. Change`)}
    />
  )
}

// ------------------------------------------------------------------------------------------------ priority

export function PriorityField({ task }: { task: Task }) {
  const options = useMemo<PickerOption<Priority>[]>(
    () => PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], leading: <PriorityGlyph priority={p} decorative /> })),
    [],
  )
  return (
    <Picker<Priority>
      label="Priority"
      placeholder="Set priority…"
      options={options}
      value={task.priority}
      width={220}
      onSelect={(p) => updateTask(task.id, { priority: p })}
      trigger={chip(<PriorityGlyph priority={task.priority} decorative />, PRIORITY_LABEL[task.priority], task.priority === 'none', `Priority: ${PRIORITY_LABEL[task.priority]}. Change`)}
    />
  )
}

// ------------------------------------------------------------------------------------------------ assignee

/**
 * You · Unassigned · agents (with their live status). Picking an agent hands off to `onPickAgent` —
 * the ReadBack confirm — because assigning an agent starts its run.
 */
export function AssigneeField({ task, onPickAgent, live }: { task: Task; onPickAgent: (agentId: ID) => void; live?: boolean }) {
  const agents = useDB(useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))))
  const statuses = useDB(
    useShallow((s: Tables) => {
      const byAgent: Record<string, Run[]> = {}
      for (const r of Object.values(s.runs)) if (r.agentId) (byAgent[r.agentId] ??= []).push(r)
      const out: Record<string, string> = {}
      for (const a of Object.values(s.agents)) out[a.id] = computeAgentLiveStatus(a, byAgent[a.id] ?? [])
      return out
    }),
  )
  const name = useActorName(task.assignee)
  const value = task.assignee === null ? '__none__' : task.assignee.type === 'user' ? '__me__' : task.assignee.id
  const options = useMemo<PickerOption[]>(
    () => [
      { value: '__me__', label: 'You', leading: <ActorMark actor={ME} size={20} />, group: 'People' },
      { value: '__none__', label: 'Unassigned', leading: <ActorMark actor={null} size={20} />, group: 'People' },
      ...agents.map((a) => ({
        value: a.id,
        label: a.name,
        description: a.status === 'paused' ? 'Paused — resume it in Agents to give it work' : `${a.role} · starts a run`,
        leading: <ActorMark actor={{ type: 'agent', id: a.id }} size={20} live={statuses[a.id] === 'working'} />,
        meta:
          statuses[a.id] === 'working' ? (
            <span className="type-meta text-ink-3">
              <span aria-hidden className="text-live">
                ●
              </span>{' '}
              Working
            </span>
          ) : undefined,
        disabled: a.status === 'paused',
        group: 'Agents',
        keywords: `${a.role} ${a.description}`,
      })),
    ],
    [agents, statuses],
  )
  const pick = (v: string) => {
    if (v === value) return
    if (v === '__me__' || v === '__none__') {
      try {
        assignTask(task.id, v === '__me__' ? ME : null)
      } catch (err) {
        toast({ tone: 'error', title: 'Couldn’t change the assignee', description: err instanceof Error ? err.message : String(err) })
      }
      return
    }
    onPickAgent(v)
  }
  return (
    <Picker
      label="Assignee"
      placeholder="Assign to…"
      options={options}
      value={value}
      width={300}
      onSelect={pick}
      trigger={chip(<ActorMark actor={task.assignee} size={16} live={live} />, name, task.assignee === null, `Assignee: ${name}. Change`)}
    />
  )
}

// ------------------------------------------------------------------------------------------------ due date

export function DueField({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false)
  const value = dateInputValue(task.dueAt)
  if (!editing) {
    return (
      <span className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={task.dueAt ? `Due ${new Date(task.dueAt).toDateString()}. Change` : 'Set a due date'}
          className="type-caption -ml-2 inline-flex h-7 items-center gap-1.5 rounded-sm px-2 font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
        >
          {task.dueAt ? <DueText dueAt={task.dueAt} done={task.status === 'done'} /> : <span className="text-ink-3">No due date</span>}
        </button>
        {task.dueAt !== undefined && (
          <button
            type="button"
            aria-label="Clear the due date"
            onClick={() => updateTask(task.id, { dueAt: undefined })}
            className="grid size-6 place-items-center rounded-xs text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
          >
            <X aria-hidden className="size-3.5" strokeWidth={1.75} />
          </button>
        )}
      </span>
    )
  }
  return (
    <Input
      type="date"
      size="sm"
      autoFocus
      aria-label="Due date"
      defaultValue={value}
      onBlur={(e) => {
        const next = dueFromDateInput(e.currentTarget.value)
        setEditing(false)
        if (next !== task.dueAt && (next !== undefined || e.currentTarget.value === '')) updateTask(task.id, { dueAt: next })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setEditing(false)
        }
      }}
      wrapperClassName="w-44"
    />
  )
}

// ------------------------------------------------------------------------------------------------ milestone

export function MilestoneField({ task, project }: { task: Task; project: Project }) {
  const milestones = milestonesByDue(project)
  const current = milestones.find((m) => m.id === task.milestoneId)
  const options = useMemo<PickerOption[]>(
    () => [
      { value: '__none__', label: 'No milestone' },
      ...milestonesByDue(project).map((m) => ({
        value: m.id,
        label: m.title,
        description: [m.dueAt ? new Date(m.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'No date', m.status === 'done' ? 'done' : undefined]
          .filter(Boolean)
          .join(' · '),
        leading: <MilestoneSquare done={m.status === 'done'} />,
      })),
    ],
    [project],
  )
  return (
    <Picker
      label="Milestones"
      placeholder="Find a milestone…"
      options={options}
      value={task.milestoneId ?? '__none__'}
      onSelect={(v) => updateTask(task.id, { milestoneId: v === '__none__' ? undefined : v })}
      trigger={chip(current ? <MilestoneSquare done={current.status === 'done'} /> : null, current?.title ?? 'No milestone', !current, `Milestone: ${current?.title ?? 'none'}. Change`)}
    />
  )
}

/** A milestone marker: a square (filled in the done color once reached). */
export function MilestoneSquare({ done, size = 10, className }: { done?: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block shrink-0 rounded-[2px]', done ? 'bg-done' : 'border-[1.5px] border-ink-2', className)}
      style={{ width: size, height: size }}
    />
  )
}

// ------------------------------------------------------------------------------------------------ labels

export function LabelsField({ task }: { task: Task }) {
  const projectTasks = useDB(useShallow((s: Tables) => (task.projectId ? Object.values(s.tasks).filter((t) => t.projectId === task.projectId) : [])))
  const known = useMemo(() => labelsIn(projectTasks), [projectTasks])
  const [query, setQuery] = useState('')
  const typed = query.trim().toLowerCase().replace(/\s+/g, '-')
  const options = useMemo<PickerOption[]>(() => {
    const list: PickerOption[] = known.filter((l) => !task.labels.includes(l)).map((l) => ({ value: l, label: l }))
    if (typed && !known.includes(typed) && !task.labels.includes(typed)) list.unshift({ value: typed, label: `Create “${typed}”` })
    return list
  }, [known, task.labels, typed])
  const remove = (label: string) => updateTask(task.id, { labels: task.labels.filter((l) => l !== label) })
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1 py-1">
      {task.labels.map((l) => (
        <span key={l} className="type-caption inline-flex h-[22px] items-center gap-0.5 rounded-sm border border-line-strong pr-0.5 pl-1.5 font-medium text-ink-2">
          {l}
          <button
            type="button"
            aria-label={`Remove label ${l}`}
            onClick={() => remove(l)}
            className="relative grid size-4 place-items-center rounded-xs text-ink-3 hover:bg-press hover:text-ink pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']"
          >
            <X aria-hidden className="size-3" strokeWidth={2} />
          </button>
        </span>
      ))}
      <Picker
        label="Labels"
        placeholder="Add or create a label…"
        options={options}
        value={null}
        width={240}
        onQueryChange={setQuery}
        emptyText={typed ? 'Already added' : 'Type to create a label'}
        onSelect={(v) => {
          updateTask(task.id, { labels: [...task.labels, v] })
          setQuery('')
        }}
        trigger={(props) => (
          <PickerTrigger {...props} variant="chip" leading={<Plus aria-hidden className="size-3" strokeWidth={2} />} placeholder aria-label="Add a label" className={cn(task.labels.length === 0 && '-ml-2')}>
            {task.labels.length ? 'Add' : 'Add a label'}
          </PickerTrigger>
        )}
      />
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ project

export function ProjectField({ task }: { task: Task }) {
  return (
    <ProjectPicker
      value={task.projectId}
      onChange={(projectId) => {
        if (projectId === task.projectId) return
        updateTask(task.id, { projectId })
        toast({ title: projectId ? 'Moved to another project' : 'Removed from its project', description: 'Its milestone was cleared.' })
      }}
      variant="chip"
      className="-ml-2 max-w-full"
      aria-label="Project. Change"
    />
  )
}
