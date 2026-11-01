import { useMemo, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { runsByAgent, type AgentLiveStatus } from '@/core/services'
import { isRunActive, type Agent, type ID, type Run, type RunStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { StatusGlyph, runCurrentLine } from '@/ui'
import { AGENT_STATUS_META, AUTONOMY_COPY, agentWorksIn } from './logic'

/* Small pieces shared by the Agents views: agent status glyph and chip, the agent's activity line,
   the most urgent active run of an agent, and the scope rule for agents. */

export function AgentStatusGlyph({ status, size = 12, decorative, className }: { status: AgentLiveStatus; size?: number; decorative?: boolean; className?: string }) {
  const m = AGENT_STATUS_META[status]
  return <StatusGlyph shape={m.shape} tone={m.tone} live={m.live} size={size} word={m.word} decorative={decorative} className={className} />
}

const CHIP_TONE: Record<AgentLiveStatus, string> = {
  working: 'bg-live-tint text-live-ink',
  waiting: 'bg-attn-tint text-attn-ink',
  attention: 'bg-fail-tint text-fail-ink',
  idle: 'bg-hover text-ink-2',
  paused: 'bg-hover text-ink-2',
}

/** A capsule with the agent's status glyph and word (status chips are capsules, §4.8). */
export function AgentStatusChip({ status, className }: { status: AgentLiveStatus; className?: string }) {
  return (
    <span className={cn('type-caption inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full pr-2 pl-1.5 font-medium', CHIP_TONE[status], className)}>
      <AgentStatusGlyph status={status} size={10} decorative />
      {AGENT_STATUS_META[status].word}
    </span>
  )
}

export function AutonomyChip({ autonomy, className }: { autonomy: Agent['autonomy']; className?: string }) {
  return (
    <span className={cn('type-caption inline-flex h-5 shrink-0 items-center rounded-sm border border-line-strong px-1.5 text-ink-2', className)}>
      {AUTONOMY_COPY[autonomy].label}
    </span>
  )
}

const URGENCY: Record<RunStatus, number> = { waiting: 0, running: 1, queued: 2, paused: 3, failed: 4, succeeded: 5, cancelled: 6 }

/** The most urgent active run of an agent: waiting first, then running, queued, paused (newest wins ties). */
export function pickActiveRun(runs: readonly Run[]): Run | undefined {
  let best: Run | undefined
  for (const r of runs) {
    if (!isRunActive(r.status)) continue
    if (!best || URGENCY[r.status] < URGENCY[best.status] || (URGENCY[r.status] === URGENCY[best.status] && r.createdAt > best.createdAt)) best = r
  }
  return best
}

const NO_RUNS: Run[] = []

export interface AgentActivity {
  /** The most urgent active run, when there is one. */
  runId?: ID
  runStatus?: RunStatus
  /** "Reading 4 sources" · "Post weekly digest to #product" · "Idle · last run 2h ago" · "Paused". */
  line: string
  /** Number of runs in flight. */
  active: number
}

/** What an agent is doing, as one line (re-renders only when the line or the run changes). */
export function useAgentActivity(agentId: ID): AgentActivity {
  return useDB(
    useShallow((s: Tables): AgentActivity => {
      const agent = s.agents[agentId]
      const runs = runsByAgent(s.runs).get(agentId) ?? NO_RUNS
      const run = pickActiveRun(runs)
      const active = runs.filter((r) => isRunActive(r.status)).length
      if (run) return { runId: run.id, runStatus: run.status, line: runCurrentLine(run), active }
      if (agent?.status === 'paused') return { line: 'Paused · takes no new work', active }
      if (agent?.status === 'archived') return { line: 'Archived', active }
      let last: Run | undefined
      for (const r of runs) if (!last || (r.endedAt ?? r.createdAt) > (last.endedAt ?? last.createdAt)) last = r
      if (!last) return { line: 'Idle · no runs yet', active }
      const when = timeAgo(last.endedAt ?? last.createdAt)
      if (last.status === 'failed' && Date.now() - (last.endedAt ?? last.createdAt) < 86_400_000) return { line: `Last run failed ${when}`, active }
      return { line: `Idle · last run ${when}`, active }
    }),
  )
}

/** Ids of the non-archived agents that work in the current scope (all of them when unscoped). */
export function useAgentIdsInScope(opts: { includeArchived?: boolean } = {}): ID[] {
  const scope = useScope()
  const { includeArchived } = opts
  return useDB(
    useShallow((s: Tables) => {
      const agents = Object.values(s.agents).filter((a) => (includeArchived ? true : a.status !== 'archived'))
      if (!scope) return agents.map((a) => a.id)
      const runs = Object.values(s.runs)
      const tasks = Object.values(s.tasks)
      return agents.filter((a) => agentWorksIn(a, scope, runs, tasks)).map((a) => a.id)
    }),
  )
}

/** Number of archived agents (for the list pane footer). */
export function useArchivedCount(): number {
  return useDB((s: Tables) => Object.values(s.agents).filter((a) => a.status === 'archived').length)
}

/** A `label` section header with an optional count and a right-aligned action (Home's rhythm). */
export function SectionLabel({ id, title, count, action, className }: { id?: string; title: ReactNode; count?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex h-7 min-w-0 items-center gap-2', className)}>
      <h2 id={id} className="type-label text-ink-3">
        {title}
      </h2>
      {count !== undefined && count > 0 && <span className="type-meta text-ink-3 tabular">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

/** A quiet header link button (Home's HeaderLink). */
export function HeaderLink({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'type-caption inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

/** Stable `{ name, hue, sigil }` owner info for RunRow (only re-renders when the agent's identity changes). */
export function useRunOwner(agentId: ID | undefined): { name: string; hue: Agent['hue']; sigil: number } | undefined {
  const owner = useDB(
    useShallow((s: Tables) => {
      const a = agentId ? s.agents[agentId] : undefined
      return a ? { name: a.name, hue: a.hue, sigil: a.sigil } : null
    }),
  )
  return useMemo(() => (owner ? { ...owner } : undefined), [owner])
}

/** Project identity for RunRow (name + hue), stable between unrelated writes. */
export function useRunProject(projectId: ID | null | undefined): { name: string; hue: Agent['hue'] } | undefined {
  const project = useDB(
    useShallow((s: Tables) => {
      const p = projectId ? s.projects[projectId] : undefined
      return p ? { name: p.name, hue: p.hue } : null
    }),
  )
  return useMemo(() => (project ? { ...project } : undefined), [project])
}
