/**
 * Watches run status transitions for the Run Line and the live strip (§3.6):
 * - a run that succeeds while you watch shows ✓ for 8s, then collapses;
 * - a run that fails stays (red ✕) until it is opened; opening marks its `run.failed` notification read.
 * Only transitions observed in this page session count, so a reload never replays old endings.
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import { db, useDB } from '@/core/db'
import { markRead } from '@/core/services'
import type { ID, RunStatus } from '@/core/types'

export const FINISHED_VISIBLE_MS = 8_000

interface TrackerState {
  /** runId → when we saw it succeed. */
  finished: Record<ID, number>
  /** Runs seen failing in this session. */
  failed: Record<ID, number>
  /** Failed runs the user has opened (attached, ⌘-clicked or navigated to). */
  opened: Record<ID, true>
}

export const useRunTracker = create<TrackerState>(() => ({ finished: {}, failed: {}, opened: {} }))

const ACTIVE = new Set<RunStatus>(['queued', 'running', 'waiting', 'paused'])

/** Mark a run as opened: clears its failed pill and its unread `run.failed` notifications. */
export function markRunOpened(runId: ID): void {
  const st = useRunTracker.getState()
  if (!st.opened[runId]) useRunTracker.setState({ opened: { ...st.opened, [runId]: true } })
  for (const n of db.filter('notifications', (x) => !x.readAt && x.kind === 'run.failed' && x.ref?.kind === 'run' && x.ref.id === runId)) {
    markRead(n.id)
  }
}

/** Mount once (in the Shell): observes transitions and expires ✓ pills after 8s. */
export function useRunTransitions(): void {
  useEffect(() => {
    const prev = new Map<ID, RunStatus>()
    for (const r of Object.values(useDB.getState().runs)) prev.set(r.id, r.status)
    const timers = new Map<ID, ReturnType<typeof setTimeout>>()

    const unsub = useDB.subscribe((state, before) => {
      if (state.runs === before.runs) return
      const finished: Record<ID, number> = {}
      const failed: Record<ID, number> = {}
      const now = Date.now()
      for (const r of Object.values(state.runs)) {
        const was = prev.get(r.id)
        prev.set(r.id, r.status)
        if (!was || was === r.status || !ACTIVE.has(was)) continue
        if (r.status === 'succeeded') finished[r.id] = now
        else if (r.status === 'failed') failed[r.id] = now
      }
      const hasFinished = Object.keys(finished).length > 0
      const hasFailed = Object.keys(failed).length > 0
      if (!hasFinished && !hasFailed) return
      const st = useRunTracker.getState()
      useRunTracker.setState({
        finished: hasFinished ? { ...st.finished, ...finished } : st.finished,
        failed: hasFailed ? { ...st.failed, ...failed } : st.failed,
      })
      for (const id of Object.keys(finished)) {
        clearTimeout(timers.get(id))
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id)
            const cur = useRunTracker.getState().finished
            if (!(id in cur)) return
            const next = { ...cur }
            delete next[id]
            useRunTracker.setState({ finished: next })
          }, FINISHED_VISIBLE_MS),
        )
      }
    })
    return () => {
      unsub()
      timers.forEach(clearTimeout)
    }
  }, [])
}

/** Ids of failed runs still waiting to be opened (session failures + unread `run.failed` notifications). */
export function useFailedUnopenedIds(): ID[] {
  const fromSession = useRunTracker((s) =>
    Object.keys(s.failed)
      .filter((id) => !s.opened[id])
      .join(','),
  )
  const fromNotifications = useDB((s) => {
    const ids: ID[] = []
    for (const n of Object.values(s.notifications)) if (!n.readAt && n.kind === 'run.failed' && n.ref?.kind === 'run') ids.push(n.ref.id)
    return ids.sort().join(',')
  })
  const opened = useRunTracker((s) => s.opened)
  const all = new Set([...fromSession.split(','), ...fromNotifications.split(',')].filter(Boolean))
  return [...all].filter((id) => !opened[id]).sort()
}

export function useJustFinishedIds(): ID[] {
  const key = useRunTracker((s) => Object.keys(s.finished).sort().join(','))
  return key ? key.split(',') : []
}
