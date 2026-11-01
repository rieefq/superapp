import { useCallback } from 'react'
import { budgetState, formatCost } from '@/app/components'
import { useMinuteNow } from '@/core/analytics'
import { useDB, type Tables } from '@/core/db'
import { useSettings } from '@/core/settings'
import { Input, Switch, TickMeter, Tooltip } from '@/ui'
import { cn } from '@/lib/cn'
import { budgetInputText, formatBudget, parseBudget } from '../logic'
import { Group, InlineLink, Row, SectionBody, SettingRow, useDraft, useMarkSaved, useSaveSetting } from '../parts'
import { getSection } from '../sections'

const ESTIMATE = 'Estimated at reference pricing; no money was spent.'

/** Month-to-date live and simulated spend, re-rendering only when a figure changes at cent level. */
function useMonthSpend(): { live: number; sim: number } {
  const now = useMinuteNow()
  const key = useDB((s: Tables) => {
    const t = Date.now()
    const live = budgetState(s, { monthlyBudgetUsd: 0, countSimulatedSpend: false }, t).spentUsd
    const all = budgetState(s, { monthlyBudgetUsd: 0, countSimulatedSpend: true }, t).spentUsd
    return `${live.toFixed(4)}|${Math.max(0, all - live).toFixed(4)}|${now}`
  })
  const [live, sim] = key.split('|').map(Number)
  return { live, sim }
}

/** Budgets (§6.12): monthly budget with this month's spend against it, and whether estimates count. */
export default function BudgetsSection() {
  const safety = useSettings((s) => s.safety)
  const save = useSaveSetting()
  const mark = useMarkSaved()
  const { live, sim } = useMonthSpend()

  const commit = useCallback((monthlyBudgetUsd: number) => save('monthly-budget', 'Monthly budget', 'safety', { monthlyBudgetUsd }), [save])
  const draft = useDraft({
    stored: budgetInputText(safety.monthlyBudgetUsd),
    check: parseBudget,
    commit,
    onSettled: () => mark('monthly-budget', 'Monthly budget'),
  })

  const counted = live + (safety.countSimulatedSpend ? sim : 0)
  const budget = safety.monthlyBudgetUsd
  const ratio = budget > 0 ? counted / budget : 0
  const pct = Math.round(ratio * 100)
  const month = new Date().toLocaleDateString(undefined, { month: 'long' })
  const level = budget > 0 ? (ratio >= 1 ? 'fail' : ratio >= 0.8 ? 'attn' : 'normal') : 'normal'

  return (
    <SectionBody lead={getSection('budgets')!.lead}>
      <Group label={`${month} so far`} id="month" aside={<InlineLink to="/insights">Spend by model in Insights</InlineLink>}>
        <Row className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <div className="flex items-baseline gap-2">
              <span className={cn('type-figure', level === 'fail' ? 'text-fail-ink' : level === 'attn' ? 'text-attn-ink' : 'text-ink')}>
                {safety.countSimulatedSpend && sim > 0 ? 'est. ' : ''}
                {formatCost(counted)}
              </span>
              <span className="type-meta text-ink-3">{budget > 0 ? `of ${formatBudget(budget)} · ${pct}%` : 'no budget set'}</span>
            </div>
            <span className="type-meta text-ink-3">{budget > 0 ? `${formatCost(Math.max(0, budget - counted))} left` : ''}</span>
          </div>
          {budget > 0 && (
            <TickMeter value={counted} max={budget} label="Monthly budget used" valueText={`${formatCost(counted)} of ${formatBudget(budget)}`} />
          )}
          <p className="type-meta flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
            <span>Live {formatCost(live)}</span>
            <span aria-hidden>·</span>
            <Tooltip content={ESTIMATE}>
              <span tabIndex={0} className="rounded-xs underline decoration-dotted decoration-line-input underline-offset-2">
                est. {formatCost(sim)} simulated
              </span>
            </Tooltip>
            <span>{safety.countSimulatedSpend ? '· counted' : '· not counted'}</span>
          </p>
        </Row>
      </Group>

      <Group
        label="Limits"
        footnote="At 80% the Run Line total turns amber; at 100% new delegated runs ask before they start. Atrium can’t stop spend on a provider’s side."
      >
        <SettingRow id="monthly-budget" label="Monthly budget" hint="For live model spend each calendar month. 0 turns the budget off." error={draft.error}>
          <Input
            value={draft.value}
            onValueChange={draft.onValueChange}
            onFocus={draft.onFocus}
            onBlur={draft.onBlur}
            prefix="$"
            suffix={<span className="type-meta text-ink-3">USD</span>}
            inputMode="decimal"
            autoComplete="off"
            wrapperClassName="w-40 max-sm:w-full"
            className="tabular"
          />
        </SettingRow>
        <SettingRow
          id="count-simulated"
          label="Count simulated estimates"
          hint="Off: simulated runs spend nothing and never count. On: their estimates at reference pricing count toward the budget, to rehearse one."
        >
          <Switch
            checked={safety.countSimulatedSpend}
            onCheckedChange={(countSimulatedSpend) => save('count-simulated', 'Count simulated estimates', 'safety', { countSimulatedSpend })}
          />
        </SettingRow>
      </Group>
    </SectionBody>
  )
}
