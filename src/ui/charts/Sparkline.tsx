import { useId, useMemo, useState, type HTMLAttributes, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import { CHART_SURFACE } from './palette'
import { formatValue, linearScale, nearestIndex } from './scale'
import { useElementSize } from './frame'

export interface SparklineProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Values in order (oldest → newest), or timestamped points. */
  values: readonly number[] | readonly { t: number; v: number }[]
  variant?: 'line' | 'bars'
  /** Soft area wash under the line. */
  area?: boolean
  /** Line/bar color. Default: de-emphasis ink with the latest point in the accent. */
  color?: string
  /** Mark the latest point (accent, ringed) — the "current period". */
  highlightLast?: boolean
  height?: number
  /** Accessible summary (e.g. "Runs per day, last 14 days"). */
  label: string
  format?: (v: number) => string
  /** Include zero in the range (bars always do). */
  zero?: boolean
}

/**
 * Word-sized trend: de-emphasis line or bars with the current period in the accent, hover
 * readout of any point, and a text summary (first, last, low, high) for assistive tech.
 */
export function Sparkline({
  values,
  variant = 'line',
  area = false,
  color,
  highlightLast = true,
  height = 32,
  label,
  format = formatValue,
  zero = false,
  className,
  ...props
}: SparklineProps) {
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const gradId = useId()
  const vs = useMemo(() => values.map((p) => (typeof p === 'number' ? p : p.v)), [values])
  const n = vs.length
  const bars = variant === 'bars'
  const stroke = color ?? 'var(--ink-3)'
  const accent = color ?? 'var(--accent)'

  const lo = Math.min(...vs, bars || zero ? 0 : Infinity)
  const hi = Math.max(...vs, 0)
  const pad = 4
  const y = linearScale([lo, hi === lo ? lo + 1 : hi], [height - pad, pad])
  const x = linearScale([0, Math.max(1, n - 1)], [pad, Math.max(pad + 1, width - pad)])
  const bw = n > 0 ? Math.max(1.5, Math.min(8, (width - pad * 2) / n - 2)) : 0
  const bx = (i: number) => pad + (i + 0.5) * ((width - pad * 2) / Math.max(1, n)) - bw / 2

  const line = vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const areaD = n ? `${line}L${x(n - 1).toFixed(1)},${height}L${x(0).toFixed(1)},${height}Z` : ''

  const summary = n
    ? `${label}. ${n} points: first ${format(vs[0])}, latest ${format(vs[n - 1])}, low ${format(Math.min(...vs))}, high ${format(Math.max(...vs))}.`
    : `${label}. No data.`

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!n || !width) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const idx = bars ? Math.max(0, Math.min(n - 1, Math.floor(((px - pad) / (width - pad * 2)) * n))) : nearestIndex(vs.map((_, i) => x(i)), px)
    setHover(idx)
  }

  const shown = hover ?? (highlightLast ? n - 1 : null)
  const hx = shown != null ? (bars ? bx(shown) + bw / 2 : x(shown)) : 0

  return (
    <div
      ref={ref}
      role="img"
      aria-label={summary}
      className={cn('relative w-full', className)}
      style={{ height }}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
      {...props}
    >
      {width > 0 && n > 0 && (
        <svg width={width} height={height} aria-hidden className="block overflow-visible">
          {area && !bars && (
            <>
              <defs>
                <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={color ?? 'var(--accent)'} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={color ?? 'var(--accent)'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={areaD} fill={`url(#${gradId})`} />
            </>
          )}
          {bars ? (
            vs.map((v, i) => {
              const top = y(Math.max(0, v))
              const h = Math.max(1, Math.abs(y(0) - y(v)))
              const isCur = i === shown
              return (
                <rect
                  key={i}
                  x={bx(i)}
                  y={v >= 0 ? top : y(0)}
                  width={bw}
                  height={h}
                  rx={Math.min(1.5, bw / 2)}
                  fill={isCur ? accent : stroke}
                  opacity={isCur || color ? 1 : 0.55}
                />
              )
            })
          ) : (
            <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
          )}
          {!bars && shown != null && (
            <circle cx={hx} cy={y(vs[shown])} r={3} fill={accent} stroke={CHART_SURFACE} strokeWidth={2} />
          )}
          {hover != null && !bars && <line x1={hx} x2={hx} y1={0} y2={height} stroke="var(--ink-4)" strokeWidth={1} shapeRendering="crispEdges" />}
        </svg>
      )}
      {hover != null && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-6 z-10 -translate-x-1/2 rounded-xs border border-line bg-overlay px-1.5 py-0.5 font-mono text-2xs whitespace-nowrap text-ink shadow-e1 tabular"
          style={{ left: Math.max(16, Math.min(width - 16, hx)) }}
        >
          {format(vs[hover])}
        </span>
      )}
    </div>
  )
}
