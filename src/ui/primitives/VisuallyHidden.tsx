import type { HTMLAttributes, Ref } from 'react'
import { cn } from '@/lib/cn'

export interface VisuallyHiddenProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>
  /** Become visible when focused (skip links). */
  focusable?: boolean
}

/** Content for assistive technology only. */
export function VisuallyHidden({ className, focusable, ...props }: VisuallyHiddenProps) {
  return <span className={cn('sr-only', focusable && 'focus:not-sr-only', className)} {...props} />
}
