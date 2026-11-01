import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { computePosition, toRect, type Placement, type PositionOptions, type Side } from './positioning'

/** Anything with a client rect: an element, or a virtual point (context menus). */
export interface VirtualAnchor {
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
}
export type FloatingAnchor = Element | VirtualAnchor

export interface UseFloatingOptions extends PositionOptions {
  open: boolean
  anchor: FloatingAnchor | null | undefined
  /** 'min': at least as wide as the anchor (selects); true: exactly as wide. */
  matchWidth?: boolean | 'min'
  /** Hide while the anchor is scrolled out of view. Default true. */
  hideWhenDetached?: boolean
}

export interface FloatingState {
  /** Callback ref for the floating element (render it with position: fixed). */
  setFloating: (el: HTMLElement | null) => void
  side: Side
  placement: Placement
  /** Recompute now (e.g. after content changes size). */
  update: () => void
}

/**
 * Keeps a fixed-position element anchored: positions synchronously when the element attaches, then
 * follows scroll (any container), resize and size changes of anchor or content. Writes left/top/max-*
 * directly to the element so React re-renders never fight the measurement.
 */
export function useFloating(options: UseFloatingOptions): FloatingState {
  const { open, anchor, matchWidth = false, hideWhenDetached = true, ...positionOptions } = options
  const [floating, setFloatingState] = useState<HTMLElement | null>(null)
  const [resolved, setResolved] = useState<{ side: Side; placement: Placement }>(() => {
    const placement = positionOptions.placement ?? 'bottom-start'
    return { side: placement.split('-')[0] as Side, placement }
  })
  const config = useRef({ anchor, matchWidth, hideWhenDetached, positionOptions })
  config.current = { anchor, matchWidth, hideWhenDetached, positionOptions }

  const position = useCallback((el: HTMLElement) => {
    const { anchor: a, matchWidth: mw, hideWhenDetached: hide, positionOptions: opts } = config.current
    if (!a) return
    if (a instanceof Element && !a.isConnected) return
    const rect = a.getBoundingClientRect()
    if (mw === 'min') el.style.minWidth = `${rect.width}px`
    else if (mw) el.style.width = `${rect.width}px`
    // Measure the natural size: drop previous constraints first (offset sizes ignore transforms).
    el.style.maxHeight = ''
    el.style.maxWidth = ''
    const size = { width: el.offsetWidth, height: el.offsetHeight }
    const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight }
    const result = computePosition(toRect(rect), size, viewport, opts)
    el.style.left = `${result.x}px`
    el.style.top = `${result.y}px`
    const vertical = result.side === 'top' || result.side === 'bottom'
    if (opts.constrain !== false) {
      if (vertical) el.style.maxHeight = `${result.maxHeight}px`
      else el.style.maxWidth = `${result.maxWidth}px`
    }
    if (vertical) el.style.maxWidth = `${result.maxWidth}px`
    el.style.transformOrigin = result.transformOrigin
    el.style.visibility = hide && result.anchorHidden ? 'hidden' : ''
    el.dataset.side = result.side
    setResolved((prev) =>
      prev.side === result.side && prev.placement === result.placement ? prev : { side: result.side, placement: result.placement },
    )
  }, [])

  const floatingRef = useRef<HTMLElement | null>(null)
  const setFloating = useCallback(
    (el: HTMLElement | null) => {
      floatingRef.current = el
      setFloatingState(el)
      if (el) {
        el.style.position = 'fixed'
        position(el)
      }
    },
    [position],
  )

  const update = useCallback(() => {
    if (floatingRef.current) position(floatingRef.current)
  }, [position])

  const { placement, offset, crossOffset, padding, flip, shift, constrain } = positionOptions
  useLayoutEffect(() => {
    if (open) update()
  }, [open, update, anchor, matchWidth, placement, offset, crossOffset, padding, flip, shift, constrain])

  useLayoutEffect(() => {
    if (!open || !floating || !anchor) return
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(floating)
    if (anchor instanceof Element) ro?.observe(anchor)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
      ro?.disconnect()
    }
  }, [open, floating, anchor, update])

  return { setFloating, side: resolved.side, placement: resolved.placement, update }
}
