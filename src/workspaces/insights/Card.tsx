import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { ChartLine, Table2 } from 'lucide-react'
import type { Hue } from '@/core/types'
import { cn } from '@/lib/cn'
import { ChartTable, IconButton, SegmentedControl, type ChartTableColumn, type SegmentOption } from '@/ui'

/**
 * The frame every Insights figure sits in: a `label` kicker, an optional view switch, a
 * "View as table" toggle (every chart has its table twin, §4.5), a one-line summary and the body.
 */

export interface CardTable {
  caption: string
  columns: readonly ChartTableColumn[]
  rows: readonly Record<string, ReactNode>[]
}

export interface InsightCardProps<V extends string> {
  label: string
  /** One line under the kicker: the headline number of the figure. */
  summary?: ReactNode
  views?: readonly SegmentOption<V>[]
  view?: V
  onView?: (view: V) => void
  /** The table twin of what is shown. */
  table?: CardTable
  /** Keeps the card height steady when switching to the table. */
  bodyHeight?: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}

export function InsightCard<V extends string>({ label, summary, views, view, onView, table, bodyHeight, className, style, children }: InsightCardProps<V>) {
  const id = useId()
  const [asTable, setAsTable] = useState(false)
  return (
    <section aria-labelledby={id} className={cn('flex min-w-0 flex-col rounded-md border border-line p-4 md:p-5', className)} style={style}>
      <header className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={id} className="type-label mr-auto text-ink-3">
          {label}
        </h2>
        {views && views.length > 1 && (
          <SegmentedControl size="sm" aria-label={`${label}: view`} value={view} onValueChange={onView} options={views} />
        )}
        {table && (
          <IconButton
            icon={asTable ? ChartLine : Table2}
            label={asTable ? 'Show chart' : 'View as table'}
            size="sm"
            active={asTable}
            onClick={() => setAsTable((v) => !v)}
          />
        )}
      </header>
      {summary && <div className="mt-1.5 min-w-0">{summary}</div>}
      <div className="mt-4 min-w-0">
        {asTable && table ? (
          table.rows.length ? (
            <ChartTable caption={table.caption} columns={table.columns} rows={table.rows} style={{ maxHeight: bodyHeight ? Math.max(bodyHeight, 160) : 320 }} />
          ) : (
            <p className="type-body-sm py-6 text-center text-ink-3">Nothing to list for this period.</p>
          )
        ) : (
          children
        )}
      </div>
    </section>
  )
}

/** Headline line of a card: a mono figure, then quieter context. */
export function CardSummary({ figure, children }: { figure: ReactNode; children?: ReactNode }) {
  return (
    <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="type-mono font-medium text-ink tabular">{figure}</span>
      {children && <span className="type-meta min-w-0 text-ink-3">{children}</span>}
    </p>
  )
}

/*
 * The chart kit colors series by identity hue only (`var(--series-<hue>)`). State-colored series
 * (outcomes, the approval-wait histogram, single-series ink) use custom `--series-*` properties set
 * on the card, addressed through the same lookup.
 */
export const SERIES_VARS = {
  '--series-insights-done': 'var(--ink-3)',
  '--series-insights-failed': 'var(--fail)',
  '--series-insights-stopped': 'var(--ink-4)',
  '--series-insights-active': 'var(--live)',
  '--series-insights-ink': 'var(--ink-2)',
  '--series-insights-attn': 'var(--attn)',
  '--series-insights-sim': 'url(#insights-sim-hatch)',
} as CSSProperties

export type InsightsSeries = 'done' | 'failed' | 'stopped' | 'active' | 'ink' | 'attn' | 'sim'

/** A series color spec for the chart kit pointing at one of `SERIES_VARS`. */
export function seriesOf(name: InsightsSeries): { hue: Hue } {
  return { hue: `insights-${name}` as unknown as Hue }
}

/** Swatch color for a custom legend (the hatch is drawn with the class instead). */
export const SWATCH: Record<Exclude<InsightsSeries, 'sim'>, string> = {
  done: 'var(--ink-3)',
  failed: 'var(--fail)',
  stopped: 'var(--ink-4)',
  active: 'var(--live)',
  ink: 'var(--ink-2)',
  attn: 'var(--attn)',
}

/** The hatch pattern simulated chart marks are filled with (mounted once per page). */
export function SimHatchDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <pattern id="insights-sim-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--sim-tint)" />
          <rect width="1.25" height="6" fill="var(--sim-hatch)" />
        </pattern>
      </defs>
    </svg>
  )
}
