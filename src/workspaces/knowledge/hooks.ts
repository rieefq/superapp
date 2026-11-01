import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useContextStore } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { highlightText, isSearchReady, useSearch } from '@/core/search'
import { knowledgeUsageIn } from '@/core/services'
import type { ID, KnowledgeItem } from '@/core/types'
import {
  effectiveSort,
  inScope,
  libraryQueryString,
  matchesFacets,
  matchesSection,
  memoryIdsIn,
  parseLibraryParams,
  sortItems,
  type FilterContext,
  type LibraryQuery,
  type ViewMode,
} from './model'

// ------------------------------------------------------------------------------------------------ preferences

interface KnowledgePrefs {
  view: ViewMode
  /** The list pane shows every tag (not just the most used). */
  tagsExpanded: boolean
  /** The project scope for which the user chose "Show all" in this list (reset by a scope change). */
  showAllFor: ID | null
  setView: (view: ViewMode) => void
  setTagsExpanded: (open: boolean) => void
  setShowAllFor: (scope: ID | null) => void
}

export const useKnowledgePrefs = create<KnowledgePrefs>()(
  persist(
    (set) => ({
      view: 'list',
      tagsExpanded: false,
      showAllFor: null,
      setView: (view) => set({ view }),
      setTagsExpanded: (tagsExpanded) => set({ tagsExpanded }),
      setShowAllFor: (showAllFor) => set({ showAllFor }),
    }),
    { name: 'atrium.knowledge.prefs', version: 1, partialize: (s) => ({ view: s.view, tagsExpanded: s.tagsExpanded }) },
  ),
)

/** The active scope for library lists: the project, unless the user chose "Show all" for it. */
export function useListScope(): { scope: ID | null; projectScope: ID | null; showingAll: boolean } {
  const projectScope = useContextStore((s) => s.scopeProjectId)
  const showAllFor = useKnowledgePrefs((s) => s.showAllFor)
  const showingAll = !!projectScope && showAllFor === projectScope
  return { scope: showingAll ? null : projectScope, projectScope, showingAll }
}

// ------------------------------------------------------------------------------------------------ URL state

/** The library's URL state and a setter that keeps the shell's `?inspect=`. Typing replaces history. */
export function useLibraryQuery(): [LibraryQuery, (patch: Partial<LibraryQuery>, opts?: { replace?: boolean }) => void] {
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => parseLibraryParams(params), [params])
  const update = useCallback(
    (patch: Partial<LibraryQuery>, opts: { replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(libraryQueryString({ ...parseLibraryParams(prev), ...patch }))
          const inspect = prev.get('inspect')
          if (inspect) next.set('inspect', inspect)
          return next
        },
        { replace: opts.replace },
      )
    },
    [setParams],
  )
  return [query, update]
}

// ------------------------------------------------------------------------------------------------ filter context

export function useFilterContext(scope: ID | null): FilterContext {
  const pinned = useContextStore((s) => s.pinned)
  const projects = useDB((s: Tables) => s.projects)
  // Recent is relative to now: refresh the clock once a minute so the filter stays honest.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])
  return useMemo(
    () => ({
      held: new Set(pinned.filter((p) => p.ref.kind === 'knowledge').map((p) => p.ref.id)),
      memory: memoryIdsIn(projects, scope),
      now,
    }),
    [pinned, projects, scope, now],
  )
}

// ------------------------------------------------------------------------------------------------ results

export interface LibraryEntry {
  item: KnowledgeItem
  /** Search excerpt with highlights (only while searching). */
  snippet?: { text: string; highlights: Array<[number, number]> }
  titleRanges?: Array<[number, number]>
}

export interface LibraryResults {
  entries: LibraryEntry[]
  /** Items in the section before search and facets (for "No matches" vs an empty section). */
  sectionCount: number
  /** The search index is still being built (first search after load). */
  indexing: boolean
  /** A typed query is still settling (results lag the input by the debounce). */
  pending: boolean
  /** Items in scope (for the "Indexing 42 items…" line). */
  scopedCount: number
}

const SEARCH_LIMIT = 500

/** Usage counts, subscribed only while sorting by "Most used" (run ticks never re-render the list otherwise). */
function useUsageSignature(enabled: boolean): string {
  return useDB((s: Tables) => {
    if (!enabled) return ''
    const usage = knowledgeUsageIn(s.runs)
    let sig = ''
    for (const [id, u] of usage) sig += `${id}:${u.runIds.length};`
    return sig
  })
}

function sameRanges(a?: Array<[number, number]>, b?: Array<[number, number]>): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((r, i) => r[0] === b[i][0] && r[1] === b[i][1])
}

/** Reuse the previous entry object when nothing about it changed, so memoized rows skip re-rendering. */
function stabilize(entries: LibraryEntry[], cache: Map<ID, LibraryEntry>): LibraryEntry[] {
  const next = new Map<ID, LibraryEntry>()
  const out = entries.map((e) => {
    const prev = cache.get(e.item.id)
    const same =
      prev &&
      prev.item === e.item &&
      prev.snippet?.text === e.snippet?.text &&
      sameRanges(prev.snippet?.highlights, e.snippet?.highlights) &&
      sameRanges(prev.titleRanges, e.titleRanges)
    const entry = same ? prev : e
    next.set(e.item.id, entry)
    return entry
  })
  cache.clear()
  for (const [k, v] of next) cache.set(k, v)
  return out
}

/** The library list: scope → section → facets → search (real local BM25) → sort. */
export function useLibraryResults(query: LibraryQuery, scope: ID | null): LibraryResults {
  const knowledge = useDB((s: Tables) => s.knowledge)
  const ctx = useFilterContext(scope)
  const sort = effectiveSort(query)
  const q = query.q.trim()
  const { results, ready } = useSearch(q, { kinds: ['knowledge'], limit: SEARCH_LIMIT })
  const usageSig = useUsageSignature(sort === 'used')
  const cache = useRef(new Map<ID, LibraryEntry>())

  return useMemo(() => {
    const all = Object.values(knowledge)
    const scoped = all.filter((k) => inScope(k, scope))
    const section = scoped.filter((k) => matchesSection(k, query.section, ctx))
    const base = section.filter((k) => matchesFacets(k, query))
    const usage = usageSig ? knowledgeUsageIn(useDB.getState().runs) : null
    const used = (id: ID) => usage?.get(id)?.runIds.length ?? 0
    let entries: LibraryEntry[]
    if (q) {
      const byId = new Map(base.map((k) => [k.id, k]))
      entries = []
      for (const r of results) {
        const item = byId.get(r.ref.id)
        if (!item) continue
        entries.push({ item, snippet: { text: r.snippet, highlights: r.highlights }, titleRanges: highlightText(item.title, q) })
      }
      if (sort !== 'relevance') {
        const order = sortItems(entries.map((e) => e.item), sort, used)
        const pos = new Map(order.map((k, i) => [k.id, i]))
        entries.sort((a, b) => (pos.get(a.item.id) ?? 0) - (pos.get(b.item.id) ?? 0))
      }
    } else {
      entries = sortItems(base, sort, used).map((item) => ({ item }))
    }
    return {
      entries: stabilize(entries, cache.current),
      sectionCount: section.length,
      indexing: !!q && !isSearchReady(),
      pending: !!q && !ready,
      scopedCount: scoped.length,
    }
    // `usageSig` re-sorts "Most used" when counts change.
  }, [knowledge, scope, query, ctx, q, results, ready, sort, usageSig])
}

// ------------------------------------------------------------------------------------------------ counts for the list pane

export interface PaneCounts {
  all: number
  collections: Record<string, number>
  noCollection: number
  filters: Record<string, number>
  tags: { tag: string; count: number }[]
}

export function usePaneCounts(scope: ID | null, matchFilter: (item: KnowledgeItem, id: string) => boolean, filterIds: readonly string[]): PaneCounts {
  const knowledge = useDB((s: Tables) => s.knowledge)
  return useMemo(() => {
    const collections: Record<string, number> = {}
    const filters: Record<string, number> = Object.fromEntries(filterIds.map((f) => [f, 0]))
    const tags = new Map<string, number>()
    let all = 0
    let noCollection = 0
    for (const k of Object.values(knowledge)) {
      if (!inScope(k, scope)) continue
      all++
      if (k.collectionId) collections[k.collectionId] = (collections[k.collectionId] ?? 0) + 1
      else noCollection++
      for (const f of filterIds) if (matchFilter(k, f)) filters[f]++
      for (const t of k.tags) tags.set(t, (tags.get(t) ?? 0) + 1)
    }
    return {
      all,
      collections,
      noCollection,
      filters,
      tags: [...tags].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    }
  }, [knowledge, scope, matchFilter, filterIds])
}
