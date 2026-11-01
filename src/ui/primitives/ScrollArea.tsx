import { useCallback, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { mergeRefs } from './slot'

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
  orientation?: 'vertical' | 'horizontal' | 'both'
  /** Fade the edges that have more content beyond them. Default true. */
  fade?: boolean
  /** Fade length in px. Default 24. */
  fadeSize?: number
  /** Hide the scrollbar (still scrollable). */
  hideScrollbar?: boolean
}

/**
 * Native scrolling (keyboard, touch, accessibility for free) with thin themed scrollbars and optional
 * edge fades that only appear where there is more to see.
 */
export function ScrollArea({
  orientation = 'vertical',
  fade = true,
  fadeSize = 24,
  hideScrollbar,
  className,
  style,
  onScroll,
  children,
  ref,
  ...props
}: ScrollAreaProps) {
  const inner = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = inner.current
    if (!el || !fade) return
    const vertical = orientation !== 'horizontal'
    const pos = vertical ? el.scrollTop : el.scrollLeft
    const max = vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth
    const next = { start: pos > 1, end: pos < max - 1 }
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next))
  }, [fade, orientation])

  useEffect(() => {
    measure()
    const el = inner.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [measure, children])

  const dir = orientation === 'horizontal' ? 'to right' : 'to bottom'
  const mask =
    fade && (edges.start || edges.end)
      ? `linear-gradient(${dir}, ${edges.start ? 'transparent' : 'black'} 0, black ${edges.start ? fadeSize : 0}px, black calc(100% - ${edges.end ? fadeSize : 0}px), ${edges.end ? 'transparent' : 'black'} 100%)`
      : undefined
  const maskStyle: CSSProperties = mask ? { maskImage: mask, WebkitMaskImage: mask } : {}

  return (
    <div
      ref={mergeRefs(ref, inner)}
      onScroll={(e) => {
        measure()
        onScroll?.(e)
      }}
      className={cn(
        'min-h-0 min-w-0 overscroll-contain',
        orientation === 'vertical' && 'overflow-x-hidden overflow-y-auto',
        orientation === 'horizontal' && 'overflow-x-auto overflow-y-hidden',
        orientation === 'both' && 'overflow-auto',
        hideScrollbar && 'no-scrollbar',
        className,
      )}
      style={{ ...maskStyle, ...style }}
      {...props}
    >
      {children}
    </div>
  )
}
