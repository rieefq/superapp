/**
 * Run Line logic (§3.6): which runs get a pill, in what order, and the totals sentence.
 * Pure functions, unit-tested in runline.test.ts.
 */
import { startOfLocalDay, startOfLocalMonth } from '@/core/analytics'
import type { ID, Run } from '@/core/types'
import { formatCost } from '@/ui/signature/format'

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

/** Width a pill needs to keep a readable title: waiting pills also carry "wants approval". */
export function pillWidth(run: Pick<Run, 'status'>): number {
  return run.status === 'waiting' ? 284 : run.status === 'failed' ? 250 : 236
}

/**
 * How many pills fit in `width` px (leaving room for a +N pill when some don't), capped at the
 * range's maximum (3 · 4 · 5 by breakpoint, §3.6). At least one pill always shows.
 */
export function fitPills(ordered: readonly Pick<Run, 'status'>[], width: number, max: number, gap = 6, overflowPill = 44): number {
  let used = 0
  let n = 0
  for (const r of ordered) {
    if (n >= max) break
    const next = used + (n ? gap : 0) + pillWidth(r)
    const remaining = ordered.length - (n + 1)
    if (next + (remaining > 0 ? gap + overflowPill : 0) > width && n > 0) break
    used = next
    n++
  }
  return Math.max(Math.min(1, ordered.length), n)
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
  const spendLabel = estimated ? `${formatCost(spend.simToday, { est: true })} today` : `${formatCost(spend.liveToday)} today`
  return { running, paused, needsYou, spendLabel, estimated }
}
