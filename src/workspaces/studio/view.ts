import { useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useScope } from '@/core/context'
import type { AssetKind, ID } from '@/core/types'
import { isAssetKind, placeFromParams, sheetSearch, type Place } from './logic'

/**
 * The contact sheet's view lives in the URL (§2.6): `/studio?board=&kind=&filter=favorites&q=` plus
 * `all=1` when a scoped user chose "All" (scope itself is never in the URL).
 */
export interface StudioView {
  place: Place
  kind: AssetKind | null
  q: string
  /** Scoped, but showing every project. */
  showAll: boolean
  scope: ID | null
  /** The project lists filter to (null: everything). */
  projectId: ID | null
}

export interface StudioHrefInput {
  place?: Place
  kind?: AssetKind | null
  q?: string
  all?: boolean
}

export function studioHref(view: Pick<StudioView, 'place' | 'kind' | 'q' | 'showAll'>, next: StudioHrefInput = {}): string {
  const search = sheetSearch(next.place ?? view.place, next.kind !== undefined ? next.kind : view.kind, next.q !== undefined ? next.q : view.q)
  const all = next.all !== undefined ? next.all : view.showAll
  const joined = all ? (search ? `${search}&all=1` : '?all=1') : search
  return `/studio${joined}`
}

export function useStudioView(): StudioView & {
  href: (next?: StudioHrefInput) => string
  go: (next: StudioHrefInput, opts?: { replace?: boolean }) => void
} {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const scope = useScope()
  const key = params.toString()
  const view = useMemo<StudioView>(() => {
    const p = new URLSearchParams(key)
    const k = p.get('kind')
    const showAll = p.get('all') === '1'
    return {
      place: placeFromParams(p),
      kind: isAssetKind(k) ? k : null,
      q: p.get('q') ?? '',
      showAll,
      scope,
      projectId: scope && !showAll ? scope : null,
    }
  }, [key, scope])
  const href = useCallback((next: StudioHrefInput = {}) => studioHref(view, next), [view])
  const go = useCallback((next: StudioHrefInput, opts?: { replace?: boolean }) => navigate(studioHref(view, next), { replace: opts?.replace }), [view, navigate])
  return { ...view, href, go }
}

/** Add one search param to an in-app href. */
export function withParam(href: string, key: string, value: string): string {
  const url = new URL(href, 'http://local')
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}
