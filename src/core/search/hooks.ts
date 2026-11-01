import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { EntityKind } from '@/core/types'
import { getSearchIndexVersion, isSearchReady, search, subscribeSearchIndex, warmSearchIndex } from './store'
import type { SearchOptions, SearchResult } from './types'

export const SEARCH_DEBOUNCE_MS = 120

const EMPTY: SearchResult[] = []

/**
 * Debounced search for as-you-type UIs. While a new query is pending, the previous
 * results stay visible and `ready` is false; results also refresh when indexed data changes.
 */
export function useSearch(query: string, opts: SearchOptions = {}): { results: SearchResult[]; ready: boolean } {
  const version = useSyncExternalStore(subscribeSearchIndex, getSearchIndexVersion, getSearchIndexVersion)
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    if (debounced === query) return
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query, debounced])

  useEffect(() => {
    warmSearchIndex()
  }, [])

  const built = isSearchReady()
  const effective = query.trim() ? debounced : ''
  const { projectId, limit } = opts
  const kindsKey = opts.kinds?.join(',') ?? ''

  const results = useMemo(() => {
    if (!built || !effective.trim()) return EMPTY
    const kinds = kindsKey ? (kindsKey.split(',') as EntityKind[]) : undefined
    return search(effective, { kinds, projectId, limit })
    // `version` re-runs the query when the index changes.
  }, [built, effective, kindsKey, projectId, limit, version])

  // An empty query has nothing to wait for; otherwise the index must exist and the debounce must have settled.
  return { results, ready: !query.trim() || (built && debounced === query) }
}
