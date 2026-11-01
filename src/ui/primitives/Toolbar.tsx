import type { HTMLAttributes, KeyboardEvent, Ref } from 'react'
import { cn } from '@/lib/cn'
import { isTypingTarget } from '@/ui/hooks/useIsTyping'
import { getTabbables } from './layers'

export interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
  /** Accessible name (required for role="toolbar"). */
  'aria-label': string
  /** 'bar': a 44px strip with a bottom hairline (pane headers). 'plain': just the row. */
  variant?: 'plain' | 'bar'
}

/**
 * Row of controls (role="toolbar"). ←/→ move between controls, Home/End jump to the ends; text fields keep
 * their arrow keys. Every control stays in the Tab order, so nothing is ever unreachable.
 */
export function Toolbar({ variant = 'plain', className, onKeyDown, children, ...props }: ToolbarProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || isTypingTarget(e.target)) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const items = getTabbables(e.currentTarget)
    const at = items.findIndex((el) => el === e.target || el.contains(e.target as Node))
    if (at < 0 || items.length < 2) return
    let next = at
    if (e.key === 'ArrowRight') next = (at + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (at - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    e.preventDefault()
    items[next].focus()
  }
  return (
    <div
      role="toolbar"
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={cn(
        'flex min-w-0 items-center gap-1',
        variant === 'bar' && 'h-11 shrink-0 border-b border-line px-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

/** Visual group inside a toolbar. */
export function ToolbarGroup({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="group" className={cn('flex items-center gap-0.5', className)} {...props} />
}

/** Thin vertical hairline between toolbar groups. */
export function ToolbarSeparator({ className }: { className?: string }) {
  return <div role="separator" aria-orientation="vertical" className={cn('mx-1 h-4 w-px shrink-0 bg-line', className)} />
}

/** Pushes the following controls to the far end. */
export function ToolbarSpacer() {
  return <div aria-hidden className="flex-1" />
}
