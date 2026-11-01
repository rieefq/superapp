import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useShellStore } from '@/app/shell/store'
import {
  comparisonLabel, heatmapCells, percentDelta, rangeLabel, RUN_KINDS, type Insights, type InsightsBucket,
} from '@/core/analytics'
import { useTable } from '@/core/db'
import type { RunKind, RunStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import {
  AgentMark, BarChart, formatCost, formatTokenCount, Heatmap, RUN_KIND_ICON, RunStatusGlyph, SimBadge, TimeSeriesChart, type BarSeries,
  type TimeSeries,
} from '@/ui'
import { Breakdown, type BreakdownItem } from './Breakdown'
import { CardSummary, InsightCard, seriesOf, SWATCH, type CardTable } from './Card'
import { bucketLabel, bucketTitle, deltaPhrase, formatWait, KIND_LABEL } from './logic'
import { filterQuery } from './state'

/**
 * The four Overview figures (§6.10: at most four charts): Runs (by outcome · by kind · by hour),
 * Spend (by day · model · agent), Tokens by run kind, and the approval-wait histogram.
 */

const COUNT = new Intl.NumberFormat('en-US')
const PLOT_H = 220

/** Counts never have fractional ticks: label whole numbers only. */
const countTick = (v: number) => (Number.isInteger(v) ? COUNT.format(v) : '')

type Drill = (extra: Record<string, string | number | null>) => string

function useDrill(params: URLSearchParams): Drill {
  return (extra) => `/insights/history${filterQuery(params, extra)}`
}

const slotParam = (b: Pick<InsightsBucket, 'start' | 'end'>) => `${b.start}-${b.end}`

// ------------------------------------------------------------------------------------------------ runs

type RunsView = 'outcome' | 'kind' | 'hour'

const OUTCOMES: { id: 'done' | 'failed' | 'stopped' | 'active'; label: string; status: RunStatus; filter: string; pick: (b: InsightsBucket) => number }[] = [
  { id: 'done', label: 'Done', status: 'succeeded', filter: 'succeeded', pick: (b) => b.succeeded },
  { id: 'failed', label: 'Failed', status: 'failed', filter: 'failed', pick: (b) => b.failed },
  { id: 'stopped', label: 'Stopped', status: 'cancelled', filter: 'cancelled', pick: (b) => b.cancelled },
  { id: 'active', label: 'In flight', status: 'running', filter: 'active', pick: (b) => b.active },
]

export function RunsCard({ insights, params, now }: { insights: Insights; params: URLSearchParams; now: number }) {
  const [view, setView] = useState<RunsView>('outcome')
  const drill = useDrill(params)
  const { buckets, totals: t, window: win } = insights
  const unit = insights.bucketUnit
  const categories = useMemo(() => buckets.map(bucketLabel), [buckets])

  const outcomeTotals = OUTCOMES.map((o) => ({ ...o, total: buckets.reduce((n, b) => n + o.pick(b), 0) }))
  const outcomes = outcomeTotals.filter((o) => o.total > 0 || o.id === 'done' || o.id === 'failed')
  const outcomeKey = outcomes.map((o) => o.id).join()
  const outcomeSeries: BarSeries[] = useMemo(
    () =>
      OUTCOMES.filter((o) => outcomeKey.split(',').includes(o.id)).map((o) => ({
        id: o.id,
        label: o.label,
        // Nothing ran: no values at all, so the chart shows its empty state instead of a zero axis.
        values: buckets.map((b) => (t.runs ? o.pick(b) : null)),
        ...seriesOf(o.id),
      })),
    [buckets, outcomeKey, t.runs],
  )

  const kindKey = RUN_KINDS.filter((k) => buckets.some((b) => b.byKind[k] > 0)).join()
  const kinds = useMemo(() => (kindKey ? (kindKey.split(',') as RunKind[]) : []), [kindKey])
  // Empty when nothing ran (no series): the chart shows its placeholder. Colors follow the kind, not its rank.
  const kindSeries: TimeSeries[] = useMemo(
    () => kinds.map((k) => ({ id: k, label: KIND_LABEL[k], colorIndex: RUN_KINDS.indexOf(k), points: buckets.map((b) => ({ t: b.start, v: b.byKind[k] })) })),
    [buckets, kinds],
  )
  const timeFormat = useMemo(() => {
    const byStart = new Map(buckets.map((b) => [b.start, b]))
    return (ts: number) => {
      const b = byStart.get(ts)
      return b ? bucketTitle(b, now) : new Date(ts).toLocaleString()
    }
  }, [buckets, now])

  const peak = buckets.reduce<InsightsBucket | null>((m, b) => (b.runs > (m?.runs ?? 0) ? b : m), null)
  const heat = useMemo(() => heatmapCells(insights.heatmap), [insights.heatmap])
  const heatPeak = heat.reduce<{ day: number; hour: number; value: number } | null>((m, c) => (c.value > (m?.value ?? 0) ? c : m), null)
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const summary = (
    <CardSummary figure={`${COUNT.format(t.runs)} ${t.runs === 1 ? 'run' : 'runs'}`}>
      {view === 'hour'
        ? heatPeak
          ? `busiest ${DAYS[heatPeak.day]} ${String(heatPeak.hour).padStart(2, '0')}:00 · ${heatPeak.value} ${heatPeak.value === 1 ? 'run' : 'runs'}`
          : rangeLabel(win.rangeDays)
        : peak
          ? `peak ${peak.runs} · ${bucketTitle(peak, now)}`
          : rangeLabel(win.rangeDays)}
    </CardSummary>
  )

  const slotLink = (b: InsightsBucket) => (
    <Link to={drill({ slot: slotParam(b) })} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
      {bucketTitle(b, now)}
    </Link>
  )
  const table: CardTable =
    view === 'outcome'
      ? {
          caption: `Runs per ${unit} by outcome`,
          columns: [{ key: 'slot', label: unit === 'hour' ? 'Hour' : 'Day' }, ...outcomes.map((o) => ({ key: o.id, label: o.label, align: 'right' as const })), { key: 'total', label: 'Total', align: 'right' }],
          rows: [...buckets].reverse().map((b) => ({ slot: slotLink(b), ...Object.fromEntries(outcomes.map((o) => [o.id, o.pick(b)])), total: b.runs })),
        }
      : view === 'kind'
        ? {
            caption: `Runs per ${unit} by kind`,
            columns: [{ key: 'slot', label: unit === 'hour' ? 'Hour' : 'Day' }, ...kinds.map((k) => ({ key: k, label: KIND_LABEL[k], align: 'right' as const })), { key: 'total', label: 'Total', align: 'right' }],
            rows: [...buckets].reverse().map((b) => ({ slot: slotLink(b), ...Object.fromEntries(kinds.map((k) => [k, b.byKind[k]])), total: b.runs })),
          }
        : {
            caption: 'Runs by weekday and hour',
            columns: [{ key: 'd', label: 'Day' }, ...Array.from({ length: 24 }, (_, h) => ({ key: `h${h}`, label: String(h).padStart(2, '0'), align: 'right' as const }))],
            rows: DAYS.map((d, i) => ({
              d,
              ...Object.fromEntries(
                insights.heatmap[i].map((v, h) => [
                  `h${h}`,
                  v ? (
                    <Link
                      to={drill({ cell: `${i}-${h}` })}
                      aria-label={`${d} ${String(h).padStart(2, '0')}:00, ${v} ${v === 1 ? 'run' : 'runs'}. Show them`}
                      className="rounded-xs text-ink underline decoration-line-input underline-offset-2 hover:decoration-ink"
                    >
                      {v}
                    </Link>
                  ) : (
                    '·'
                  ),
                ]),
              ),
            })),
          }

  return (
    <InsightCard
      label="Runs"
      summary={summary}
      views={[
        { value: 'outcome', label: 'Outcome' },
        { value: 'kind', label: 'Kind' },
        { value: 'hour', label: 'Hour' },
      ]}
      view={view}
      onView={setView}
      table={table}
      bodyHeight={PLOT_H + 28}
    >
      {view === 'outcome' && (
        <div className="flex flex-col gap-3">
          <ul aria-label="Outcomes" className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {outcomeTotals
              .filter((o) => o.total > 0)
              .map((o) => (
                <li key={o.id}>
                  <Link
                    to={drill({ status: o.filter })}
                    aria-label={`${o.label}: ${o.total}. Show these runs`}
                    className="type-caption -mx-0.5 inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
                  >
                    <span aria-hidden className="size-2 rounded-[2px]" style={{ background: SWATCH[o.id] }} />
                    <RunStatusGlyph status={o.status} decorative />
                    {o.label}
                    <span className="type-meta text-ink-3">{o.total}</span>
                  </Link>
                </li>
              ))}
          </ul>
          <BarChart
            categories={categories}
            series={outcomeSeries}
            mode="stacked"
            height={PLOT_H}
            legend={false}
            hideViewToggle
            format={(v) => COUNT.format(v)}
            tickFormat={countTick}
            ariaLabel={`Runs per ${unit} by outcome, ${rangeLabel(win.rangeDays).toLowerCase()}: ${outcomeTotals.map((o) => `${o.total} ${o.label.toLowerCase()}`).join(', ')}.`}
            empty="No runs in this period"
          />
        </div>
      )}
      {view === 'kind' && (
        <TimeSeriesChart
          series={kindSeries}
          variant="stacked-area"
          height={PLOT_H + 28}
          hideViewToggle
          timeFormat={timeFormat}
          format={(v) => COUNT.format(v)}
          tickFormat={countTick}
          empty="No runs in this period"
        />
      )}
      {view === 'hour' && <Heatmap mode="weekday-hour" data={heat} unit="runs" hideViewToggle empty="No runs in this period" />}
    </InsightCard>
  )
}

// ------------------------------------------------------------------------------------------------ spend

type SpendView = 'day' | 'model' | 'agent'

export function SpendCard({ insights, params, now }: { insights: Insights; params: URLSearchParams; now: number }) {
  const [view, setView] = useState<SpendView>('day')
  const drill = useDrill(params)
  const agents = useTable('agents')
  const { buckets, totals: t, previous: p, window: win } = insights
  const unit = insights.bucketUnit
  const estimateOnly = t.liveCostUsd === 0 && t.costUsd > 0
  const categories = useMemo(() => buckets.map(bucketLabel), [buckets])
  const hasLive = buckets.some((b) => b.liveCostUsd > 0)
  const hasSim = buckets.some((b) => b.simulatedCostUsd > 0)
  const daySeries: BarSeries[] = useMemo(
    () => [
      ...(hasLive || !hasSim
        ? [{ id: 'live', label: 'Live', values: buckets.map((b) => (hasLive ? b.liveCostUsd : null)), ...seriesOf('ink') }]
        : []),
      ...(hasSim ? [{ id: 'sim', label: 'Simulated (est.)', values: buckets.map((b) => b.simulatedCostUsd), ...seriesOf('sim') }] : []),
    ],
    [buckets, hasLive, hasSim],
  )

  const models: BreakdownItem[] = insights.byModel.map((m) => ({
    key: m.key,
    name: `${m.label}${m.simulated ? ' (simulated)' : ''}`,
    label: m.label,
    value: m.costUsd,
    valueText: formatCost(m.costUsd, { est: m.simulated }),
    estimate: m.simulated,
    simulated: m.simulated,
    detail: `${COUNT.format(m.runs)} ${m.runs === 1 ? 'run' : 'runs'} · ${formatTokenCount(m.tokens)} tok`,
    to: drill({ model: m.key }),
  }))
  const agentRows: BreakdownItem[] = insights.byAgent
    .filter((a) => a.runs > 0)
    .sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs)
    .map((a) => {
      const agent = agents[a.agentId]
      const simOnly = a.costIsEstimate && a.liveCostUsd === 0
      return {
        key: a.agentId,
        name: a.name,
        label: a.name,
        leading: <AgentMark seed={agent?.sigil ?? 1} hue={a.hue} size={16} />,
        value: a.costUsd,
        valueText: formatCost(a.costUsd, { est: a.costIsEstimate }),
        estimate: a.costIsEstimate,
        simulated: simOnly,
        simulatedValue: a.simulatedCostUsd,
        detail:
          a.costIsEstimate && a.liveCostUsd > 0
            ? `${COUNT.format(a.runs)} runs · ${formatCost(a.liveCostUsd)} live`
            : `${COUNT.format(a.runs)} ${a.runs === 1 ? 'run' : 'runs'}`,
        to: drill({ agent: a.agentId }),
      }
    })

  const delta = deltaPhrase(percentDelta(t.costUsd, p.costUsd), comparisonLabel(win.rangeDays))
  const mixed = t.liveCostUsd > 0 && t.simulatedCostUsd > 0
  const summary = (
    // Live spend and estimates are never added into one figure: live leads, the estimate follows.
    <CardSummary figure={mixed ? `${formatCost(t.liveCostUsd)} live` : formatCost(t.costUsd, { est: estimateOnly })}>
      {mixed ? (
        `+ ${formatCost(t.simulatedCostUsd, { est: true })} simulated · ${rangeLabel(win.rangeDays).toLowerCase()}`
      ) : estimateOnly && view !== 'day' ? (
        <span className="inline-flex items-center gap-1.5">
          <SimBadge size="xs" />
          {delta ?? rangeLabel(win.rangeDays)}
        </span>
      ) : (
        (delta ?? rangeLabel(win.rangeDays))
      )}
    </CardSummary>
  )

  const table: CardTable =
    view === 'day'
      ? {
          caption: `Spend per ${unit}`,
          columns: [
            { key: 'slot', label: unit === 'hour' ? 'Hour' : 'Day' },
            { key: 'live', label: 'Live', align: 'right' },
            { key: 'sim', label: 'Simulated (est.)', align: 'right' },
            { key: 'total', label: 'Total', align: 'right' },
          ],
          rows: [...buckets].reverse().map((b) => ({
            slot: (
              <Link to={drill({ slot: slotParam(b) })} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
                {bucketTitle(b, now)}
              </Link>
            ),
            live: formatCost(b.liveCostUsd),
            sim: formatCost(b.simulatedCostUsd, { est: b.simulatedCostUsd > 0 }),
            total: formatCost(b.costUsd, { est: b.liveCostUsd === 0 && b.costUsd > 0 }),
          })),
        }
      : view === 'model'
        ? {
            caption: 'Spend by model',
            columns: [
              { key: 'model', label: 'Model' },
              { key: 'exec', label: 'Execution' },
              { key: 'runs', label: 'Runs', align: 'right' },
              { key: 'tokens', label: 'Tokens', align: 'right' },
              { key: 'cost', label: 'Cost', align: 'right' },
            ],
            rows: insights.byModel.map((m) => ({
              model: m.label,
              exec: m.simulated ? 'Simulated' : 'Live',
              runs: m.runs,
              tokens: formatTokenCount(m.tokens),
              cost: formatCost(m.costUsd, { est: m.simulated }),
            })),
          }
        : {
            caption: 'Spend by agent',
            columns: [
              { key: 'agent', label: 'Agent' },
              { key: 'runs', label: 'Runs', align: 'right' },
              { key: 'tokens', label: 'Tokens', align: 'right' },
              { key: 'cost', label: 'Cost', align: 'right' },
            ],
            rows: insights.byAgent
              .filter((a) => a.runs > 0)
              .sort((a, b) => b.costUsd - a.costUsd)
              .map((a) => ({ agent: a.name, runs: a.runs, tokens: formatTokenCount(a.tokens), cost: formatCost(a.costUsd, { est: a.costIsEstimate && a.liveCostUsd === 0 }) })),
          }

  return (
    <InsightCard
      label="Spend"
      summary={summary}
      views={[
        { value: 'day', label: unit === 'hour' ? 'Hour' : 'Day' },
        { value: 'model', label: 'Model' },
        { value: 'agent', label: 'Agent' },
      ]}
      view={view}
      onView={setView}
      table={table}
      bodyHeight={PLOT_H + 28}
    >
      {view === 'day' && (
        <div className="flex flex-col gap-3">
          <ul aria-label="Legend" className={cn('type-caption flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-2', t.costUsd === 0 && 'invisible')}>
            {daySeries.map((s) => (
              <li key={s.id} className="inline-flex h-7 items-center gap-1.5">
                {s.id === 'sim' ? (
                  <span aria-hidden className="sim-hatch size-2.5 rounded-[2px] border border-dashed border-line-input" />
                ) : (
                  <span aria-hidden className="size-2 rounded-[2px]" style={{ background: SWATCH.ink }} />
                )}
                {s.label}
                {s.id === 'sim' && <SimBadge size="xs" noTooltip />}
                <span className="type-meta text-ink-3">
                  {s.id === 'sim' ? formatCost(t.simulatedCostUsd, { est: true }) : formatCost(t.liveCostUsd)}
                </span>
              </li>
            ))}
          </ul>
          <BarChart
            categories={categories}
            series={daySeries}
            mode="stacked"
            height={PLOT_H}
            legend={false}
            hideViewToggle
            format={(v) => formatCost(v)}
            ariaLabel={`Spend per ${unit}, ${rangeLabel(win.rangeDays).toLowerCase()}: ${formatCost(t.liveCostUsd)} live, ${formatCost(t.simulatedCostUsd)} estimated for simulated runs.`}
            empty="Nothing spent in this period"
          />
        </div>
      )}
      {view === 'model' && <Breakdown items={models} label="Spend by model" empty="No model usage in this period." />}
      {view === 'agent' && <Breakdown items={agentRows} label="Spend by agent" empty="No agent runs in this period." />}
    </InsightCard>
  )
}

// ------------------------------------------------------------------------------------------------ tokens

export function TokensCard({ insights, params }: { insights: Insights; params: URLSearchParams }) {
  const drill = useDrill(params)
  const { totals: t, window: win } = insights
  const items: BreakdownItem[] = insights.byKind.map((k) => {
    const Icon = RUN_KIND_ICON[k.kind as RunKind]
    const simOnly = k.simulatedRuns === k.runs
    return {
      key: k.kind,
      name: KIND_LABEL[k.kind],
      label: KIND_LABEL[k.kind],
      leading: <Icon aria-hidden className="size-3.5 text-ink-3" strokeWidth={1.75} />,
      value: k.tokens,
      valueText: `${k.simulatedTokens > 0 ? '~' : ''}${formatTokenCount(k.tokens)} tok`,
      simulated: simOnly,
      simulatedValue: k.simulatedTokens,
      detail: `${COUNT.format(k.runs)} ${k.runs === 1 ? 'run' : 'runs'} · ${formatTokenCount(k.inputTokens)} in · ${formatTokenCount(k.outputTokens)} out`,
      to: drill({ kind: k.kind }),
    }
  })
  const simTokens = insights.byKind.reduce((n, k) => n + k.simulatedTokens, 0)
  const allSim = t.tokens > 0 && simTokens === t.tokens
  return (
    <InsightCard
      label="Tokens by run kind"
      summary={
        <CardSummary figure={`${allSim ? '~' : ''}${formatTokenCount(t.tokens)} tok`}>
          {simTokens > 0 ? (
            <span className="inline-flex items-center gap-1.5">
              <SimBadge size="xs" />
              {allSim ? 'all simulated · counts are estimates' : `${formatTokenCount(simTokens)} simulated (est.)`}
            </span>
          ) : (
            rangeLabel(win.rangeDays)
          )}
        </CardSummary>
      }
      table={{
        caption: 'Tokens by run kind',
        columns: [
          { key: 'kind', label: 'Kind' },
          { key: 'runs', label: 'Runs', align: 'right' },
          { key: 'in', label: 'Input', align: 'right' },
          { key: 'out', label: 'Output', align: 'right' },
          { key: 'total', label: 'Total', align: 'right' },
        ],
        rows: insights.byKind.map((k) => ({
          kind: `${KIND_LABEL[k.kind]}${k.simulatedRuns === k.runs ? ' (simulated, est.)' : ''}`,
          runs: k.runs,
          in: formatTokenCount(k.inputTokens),
          out: formatTokenCount(k.outputTokens),
          total: formatTokenCount(k.tokens),
        })),
      }}
    >
      <Breakdown items={items} label="Tokens by run kind" empty="No tokens used in this period." />
    </InsightCard>
  )
}

// ------------------------------------------------------------------------------------------------ approval wait

export function WaitCard({ insights }: { insights: Insights }) {
  const { totals: t } = insights
  const setNeedsYouOpen = useShellStore((s) => s.setNeedsYouOpen)
  const setNeedsYouTab = useShellStore((s) => s.setNeedsYouTab)
  const series: BarSeries[] = useMemo(() => [{ id: 'wait', label: 'Approvals', values: insights.approvalWaits.map((b) => b.count), ...seriesOf('attn') }], [insights.approvalWaits])
  let pendingLine: ReactNode = null
  if (t.approvalsPending > 0) {
    pendingLine = (
      <button
        type="button"
        onClick={() => {
          setNeedsYouTab('needs')
          setNeedsYouOpen(true)
        }}
        className="type-caption -mx-1.5 inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 text-attn-ink transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11"
      >
        <RunStatusGlyph status="waiting" decorative />
        {t.approvalsPending} waiting on you now
        <span className="text-ink-2">· Review</span>
      </button>
    )
  }
  return (
    <InsightCard
      label="Approval wait"
      summary={
        <CardSummary figure={t.medianApprovalWaitMs !== null ? `median ${formatWait(t.medianApprovalWaitMs)}` : 'No decisions yet'}>
          {[t.p90ApprovalWaitMs !== null ? `p90 ${formatWait(t.p90ApprovalWaitMs)}` : null, `${t.approvalsResolved} decided`, `${t.approvalsAsked} asked`]
            .filter(Boolean)
            .join(' · ')}
        </CardSummary>
      }
      table={{
        caption: 'Approvals by how long they waited',
        columns: [
          { key: 'wait', label: 'Waited' },
          { key: 'n', label: 'Approvals', align: 'right' },
        ],
        rows: insights.approvalWaits.map((b) => ({ wait: b.label, n: b.count })),
      }}
      bodyHeight={PLOT_H}
    >
      <div className="flex flex-col gap-2">
        {t.approvalsResolved > 0 ? (
          <BarChart
            categories={insights.approvalWaits.map((b) => b.label)}
            series={series}
            height={PLOT_H - (pendingLine ? 28 : 0)}
            legend={false}
            hideViewToggle
            valueLabels
            format={(v) => COUNT.format(v)}
            tickFormat={countTick}
            ariaLabel={`Approval wait histogram: ${insights.approvalWaits.map((b) => `${b.label} ${b.count}`).join(', ')}.`}
          />
        ) : (
          <p className={cn('type-body-sm grid place-items-center text-center text-ink-3')} style={{ height: PLOT_H - (pendingLine ? 28 : 0) }}>
            No approvals were decided in this period.
          </p>
        )}
        {pendingLine && <div>{pendingLine}</div>}
      </div>
    </InsightCard>
  )
}
