import { useMemo, useState, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { CHART_SURFACE, resolveSeriesColor, type SeriesColorSpec } from './palette'
import { approxTextWidth, axisNumberFormatter, formatValue, linearScale, nearestIndex, niceTicks, timeTicks } from './scale'
import { ChartFrame, ChartLegend, ChartTooltip, PlotPlaceholder, useElementSize, type ChartSurface, type TooltipRow } from './frame'

export interface TimePoint {
  /** Epoch ms. */
  t: number
  v: number
}

export interface TimeSeries extends SeriesColorSpec {
  id: string
  label: string
  points: readonly TimePoint[]
}

export interface TimeSeriesChartProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  series: readonly TimeSeries[]
  variant?: 'line' | 'area' | 'stacked-area'
  /** Plot height in px (includes the x-axis band). */
  height?: number
  title?: ReactNode
  description?: ReactNode
  /** Formats values in the tooltip, end labels and table. */
  format?: (v: number) => string
  /** Formats y-axis ticks (default: full under 10K, compact above). */
  tickFormat?: (v: number) => string
  /** Formats the time in the tooltip and table. */
  timeFormat?: (t: number) => string
  /** Start the value axis at zero (areas always do). */
  zero?: boolean
  /** Label line ends (auto: on for ≤ 4 series when they don't collide). */
  directLabels?: boolean
  /** Legend (auto: on for ≥ 2 series). Items toggle series visibility. */
  legend?: boolean
  loading?: boolean
  empty?: ReactNode
  surface?: ChartSurface
  /** Accessible summary (auto-generated otherwise). */
  ariaLabel?: string
  hideViewToggle?: boolean
}

const DAY = 86_400_000

function defaultTimeFormat(ts: readonly number[]): (t: number) => string {
  let minStep = Infinity
  for (let i = 1; i < ts.length; i++) minStep = Math.min(minStep, ts[i] - ts[i - 1])
  const fmt =
    minStep < DAY
      ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return (t) => fmt.format(t)
}

function truncateLabel(s: string, max = 16): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/**
 * Time series as lines, a single-series area or stacked areas. Calendar-aligned x ticks,
 * nice y ticks, hover crosshair with one tooltip for every series (keyboard: ← → Home End),
 * legend toggles, selective end labels and an accessible table twin.
 */
export function TimeSeriesChart({
  series,
  variant = 'line',
  height = 240,
  title,
  description,
  format = formatValue,
  tickFormat,
  timeFormat,
  zero,
  directLabels,
  legend,
  loading = false,
  empty,
  surface = 'canvas',
  ariaLabel,
  hideViewToggle,
  className,
  ...props
}: TimeSeriesChartProps) {
  const [wrapRef, { width }] = useElementSize<HTMLDivElement>()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [active, setActive] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const stacked = variant === 'stacked-area'
  const area = variant !== 'line'

  const colors = useMemo(() => series.map((s, i) => resolveSeriesColor(s, i)), [series])
  const lookups = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.t, p.v]))), [series])
  const ts = useMemo(() => {
    const set = new Set<number>()
    series.forEach((s) => s.points.forEach((p) => set.add(p.t)))
    return [...set].sort((a, b) => a - b)
  }, [series])
  const visibleIdx = useMemo(() => series.map((_, i) => i).filter((i) => !hidden.has(series[i].id)), [series, hidden])
  const fmtTime = useMemo(() => timeFormat ?? defaultTimeFormat(ts), [timeFormat, ts])

  // Stacks (aligned on the union of timestamps; missing = 0).
  const stacks = useMemo(() => {
    if (!stacked) return null
    const lower = new Map<number, number[]>()
    const upper = new Map<number, number[]>()
    const run = ts.map(() => 0)
    for (const i of visibleIdx) {
      const lo = run.slice()
      ts.forEach((t, k) => (run[k] += Math.max(0, lookups[i].get(t) ?? 0)))
      lower.set(i, lo)
      upper.set(i, run.slice())
    }
    return { lower, upper, totals: run }
  }, [stacked, ts, visibleIdx, lookups])

  const hasData = ts.length > 0 && series.some((s) => s.points.length > 0)

  // y domain over visible series
  let yMin = Infinity
  let yMax = -Infinity
  if (stacks) {
    yMin = 0
    yMax = Math.max(0, ...stacks.totals)
  } else {
    for (const i of visibleIdx) for (const p of series[i].points) {
      yMin = Math.min(yMin, p.v)
      yMax = Math.max(yMax, p.v)
    }
    if (zero ?? true) yMin = Math.min(0, yMin)
    if (area) yMin = Math.min(0, yMin)
  }
  if (!Number.isFinite(yMin)) {
    yMin = 0
    yMax = 1
  }
  const tickCount = Math.max(2, Math.min(6, Math.round((height - 32) / 46)))
  const yt = niceTicks(yMin, yMax, tickCount)
  const tickFmt = tickFormat ?? axisNumberFormatter(yt.ticks)
  const yLabelW = Math.max(...yt.ticks.map((t) => approxTextWidth(tickFmt(t), 10.5, true)))
  const M = { top: 10, bottom: 26, left: Math.ceil(yLabelW) + 12 }
  const innerH = Math.max(10, height - M.top - M.bottom)
  const y = linearScale([yt.min, yt.max], [innerH, 0])

  // End labels (selective): ≤ 4 visible series, no collisions, enough room.
  const ends = visibleIdx
    .map((i) => {
      const pts = series[i].points
      if (!pts.length) return null
      const last = pts.reduce((a, b) => (b.t > a.t ? b : a))
      const v = stacks ? (stacks.upper.get(i)?.[ts.indexOf(last.t)] ?? last.v) : last.v
      const text = visibleIdx.length === 1 ? format(last.v) : truncateLabel(series[i].label)
      return { i, t: last.t, v, y: y(v), text }
    })
    .filter((e): e is NonNullable<typeof e> => !!e)
  let showEnds = (directLabels ?? visibleIdx.length <= 4) && ends.length > 0 && width > 320
  if (showEnds) {
    const sorted = [...ends].sort((a, b) => a.y - b.y)
    for (let k = 1; k < sorted.length; k++) if (sorted[k].y - sorted[k - 1].y < 13) showEnds = false
  }
  const endW = showEnds ? Math.max(...ends.map((e) => approxTextWidth(e.text, 11))) + 16 : 0
  if (showEnds && width - M.left - endW < 200) showEnds = false
  const right = showEnds ? endW : 10
  const innerW = Math.max(10, width - M.left - right)

  const t0 = ts[0] ?? 0
  const t1 = ts[ts.length - 1] ?? 1
  const x = linearScale([t0, t1 === t0 ? t0 + 1 : t1], [0, innerW])
  const xt = timeTicks(t0, t1, Math.max(2, Math.floor(innerW / 84)))

  const linePath = (i: number) => {
    if (stacks) {
      const up = stacks.upper.get(i)!
      return ts.map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(up[k]).toFixed(1)}`).join('')
    }
    const pts = [...series[i].points].sort((a, b) => a.t - b.t)
    return pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  }
  const areaPath = (i: number) => {
    if (stacks) {
      const up = stacks.upper.get(i)!
      const lo = stacks.lower.get(i)!
      const top = ts.map((t, k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)},${y(up[k]).toFixed(1)}`).join('')
      const bottom = ts
        .map((t, k) => ({ t, v: lo[k] }))
        .reverse()
        .map((p) => `L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`)
        .join('')
      return `${top}${bottom}Z`
    }
    const pts = [...series[i].points].sort((a, b) => a.t - b.t)
    if (!pts.length) return ''
    const base = y(Math.max(yt.min, 0))
    return `${linePath(i)}L${x(pts[pts.length - 1].t).toFixed(1)},${base.toFixed(1)}L${x(pts[0].t).toFixed(1)},${base.toFixed(1)}Z`
  }

  // Hover / keyboard
  const pxs = ts.map((t) => x(t))
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setActive(nearestIndex(pxs, e.clientX - r.left))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!ts.length) return
    const cur = active ?? ts.length - 1
    const next = e.key === 'ArrowRight' ? cur + 1 : e.key === 'ArrowLeft' ? cur - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ts.length - 1 : null
    if (e.key === 'Escape') {
      setActive(null)
      return
    }
    if (next === null) return
    e.preventDefault()
    setActive(Math.max(0, Math.min(ts.length - 1, next)))
  }

  const activeT = active != null ? ts[active] : undefined
  const tooltipRows: TooltipRow[] = []
  const activeDots: { i: number; cy: number }[] = []
  if (activeT !== undefined) {
    const order = stacks ? [...visibleIdx].reverse() : visibleIdx
    for (const i of order) {
      const v = lookups[i].get(activeT)
      tooltipRows.push({ key: series[i].id, color: colors[i], shape: area ? 'rect' : 'line', label: series[i].label, value: v != null ? format(v) : '—', muted: v == null })
      if (v != null || stacks) {
        const yv = stacks ? stacks.upper.get(i)![active!] : v!
        activeDots.push({ i, cy: y(yv) })
      }
    }
    if (stacks && visibleIdx.length > 1) tooltipRows.push({ key: '__total', shape: 'none', label: 'Total', value: format(stacks.totals[active!]), emphasis: true })
  }

  const readout =
    focused && activeT !== undefined
      ? `${fmtTime(activeT)}: ${visibleIdx.map((i) => `${series[i].label} ${lookups[i].get(activeT) != null ? format(lookups[i].get(activeT)!) : 'no data'}`).join(', ')}`
      : ''

  const summary =
    ariaLabel ??
    (hasData
      ? `${variant === 'line' ? 'Line' : variant === 'area' ? 'Area' : 'Stacked area'} chart, ${series.length} series, ${fmtTime(t0)} to ${fmtTime(t1)}. ` +
        series
          .map((s) => {
            const vs = s.points.map((p) => p.v)
            if (!vs.length) return `${s.label}: no data`
            const last = [...s.points].sort((a, b) => a.t - b.t).pop()!
            return `${s.label}: latest ${format(last.v)}, low ${format(Math.min(...vs))}, high ${format(Math.max(...vs))}`
          })
          .join('; ')
      : 'Empty chart')

  const showLegend = legend ?? series.length >= 2
  const table = {
    caption: typeof title === 'string' ? title : 'Time series',
    columns: [
      { key: '__t', label: 'Time' },
      ...visibleIdx.map((i) => ({ key: series[i].id, label: series[i].label, align: 'right' as const })),
      ...(stacks && visibleIdx.length > 1 ? [{ key: '__total', label: 'Total', align: 'right' as const }] : []),
    ],
    rows: ts.map((t, k) => {
      const row: Record<string, ReactNode> = { __t: fmtTime(t) }
      for (const i of visibleIdx) {
        const v = lookups[i].get(t)
        row[series[i].id] = v != null ? format(v) : '—'
      }
      if (stacks) row.__total = format(stacks.totals[k])
      return row
    }),
  }

  const xLabel = (t: number) => {
    const px = x(t)
    const text = xt.format(t)
    const w = approxTextWidth(text, 10.5, true)
    const anchor: 'start' | 'end' | 'middle' = px - w / 2 < -M.left + 2 ? 'start' : px + w / 2 > innerW + right - 2 ? 'end' : 'middle'
    return { px, text, anchor }
  }

  const showPlot = hasData && !(loading && !hasData)

  return (
    <ChartFrame
      title={title}
      description={description}
      surface={surface}
      plotHeight={height}
      table={hasData ? table : undefined}
      hideViewToggle={hideViewToggle}
      readout={readout}
      legend={
        showLegend && hasData ? (
          <ChartLegend
            items={series.map((s, i) => ({ id: s.id, label: s.label, color: colors[i], shape: area ? 'rect' : 'line', hidden: hidden.has(s.id) }))}
            onToggle={(id) =>
              setHidden((h) => {
                const n = new Set(h)
                if (n.has(id)) n.delete(id)
                else n.add(id)
                return n
              })
            }
          />
        ) : undefined
      }
      className={className}
      {...props}
    >
      <div ref={wrapRef} className="relative w-full" style={{ height }}>
        {!showPlot ? (
          <PlotPlaceholder height={height} loading={loading}>
            {empty}
          </PlotPlaceholder>
        ) : width > 0 ? (
          <div
            tabIndex={0}
            role="group"
            aria-roledescription="chart"
            aria-label={`${summary} Use arrow keys to inspect values.`}
            onKeyDown={onKey}
            onFocus={() => {
              setFocused(true)
              setActive((a) => a ?? ts.length - 1)
            }}
            onBlur={() => {
              setFocused(false)
              setActive(null)
            }}
            className={cn('atr-fade h-full w-full rounded-xs focus-visible:outline-offset-4', loading && 'opacity-50 transition-opacity')}
          >
            <svg width={width} height={height} className="block overflow-visible" aria-hidden>
              <g transform={`translate(${M.left},${M.top})`}>
                {/* grid + y ticks */}
                {yt.ticks.map((tk) => (
                  <g key={tk}>
                    <line x1={0} x2={innerW} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? 'var(--line-strong)' : 'var(--line)'} strokeWidth={1} shapeRendering="crispEdges" />
                    <text x={-10} y={y(tk)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[10.5px] tabular">
                      {tickFmt(tk)}
                    </text>
                  </g>
                ))}
                {/* x ticks */}
                {xt.ticks.map((t) => {
                  const l = xLabel(t)
                  return (
                    <text key={t} x={l.px} y={innerH + 18} textAnchor={l.anchor} className="fill-ink-3 font-mono text-[10.5px]">
                      {l.text}
                    </text>
                  )
                })}
                {/* areas */}
                {area &&
                  visibleIdx.map((i) => (
                    <path key={`a${i}`} d={areaPath(i)} fill={colors[i]} fillOpacity={stacks ? 0.16 : 0.1} stroke="none" />
                  ))}
                {/* lines */}
                {visibleIdx.map((i) => (
                  <path key={`l${i}`} d={linePath(i)} fill="none" stroke={colors[i]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {/* end markers + labels */}
                {ends.map((e) => (
                  <g key={`e${e.i}`}>
                    <circle cx={x(e.t)} cy={e.y} r={4} fill={colors[e.i]} stroke={CHART_SURFACE} strokeWidth={2} />
                    {showEnds && (
                      <text x={x(e.t) + 10} y={e.y} dy="0.32em" className="fill-ink-2 text-[11px] font-medium">
                        {e.text}
                      </text>
                    )}
                  </g>
                ))}
                {/* crosshair */}
                {activeT !== undefined && (
                  <g pointerEvents="none">
                    <line x1={x(activeT)} x2={x(activeT)} y1={0} y2={innerH} stroke="var(--ink-4)" strokeWidth={1} shapeRendering="crispEdges" />
                    {activeDots.map((d) => (
                      <circle key={d.i} cx={x(activeT)} cy={d.cy} r={4.5} fill={colors[d.i]} stroke={CHART_SURFACE} strokeWidth={2} />
                    ))}
                  </g>
                )}
                {/* hit layer: the crosshair finds the x — the pointer never has to land on a line */}
                <rect
                  x={-4}
                  y={-M.top}
                  width={innerW + 8}
                  height={innerH + M.top + 6}
                  fill="transparent"
                  onPointerMove={onMove}
                  onPointerDown={onMove}
                  onPointerLeave={() => !focused && setActive(null)}
                />
              </g>
            </svg>
            {activeT !== undefined && tooltipRows.length > 0 && (
              <ChartTooltip
                x={M.left + x(activeT)}
                y={M.top + (activeDots.length ? activeDots.reduce((s, d) => s + d.cy, 0) / activeDots.length : innerH / 2)}
                bounds={{ width, height }}
                title={fmtTime(activeT)}
                rows={tooltipRows}
              />
            )}
          </div>
        ) : null}
      </div>
    </ChartFrame>
  )
}
