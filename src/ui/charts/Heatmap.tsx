import { useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { RAMP_EMPTY, rampColor } from './palette'
import { formatValue } from './scale'
import { ChartFrame, ChartTooltip, PlotPlaceholder, useElementSize, type ChartSurface } from './frame'

export interface WeekdayHourCell {
  /** 0 = Monday … 6 = Sunday. */
  day: number
  /** 0–23. */
  hour: number
  value: number
}

export interface CalendarCell {
  /** Epoch ms (any time within the day). */
  date: number
  value: number
}

interface HeatmapBase extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  format?: (v: number) => string
  /** Unit noun for tooltips ("runs"). */
  unit?: string
  /** Number of ramp steps (default 5). */
  steps?: number
  loading?: boolean
  empty?: ReactNode
  surface?: ChartSurface
  ariaLabel?: string
  hideViewToggle?: boolean
}

export type HeatmapProps =
  | (HeatmapBase & { mode: 'weekday-hour'; data: readonly WeekdayHourCell[] })
  | (HeatmapBase & { mode: 'calendar'; data: readonly CalendarCell[]; /** Last day shown (default: latest date in data). */ end?: number; /** Weeks shown (default 26). */ weeks?: number })

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const GAP = 2

interface Cell {
  row: number
  col: number
  value: number | null
  label: string
}

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Magnitude grid on a one-hue sequential ramp (accent mixed into the surface: more = more
 * contrast in both themes). Weekday × hour or calendar weeks; per-cell tooltip, arrow keys,
 * a Less → More scale legend and a table twin.
 */
export function Heatmap(props: HeatmapProps) {
  const { title, description, format = formatValue, unit, steps = 5, loading = false, empty, surface = 'canvas', ariaLabel, hideViewToggle, className, mode, data, ...rest } = props
  const { end: endProp, weeks: weeksProp, ...domProps } = rest as { end?: number; weeks?: number } & Record<string, unknown>
  const [wrapRef, { width }] = useElementSize<HTMLDivElement>()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<{ row: number; col: number } | null>(null)
  const [focused, setFocused] = useState(false)

  const grid = useMemo(() => {
    const cells: Cell[] = []
    let rows = 7
    let cols = 24
    let colLabels: { col: number; text: string }[] = []
    if (mode === 'weekday-hour') {
      const map = new Map<string, number>()
      for (const c of data as readonly WeekdayHourCell[]) map.set(`${c.day}:${c.hour}`, (map.get(`${c.day}:${c.hour}`) ?? 0) + c.value)
      for (let d = 0; d < 7; d++)
        for (let h = 0; h < 24; h++) {
          const v = map.get(`${d}:${h}`)
          cells.push({ row: d, col: h, value: v ?? null, label: `${DAYS[d]} ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00` })
        }
      colLabels = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ col: h, text: String(h).padStart(2, '0') }))
    } else {
      const list = data as readonly CalendarCell[]
      const byDay = new Map<number, number>()
      for (const c of list) {
        const k = startOfDay(c.date)
        byDay.set(k, (byDay.get(k) ?? 0) + c.value)
      }
      const latest = endProp ?? (list.length ? Math.max(...list.map((c) => c.date)) : Date.now())
      const endDay = startOfDay(latest)
      const weeks = weeksProp ?? 26
      const endDow = (new Date(endDay).getDay() + 6) % 7
      const firstMonday = new Date(endDay)
      firstMonday.setDate(firstMonday.getDate() - endDow - (weeks - 1) * 7)
      const start = firstMonday.getTime()
      rows = 7
      cols = weeks
      const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'short' })
      let lastMonth = -1
      for (let w = 0; w < weeks; w++) {
        for (let d = 0; d < 7; d++) {
          const dt = new Date(start)
          dt.setDate(dt.getDate() + w * 7 + d)
          const t = dt.getTime()
          if (t > endDay) continue
          cells.push({ row: d, col: w, value: byDay.get(startOfDay(t)) ?? null, label: fmt.format(t) })
          if (d === 0 && dt.getMonth() !== lastMonth) {
            if (lastMonth !== -1 || dt.getDate() <= 7) colLabels.push({ col: w, text: fmtMonth.format(t) })
            lastMonth = dt.getMonth()
          }
        }
      }
    }
    const max = cells.reduce((m, c) => Math.max(m, c.value ?? 0), 0)
    return { cells, rows, cols, colLabels, max }
  }, [mode, data, endProp, weeksProp])

  const hasData = grid.max > 0
  const level = (v: number | null) => (v == null || v <= 0 || grid.max <= 0 ? 0 : Math.max(1, Math.ceil((v / grid.max) * steps)))
  const colorFor = (v: number | null) => {
    const l = level(v)
    return l === 0 ? RAMP_EMPTY : rampColor((l - 1) / Math.max(1, steps - 1))
  }

  // Layout
  const labelW = 34
  const topH = 18
  const avail = Math.max(0, width - labelW)
  const fit = Math.floor((avail - GAP * (grid.cols - 1)) / grid.cols)
  const cell = Math.max(10, Math.min(mode === 'calendar' ? 16 : 26, fit))
  const plotW = labelW + grid.cols * cell + (grid.cols - 1) * GAP
  const plotH = topH + grid.rows * cell + (grid.rows - 1) * GAP
  const overflow = plotW > width + 0.5

  // Calendars open on the latest weeks.
  useLayoutEffect(() => {
    if (overflow && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
  }, [overflow, width])

  const cellAt = (row: number, col: number) => grid.cells.find((c) => c.row === row && c.col === col)
  const cur = active ? cellAt(active.row, active.col) : undefined

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const a = active ?? { row: 0, col: grid.cols - 1 }
    let { row, col } = a
    if (e.key === 'ArrowRight') col++
    else if (e.key === 'ArrowLeft') col--
    else if (e.key === 'ArrowDown') row++
    else if (e.key === 'ArrowUp') row--
    else if (e.key === 'Home') col = 0
    else if (e.key === 'End') col = grid.cols - 1
    else if (e.key === 'Escape') return setActive(null)
    else return
    e.preventDefault()
    row = Math.max(0, Math.min(grid.rows - 1, row))
    col = Math.max(0, Math.min(grid.cols - 1, col))
    if (cellAt(row, col)) setActive({ row, col })
  }

  const valueText = (v: number | null) => (v == null ? 'No data' : `${format(v)}${unit ? ` ${unit}` : ''}`)
  const total = grid.cells.reduce((s, c) => s + (c.value ?? 0), 0)
  const peak = grid.cells.reduce<Cell | null>((m, c) => ((c.value ?? 0) > (m?.value ?? -1) ? c : m), null)
  const summary =
    ariaLabel ??
    (hasData
      ? `Heatmap of ${mode === 'calendar' ? 'daily' : 'hourly'} activity. Total ${format(total)}${unit ? ` ${unit}` : ''}; peak ${peak ? `${peak.label}, ${valueText(peak.value)}` : 'none'}.`
      : 'Empty heatmap')

  const table =
    mode === 'weekday-hour'
      ? {
          caption: typeof title === 'string' ? title : 'Heatmap',
          columns: [{ key: 'd', label: 'Day' }, ...Array.from({ length: 24 }, (_, h) => ({ key: `h${h}`, label: String(h).padStart(2, '0'), align: 'right' as const }))],
          rows: DAYS.map((d, r) => {
            const row: Record<string, ReactNode> = { d }
            for (let h = 0; h < 24; h++) row[`h${h}`] = cellAt(r, h)?.value != null ? format(cellAt(r, h)!.value!) : '—'
            return row
          }),
        }
      : {
          caption: typeof title === 'string' ? title : 'Heatmap',
          columns: [
            { key: 'date', label: 'Date' },
            { key: 'v', label: unit ?? 'Value', align: 'right' as const },
          ],
          rows: [...grid.cells].sort((a, b) => b.col - a.col || b.row - a.row).map((c) => ({ date: c.label, v: c.value != null ? format(c.value) : '—' })),
        }

  const legendSteps = Array.from({ length: steps }, (_, i) => rampColor(i / Math.max(1, steps - 1)))

  return (
    <ChartFrame
      title={title}
      description={description}
      surface={surface}
      plotHeight={plotH + 30}
      table={hasData ? table : undefined}
      hideViewToggle={hideViewToggle}
      readout={focused && cur ? `${cur.label}: ${valueText(cur.value)}` : ''}
      className={className}
      {...(domProps as HTMLAttributes<HTMLElement>)}
    >
      <div ref={wrapRef} className="relative w-full">
        {!hasData ? (
          <PlotPlaceholder height={plotH + 30} loading={loading}>
            {empty}
          </PlotPlaceholder>
        ) : width > 0 ? (
          <>
            <div ref={scrollRef} className={cn('relative', overflow && 'overflow-x-auto pb-1')}>
              <div
                tabIndex={0}
                role="group"
                aria-roledescription="chart"
                aria-label={`${summary} Use arrow keys to inspect cells.`}
                onKeyDown={onKey}
                onFocus={() => {
                  setFocused(true)
                  setActive((a) => a ?? (mode === 'calendar' ? { row: (grid.cells[grid.cells.length - 1]?.row ?? 0), col: grid.cols - 1 } : { row: 0, col: 9 }))
                }}
                onBlur={() => {
                  setFocused(false)
                  setActive(null)
                }}
                className={cn('atr-fade relative rounded-xs focus-visible:outline-offset-4', loading && 'opacity-50')}
                style={{ width: plotW, height: plotH }}
              >
                <svg width={plotW} height={plotH} aria-hidden className="block">
                  {DAYS.map((d, r) =>
                    mode === 'calendar' && r % 2 === 1 ? null : (
                      <text key={d} x={0} y={topH + r * (cell + GAP) + cell / 2} dy="0.32em" className="fill-ink-3 font-mono text-[10px]">
                        {d}
                      </text>
                    ),
                  )}
                  {grid.colLabels.map((l) => (
                    <text key={l.col} x={labelW + l.col * (cell + GAP)} y={11} className="fill-ink-3 font-mono text-[10px]">
                      {l.text}
                    </text>
                  ))}
                  {grid.cells.map((c) => {
                    const isActive = active?.row === c.row && active?.col === c.col
                    return (
                      <rect
                        key={`${c.row}:${c.col}`}
                        x={labelW + c.col * (cell + GAP)}
                        y={topH + c.row * (cell + GAP)}
                        width={cell}
                        height={cell}
                        rx={2}
                        fill={colorFor(c.value)}
                        stroke={isActive ? 'var(--ink)' : 'none'}
                        strokeWidth={isActive ? 1.5 : 0}
                        onPointerEnter={() => setActive({ row: c.row, col: c.col })}
                        onPointerDown={() => setActive({ row: c.row, col: c.col })}
                        onPointerLeave={() => !focused && setActive(null)}
                      />
                    )
                  })}
                </svg>
                {cur && (
                  <ChartTooltip
                    x={labelW + cur.col * (cell + GAP) + cell / 2}
                    y={topH + cur.row * (cell + GAP) + cell / 2}
                    bounds={{ width: Math.max(plotW, width), height: plotH }}
                    title={cur.label}
                    rows={[{ key: 'v', shape: 'rect', color: colorFor(cur.value), label: unit ?? '', value: cur.value != null ? format(cur.value) : 'No data' }]}
                  />
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-2xs text-ink-3" aria-hidden>
              <span>Less</span>
              <span className="flex gap-0.5">
                <span className="size-2.5 rounded-[2px]" style={{ background: RAMP_EMPTY }} />
                {legendSteps.map((c, i) => (
                  <span key={i} className="size-2.5 rounded-[2px]" style={{ background: c }} />
                ))}
              </span>
              <span>More</span>
              <span className="ml-auto font-mono tabular">
                0 – {format(grid.max)}
                {unit ? ` ${unit}` : ''}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </ChartFrame>
  )
}
