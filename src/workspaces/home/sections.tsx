import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, Plus } from 'lucide-react'
import { LandedCard } from '@/app/components'
import { runForIn } from '@/app/components/landing/useDerived'
import { attachRun, useShellStore } from '@/app/shell/store'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import { entityRoute, KIND_META, markRead, resolveIn } from '@/core/services'
import type { EntityRef, ID, Notification, Project, Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDate, timeAgo } from '@/lib/format'
import { Button, ErrorState, HUE_FILL, Tooltip, toast } from '@/ui'
import { ApprovalCardConnected, RunRow, TickMeter } from '@/app/components/sig'
import { computeNeedsYou, groupByProject, inFlightRuns, landedNotifications, type ReviewItem } from './logic'

/**
 * Home's sections (§6.1): Needs you, In flight, Landed (left); Projects, Resume (right). Each has its
 * quiet line, loading skeleton and its own error boundary.
 */

export const NEEDS_YOU_LIMIT = 5

// ------------------------------------------------------------------------------------------------ frame

export function SectionHeader({ id, title, count, action }: { id: string; title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="mb-2 flex h-7 min-w-0 items-center gap-2">
      <h2 id={id} className="type-label text-ink-3">
        {title}
      </h2>
      {count !== undefined && count > 0 && <span className="type-meta text-ink-3 tabular">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="type-body-sm py-1 text-ink-3">{children}</p>
}

function HeaderLink({ children, onClick, kbd }: { children: ReactNode; onClick: () => void; kbd?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="type-caption inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
    >
      {children}
      {kbd && <span className="font-mono text-[11px] text-ink-3 pointer-coarse:hidden">{kbd}</span>}
    </button>
  )
}

/** Per-section error boundary: a failing section shows an ErrorState with Retry; the rest of Home keeps working. */
export class SectionBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[home] ${this.props.name} failed`, error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorState
          compact
          title={`Couldn’t load ${this.props.name}`}
          message="Something in this section failed to render. The rest of Home still works."
          details={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          retryLabel="Retry"
        />
      )
    }
    return this.props.children
  }
}

// ------------------------------------------------------------------------------------------------ needs you

function useNeedsYou() {
  const scope = useScope()
  // Select stable rows; derive the lists in memo (no new objects inside the selector).
  const tables = useDB(useShallow((s: Tables) => ({ approvals: s.approvals, sessions: s.sessions, tasks: s.tasks })))
  const runsProjects = useDB(
    useShallow((s: Tables) => {
      const out: Record<string, string> = {}
      for (const a of Object.values(s.approvals)) if (a.status === 'pending') out[a.runId] = s.runs[a.runId]?.projectId ?? ''
      return out
    }),
  )
  return useMemo(() => computeNeedsYou(useDB.getState(), scope), [tables, runsProjects, scope])
}

export function NeedsYouSection() {
  const needs = useNeedsYou()
  const setOpen = useShellStore((s) => s.setNeedsYouOpen)
  const setTab = useShellStore((s) => s.setNeedsYouTab)
  const approvals = needs.approvals.slice(0, NEEDS_YOU_LIMIT)
  const reviews = needs.reviews.slice(0, Math.max(0, NEEDS_YOU_LIMIT - approvals.length))
  const hidden = needs.count - approvals.length - reviews.length
  const openAll = () => {
    setTab('needs')
    setOpen(true)
  }
  return (
    <section aria-labelledby="home-needs-you">
      <SectionHeader id="home-needs-you" title="Needs you" count={needs.count} action={<HeaderLink onClick={openAll} kbd="!">All requests</HeaderLink>} />
      {needs.count === 0 ? (
        <QuietLine>Nothing needs you.</QuietLine>
      ) : (
        <div className="flex flex-col gap-2">
          {approvals.map((a) => (
            <ApprovalCardConnected key={a.id} approvalId={a.id} variant="compact" />
          ))}
          {reviews.length > 0 && (
            <ul className="flex flex-col">
              {reviews.map((r) => (
                <ReviewRow key={`${r.kind}:${r.id}`} item={r} />
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <button type="button" onClick={openAll} className="type-caption self-start rounded-sm px-1.5 py-1 font-medium text-ink-3 hover:bg-hover hover:text-ink">
              +{hidden} more in Needs you
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function ReviewRow({ item }: { item: ReviewItem }) {
  const navigate = useNavigate()
  const ref: EntityRef = { kind: item.kind, id: item.id }
  const stats = useDB(
    useShallow((s: Tables) => {
      if (item.kind !== 'session') return null
      const ses = s.sessions[item.id]
      if (!ses) return null
      const add = ses.changes.reduce((n, c) => n + c.additions, 0)
      const del = ses.changes.reduce((n, c) => n + c.deletions, 0)
      return { files: ses.changes.length, add, del }
    }),
  )
  const route = item.kind === 'session' ? `${entityRoute(ref)}/changes` : entityRoute(ref)
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(route)}
        className="group/review flex min-h-11 w-full min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <span aria-hidden className="grid size-3 shrink-0 place-items-center text-[10px] leading-none text-attn">
          ◆
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="type-body-sm truncate text-ink">
            {item.kind === 'session' ? 'Review changes: ' : 'Review: '}
            <span className="font-medium">{item.title}</span>
          </span>
          <span className="type-meta truncate text-ink-3">
            {[item.by, stats ? `${stats.files} files` : undefined, stats ? `+${stats.add} −${stats.del}` : undefined, `waiting ${timeAgo(item.at).replace(' ago', '')}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        <span className="type-caption shrink-0 font-medium text-ink-2 group-hover/review:text-ink">Review</span>
        <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
      </button>
    </li>
  )
}

// ------------------------------------------------------------------------------------------------ in flight

export function InFlightSection() {
  const scope = useScope()
  const navigate = useNavigate()
  const runs = useDB(useShallow((s: Tables) => inFlightRuns(s, scope)))
  const groups = useMemo(() => groupByProject(runs), [runs])
  const meta = useDB(
    useShallow((s: Tables) => {
      const out: Record<string, Project | undefined> = {}
      for (const g of groups) if (g.projectId) out[g.projectId] = s.projects[g.projectId]
      return out
    }),
  )
  const agents = useDB((s: Tables) => s.agents)
  return (
    <section aria-labelledby="home-in-flight">
      <SectionHeader
        id="home-in-flight"
        title="In flight"
        count={runs.length}
        action={runs.length > 0 ? <HeaderLink onClick={() => navigate('/agents')}>All runs</HeaderLink> : undefined}
      />
      {runs.length === 0 ? (
        <QuietLine>Nothing in flight.</QuietLine>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => {
            const project = g.projectId ? meta[g.projectId] : undefined
            return (
              <div key={g.projectId ?? 'none'} role="group" aria-label={project?.name ?? 'No project'} className="flex flex-col">
                <div className="type-label flex h-6 items-center gap-2 px-2 text-ink-3">
                  {project ? <span aria-hidden className={cn('size-2 rounded-[2px]', HUE_FILL[project.hue])} /> : <span aria-hidden className="size-2 rounded-[2px] border border-line-input" />}
                  {project?.name ?? 'No project'}
                </div>
                {g.runs.map((run) => (
                  <InFlightRow key={run.id} run={run} agent={run.agentId ? agents[run.agentId] : undefined} />
                ))}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function InFlightRow({ run, agent }: { run: Run; agent?: Tables['agents'][string] }) {
  const navigate = useNavigate()
  const attach = () => attachRun(run.id, 'home')
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
}

// ------------------------------------------------------------------------------------------------ landed

const LANDED_VISIBLE = 4

export function LandedSection() {
  const scope = useScope()
  const notifications = useDB(useShallow((s: Tables) => landedNotifications(s, scope)))
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? notifications : notifications.slice(0, LANDED_VISIBLE)
  const markAllSeen = () => {
    const ids = notifications.map((n) => n.id)
    ids.forEach(markRead)
    toast({ title: `Marked ${ids.length} ${ids.length === 1 ? 'result' : 'results'} seen` })
  }
  return (
    <section aria-labelledby="home-landed">
      <SectionHeader
        id="home-landed"
        title="Landed"
        count={notifications.length}
        action={notifications.length > 0 ? <HeaderLink onClick={markAllSeen}>Mark all seen</HeaderLink> : undefined}
      />
      {notifications.length === 0 ? (
        <QuietLine>Nothing new has landed.</QuietLine>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((n) => (
            <LandedItem key={n.id} notification={n} />
          ))}
          {notifications.length > LANDED_VISIBLE && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="type-caption self-start rounded-sm px-1.5 py-1 font-medium text-ink-3 hover:bg-hover hover:text-ink"
            >
              {expanded ? 'Show fewer' : `Show ${notifications.length - LANDED_VISIBLE} more`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function LandedItem({ notification: n }: { notification: Notification }) {
  const run = useDB((s: Tables) => (n.ref ? runForIn(s, n.ref) : undefined))
  if (!run || !n.ref) return <LandedPlain notification={n} />
  return (
    <LandedCard
      run={run}
      subject={n.ref.kind === 'run' ? undefined : n.ref}
      title={n.title.replace(/^(Completed|Failed): /, '')}
      summary={n.body}
      at={n.createdAt}
      compact
      onSeen={() => markRead(n.id)}
    />
  )
}

/** A landed notification whose run is gone: still openable and dismissible. */
function LandedPlain({ notification: n }: { notification: Notification }) {
  const navigate = useNavigate()
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-md border border-line px-3 py-2.5">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-sm truncate font-medium text-ink">{n.title}</span>
        {n.body && <span className="type-caption truncate text-ink-3">{n.body}</span>}
      </span>
      {n.ref && (
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            markRead(n.id)
            navigate(entityRoute(n.ref as EntityRef))
          }}
        >
          Open
        </Button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ projects

interface ProjectRowData {
  project: Project
  running: number
  waiting: number
  done: number
  total: number
  /** Fraction of tasks that belong to the next milestone or earlier (the milestone tick). */
  milestoneAt: number | null
  milestone?: { title: string; dueAt?: number }
}

function projectRows(s: Tables, scope: ID | null): ProjectRowData[] {
  const projects = Object.values(s.projects)
    .filter((p) => (scope ? p.id === scope : p.status === 'active'))
    .sort((a, b) => Number(!!b.starred) - Number(!!a.starred) || b.updatedAt - a.updatedAt)
  return projects.map((project) => {
    let running = 0
    let waiting = 0
    for (const r of Object.values(s.runs)) {
      if (r.projectId !== project.id) continue
      if (r.status === 'running' || r.status === 'queued') running++
      else if (r.status === 'waiting') waiting++
    }
    const tasks = Object.values(s.tasks).filter((t) => t.projectId === project.id && t.status !== 'cancelled')
    const done = tasks.filter((t) => t.status === 'done').length
    const milestones = [...project.milestones].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
    const next = milestones.find((m) => m.status !== 'done')
    let milestoneAt: number | null = null
    if (next && tasks.length) {
      const upTo = new Set(milestones.slice(0, milestones.indexOf(next) + 1).map((m) => m.id))
      const covered = tasks.filter((t) => t.status === 'done' || (t.milestoneId && upTo.has(t.milestoneId))).length
      milestoneAt = covered / tasks.length
    }
    return { project, running, waiting, done, total: tasks.length, milestoneAt, milestone: next ? { title: next.title, dueAt: next.dueAt } : undefined }
  })
}

export function ProjectsSection() {
  const scope = useScope()
  const navigate = useNavigate()
  const tables = useDB(useShallow((s: Tables) => ({ projects: s.projects, tasks: s.tasks })))
  const activeKey = useDB((s: Tables) =>
    Object.values(s.runs)
      .filter((r) => r.projectId && (r.status === 'running' || r.status === 'queued' || r.status === 'waiting'))
      .map((r) => `${r.projectId}:${r.status === 'waiting' ? 'w' : 'r'}`)
      .sort()
      .join('|'),
  )
  const rows = useMemo(() => projectRows(useDB.getState(), scope), [tables, activeKey, scope])
  return (
    <section aria-labelledby="home-projects">
      <SectionHeader
        id="home-projects"
        title="Projects"
        action={
          <HeaderLink onClick={() => navigate('/projects?new=1')}>
            <Plus aria-hidden className="size-3.5" strokeWidth={2} />
            New project
          </HeaderLink>
        }
      />
      {rows.length === 0 ? (
        <QuietLine>No active projects.</QuietLine>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((r) => (
            <ProjectRow key={r.project.id} data={r} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ProjectRow({ data }: { data: ProjectRowData }) {
  const navigate = useNavigate()
  const { project, running, waiting, done, total, milestoneAt, milestone } = data
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
        className="group/project flex h-[72px] w-full min-w-0 flex-col justify-center gap-1 rounded-sm px-2 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className={cn('size-3 shrink-0 rounded-[3px]', HUE_FILL[project.hue])} />
          <span className="type-body-sm min-w-0 flex-1 truncate font-semibold text-ink">{project.name}</span>
          {(running > 0 || waiting > 0) && (
            <span className="type-meta flex shrink-0 items-center gap-2 text-ink-3">
              {running > 0 && (
                <span aria-label={`${running} running`}>
                  <span aria-hidden className="text-live">
                    ●
                  </span>{' '}
                  {running}
                </span>
              )}
              {waiting > 0 && (
                <span aria-label={`${waiting} need you`}>
                  <span aria-hidden className="text-attn">
                    ◆
                  </span>{' '}
                  {waiting}
                </span>
              )}
            </span>
          )}
        </span>
        <span className="type-caption truncate pl-5 text-ink-3">{project.goal || project.description}</span>
        <span className="flex min-w-0 items-center gap-2.5 pl-5">
          <span className="relative w-24 shrink-0">
            <TickMeter value={done} max={Math.max(1, total)} label={`${project.name} tasks`} valueText={`${done} of ${total} tasks done`} thresholds={{ attn: 2, fail: 3 }} />
            {milestoneAt !== null && milestone && (
              <Tooltip content={`Next milestone: ${milestone.title}${milestone.dueAt ? ` · ${formatDate(milestone.dueAt)}` : ''}`}>
                <span
                  aria-label={`Next milestone ${milestone.title}`}
                  className="absolute -top-[3px] h-[10px] w-[2px] -translate-x-1/2 rounded-[1px] bg-ink"
                  style={{ left: `${Math.min(100, Math.max(0, milestoneAt * 100))}%` }}
                />
              </Tooltip>
            )}
          </span>
          <span className="type-meta shrink-0 text-ink-3 tabular" aria-label={`${done} of ${total} tasks done`}>
            {done}/{total}
          </span>
          <span className="flex-1" />
          {milestone?.dueAt && (
            <Tooltip content={`Next milestone: ${milestone.title}`}>
              <span className="type-meta shrink-0 text-ink-3 tabular" aria-label={`Next milestone ${milestone.title}, due ${formatDate(milestone.dueAt)}`}>
                {formatDate(milestone.dueAt)}
              </span>
            </Tooltip>
          )}
        </span>
      </button>
    </li>
  )
}

// ------------------------------------------------------------------------------------------------ resume

const RESUME_COUNT = 6
const RESUMABLE = new Set<EntityRef['kind']>(['thread', 'session', 'investigation', 'knowledge', 'asset', 'task', 'workflow', 'project', 'agent', 'run'])
/** Without recents, fall back to the work you touched (not runs or agents). */
const FALLBACK_KINDS = new Set<EntityRef['kind']>(['thread', 'session', 'investigation', 'knowledge', 'asset', 'task', 'workflow'])

/** The 6 latest recents; on a fresh world (no recents yet) the items you touched most recently. */
function useResumeRefs(): EntityRef[] {
  const recents = useShellStore((s) => s.recents)
  const fallbackKeys = useDB(
    useShallow((s: Tables) => {
      if (recents.length >= RESUME_COUNT) return [] as string[]
      const events = Object.values(s.activity)
        .filter((e) => e.actor.type === 'user' && FALLBACK_KINDS.has(e.target.kind))
        .sort((a, b) => b.at - a.at)
      const out: string[] = []
      for (const e of events) {
        const key = `${e.target.kind}:${e.target.id}`
        if (!out.includes(key)) out.push(key)
        if (out.length >= RESUME_COUNT * 2) break
      }
      return out
    }),
  )
  return useMemo(() => {
    const out: EntityRef[] = []
    const seen = new Set<string>()
    const push = (r: EntityRef) => {
      const key = `${r.kind}:${r.id}`
      if (seen.has(key) || !RESUMABLE.has(r.kind)) return
      seen.add(key)
      out.push(r)
    }
    recents.forEach(push)
    for (const key of fallbackKeys) {
      const at = key.indexOf(':')
      push({ kind: key.slice(0, at) as EntityRef['kind'], id: key.slice(at + 1) })
    }
    return out
  }, [recents, fallbackKeys])
}

export function ResumeSection() {
  const refs = useResumeRefs()
  const scope = useScope()
  const items = useDB(
    useShallow((s: Tables) =>
      refs
        .map((r) => resolveIn(s, r))
        .filter((e) => e.exists && (!scope || e.projectId === scope || (e.ref.kind === 'project' && e.ref.id === scope)))
        .slice(0, RESUME_COUNT)
        .map((e) => `${e.ref.kind}:${e.ref.id}`),
    ),
  )
  return (
    <section aria-labelledby="home-resume">
      <SectionHeader id="home-resume" title="Resume" />
      {items.length === 0 ? (
        <QuietLine>Things you open will be here to pick up.</QuietLine>
      ) : (
        <ol className="-mx-2 flex flex-col">
          {items.map((key) => (
            <ResumeRow key={key} refKey={key} />
          ))}
        </ol>
      )}
    </section>
  )
}

const WORKSPACE_LABEL: Record<string, string> = {
  chat: 'Chat',
  research: 'Research',
  code: 'Code',
  studio: 'Studio',
  agents: 'Agents',
  workflows: 'Workflows',
  projects: 'Projects',
  knowledge: 'Knowledge',
  integrations: 'Integrations',
}

function ResumeRow({ refKey: key }: { refKey: string }) {
  const navigate = useNavigate()
  const at = key.indexOf(':')
  const ref = useMemo<EntityRef>(() => ({ kind: key.slice(0, at) as EntityRef['kind'], id: key.slice(at + 1) }), [key, at])
  const e = useDB(useShallow((s: Tables) => resolveIn(s, ref)))
  const project = useDB((s: Tables) => (e.projectId ? s.projects[e.projectId] : undefined))
  const scoped = !!useScope()
  const workspace = WORKSPACE_LABEL[KIND_META[ref.kind].workspace] ?? KIND_META[ref.kind].label
  const age = e.updatedAt ? timeAgo(e.updatedAt).replace(' ago', '') : undefined
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(e.route)}
        aria-label={[e.title, workspace, project?.name, age].filter(Boolean).join(', ')}
        className="group/resume flex h-8 w-full min-w-0 items-baseline gap-2 rounded-sm px-2 pt-[7px] text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <span className="type-body-sm min-w-0 shrink truncate text-ink-2 group-hover/resume:text-ink">{e.title}</span>
        <span aria-hidden className="mb-[4px] min-w-4 flex-1 self-end border-b border-dotted border-line-strong" />
        <span aria-hidden className="type-meta flex shrink-0 items-center gap-1.5 text-ink-3">
          {/* The project as its hue square (its name is in the label); omitted while scoped to it. */}
          {project && !scoped && <span title={project.name} className={cn('size-2 rounded-[2px]', HUE_FILL[project.hue])} />}
          <span>{workspace}</span>
          {age && <span>· {age}</span>}
        </span>
      </button>
    </li>
  )
}
