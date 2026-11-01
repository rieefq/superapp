import { useCallback, useEffect, useRef, useState } from 'react'

const SAME_TAB_EVENT = 'atrium:local-storage'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/**
 * useState persisted to localStorage (JSON). Stays in sync across hook instances and browser tabs.
 * Returns [value, setValue, reset]. Storage failures (private mode, quota) degrade to in-memory state.
 */
export function useLocalStorageState<T>(
  key: string,
  initialValue: T | (() => T),
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  const initialRef = useRef<T | null>(null)
  if (initialRef.current === null) {
    initialRef.current = typeof initialValue === 'function' ? (initialValue as () => T)() : initialValue
  }
  const [value, setValueState] = useState<T>(() => read(key, initialRef.current as T))
  const valueRef = useRef(value)
  valueRef.current = value

  // Re-read when the key changes.
  const lastKey = useRef(key)
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key
      setValueState(read(key, initialRef.current as T))
    }
  }, [key])

  useEffect(() => {
    const sync = (e: Event) => {
      const changedKey = e instanceof StorageEvent ? e.key : (e as CustomEvent<string>).detail
      if (changedKey === key || changedKey === null) setValueState(read(key, initialRef.current as T))
    }
    window.addEventListener('storage', sync)
    window.addEventListener(SAME_TAB_EVENT, sync)
    return () => {
      window.removeEventListener('storage', sync)
      window.removeEventListener(SAME_TAB_EVENT, sync)
    }
  }, [key])

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(valueRef.current) : next
      valueRef.current = resolved
      setValueState(resolved)
      try {
        window.localStorage.setItem(key, JSON.stringify(resolved))
        window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT, { detail: key }))
      } catch {
        /* storage unavailable — keep in-memory value */
      }
    },
    [key],
  )

  const reset = useCallback(() => {
    try {
      window.localStorage.removeItem(key)
      window.dispatchEvent(new CustomEvent(SAME_TAB_EVENT, { detail: key }))
    } catch {
      /* ignore */
    }
    setValueState(initialRef.current as T)
  }, [key])

  return [value, setValue, reset]
}
