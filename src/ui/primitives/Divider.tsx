import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'

export interface DividerProps extends HTMLAttributes<HTMLDivElement> {
  ref?: Ref<HTMLDivElement>
  orientation?: 'horizontal' | 'vertical'
  /** Optional `label`-role kicker set into the line. */
  label?: ReactNode
  /** Where the label sits. Default 'start'. */
  labelAlign?: 'start' | 'center'
  /** Use the stronger hairline. */
  strong?: boolean
}

/** A 1px hairline. Horizontal by default; vertical stretches to its flex row's height. */
export function Divider({ orientation = 'horizontal', label, labelAlign = 'start', strong, className, ...props }: DividerProps) {
  const line = strong ? 'bg-line-strong' : 'bg-line'
  if (orientation === 'vertical') {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn('w-px shrink-0 self-stretch', line, className)}
        {...props}
      />
    )
  }
  if (label) {
    return (
      <div role="separator" className={cn('flex items-center gap-3', className)} {...props}>
        {labelAlign === 'center' && <span aria-hidden className={cn('h-px flex-1', line)} />}
        <span className="type-label shrink-0 text-ink-3">{label}</span>
        <span aria-hidden className={cn('h-px flex-1', line)} />
      </div>
    )
  }
  return <div role="separator" className={cn('h-px w-full shrink-0', line, className)} {...props} />
}
