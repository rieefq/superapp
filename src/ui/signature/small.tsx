import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { useCopy } from '@/ui/hooks'
import { Tooltip } from '@/ui/primitives'

/* Small parts (docs/DESIGN.md §5.4.13): MetaLabel, IdCode, TickMeter. */

/** A `label` kicker: 11px, 600, condensed, tracked, uppercase, ink-3. */
export function MetaLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('type-label text-ink-3', className)}>{children}</span>
}

export interface IdCodeProps {
  /** The entity id (`run_k3j9x0q2ab`). */
  id: string
  /** Prefix for the handle (default: the id's own prefix): `label="pr"` → `PR-K3J9`. */
  label?: string
  className?: string
}

/** A copyable handle (`RUN-K3J9`). Click copies it; a "Copied" tooltip confirms. */
export function IdCode({ id, label, className }: IdCodeProps) {
  const code = shortCode(id, label)
  const { copy, copied } = useCopy(1400)
  return (
    <Tooltip content={copied ? 'Copied' : 'Copy handle'} open={copied ? true : undefined}>
      <button
        type="button"
        onClick={() => void copy(code)}
        aria-label={`Handle ${code}. Copy`}
        className={cn(
          'type-meta relative inline-flex h-4 shrink-0 items-center rounded-xs px-0.5 -mx-0.5 text-ink-3 transition-colors duration-(--dur-1) ease-standard',
          'hover:bg-hover hover:text-ink-2 focus-visible:outline-offset-0',
          "pointer-coarse:after:absolute pointer-coarse:after:-inset-3.5 pointer-coarse:after:content-['']",
          className,
        )}
      >
        {code}
      </button>
    </Tooltip>
  )
}

export interface TickMeterProps {
  /** Current value in the same unit as `max`. */
  value: number
  max?: number
  /** Accessible name, e.g. "Monthly budget". */
  label: string
  /** Screen-reader value text, e.g. "$37.60 of $50". */
  valueText?: string
  /** Fraction at which the fill turns attn / fail. Default 0.8 / 1. */
  thresholds?: { attn?: number; fail?: number }
  /** Track width in px (default: fill the container). */
  width?: number
  /** Extra tick positions (0..1), e.g. a budget line. Drawn taller, in attn. */
  markers?: readonly number[]
  className?: string
}

export type TickMeterLevel = 'normal' | 'attn' | 'fail'

/** Threshold level for a ratio (≥80% attn, ≥100% fail by default). */
export function tickMeterLevel(ratio: number, thresholds: TickMeterProps['thresholds'] = {}): TickMeterLevel {
  const attn = thresholds.attn ?? 0.8
  const fail = thresholds.fail ?? 1
  if (ratio >= fail) return 'fail'
  if (ratio >= attn) return 'attn'
  return 'normal'
}

const FILL: Record<TickMeterLevel, string> = { normal: 'bg-ink-2', attn: 'bg-attn', fail: 'bg-fail' }

/** A 4px meter on a --line track with 1px ticks every 10%; ink-2 fill turning attn ≥80% and fail ≥100%. */
export function TickMeter({ value, max = 1, label, valueText, thresholds, width, markers, className }: TickMeterProps) {
  const ratio = max > 0 ? Math.max(0, value / max) : 0
  const level = tickMeterLevel(ratio, thresholds)
  const pct = Math.min(1, ratio) * 100
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={valueText ?? `${Math.round(ratio * 100)}%`}
      className={cn('relative h-2 shrink-0', !width && 'w-full', className)}
      style={width ? { width } : undefined}
    >
      <div className="absolute inset-x-0 top-0.5 h-1 overflow-hidden rounded-[1px] bg-line">
        <div className={cn('h-full transition-[width,background-color] duration-(--dur-3) ease-standard', FILL[level])} style={{ width: `${pct}%` }} />
      </div>
      {Array.from({ length: 9 }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute top-0.5 h-1 w-px [background-color:var(--sig-meter-gap,var(--surface-canvas))]"
          style={{ left: `calc(${(i + 1) * 10}% - 0.5px)` }}
        />
      ))}
      {markers?.map((m) => (
        <span key={m} aria-hidden className="absolute top-0 h-2 w-px bg-attn" style={{ left: `calc(${Math.min(1, Math.max(0, m)) * 100}% - 0.5px)` }} />
      ))}
    </div>
  )
}
