import { useCallback, useRef, useState } from 'react'
import { useLatest } from './useLatest'

/**
 * Controlled/uncontrolled state in one hook. When `value` is defined the component is controlled;
 * otherwise it owns the state, seeded from `defaultValue`. `onChange` fires for every change either way.
 */
export function useControllableState<T>(options: {
  value?: T
  defaultValue: T
  onChange?: (value: T) => void
}): [T, (next: T | ((prev: T) => T)) => void] {
  const { value, defaultValue, onChange } = options
  const [internal, setInternal] = useState<T>(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? (value as T) : internal
  const currentRef = useRef(current)
  currentRef.current = current
  const onChangeRef = useLatest(onChange)
  const controlledRef = useLatest(controlled)

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(currentRef.current) : next
      if (Object.is(resolved, currentRef.current)) return
      currentRef.current = resolved
      if (!controlledRef.current) setInternal(resolved)
      onChangeRef.current?.(resolved)
    },
    [controlledRef, onChangeRef],
  )

  return [current, setValue]
}
