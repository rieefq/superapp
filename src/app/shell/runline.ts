/**
 * Run Line logic (§3.6): which runs get a pill, in what order, and the totals sentence.
 * Pure functions, unit-tested in runline.test.ts.
 */
import { startOfLocalDay, startOfLocalMonth } from '@/core/analytics'
import type { ID, Run } from '@/core/types'

export interface RunLineInput {
  /** Queued, running, waiting and paused runs. */
  active: readonly Run[]
  /** Failed runs that have not been opened yet. */
  failedUnopened: readonly Run[]
  /** Runs that just succeeded (shown with ✓ for 8s), keyed to when they finished. */
  justFinished: readonly Run[]
  scopeProjectId: ID | null
}

/**
 * Order: 1 waiting (needs you, oldest first) · 2 failed and not yet opened (newest first) ·
 * 3 running — current project first, newest first (just-finished pills keep their place here) ·
 * 4 queued (oldest first) · 5 paused (newest first).
 */
export function orderRunLine({ active, failedUnopened, justFinished, scopeProjectId }: RunLineInput): Run[] {
  const started = (r: Run) => r.startedAt ?? r.createdAt
  const inScope = (r: Run) => (scopeProjectId && r.projectId === scopeProjectId ? 0 : 1)
  const waiting = active.filter((r) => r.status === 'waiting').sort((a, b) => started(a) - started(b))
  const failed = [...failedUnopened].sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const running = [...active.filter((r) => r.status === 'running'), ...justFinished].sort(
    (a, b) => inScope(a) - inScope(b) || started(b) - started(a),
  )
  const queued = active.filter((r) => r.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)
  const paused = active.filter((r) => r.status === 'paused').sort((a, b) => started(b) - started(a))
  const seen = new Set<ID>()
  const out: Run[] = []
  for (const r of [...waiting, ...failed, ...running, ...queued, ...paused]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    out.push(r)
  }
  return out
}

/** Split ordered pills into what is shown and the +N overflow. */
export function splitPills(ordered: readonly Run[], visible: number): { shown: Run[]; overflow: number } {
  const n = Math.max(0, visible)
  return { shown: ordered.slice(0, n), overflow: Math.max(0, ordered.length - n) }
}

export interface Spend {
  /** Live (non-simulated) spend of runs started today. */
  liveToday: number
  /** Estimated cost of simulated runs started today. */
  simToday: number
  /** Month-to-date spend that counts toward the budget (simulated only when countSimulatedSpend). */
  monthCounted: number
}

export function computeSpend(runs: Iterable<Run>, now: number, countSimulatedSpend: boolean): Spend {
  const today = startOfLocalDay(now)
  const month = startOfLocalMonth(now)
  let liveToday = 0
  let simToday = 0
  let monthCounted = 0
  for (const r of runs) {
    const at = r.startedAt ?? r.createdAt
    const cost = r.usage?.costUsd ?? 0
    if (!cost) continue
    if (at >= today) {
      if (r.simulated) simToday += cost
      else liveToday += cost
    }
    if (at >= month && (!r.simulated || countSimulatedSpend)) monthCounted += cost
  }
  return { liveToday, simToday, monthCounted }
}

export type BudgetTone = 'normal' | 'attn' | 'fail'

/** ink-3 normally, attn at ≥80% of the monthly budget, fail at ≥100% (no budget → normal). */
export function budgetTone(monthCounted: number, monthlyBudgetUsd: number): BudgetTone {
  if (!monthlyBudgetUsd || monthlyBudgetUsd <= 0) return 'normal'
  const ratio = monthCounted / monthlyBudgetUsd
  if (ratio >= 1) return 'fail'
  if (ratio >= 0.8) return 'attn'
  return 'normal'
}

/** $0.42 · $0.004 below a cent · $12.40 (§8.3). */
export function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}

export interface TotalsParts {
  running: number
  paused: number
  needsYou: number
  spendLabel: string
  /** Spend is a simulated estimate (show `est.` and a SIM tag). */
  estimated: boolean
}

/** `3 running · 1 needs you · $0.42 today` — or `est. $1.84 today` with SIM when nothing live ran today. */
export function totalsParts(active: readonly Run[], needsYou: number, spend: Spend): TotalsParts {
  let running = 0
  let paused = 0
  for (const r of active) {
    if (r.status === 'running' || r.status === 'queued') running++
    else if (r.status === 'paused') paused++
  }
  const estimated = spend.liveToday <= 0
  const spendLabel = estimated ? `est. ${formatCost(spend.simToday)} today` : `${formatCost(spend.liveToday)} today`
  return { running, paused, needsYou, spendLabel, estimated }
}

/** "01:24" / "1:02:09" elapsed since a timestamp (mono, §8.3). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}
