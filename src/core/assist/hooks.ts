import { useSyncExternalStore } from 'react'
import { useDB, type TableName, type Tables } from '@/core/db'
import { getContext, useScope } from '@/core/context'
import type { ID } from '@/core/types'
import { suggestNextActions } from './nextActions'
import type { NextAction } from './types'

/**
 * Thin React bindings for the assist rules. `useNextActions` re-renders only when the
 * suggested list actually changes (not on every database write or streaming token).
 */

// ---------------------------------------------------------------- shared minute clock

const MINUTE = 60_000
const clockListeners = new Set<() => void>()
let clockTimer: ReturnType<typeof setInterval> | undefined

function subscribeClock(onTick: () => void): () => void {
  clockListeners.add(onTick)
  clockTimer ??= setInterval(() => clockListeners.forEach((l) => l()), 15_000)
  return () => {
    clockListeners.delete(onTick)
    if (!clockListeners.size && clockTimer !== undefined) {
      clearInterval(clockTimer)
      clockTimer = undefined
    }
  }
}

const currentMinute = () => Math.floor(Date.now() / MINUTE) * MINUTE

/** The current time, floored to the minute; updates at most once a minute. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribeClock, currentMinute, currentMinute)
}

// ---------------------------------------------------------------- next actions

/** Tables the rules (and the routes they resolve) read. */
const DEPENDENCIES: readonly TableName[] = [
  'approvals', 'tasks', 'sessions', 'investigations', 'runs', 'connections', 'workflows', 'agents', 'threads', 'messages',
  'projects', 'assets',
]

interface CacheEntry {
  refs: unknown[]
  now: number
  result: NextAction[]
  signature: string
}

const cache = new Map<string, CacheEntry>()

/**
 * Memoized selector: recomputes only when a dependency table or the minute changes, and
 * returns the previous array (same reference) when the suggestions are unchanged.
 */
export function selectNextActions(s: Tables, now: number, scopeProjectId: ID | null, limit: number): NextAction[] {
  const key = `${scopeProjectId ?? '*'}|${limit}`
  const refs = DEPENDENCIES.map((t) => s[t])
  const prev = cache.get(key)
  if (prev && prev.now === now && prev.refs.every((r, i) => r === refs[i])) return prev.result
  const result = suggestNextActions({ tables: s, now, scopeProjectId }, { limit })
  const signature = JSON.stringify(result)
  if (prev && prev.signature === signature) {
    cache.set(key, { ...prev, refs, now })
    return prev.result
  }
  if (cache.size > 32) cache.clear()
  cache.set(key, { refs, now, result, signature })
  return result
}

export interface UseNextActionsOptions {
  /** Override the active scope: a project id, or null for all work. Defaults to the current scope. */
  projectId?: ID | null
}

/** Suggested next actions for the current scope, most important first (at most `limit`). */
export function useNextActions(limit = 6, opts: UseNextActionsOptions = {}): NextAction[] {
  const scope = useScope()
  const projectId = opts.projectId === undefined ? scope : opts.projectId
  const now = useMinuteClock()
  return useDB((s) => selectNextActions(s, now, projectId, limit))
}

/** Non-React snapshot (e.g. when the command center opens). */
export function getNextActions(opts: { limit?: number; projectId?: ID | null; now?: number } = {}): NextAction[] {
  const projectId = opts.projectId === undefined ? getContext().scopeProjectId : opts.projectId
  return suggestNextActions({ tables: useDB.getState(), now: opts.now ?? Date.now(), scopeProjectId: projectId }, { limit: opts.limit ?? 6 })
}

/** Test helper: forget memoized selections. */
export function __resetAssistCacheForTests(): void {
  cache.clear()
}
