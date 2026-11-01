import { useSyncExternalStore } from 'react'

/**
 * Shared wall clocks for live elapsed times: every subscriber of an interval ticks together
 * (no drifting clocks between pills and rows), and timers stop when nothing listens.
 */
interface Ticker {
  now: number
  timer: ReturnType<typeof setInterval> | undefined
  listeners: Set<() => void>
  subscribe: (listener: () => void) => () => void
  get: () => number
}

const tickers = new Map<number, Ticker>()

function ticker(intervalMs: number): Ticker {
  const hit = tickers.get(intervalMs)
  if (hit) return hit
  const t: Ticker = {
    now: Date.now(),
    timer: undefined,
    listeners: new Set(),
    subscribe: (listener) => {
      t.listeners.add(listener)
      if (!t.timer) {
        t.now = Date.now()
        t.timer = setInterval(() => {
          t.now = Date.now()
          for (const l of t.listeners) l()
        }, intervalMs)
      }
      return () => {
        t.listeners.delete(listener)
        if (!t.listeners.size && t.timer) {
          clearInterval(t.timer)
          t.timer = undefined
        }
      }
    },
    get: () => t.now,
  }
  tickers.set(intervalMs, t)
  return t
}

const idle = () => () => {}

/** Current time, re-rendering every `intervalMs` while `active` (frozen otherwise). */
export function useNow(active = true, intervalMs = 1000): number {
  const t = ticker(intervalMs)
  return useSyncExternalStore(active ? t.subscribe : idle, t.get, t.get)
}
