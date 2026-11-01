import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react'
import { useNavigate, type NavigateOptions, type To } from 'react-router'
import { useDB, type Tables } from '@/core/db'
import { GithubRequestError, getLastRateLimit, getRateLimit, peekFile, subscribeRateLimit, type GithubErrorKind, type GithubRateLimit } from '@/core/github'
import { getRepoFile, type RepoFileContent } from '@/core/services'
import type { ID } from '@/core/types'

/** The GitHub REST quota last observed (null before any GitHub request in this tab). */
export function useRateLimit(): GithubRateLimit | null {
  return useSyncExternalStore(subscribeRateLimit, getLastRateLimit, getLastRateLimit)
}

/**
 * Read the quota once when `enabled` turns on (the connect dialog, a live repository on screen).
 * `/rate_limit` does not count against the quota. Failures are silent: the quota line just stays hidden.
 */
export function useFetchRateLimit(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const last = getLastRateLimit()
    if (last && Date.now() - last.observedAt < 60_000) return
    const controller = new AbortController()
    void getRateLimit({ signal: controller.signal }).catch(() => undefined)
    return () => controller.abort()
  }, [enabled])
}

export type FileLoad =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; file: RepoFileContent }
  | { state: 'error'; message: string; kind?: GithubErrorKind; resetAt?: number }

/**
 * One repository file, read through the code service: bundled for the demo repository, live from
 * GitHub otherwise (cached in memory; cached files still open while GitHub is rate limited).
 */
export function useRepoFile(repoId: ID | null | undefined, path: string | null | undefined): { load: FileLoad; retry: () => void } {
  const repo = useDB((s: Tables) => (repoId ? s.repos[repoId] : undefined))
  const [attempt, setAttempt] = useState(0)
  const key = repoId && path ? `${repoId}:${path}:${attempt}` : ''
  const [load, setLoad] = useState<{ key: string; value: FileLoad }>({ key: '', value: { state: 'idle' } })

  useEffect(() => {
    if (!repoId || !path || !repo) return
    let alive = true
    // A warm cache answers synchronously, so a cached file never flashes a skeleton.
    const cached = repo.provider === 'github' ? peekFile(repo.owner, repo.name, repo.defaultBranch, path) : undefined
    if (!cached) setLoad({ key, value: { state: 'loading' } })
    getRepoFile(repoId, path)
      .then((file) => alive && setLoad({ key, value: { state: 'ready', file } }))
      .catch((err: unknown) => {
        if (!alive) return
        const gh = err instanceof GithubRequestError ? err : undefined
        setLoad({ key, value: { state: 'error', message: err instanceof Error ? err.message : String(err), kind: gh?.kind, resetAt: gh?.resetAt } })
      })
    return () => {
      alive = false
    }
    // The repo row changes on refresh (new tree); re-read then too.
  }, [key, repoId, path, repo?.lastSyncedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  const value: FileLoad = !repoId || !path ? { state: 'idle' } : load.key === key ? load.value : { state: 'loading' }
  return { load: value, retry: () => setAttempt((n) => n + 1) }
}

/** Width of an element, kept current with a ResizeObserver (0 until measured). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w !== undefined) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/**
 * Router state that answers at once: the value lives in React state (urgent) and the URL follows with
 * `replace`. Router updates run in transitions, and while runs stream into the store a transition can
 * wait seconds behind urgent renders — a file or tab picked by the user must not. A URL change made
 * elsewhere (a link, Back) still wins.
 */
export function useUrlValue(urlValue: string | null, write: (value: string | null) => void): [string | null, (value: string | null) => void] {
  const [value, setValue] = useState(urlValue)
  const [seen, setSeen] = useState(urlValue)
  if (urlValue !== seen) {
    setSeen(urlValue)
    setValue(urlValue)
  }
  const latestWrite = useRef(write)
  latestWrite.current = write
  const set = useCallback((next: string | null) => {
    setValue(next)
    latestWrite.current(next)
  }, [])
  return [value, set]
}

/** `navigate` for event handlers (kept as one seam for the Code workspace's navigations). */
export function useGo() {
  const navigate = useNavigate()
  return useCallback((to: To, opts?: NavigateOptions) => navigate(to, opts), [navigate])
}
