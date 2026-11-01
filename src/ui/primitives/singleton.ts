import { useCallback, useId, useLayoutEffect, useSyncExternalStore } from 'react'

interface Registry {
  ids: string[]
  listeners: Set<() => void>
}

const registries = new Map<string, Registry>()

function registry(name: string): Registry {
  let reg = registries.get(name)
  if (!reg) {
    reg = { ids: [], listeners: new Set() }
    registries.set(name, reg)
  }
  return reg
}

/**
 * Only the first mounted instance of a host (toasts, confirms) renders, so hosts can be mounted
 * defensively in several places (app shell, dev gallery) without duplicating UI.
 */
export function useSingletonHost(name: string): boolean {
  const id = useId()
  const reg = registry(name)
  const subscribe = useCallback(
    (cb: () => void) => {
      reg.listeners.add(cb)
      return () => reg.listeners.delete(cb)
    },
    [reg],
  )
  useLayoutEffect(() => {
    reg.ids.push(id)
    reg.listeners.forEach((l) => l())
    return () => {
      reg.ids = reg.ids.filter((x) => x !== id)
      reg.listeners.forEach((l) => l())
    }
  }, [id, reg])
  return useSyncExternalStore(
    subscribe,
    () => reg.ids[0] === id,
    () => false,
  )
}

/** Is any host of this kind mounted? (Imperative APIs fall back when not.) */
export function hasHost(name: string): boolean {
  return registry(name).ids.length > 0
}
