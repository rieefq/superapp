import { useCallback, useLayoutEffect, useRef } from 'react'

/** A ref that always holds the latest value (safe to read inside listeners and timers). */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}

/**
 * A stable callback identity that always calls the latest handler.
 * Use for handlers handed to DOM listeners, timers or memoized children.
 */
export function useStableCallback<A extends unknown[], R>(fn: ((...args: A) => R) | undefined): (...args: A) => R | undefined {
  const ref = useLatest(fn)
  return useCallback((...args: A) => ref.current?.(...args), [ref])
}
