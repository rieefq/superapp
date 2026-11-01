/**
 * Chart chrome shared by every chart: the figure frame (title, legend, chart/table view
 * toggle, surface), the legend, the accessible table twin, the tooltip and a size hook.
 */
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'
import { ChartLine, Table2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Segmented, SkeletonBar } from '../display/internal'

/* ------------------------------------------------------------------------------------------ */
/* Size                                                                                       */
/* ------------------------------------------------------------------------------------------ */

/** Observe an element's content-box width (and height). Starts at 0 until measured. */
export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (Math.abs(s.width - r.width) < 0.5 && Math.abs(s.height - r.height) < 0.5 ? s : { width: r.width, height: r.height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

/* ------------------------------------------------------------------------------------------ */
/* Legend                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export interface LegendItem {
  id: string
  label: string
  color: string
  /** Mirror the mark: line for lines, rect for bars/areas, dot for points. */
  shape?: 'line' | 'rect' | 'dot'
  /** Optional trailing value (text ink, never the series color). */
  value?: ReactNode
  hidden?: boolean
}

export interface ChartLegendProps extends Omit<HTMLAttributes<HTMLElement>, 'onToggle'> {
  items: readonly LegendItem[]
  /** Makes items buttons that show/hide a series (color stays with the entity). */
  onToggle?: (id: string) => void
  direction?: 'row' | 'column'
}

export function LegendSwatch({ color, shape = 'rect', muted }: { color: string; shape?: LegendItem['shape']; muted?: boolean }) {
  const style: CSSProperties = { background: color, opacity: muted ? 0.35 : 1 }
  if (shape === 'line') return <span aria-hidden className="h-0.5 w-3 shrink-0 rounded-full" style={style} />
  if (shape === 'dot') return <span aria-hidden className="size-2 shrink-0 rounded-full" style={style} />
  return <span aria-hidden className="size-2 shrink-0 rounded-[2px]" style={style} />
}

/** Series legend. Text stays in ink tokens; identity rides on the swatch beside it. */
export function ChartLegend({ items, onToggle, direction = 'row', className, ...props }: ChartLegendProps) {
  const visibleCount = items.filter((i) => !i.hidden).length
  return (
    <ul
      aria-label="Legend"
      className={cn(
        'flex text-xs text-ink-2',
        direction === 'row' ? 'flex-wrap items-center gap-x-4 gap-y-1' : 'flex-col gap-1.5',
        className,
      )}
      {...props}
    >
      {items.map((it) => {
        const content = (
          <>
            <LegendSwatch color={it.color} shape={it.shape} muted={it.hidden} />
            <span className={cn('min-w-0 truncate', it.hidden && 'text-ink-4 line-through decoration-ink-4')}>{it.label}</span>
            {it.value != null && <span className="ml-auto pl-3 text-ink tabular">{it.value}</span>}
          </>
        )
        return (
          <li key={it.id} className={cn('flex min-w-0 items-center', direction === 'column' && 'w-full')}>
            {onToggle ? (
              <button
                type="button"
                aria-pressed={!it.hidden}
                disabled={!it.hidden && visibleCount === 1}
                title={it.hidden ? `Show ${it.label}` : `Hide ${it.label}`}
                onClick={() => onToggle(it.id)}
                className="-mx-1 inline-flex h-6 min-w-0 items-center gap-1.5 rounded-xs px-1 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink disabled:cursor-default disabled:hover:bg-transparent pointer-coarse:h-10"
              >
                {content}
              </button>
            ) : (
              <span className="inline-flex h-5 w-full min-w-0 items-center gap-1.5">{content}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Table twin                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export interface ChartTableColumn {
  key: string
  label: ReactNode
  align?: 'left' | 'right'
}

export interface ChartTableProps extends HTMLAttributes<HTMLDivElement> {
  caption: string
  columns: readonly ChartTableColumn[]
  rows: readonly Record<string, ReactNode>[]
  maxHeight?: number
}

/** Accessible table equivalent of a chart (every value, no hover needed). */
export function ChartTable({ caption, columns, rows, maxHeight, className, ...props }: ChartTableProps) {
  return (
    <div
      className={cn('overflow-auto', className)}
      style={maxHeight ? { maxHeight } : undefined}
      tabIndex={0}
      role="region"
      aria-label={`${caption} (table)`}
      {...props}
    >
      <table className="w-full border-separate border-spacing-0 text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'sticky top-0 border-b border-line-strong bg-[var(--chart-surface,var(--surface-canvas))] px-2 py-1.5 font-mono text-2xs font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase first:pl-0 last:pr-0',
                  c.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c, ci) => (
                <td
                  key={c.key}
                  className={cn(
                    'border-b border-line px-2 py-1.5 whitespace-nowrap first:pl-0 last:pr-0',
                    c.align === 'right' ? 'text-right tabular text-ink' : 'text-left text-ink-2',
                    ci === 0 && 'text-ink-2',
                  )}
                >
                  {r[c.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Tooltip                                                                                    */
/* ------------------------------------------------------------------------------------------ */

export interface TooltipRow {
  key: string
  color?: string
  /** Line key for lines/areas, rect for bars, none for totals. */
  shape?: 'line' | 'rect' | 'none'
  label: ReactNode
  value: ReactNode
  emphasis?: boolean
  muted?: boolean
}

/** Pointer-following readout. Values lead (strong ink); labels follow (secondary). */
export function ChartTooltip({
  x,
  y,
  bounds,
  title,
  rows,
  offset = 14,
}: {
  x: number
  y: number
  bounds: { width: number; height: number }
  title?: ReactNode
  rows: readonly TooltipRow[]
  offset?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 160, h: 60 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
  })
  let left = x + offset
  if (left + size.w > bounds.width) left = x - offset - size.w
  if (left < 0) left = Math.max(0, Math.min(bounds.width - size.w, x - size.w / 2))
  let top = y - size.h / 2
  top = Math.max(-4, Math.min(bounds.height - size.h + 4, top))
  return (
    <div
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute z-10 min-w-32 rounded-sm border border-line bg-overlay px-2.5 py-2 text-xs shadow-e1 transition-[left,top] duration-75 ease-out"
      style={{ left, top }}
    >
      {title != null && <div className="mb-1.5 font-mono text-2xs tracking-[0.02em] whitespace-nowrap text-ink-3">{title}</div>}
      <div className="flex flex-col gap-1">
        {rows.map((r) => (
          <div key={r.key} className={cn('flex items-center gap-2 whitespace-nowrap', r.muted && 'opacity-55')}>
            {r.shape !== 'none' && r.color && (
              <span
                aria-hidden
                className={cn('shrink-0', r.shape === 'rect' ? 'size-2 rounded-[2px]' : 'h-0.5 w-2.5 rounded-full')}
                style={{ background: r.color }}
              />
            )}
            {r.shape === 'none' && <span aria-hidden className="w-2.5 shrink-0" />}
            <span className={cn('text-ink tabular', r.emphasis ? 'font-semibold' : 'font-medium')}>{r.value}</span>
            <span className="text-ink-3">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Frame                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const SURFACE_VAR = {
  canvas: 'var(--surface-canvas)',
  raised: 'var(--surface-raised)',
  sunken: 'var(--surface-sunken)',
  overlay: 'var(--surface-overlay)',
} as const

export type ChartSurface = keyof typeof SURFACE_VAR

export interface ChartFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode
  description?: ReactNode
  legend?: ReactNode
  /** Extra header controls (left of the view toggle). */
  actions?: ReactNode
  /** Table twin (always available via the toggle). */
  table?: { caption: string; columns: readonly ChartTableColumn[]; rows: readonly Record<string, ReactNode>[] }
  /** Surface the chart sits on — rings and ramps mix with it. */
  surface?: ChartSurface
  /** Height of the plot area (the table view uses the same box, so nothing jumps). */
  plotHeight: number
  hideViewToggle?: boolean
  /** Live readout for keyboard users (announced politely). */
  readout?: string
  children: ReactNode
}

/** Figure shell: header (title, description, view toggle), legend, plot or table. */
export function ChartFrame({
  title,
  description,
  legend,
  actions,
  table,
  surface = 'canvas',
  plotHeight,
  hideViewToggle,
  readout,
  className,
  style,
  children,
  ...props
}: ChartFrameProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const titleId = useId()
  const showToggle = !!table && !hideViewToggle
  const hasHeader = title != null || description != null || showToggle || actions != null
  return (
    <figure
      aria-labelledby={title != null ? titleId : undefined}
      className={cn('m-0 flex min-w-0 flex-col gap-3', className)}
      style={{ ...style, ['--chart-surface' as string]: SURFACE_VAR[surface] }}
      {...props}
    >
      {hasHeader && (
        <figcaption className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title != null && (
              <div id={titleId} className="text-sm font-medium text-ink">
                {title}
              </div>
            )}
            {description != null && <div className="mt-0.5 text-xs text-ink-3 text-pretty">{description}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {actions}
            {showToggle && (
              <Segmented
                label="View"
                iconOnly
                value={view}
                onChange={setView}
                options={[
                  { value: 'chart', label: 'Show chart', icon: <ChartLine /> },
                  { value: 'table', label: 'Show as table', icon: <Table2 /> },
                ]}
              />
            )}
          </div>
        </figcaption>
      )}
      {legend}
      {view === 'table' && table ? (
        <ChartTable caption={table.caption} columns={table.columns} rows={table.rows} style={{ height: plotHeight }} />
      ) : (
        children
      )}
      <span className="sr-only" aria-live="polite">
        {readout}
      </span>
    </figure>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* States                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Calm placeholder grid with a message (empty / loading), sized like the plot. */
export function PlotPlaceholder({ height, children, loading }: { height: number; children?: ReactNode; loading?: boolean }) {
  return (
    <div className="relative w-full" style={{ height }} aria-busy={loading || undefined}>
      <div aria-hidden className="absolute inset-0 flex flex-col justify-between py-2">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="h-px w-full bg-line" />
        ))}
      </div>
      {loading ? (
        <div className="absolute inset-x-0 bottom-2 flex h-2/3 items-end justify-around px-[2%]">
          {[38, 62, 48, 80, 56, 72, 44, 66, 52].map((h, i) => (
            <SkeletonBar key={i} className="w-3 rounded-t-[4px] rounded-b-none sm:w-5" style={{ height: `${h}%`, animationDelay: `${i * 90}ms` }} />
          ))}
          <span className="sr-only">Loading chart</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-sm bg-[var(--chart-surface,var(--surface-canvas))] px-3 py-1 text-sm text-ink-3">{children ?? 'No data for this period'}</span>
        </div>
      )}
    </div>
  )
}

