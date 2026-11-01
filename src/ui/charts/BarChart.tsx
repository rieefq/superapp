import { useMemo, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { resolveSeriesColor, type SeriesColorSpec } from './palette'
import { approxTextWidth, axisNumberFormatter, formatValue, linearScale, niceTicks } from './scale'
import { ChartFrame, ChartLegend, ChartTooltip, PlotPlaceholder, useElementSize, type ChartSurface, type TooltipRow } from './frame'

export interface BarSeries extends SeriesColorSpec {
  id: string
  label: string
  /** One value per category (null = no data). */
  values: readonly (number | null)[]
}

export interface BarChartProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  categories: readonly string[]
  series: readonly BarSeries[]
  orientation?: 'vertical' | 'horizontal'
  mode?: 'grouped' | 'stacked'
  /** Plot height (vertical) — horizontal charts size to their rows unless set. */
  height?: number
  title?: ReactNode
  description?: ReactNode
  format?: (v: number) => string
  tickFormat?: (v: number) => string
  /** Print values at bar tips (stack totals when stacked). */
  valueLabels?: boolean
  legend?: boolean
  loading?: boolean
  empty?: ReactNode
  surface?: ChartSurface
  ariaLabel?: string
  hideViewToggle?: boolean
}

const BAR_MAX = 24
const GAP = 2
const R = 4

/** Rect with a rounded data-end (4px) and a square baseline end. */
function barPath(x: number, y: number, w: number, h: number, end: 'top' | 'bottom' | 'right' | 'left', rounded = true): string {
  if (w <= 0 || h <= 0) return ''
  const r = rounded ? Math.min(R, w / 2, h / 2) : 0
  switch (end) {
    case 'top':
      return `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`
    case 'bottom':
      return `M${x},${y}V${y + h - r}a${r},${r} 0 0 0 ${r},${r}H${x + w - r}a${r},${r} 0 0 0 ${r},${-r}V${y}Z`
    case 'right':
      return `M${x},${y}H${x + w - r}a${r},${r} 0 0 1 ${r},${r}V${y + h - r}a${r},${r} 0 0 1 ${-r},${r}H${x}Z`
    case 'left':
      return `M${x + w},${y}H${x + r}a${r},${r} 0 0 0 ${-r},${r}V${y + h - r}a${r},${r} 0 0 0 ${r},${r}H${x + w}Z`
  }
}

interface Mark {
  key: string
  c: number
  s: number
  value: number
  /** Painted bar path. */
  d: string
  /** Hit target (bigger than the mark). */
  hit: { x: number; y: number; w: number; h: number }
  /** Anchor for tooltip (plot coords). */
  ax: number
  ay: number
}

/**
 * Bar chart: vertical or horizontal, grouped or stacked. Thin bars (≤ 24px) with 4px rounded
 * data-ends on one baseline, 2px surface gaps between touching marks, per-mark tooltips with
 * generous hit areas, arrow-key inspection, optional value labels and a table twin.
 */
export function BarChart({
  categories,
  series,
  orientation = 'vertical',
  mode = 'grouped',
  height: heightProp,
  title,
  description,
  format = formatValue,
  tickFormat,
  valueLabels = false,
  legend,
  loading = false,
  empty,
  surface = 'canvas',
  ariaLabel,
  hideViewToggle,
  className,
  ...props
}: BarChartProps) {
  const [wrapRef, { width }] = useElementSize<HTMLDivElement>()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  const [active, setActive] = useState<{ c: number; s: number } | null>(null)
  const [focused, setFocused] = useState(false)
  const horizontal = orientation === 'horizontal'
  const stacked = mode === 'stacked'
  const colors = useMemo(() => series.map((s, i) => resolveSeriesColor(s, i)), [series])
  const vis = series.map((_, i) => i).filter((i) => !hidden.has(series[i].id))
  const nC = categories.length
  const hasData = nC > 0 && series.some((s) => s.values.some((v) => v != null))

  const rowSize = vis.length > 1 && !stacked ? Math.min(BAR_MAX, 14) * vis.length + 18 : 32
  const height = heightProp ?? (horizontal ? Math.max(120, nC * rowSize + 30) : 240)

  // Value domain
  let vMin = 0
  let vMax = 0
  categories.forEach((_, c) => {
    if (stacked) {
      let pos = 0
      for (const s of vis) pos += Math.max(0, series[s].values[c] ?? 0)
      vMax = Math.max(vMax, pos)
    } else {
      for (const s of vis) {
        const v = series[s].values[c]
        if (v == null) continue
        vMax = Math.max(vMax, v)
        vMin = Math.min(vMin, v)
      }
    }
  })
  if (vMax === vMin) vMax = vMin + 1
  const tickCount = horizontal ? Math.max(2, Math.min(6, Math.floor((width || 400) / 110))) : Math.max(2, Math.min(6, Math.round((height - 32) / 46)))
  const vt = niceTicks(vMin, vMax, tickCount)
  const tickFmt = tickFormat ?? axisNumberFormatter(vt.ticks)

  // Margins
  const catLabelW = horizontal ? Math.min(Math.max(...categories.map((c) => approxTextWidth(c, 12))) + 12, Math.max(80, (width || 400) * 0.32)) : 0
  const valueLabelRoom = valueLabels ? 44 : 10
  const M = horizontal
    ? { top: 4, right: valueLabelRoom, bottom: 24, left: catLabelW }
    : { top: valueLabels ? 18 : 10, right: 8, bottom: 26, left: Math.ceil(Math.max(...vt.ticks.map((t) => approxTextWidth(tickFmt(t), 10.5, true)))) + 12 }
  const innerW = Math.max(10, width - M.left - M.right)
  const innerH = Math.max(10, height - M.top - M.bottom)
  const bandLen = (horizontal ? innerH : innerW) / Math.max(1, nC)
  const v = horizontal ? linearScale([vt.min, vt.max], [0, innerW]) : linearScale([vt.min, vt.max], [innerH, 0])
  const base = v(0)

  // Bar geometry
  const groupCount = stacked ? 1 : Math.max(1, vis.length)
  const thick = Math.max(3, Math.min(BAR_MAX, (bandLen * 0.72 - GAP * (groupCount - 1)) / groupCount))
  const groupLen = thick * groupCount + GAP * (groupCount - 1)

  const marks: Mark[] = []
  const totals: number[] = categories.map((_, c) => vis.reduce((s, i) => s + Math.max(0, series[i].values[c] ?? 0), 0))
  categories.forEach((_, c) => {
    const bandStart = c * bandLen
    const groupStart = bandStart + (bandLen - groupLen) / 2
    if (stacked) {
      let acc = 0
      const parts = vis.map((s) => ({ s, val: Math.max(0, series[s].values[c] ?? 0) })).filter((p) => p.val > 0)
      parts.forEach((p, k) => {
        const from = acc
        acc += p.val
        const top = k === parts.length - 1
        const a = v(from)
        const b = v(acc)
        if (horizontal) {
          const x0 = a + (k > 0 ? GAP / 2 : 0)
          const x1 = b - (top ? 0 : GAP / 2)
          const d = barPath(x0, groupStart, Math.max(0, x1 - x0), thick, 'right', top)
          marks.push({ key: `${c}-${p.s}`, c, s: p.s, value: p.val, d, hit: { x: a, y: bandStart, w: Math.max(6, b - a), h: bandLen }, ax: b, ay: groupStart + thick / 2 })
        } else {
          const y1 = a - (k > 0 ? GAP / 2 : 0)
          const y0 = b + (top ? 0 : GAP / 2)
          const d = barPath(groupStart, y0, thick, Math.max(0, y1 - y0), 'top', top)
          marks.push({ key: `${c}-${p.s}`, c, s: p.s, value: p.val, d, hit: { x: bandStart, y: b, w: bandLen, h: Math.max(6, a - b) }, ax: groupStart + thick / 2, ay: b })
        }
      })
    } else {
      vis.forEach((s, k) => {
        const val = series[s].values[c]
        if (val == null) return
        const off = groupStart + k * (thick + GAP)
        const p = v(val)
        const hitStart = bandStart + (k * bandLen) / vis.length
        const hitLen = bandLen / vis.length
        if (horizontal) {
          const x0 = Math.min(base, p)
          const w = Math.abs(p - base)
          const d = barPath(x0, off, w, thick, val >= 0 ? 'right' : 'left')
          marks.push({ key: `${c}-${s}`, c, s, value: val, d, hit: { x: 0, y: hitStart, w: innerW, h: hitLen }, ax: p, ay: off + thick / 2 })
        } else {
          const y0 = Math.min(base, p)
          const h = Math.abs(p - base)
          const d = barPath(off, y0, thick, h, val >= 0 ? 'top' : 'bottom')
          marks.push({ key: `${c}-${s}`, c, s, value: val, d, hit: { x: hitStart, y: 0, w: hitLen, h: innerH }, ax: off + thick / 2, ay: p })
        }
      })
    }
  })

  const activeMark = active ? marks.find((m) => m.c === active.c && m.s === active.s) : undefined

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!marks.length) return
    const cur = activeMark ?? marks[0]
    let c = cur.c
    let sIdx = vis.indexOf(cur.s)
    const prevKey = horizontal ? 'ArrowUp' : 'ArrowLeft'
    const nextKey = horizontal ? 'ArrowDown' : 'ArrowRight'
    const inKeyPrev = horizontal ? 'ArrowLeft' : 'ArrowDown'
    const inKeyNext = horizontal ? 'ArrowRight' : 'ArrowUp'
    if (e.key === nextKey) c = Math.min(nC - 1, c + 1)
    else if (e.key === prevKey) c = Math.max(0, c - 1)
    else if (e.key === inKeyNext) sIdx = Math.min(vis.length - 1, sIdx + 1)
    else if (e.key === inKeyPrev) sIdx = Math.max(0, sIdx - 1)
    else if (e.key === 'Home') c = 0
    else if (e.key === 'End') c = nC - 1
    else if (e.key === 'Escape') return setActive(null)
    else return
    e.preventDefault()
    // land on an existing mark in that category (nearest series)
    const inCat = marks.filter((m) => m.c === c)
    if (!inCat.length) return
    const target = inCat.find((m) => m.s === vis[sIdx]) ?? inCat.reduce((a, b) => (Math.abs(vis.indexOf(b.s) - sIdx) < Math.abs(vis.indexOf(a.s) - sIdx) ? b : a))
    setActive({ c: target.c, s: target.s })
  }

  const tooltipRows: TooltipRow[] = activeMark
    ? [
        ...(vis.length > 1
          ? (stacked ? [...vis].reverse() : vis).map((s) => {
              const val = series[s].values[activeMark.c]
              return {
                key: series[s].id,
                color: colors[s],
                shape: 'rect' as const,
                label: series[s].label,
                value: val != null ? format(val) : '—',
                emphasis: s === activeMark.s,
                muted: s !== activeMark.s,
              }
            })
          : [{ key: 'v', color: colors[activeMark.s], shape: 'rect' as const, label: series[activeMark.s].label, value: format(activeMark.value), emphasis: true }]),
        ...(stacked && vis.length > 1 ? [{ key: '__t', shape: 'none' as const, label: 'Total', value: format(totals[activeMark.c]) }] : []),
      ]
    : []

  const readout = focused && activeMark ? `${categories[activeMark.c]}, ${series[activeMark.s].label}: ${format(activeMark.value)}` : ''
  const summary =
    ariaLabel ??
    (hasData
      ? `${horizontal ? 'Horizontal' : 'Vertical'} ${stacked ? 'stacked' : vis.length > 1 ? 'grouped' : ''} bar chart, ${nC} categories${vis.length > 1 ? `, ${vis.length} series` : ''}. ` +
        categories
          .slice(0, 12)
          .map((cat, c) => `${cat}: ${vis.map((s) => (series[s].values[c] != null ? format(series[s].values[c]!) : 'no data')).join(' / ')}`)
          .join('; ')
      : 'Empty chart')

  const table = {
    caption: typeof title === 'string' ? title : 'Bar chart',
    columns: [
      { key: '__c', label: 'Category' },
      ...vis.map((s) => ({ key: series[s].id, label: series[s].label, align: 'right' as const })),
      ...(stacked && vis.length > 1 ? [{ key: '__total', label: 'Total', align: 'right' as const }] : []),
    ],
    rows: categories.map((cat, c) => {
      const row: Record<string, ReactNode> = { __c: cat }
      for (const s of vis) row[series[s].id] = series[s].values[c] != null ? format(series[s].values[c]!) : '—'
      if (stacked) row.__total = format(totals[c])
      return row
    }),
  }

  // Category label thinning for narrow vertical bands
  const catStep = horizontal ? 1 : Math.max(1, Math.ceil(Math.max(...categories.map((c) => approxTextWidth(c, 11))) / Math.max(1, bandLen - 6)))
  const maxCatChars = horizontal ? Math.floor((catLabelW - 12) / 6.4) : Math.max(3, Math.floor((bandLen * catStep - 6) / 6.2))
  const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)

  const showLegend = legend ?? series.length >= 2
  const anyActive = !!activeMark

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
            items={series.map((s, i) => ({ id: s.id, label: s.label, color: colors[i], shape: 'rect', hidden: hidden.has(s.id) }))}
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
        {!hasData ? (
          <PlotPlaceholder height={height} loading={loading}>
            {empty}
          </PlotPlaceholder>
        ) : width > 0 ? (
          <div
            tabIndex={0}
            role="group"
            aria-roledescription="chart"
            aria-label={`${summary} Use arrow keys to inspect bars.`}
            onKeyDown={onKey}
            onFocus={() => {
              setFocused(true)
              if (!active && marks[0]) setActive({ c: marks[0].c, s: marks[0].s })
            }}
            onBlur={() => {
              setFocused(false)
              setActive(null)
            }}
            className={cn('atr-fade h-full w-full rounded-xs focus-visible:outline-offset-4', loading && 'opacity-50 transition-opacity')}
          >
            <svg width={width} height={height} className="block overflow-visible" aria-hidden>
              <g transform={`translate(${M.left},${M.top})`}>
                {/* value grid */}
                {vt.ticks.map((tk) =>
                  horizontal ? (
                    <g key={tk}>
                      <line x1={v(tk)} x2={v(tk)} y1={0} y2={innerH} stroke={tk === 0 ? 'var(--line-strong)' : 'var(--line)'} shapeRendering="crispEdges" />
                      <text x={v(tk)} y={innerH + 17} textAnchor={tk === vt.min ? 'start' : 'middle'} className="fill-ink-3 font-mono text-[10.5px] tabular">
                        {tickFmt(tk)}
                      </text>
                    </g>
                  ) : (
                    <g key={tk}>
                      <line x1={0} x2={innerW} y1={v(tk)} y2={v(tk)} stroke={tk === 0 ? 'var(--line-strong)' : 'var(--line)'} shapeRendering="crispEdges" />
                      <text x={-10} y={v(tk)} dy="0.32em" textAnchor="end" className="fill-ink-3 font-mono text-[10.5px] tabular">
                        {tickFmt(tk)}
                      </text>
                    </g>
                  ),
                )}
                {/* category labels */}
                {categories.map((cat, c) =>
                  c % catStep !== 0 ? null : horizontal ? (
                    <text key={cat + c} x={-12} y={c * bandLen + bandLen / 2} dy="0.32em" textAnchor="end" className="fill-ink-2 text-[12px]">
                      <title>{cat}</title>
                      {clip(cat, maxCatChars)}
                    </text>
                  ) : (
                    <text key={cat + c} x={c * bandLen + bandLen / 2} y={innerH + 18} textAnchor="middle" className="fill-ink-3 text-[11px]">
                      <title>{cat}</title>
                      {clip(cat, maxCatChars)}
                    </text>
                  ),
                )}
                {/* marks */}
                {marks.map((m) => {
                  const isActive = activeMark?.key === m.key
                  return (
                    <path
                      key={m.key}
                      d={m.d}
                      fill={colors[m.s]}
                      className="transition-opacity duration-(--dur-1)"
                      opacity={anyActive && !isActive ? 0.42 : 1}
                    />
                  )
                })}
                {/* value labels: bar tips (stack totals) */}
                {valueLabels &&
                  (stacked
                    ? categories.map((_, c) => {
                        if (!totals[c]) return null
                        return horizontal ? (
                          <text key={`vl${c}`} x={v(totals[c]) + 6} y={c * bandLen + bandLen / 2} dy="0.32em" className="fill-ink-2 text-[11px] tabular">
                            {format(totals[c])}
                          </text>
                        ) : (
                          <text key={`vl${c}`} x={c * bandLen + bandLen / 2} y={v(totals[c]) - 6} textAnchor="middle" className="fill-ink-2 text-[11px] tabular">
                            {format(totals[c])}
                          </text>
                        )
                      })
                    : marks.map((m) =>
                        horizontal ? (
                          <text key={`vl${m.key}`} x={m.value >= 0 ? m.ax + 6 : m.ax - 6} y={m.ay} dy="0.32em" textAnchor={m.value >= 0 ? 'start' : 'end'} className="fill-ink-2 text-[11px] tabular">
                            {format(m.value)}
                          </text>
                        ) : thick >= 16 || vis.length === 1 ? (
                          <text key={`vl${m.key}`} x={m.ax} y={m.value >= 0 ? m.ay - 6 : m.ay + 14} textAnchor="middle" className="fill-ink-2 text-[11px] tabular">
                            {format(m.value)}
                          </text>
                        ) : null,
                      ))}
                {/* hit targets: bigger than the marks */}
                {marks.map((m) => (
                  <rect
                    key={`h${m.key}`}
                    x={m.hit.x}
                    y={m.hit.y}
                    width={m.hit.w}
                    height={m.hit.h}
                    fill="transparent"
                    onPointerEnter={() => setActive({ c: m.c, s: m.s })}
                    onPointerDown={() => setActive({ c: m.c, s: m.s })}
                    onPointerLeave={() => !focused && setActive(null)}
                  />
                ))}
              </g>
            </svg>
            {activeMark && (
              <ChartTooltip
                x={M.left + activeMark.ax}
                y={M.top + activeMark.ay}
                bounds={{ width, height }}
                title={categories[activeMark.c]}
                rows={tooltipRows}
              />
            )}
          </div>
        ) : null}
      </div>
    </ChartFrame>
  )
}
