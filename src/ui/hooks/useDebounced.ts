import { useEffect, useMemo, useRef, useState } from 'react'
import { useLatest } from './useLatest'

/** The value, settled: updates only after it stops changing for `ms`. */
export function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

/** A debounced function with `.cancel()` and `.flush()`. */
export function useDebouncedCallback<A extends unknown[]>(fn: (...args: A) => void, ms = 200) {
  const fnRef = useLatest(fn)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<A | null>(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  return useMemo(() => {
    const run = (...args: A) => {
      pending.current = args
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        pending.current = null
        fnRef.current(...args)
      }, ms)
    }
    run.cancel = () => {
      clearTimeout(timer.current)
      pending.current = null
    }
    run.flush = () => {
      if (!pending.current) return
      clearTimeout(timer.current)
      const args = pending.current
      pending.current = null
      fnRef.current(...args)
    }
    return run
  }, [ms, fnRef])
}
