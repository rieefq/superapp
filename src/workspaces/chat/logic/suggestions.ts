import type { Tables } from '@/core/db'
import type { EntityRef, ID, Investigation, KnowledgeItem, Task } from '@/core/types'

/**
 * Starter prompts for an empty conversation (§6.2), derived from the user's own work — never
 * generated: the newest document to summarize, two related notes to compare, the task that is
 * moving, the latest research. Each suggestion carries the context it attaches when used, so the
 * Context Line shows exactly what the answer will be grounded in.
 */

export type SuggestionKind = 'summarize' | 'compare' | 'task' | 'research' | 'draft' | 'plan'

export interface Suggestion {
  id: string
  kind: SuggestionKind
  prompt: string
  /** The quiet line under the prompt ("Knowledge · Lumen Launch"). */
  meta: string
  /** Attached to the composer's context when the suggestion is used. */
  refs: EntityRef[]
}

const SUMMARIZABLE = new Set<KnowledgeItem['kind']>(['doc', 'report', 'note', 'transcript'])
/** Tags that mark items worth comparing with each other. */
const COMPARE_TAGS = ['competitor', 'competitors', 'competitive', 'vendor', 'vendors', 'alternative', 'alternatives', 'option', 'options']
const TASK_RANK: Partial<Record<Task['status'], number>> = { in_progress: 0, review: 1, todo: 2, backlog: 3 }
const PRIORITY_RANK: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 }

const usable = (k: KnowledgeItem) => k.aiAvailability !== 'never'
const inProject = (projectId: ID | null, ids: readonly ID[]) => !!projectId && ids.includes(projectId)

/** "Atlas Lumen PRD" reads "the Atlas Lumen PRD"; any other title is quoted exactly (“Brand voice guide”). */
export function docPhrase(title: string): string {
  const t = title.trim()
  if (!t) return 'this document'
  const words = t.split(/\s+/)
  const titleCase = words.every((w) => /^[A-Z0-9]/.test(w)) && !/[:“”"(]|\.\w{2,4}$/.test(t)
  if (titleCase && words.length <= 6) return /^the\s/i.test(t) ? t : `the ${t}`
  return `“${t}”`
}

const quote = (s: string) => `“${s.length > 64 ? `${s.slice(0, 63).trimEnd()}…` : s}”`

/** A word from the item's tags that also appears in its title ("tidewell" in "Competitor teardown: Tidewell"). */
function nameFromTags(item: KnowledgeItem, skip: string): string | null {
  for (const tag of item.tags) {
    if (tag === skip || tag.length < 3) continue
    const m = new RegExp(`\\b(${tag.replace(/[^\w-]/g, '')})\\b`, 'i').exec(item.title)
    if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  }
  return null
}

function projectName(s: Tables, id: ID | null | undefined): string | undefined {
  return id ? s.projects[id]?.name : undefined
}

function byRelevance<T extends { updatedAt: number }>(items: T[], inScope: (item: T) => boolean): T[] {
  return [...items].sort((a, b) => Number(inScope(b)) - Number(inScope(a)) || b.updatedAt - a.updatedAt)
}

function summarize(s: Tables, projectId: ID | null, taken: Set<string>): Suggestion | null {
  const items = byRelevance(
    Object.values(s.knowledge).filter((k) => usable(k) && SUMMARIZABLE.has(k.kind) && !taken.has(k.id)),
    (k) => inProject(projectId, k.projectIds),
  )
  const doc = items[0]
  if (!doc) return null
  const where = projectName(s, doc.projectIds[0])
  return {
    id: `summarize:${doc.id}`,
    kind: 'summarize',
    prompt: `Summarize ${docPhrase(doc.title)}`,
    meta: ['Knowledge', where].filter(Boolean).join(' · '),
    refs: [{ kind: 'knowledge', id: doc.id }],
  }
}

function compare(s: Tables, projectId: ID | null, taken: Set<string>): Suggestion | null {
  const items = Object.values(s.knowledge).filter((k) => usable(k) && !taken.has(k.id))
  for (const tag of COMPARE_TAGS) {
    const group = byRelevance(
      items.filter((k) => k.tags.includes(tag)),
      (k) => inProject(projectId, k.projectIds),
    )
    if (group.length < 2) continue
    const [a, b] = group
    const nameA = nameFromTags(a, tag)
    const nameB = nameFromTags(b, tag)
    const prompt = nameA && nameB && nameA !== nameB ? `Compare ${nameA} and ${nameB}` : `Compare ${quote(a.title)} and ${quote(b.title)}`
    const where = projectName(s, a.projectIds[0] ?? b.projectIds[0])
    return {
      id: `compare:${a.id}:${b.id}`,
      kind: 'compare',
      prompt,
      meta: ['2 notes', where].filter(Boolean).join(' · '),
      refs: [
        { kind: 'knowledge', id: a.id },
        { kind: 'knowledge', id: b.id },
      ],
    }
  }
  return null
}

function nextTask(s: Tables, projectId: ID | null): Suggestion | null {
  const open = Object.values(s.tasks).filter((t) => TASK_RANK[t.status] !== undefined && (!projectId || t.projectId === projectId))
  open.sort(
    (a, b) =>
      (TASK_RANK[a.status] ?? 9) - (TASK_RANK[b.status] ?? 9) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) ||
      b.updatedAt - a.updatedAt,
  )
  const task = open[0]
  if (!task) return null
  const status = task.status === 'in_progress' ? 'In progress' : task.status === 'review' ? 'In review' : task.status === 'todo' ? 'To do' : 'Backlog'
  return {
    id: `task:${task.id}`,
    kind: 'task',
    prompt: `Break down ${quote(task.title)} into next steps`,
    meta: ['Task', status, projectName(s, task.projectId)].filter(Boolean).join(' · '),
    refs: [{ kind: 'task', id: task.id }],
  }
}

function latestResearch(s: Tables, projectId: ID | null): Suggestion | null {
  const done = byRelevance(
    Object.values(s.investigations).filter((i: Investigation) => i.status === 'complete' || i.status === 'review'),
    (i) => !!projectId && i.projectId === projectId,
  )
  const inv = done.find((i) => !projectId || i.projectId === projectId) ?? (projectId ? undefined : done[0])
  if (!inv) return null
  return {
    id: `research:${inv.id}`,
    kind: 'research',
    prompt: `Summarize the findings of ${quote(inv.title)}`,
    meta: ['Research', projectName(s, inv.projectId)].filter(Boolean).join(' · '),
    refs: [{ kind: 'investigation', id: inv.id }],
  }
}

function statusUpdate(s: Tables, projectId: ID | null): Suggestion | null {
  const project = projectId ? s.projects[projectId] : undefined
  if (!project) return null
  return {
    id: `draft:${project.id}`,
    kind: 'draft',
    prompt: `Draft a short status update for ${project.name}`,
    meta: 'Project memory',
    refs: [{ kind: 'project', id: project.id }],
  }
}

/** Generic starters for an empty world; nothing pretends to come from data that does not exist. */
const GENERIC: Suggestion[] = [
  { id: 'plan:week', kind: 'plan', prompt: 'Plan my week around three priorities', meta: 'A blank start', refs: [] },
  { id: 'draft:update', kind: 'draft', prompt: 'Draft a weekly update for my team', meta: 'A blank start', refs: [] },
  { id: 'plan:explain', kind: 'plan', prompt: 'Explain a technical idea in plain language', meta: 'A blank start', refs: [] },
  { id: 'plan:decide', kind: 'plan', prompt: 'Help me weigh a decision with pros and cons', meta: 'A blank start', refs: [] },
]

/** Up to `limit` distinct suggestions for the scope (null = all work). */
export function deriveSuggestions(s: Tables, projectId: ID | null, limit = 4): Suggestion[] {
  const out: Suggestion[] = []
  const taken = new Set<string>()
  const add = (sug: Suggestion | null) => {
    if (!sug || out.length >= limit || out.some((o) => o.id === sug.id)) return
    out.push(sug)
    for (const r of sug.refs) taken.add(r.id)
  }
  // Compare first so its pair is not split by the summary pick; summary second.
  const cmp = compare(s, projectId, taken)
  add(summarize(s, projectId, new Set(cmp?.refs.map((r) => r.id))))
  add(cmp)
  add(nextTask(s, projectId))
  add(latestResearch(s, projectId))
  add(statusUpdate(s, projectId))
  // Still short (an empty project): fill from all work, then generic starters.
  if (projectId && out.length < limit) {
    add(summarize(s, null, taken))
    add(nextTask(s, null))
    add(latestResearch(s, null))
  }
  for (const g of GENERIC) add(g)
  // Keep the visual order stable: summarize, compare, task, research, draft, plan.
  const rank: Record<SuggestionKind, number> = { summarize: 0, compare: 1, task: 2, research: 3, draft: 4, plan: 5 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind])
}
