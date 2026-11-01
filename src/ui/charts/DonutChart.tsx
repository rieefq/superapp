import { useMemo, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { foldIntoOther, OTHER_COLOR, resolveSeriesColor, type SeriesColorSpec } from './palette'
import { formatValue } from './scale'
import { ChartFrame, ChartLegend, PlotPlaceholder, type ChartSurface } from './frame'

export interface DonutSlice extends SeriesColorSpec {
  id?: string
  label: string
  value: number
}

export interface DonutChartProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  slices: readonly DonutSlice[]
  /** Slices beyond this fold into "Other" (default 6). */
  maxSlices?: number
  title?: ReactNode
  description?: ReactNode
  /** Center readout when nothing is hovered (defaults to the total). */
  centerLabel?: ReactNode
  centerValue?: ReactNode
  format?: (v: number) => string
  /** Diameter in px. */
  size?: number
  /** Ring thickness in px. */
  thickness?: number
  legend?: boolean
  loading?: boolean
  empty?: ReactNode
  surface?: ChartSurface
  ariaLabel?: string
  hideViewToggle?: boolean
}

interface Slice {
  key: string
  label: string
  value: number
  color: string
  share: number
  a0: number
  a1: number
}

const TAU = Math.PI * 2
const GAP = 2

function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

/** Ring segment with a constant-width (parallel-sided) gap at both ends. */
function arcPath(cx: number, cy: number, ro: number, ri: number, a0: number, a1: number, gap: number): string {
  const span = a1 - a0
  if (span <= 0) return ''
  if (span >= TAU - 1e-6) {
    // full ring: two half arcs
    const [x0, y0] = polar(cx, cy, ro, 0)
    const [x1, y1] = polar(cx, cy, ro, Math.PI)
    const [x2, y2] = polar(cx, cy, ri, 0)
    const [x3, y3] = polar(cx, cy, ri, Math.PI)
    return `M${x0},${y0}A${ro},${ro} 0 1 1 ${x1},${y1}A${ro},${ro} 0 1 1 ${x0},${y0}ZM${x2},${y2}A${ri},${ri} 0 1 0 ${x3},${y3}A${ri},${ri} 0 1 0 ${x2},${y2}Z`
  }
  const go = gap / 2 / ro
  const gi = gap / 2 / ri
  const oa0 = a0 + go
  const oa1 = a1 - go
  const ia0 = a0 + gi
  const ia1 = a1 - gi
  if (oa1 <= oa0 || ia1 <= ia0) return ''
  const large = oa1 - oa0 > Math.PI ? 1 : 0
  const largeI = ia1 - ia0 > Math.PI ? 1 : 0
  const [ox0, oy0] = polar(cx, cy, ro, oa0)
  const [ox1, oy1] = polar(cx, cy, ro, oa1)
  const [ix1, iy1] = polar(cx, cy, ri, ia1)
  const [ix0, iy0] = polar(cx, cy, ri, ia0)
  return `M${ox0.toFixed(2)},${oy0.toFixed(2)}A${ro},${ro} 0 ${large} 1 ${ox1.toFixed(2)},${oy1.toFixed(2)}L${ix1.toFixed(2)},${iy1.toFixed(2)}A${ri},${ri} 0 ${largeI} 0 ${ix0.toFixed(2)},${iy0.toFixed(2)}Z`
}

/**
 * Donut for one whole split into ≤ 6 parts (the tail folds into "Other"). Thin ring with
 * 2px surface gaps; the center is the tooltip — it reads out the hovered/focused slice
 * (label, value, share) without ever covering the ring. Legend with values and shares,
 * arrow-key inspection, live announcement and a table twin.
 */
export function DonutChart({
  slices,
  maxSlices = 6,
  title,
  description,
  centerLabel = 'Total',
  centerValue,
  format = formatValue,
  size = 176,
  thickness = 16,
  legend = true,
  loading = false,
  empty,
  surface = 'canvas',
  ariaLabel,
  hideViewToggle,
  className,
  ...props
}: DonutChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)

  const data = useMemo(() => {
    // Colors follow the entity (input order), assigned before sorting/folding.
    const colored = slices
      .filter((s) => s.value > 0)
      .map((s, i) => ({ ...s, key: s.id ?? `${s.label}-${i}`, color: resolveSeriesColor(s, slices.indexOf(s)) }))
    const { items } = foldIntoOther(colored, maxSlices, (rest, total) => ({
      key: '__other',
      label: `Other (${rest.length})`,
      value: total,
      color: OTHER_COLOR,
    }))
    const total = items.reduce((s, it) => s + it.value, 0)
    let a = 0
    const out: Slice[] = items.map((it) => {
      const share = total ? it.value / total : 0
      const a0 = a
      a += share * TAU
      return { key: it.key, label: it.label, value: it.value, color: it.color, share, a0, a1: a }
    })
    return { slices: out, total }
  }, [slices, maxSlices])

  const hasData = data.total > 0
  const r = size / 2
  const ri = r - thickness
  const pct = (s: number) => `${(s * 100).toFixed(s < 0.1 ? 1 : 0)}%`
  const cur = active != null ? data.slices[active] : null

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = data.slices.length
    if (!n) return
    const i = active ?? -1
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % n
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + n) % n
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') return setActive(null)
    if (next === null) return
    e.preventDefault()
    setActive(next)
  }

  const summary =
    ariaLabel ??
    (hasData
      ? `Donut chart, total ${format(data.total)}. ` + data.slices.map((s) => `${s.label}: ${format(s.value)} (${pct(s.share)})`).join('; ')
      : 'Empty chart')

  const table = {
    caption: typeof title === 'string' ? title : 'Share',
    columns: [
      { key: 'label', label: 'Part' },
      { key: 'value', label: 'Value', align: 'right' as const },
      { key: 'share', label: 'Share', align: 'right' as const },
    ],
    rows: [
      ...data.slices.map((s) => ({ label: s.label, value: format(s.value), share: pct(s.share) })),
      { label: 'Total', value: format(data.total), share: '100%' },
    ],
  }

  return (
    <ChartFrame
      title={title}
      description={description}
      surface={surface}
      plotHeight={size}
      table={hasData ? table : undefined}
      hideViewToggle={hideViewToggle}
      readout={focused && cur ? `${cur.label}: ${format(cur.value)}, ${pct(cur.share)}` : ''}
      className={className}
      {...props}
    >
      {!hasData ? (
        <PlotPlaceholder height={size} loading={loading}>
          {empty}
        </PlotPlaceholder>
      ) : (
        <div className={cn('flex flex-wrap items-center gap-x-8 gap-y-5', loading && 'opacity-50')}>
          <div
            tabIndex={0}
            role="group"
            aria-roledescription="chart"
            aria-label={`${summary} Use arrow keys to inspect parts.`}
            onKeyDown={onKey}
            onFocus={() => {
              setFocused(true)
              setActive((a) => a ?? 0)
            }}
            onBlur={() => {
              setFocused(false)
              setActive(null)
            }}
            className="atr-fade relative shrink-0 rounded-full focus-visible:outline-offset-4"
            style={{ width: size, height: size }}
          >
            <svg width={size} height={size} aria-hidden className="block">
              {data.slices.map((s, i) => (
                <g key={s.key} onPointerEnter={() => setActive(i)} onPointerLeave={() => !focused && setActive(null)}>
                  <path
                    d={arcPath(r, r, r, ri, s.a0, s.a1, data.slices.length > 1 ? GAP : 0)}
                    fill={s.color}
                    opacity={cur && cur !== s ? 0.38 : 1}
                    className="transition-opacity duration-(--dur-1)"
                  />
                  {/* hit target wider than the ring */}
                  <path d={arcPath(r, r, r, Math.max(0, ri - 14), s.a0, s.a1, 0)} fill="transparent" />
                </g>
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center" style={{ padding: thickness + 10 }}>
              <span className="max-w-full truncate text-2xs text-ink-3">{cur ? cur.label : centerLabel}</span>
              <span className="text-xl font-semibold text-ink">{cur ? format(cur.value) : (centerValue ?? format(data.total))}</span>
              <span className={cn('font-mono text-2xs text-ink-3 tabular', !cur && 'invisible')}>{cur ? pct(cur.share) : '0%'}</span>
            </div>
          </div>
          {legend && (
            <ChartLegend
              direction="column"
              className="min-w-44 flex-1"
              items={data.slices.map((s) => ({
                id: s.key,
                label: s.label,
                color: s.color,
                shape: 'rect',
                value: (
                  <span className="inline-flex items-baseline gap-2">
                    <span>{format(s.value)}</span>
                    <span className="w-10 text-right text-ink-3">{pct(s.share)}</span>
                  </span>
                ),
              }))}
              onPointerLeave={() => !focused && setActive(null)}
            />
          )}
        </div>
      )}
    </ChartFrame>
  )
}
