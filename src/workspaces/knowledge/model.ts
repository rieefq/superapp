import type { Tables } from '@/core/db'
import { classifyFile, KNOWLEDGE_KIND_META, plainText } from '@/core/services'
import type { ID, KnowledgeItem, KnowledgeKind, KnowledgeSourceType } from '@/core/types'

/**
 * Knowledge library model (pure): the URL state of the library, the list-pane sections, the smart
 * filters, facets and sorting. The views render what this decides; tests cover it without React.
 */

// ------------------------------------------------------------------------------------------------ sections

export type SmartFilter = 'recent' | 'held' | 'memory' | 'research' | 'uploads' | 'chat' | 'agents' | 'simulated'

export interface SmartFilterMeta {
  id: SmartFilter
  label: string
  /** One line for the tooltip, the stage header and the empty state. */
  description: string
  /** Empty state for the filter. */
  empty: string
}

/** Smart filters, in the list pane's order (§6.7). */
export const SMART_FILTERS: readonly SmartFilterMeta[] = [
  { id: 'recent', label: 'Recent', description: 'Added or edited in the last 7 days.', empty: 'Nothing was added or edited in the last 7 days.' },
  { id: 'held', label: 'Held', description: 'Held items ride along in every new AI action.', empty: 'Nothing is held. Hold an item with H and it rides along in every new AI action.' },
  { id: 'memory', label: 'Project memory', description: 'Part of a project’s memory: read in every run of that project.', empty: 'No knowledge is in project memory. Use ⋯ › Add to project memory on an item.' },
  { id: 'research', label: 'From research', description: 'Reports and notes saved from Research.', empty: 'Nothing saved from Research yet. Save a report to keep it here.' },
  { id: 'uploads', label: 'Uploads', description: 'Files read from your computer — read locally, never uploaded.', empty: 'No uploads yet. Drop files anywhere here, or use Upload.' },
  { id: 'chat', label: 'From chat', description: 'Answers, notes and files saved from conversations.', empty: 'Nothing saved from Chat yet. Press S on a message to save it here.' },
  { id: 'agents', label: 'From agents', description: 'Written by agents while they worked.', empty: 'No agent has saved anything here yet.' },
  { id: 'simulated', label: 'Simulated', description: 'Produced by Atrium’s local simulator. No model was called.', empty: 'Nothing here was produced by the simulator.' },
]

export const SMART_FILTER_META = Object.fromEntries(SMART_FILTERS.map((f) => [f.id, f])) as Record<SmartFilter, SmartFilterMeta>

/** What the list pane selects: everything, a collection (null = no collection), a smart filter or a tag. */
export type Section =
  | { type: 'all' }
  | { type: 'collection'; id: ID | null }
  | { type: 'filter'; id: SmartFilter }
  | { type: 'tag'; tag: string }

export const NO_COLLECTION = 'none'

export function sameSection(a: Section, b: Section): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'collection' && b.type === 'collection') return a.id === b.id
  if (a.type === 'filter' && b.type === 'filter') return a.id === b.id
  if (a.type === 'tag' && b.type === 'tag') return a.tag === b.tag
  return true
}

// ------------------------------------------------------------------------------------------------ facets

/** Source facet values (KnowledgeSourceType) with their user-facing words. */
export const SOURCE_LABEL: Record<KnowledgeSourceType, string> = {
  manual: 'Added by hand',
  upload: 'Uploads',
  web: 'Web',
  research: 'Research',
  chat: 'Chat',
  agent: 'Agents',
  integration: 'Integrations',
  studio: 'Studio',
  code: 'Code',
}

export const SOURCE_ORDER: readonly KnowledgeSourceType[] = ['manual', 'upload', 'research', 'chat', 'agent', 'integration', 'studio', 'code', 'web']
export const KIND_ORDER: readonly KnowledgeKind[] = ['note', 'doc', 'report', 'file', 'link', 'snippet', 'dataset', 'transcript']

export type SortKey = 'updated' | 'title' | 'used' | 'relevance'
export type ViewMode = 'list' | 'grid'

export const SORT_LABEL: Record<SortKey, string> = {
  updated: 'Updated',
  title: 'Title',
  used: 'Most used',
  relevance: 'Relevance',
}

export interface LibraryQuery {
  section: Section
  q: string
  kinds: KnowledgeKind[]
  sources: KnowledgeSourceType[]
  /** A project id, 'none' (items without a project) or null (any). */
  project: ID | 'none' | null
  /** Explicit sort; null = the default (relevance while searching, otherwise updated). */
  sort: SortKey | null
}

const KINDS = new Set<string>(Object.keys(KNOWLEDGE_KIND_META))
const SOURCES = new Set<string>(Object.keys(SOURCE_LABEL))
const FILTERS = new Set<string>(SMART_FILTERS.map((f) => f.id))
const SORTS = new Set<string>(['updated', 'title', 'used', 'relevance'])

const list = (value: string | null) => (value ? value.split(',').map((s) => s.trim()).filter(Boolean) : [])

/** Read the library state from the URL (`?collection= ?filter= ?tag= ?q= ?kind= ?source= ?project= ?sort=`). */
export function parseLibraryParams(params: URLSearchParams): LibraryQuery {
  const collection = params.get('collection')
  const filter = params.get('filter')
  const tag = params.get('tag')
  let section: Section = { type: 'all' }
  if (collection) section = { type: 'collection', id: collection === NO_COLLECTION ? null : collection }
  else if (filter && FILTERS.has(filter)) section = { type: 'filter', id: filter as SmartFilter }
  else if (tag?.trim()) section = { type: 'tag', tag: tag.trim().toLowerCase() }
  const sort = params.get('sort')
  return {
    section,
    q: params.get('q') ?? '',
    kinds: list(params.get('kind')).filter((k): k is KnowledgeKind => KINDS.has(k)),
    sources: list(params.get('source')).filter((s): s is KnowledgeSourceType => SOURCES.has(s)),
    project: params.get('project') || null,
    sort: sort && SORTS.has(sort) ? (sort as SortKey) : null,
  }
}

/** Canonical query string for a library state (defaults are omitted). Leading `?` included when non-empty. */
export function libraryQueryString(query: Partial<LibraryQuery>): string {
  const p = new URLSearchParams()
  const section = query.section ?? { type: 'all' }
  if (section.type === 'collection') p.set('collection', section.id ?? NO_COLLECTION)
  if (section.type === 'filter') p.set('filter', section.id)
  if (section.type === 'tag') p.set('tag', section.tag)
  if (query.q?.trim()) p.set('q', query.q)
  if (query.kinds?.length) p.set('kind', query.kinds.join(','))
  if (query.sources?.length) p.set('source', query.sources.join(','))
  if (query.project) p.set('project', query.project)
  if (query.sort) p.set('sort', query.sort)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export function sectionHref(section: Section): string {
  return `/knowledge${libraryQueryString({ section })}`
}

export function effectiveSort(query: Pick<LibraryQuery, 'sort' | 'q'>): SortKey {
  if (query.sort === 'relevance' && !query.q.trim()) return 'updated'
  return query.sort ?? (query.q.trim() ? 'relevance' : 'updated')
}

export function activeFacetCount(query: Pick<LibraryQuery, 'kinds' | 'sources' | 'project'>): number {
  return query.kinds.length + query.sources.length + (query.project ? 1 : 0)
}

// ------------------------------------------------------------------------------------------------ predicates

export const RECENT_MS = 7 * 24 * 60 * 60 * 1000

export interface FilterContext {
  /** Knowledge ids held in context. */
  held: ReadonlySet<ID>
  /** Knowledge ids in project memory (the scoped project's, or any project's when unscoped). */
  memory: ReadonlySet<ID>
  now: number
}

export function matchesSmartFilter(item: KnowledgeItem, filter: SmartFilter, ctx: FilterContext): boolean {
  switch (filter) {
    case 'recent':
      return ctx.now - Math.max(item.updatedAt, item.createdAt) <= RECENT_MS
    case 'held':
      return ctx.held.has(item.id)
    case 'memory':
      return ctx.memory.has(item.id)
    case 'research':
      return item.source.type === 'research' || item.source.ref?.kind === 'investigation'
    case 'uploads':
      return item.source.type === 'upload'
    case 'chat':
      return item.source.type === 'chat' || item.source.ref?.kind === 'message' || item.source.ref?.kind === 'thread'
    case 'agents':
      return item.source.type === 'agent' || item.author.type === 'agent'
    case 'simulated':
      return !!item.simulated
  }
}

export function matchesSection(item: KnowledgeItem, section: Section, ctx: FilterContext): boolean {
  switch (section.type) {
    case 'all':
      return true
    case 'collection':
      return section.id === null ? !item.collectionId : item.collectionId === section.id
    case 'filter':
      return matchesSmartFilter(item, section.id, ctx)
    case 'tag':
      return item.tags.includes(section.tag)
  }
}

export function matchesFacets(item: KnowledgeItem, query: Pick<LibraryQuery, 'kinds' | 'sources' | 'project'>): boolean {
  if (query.kinds.length && !query.kinds.includes(item.kind)) return false
  if (query.sources.length && !query.sources.includes(item.source.type)) return false
  if (query.project === 'none') return item.projectIds.length === 0
  if (query.project && !item.projectIds.includes(query.project)) return false
  return true
}

/** Inside a project scope, the library shows that project's items (unless the user shows all). */
export function inScope(item: KnowledgeItem, scope: ID | null): boolean {
  return !scope || item.projectIds.includes(scope)
}

// ------------------------------------------------------------------------------------------------ sorting

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** Sort a copy: updated (newest first) · title (A→Z) · most used (then newest). Relevance keeps the given order. */
export function sortItems(items: readonly KnowledgeItem[], sort: SortKey, usedCount: (id: ID) => number): KnowledgeItem[] {
  const out = [...items]
  if (sort === 'relevance') return out
  if (sort === 'title') return out.sort((a, b) => collator.compare(a.title, b.title) || b.updatedAt - a.updatedAt)
  if (sort === 'used') return out.sort((a, b) => usedCount(b.id) - usedCount(a.id) || b.updatedAt - a.updatedAt)
  return out.sort((a, b) => b.updatedAt - a.updatedAt || collator.compare(a.title, b.title))
}

// ------------------------------------------------------------------------------------------------ item facts

/** Words of plain text (letters/digits; markdown punctuation is ignored). */
export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

/** Non-text files (images, PDFs, binaries): only their name and metadata are searchable. */
export function isIndexed(item: Pick<KnowledgeItem, 'kind' | 'file'>): boolean {
  if (item.kind !== 'file' || !item.file) return true
  return classifyFile({ name: item.file.name, type: item.file.mime }) === 'text'
}

export function isImage(item: Pick<KnowledgeItem, 'file'>): boolean {
  return !!item.file && (item.file.mime.startsWith('image/') || !!item.file.previewUrl)
}

/** A one-line excerpt for rows and cards: the summary, else the opening of the content as plain text. */
export function excerptOf(item: Pick<KnowledgeItem, 'summary' | 'content'>, max = 220): string {
  const text = (item.summary?.trim() || plainText(item.content.slice(0, 1600))).replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.lastIndexOf(' ', max - 1)
  return `${text.slice(0, cut > max * 0.6 ? cut : max - 1)}…`
}

/** Knowledge ids in project memory: the scoped project's, or every project's when unscoped. */
export function memoryIdsIn(projects: Tables['projects'], scope: ID | null): Set<ID> {
  const out = new Set<ID>()
  const list = scope ? [projects[scope]].filter(Boolean) : Object.values(projects)
  for (const p of list) for (const r of p.pinnedRefs) if (r.kind === 'knowledge') out.add(r.id)
  return out
}

/** The first line of a note as its title ("# Launch plan" → "Launch plan"), clipped to 80 characters. */
export function titleFromContent(content: string): string {
  const first = content
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!first) return ''
  const clean = plainText(first).replace(/^[-*+]\s+/, '').replace(/\s+/g, ' ').trim()
  return clean.length > 80 ? `${clean.slice(0, 79).trimEnd()}…` : clean
}

/** Tags typed by a person: "#Launch plan, q4" → ["launch-plan", "q4"] (normalized like the service does). */
export function parseTagInput(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-'))
    .filter(Boolean)
}
