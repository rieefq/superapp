import type { HTMLAttributes, ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, CircleAlert, CircleCheck, Minus, OctagonAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { deltaTone, meterTone, type Direction, type MeterTone } from './logic'
import { SkeletonBar } from './internal'

/* ------------------------------------------------------------------------------------------ */
/* Stat                                                                                       */
/* ------------------------------------------------------------------------------------------ */

export interface StatDelta {
  /** Preformatted change, e.g. "12%" or "$4.20" (sign is drawn by the glyph). */
  value: ReactNode
  direction: Direction
  /** Which direction is good news (default up). */
  goodWhen?: 'up' | 'down'
  /** Comparison period, e.g. "vs last week". */
  period?: ReactNode
}

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  /** Preformatted value ("1,284", "12.9K", "$4.2M"). */
  value: ReactNode
  unit?: ReactNode
  delta?: StatDelta
  /** Sparkline / trend slot. */
  trend?: ReactNode
  helper?: ReactNode
  loading?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Tabular figures for values that tick live (avoids jitter); proportional otherwise. */
  tabular?: boolean
  /** Badge slot next to the label (e.g. a "Simulated" or "Estimate" tag). */
  badge?: ReactNode
}

const VALUE_SIZE = { sm: 'text-xl', md: 'text-3xl', lg: 'text-5xl tracking-[-0.025em]' } as const
const DELTA_TONE = { good: 'text-done-ink', bad: 'text-fail-ink', neutral: 'text-ink-3' } as const
const DELTA_WORD = { good: 'improved', bad: 'worsened', neutral: 'unchanged' } as const

/** Stat tile: mono kicker, large value, delta with glyph + meaning color, trend slot. */
export function Stat({ label, value, unit, delta, trend, helper, loading = false, size = 'md', tabular = false, badge, className, ...props }: StatProps) {
  const tone = delta ? deltaTone(delta.direction, delta.goodWhen) : 'neutral'
  const Glyph = !delta ? null : delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus
  return (
    <div className={cn('flex min-w-0 flex-col', className)} aria-busy={loading || undefined} {...props}>
      <div className="flex min-h-5 items-center gap-2">
        <span className="truncate font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase">{label}</span>
        {badge}
      </div>
      <div className={cn('mt-1.5 flex items-end justify-between gap-4', size === 'lg' && 'mt-2')}>
        <div className="min-w-0">
          {loading ? (
            <SkeletonBar className={cn('rounded-xs', size === 'lg' ? 'my-2 h-9 w-40' : size === 'md' ? 'my-1.5 h-6 w-28' : 'my-1 h-5 w-20')} />
          ) : (
            <div className="flex items-baseline gap-1.5">
              <span className={cn('font-sans font-semibold text-ink', VALUE_SIZE[size], tabular && 'tabular')}>{value}</span>
              {unit != null && <span className={cn('text-ink-3', size === 'lg' ? 'text-lg' : 'text-sm')}>{unit}</span>}
            </div>
          )}
          {delta && !loading && (
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs">
              <span className={cn('inline-flex items-center gap-0.5 font-medium tabular', DELTA_TONE[tone])}>
                {Glyph && <Glyph aria-hidden className="size-3.5" strokeWidth={2.25} />}
                <span className="sr-only">
                  {delta.direction === 'flat' ? 'No change' : delta.direction === 'up' ? 'Up' : 'Down'} ({DELTA_WORD[tone]}):
                </span>
                {delta.value}
              </span>
              {delta.period && <span className="text-ink-3">{delta.period}</span>}
            </div>
          )}
        </div>
        {trend && !loading && <div className="w-24 shrink-0 sm:w-28">{trend}</div>}
      </div>
      {helper && <p className="mt-2 text-xs text-ink-3 text-pretty">{helper}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Meter                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export interface MeterProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  value: number
  max?: number
  label?: ReactNode
  /** Right-aligned readout, e.g. "$32.40 of $50". Defaults to a percentage. */
  valueLabel?: ReactNode
  /** Ratios (of max) where the meter turns attn / fail. */
  thresholds?: { attn: number; fail: number }
  /** `low`: usage/budget (high is bad). `high`: health/coverage (low is bad). */
  goodWhen?: 'low' | 'high'
  /** Force a tone (`accent` for neutral progress). Defaults to thresholds. */
  tone?: MeterTone | 'accent'
  /** Status text per tone; shown with a glyph so color is never the only signal. */
  statusLabels?: Partial<Record<MeterTone, ReactNode>>
  hideStatus?: boolean
  size?: 'sm' | 'md'
}

const FILL = { done: 'bg-done', attn: 'bg-attn', fail: 'bg-fail', accent: 'bg-accent' } as const
const TRACK = { done: 'bg-done-tint', attn: 'bg-attn-tint', fail: 'bg-fail-tint', accent: 'bg-accent-tint' } as const
const STATUS_INK = { done: 'text-done-ink', attn: 'text-attn-ink', fail: 'text-fail-ink' } as const
const STATUS_ICON = { done: CircleCheck, attn: CircleAlert, fail: OctagonAlert } as const
const DEFAULT_STATUS: Record<MeterTone, string> = { done: 'Healthy', attn: 'Needs attention', fail: 'Critical' }

/** Ratio against a limit with threshold tones, a same-ramp track and a glyph + label status. */
export function Meter({
  value,
  max = 1,
  label,
  valueLabel,
  thresholds = { attn: 0.75, fail: 0.9 },
  goodWhen = 'low',
  tone: toneProp,
  statusLabels,
  hideStatus = false,
  size = 'md',
  className,
  ...props
}: MeterProps) {
  const ratio = max > 0 ? value / max : 0
  const clamped = Math.max(0, Math.min(1, ratio))
  const auto = meterTone(ratio, thresholds, goodWhen)
  const tone = toneProp ?? auto
  const statusTone: MeterTone | null = tone === 'accent' ? null : tone
  const pct = `${Math.round(ratio * 100)}%`
  const statusText = statusTone ? (statusLabels?.[statusTone] ?? DEFAULT_STATUS[statusTone]) : null
  const Icon = statusTone ? STATUS_ICON[statusTone] : null
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)} {...props}>
      {(label != null || valueLabel !== null) && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          {label != null && <span className="truncate text-ink-2">{label}</span>}
          <span className="ml-auto shrink-0 text-ink tabular">{valueLabel ?? pct}</span>
        </div>
      )}
      <div
        role="meter"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${pct}${statusText && typeof statusText === 'string' ? ` — ${statusText}` : ''}`}
        aria-label={typeof label === 'string' ? label : 'Meter'}
        className={cn('relative w-full overflow-hidden rounded-full', size === 'sm' ? 'h-1' : 'h-1.5', TRACK[tone])}
      >
        <div
          className={cn('h-full rounded-full transition-[width,background-color] duration-(--dur-3) ease-settle', FILL[tone])}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
      {!hideStatus && statusTone && Icon && (
        <span className={cn('inline-flex items-center gap-1 text-xs', STATUS_INK[statusTone])}>
          <Icon aria-hidden className="size-3.5" />
          {statusText}
        </span>
      )}
    </div>
  )
}
