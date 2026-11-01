import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { db, ID_PREFIX, useDB, useRow, useRows, type Tables } from '@/core/db'
import { getContext } from '@/core/context'
import {
  ME,
  isRunActive,
  sameRef,
  type ActorRef,
  type Approval,
  type Asset,
  type CodeSession,
  type EntityRef,
  type Hue,
  type ID,
  type Investigation,
  type KnowledgeItem,
  type Milestone,
  type Project,
  type ProjectStatus,
  type Run,
  type Task,
  type Thread,
  type Workflow,
} from '@/core/types'
import { newId } from '@/lib/id'
import { logActivity } from './activity'
import { describeRef } from './entities'
import { changedKeys, forgetRef, forgetRefs, leastUsedHue, memoOnTable, timeBucket, updateRows } from './serviceHelpers'

const projectRef = (id: ID): EntityRef => ({ kind: 'project', id })

// ---------------------------------------------------------------- mutations

export interface CreateProjectInput {
  name: string
  description?: string
  goal?: string
  hue?: Hue
  icon?: string
  instructions?: string
  status?: ProjectStatus
}

export function createProject(input: CreateProjectInput): Project {
  const now = Date.now()
  const name = input.name.trim() || 'Untitled project'
  const project: Project = {
    id: newId(ID_PREFIX.projects),
    name,
    description: input.description?.trim() ?? '',
    goal: input.goal?.trim() || undefined,
    instructions: input.instructions?.trim() || undefined,
    hue: input.hue ?? leastUsedHue(db.all('projects').filter((p) => p.status !== 'archived').map((p) => p.hue)),
    icon: input.icon || 'Folder',
    status: input.status ?? 'active',
    milestones: [],
    pinnedRefs: [],
    repoIds: [],
    createdAt: now,
    updatedAt: now,
  }
  db.insert('projects', project)
  logActivity({ actor: ME, verb: 'created', target: projectRef(project.id), summary: `Created project “${name}”`, projectId: project.id })
  return project
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'description' | 'goal' | 'instructions' | 'hue' | 'icon' | 'repoIds'>>

export function updateProject(id: ID, patch: ProjectPatch): Project | undefined {
  const cur = db.get('projects', id)
  if (!cur) return undefined
  const clean: ProjectPatch = { ...patch }
  if (clean.name !== undefined) clean.name = clean.name.trim() || cur.name
  const fields = changedKeys(cur, clean)
  if (!fields.length) return cur
  const next = db.update('projects', id, { ...clean, updatedAt: Date.now() })
  const renamed = fields.includes('name')
  logActivity({
    actor: ME,
    verb: renamed ? 'renamed' : 'updated',
    target: projectRef(id),
    summary: renamed ? `Renamed project “${cur.name}” to “${clean.name}”` : `Updated ${fields.join(', ')} of project “${cur.name}”`,
    projectId: id,
    meta: { fields },
  })
  return next
}

const STATUS_VERB: Record<ProjectStatus, string> = {
  active: 'reactivated',
  paused: 'paused',
  completed: 'completed',
  archived: 'archived',
}

export function setProjectStatus(id: ID, status: ProjectStatus): Project | undefined {
  const cur = db.get('projects', id)
  if (!cur || cur.status === status) return cur
  const next = db.update('projects', id, { status, updatedAt: Date.now() })
  const verb = STATUS_VERB[status]
  logActivity({
    actor: ME,
    verb,
    target: projectRef(id),
    summary: `${verb[0].toUpperCase()}${verb.slice(1)} project “${cur.name}”`,
    projectId: id,
    meta: { from: cur.status, to: status },
  })
  return next
}

export function toggleStar(id: ID): Project | undefined {
  const cur = db.get('projects', id)
  if (!cur) return undefined
  const starred = !cur.starred
  const next = db.update('projects', id, { starred })
  logActivity({
    actor: ME,
    verb: starred ? 'starred' : 'unstarred',
    target: projectRef(id),
    summary: `${starred ? 'Starred' : 'Unstarred'} project “${cur.name}”`,
    projectId: id,
  })
  return next
}

/**
 * Delete a project. Everything that belonged to it is kept but detached (projectId → null);
 * tasks are deleted only when `deleteTasks` is set, otherwise they become unassigned to a project.
 */
export function deleteProject(id: ID, opts: { deleteTasks?: boolean } = {}): void {
  const project = db.get('projects', id)
  if (!project) return
  const tasks = db.filter('tasks', (t) => t.projectId === id)
  if (opts.deleteTasks) {
    forgetRefs(tasks.map((t) => ({ kind: 'task' as const, id: t.id })))
    db.removeMany('tasks', tasks.map((t) => t.id))
  } else {
    updateRows('tasks', (t) => t.projectId === id, (t) => ({ ...t, projectId: null, milestoneId: undefined }))
  }
  const detach = <R extends { projectId: ID | null }>(row: R): R => ({ ...row, projectId: null })
  updateRows('threads', (r) => r.projectId === id, detach)
  updateRows('investigations', (r) => r.projectId === id, detach)
  updateRows('sessions', (r) => r.projectId === id, detach)
  updateRows('assets', (r) => r.projectId === id, detach)
  updateRows('workflows', (r) => r.projectId === id, detach)
  updateRows('runs', (r) => r.projectId === id, detach)
  updateRows('repos', (r) => r.projectId === id, detach)
  updateRows('boards', (r) => r.projectId === id, detach)
  updateRows('knowledge', (k) => k.projectIds.includes(id), (k) => ({ ...k, projectIds: k.projectIds.filter((p) => p !== id) }))
  updateRows(
    'agents',
    (a) => a.knowledgeScope.projectIds.includes(id),
    (a) => ({ ...a, knowledgeScope: { ...a.knowledgeScope, projectIds: a.knowledgeScope.projectIds.filter((p) => p !== id) } }),
  )
  forgetRef(projectRef(id))
  const ctx = getContext()
  if (ctx.scopeProjectId === id) ctx.setScope(null)
  db.remove('projects', id)
  logActivity({
    actor: ME,
    verb: 'deleted',
    target: projectRef(id),
    summary: opts.deleteTasks && tasks.length
      ? `Deleted project “${project.name}” and ${tasks.length} task${tasks.length === 1 ? '' : 's'}`
      : `Deleted project “${project.name}”`,
    projectId: null,
    meta: { tasks: tasks.length, deleteTasks: !!opts.deleteTasks },
  })
}

/**
 * Archive a project. The scope never stays on an archived project, so it returns to All work.
 * Returns the previous status (for Undo), or undefined when nothing changed.
 */
export function archiveProject(id: ID): { previous: ProjectStatus; wasScope: boolean } | undefined {
  const cur = db.get('projects', id)
  if (!cur || cur.status === 'archived') return undefined
  const ctx = getContext()
  const wasScope = ctx.scopeProjectId === id
  if (wasScope) ctx.setScope(null)
  setProjectStatus(id, 'archived')
  return { previous: cur.status, wasScope }
}

// ---------------------------------------------------------------- milestones

/** Milestones by due date (undated last), keeping the stored order for ties. */
export function milestonesByDue(project: Pick<Project, 'milestones'>): Milestone[] {
  return project.milestones
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.dueAt ?? Infinity) - (b.m.dueAt ?? Infinity) || a.i - b.i)
    .map((x) => x.m)
}

/** The next milestone that is not done, by due date. */
export function nextMilestone(project: Pick<Project, 'milestones'>): Milestone | undefined {
  return milestonesByDue(project).find((m) => m.status !== 'done')
}

export interface MilestoneInput {
  title: string
  description?: string
  dueAt?: number
  status?: Milestone['status']
}

export function addMilestone(projectId: ID, input: MilestoneInput): Milestone | undefined {
  const project = db.get('projects', projectId)
  if (!project) return undefined
  const milestone: Milestone = {
    id: newId('mst'),
    title: input.title.trim() || 'Untitled milestone',
    description: input.description?.trim() || undefined,
    dueAt: input.dueAt,
    status: input.status ?? 'upcoming',
  }
  db.update('projects', projectId, { milestones: [...project.milestones, milestone], updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'created',
    target: projectRef(projectId),
    summary: `Added milestone “${milestone.title}” to “${project.name}”`,
    projectId,
    meta: { milestoneId: milestone.id },
  })
  return milestone
}

export function updateMilestone(projectId: ID, milestoneId: ID, patch: Partial<Omit<Milestone, 'id'>>): Milestone | undefined {
  const project = db.get('projects', projectId)
  const cur = project?.milestones.find((m) => m.id === milestoneId)
  if (!project || !cur) return undefined
  const fields = changedKeys(cur, patch)
  if (!fields.length) return cur
  const next: Milestone = { ...cur, ...patch }
  db.update('projects', projectId, {
    milestones: project.milestones.map((m) => (m.id === milestoneId ? next : m)),
    updatedAt: Date.now(),
  })
  const completed = patch.status === 'done' && cur.status !== 'done'
  logActivity({
    actor: ME,
    verb: completed ? 'completed' : 'updated',
    target: projectRef(projectId),
    summary: completed ? `Completed milestone “${next.title}”` : `Updated milestone “${next.title}”`,
    projectId,
    meta: { milestoneId, fields },
  })
  return next
}

export function removeMilestone(projectId: ID, milestoneId: ID): void {
  const project = db.get('projects', projectId)
  const cur = project?.milestones.find((m) => m.id === milestoneId)
  if (!project || !cur) return
  db.update('projects', projectId, { milestones: project.milestones.filter((m) => m.id !== milestoneId), updatedAt: Date.now() })
  updateRows('tasks', (t) => t.milestoneId === milestoneId, (t) => ({ ...t, milestoneId: undefined }))
  logActivity({
    actor: ME,
    verb: 'deleted',
    target: projectRef(projectId),
    summary: `Removed milestone “${cur.title}” from “${project.name}”`,
    projectId,
    meta: { milestoneId },
  })
}

// ---------------------------------------------------------------- project memory

/** Pin an entity to the project's memory (always in context while the project is in scope). */
export function pinToProject(projectId: ID, ref: EntityRef): void {
  const project = db.get('projects', projectId)
  if (!project || project.pinnedRefs.some((r) => sameRef(r, ref))) return
  db.update('projects', projectId, { pinnedRefs: [...project.pinnedRefs, { kind: ref.kind, id: ref.id }], updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'pinned',
    target: projectRef(projectId),
    summary: `Pinned ${describeRef(ref)} to “${project.name}” memory`,
    projectId,
    meta: { ref },
  })
}

export function unpinFromProject(projectId: ID, ref: EntityRef): void {
  const project = db.get('projects', projectId)
  if (!project || !project.pinnedRefs.some((r) => sameRef(r, ref))) return
  db.update('projects', projectId, { pinnedRefs: project.pinnedRefs.filter((r) => !sameRef(r, ref)), updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'unpinned',
    target: projectRef(projectId),
    summary: `Removed ${describeRef(ref)} from “${project.name}” memory`,
    projectId,
    meta: { ref },
  })
}

// ---------------------------------------------------------------- stats (pure + memoized)

export interface ProjectTaskStats {
  /** Tasks that are not cancelled. */
  total: number
  done: number
  inProgress: number
  review: number
  /** Open tasks whose due date has passed. */
  overdue: number
}

export interface ProjectStats {
  tasks: ProjectTaskStats
  activeRuns: number
  threads: number
  knowledge: number
  sessions: number
  investigations: number
  assets: number
  workflows: number
  lastActivityAt?: number
  /** done / total (0 when there are no tasks). */
  progress: number
}

const EMPTY_TASK_STATS: ProjectTaskStats = { total: 0, done: 0, inProgress: 0, review: 0, overdue: 0 }

function countBy<T>(table: Record<ID, T>, key: string, projectsOf: (row: T) => readonly (ID | null)[]): Map<ID, number> {
  return memoOnTable(table, `countBy:${key}`, () => {
    const counts = new Map<ID, number>()
    for (const row of Object.values(table)) {
      for (const p of projectsOf(row)) if (p) counts.set(p, (counts.get(p) ?? 0) + 1)
    }
    return counts
  })
}

function taskStats(tasks: Tables['tasks'], now: number): Map<ID, ProjectTaskStats> {
  return memoOnTable(tasks, `taskStats:${timeBucket(60_000, now)}`, () => {
    const out = new Map<ID, ProjectTaskStats>()
    for (const t of Object.values(tasks)) {
      if (!t.projectId || t.status === 'cancelled') continue
      const s = out.get(t.projectId) ?? { ...EMPTY_TASK_STATS }
      s.total++
      if (t.status === 'done') s.done++
      else if (t.status === 'in_progress') s.inProgress++
      else if (t.status === 'review') s.review++
      if (t.status !== 'done' && t.dueAt !== undefined && t.dueAt < now) s.overdue++
      out.set(t.projectId, s)
    }
    return out
  })
}

function lastActivity(activity: Tables['activity']): Map<ID, number> {
  return memoOnTable(activity, 'lastActivity', () => {
    const out = new Map<ID, number>()
    for (const e of Object.values(activity)) {
      if (e.projectId && e.at > (out.get(e.projectId) ?? 0)) out.set(e.projectId, e.at)
    }
    return out
  })
}

/** Project statistics computed from a database snapshot (cheap: per-table indexes are memoized). */
export function computeProjectStats(s: Tables, projectId: ID, now = Date.now()): ProjectStats {
  const tasks = taskStats(s.tasks, now).get(projectId) ?? EMPTY_TASK_STATS
  const single = (projectId: ID | null) => [projectId]
  const activeRuns = memoOnTable(s.runs, 'activeRunsByProject', () => {
    const m = new Map<ID, number>()
    for (const r of Object.values(s.runs)) if (r.projectId && isRunActive(r.status)) m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1)
    return m
  })
  const lastActivityAt = lastActivity(s.activity).get(projectId) ?? s.projects[projectId]?.updatedAt
  return {
    tasks: { ...tasks },
    activeRuns: activeRuns.get(projectId) ?? 0,
    threads: countBy(s.threads, 'threads', (t) => single(t.projectId)).get(projectId) ?? 0,
    knowledge: countBy(s.knowledge, 'knowledge', (k) => k.projectIds).get(projectId) ?? 0,
    sessions: countBy(s.sessions, 'sessions', (x) => single(x.projectId)).get(projectId) ?? 0,
    investigations: countBy(s.investigations, 'investigations', (x) => single(x.projectId)).get(projectId) ?? 0,
    assets: countBy(s.assets, 'assets', (x) => single(x.projectId)).get(projectId) ?? 0,
    workflows: countBy(s.workflows, 'workflows', (x) => single(x.projectId)).get(projectId) ?? 0,
    lastActivityAt,
    progress: tasks.total ? tasks.done / tasks.total : 0,
  }
}

// ---------------------------------------------------------------- live signals (pure + memoized)

export interface ProjectSignal {
  /** Runs queued or running in the project. */
  running: number
  /** Runs waiting on an approval. */
  waiting: number
  /** What needs a decision from you: pending approvals + sessions in review + agent work in review (§3.8). */
  needsYou: number
}

const NO_SIGNAL: ProjectSignal = { running: 0, waiting: 0, needsYou: 0 }

/** One-entry memo keyed on several tables' identities (tables are replaced on every write). */
function memoOnTables<R>(cache: { keys: readonly object[]; value: R } | null, keys: readonly object[], compute: () => R): { keys: readonly object[]; value: R } {
  if (cache && cache.keys.length === keys.length && cache.keys.every((k, i) => k === keys[i])) return cache
  return { keys, value: compute() }
}

let signalCache: { keys: readonly object[]; value: Map<ID, ProjectSignal> } | null = null

/** Per-project live signals for every project, computed once per relevant table change. */
export function computeProjectSignals(s: Pick<Tables, 'runs' | 'approvals' | 'sessions' | 'tasks'>): Map<ID, ProjectSignal> {
  signalCache = memoOnTables(signalCache, [s.runs, s.approvals, s.sessions, s.tasks], () => {
    const out = new Map<ID, ProjectSignal>()
    const get = (id: ID) => {
      let v = out.get(id)
      if (!v) out.set(id, (v = { running: 0, waiting: 0, needsYou: 0 }))
      return v
    }
    for (const r of Object.values(s.runs)) {
      if (!r.projectId) continue
      if (r.status === 'running' || r.status === 'queued') get(r.projectId).running++
      else if (r.status === 'waiting') get(r.projectId).waiting++
    }
    for (const a of Object.values(s.approvals)) {
      const pid = a.status === 'pending' ? s.runs[a.runId]?.projectId : null
      if (pid) get(pid).needsYou++
    }
    const reviewedBySession = new Set<ID>()
    for (const ses of Object.values(s.sessions)) {
      if (ses.status !== 'needs_review') continue
      if (ses.taskId) reviewedBySession.add(ses.taskId)
      if (ses.projectId) get(ses.projectId).needsYou++
    }
    for (const t of Object.values(s.tasks)) {
      if (t.status !== 'review' || !t.projectId || reviewedBySession.has(t.id)) continue
      const last = t.runIds.length ? s.runs[t.runIds[t.runIds.length - 1]] : undefined
      if (last?.agentId) get(t.projectId).needsYou++
    }
    return out
  })
  return signalCache.value
}

export function computeProjectSignal(s: Pick<Tables, 'runs' | 'approvals' | 'sessions' | 'tasks'>, projectId: ID): ProjectSignal {
  return computeProjectSignals(s).get(projectId) ?? NO_SIGNAL
}

/** Live signals of one project; re-renders only when one of its numbers changes. */
export function useProjectSignal(projectId: ID): ProjectSignal {
  return useDB(useShallow((s: Tables) => computeProjectSignal(s, projectId)))
}

export interface ProjectNeedsYou {
  approvals: Approval[]
  sessions: CodeSession[]
  /** Tasks in Review whose last run was an agent's (sessions in review already cover their tasks). */
  tasks: Task[]
}

/** The decisions waiting on you in one project, in the Needs-you order (risk high → low, then oldest). */
export function computeProjectNeedsYou(s: Tables, projectId: ID): ProjectNeedsYou {
  const risk = { high: 0, medium: 1, low: 2 } as const
  const approvals = Object.values(s.approvals)
    .filter((a) => a.status === 'pending' && s.runs[a.runId]?.projectId === projectId)
    .sort((a, b) => risk[a.risk] - risk[b.risk] || a.createdAt - b.createdAt)
  const sessions = Object.values(s.sessions)
    .filter((x) => x.status === 'needs_review' && x.projectId === projectId)
    .sort((a, b) => a.updatedAt - b.updatedAt)
  const covered = new Set(sessions.map((x) => x.taskId).filter(Boolean))
  const tasks = Object.values(s.tasks)
    .filter((t) => {
      if (t.status !== 'review' || t.projectId !== projectId || covered.has(t.id)) return false
      const last = t.runIds.length ? s.runs[t.runIds[t.runIds.length - 1]] : undefined
      return !!last?.agentId
    })
    .sort((a, b) => a.updatedAt - b.updatedAt)
  return { approvals, sessions, tasks }
}

// ---------------------------------------------------------------- members and spend

export interface ProjectMember {
  actor: ActorRef
  /** Open tasks assigned to this member in the project. */
  openTasks: number
  /** Runs of this member in the project that are active right now. */
  activeRuns: number
}

/**
 * Who works in a project: you, then every agent with tasks or runs in it (most open tasks first).
 * Members are derived from the work; there is no separate membership list.
 */
export function computeProjectMembers(s: Pick<Tables, 'tasks' | 'runs' | 'agents'>, projectId: ID, now = Date.now()): ProjectMember[] {
  const agents = new Map<ID, ProjectMember>()
  const me: ProjectMember = { actor: ME, openTasks: 0, activeRuns: 0 }
  const agent = (id: ID) => {
    if (!s.agents[id] || s.agents[id].status === 'archived') return undefined
    let m = agents.get(id)
    if (!m) agents.set(id, (m = { actor: { type: 'agent', id }, openTasks: 0, activeRuns: 0 }))
    return m
  }
  for (const t of Object.values(s.tasks)) {
    if (t.projectId !== projectId || t.status === 'cancelled') continue
    const open = t.status !== 'done'
    if (t.assignee?.type === 'agent') {
      const m = agent(t.assignee.id)
      if (m && open) m.openTasks++
    } else if (open && (t.assignee === null || t.assignee.type === 'user')) {
      me.openTasks++
    }
  }
  const since = now - 30 * 24 * 60 * 60 * 1000
  for (const r of Object.values(s.runs)) {
    if (r.projectId !== projectId || !r.agentId || r.createdAt < since) continue
    const m = agent(r.agentId)
    if (m && isRunActive(r.status)) m.activeRuns++
  }
  const list = [...agents.values()].sort(
    (a, b) => b.activeRuns - a.activeRuns || b.openTasks - a.openTasks || (s.agents[a.actor.id]?.name ?? '').localeCompare(s.agents[b.actor.id]?.name ?? ''),
  )
  return [me, ...list]
}

export interface ProjectSpend {
  /** Live (real API) spend this calendar month, USD. */
  liveUsd: number
  /** Simulated runs' estimated cost this month (reference pricing; no money was spent). */
  estimatedUsd: number
  /** Runs counted this month. */
  runs: number
}

/** Month-to-date spend of a project, split into live spend and the simulated estimate. */
export function computeProjectSpend(runs: Tables['runs'], projectId: ID, now = Date.now()): ProjectSpend {
  const d = new Date(now)
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  let liveUsd = 0
  let estimatedUsd = 0
  let count = 0
  for (const r of Object.values(runs)) {
    if (r.projectId !== projectId || r.createdAt < monthStart) continue
    count++
    if (r.simulated) estimatedUsd += r.usage.costUsd
    else liveUsd += r.usage.costUsd
  }
  return { liveUsd, estimatedUsd, runs: count }
}

/** Month-to-date spend, re-read at most once a minute while runs stream. */
export function useProjectSpend(projectId: ID): ProjectSpend {
  return useDB(useShallow((s: Tables) => memoOnTable(s.runs, `spend:${projectId}:${timeBucket(60_000)}`, () => computeProjectSpend(s.runs, projectId))))
}

// ---------------------------------------------------------------- hooks

export function useProject(id: ID | null | undefined): Project | undefined {
  return useRow('projects', id)
}

/** Projects, starred first, then most recently updated. */
export function useProjects(opts: { status?: ProjectStatus | ProjectStatus[] } = {}): Project[] {
  const statuses = opts.status === undefined ? undefined : Array.isArray(opts.status) ? opts.status : [opts.status]
  return useRows(
    'projects',
    statuses ? (p) => statuses.includes(p.status) : undefined,
    (a, b) => Number(!!b.starred) - Number(!!a.starred) || b.updatedAt - a.updatedAt,
  )
}

export function useProjectStats(projectId: ID): ProjectStats {
  const flat = useDB(
    useShallow((s: Tables) => {
      const { tasks, ...rest } = computeProjectStats(s, projectId)
      return { ...rest, ...tasks, tasksTotal: tasks.total }
    }),
  )
  return useMemo<ProjectStats>(
    () => ({
      tasks: { total: flat.tasksTotal, done: flat.done, inProgress: flat.inProgress, review: flat.review, overdue: flat.overdue },
      activeRuns: flat.activeRuns,
      threads: flat.threads,
      knowledge: flat.knowledge,
      sessions: flat.sessions,
      investigations: flat.investigations,
      assets: flat.assets,
      workflows: flat.workflows,
      lastActivityAt: flat.lastActivityAt,
      progress: flat.progress,
    }),
    [flat],
  )
}

export interface ProjectItems {
  threads: Thread[]
  knowledge: KnowledgeItem[]
  investigations: Investigation[]
  sessions: CodeSession[]
  assets: Asset[]
  workflows: Workflow[]
  runs: Run[]
}

const byUpdated = (a: { updatedAt: number }, b: { updatedAt: number }) => b.updatedAt - a.updatedAt
const runTime = (r: Run) => r.endedAt ?? r.startedAt ?? r.createdAt

/** Everything that belongs to a project, each list sorted most recent first. */
export function useProjectItems(projectId: ID): ProjectItems {
  const threads = useRows('threads', (t) => t.projectId === projectId, byUpdated)
  const knowledge = useRows('knowledge', (k) => k.projectIds.includes(projectId), byUpdated)
  const investigations = useRows('investigations', (i) => i.projectId === projectId, byUpdated)
  const sessions = useRows('sessions', (s) => s.projectId === projectId, byUpdated)
  const assets = useRows('assets', (a) => a.projectId === projectId, byUpdated)
  const workflows = useRows('workflows', (w) => w.projectId === projectId, byUpdated)
  const runs = useRows('runs', (r) => r.projectId === projectId, (a, b) => runTime(b) - runTime(a))
  return useMemo(
    () => ({ threads, knowledge, investigations, sessions, assets, workflows, runs }),
    [threads, knowledge, investigations, sessions, assets, workflows, runs],
  )
}
