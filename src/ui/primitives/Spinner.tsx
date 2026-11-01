import type { SVGProps } from 'react'
import { cn } from '@/lib/cn'
import { PrimitiveStyles } from './styles'

const SIZES = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const

export interface SpinnerProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: keyof typeof SIZES | number
  /** Accessible label. Without one the spinner is decorative (aria-hidden) — e.g. inside a busy button. */
  label?: string
}

/** Thin ring with a travelling arc. Uses currentColor; spins slower (never stops) under reduced motion. */
export function Spinner({ size = 'md', label, className, ...props }: SpinnerProps) {
  const px = typeof size === 'number' ? size : SIZES[size]
  return (
    <>
      <PrimitiveStyles />
      <svg
        viewBox="0 0 16 16"
        width={px}
        height={px}
        fill="none"
        role={label ? 'status' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={cn('atrium-spin shrink-0', className)}
        {...props}
      >
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
        <path d="M14.25 8A6.25 6.25 0 0 0 8 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </>
  )
}
