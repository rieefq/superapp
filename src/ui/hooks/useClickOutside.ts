import { useEffect, type RefObject } from 'react'
import { useLatest } from './useLatest'

type Target = RefObject<Element | null> | Element | null | undefined

/**
 * Calls `handler` on a pointerdown outside every given element/ref. Uses the capture phase so it fires
 * before click handlers. Pass `enabled: false` while closed.
 */
export function useClickOutside(
  targets: Target | readonly Target[],
  handler: (event: PointerEvent) => void,
  enabled = true,
): void {
  const handlerRef = useLatest(handler)
  const targetsRef = useLatest(targets)
  useEffect(() => {
    if (!enabled) return
    const onPointerDown = (e: PointerEvent) => {
      const node = e.target as Node | null
      if (!node || !node.isConnected) return
      const list = (Array.isArray(targetsRef.current) ? targetsRef.current : [targetsRef.current]) as Target[]
      const inside = list.some((t) => {
        const el = t && 'current' in t ? t.current : (t as Element | null | undefined)
        return !!el && el.contains(node)
      })
      if (!inside) handlerRef.current(e)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [enabled, handlerRef, targetsRef])
}
