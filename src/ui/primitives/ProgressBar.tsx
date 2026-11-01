import type { HTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { PrimitiveStyles } from './styles'

const TONE_FILL = {
  neutral: 'bg-ink-2',
  accent: 'bg-accent',
  live: 'bg-live',
  attn: 'bg-attn',
  done: 'bg-done',
  fail: 'bg-fail',
} as const

const SIZE = { thin: 'h-0.5', sm: 'h-1', md: 'h-1.5' } as const

export interface ProgressBarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  ref?: Ref<HTMLDivElement>
  /** 0..max. Omit (or null) for indeterminate. */
  value?: number | null
  max?: number
  tone?: keyof typeof TONE_FILL
  size?: keyof typeof SIZE
  /** Visible label above the bar (also the accessible name). */
  label?: ReactNode
  /** Show the percentage (or a custom string) at the right of the label row. */
  showValue?: boolean | ((value: number, max: number) => ReactNode)
  /** Accessible name when there is no visible label. */
  'aria-label'?: string
}

/**
 * Thin determinate/indeterminate progress — for file uploads and imports only (DESIGN §5.5); AI runs use
 * the Step Tape. The indeterminate bar becomes a soft pulse under reduced motion.
 */
export function ProgressBar({
  value,
  max = 100,
  tone = 'neutral',
  size = 'sm',
  label,
  showValue,
  className,
  ...props
}: ProgressBarProps) {
  const indeterminate = value == null
  const pct = indeterminate ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  const valueText = indeterminate
    ? undefined
    : typeof showValue === 'function'
      ? showValue(value, max)
      : `${Math.round(pct)}%`
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {indeterminate && <PrimitiveStyles />}
      {(label || (showValue && !indeterminate)) && (
        <div className="flex items-baseline justify-between gap-3 text-xs">
          {label && <span className="truncate text-ink-2">{label}</span>}
          {showValue && !indeterminate && <span className="ml-auto font-mono text-2xs text-ink-3 tabular">{valueText}</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : value}
        aria-valuetext={typeof valueText === 'string' ? valueText : undefined}
        aria-busy={indeterminate || undefined}
        aria-label={typeof label === 'string' ? label : props['aria-label']}
        className={cn('relative w-full overflow-hidden rounded-[1px] bg-line', SIZE[size])}
        {...props}
      >
        {indeterminate ? (
          <div className={cn('atrium-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-[1px]', TONE_FILL[tone])} />
        ) : (
          <div
            className={cn(
              'h-full rounded-[1px] transition-[width] duration-(--dur-3) ease-settle',
              TONE_FILL[tone],
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  )
}
