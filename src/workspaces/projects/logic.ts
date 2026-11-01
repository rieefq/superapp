import type { Tables } from '@/core/db'
import { BOARD_STATUSES, PRIORITY_RANK } from '@/core/services/tasks'
import type { EntityRef, ID, Milestone, Priority, Project, Task, TaskStatus } from '@/core/types'

/**
 * Projects' rules — pure functions over rows (filters, board placement, due buckets, the milestone
 * ruler, the timeline axis, lineage and deliverables). Kept free of React so they are unit-tested.
 */

const DAY = 24 * 60 * 60 * 1000

export { BOARD_STATUSES }

// ------------------------------------------------------------------------------------------------ time

/** Local midnight of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Local midnight `n` days after the day containing `ts` (DST-safe). */
export function addDays(ts: number, n: number): number {
  const d = new Date(startOfDay(ts))
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** Local end of a yyyy-mm-dd date (17:00, the same convention as the Start sheet). */
export function dueFromDateInput(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 17, 0, 0).getTime()
}

/** yyyy-mm-dd (local) for a date input. */
export function dateInputValue(ts: number | undefined): string {
  if (ts === undefined) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }

function shortDate(ts: number, now: number): string {
  const d = new Date(ts)
  const opts = d.getFullYear() === new Date(now).getFullYear() ? SHORT_DATE : { ...SHORT_DATE, year: 'numeric' as const }
  return d.toLocaleDateString(undefined, opts)
}

export interface DueInfo {
  /** "Today", "Tomorrow", "Nov 6", "3d overdue". */
  text: string
  /** Past its due time while still open. */
  overdue: boolean
  /** Due today or tomorrow. */
  soon: boolean
}

/** How a due date reads in a row (mono). Done tasks never read as overdue. */
export function dueInfo(dueAt: number, now: number, done = false): DueInfo {
  const today = startOfDay(now)
  const day = startOfDay(dueAt)
  const days = Math.round((day - today) / DAY)
  if (!done && dueAt < now) {
    if (days >= 0) return { text: 'Due earlier today', overdue: true, soon: true }
    const late = -days
    return { text: late === 1 ? '1d overdue' : `${late}d overdue`, overdue: true, soon: false }
  }
  if (days === 0) return { text: 'Today', overdue: false, soon: true }
  if (days === 1) return { text: 'Tomorrow', overdue: false, soon: true }
  return { text: shortDate(dueAt, now), overdue: false, soon: false }
}

// ------------------------------------------------------------------------------------------------ filters

/** `Mine · Delegated · All` (§6.9). Mine = assigned to you or unassigned; Delegated = assigned to an agent. */
export type WhoFilter = 'mine' | 'delegated' | 'all'

export interface TaskFilters {
  who: WhoFilter
  /** A milestone id, 'none' for tasks without one, or null for any. */
  milestone: ID | 'none' | null
  /** 'me', 'unassigned', an agent id, or null for anyone. */
  assignee: 'me' | 'unassigned' | ID | null
  priority: Priority | null
  label: string | null
}

export const NO_FILTERS: TaskFilters = { who: 'all', milestone: null, assignee: null, priority: null, label: null }

export const isMine = (t: Pick<Task, 'assignee'>) => t.assignee === null || t.assignee.type === 'user'
export const isDelegated = (t: Pick<Task, 'assignee'>) => t.assignee?.type === 'agent'

export function matchesFilters(t: Task, f: TaskFilters): boolean {
  if (f.who === 'mine' && !isMine(t)) return false
  if (f.who === 'delegated' && !isDelegated(t)) return false
  if (f.milestone === 'none' ? !!t.milestoneId : f.milestone !== null && t.milestoneId !== f.milestone) return false
  if (f.assignee === 'me' && t.assignee?.type !== 'user') return false
  if (f.assignee === 'unassigned' && t.assignee !== null) return false
  if (f.assignee && f.assignee !== 'me' && f.assignee !== 'unassigned' && !(t.assignee?.type === 'agent' && t.assignee.id === f.assignee)) return false
  if (f.priority && t.priority !== f.priority) return false
  if (f.label && !t.labels.includes(f.label)) return false
  return true
}

/** Filters beyond `who` that narrow the list (for the "Clear" affordance and the count badge). */
export function activeFilterCount(f: TaskFilters): number {
  return [f.milestone, f.assignee, f.priority, f.label].filter((v) => v !== null).length
}

const PRIORITIES: readonly Priority[] = ['urgent', 'high', 'medium', 'low', 'none']

/** Filters live in the URL (`?who=mine&milestone=…&assignee=…&priority=…&label=…`) so views are linkable. */
export function readFilters(params: URLSearchParams): TaskFilters {
  const who = params.get('who')
  const priority = params.get('priority')
  return {
    who: who === 'mine' || who === 'delegated' ? who : 'all',
    milestone: params.get('milestone') || null,
    assignee: params.get('assignee') || null,
    priority: priority && (PRIORITIES as readonly string[]).includes(priority) ? (priority as Priority) : null,
    label: params.get('label') || null,
  }
}

export function writeFilters(params: URLSearchParams, f: TaskFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  const set = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key))
  set('who', f.who === 'all' ? null : f.who)
  set('milestone', f.milestone)
  set('assignee', f.assignee)
  set('priority', f.priority)
  set('label', f.label)
  return next
}

/** Labels used in a set of tasks, most used first. */
export function labelsIn(tasks: readonly Task[]): string[] {
  const counts = new Map<string, number>()
  for (const t of tasks) for (const l of t.labels) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([l]) => l)
}

// ------------------------------------------------------------------------------------------------ board

export const byOrder = (a: Task, b: Task) => a.order - b.order || a.createdAt - b.createdAt

export type BoardColumns = Record<TaskStatus, Task[]>

/** Tasks per column, in kanban order. Cancelled tasks are kept in their own (off-board) list. */
export function boardColumns(tasks: readonly Task[]): BoardColumns {
  const out = { backlog: [], todo: [], in_progress: [], review: [], done: [], cancelled: [] } as BoardColumns
  for (const t of tasks) out[t.status].push(t)
  for (const s of Object.keys(out) as TaskStatus[]) out[s].sort(byOrder)
  return out
}

/**
 * Where a dragged task lands: the id of the task it goes before in the target column (null = the
 * end), given the target index in the column *without* the dragged task.
 */
export function beforeIdAt(column: readonly Task[], draggedId: ID, index: number): ID | null {
  const rest = column.filter((t) => t.id !== draggedId)
  return rest[Math.max(0, index)]?.id ?? null
}

/** A column with the dragged task placed at `index` (for rendering the drop preview). */
export function placeInColumn<T extends { id: ID }>(column: readonly T[], dragged: T, index: number): T[] {
  const rest = column.filter((t) => t.id !== dragged.id)
  const at = Math.min(Math.max(0, index), rest.length)
  return [...rest.slice(0, at), dragged, ...rest.slice(at)]
}

/** Move a keyboard-held card one step: ←/→ change column (keeping the row where possible), ↑/↓ the row. */
export function stepPlacement(
  columns: Record<string, readonly { id: ID }[]>,
  order: readonly string[],
  draggedId: ID,
  at: { status: string; index: number },
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
): { status: string; index: number } {
  const len = (status: string) => (columns[status] ?? []).filter((t) => t.id !== draggedId).length
  if (key === 'ArrowUp') return { status: at.status, index: Math.max(0, at.index - 1) }
  if (key === 'ArrowDown') return { status: at.status, index: Math.min(len(at.status), at.index + 1) }
  const i = order.indexOf(at.status)
  const j = key === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(order.length - 1, i + 1)
  const status = order[j]
  return { status, index: Math.min(at.index, len(status)) }
}

// ------------------------------------------------------------------------------------------------ my tasks

export type DueBucket = 'overdue' | 'today' | 'week' | 'later' | 'none'

export const DUE_BUCKETS: { id: DueBucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'later', label: 'Later' },
  { id: 'none', label: 'No date' },
]

/** Overdue (past due) · Today (rest of today) · This week (the next 7 days) · Later · No date. */
export function dueBucket(dueAt: number | undefined, now: number): DueBucket {
  if (dueAt === undefined) return 'none'
  if (dueAt < now) return 'overdue'
  if (dueAt < addDays(now, 1)) return 'today'
  if (dueAt < addDays(now, 8)) return 'week'
  return 'later'
}

const byDueThenPriority = (a: Task, b: Task) =>
  (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byOrder(a, b)

/** My open tasks grouped by due bucket (empty groups dropped), soonest first, then by priority. */
export function groupByDue(tasks: readonly Task[], now: number): { id: DueBucket; label: string; tasks: Task[] }[] {
  const groups = new Map<DueBucket, Task[]>()
  for (const t of tasks) {
    const b = dueBucket(t.dueAt, now)
    const list = groups.get(b)
    if (list) list.push(t)
    else groups.set(b, [t])
  }
  return DUE_BUCKETS.filter((b) => groups.has(b.id)).map((b) => ({ ...b, tasks: groups.get(b.id)!.sort(byDueThenPriority) }))
}

/** "Overdue and due today" for the index's My tasks card. */
export function urgentTasks(tasks: readonly Task[], now: number): { overdue: Task[]; today: Task[] } {
  const overdue: Task[] = []
  const today: Task[] = []
  for (const t of tasks) {
    const b = dueBucket(t.dueAt, now)
    if (b === 'overdue') overdue.push(t)
    else if (b === 'today') today.push(t)
  }
  return { overdue: overdue.sort(byDueThenPriority), today: today.sort(byDueThenPriority) }
}

// ------------------------------------------------------------------------------------------------ milestones

export interface MilestoneProgress {
  done: number
  total: number
}

/** Done / total (not cancelled) tasks per milestone id (and '' for tasks without one). */
export function milestoneProgress(tasks: readonly Task[]): Map<string, MilestoneProgress> {
  const out = new Map<string, MilestoneProgress>()
  for (const t of tasks) {
    if (t.status === 'cancelled') continue
    const key = t.milestoneId ?? ''
    const p = out.get(key) ?? { done: 0, total: 0 }
    p.total++
    if (t.status === 'done') p.done++
    out.set(key, p)
  }
  return out
}

/**
 * Where the next milestone sits on a task meter: the share of the project's tasks that are done or
 * belong to the next milestone or an earlier one (null when there is no next milestone or no task).
 */
export function milestoneTick(tasks: readonly Task[], project: Pick<Project, 'id' | 'milestones'>): number | null {
  const milestones = [...project.milestones].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  const next = milestones.findIndex((m) => m.status !== 'done')
  if (next < 0) return null
  const upTo = new Set(milestones.slice(0, next + 1).map((m) => m.id))
  let total = 0
  let covered = 0
  for (const t of tasks) {
    if (t.projectId !== project.id || t.status === 'cancelled') continue
    total++
    if (t.status === 'done' || (t.milestoneId && upTo.has(t.milestoneId))) covered++
  }
  return total ? covered / total : null
}

export interface AxisTick {
  at: number
  /** Fraction along the axis (0..1). */
  x: number
  label: string
}

export interface TimeAxis {
  start: number
  end: number
  /** Fraction of the axis where today is (always inside the axis). */
  today: number
  ticks: AxisTick[]
}

/** Fraction of a timestamp along an axis, clamped to [0, 1]. */
export function axisX(axis: Pick<TimeAxis, 'start' | 'end'>, ts: number): number {
  const span = Math.max(1, axis.end - axis.start)
  return Math.min(1, Math.max(0, (ts - axis.start) / span))
}

/**
 * An axis that holds today and every given date with a little air, ticked by week (or by month for
 * long spans). Labels are short local dates.
 */
export function timeAxis(dates: readonly number[], now: number, opts: { padDays?: number; minDays?: number } = {}): TimeAxis {
  const pad = opts.padDays ?? 4
  const minDays = opts.minDays ?? 21
  const all = [...dates, now]
  let start = addDays(Math.min(...all), -pad)
  let end = addDays(Math.max(...all), pad + 1)
  const span = (end - start) / DAY
  if (span < minDays) {
    const extra = Math.ceil((minDays - span) / 2)
    start = addDays(start, -extra)
    end = addDays(end, extra)
  }
  const days = (end - start) / DAY
  const ticks: AxisTick[] = []
  if (days <= 120) {
    // Weekly ticks on Mondays.
    let t = start
    while (new Date(t).getDay() !== 1) t = addDays(t, 1)
    for (; t < end; t = addDays(t, days > 70 ? 14 : 7)) ticks.push({ at: t, x: 0, label: shortDate(t, now) })
  } else {
    const d = new Date(start)
    let t = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
    while (t < end) {
      ticks.push({ at: t, x: 0, label: new Date(t).toLocaleDateString(undefined, { month: 'short' }) })
      const m = new Date(t)
      t = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime()
    }
  }
  const axis = { start, end, today: 0, ticks }
  axis.today = axisX(axis, now)
  for (const tick of ticks) tick.x = axisX(axis, tick.at)
  return axis
}

export interface RulerMark {
  milestone: Milestone
  x: number
}

export interface RulerLayout {
  axis: TimeAxis
  marks: RulerMark[]
  /** Milestones without a due date (listed beside the ruler). */
  undated: Milestone[]
}

/** The milestone ruler (§6.9): square markers at their due dates and a "today" hairline. */
export function rulerLayout(milestones: readonly Milestone[], now: number): RulerLayout | null {
  const dated = milestones.filter((m) => m.dueAt !== undefined).sort((a, b) => a.dueAt! - b.dueAt!)
  const undated = milestones.filter((m) => m.dueAt === undefined)
  if (!dated.length) return undated.length ? { axis: timeAxis([], now), marks: [], undated } : null
  const axis = timeAxis(
    dated.map((m) => m.dueAt!),
    now,
  )
  return { axis, marks: dated.map((m) => ({ milestone: m, x: axisX(axis, m.dueAt!) })), undated }
}

// ------------------------------------------------------------------------------------------------ timeline

export interface TimelineGroup {
  milestone: Milestone | null
  /** Dated tasks of this group, by due date. */
  tasks: Task[]
}

export interface TimelineLayout {
  axis: TimeAxis
  groups: TimelineGroup[]
  /** Open tasks without a due date (not on the axis). */
  undated: number
}

/** Milestones and dated tasks on one time axis, grouped by milestone (by due date), then "No milestone". */
export function timelineLayout(project: Pick<Project, 'milestones'>, tasks: readonly Task[], now: number): TimelineLayout {
  const live = tasks.filter((t) => t.status !== 'cancelled')
  const dated = live.filter((t) => t.dueAt !== undefined)
  const milestones = [...project.milestones].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
  const axis = timeAxis([...dated.map((t) => t.dueAt!), ...milestones.filter((m) => m.dueAt !== undefined).map((m) => m.dueAt!)], now)
  const byMilestone = new Map<string, Task[]>()
  for (const t of dated) {
    const key = t.milestoneId && milestones.some((m) => m.id === t.milestoneId) ? t.milestoneId : ''
    const list = byMilestone.get(key)
    if (list) list.push(t)
    else byMilestone.set(key, [t])
  }
  const sortDue = (list: Task[]) => list.sort((a, b) => a.dueAt! - b.dueAt! || byOrder(a, b))
  const groups: TimelineGroup[] = milestones.map((m) => ({ milestone: m, tasks: sortDue(byMilestone.get(m.id) ?? []) }))
  const loose = byMilestone.get('')
  if (loose?.length) groups.push({ milestone: null, tasks: sortDue(loose) })
  return {
    axis,
    groups: groups.filter((g) => g.tasks.length || g.milestone?.dueAt !== undefined),
    undated: live.filter((t) => t.dueAt === undefined && t.status !== 'done').length,
  }
}

// ------------------------------------------------------------------------------------------------ lineage

const sameRef = (a: EntityRef, b: EntityRef) => a.kind === b.kind && a.id === b.id

/** Where an entity came from, one hop: its recorded origin, else its derived_from / produced link. */
export function originIn(s: Tables, ref: EntityRef): EntityRef | undefined {
  switch (ref.kind) {
    case 'task':
      if (s.tasks[ref.id]?.origin) return s.tasks[ref.id].origin
      break
    case 'run':
      if (s.runs[ref.id]?.origin) return s.runs[ref.id].origin
      break
    case 'investigation':
      if (s.investigations[ref.id]?.origin) return s.investigations[ref.id].origin
      break
    case 'knowledge': {
      const src = s.knowledge[ref.id]?.source.ref
      if (src) return src
      break
    }
    case 'message':
      return undefined
  }
  for (const l of Object.values(s.links)) {
    if (l.rel === 'derived_from' && sameRef(l.from, ref)) return l.to
  }
  for (const l of Object.values(s.links)) {
    if (l.rel === 'produced' && sameRef(l.to, ref)) return l.from
  }
  return undefined
}

/**
 * The provenance chain of an entity, oldest first, excluding the entity itself
 * (e.g. Message → Investigation for a session). Stops at cycles, missing entities and `max` hops.
 */
export function lineageIn(s: Tables, ref: EntityRef, max = 4): EntityRef[] {
  const chain: EntityRef[] = []
  const seen = new Set([`${ref.kind}:${ref.id}`])
  let cur: EntityRef | undefined = originIn(s, ref)
  while (cur && chain.length < max) {
    const key = `${cur.kind}:${cur.id}`
    if (seen.has(key)) break
    seen.add(key)
    chain.unshift({ kind: cur.kind, id: cur.id })
    // A run is plumbing between the work and its origin: keep walking past it.
    cur = originIn(s, cur)
  }
  return chain.filter((r) => r.kind !== 'run' && r.kind !== 'approval')
}

// ------------------------------------------------------------------------------------------------ deliverables

export interface Deliverable {
  ref: EntityRef
  /** "Report", "Pull request #48 (simulated)", "Deck", "Document". */
  kind: string
  /** Provenance, oldest first, ending with the deliverable's own work item. */
  chain: EntityRef[]
  updatedAt: number
  simulated: boolean
}

const ASSET_KIND_WORD: Record<string, string> = { image: 'Image', video: 'Video', presentation: 'Deck', document: 'Document', audio: 'Audio' }

/** Reports, pull requests (simulated), assets and documents of a project, newest first (§6.9 › Work). */
export function deliverablesIn(s: Tables, projectId: ID): Deliverable[] {
  const out: Deliverable[] = []
  for (const inv of Object.values(s.investigations)) {
    if (inv.projectId !== projectId || !inv.report || inv.knowledgeId) continue
    const ref: EntityRef = { kind: 'investigation', id: inv.id }
    out.push({ ref, kind: 'Report', chain: lineageIn(s, ref), updatedAt: inv.updatedAt, simulated: false })
  }
  for (const k of Object.values(s.knowledge)) {
    if (!k.projectIds.includes(projectId) || (k.kind !== 'report' && k.kind !== 'doc')) continue
    const ref: EntityRef = { kind: 'knowledge', id: k.id }
    out.push({ ref, kind: k.kind === 'report' ? 'Report' : 'Document', chain: lineageIn(s, ref), updatedAt: k.updatedAt, simulated: !!k.simulated })
  }
  for (const ses of Object.values(s.sessions)) {
    if (ses.projectId !== projectId || !ses.pr) continue
    const ref: EntityRef = { kind: 'session', id: ses.id }
    out.push({
      ref,
      kind: `Pull request #${ses.pr.number}${ses.pr.simulated ? ' (simulated)' : ''}`,
      chain: lineageIn(s, ref),
      updatedAt: ses.updatedAt,
      simulated: ses.pr.simulated,
    })
  }
  for (const a of Object.values(s.assets)) {
    if (a.projectId !== projectId || a.status !== 'ready') continue
    const ref: EntityRef = { kind: 'asset', id: a.id }
    out.push({ ref, kind: ASSET_KIND_WORD[a.kind] ?? 'Asset', chain: lineageIn(s, ref), updatedAt: a.updatedAt, simulated: a.generator.simulated })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

// ------------------------------------------------------------------------------------------------ project ordering

/** Index order: active work first (active › paused › completed), starred first, then most recently updated. */
export function sortProjects(projects: readonly Project[]): Project[] {
  const rank: Record<Project['status'], number> = { active: 0, paused: 1, completed: 2, archived: 3 }
  return [...projects].sort(
    (a, b) => rank[a.status] - rank[b.status] || Number(!!b.starred) - Number(!!a.starred) || b.updatedAt - a.updatedAt,
  )
}

/** "Active", "Paused", "Completed", "Archived". */
export const PROJECT_STATUS_WORD: Record<Project['status'], string> = {
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  archived: 'Archived',
}
