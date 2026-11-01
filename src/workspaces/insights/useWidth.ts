import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * The content width of an element, kept current with a ResizeObserver. Tables use it to drop
 * columns by the room they actually have (the Inspector can dock beside a wide viewport).
 * Starts at `initial` until measured (before the first paint).
 */
export function useWidth<T extends HTMLElement>(initial = 1280): [RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = Math.round(el.getBoundingClientRect().width)
      setWidth((cur) => (Math.abs(cur - w) < 1 ? cur : w))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

/** Keep the columns whose minimum container width (`minWidth`, default 0) fits. */
export function fitColumns<C extends { key: string }>(columns: readonly C[], width: number, minWidth: Partial<Record<string, number>>): C[] {
  return columns.filter((c) => width >= (minWidth[c.key] ?? 0))
}
