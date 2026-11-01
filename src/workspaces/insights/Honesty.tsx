import { CornerDownRight, Telescope } from 'lucide-react'
import { openStartSheet, openCommandCenter } from '@/app/shell/store'
import type { Insights } from '@/core/analytics'
import { Button, formatCost, formatTokenCount, LiveBadge, SimBadge } from '@/ui'
import { FEW_RUNS } from './logic'

/**
 * Honest labeling for Insights (§6.10, §8.4): simulated runs carry estimates, never spend, and live
 * usage (real API calls) is reported on its own line.
 */
export function HonestyBanner({ insights }: { insights: Insights }) {
  const { totals: t, budget } = insights
  const simulatedInView = t.simulatedRuns > 0 || budget.simulatedSpentUsd > 0
  if (!simulatedInView && t.liveRuns === 0) return null
  const simOnly = t.liveRuns === 0
  return (
    <div role="note" aria-label="About these numbers" className="flex overflow-hidden rounded-md border border-line">
      {simulatedInView && <span aria-hidden className="sim-band shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3.5 py-2.5 md:px-4">
        {simulatedInView && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <SimBadge size="xs" />
            <span className="type-body-sm text-ink">
              {simOnly ? 'Costs shown are estimates; simulated runs spend nothing.' : 'Costs for simulated runs are estimates at Claude Sonnet 5.5 rates.'}
            </span>
            <span className="type-caption text-ink-3">
              {simOnly
                ? `Estimated at Claude Sonnet 5.5 rates · ${t.simulatedRuns} of ${t.runs} runs simulated · No model was called`
                : `${t.simulatedRuns} of ${t.runs} runs simulated · No money was spent on them`}
            </span>
          </p>
        )}
        {t.liveRuns > 0 && (
          <p className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            <LiveBadge size="xs" />
            <span className="type-body-sm text-ink">
              Live usage · {t.liveRuns} {t.liveRuns === 1 ? 'run' : 'runs'} on real models
            </span>
            <span className="type-meta text-ink-3">
              {formatCost(t.liveCostUsd)} · {formatTokenCount(t.liveTokens)} tok · reported separately from estimates
            </span>
          </p>
        )}
      </div>
    </div>
  )
}

/** Fewer than five runs in view: say what will appear here, and offer a way to start (§6.10). */
export function FewRunsNote({ runs }: { runs: number }) {
  if (runs >= FEW_RUNS) return null
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line px-4 py-4 sm:flex-row sm:items-center md:px-5">
      <div className="min-w-0 flex-1">
        <p className="type-body-sm font-medium text-ink">
          {runs === 0 ? 'No runs in this period yet.' : `Only ${runs} ${runs === 1 ? 'run' : 'runs'} in this period.`}
        </p>
        <p className="type-caption mt-0.5 text-ink-3 text-pretty">
          Runs per day, spend by model, reliability by agent and workflow, and approval waits fill in as work runs. Widen the
          range, or start something.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button size="sm" variant="secondary" leadingIcon={Telescope} onClick={() => openStartSheet('research')}>
          Start research…
        </Button>
        <Button size="sm" variant="ghost" leadingIcon={CornerDownRight} kbd="mod+k" onClick={() => openCommandCenter('')}>
          Start anything
        </Button>
      </div>
    </div>
  )
}
