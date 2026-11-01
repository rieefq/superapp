import { useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'

export interface ResizeHandleProps {
  /** Which edge of the pane the handle sits on. */
  edge: 'left' | 'right'
  width: number
  min: number
  max: number
  onResize: (width: number) => void
  onReset: () => void
  label: string
  /** Called when a drag starts and ends (animate width only when not dragging). */
  onDragChange?: (dragging: boolean) => void
  className?: string
}

/**
 * A 4px drag edge (§3.4): drag to resize, double-click to reset, and a keyboard separator
 * (←/→ by 16px, Home/End to the limits) for people who don't drag.
 */
export function ResizeHandle({ edge, width, min, max, onResize, onReset, label, onDragChange, className }: ResizeHandleProps) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const dir = edge === 'left' ? -1 : 1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    start.current = { x: e.clientX, w: width }
    e.currentTarget.setPointerCapture(e.pointerId)
    onDragChange?.(true)
    document.documentElement.style.cursor = 'col-resize'
    document.documentElement.style.userSelect = 'none'
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    onResize(Math.min(max, Math.max(min, start.current.w + dir * (e.clientX - start.current.x))))
  }
  const end = () => {
    if (start.current) onDragChange?.(false)
    start.current = null
    document.documentElement.style.cursor = ''
    document.documentElement.style.userSelect = ''
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16
    let next: number | null = null
    if (e.key === 'ArrowLeft') next = width - dir * step
    else if (e.key === 'ArrowRight') next = width + dir * step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    else if (e.key === 'Enter') {
      e.preventDefault()
      onReset()
      return
    }
    if (next === null) return
    e.preventDefault()
    onResize(Math.min(max, Math.max(min, next)))
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      title="Drag to resize · double-click to reset"
      className={cn(
        'group absolute inset-y-0 z-10 w-1 cursor-col-resize touch-none outline-none',
        edge === 'left' ? '-left-0.5' : '-right-0.5',
        'focus-visible:bg-ink/40',
        className,
      )}
    >
      <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-(--dur-1) group-hover:bg-line-input group-active:bg-ink-3" />
    </div>
  )
}
