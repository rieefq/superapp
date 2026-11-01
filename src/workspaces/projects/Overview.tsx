import { memo, useState, type DragEvent, type ReactNode, type Ref } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpRight, Check, Plus } from 'lucide-react'
import { EntityPicker, ESTIMATE_TOOLTIP, formatTokenCount } from '@/app/components'
import { attachRun, openStartSheet } from '@/app/shell/store'
import { readDraggedEntity, ENTITY_DRAG_TYPE } from '@/app/shell/scope'
import { useMinuteNow } from '@/core/analytics'
import { useDB, useRow, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import {
  actorName,
  approveTaskReview,
  assignTask,
  computeProjectMembers,
  computeProjectNeedsYou,
  entityRoute,
  pinToProject,
  PRIORITY_RANK,
  unpinFromProject,
  updateTask,
  useProjectActivity,
  useProjectSpend,
  useProjectStats,
} from '@/core/services'
import { ME, isRunActive, refKey, type ActorRef, type EntityRef, type ID, type Project } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatUsd, timeAgo } from '@/lib/format'
import { ApprovalCardConnected, Button, EntityChip, RunRow, SimBadge, TickMeter, toast, Tooltip } from '@/ui'
import { AssignDialog } from './AssignDialog'
import { dueBucket } from './logic'
import { useMemoryBreakdown } from './memory'
import { MilestonesBlock } from './Milestones'
import { ActorMark, DueText, QuietLine, SectionAction, SectionLabel, TaskStatusGlyph, useActorName, useIdList, useOpenTask } from './parts'

/**
 * Overview (§6.9): the goal, progress, the milestone ruler, then Needs you · In flight · Next up on
 * the left and Members (drop targets) · Numbers · Memory · Recent activity on the right.
 */
export default function Overview({ project }: { project: Project }) {
  const [assign, setAssign] = useState<{ taskId: ID | null; agentId: ID | null; open: boolean }>({ taskId: null, agentId: null, open: false })
  return (
    <div className="@container flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <Goal project={project} />
        <Progress project={project} />
      </div>
      <MilestonesBlock project={project} />
      <div className="grid gap-x-8 gap-y-10 @min-[880px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-10">
          <NeedsYou project={project} />
          <InFlight project={project} />
          <NextUp project={project} />
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          <Members project={project} onAssignAgent={(taskId, agentId) => setAssign({ taskId, agentId, open: true })} />
          <Numbers project={project} />
          <MemoryBlock project={project} />
          <RecentActivity project={project} />
        </div>
      </div>
      <AssignDialog taskId={assign.taskId} agentId={assign.agentId} open={assign.open} onOpenChange={(open) => setAssign((a) => ({ ...a, open }))} />
    </div>
  )
}

const base = (p: Pick<Project, 'id'>) => `/projects/${encodeURIComponent(p.id)}`

// ------------------------------------------------------------------------------------------------ goal & progress

function Goal({ project }: { project: Project }) {
  const navigate = useNavigate()
  return (
    <section aria-labelledby="project-goal" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h2 id="project-goal" className="type-label text-ink-3">
          Goal
        </h2>
        <span className="flex-1" />
        <SectionAction onClick={() => navigate(`${base(project)}/memory`)}>{project.goal ? 'Edit' : 'Add a goal'}</SectionAction>
      </div>
      {project.goal ? (
        <p className="type-body-lg max-w-[68ch] text-pretty text-ink">{project.goal}</p>
      ) : (
        <p className="type-body-lg text-ink-3">No goal yet. Every AI action in this project sees the goal — say what done looks like.</p>
      )}
    </section>
  )
}

function Progress({ project }: { project: Project }) {
  const stats = useProjectStats(project.id)
  const { total, done, inProgress, review, overdue } = stats.tasks
  const parts = [inProgress ? `${inProgress} in progress` : null, review ? `${review} in review` : null, overdue ? `${overdue} overdue` : null].filter(Boolean)
  return (
    <section aria-label="Progress" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="type-body-sm text-ink-2">
        <span className="font-medium text-ink tabular">{done}</span> of <span className="tabular">{total}</span> tasks done
      </span>
      <TickMeter value={done} max={Math.max(1, total)} width={180} label="Project progress" valueText={`${done} of ${total} tasks done`} thresholds={{ attn: 2, fail: 3 }} />
      {parts.length > 0 && <span className="type-meta text-ink-3">{parts.join(' · ')}</span>}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ needs you

function NeedsYou({ project }: { project: Project }) {
  const ids = useIdList((s) => {
    const n = computeProjectNeedsYou(s, project.id)
    return [...n.approvals.map((a) => `a:${a.id}`), ...n.sessions.map((x) => `s:${x.id}`), ...n.tasks.map((t) => `t:${t.id}`)]
  })
  return (
    <section aria-labelledby="project-needs-you">
      <SectionLabel id="project-needs-you" title="Needs you" count={ids.length} />
      {ids.length === 0 ? (
        <QuietLine>Nothing needs you here.</QuietLine>
      ) : (
        <div className="flex flex-col gap-2">
          {ids
            .filter((k) => k.startsWith('a:'))
            .slice(0, 5)
            .map((k) => (
              <ApprovalCardConnected key={k} approvalId={k.slice(2)} variant="compact" />
            ))}
          <ul className="-mx-2 flex flex-col">
            {ids
              .filter((k) => !k.startsWith('a:'))
              .map((k) => (k.startsWith('s:') ? <SessionReview key={k} sessionId={k.slice(2)} /> : <TaskReview key={k} taskId={k.slice(2)} />))}
          </ul>
        </div>
      )}
    </section>
  )
}

function SessionReview({ sessionId }: { sessionId: ID }) {
  const navigate = useNavigate()
  const ses = useRow('sessions', sessionId)
  const agent = useRow('agents', ses?.agentId)
  if (!ses) return null
  const add = ses.changes.reduce((n, c) => n + c.additions, 0)
  const del = ses.changes.reduce((n, c) => n + c.deletions, 0)
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`${entityRoute({ kind: 'session', id: ses.id })}/changes`)}
        className="group/review flex min-h-11 w-full min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <span aria-hidden className="grid size-3 shrink-0 place-items-center text-[10px] leading-none text-attn">
          ◆
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-body-sm truncate text-ink">
            Review changes: <span className="font-medium">{ses.title}</span>
          </span>
          <span className="type-meta truncate text-ink-3">{[agent?.name, `${ses.changes.length} files`, `+${add} −${del}`, `waiting ${timeAgo(ses.updatedAt).replace(' ago', '')}`].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="type-caption shrink-0 font-medium text-ink-2 group-hover/review:text-ink">Review</span>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
      </button>
    </li>
  )
}

function TaskReview({ taskId }: { taskId: ID }) {
  const openTask = useOpenTask()
  const task = useRow('tasks', taskId)
  const lastRun = useRow('runs', task?.runIds[task.runIds.length - 1])
  const agent = useRow('agents', lastRun?.agentId)
  if (!task) return null
  const approve = () => {
    approveTaskReview(task.id)
    toast({ tone: 'success', title: `Approved — “${task.title}” is done`, duration: 8000, action: { label: 'Undo', onClick: () => updateTask(task.id, { status: 'review' }) } })
  }
  return (
    <li className="group/review relative flex min-h-11 items-center gap-3 rounded-sm px-2 py-1.5 transition-colors duration-(--dur-1) hover:bg-hover">
      <button
        type="button"
        onClick={() => openTask(task.id)}
        aria-label={`Review “${task.title}”`}
        className="absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
      />
      <span aria-hidden className="pointer-events-none grid size-3 shrink-0 place-items-center text-[10px] leading-none text-attn">
        ◆
      </span>
      <span className="pointer-events-none flex min-w-0 flex-1 flex-col">
        <span className="type-body-sm truncate text-ink">
          Review: <span className="font-medium">{task.title}</span>
        </span>
        <span className="type-meta truncate text-ink-3">{[agent ? `by ${agent.name}` : undefined, `waiting ${timeAgo(task.updatedAt).replace(' ago', '')}`].filter(Boolean).join(' · ')}</span>
      </span>
      <Button size="xs" variant="secondary" leadingIcon={Check} onClick={approve} className="relative z-10">
        Approve
      </Button>
    </li>
  )
}

// ------------------------------------------------------------------------------------------------ in flight

function InFlight({ project }: { project: Project }) {
  const navigate = useNavigate()
  const ids = useIdList((s) =>
    Object.values(s.runs)
      .filter((r) => r.projectId === project.id && isRunActive(r.status))
      .sort((a, b) => Number(b.status === 'waiting') - Number(a.status === 'waiting') || b.createdAt - a.createdAt)
      .map((r) => r.id),
  )
  return (
    <section aria-labelledby="project-in-flight">
      <SectionLabel
        id="project-in-flight"
        title="In flight"
        count={ids.length}
        action={ids.length > 0 ? <SectionAction onClick={() => navigate('/agents')}>All runs</SectionAction> : undefined}
      />
      {ids.length === 0 ? (
        <QuietLine>Nothing in flight in this project.</QuietLine>
      ) : (
        <div className="-mx-2 flex flex-col">
          {ids.map((id) => (
            <InFlightRow key={id} runId={id} />
          ))}
        </div>
      )}
    </section>
  )
}

const InFlightRow = memo(function InFlightRow({ runId }: { runId: ID }) {
  const navigate = useNavigate()
  const run = useRow('runs', runId)
  const agent = useRow('agents', run?.agentId)
  if (!run) return null
  const attach = () => attachRun(run.id, 'projects')
  return (
    <RunRow
      run={run}
      agent={agent ? { name: agent.name, hue: agent.hue, sigil: agent.sigil } : undefined}
      onSelect={attach}
      onAttach={attach}
      onPause={() => runEngine.pause(run.id)}
      onResume={() => runEngine.resume(run.id)}
      onStop={() => runEngine.cancel(run.id, 'Stopped by you')}
      onOpen={() => navigate(entityRoute({ kind: 'run', id: run.id }))}
    />
  )
})

// ------------------------------------------------------------------------------------------------ next up

const NEXT_UP = 5

function NextUp({ project }: { project: Project }) {
  const ids = useIdList((s) =>
    Object.values(s.tasks)
      .filter((t) => t.projectId === project.id && t.status !== 'done' && t.status !== 'cancelled')
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.order - b.order)
      .slice(0, NEXT_UP)
      .map((t) => t.id),
  )
  const total = useDB((s: Tables) => {
    let n = 0
    for (const t of Object.values(s.tasks)) if (t.projectId === project.id) n++
    return n
  })
  const navigate = useNavigate()
  return (
    <section aria-labelledby="project-next-up">
      <SectionLabel
        id="project-next-up"
        title="Next up"
        action={total > 0 ? <SectionAction onClick={() => navigate(`${base(project)}/tasks`)}>All tasks</SectionAction> : undefined}
      />
      {total === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-md border border-line px-4 py-4">
          <p className="type-title-3 text-ink">Break the goal into tasks</p>
          <p className="type-body-sm text-ink-2">Tasks can be yours or an agent’s. Assign one to an agent and it starts right away.</p>
          <Button size="sm" variant="primary" leadingIcon={Plus} onClick={() => openStartSheet('task', { prefill: { projectId: project.id } })}>
            New task
          </Button>
        </div>
      ) : ids.length === 0 ? (
        <QuietLine>Every task is done.</QuietLine>
      ) : (
        <>
          <ul className="-mx-2 flex flex-col">
            {ids.map((id) => (
              <NextUpRow key={id} taskId={id} />
            ))}
          </ul>
          <p className="type-caption mt-2 text-ink-3 pointer-coarse:hidden">Drag a task onto a member to assign it.</p>
        </>
      )}
    </section>
  )
}

const NextUpRow = memo(function NextUpRow({ taskId }: { taskId: ID }) {
  const openTask = useOpenTask()
  const task = useRow('tasks', taskId)
  const assignee = useActorName(task?.assignee)
  if (!task) return null
  const onDragStart = (e: DragEvent<HTMLLIElement>) => {
    e.dataTransfer.setData(ENTITY_DRAG_TYPE, JSON.stringify({ kind: 'task', id: task.id }))
    e.dataTransfer.setData('text/plain', task.title)
    e.dataTransfer.effectAllowed = 'copyLink'
  }
  return (
    <li draggable onDragStart={onDragStart} className="group/next relative flex h-10 items-center gap-2.5 rounded-sm px-2 transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11">
      <button
        type="button"
        onClick={() => openTask(task.id)}
        aria-label={`${task.title}, ${assignee}${task.dueAt ? '' : ', no due date'}`}
        className="absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
      />
      <span className="pointer-events-none flex shrink-0">
        <TaskStatusGlyph task={task} />
      </span>
      <span className="type-body-sm pointer-events-none min-w-0 flex-1 truncate text-ink-2 group-hover/next:text-ink">{task.title}</span>
      <span className="pointer-events-none flex shrink-0" title={assignee}>
        <ActorMark actor={task.assignee} size={16} />
      </span>
      <span className="pointer-events-none w-24 shrink-0 text-right">
        {task.dueAt !== undefined ? <DueText dueAt={task.dueAt} /> : <span className="type-meta text-ink-3">No date</span>}
      </span>
    </li>
  )
})

// ------------------------------------------------------------------------------------------------ members

function Members({ project, onAssignAgent }: { project: Project; onAssignAgent: (taskId: ID, agentId: ID) => void }) {
  const keys = useIdList((s) => computeProjectMembers(s, project.id).map((m) => `${m.actor.type}:${m.actor.id}:${m.openTasks}:${m.activeRuns}`))
  return (
    <section aria-labelledby="project-members">
      <SectionLabel id="project-members" title="Members" count={keys.length} />
      <ul className="-mx-2 flex flex-col gap-0.5">
        {keys.map((k) => {
          const [type, id, open, active] = k.split(':')
          const actor: ActorRef = type === 'agent' ? { type: 'agent', id } : ME
          return <MemberRow key={`${type}:${id}`} project={project} actor={actor} openTasks={Number(open)} activeRuns={Number(active)} onAssignAgent={onAssignAgent} />
        })}
      </ul>
      <p className="type-caption mt-2 text-ink-3">Members are you and the agents with work here.</p>
    </section>
  )
}

function MemberRow({
  project,
  actor,
  openTasks,
  activeRuns,
  onAssignAgent,
}: {
  project: Project
  actor: ActorRef
  openTasks: number
  activeRuns: number
  onAssignAgent: (taskId: ID, agentId: ID) => void
}) {
  const navigate = useNavigate()
  const agent = useRow('agents', actor.type === 'agent' ? actor.id : null)
  const [over, setOver] = useState(false)
  const name = actor.type === 'user' ? 'You' : (agent?.name ?? 'Agent')
  const role = actor.type === 'user' ? actorName(ME) : (agent?.role ?? '')
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(ENTITY_DRAG_TYPE)
  const onDrop = (e: DragEvent) => {
    setOver(false)
    const ref = readDraggedEntity(e.dataTransfer)
    if (!ref || ref.kind !== 'task') return
    e.preventDefault()
    if (actor.type === 'agent') {
      onAssignAgent(ref.id, actor.id)
      return
    }
    try {
      const result = assignTask(ref.id, ME)
      if (result) toast({ title: `Assigned “${result.task.title}” to you` })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t assign the task', description: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <li
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'link'
        if (!over) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn('rounded-sm outline-1 transition-colors duration-(--dur-1)', over ? 'bg-accent-tint outline outline-ink' : 'outline-transparent')}
    >
      <button
        type="button"
        onClick={() => navigate(`${base(project)}/tasks?assignee=${actor.type === 'agent' ? encodeURIComponent(actor.id) : 'me'}`)}
        aria-label={`${name}: ${openTasks} open tasks${activeRuns ? `, ${activeRuns} running` : ''}. Show their tasks`}
        className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-sm px-2 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <ActorMark actor={actor} size={24} live={activeRuns > 0} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-body-sm truncate font-medium text-ink">{name}</span>
          <span className="type-caption truncate text-ink-3">{role}</span>
        </span>
        <span className="type-meta flex shrink-0 flex-col items-end text-ink-3 tabular">
          <span>{openTasks} open</span>
          {activeRuns > 0 && (
            <span className="text-live-ink">
              <span aria-hidden>●</span> working
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

// ------------------------------------------------------------------------------------------------ numbers

const WORK_KINDS: { key: 'threads' | 'investigations' | 'sessions' | 'workflows' | 'assets' | 'knowledge'; label: string; anchor: string }[] = [
  { key: 'threads', label: 'Conversations', anchor: 'conversations' },
  { key: 'investigations', label: 'Investigations', anchor: 'investigations' },
  { key: 'sessions', label: 'Coding sessions', anchor: 'sessions' },
  { key: 'workflows', label: 'Workflows', anchor: 'workflows' },
  { key: 'assets', label: 'Assets', anchor: 'assets' },
  { key: 'knowledge', label: 'Knowledge', anchor: 'knowledge' },
]

function Numbers({ project }: { project: Project }) {
  const navigate = useNavigate()
  const stats = useProjectStats(project.id)
  const spend = useProjectSpend(project.id)
  const now = useMinuteNow()
  const overdue = useDB((s: Tables) => {
    let n = 0
    for (const t of Object.values(s.tasks)) if (t.projectId === project.id && t.status !== 'done' && t.status !== 'cancelled' && dueBucket(t.dueAt, now) === 'overdue') n++
    return n
  })
  const open = stats.tasks.total - stats.tasks.done
  return (
    <section aria-labelledby="project-numbers">
      <SectionLabel id="project-numbers" title="Numbers" />
      <dl className="flex flex-col">
        <NumberRow label="Open tasks" value={<span className="tabular">{open}</span>} note={overdue ? `${overdue} overdue` : undefined} />
        <NumberRow
          label="Live runs"
          value={
            <span className="tabular">
              {stats.activeRuns > 0 && (
                <span aria-hidden className="mr-1 text-live">
                  ●
                </span>
              )}
              {stats.activeRuns}
            </span>
          }
        />
        <NumberRow
          label="Spend this month"
          value={<span className="tabular">{formatUsd(spend.liveUsd)}</span>}
          note={
            spend.estimatedUsd > 0 ? (
              <Tooltip content={ESTIMATE_TOOLTIP}>
                <span tabIndex={0} className="inline-flex items-center gap-1.5 rounded-xs">
                  + est. {formatUsd(spend.estimatedUsd)} <SimBadge size="xs" noTooltip />
                </span>
              </Tooltip>
            ) : (
              'live'
            )
          }
        />
      </dl>
      <h3 className="type-label mt-5 mb-1.5 text-ink-3">Linked work</h3>
      <ul className="-mx-2 grid grid-cols-2 gap-x-2">
        {WORK_KINDS.map((k) => (
          <li key={k.key}>
            <button
              type="button"
              onClick={() => navigate(`${base(project)}/work#${k.anchor}`)}
              className="flex h-8 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11"
            >
              <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2">{k.label}</span>
              <span className="type-meta text-ink-3 tabular">{stats[k.key]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function NumberRow({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-baseline gap-3 border-b border-line py-1.5 last:border-b-0">
      <dt className="type-body-sm min-w-0 flex-1 text-ink-2">{label}</dt>
      <dd className="type-mono-sm flex shrink-0 flex-col items-end text-ink">
        {value}
        {note && <span className="type-meta text-ink-3">{note}</span>}
      </dd>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ memory

function MemoryBlock({ project }: { project: Project }) {
  const navigate = useNavigate()
  const memory = useMemoryBreakdown(project.id)
  const unpin = (ref: EntityRef) => {
    unpinFromProject(project.id, ref)
    toast({ title: 'Removed from project memory', duration: 8000, action: { label: 'Undo', onClick: () => pinToProject(project.id, ref) } })
  }
  return (
    <section aria-labelledby="project-memory">
      <SectionLabel id="project-memory" title="Memory" count={project.pinnedRefs.length} action={<SectionAction onClick={() => navigate(`${base(project)}/memory`)}>Edit</SectionAction>} />
      <p className="type-caption mb-2.5 text-ink-3">
        Rides along in every run here · ~{formatTokenCount(memory.total)} tok
      </p>
      {project.pinnedRefs.length === 0 ? (
        <QuietLine>Nothing held in memory yet.</QuietLine>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {project.pinnedRefs.map((ref) => (
            <EntityChip key={refKey(ref)} entity={ref} size="sm" onRemove={() => unpin(ref)} />
          ))}
        </div>
      )}
      <div className="mt-2.5">
        <EntityPicker
          value={null}
          onChange={(ref) => {
            pinToProject(project.id, ref)
            toast({ title: 'Added to project memory', description: 'It rides along in every new run in this project.' })
          }}
          placeholder="Add to memory"
          trigger={(props) => (
            <button {...props} type="button" ref={props.ref as Ref<HTMLButtonElement>} className="type-caption inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11">
              <Plus aria-hidden className="size-3.5" strokeWidth={2} />
              Add to memory
            </button>
          )}
        />
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ recent activity

function RecentActivity({ project }: { project: Project }) {
  const navigate = useNavigate()
  const events = useProjectActivity(project.id, 5)
  return (
    <section aria-labelledby="project-recent">
      <SectionLabel id="project-recent" title="Recent activity" action={<SectionAction onClick={() => navigate(`${base(project)}/activity`)}>All</SectionAction>} />
      {events.length === 0 ? (
        <QuietLine>No activity yet.</QuietLine>
      ) : (
        <ol className="relative flex flex-col gap-2.5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line">
          {events.map((e) => (
            <li key={e.id} className="relative flex gap-3 pl-4">
              <span aria-hidden className={cn('absolute top-1.5 left-0 size-[7px] rounded-full border bg-canvas', e.actor.type === 'agent' ? 'border-ink-3' : 'border-line-input')} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="type-body-sm line-clamp-2 text-pretty text-ink-2">{e.summary}</span>
                <span className="type-meta text-ink-3">
                  {actorName(e.actor)} · {timeAgo(e.at)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
