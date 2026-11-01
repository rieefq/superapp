import { useDB } from '@/core/db'
import { EntityIndex } from './entityIndex'
import { PassageIndex } from './retrieval'
import type { RetrievedPassage, RetrieveOptions, SearchOptions, SearchResult } from './types'

/**
 * Runtime owner of the search indexes.
 * - Built lazily: synchronously on the first query, or in the background (time-sliced) via `warmSearchIndex`.
 * - Kept fresh incrementally: one store subscription, debounced (250ms, at most 1s behind),
 *   re-indexes only rows whose reference changed. Queries also sync first, so a result
 *   never misses a change made just before it.
 * - `subscribeSearchIndex`/`getSearchIndexVersion` let hooks recompute when the index changes.
 */
const DEBOUNCE_MS = 250
const MAX_WAIT_MS = 1000
const WARM_SLICE_MS = 12

type Timer = ReturnType<typeof setTimeout>

let entities = new EntityIndex()
let passages = new PassageIndex()
let unsubscribe: (() => void) | null = null
let syncTimer: Timer | null = null
let notifyTimer: Timer | null = null
let warmTimer: Timer | null = null
let firstDirtyAt = 0
let version = 0
const listeners = new Set<() => void>()

function emit(): void {
  version++
  for (const listener of [...listeners]) listener()
}

/** Notify outside the current call stack (queries can run during React render). */
function emitSoon(): void {
  if (notifyTimer) return
  notifyTimer = setTimeout(() => {
    notifyTimer = null
    emit()
  }, 0)
}

function flushBackground(): void {
  syncTimer = null
  firstDirtyAt = 0
  const state = useDB.getState()
  const changedEntities = entities.built && entities.sync(state)
  const changedPassages = passages.built && passages.sync(state.knowledge)
  if (changedEntities || changedPassages) emit()
}

function ensureSubscribed(): void {
  if (unsubscribe) return
  unsubscribe = useDB.subscribe((state) => {
    const dirty = (entities.built && entities.isStale(state)) || (passages.built && passages.isStale(state.knowledge))
    if (!dirty) return
    const now = Date.now()
    if (!firstDirtyAt) firstDirtyAt = now
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(flushBackground, now - firstDirtyAt >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS)
  })
}

function syncEntitiesNow(): void {
  const state = useDB.getState()
  if (!entities.isStale(state)) return
  entities.sync(state)
  ensureSubscribed()
  emitSoon()
}

/** Local full-text search over every workspace's entities (real, not simulated). */
export function search(query: string, opts: SearchOptions = {}): SearchResult[] {
  if (!query.trim()) return []
  syncEntitiesNow()
  return entities.search(query, opts, useDB.getState())
}

/** The most relevant passages of knowledge items for a question (grounding for AI answers). */
export function retrieveKnowledge(query: string, opts: RetrieveOptions = {}): RetrievedPassage[] {
  if (!query.trim()) return []
  const { knowledge } = useDB.getState()
  if (passages.isStale(knowledge)) {
    passages.sync(knowledge)
    ensureSubscribed()
  }
  // Respect each item's "Available to AI" setting: 'never' is never retrieved;
  // 'cited' only when explicitly requested via opts.ids (attached / mentioned).
  const limit = opts.limit ?? 5
  const explicit = new Set(opts.ids ?? [])
  const allowed = (r: RetrievedPassage) => {
    const a = r.item.aiAvailability ?? 'always'
    return a === 'always' || (a === 'cited' && explicit.has(r.item.id))
  }
  const results = passages.retrieve(query, { ...opts, limit: limit * 3 }, knowledge)
  return results.filter(allowed).slice(0, limit)
}

function warmStep(): void {
  warmTimer = null
  const deadline = performance.now() + WARM_SLICE_MS
  if (!entities.built) {
    if (!entities.continueBuild(deadline)) {
      warmTimer = setTimeout(warmStep, 0)
      return
    }
    entities.sync(useDB.getState()) // catch up with changes made while building
    ensureSubscribed()
    emit()
  }
  if (!passages.built) {
    if (!passages.continueBuild(deadline)) {
      warmTimer = setTimeout(warmStep, 0)
      return
    }
    passages.sync(useDB.getState().knowledge)
    ensureSubscribed()
  }
}

/**
 * Build both indexes in the background, in ~12ms slices so the UI stays responsive
 * (call when search UI mounts). A query arriving mid-build finishes it synchronously.
 */
export function warmSearchIndex(): void {
  if (warmTimer || (entities.built && passages.built)) return
  const state = useDB.getState()
  entities.beginBuild(state)
  passages.beginBuild(state.knowledge)
  warmTimer = setTimeout(warmStep, 0)
}

export function isSearchReady(): boolean {
  return entities.built
}

export function subscribeSearchIndex(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSearchIndexVersion(): number {
  return version
}

/** Test-only: drop both indexes, timers and the store subscription. */
export function __resetSearchForTests(): void {
  unsubscribe?.()
  unsubscribe = null
  for (const t of [syncTimer, notifyTimer, warmTimer]) if (t) clearTimeout(t)
  syncTimer = notifyTimer = warmTimer = null
  firstDirtyAt = 0
  entities = new EntityIndex()
  passages = new PassageIndex()
  version = 0
  listeners.clear()
}
