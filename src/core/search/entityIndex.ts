import type { Tables } from '@/core/db'
import type { ID } from '@/core/types'
import { Bm25Index, type IndexTerm } from './bm25'
import { buildDoc, docProjectIds, INDEXED_TABLES, TABLE_KIND, TITLE_WEIGHT, type IndexedTable, type SearchDoc } from './documents'
import { parseQuery } from './query'
import { bestSnippet } from './snippet'
import { analyze } from './text'
import type { SearchOptions, SearchResult } from './types'

export const DEFAULT_SEARCH_LIMIT = 20
/** Multiplier when the query's terms appear as a phrase (in order) in the document. */
export const PHRASE_BONUS = 1.5
/** Partial matches are kept but demoted: score × coverage^COVERAGE_EXPONENT. */
const COVERAGE_EXPONENT = 1.5

/** Tables whose changes affect the entity index (threads also depend on messages). */
export const WATCHED_TABLES: ReadonlyArray<keyof Tables> = [...INDEXED_TABLES, 'messages']

interface DocMeta {
  table: IndexedTable
  id: ID
  projectIds: ID[]
  investigationId?: ID
  updatedAt: number
}

const keyOf = (table: IndexedTable, id: ID) => `${TABLE_KIND[table]}:${id}`

/** Weighted terms (aggregated per surface) and the phrase string of a document. */
export function docTerms(doc: SearchDoc): { terms: IndexTerm[]; phrase: string } {
  const bySurface = new Map<string, IndexTerm>()
  const phraseParts: string[] = []
  const add = (text: string, weight: number) => {
    const analyzed = analyze(text)
    if (!analyzed.length) return
    const stems: string[] = []
    for (const t of analyzed) {
      const cur = bySurface.get(t.surface)
      if (cur) cur.weight += weight
      else bySurface.set(t.surface, { stem: t.stem, surface: t.surface, weight })
      stems.push(t.stem)
    }
    phraseParts.push(stems.join(' '))
  }
  add(doc.title, TITLE_WEIGHT)
  for (const f of doc.body) add(f.text, f.weight)
  return { terms: [...bySurface.values()], phrase: ` ${phraseParts.join(' | ')} ` }
}

/**
 * Full-text index over every searchable entity. Pure with respect to the database:
 * callers hand it `Tables` snapshots; `sync` diffs them against the last snapshot by
 * reference (tables, then rows), so only changed rows are re-indexed.
 */
export class EntityIndex {
  private readonly bm25 = new Bm25Index()
  private readonly meta = new Map<string, DocMeta>()
  private synced: Tables | null = null

  get built(): boolean {
    return this.synced !== null
  }

  get size(): number {
    return this.bm25.size
  }

  /** True when `state` differs from the last synced snapshot in a table the index depends on. */
  isStale(state: Tables): boolean {
    const prev = this.synced
    return !prev || WATCHED_TABLES.some((t) => state[t] !== prev[t])
  }

  /** Bring the index in line with `state`. Returns true when anything changed. */
  sync(state: Tables): boolean {
    const prev = this.synced
    if (prev && !this.isStale(state)) return false
    const rebuiltThreads = new Set<ID>()
    for (const table of INDEXED_TABLES) {
      const before = (prev?.[table] ?? {}) as Record<ID, unknown>
      const after = state[table] as Record<ID, unknown>
      if (prev && before === after) continue
      for (const id in before) if (!(id in after)) this.remove(table, id)
      for (const id in after) {
        if (before[id] === after[id]) continue
        this.upsert(table, id, state)
        if (table === 'threads') rebuiltThreads.add(id)
      }
    }
    if (prev && prev.messages !== state.messages) {
      const affected = new Set<ID>()
      for (const id in prev.messages) if (state.messages[id] !== prev.messages[id]) affected.add(prev.messages[id].threadId)
      for (const id in state.messages) if (prev.messages[id] !== state.messages[id]) affected.add(state.messages[id].threadId)
      for (const threadId of affected) if (!rebuiltThreads.has(threadId)) this.upsert('threads', threadId, state)
    }
    this.synced = state
    return true
  }

  private upsert(table: IndexedTable, id: ID, state: Tables): void {
    const doc = buildDoc(table, id, state)
    if (!doc) {
      this.remove(table, id)
      return
    }
    const key = keyOf(table, id)
    const { terms, phrase } = docTerms(doc)
    this.bm25.set(key, terms, phrase)
    const meta: DocMeta = { table, id, projectIds: doc.projectIds, updatedAt: doc.updatedAt }
    if (doc.investigationId) meta.investigationId = doc.investigationId
    this.meta.set(key, meta)
  }

  private remove(table: IndexedTable, id: ID): void {
    const key = keyOf(table, id)
    this.bm25.delete(key)
    this.meta.delete(key)
  }

  /** Ranked results for `query` against the synced snapshot `state`. */
  search(query: string, opts: SearchOptions, state: Tables): SearchResult[] {
    const limit = Math.max(0, opts.limit ?? DEFAULT_SEARCH_LIMIT)
    if (!query.trim() || !limit) return []
    const parsed = parseQuery(query, this.bm25, { prefix: true })
    if (!parsed.groups.length) return []
    const required = parsed.groups.filter((g) => g.required).length
    const kinds = opts.kinds?.length ? new Set(opts.kinds) : null
    const scope = opts.projectId ?? null

    const candidates: Array<{ key: string; meta: DocMeta; score: number; projectId: ID | null }> = []
    for (const [key, s] of this.bm25.score(parsed.groups)) {
      const meta = this.meta.get(key)
      if (!meta) continue
      if (kinds && !kinds.has(TABLE_KIND[meta.table])) continue
      if (required && !s.matchedRequired) continue
      const projects = docProjectIds(meta, state)
      if (scope && !projects.includes(scope)) continue
      const coverage = required ? s.matchedRequired / required : 1
      candidates.push({
        key,
        meta,
        score: s.score * coverage ** COVERAGE_EXPONENT,
        projectId: scope ?? projects[0] ?? null,
      })
    }
    const byRank = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
      b.score - a.score || b.meta.updatedAt - a.meta.updatedAt
    candidates.sort(byRank)

    // Exact-phrase bonus, checked only where it can change the visible ranking.
    if (parsed.phrase && candidates.length) {
      const cutoff = candidates[Math.min(limit, candidates.length) - 1].score
      for (const c of candidates) {
        if (c.score * PHRASE_BONUS < cutoff) break
        if (this.bm25.hasPhrase(c.key, parsed.phrase)) c.score *= PHRASE_BONUS
      }
      candidates.sort(byRank)
    }

    const results: SearchResult[] = []
    for (const c of candidates) {
      if (results.length >= limit) break
      const doc = buildDoc(c.meta.table, c.meta.id, state)
      if (!doc) continue
      const snippet = bestSnippet(doc.body, parsed.highlight)
      const result: SearchResult = {
        ref: doc.ref,
        kind: doc.ref.kind,
        title: doc.title,
        snippet: snippet.text,
        highlights: snippet.highlights,
        score: c.score,
        projectId: c.projectId,
        updatedAt: doc.updatedAt,
      }
      if (snippet.anchor) result.anchor = snippet.anchor
      results.push(result)
    }
    return results
  }
}
