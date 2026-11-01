import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { useLocalStorageState } from '@/ui/hooks/useLocalStorageState'
import { BREAKPOINTS, useMediaQuery } from '@/ui/hooks/useMediaQuery'

export interface SplitPaneProps {
  /** Persist size/collapsed per id in localStorage (`atrium.split.<id>`). */
  id?: string
  /** 'horizontal' = side by side (vertical handle); 'vertical' = stacked (horizontal handle). */
  orientation?: 'horizontal' | 'vertical'
  /** The sized pane. */
  primary: ReactNode
  /** The flexible pane. */
  secondary: ReactNode
  /** Where the sized pane sits. Default 'start' (left/top). */
  primarySide?: 'start' | 'end'
  /** px. Default 320. */
  defaultSize?: number
  minSize?: number
  maxSize?: number
  /** Allow collapsing the primary pane (drag past the minimum, Enter or double-click the handle). */
  collapsible?: boolean
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
  onSizeChange?: (size: number) => void
  /** Below this breakpoint render the panes stacked without a handle. Default 'md'; false = never. */
  stackBelow?: 'sm' | 'md' | 'lg' | false
  /** Accessible name for the handle. */
  handleLabel?: string
  className?: string
  primaryClassName?: string
  secondaryClassName?: string
}

interface Persisted {
  size: number
  collapsed: boolean
}

const STEP = 16
const BIG_STEP = 64

/**
 * Two resizable panes with an accessible separator handle: drag, or focus it and use arrows (Shift = bigger
 * steps), Home/End for min/max, Enter to collapse/restore. Size persists per `id`.
 */
export function SplitPane({
  id,
  orientation = 'horizontal',
  primary,
  secondary,
  primarySide = 'start',
  defaultSize = 320,
  minSize = 200,
  maxSize = 640,
  collapsible = false,
  collapsed: collapsedProp,
  onCollapsedChange,
  onSizeChange,
  stackBelow = 'md',
  handleLabel = 'Resize panel',
  className,
  primaryClassName,
  secondaryClassName,
}: SplitPaneProps) {
  const clamp = (n: number) => Math.min(maxSize, Math.max(minSize, Math.round(n)))
  const drag = useRef<{ start: number; size: number } | null>(null)
  const [persisted, setPersisted] = useLocalStorageState<Persisted>(id ? `atrium.split.${id}` : `atrium.split.__ephemeral`, {
    size: clamp(defaultSize),
    collapsed: false,
  })
  const [local, setLocal] = useState<Persisted>({ size: clamp(defaultSize), collapsed: false })
  // While dragging, keep the size in memory and persist once on release.
  const [live, setLive] = useState<Persisted | null>(null)
  const stored = id ? persisted : local
  const state = live ?? stored
  const commit = (next: Persisted) => {
    if (id) setPersisted(next)
    else setLocal(next)
    if (next.size !== stored.size) onSizeChange?.(next.size)
    if (next.collapsed !== stored.collapsed) onCollapsedChange?.(next.collapsed)
  }
  const setState = (next: Persisted) => (drag.current ? setLive(next) : commit(next))
  const collapsed = collapsible && (collapsedProp ?? state.collapsed)
  const size = clamp(state.size)
  const [dragging, setDragging] = useState(false)
  const paneId = useId()
  const horizontal = orientation === 'horizontal'
  const stacked = useMediaQuery(stackBelow ? `(max-width: ${BREAKPOINTS[stackBelow] - 0.02}px)` : '(max-width: 0px)')
  // Moving the pointer towards the secondary pane grows the primary pane.
  const sign = primarySide === 'start' ? 1 : -1

  if (stacked) {
    return (
      <div className={cn('flex min-h-0 flex-col', className)}>
        <div className={cn('min-h-0', primaryClassName)}>{primary}</div>
        <div className={cn('min-h-0 flex-1 border-t border-line', secondaryClassName)}>{secondary}</div>
      </div>
    )
  }

  const setSize = (next: number, opts: { allowCollapse?: boolean } = {}) => {
    if (collapsible && opts.allowCollapse && next < minSize * 0.6) {
      if (!collapsed) setState({ size, collapsed: true })
      return
    }
    setState({ size: clamp(next), collapsed: false })
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { start: horizontal ? e.clientX : e.clientY, size: collapsed ? 0 : size }
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const delta = ((horizontal ? e.clientX : e.clientY) - drag.current.start) * sign
    setSize(drag.current.size + delta, { allowCollapse: true })
  }
  const endDrag = () => {
    drag.current = null
    setDragging(false)
    if (live) commit(live)
    setLive(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = horizontal ? (primarySide === 'start' ? 'ArrowRight' : 'ArrowLeft') : primarySide === 'start' ? 'ArrowDown' : 'ArrowUp'
    const shrink = horizontal ? (primarySide === 'start' ? 'ArrowLeft' : 'ArrowRight') : primarySide === 'start' ? 'ArrowUp' : 'ArrowDown'
    const step = e.shiftKey ? BIG_STEP : STEP
    if (e.key === grow) {
      e.preventDefault()
      setSize((collapsed ? minSize - step : size) + step)
    } else if (e.key === shrink) {
      e.preventDefault()
      if (collapsed) return
      if (collapsible && size <= minSize) setState({ size, collapsed: true })
      else setSize(size - step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSize(minSize)
    } else if (e.key === 'End') {
      e.preventDefault()
      setSize(maxSize)
    } else if (e.key === 'Enter' && collapsible) {
      e.preventDefault()
      setState({ size, collapsed: !collapsed })
    }
  }

  const primaryPane = (
    <div
      id={paneId}
      className={cn('relative min-h-0 min-w-0 shrink-0 overflow-hidden', collapsed && 'invisible', primaryClassName)}
      style={horizontal ? { width: collapsed ? 0 : size } : { height: collapsed ? 0 : size }}
      aria-hidden={collapsed || undefined}
    >
      {primary}
    </div>
  )

  const handle = (
    <div
      role="separator"
      tabIndex={0}
      aria-label={handleLabel}
      aria-controls={paneId}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuenow={collapsed ? 0 : size}
      aria-valuemin={collapsible ? 0 : minSize}
      aria-valuemax={maxSize}
      aria-valuetext={collapsed ? 'Collapsed' : `${size} pixels`}
      data-dragging={dragging ? '' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => (collapsible ? setState({ size, collapsed: !collapsed }) : setSize(defaultSize))}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative z-10 shrink-0 touch-none outline-none select-none',
        horizontal ? '-mx-1 w-2 cursor-col-resize' : '-my-1 h-2 cursor-row-resize',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute bg-line transition-[background-color,width,height] duration-(--dur-1) ease-standard',
          horizontal ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2',
          'group-hover:bg-line-strong',
          'group-focus-visible:bg-accent',
          horizontal ? 'group-focus-visible:w-0.5' : 'group-focus-visible:h-0.5',
          dragging && (horizontal ? 'w-0.5 bg-accent' : 'h-0.5 bg-accent'),
        )}
      />
    </div>
  )

  const secondaryPane = <div className={cn('min-h-0 min-w-0 flex-1 overflow-hidden', secondaryClassName)}>{secondary}</div>

  return (
    <div className={cn('flex min-h-0 min-w-0', horizontal ? 'flex-row' : 'flex-col', dragging && (horizontal ? 'cursor-col-resize' : 'cursor-row-resize'), className)}>
      {primarySide === 'start' ? (
        <>
          {primaryPane}
          {handle}
          {secondaryPane}
        </>
      ) : (
        <>
          {secondaryPane}
          {handle}
          {primaryPane}
        </>
      )}
    </div>
  )
}
