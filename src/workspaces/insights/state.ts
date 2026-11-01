import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { INSIGHT_RANGES, parseRangeToken, PROVIDER_FILTERS, rangeToken, RUN_KINDS, type ProviderFilter, type RangeDays } from '@/core/analytics'
import { useScope } from '@/core/context'
import type { ID, RunKind } from '@/core/types'

/**
 * Insights filters live in the URL so every view, drill-down and reload agrees:
 * `?range=24h|7d|30d|90d` · `?project=all|<id>` (absent = follow the scope) · `?provider=live|simulated` · `?kind=<run kind>`.
 * History adds its own drill-downs (`status`, `agent`, `workflow`, `model`, `reason`, `slot`, `cell`, `q`, `sort`, `page`).
 */

export const DEFAULT_RANGE: RangeDays = 7

/** Params shared by every Insights view (kept when switching tabs). */
export const SHARED_PARAMS = ['range', 'project', 'provider', 'kind'] as const

export interface InsightsFilters {
  rangeDays: RangeDays
  /** Effective project (null = all work). */
  projectId: ID | null
  /** True while the project follows the global scope (no explicit `project` param). */
  followsScope: boolean
  provider: ProviderFilter
  kind: RunKind | null
}

export function parseRange(token: string | null): RangeDays {
  const days = parseRangeToken(token)
  return (INSIGHT_RANGES as readonly number[]).includes(days ?? -1) ? (days as RangeDays) : DEFAULT_RANGE
}

export function parseProvider(value: string | null): ProviderFilter {
  return PROVIDER_FILTERS.includes(value as ProviderFilter) ? (value as ProviderFilter) : 'all'
}

export function parseKind(value: string | null): RunKind | null {
  return RUN_KINDS.includes(value as RunKind) ? (value as RunKind) : null
}

/** Effective project: `all` → every project; an id → that project; absent → the scope. */
export function resolveProject(param: string | null, scope: ID | null): { projectId: ID | null; followsScope: boolean } {
  if (param === 'all') return { projectId: null, followsScope: false }
  if (param) return { projectId: param, followsScope: false }
  return { projectId: scope, followsScope: true }
}

export function readFilters(params: URLSearchParams, scope: ID | null): InsightsFilters {
  const { projectId, followsScope } = resolveProject(params.get('project'), scope)
  return {
    rangeDays: parseRange(params.get('range')),
    projectId,
    followsScope,
    provider: parseProvider(params.get('provider')),
    kind: parseKind(params.get('kind')),
  }
}

/** A query string carrying the shared filters (plus `extra`), for links between views and drill-downs. */
export function filterQuery(params: URLSearchParams, extra: Record<string, string | number | null | undefined> = {}): string {
  const next = new URLSearchParams()
  for (const key of SHARED_PARAMS) {
    const v = params.get(key)
    if (v) next.set(key, v)
  }
  for (const [k, v] of Object.entries(extra)) {
    if (v === null || v === undefined || v === '') next.delete(k)
    else next.set(k, String(v))
  }
  const s = next.toString()
  return s ? `?${s}` : ''
}

/** The filters of the current view, and setters that keep the URL the single source of truth. */
export function useInsightsFilters() {
  const [params, setParams] = useSearchParams()
  const scope = useScope()
  const filters = useMemo(() => readFilters(params, scope), [params, scope])

  /** Patch params (null removes). History resets to its first page whenever a filter changes. */
  const patch = useCallback(
    (changes: Record<string, string | null>, opts: { replace?: boolean } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === '') next.delete(k)
            else next.set(k, v)
          }
          if (!('page' in changes)) next.delete('page')
          return next
        },
        { replace: opts.replace ?? true },
      )
    },
    [setParams],
  )

  const setRange = useCallback((days: RangeDays) => patch({ range: days === DEFAULT_RANGE ? null : rangeToken(days) }), [patch])
  const setProvider = useCallback((p: ProviderFilter) => patch({ provider: p === 'all' ? null : p }), [patch])
  const setKind = useCallback((k: RunKind | null) => patch({ kind: k }), [patch])
  /** 'scope' follows the global scope again; 'all' shows every project; an id pins one project. */
  const setProject = useCallback((value: 'scope' | 'all' | ID) => patch({ project: value === 'scope' ? null : value }), [patch])

  return { params, filters, patch, setRange, setProvider, setKind, setProject, scope }
}
