import { db, useDB } from '@/core/db'
import { notify } from '@/core/services/notifications'
import { getSettings, useSettingsStore } from '@/core/settings'
import type { Notification, Run } from '@/core/types'
import { formatUsd } from '@/lib/format'
import { runTime } from './insights'
import { startOfLocalMonth } from './time'

/**
 * The monthly budget Update (§6.10): crossing 80% of `settings.safety.monthlyBudgetUsd` posts one
 * quiet Update per calendar month. Spend counts live runs, plus simulated estimates only when
 * `countSimulatedSpend` is on (§8.4). Pure helpers plus a watcher.
 */

export const BUDGET_ATTN_RATIO = 0.8
export const BUDGET_UPDATE_TITLE = 'Spend passed 80% of the monthly budget'

export interface MonthSpend {
  liveUsd: number
  simulatedUsd: number
  /** What counts toward the budget. */
  countedUsd: number
}

/** Month-to-date spend (runs that started this local month, up to `now`). */
export function monthSpend(runs: Iterable<Pick<Run, 'simulated' | 'usage' | 'startedAt' | 'createdAt'>>, now: number, countSimulated: boolean): MonthSpend {
  const from = startOfLocalMonth(now)
  let liveUsd = 0
  let simulatedUsd = 0
  for (const r of runs) {
    const at = runTime(r)
    if (at < from || at > now) continue
    const cost = Number.isFinite(r.usage?.costUsd) ? r.usage.costUsd : 0
    if (r.simulated) simulatedUsd += cost
    else liveUsd += cost
  }
  return { liveUsd, simulatedUsd, countedUsd: liveUsd + (countSimulated ? simulatedUsd : 0) }
}

/** Post the Update? Only with a budget, at ≥80%, and when none was posted this month. */
export function shouldPostBudgetUpdate(
  countedUsd: number,
  monthlyUsd: number,
  notifications: Iterable<Pick<Notification, 'kind' | 'title' | 'createdAt'>>,
  now: number,
): boolean {
  if (!(monthlyUsd > 0) || countedUsd / monthlyUsd < BUDGET_ATTN_RATIO) return false
  const from = startOfLocalMonth(now)
  for (const n of notifications) if (n.kind === 'system' && n.title === BUDGET_UPDATE_TITLE && n.createdAt >= from) return false
  return true
}

/** Check the budget once; posts the Update when spend has crossed 80%. Returns true when it posted. */
export function checkBudgetUpdate(now = Date.now()): boolean {
  const { monthlyBudgetUsd, countSimulatedSpend } = getSettings().safety
  const spend = monthSpend(db.all('runs'), now, countSimulatedSpend)
  if (!shouldPostBudgetUpdate(spend.countedUsd, monthlyBudgetUsd, db.all('notifications'), now)) return false
  const pct = Math.round((spend.countedUsd / monthlyBudgetUsd) * 100)
  notify({
    kind: 'system',
    title: BUDGET_UPDATE_TITLE,
    body: `${countSimulatedSpend && spend.simulatedUsd > 0 ? 'est. ' : ''}${formatUsd(spend.countedUsd)} of ${formatUsd(monthlyBudgetUsd)} this month (${pct}%). Settings › Budgets`,
    tone: 'warning',
  })
  return true
}

let watchers = 0
let stopWatch: (() => void) | null = null

/**
 * Watch run spend and the budget settings; post the Update when spend crosses 80%. Idempotent and
 * reference-counted: every caller gets its own stop function. Checks are coalesced (one per second).
 */
export function watchBudget(): () => void {
  watchers++
  if (!stopWatch) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        checkBudgetUpdate()
      }, 1000)
    }
    const offDb = useDB.subscribe((state, before) => {
      if (state.runs !== before.runs) schedule()
    })
    const offSettings = useSettingsStore.subscribe((state, before) => {
      if (state.settings.safety !== before.settings.safety) schedule()
    })
    schedule()
    stopWatch = () => {
      offDb()
      offSettings()
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    watchers--
    if (watchers <= 0 && stopWatch) {
      stopWatch()
      stopWatch = null
      watchers = 0
    }
  }
}
