import { Component, memo, useCallback, useMemo, type ErrorInfo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useShellStore } from '@/app/shell/store'
import { useMinuteNow } from '@/core/analytics'
import { useDB, useRow, type Tables } from '@/core/db'
import { taskRunIdsIn } from '@/core/services'
import { useSettings } from '@/core/settings'
import { isRunActive, type ActorRef, type Hue, type ID, type Project, type Task } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, Avatar, ErrorState, HUE_FILL, MonogramMark, runCurrentLine, StepTape, TaskGlyph } from '@/ui'
import { dueInfo } from './logic'

/*
 * Small parts shared by the Projects views: marks, section labels, assignee marks, due dates, task
 * glyphs that know their live state, and the live run line on rows and cards.
 */

// ------------------------------------------------------------------------------------------------ marks

/** The project's square mark: its icon on a 15% hue tint (rounded square = things that last). */
export function ProjectMark({ project, size = 20, label, className }: { project: Pick<Project, 'name' | 'hue' | 'icon'>; size?: number; label?: string; className?: string }) {
  return <MonogramMark text={project.name} hue={project.hue} icon={project.icon || undefined} size={size} label={label} className={className} />
}

/** The project-hue rule (§5.1 motif 7): a 3px band on project cards and headers. */
export function HueBand({ hue, className }: { hue: Hue; className?: string }) {
  return <div aria-hidden className={cn('h-[3px] w-full shrink-0', HUE_FILL[hue], className)} />
}

// ------------------------------------------------------------------------------------------------ sections

/** Section heading in the Home pattern: a `label` kicker, mono count, and an action on the right. */
export function SectionLabel({ id, title, count, action, className }: { id?: string; title: string; count?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex h-7 min-w-0 items-center gap-2', className)}>
      <h2 id={id} className="type-label truncate text-ink-3">
        {title}
      </h2>
      {count !== undefined && count > 0 && <span className="type-meta text-ink-3 tabular">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

/** A quiet header action ("All runs", "Edit"): caption, ink-3, hover wash. */
export function SectionAction({ children, onClick, label, kbd }: { children: ReactNode; onClick: () => void; label?: string; kbd?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="type-caption inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
    >
      {children}
      {kbd && <span className="font-mono text-[11px] text-ink-3 pointer-coarse:hidden">{kbd}</span>}
    </button>
  )
}

/** One quiet sentence where a section has nothing to show. */
export function QuietLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('type-body-sm py-1 text-ink-3', className)}>{children}</p>
}

// ------------------------------------------------------------------------------------------------ actors

/** "You" for the user, the agent's name for an agent, "Unassigned" for nobody. */
export function useActorName(actor: ActorRef | null | undefined): string {
  const agentName = useDB((s: Tables) => (actor?.type === 'agent' ? s.agents[actor.id]?.name : undefined))
  if (!actor) return 'Unassigned'
  if (actor.type === 'user') return 'You'
  if (actor.type === 'agent') return agentName ?? 'Deleted agent'
  return actor.type === 'workflow' ? 'A workflow' : 'Atrium'
}

/** An actor's circle: your Avatar, an AgentMark (live while working), or a dashed ring for nobody. */
export function ActorMark({ actor, size = 16, live, label }: { actor: ActorRef | null | undefined; size?: number; live?: boolean; label?: string }) {
  const profile = useSettings((s) => s.profile)
  const agent = useRow('agents', actor?.type === 'agent' ? actor.id : null)
  if (!actor) {
    return (
      <span
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className="inline-block shrink-0 rounded-full border border-line-input"
        style={{ width: size, height: size }}
      />
    )
  }
  if (actor.type === 'agent') {
    if (!agent) return <span aria-hidden className="inline-block shrink-0 rounded-full bg-press" style={{ width: size, height: size }} />
    return <AgentMark seed={agent.sigil} hue={agent.hue} size={size} live={live} paused={agent.status === 'paused'} label={label} />
  }
  const avatarSize = size <= 16 ? 'xs' : size <= 20 ? 'sm' : size <= 24 ? 'md' : 'lg'
  return <Avatar name={profile.name || 'You'} hue={profile.hue} size={avatarSize} decorative={!label} aria-label={label} />
}

// ------------------------------------------------------------------------------------------------ dates

/** A due date in mono: "Today", "Nov 6", "3d overdue". Overdue reads in ink (never colored: it is not a signal). */
export function DueText({ dueAt, done, className }: { dueAt: number | undefined; done?: boolean; className?: string }) {
  const now = useMinuteNow()
  if (dueAt === undefined) return null
  const info = dueInfo(dueAt, now, done)
  return (
    <span
      className={cn('type-meta shrink-0 tabular', info.overdue ? 'font-medium text-ink' : info.soon ? 'text-ink-2' : 'text-ink-3', className)}
      title={new Date(dueAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
    >
      {info.text}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ task live state

export interface TaskSignal {
  /** A run for the task is running right now: the in-progress glyph fills live. */
  live: boolean
  /** In Review after an agent's run: agent work awaits you (attn glyph). */
  attention: boolean
  /** The active run (queued, running, waiting or paused), if any. */
  activeRunId: ID | undefined
}

/** A task's live state, selected narrowly (re-renders only when one of the three values changes). */
export function useTaskSignal(task: Pick<Task, 'id' | 'status' | 'runIds'>): TaskSignal {
  const { id, status, runIds } = task
  return useDB(
    useShallow((s: Tables) => {
      // Its own runs and the turns of coding sessions linked to it.
      const ids = taskRunIdsIn(s, { id, runIds })
      let activeRunId: ID | undefined
      let live = false
      for (let i = ids.length - 1; i >= 0; i--) {
        const run = s.runs[ids[i]]
        if (run && isRunActive(run.status)) {
          activeRunId = run.id
          live = run.status === 'running'
          break
        }
      }
      const last = ids.length ? s.runs[ids[ids.length - 1]] : undefined
      return { live: live && status === 'in_progress', attention: status === 'review' && !!last?.agentId, activeRunId }
    }),
  )
}

/** The task glyph (§5.3 squares) with its live and attention states. */
export const TaskStatusGlyph = memo(function TaskStatusGlyph({ task, size = 12, decorative }: { task: Pick<Task, 'id' | 'status' | 'runIds'>; size?: number; decorative?: boolean }) {
  const signal = useTaskSignal(task)
  return <TaskGlyph status={task.status} live={signal.live} attention={signal.attention} size={size} decorative={decorative} />
})

/**
 * The live line of a task with an active run: a mini Step Tape and the current step ("Reading 4
 * sources"). Subscribes to that one run only, so streaming never re-renders the list around it.
 */
export const RunLine = memo(function RunLine({ runId, size = 'xs', showText = true, className }: { runId: ID; size?: 'xs' | 'sm'; showText?: boolean; className?: string }) {
  const run = useRow('runs', runId)
  if (!run) return null
  const line = runCurrentLine(run)
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <StepTape run={run} size={size} max={size === 'xs' ? 10 : 14} />
      {showText && (
        <span className={cn('type-caption min-w-0 truncate', run.status === 'running' ? 'text-live-ink' : run.status === 'waiting' ? 'text-attn-ink' : 'text-ink-3')}>
          {run.status === 'waiting' ? 'Needs you' : line}
        </span>
      )}
    </span>
  )
})

// ------------------------------------------------------------------------------------------------ counts

/** `● 2 running  ◆ 1 needs you` in mono; each part only when non-zero. Shapes carry meaning, color only marks. */
export function SignalCounts({ running, needsYou, compact, className }: { running: number; needsYou: number; compact?: boolean; className?: string }) {
  if (!running && !needsYou) return null
  return (
    <span className={cn('type-meta inline-flex shrink-0 items-center gap-2.5 text-ink-3 tabular', className)}>
      {running > 0 && (
        <span className="inline-flex items-center gap-1" aria-label={`${running} running`}>
          <span aria-hidden className="text-live">
            ●
          </span>
          <span aria-hidden>{compact ? running : `${running} running`}</span>
        </span>
      )}
      {needsYou > 0 && (
        <span className="inline-flex items-center gap-1" aria-label={`${needsYou} need${needsYou === 1 ? 's' : ''} you`}>
          <span aria-hidden className="text-attn">
            ◆
          </span>
          <span aria-hidden>{compact ? needsYou : `${needsYou} needs you`}</span>
        </span>
      )}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ narrow selections

/**
 * A list of ids selected from the database, stable while the ids are the same (the selector's
 * output is joined into one string, so unrelated writes never re-render the caller).
 */
export function useIdList(select: (s: Tables) => readonly string[]): string[] {
  const key = useDB((s: Tables) => select(s).join('\u0001'))
  return useMemo(() => (key ? key.split('\u0001') : []), [key])
}

// ------------------------------------------------------------------------------------------------ selection

export const TASK_PARAM = 'task'

/**
 * Open a task in Inspector › Item by selecting it (`?task=` — selections are query parameters, §2.6).
 * A peek stack in the Inspector is cleared first so the task shows rather than the peeked item.
 */
export function useOpenTask(): (taskId: ID, opts?: { replace?: boolean }) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (taskId: ID, opts?: { replace?: boolean }) => {
      const st = useShellStore.getState()
      if (st.inspectStack.length) st.clearInspect()
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.set(TASK_PARAM, taskId)
          next.delete('inspect')
          return next
        },
        { replace: opts?.replace },
      )
    },
    [setParams],
  )
}

/** The `?task=` selection (or null). */
export function useSelectedTaskId(): ID | null {
  const [params] = useSearchParams()
  return params.get(TASK_PARAM)
}

// ------------------------------------------------------------------------------------------------ errors

/**
 * An error boundary for one section or view: it shows "Couldn’t load {name}" with the details and
 * Retry, and the rest of the page keeps working.
 */
export class SectionBoundary extends Component<{ name: string; children: ReactNode; className?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[projects] ${this.props.name} failed`, error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorState
          compact
          title={`Couldn’t load ${this.props.name}`}
          message="Something in this part failed to draw. Your data is safe, and the rest of the page still works."
          details={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          retryLabel="Retry"
          className={this.props.className}
        />
      )
    }
    return this.props.children
  }
}
