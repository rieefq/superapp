import { memo, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRight, Check, MessagesSquare, Orbit, PanelRight, Pencil, Play, RotateCw, Square, Telescope, Trash2, Undo2, X } from 'lucide-react'
import { useScopedKey } from '@/app/components'
import { workspaceForPath } from '@/app/registry'
import { attachRun } from '@/app/shell/store'
import { useDB, useRow, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import {
  addSubtask,
  approveTaskReview,
  removeSubtask,
  requestTaskChanges,
  toggleSubtask,
  updateTask,
  useApprovalsForRun,
  useTask,
  useTaskRuns,
} from '@/core/services'
import { isRunActive, refKey, type EntityRef, type ID, type Task } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import {
  ApprovalCardConnected,
  Button,
  Checkbox,
  EntityChip,
  IconButton,
  IdCode,
  Input,
  Markdown,
  ProvenanceLine,
  RunRow,
  SimBadge,
  StepTape,
  Textarea,
  toast,
  runCurrentLine,
} from '@/ui'
import { AssignDialog } from '../AssignDialog'
import { lineageIn } from '../logic'
import { ActorMark, useActorName } from '../parts'
import { deleteWithConfirm, discussTask, researchTask, startTask } from '../taskActions'
import { AssigneeField, DueField, LabelsField, MilestoneField, PriorityField, ProjectField, PropertyRow, StatusField } from './fields'

/**
 * The task drawer (§6.9 "Task in the Inspector"): properties, the agent's live run (assigning an
 * agent starts it, and it shows here as it works), the review decision, actions (Start · Assign to
 * agent · Research · Discuss), the Markdown description, subtasks, origin lineage and the task's runs.
 * The Inspector adds Links and History (the activity) below.
 */
export function TaskPanel({ entity }: { entity: EntityRef }) {
  const task = useTask(entity.id)
  if (!task) return null
  return <TaskDrawer task={task} />
}

function TaskDrawer({ task }: { task: Task }) {
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const rootRef = useRef<HTMLDivElement>(null)
  const project = useRow('projects', task.projectId)
  const [assigning, setAssigning] = useState<{ open: boolean; agentId: ID | null }>({ open: false, agentId: null })
  const [editing, setEditing] = useState(false)
  const activeRunId = useDB((s: Tables) => {
    for (let i = task.runIds.length - 1; i >= 0; i--) {
      const r = s.runs[task.runIds[i]]
      if (r && isRunActive(r.status)) return r.id
    }
    return undefined
  })
  const live = useDB((s: Tables) => (activeRunId ? s.runs[activeRunId]?.status === 'running' : false))
  useScopedKey(rootRef, 'e', () => setEditing(true), !editing)

  const mine = task.assignee === null || task.assignee.type === 'user'
  const open = task.status !== 'done' && task.status !== 'cancelled'

  return (
    <div ref={rootRef} className="flex flex-col" data-task-drawer={task.id}>
      <section aria-label="Properties" className="px-4 py-3">
        <dl className="flex flex-col gap-0.5">
          <PropertyRow label="Status">
            <StatusField task={task} />
          </PropertyRow>
          <PropertyRow label="Assignee">
            <AssigneeField task={task} live={live} onPickAgent={(agentId) => setAssigning({ open: true, agentId })} />
          </PropertyRow>
          <PropertyRow label="Priority">
            <PriorityField task={task} />
          </PropertyRow>
          <PropertyRow label="Due">
            <DueField task={task} />
          </PropertyRow>
          {project && (project.milestones.length > 0 || task.milestoneId) && (
            <PropertyRow label="Milestone">
              <MilestoneField task={task} project={project} />
            </PropertyRow>
          )}
          <PropertyRow label="Labels">
            <LabelsField task={task} />
          </PropertyRow>
          <PropertyRow label="Project">
            <ProjectField task={task} />
          </PropertyRow>
        </dl>
      </section>

      <AgentWork task={task} activeRunId={activeRunId} onRetry={(agentId) => setAssigning({ open: true, agentId })} />

      {open && (
        <section aria-label="Actions" className="flex flex-wrap items-center gap-1 border-t border-line px-3 py-2.5">
          {mine && (
            <Button size="sm" variant="secondary" leadingIcon={Play} onClick={() => startTask(task, navigate)} title={project?.repoIds.length ? 'Start a coding session on this task' : 'Start a conversation with this task attached'}>
              Start
            </Button>
          )}
          <Button size="sm" variant="ghost" leadingIcon={Orbit} onClick={() => setAssigning({ open: true, agentId: null })}>
            Assign to agent…
          </Button>
          <Button size="sm" variant="ghost" leadingIcon={Telescope} onClick={() => researchTask(task)}>
            Research
          </Button>
          <Button size="sm" variant="ghost" leadingIcon={MessagesSquare} onClick={() => discussTask(task, navigate)}>
            Discuss
          </Button>
        </section>
      )}

      <Description task={task} editing={editing} onEditingChange={setEditing} />
      <Subtasks task={task} />
      <Origin task={task} />
      <Runs task={task} />

      <footer className="border-t border-line px-3 py-2.5">
        <Button
          size="sm"
          variant="danger"
          leadingIcon={Trash2}
          onClick={async () => {
            const deleted = await deleteWithConfirm(task)
            if (!deleted) return
            // Drop the selection that pointed at it.
            setParams(
              (p) => {
                const next = new URLSearchParams(p)
                if (next.get('task') === task.id) next.delete('task')
                if (next.get('inspect') === `task:${task.id}`) next.delete('inspect')
                return next
              },
              { replace: true },
            )
          }}
        >
          Delete task
        </Button>
      </footer>

      <AssignDialog
        taskId={task.id}
        agentId={assigning.agentId}
        open={assigning.open}
        onOpenChange={(o) => setAssigning((a) => ({ ...a, open: o }))}
      />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ agent work

/**
 * What the agent is doing for this task: the live run (tape, current step, approvals inline), the
 * review decision once it finished, or the failure with Retry.
 */
function AgentWork({ task, activeRunId, onRetry }: { task: Task; activeRunId: ID | undefined; onRetry: (agentId: ID) => void }) {
  const lastRunId = task.runIds[task.runIds.length - 1]
  const lastRun = useRow('runs', lastRunId)
  if (activeRunId) return <LiveRun runId={activeRunId} />
  if (task.status === 'review' && lastRun?.agentId) return <Review task={task} runId={lastRun.id} />
  if (lastRun && (lastRun.status === 'failed' || lastRun.status === 'cancelled') && lastRun.agentId && task.assignee?.type === 'agent' && task.status !== 'done') {
    return <Failed task={task} runId={lastRun.id} onRetry={onRetry} />
  }
  return null
}

const LiveRun = memo(function LiveRun({ runId }: { runId: ID }) {
  const location = useLocation()
  const run = useRow('runs', runId)
  const agent = useRow('agents', run?.agentId)
  const approvals = useApprovalsForRun(runId)
  if (!run) return null
  const pending = approvals.filter((a) => a.status === 'pending')
  const done = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const who = agent?.name ?? 'The agent'
  const word = run.status === 'waiting' ? 'needs you' : run.status === 'paused' ? 'is paused' : run.status === 'queued' ? 'is about to start' : 'is working'
  return (
    <section aria-label="Agent run" aria-live="off" className="flex flex-col gap-2.5 border-t border-line px-4 py-3.5" data-task-run={run.id}>
      <div className="flex min-w-0 items-center gap-2">
        {agent && <ActorMark actor={{ type: 'agent', id: agent.id }} size={20} live={run.status === 'running'} />}
        <span className="type-body-sm min-w-0 flex-1 truncate">
          <span className="font-medium text-ink">{who}</span> <span className="text-ink-2">{word}</span>
        </span>
        {run.simulated && <SimBadge size="xs" />}
        <IconButton icon={PanelRight} size="sm" label="Watch the run (Inspector › Run)" onClick={() => attachRun(run.id, workspaceForPath(location.pathname).id)} />
        <IconButton icon={Square} size="sm" label={`Stop ${who}`} onClick={() => runEngine.cancel(run.id, 'Stopped by you')} />
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
        <StepTape run={run} size="sm" max={18} />
        <span className="type-meta shrink-0 text-ink-3 tabular">
          {done}/{total || '…'}
        </span>
      </div>
      <p className={cn('type-body-sm truncate', run.status === 'running' ? 'text-live-ink' : run.status === 'waiting' ? 'text-attn-ink' : 'text-ink-2')}>{runCurrentLine(run)}</p>
      <div className="type-meta flex items-center gap-1.5 text-ink-3">
        <IdCode id={run.id} />
        <span aria-hidden>·</span>
        <span>started {timeAgo(run.startedAt ?? run.createdAt)}</span>
      </div>
      {pending.map((a) => (
        <ApprovalCardConnected key={a.id} approvalId={a.id} variant="compact" />
      ))}
    </section>
  )
})

function Review({ task, runId }: { task: Task; runId: ID }) {
  const run = useRow('runs', runId)
  const agentName = useActorName(run?.agentId ? { type: 'agent', id: run.agentId } : null)
  const [requesting, setRequesting] = useState(false)
  const [note, setNote] = useState('')
  if (!run) return null
  const approve = () => {
    approveTaskReview(task.id)
    toast({
      tone: 'success',
      title: `Approved — “${task.title}” is done`,
      duration: 8000,
      action: { label: 'Undo', onClick: () => updateTask(task.id, { status: 'review' }) },
    })
  }
  const send = () => {
    try {
      requestTaskChanges(task.id, note)
      setRequesting(false)
      setNote('')
      toast({ title: `Sent back to ${agentName}`, description: 'A new run starts with your note; the task returns to Review when it finishes.' })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t send it back', description: err instanceof Error ? err.message : String(err) })
    }
  }
  return (
    <section aria-label="Review" className="flex flex-col gap-2.5 border-t border-l-2 border-t-line border-l-attn bg-attn-tint/45 py-3.5 pr-4 pl-[14px]">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-[10px] leading-none text-attn">
          ◆
        </span>
        <h3 className="type-body-sm font-semibold text-ink">Ready for your review</h3>
        <span className="flex-1" />
        <span className="type-meta text-ink-3">{timeAgo(run.endedAt ?? task.updatedAt)}</span>
      </div>
      <p className="type-body-sm text-ink-2">
        {agentName} finished. Approve to mark the task done, or send it back with what should change.
      </p>
      {run.summary && (
        <div className={cn('flex flex-col gap-1.5 rounded-sm border bg-canvas px-3 py-2.5', run.simulated ? 'border-dashed border-line-input' : 'border-line')}>
          <p className="type-body-sm line-clamp-4 text-ink">{run.summary}</p>
          <ProvenanceLine run={run} />
        </div>
      )}
      {requesting ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={note}
            onValueChange={setNote}
            autosize
            minRows={2}
            maxRows={6}
            aria-label="What should change"
            placeholder="What should change? It goes to the agent as part of the next run."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setRequesting(false)
              }
            }}
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="primary" kbd="mod+enter" onClick={send}>
              Send back
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRequesting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" leadingIcon={Check} onClick={approve}>
            Approve review
          </Button>
          <Button size="sm" variant="secondary" leadingIcon={Undo2} onClick={() => setRequesting(true)}>
            Request changes
          </Button>
        </div>
      )}
    </section>
  )
}

function Failed({ task, runId, onRetry }: { task: Task; runId: ID; onRetry: (agentId: ID) => void }) {
  const run = useRow('runs', runId)
  const agentName = useActorName(run?.agentId ? { type: 'agent', id: run.agentId } : null)
  if (!run?.agentId) return null
  const stopped = run.status === 'cancelled'
  return (
    <section aria-label="Last run" className="flex flex-col gap-2 border-t border-line px-4 py-3.5">
      <div className="flex items-start gap-2">
        <span aria-hidden className={cn('mt-0.5 text-[11px] leading-none', stopped ? 'text-ink-3' : 'text-fail')}>
          {stopped ? '⊘' : '✕'}
        </span>
        <p className="type-body-sm min-w-0 flex-1 text-ink-2">
          {stopped ? `${agentName}’s run was stopped.` : `${agentName}’s run failed.`}{' '}
          <span className={stopped ? 'text-ink-3' : 'text-fail-ink'}>{runCurrentLine(run)}</span>
        </p>
      </div>
      <div className="flex items-center gap-1.5 pl-5">
        <Button size="sm" variant="secondary" leadingIcon={RotateCw} onClick={() => onRetry(run.agentId!)}>
          Try again
        </Button>
        <span className="type-meta text-ink-3">{timeAgo(run.endedAt ?? run.createdAt)}</span>
      </div>
      {task.status === 'todo' && <p className="type-caption pl-5 text-ink-3">The task went back to To do.</p>}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ description

function Description({ task, editing, onEditingChange }: { task: Task; editing: boolean; onEditingChange: (v: boolean) => void }) {
  const [title, setTitle] = useState(task.title)
  const [body, setBody] = useState(task.description ?? '')
  const start = () => {
    setTitle(task.title)
    setBody(task.description ?? '')
    onEditingChange(true)
  }
  const save = () => {
    updateTask(task.id, { title, description: body.trim() ? body : undefined })
    onEditingChange(false)
  }
  if (editing) {
    return (
      <section aria-label="Edit task" className="flex flex-col gap-2 border-t border-line px-4 py-3.5">
        <Input
          value={title}
          onValueChange={setTitle}
          aria-label="Title"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
          }}
        />
        <Textarea
          value={body}
          onValueChange={setBody}
          mono
          autosize
          minRows={5}
          maxRows={18}
          aria-label="Description (Markdown)"
          placeholder={'What needs to happen, and what “done” looks like.\n\n- [ ] Acceptance criteria'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              onEditingChange(false)
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" kbd="mod+enter" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEditingChange(false)}>
            Cancel
          </Button>
          <span className="type-caption ml-auto text-ink-3">Markdown</span>
        </div>
      </section>
    )
  }
  return (
    <section aria-label="Description" className="border-t border-line px-4 py-3.5">
      <div className="flex items-center justify-between pb-2">
        <h3 className="type-label text-ink-3">Description</h3>
        <Button size="xs" variant="ghost" leadingIcon={Pencil} kbd="e" onClick={start} aria-keyshortcuts="e">
          Edit
        </Button>
      </div>
      {task.description ? (
        <div className="type-body-sm text-ink-2 [&_ul]:my-1">
          <Markdown prose="ui">{task.description}</Markdown>
        </div>
      ) : (
        <button type="button" onClick={start} className="type-body-sm rounded-xs text-ink-3 hover:text-ink-2">
          No description. Add what “done” looks like.
        </button>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ subtasks

function Subtasks({ task }: { task: Task }) {
  const [draft, setDraft] = useState('')
  const done = task.subtasks.filter((s) => s.done).length
  const add = () => {
    if (addSubtask(task.id, draft)) setDraft('')
  }
  return (
    <section aria-label="Subtasks" className="border-t border-line px-4 py-3.5">
      <h3 className="type-label flex items-center gap-1.5 pb-2 text-ink-3">
        Subtasks
        {task.subtasks.length > 0 && (
          <span className="type-meta font-normal tracking-normal text-ink-3 normal-case tabular">
            {done}/{task.subtasks.length}
          </span>
        )}
      </h3>
      {task.subtasks.length > 0 && (
        <ul className="-mx-1.5 flex flex-col pb-1.5">
          {task.subtasks.map((s) => (
            <li key={s.id} className="group/sub flex min-h-8 items-center gap-2 rounded-sm px-1.5 hover:bg-hover">
              <Checkbox
                size="sm"
                checked={s.done}
                onCheckedChange={() => toggleSubtask(task.id, s.id)}
                label={<span className={cn('type-body-sm', s.done ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{s.title}</span>}
                className="min-w-0 flex-1"
              />
              <IconButton
                icon={X}
                size="xs"
                label={`Remove subtask “${s.title}”`}
                onClick={() => removeSubtask(task.id, s.id)}
                className="opacity-0 group-hover/sub:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              />
            </li>
          ))}
        </ul>
      )}
      <Input
        size="sm"
        value={draft}
        onValueChange={setDraft}
        placeholder="Add a subtask"
        aria-label="Add a subtask"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ origin

function Origin({ task }: { task: Task }) {
  const keys = useDB(useShallow((s: Tables) => lineageIn(s, { kind: 'task', id: task.id }).map(refKey)))
  const chain = useMemo(
    () =>
      keys.map((k) => {
        const at = k.indexOf(':')
        return { kind: k.slice(0, at), id: k.slice(at + 1) } as EntityRef
      }),
    [keys],
  )
  if (!chain.length) return null
  return (
    <section aria-label="Origin" className="border-t border-line px-4 py-3.5">
      <h3 className="type-label pb-2 text-ink-3">Origin</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        {chain.map((ref, i) => (
          <span key={refKey(ref)} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <ArrowRight aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />}
            <EntityChip entity={ref} size="sm" showKind />
          </span>
        ))}
        <ArrowRight aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />
        <span className="type-caption text-ink-2">this task</span>
      </div>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ runs

function Runs({ task }: { task: Task }) {
  const location = useLocation()
  const runs = useTaskRuns(task)
  const agents = useDB((s: Tables) => s.agents)
  if (!runs.length) return null
  const ws = workspaceForPath(location.pathname).id
  const latestFirst = [...runs].reverse()
  return (
    <section aria-label="Runs for this task" className="border-t border-line py-3.5">
      <h3 className="type-label flex items-center gap-1.5 px-4 pb-2 text-ink-3">
        Runs <span className="type-meta font-normal tracking-normal normal-case">{runs.length}</span>
      </h3>
      <div className="flex flex-col px-1.5">
        {latestFirst.slice(0, 8).map((run) => {
          const agent = run.agentId ? agents[run.agentId] : undefined
          return (
            <RunRow
              key={run.id}
              run={run}
              agent={agent ? { name: agent.name, hue: agent.hue, sigil: agent.sigil } : undefined}
              onSelect={() => attachRun(run.id, ws)}
              onAttach={() => attachRun(run.id, ws)}
              onStop={() => runEngine.cancel(run.id, 'Stopped by you')}
              onRetry={() => {
                const next = runEngine.retry(run.id)
                if (next) attachRun(next.id, ws)
              }}
            />
          )
        })}
      </div>
      {runs.length > 8 && <p className="type-caption px-4 pt-1 text-ink-3">{runs.length - 8} earlier runs are in Agents › Runs.</p>}
    </section>
  )
}
