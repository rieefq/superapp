import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useShellStore } from '@/app/shell/store'
import { ESTIMATE_TOOLTIP } from '@/app/components'
import {
  absoluteDelta, comparisonLabel, formatRate, percentDelta, pointsDelta, rangeLabel, type Delta, type Insights,
} from '@/core/analytics'
import { cn } from '@/lib/cn'
import { formatCost, formatSeconds, formatTokenCount, RunStatusGlyph, SimBadge, TickMeter, Tooltip } from '@/ui'
import { formatWait, outcomeLine } from './logic'
import { filterQuery } from './state'

/**
 * The four headline tiles (§6.10: Runs · Success rate · Waited on you · Spend) and a ledger row of
 * secondary figures (tokens, median run, tasks completed, spend in range). Every number drills into
 * the runs behind it; spend opens Settings › Budgets.
 */

const COUNT = new Intl.NumberFormat('en-US')

export function KpiPanel({ insights, params }: { insights: Insights; params: URLSearchParams }) {
  const { totals: t, previous: p, budget, window } = insights
  const comparison = comparisonLabel(window.rangeDays)
  const history = (extra: Record<string, string | null> = {}) => `/insights/history${filterQuery(params, extra)}`
  const setNeedsYouOpen = useShellStore((s) => s.setNeedsYouOpen)
  const setNeedsYouTab = useShellStore((s) => s.setNeedsYouTab)

  const spendEstimate = budget.countsSimulated && budget.simulatedSpentUsd > 0
  const rangeSpendEstimate = t.simulatedCostUsd > 0
  const failedOrStopped = t.failed + t.cancelled

  return (
    <section aria-label="Key figures" className="overflow-hidden rounded-md border border-line">
      <div className="grid grid-cols-1 gap-px bg-line min-[480px]:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Runs"
          to={history()}
          ariaLabel={`Runs: ${t.runs}. Show them`}
          figure={COUNT.format(t.runs)}
          delta={percentDelta(t.runs, p.runs)}
          comparison={comparison}
          sub={
            t.active > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <RunStatusGlyph status="running" decorative />
                {t.active} in flight
              </span>
            ) : (
              'Nothing in flight'
            )
          }
        />
        <KpiTile
          label="Success rate"
          to={history(failedOrStopped ? { status: 'failed' } : {})}
          ariaLabel={`Success rate ${formatRate(t.successRate)}. ${failedOrStopped ? 'Show failed runs' : 'Show runs'}`}
          figure={formatRate(t.successRate)}
          delta={pointsDelta(t.successRate, p.successRate)}
          comparison={comparison}
          sub={
            <span className={cn('inline-flex items-center gap-1.5', t.failed > 0 && 'text-fail-ink')}>
              {t.failed > 0 && <RunStatusGlyph status="failed" decorative />}
              {outcomeLine(t)}
            </span>
          }
        />
        <KpiTile
          label="Waited on you"
          onClick={() => {
            setNeedsYouTab('needs')
            setNeedsYouOpen(true)
          }}
          ariaLabel={`Median approval wait ${formatWait(t.medianApprovalWaitMs)}, ${t.approvalsPending} pending. Open Needs you`}
          figure={formatWait(t.medianApprovalWaitMs)}
          figureNote={t.medianApprovalWaitMs !== null ? 'median' : undefined}
          delta={percentDelta(t.medianApprovalWaitMs, p.medianApprovalWaitMs)}
          comparison={comparison}
          sub={
            <span className="inline-flex items-center gap-1.5">
              {t.approvalsPending > 0 && (
                <span className="inline-flex items-center gap-1.5 text-attn-ink">
                  <RunStatusGlyph status="waiting" decorative />
                  {t.approvalsPending} pending
                </span>
              )}
              {t.approvalsPending > 0 && <span aria-hidden>·</span>}
              <span>{t.approvalsResolved} decided</span>
            </span>
          }
        />
        <KpiTile
          label="Spend · this month"
          to="/settings/budgets"
          ariaLabel={`Spend this month ${formatCost(budget.countedUsd, { est: spendEstimate })}${budget.monthlyUsd ? ` of ${formatCost(budget.monthlyUsd)}` : ''}. Open Settings, Budgets`}
          figure={
            spendEstimate ? (
              <Tooltip content={ESTIMATE_TOOLTIP}>
                <span>{formatCost(budget.countedUsd, { est: true })}</span>
              </Tooltip>
            ) : (
              formatCost(budget.countedUsd)
            )
          }
          figureNote={spendEstimate ? undefined : 'live'}
          meter={
            budget.monthlyUsd > 0 ? (
              <span className="flex flex-col gap-1.5">
                <TickMeter
                  value={budget.countedUsd}
                  max={budget.monthlyUsd}
                  label="Monthly budget"
                  valueText={`${formatCost(budget.countedUsd)} of ${formatCost(budget.monthlyUsd)}`}
                />
                <span className={cn('type-meta', budget.countedRatio !== null && budget.countedRatio >= 1 ? 'text-fail-ink' : budget.countedRatio !== null && budget.countedRatio >= 0.8 ? 'text-attn-ink' : 'text-ink-3')}>
                  of {formatCost(budget.monthlyUsd)} budget · {Math.round((budget.countedRatio ?? 0) * 100)}%
                </span>
              </span>
            ) : (
              <span className="type-meta text-ink-3">No monthly budget set</span>
            )
          }
          sub={
            budget.simulatedSpentUsd > 0 && !budget.countsSimulated ? (
              <span className="inline-flex items-center gap-1.5">
                <SimBadge size="xs" noTooltip />
                <Tooltip content={ESTIMATE_TOOLTIP}>
                  <span>{formatCost(budget.simulatedSpentUsd, { est: true })} simulated · not counted</span>
                </Tooltip>
              </span>
            ) : undefined
          }
        />
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-line bg-line lg:grid-cols-4">
        <MiniStat
          label="Tokens"
          value={formatTokenCount(t.tokens)}
          sub={t.tokens ? `${formatTokenCount(t.inputTokens)} in · ${formatTokenCount(t.outputTokens)} out` : rangeLabel(window.rangeDays)}
        />
        <MiniStat
          label="Median run"
          value={t.medianDurationMs !== null ? formatSeconds(t.medianDurationMs) : '—'}
          sub={t.p90DurationMs !== null ? `p90 ${formatSeconds(t.p90DurationMs)}` : 'No finished runs'}
        />
        <MiniStat
          label="Tasks completed"
          value={COUNT.format(t.tasksCompleted)}
          sub={deltaText(absoluteDelta(t.tasksCompleted, p.tasksCompleted, (n) => COUNT.format(n)), comparison)}
        />
        <MiniStat
          label={`Spend · ${window.rangeDays === 1 ? '24h' : `${window.rangeDays}d`}`}
          value={
            rangeSpendEstimate ? (
              <Tooltip content={ESTIMATE_TOOLTIP}>
                <span>{formatCost(t.costUsd, { est: t.liveCostUsd === 0 })}</span>
              </Tooltip>
            ) : (
              formatCost(t.costUsd)
            )
          }
          sub={
            t.liveCostUsd > 0 && t.simulatedCostUsd > 0
              ? `${formatCost(t.liveCostUsd)} live · ${formatCost(t.simulatedCostUsd, { est: true })} sim.`
              : t.liveCostUsd > 0
                ? 'All live'
                : t.costUsd > 0
                  ? 'All simulated'
                  : 'Nothing spent'
          }
        />
      </div>
    </section>
  )
}

function deltaText(delta: Delta | null, comparison: string): string {
  if (!delta || delta.value === 'New') return comparison.replace(/^vs previous/, 'None in the previous')
  return delta.direction === 'flat' ? `No change ${comparison}` : `${delta.label} ${comparison}`
}

function DeltaLine({ delta, comparison }: { delta: Delta | null; comparison: string }) {
  if (!delta || delta.value === 'New') return <span className="type-meta truncate text-ink-3">{comparison.replace(/^vs previous/, 'None in the previous')}</span>
  const Icon = delta.direction === 'up' ? ArrowUpRight : delta.direction === 'down' ? ArrowDownRight : Minus
  const word = delta.direction === 'up' ? 'Up' : delta.direction === 'down' ? 'Down' : 'No change'
  return (
    <span className="type-meta inline-flex min-w-0 items-center gap-1 text-ink-3">
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2} />
      <span className="sr-only">{word}</span>
      <span className="text-ink-2">{delta.direction === 'flat' ? 'No change' : delta.value}</span>
      <span className="truncate">{comparison}</span>
    </span>
  )
}

interface KpiTileProps {
  label: string
  figure: ReactNode
  /** A word after the figure ("median", "live"). */
  figureNote?: string
  delta?: Delta | null
  comparison?: string
  meter?: ReactNode
  sub?: ReactNode
  to?: string
  onClick?: () => void
  ariaLabel: string
}

function KpiTile({ label, figure, figureNote, delta, comparison, meter, sub, to, onClick, ariaLabel }: KpiTileProps) {
  const body = (
    <>
      <span className="type-label text-ink-3">{label}</span>
      <span className="mt-2 flex min-w-0 items-baseline gap-2">
        <span className="type-figure truncate text-ink">{figure}</span>
        {figureNote && <span className="type-meta text-ink-3">{figureNote}</span>}
      </span>
      <span className="mt-1.5 flex min-h-[18px] min-w-0 flex-col gap-1.5">
        {meter ?? (comparison !== undefined && <DeltaLine delta={delta ?? null} comparison={comparison} />)}
      </span>
      {sub && <span className="type-caption mt-auto pt-2 text-ink-3">{sub}</span>}
    </>
  )
  const cls =
    'group flex min-h-[132px] min-w-0 flex-col bg-canvas px-4 py-4 text-left transition-colors duration-(--dur-1) hover:bg-hover focus-visible:-outline-offset-2 md:px-5'
  if (to) {
    return (
      <Link to={to} aria-label={ariaLabel} className={cls}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={cls}>
      {body}
    </button>
  )
}

function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-canvas px-4 py-3 md:px-5">
      <span className="type-label text-ink-3">{label}</span>
      <span className="type-mono font-medium text-ink tabular">{value}</span>
      {sub && <span className="type-meta truncate text-ink-3">{sub}</span>}
    </div>
  )
}
