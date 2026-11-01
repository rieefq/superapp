import { getModel } from '@/core/ai/models'
import { runMatcher } from '@/core/runs/hooks'
import { HUES, isRunActive, type Agent, type Approval, type Hue, type ID, type Run, type RunKind, type Task, type Usage, type Workflow } from '@/core/types'
import { TIME } from '@/lib/format'
import { hashString } from '@/lib/rng'
import { failureFingerprint, normalizeFailureReason, runFailureMessage } from './failures'
import { median, percentileSorted, ratio } from './stats'
import { addLocalDays, dayIndex, localDaysBetween, localHour, localWeekday, startOfLocalMonth, startOfNextLocalMonth } from './time'

/**
 * Analytics for the Insights workspace: one pure, deterministic pass over runs, approvals and
 * tasks. Pass `now` explicitly; nothing here reads the clock or the database.
 *
 * Rules
 * - Current window: [now − rangeDays·24h, now]. Previous window: the equal-length span right
 *   before it, [from − rangeDays·24h, from), used for deltas.
 * - A run happens at `startedAt ?? createdAt` (its day, weekday and hour are local time).
 * - Durations: `endedAt − startedAt` of succeeded or failed runs (cancelled runs measure when
 *   someone stopped them, not how long the work takes).
 * - Costs: `usage.costUsd`. Simulated runs carry estimates, kept apart in `simulatedCostUsd`.
 * - Filters: `projectId` (null = all work) and `kinds` (empty = all kinds) apply to runs, to
 *   approvals through their run, and (project only) to tasks. The budget is account-wide and
 *   ignores filters.
 */

export const INSIGHT_RANGES = [7, 30, 90] as const
export type RangeDays = (typeof INSIGHT_RANGES)[number]

/** Every run kind, in display order (typed as a full record so a new RunKind fails to compile here). */
const KIND_FLAGS: Record<RunKind, true> = { chat: true, code: true, agent: true, research: true, workflow: true, studio: true }
export const RUN_KINDS: readonly RunKind[] = Object.keys(KIND_FLAGS) as RunKind[]

/** `modelId` used in `byModel` for runs that recorded no model. */
export const UNKNOWN_MODEL_ID = 'unknown'

export interface InsightsInput {
  runs: readonly Run[]
  approvals: readonly Approval[]
  tasks: readonly Task[]
  agents: readonly Agent[]
  workflows: readonly Workflow[]
  /** End of the window (epoch ms). */
  now: number
  rangeDays: RangeDays
  /** Restrict to one project; null/undefined = all work. */
  projectId?: ID | null
  /** Restrict to these run kinds; undefined or empty = all kinds. */
  kinds?: readonly RunKind[]
  /** `settings.safety.monthlyBudgetUsd`; 0/undefined = no budget set. */
  monthlyBudgetUsd?: number
  /** Display label for a model id (default: the model catalog label). Falls back to the id. */
  modelLabel?: (modelId: string) => string | undefined
}

export interface InsightsTotals {
  runs: number
  succeeded: number
  failed: number
  cancelled: number
  /** queued, running, waiting or paused */
  active: number
  /** Runs executed by the local simulator (their costs are estimates). */
  simulatedRuns: number
  /** succeeded / (succeeded + failed); null when nothing finished. */
  successRate: number | null
  inputTokens: number
  outputTokens: number
  /** inputTokens + outputTokens */
  tokens: number
  /** liveCostUsd + simulatedCostUsd */
  costUsd: number
  /** Cost of runs on real models (simulated = false). */
  liveCostUsd: number
  /** Estimated cost of simulated runs: label it as an estimate. */
  simulatedCostUsd: number
  /** Over succeeded/failed runs with start and end times; null when none. */
  medianDurationMs: number | null
  p90DurationMs: number | null
  /** Tasks moved to done (completedAt) within the window. */
  tasksCompleted: number
  /** Approvals waiting on a decision at the end of the window (for the current window: right now). */
  approvalsPending: number
  /** Approvals approved or rejected within the window (expired ones are not decisions). */
  approvalsResolved: number
  /** Median of resolvedAt − createdAt over approvalsResolved; null when none. */
  medianApprovalWaitMs: number | null
}

export interface InsightsDay {
  /** Local midnight that starts the day (epoch ms). */
  day: number
  /** True when the window covers only part of the day (its first day and today). */
  partial: boolean
  byKind: Record<RunKind, number>
  runs: number
  succeeded: number
  failed: number
  costUsd: number
  tokens: number
}

export interface ModelUsage {
  /** Unique row key: model id + live/simulated. */
  key: string
  modelId: string
  label: string
  /** Rows are split by execution: simulated runs (estimated cost) never share a row with live ones. */
  simulated: boolean
  runs: number
  inputTokens: number
  outputTokens: number
  tokens: number
  costUsd: number
}

export interface AgentInsight {
  agentId: ID
  name: string
  hue: Hue
  /** The agent no longer exists; its run history is still counted. */
  deleted: boolean
  runs: number
  succeeded: number
  failed: number
  successRate: number | null
  avgDurationMs: number | null
  costUsd: number
  /** True when any counted run was simulated, so the cost is an estimate. */
  costIsEstimate: boolean
  tokens: number
  /** Latest run at any time up to now (not limited to the window); null when it never ran. */
  lastRunAt: number | null
  /** Runs per day, aligned with `Insights.daily`. */
  daily: number[]
}

export interface WorkflowInsight {
  workflowId: ID
  name: string
  hue: Hue
  deleted: boolean
  runs: number
  succeeded: number
  failed: number
  /** failed / (succeeded + failed); null when nothing finished. */
  failureRate: number | null
  avgDurationMs: number | null
  costUsd: number
  costIsEstimate: boolean
  lastRunAt: number | null
  daily: number[]
}

export interface FailureReason {
  /** Grouping fingerprint (stable row key). */
  key: string
  /** Normalized message of the most recent failure in the group. */
  reason: string
  count: number
  /** When the most recent failure ended. */
  lastAt: number
  /** The most recent failed run. */
  exampleRunId: ID
  /** Every failed run in the group, newest first. */
  runIds: ID[]
  /** True when every failure in the group came from a simulated run. */
  simulated: boolean
}

export interface BudgetSummary {
  /** 0 when no budget is set. */
  monthlyUsd: number
  /** Spend of runs started this calendar month, live + estimated. */
  spentThisMonthUsd: number
  liveSpentUsd: number
  simulatedSpentUsd: number
  /** True when part of the spend is a simulated estimate: label it so. */
  estimated: boolean
  /** Linear projection to month end at this month's pace (pace measured over at least one day). */
  projectedUsd: number
  /** spent / monthly; null when no budget is set. */
  usedRatio: number | null
  projectedRatio: number | null
  /** Local midnight on the 1st of this month. */
  monthStart: number
  /** Local midnight on the 1st of next month (exclusive). */
  monthEnd: number
}

export interface InsightsWindow {
  rangeDays: number
  /** Current window [from, to]. */
  from: number
  to: number
  /** Previous window [previousFrom, previousTo). */
  previousFrom: number
  previousTo: number
}

export interface Insights {
  window: InsightsWindow
  totals: InsightsTotals
  previous: InsightsTotals
  /** One entry per local day the window touches (rangeDays + 1 for a mid-day `now`), zero-filled. */
  daily: InsightsDay[]
  /** Sorted by cost, then runs. */
  byModel: ModelUsage[]
  /** Agents with runs in the window; unfiltered views also list idle, non-archived agents. Busiest first. */
  byAgent: AgentInsight[]
  /** Workflows with runs in the window; unfiltered views also list idle workflows. Busiest first. */
  byWorkflow: WorkflowInsight[]
  /** heatmap[weekday][hour]: runs by local weekday (0 = Monday) × hour (0–23). */
  heatmap: number[][]
  /** Failed runs grouped by normalized reason, most frequent first. */
  failureReasons: FailureReason[]
  budget: BudgetSummary
}

// ---------------------------------------------------------------- per-run helpers

/** When a run happened: its start, or its creation while it has not started. */
export function runTime(run: Pick<Run, 'startedAt' | 'createdAt'>): number {
  return run.startedAt ?? run.createdAt
}

/** Wall-clock duration of a succeeded or failed run with start and end times; null otherwise. */
export function runDurationMs(run: Pick<Run, 'status' | 'startedAt' | 'endedAt'>): number | null {
  if (run.status !== 'succeeded' && run.status !== 'failed') return null
  if (run.startedAt === undefined || run.endedAt === undefined) return null
  return Math.max(0, run.endedAt - run.startedAt)
}

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** USD outputs are rounded to a billionth of a dollar: no float noise, sub-cent estimates intact. */
const usd = (n: number): number => Math.round(n * 1e9) / 1e9

/** Durations are reported in whole milliseconds. */
const wholeMs = (n: number | null): number | null => (n === null ? null : Math.round(n))

function usageOf(run: Run): Usage {
  const u = run.usage as Usage | undefined
  return { inputTokens: finite(u?.inputTokens), outputTokens: finite(u?.outputTokens), costUsd: finite(u?.costUsd) }
}

function emptyKindCounts(): Record<RunKind, number> {
  return { chat: 0, code: 0, agent: 0, research: 0, workflow: 0, studio: 0 }
}

/** Stable identity hue for a row whose agent/workflow was deleted. */
function fallbackHue(id: ID): Hue {
  return HUES[hashString(id) % HUES.length]
}

function sanitizeRange(rangeDays: number): number {
  const days = Math.floor(finite(rangeDays))
  return days >= 1 ? Math.min(days, 366) : 7
}

// ---------------------------------------------------------------- accumulators

interface TotalsAcc {
  runs: number
  succeeded: number
  failed: number
  cancelled: number
  active: number
  simulatedRuns: number
  inputTokens: number
  outputTokens: number
  liveCostUsd: number
  simulatedCostUsd: number
  durations: number[]
  tasksCompleted: number
  approvalsPending: number
  approvalsResolved: number
  approvalWaits: number[]
}

function newTotals(): TotalsAcc {
  return {
    runs: 0, succeeded: 0, failed: 0, cancelled: 0, active: 0, simulatedRuns: 0, inputTokens: 0, outputTokens: 0,
    liveCostUsd: 0, simulatedCostUsd: 0, durations: [], tasksCompleted: 0, approvalsPending: 0, approvalsResolved: 0,
    approvalWaits: [],
  }
}

function addRunToTotals(acc: TotalsAcc, run: Run, usage: Usage): void {
  acc.runs++
  if (run.status === 'succeeded') acc.succeeded++
  else if (run.status === 'failed') acc.failed++
  else if (run.status === 'cancelled') acc.cancelled++
  else if (isRunActive(run.status)) acc.active++
  if (run.simulated) {
    acc.simulatedRuns++
    acc.simulatedCostUsd += usage.costUsd
  } else {
    acc.liveCostUsd += usage.costUsd
  }
  acc.inputTokens += usage.inputTokens
  acc.outputTokens += usage.outputTokens
  const duration = runDurationMs(run)
  if (duration !== null) acc.durations.push(duration)
}

function finishTotals(acc: TotalsAcc): InsightsTotals {
  const durations = [...acc.durations].sort((a, b) => a - b)
  return {
    runs: acc.runs,
    succeeded: acc.succeeded,
    failed: acc.failed,
    cancelled: acc.cancelled,
    active: acc.active,
    simulatedRuns: acc.simulatedRuns,
    successRate: ratio(acc.succeeded, acc.succeeded + acc.failed),
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    tokens: acc.inputTokens + acc.outputTokens,
    costUsd: usd(acc.liveCostUsd + acc.simulatedCostUsd),
    liveCostUsd: usd(acc.liveCostUsd),
    simulatedCostUsd: usd(acc.simulatedCostUsd),
    medianDurationMs: wholeMs(percentileSorted(durations, 0.5)),
    p90DurationMs: wholeMs(percentileSorted(durations, 0.9)),
    tasksCompleted: acc.tasksCompleted,
    approvalsPending: acc.approvalsPending,
    approvalsResolved: acc.approvalsResolved,
    medianApprovalWaitMs: wholeMs(median(acc.approvalWaits)),
  }
}

/** Per agent / per workflow accumulator. */
interface GroupAcc {
  runs: number
  succeeded: number
  failed: number
  durationTotal: number
  durationCount: number
  costUsd: number
  tokens: number
  simulatedRuns: number
  daily: number[]
}

function groupFor(groups: Map<ID, GroupAcc>, id: ID, dayCount: number): GroupAcc {
  let acc = groups.get(id)
  if (!acc) {
    acc = { runs: 0, succeeded: 0, failed: 0, durationTotal: 0, durationCount: 0, costUsd: 0, tokens: 0, simulatedRuns: 0, daily: new Array<number>(dayCount).fill(0) }
    groups.set(id, acc)
  }
  return acc
}

function addRunToGroup(acc: GroupAcc, run: Run, usage: Usage, day: number): void {
  acc.runs++
  if (run.status === 'succeeded') acc.succeeded++
  else if (run.status === 'failed') acc.failed++
  const duration = runDurationMs(run)
  if (duration !== null) {
    acc.durationTotal += duration
    acc.durationCount++
  }
  acc.costUsd += usage.costUsd
  acc.tokens += usage.inputTokens + usage.outputTokens
  if (run.simulated) acc.simulatedRuns++
  acc.daily[day]++
}

interface ModelAcc {
  modelId: string
  simulated: boolean
  runs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

interface FailureAcc {
  reason: string
  count: number
  lastAt: number
  lastRunId: ID
  runs: { id: ID; at: number }[]
  allSimulated: boolean
}

/** Later failure wins; ties break on run id so results never depend on input order. */
const isLater = (at: number, id: ID, thanAt: number, thanId: ID) => at > thanAt || (at === thanAt && id > thanId)

function addFailure(failures: Map<string, FailureAcc>, run: Run, at: number): void {
  const message = runFailureMessage(run)
  const key = failureFingerprint(message)
  const failedAt = run.endedAt ?? at
  const acc = failures.get(key)
  if (!acc) {
    failures.set(key, {
      reason: normalizeFailureReason(message), count: 1, lastAt: failedAt, lastRunId: run.id,
      runs: [{ id: run.id, at: failedAt }], allSimulated: run.simulated,
    })
    return
  }
  acc.count++
  acc.runs.push({ id: run.id, at: failedAt })
  acc.allSimulated &&= run.simulated
  if (isLater(failedAt, run.id, acc.lastAt, acc.lastRunId)) {
    acc.lastAt = failedAt
    acc.lastRunId = run.id
    acc.reason = normalizeFailureReason(message)
  }
}

/** Was the approval waiting on a decision at instant `t`? */
function pendingAt(a: Approval, t: number): boolean {
  if (a.createdAt > t) return false
  if (a.status === 'pending') return true
  return a.resolvedAt !== undefined && a.resolvedAt > t
}

const bumpLatest = (map: Map<ID, number>, id: ID, at: number) => {
  const cur = map.get(id)
  if (cur === undefined || at > cur) map.set(id, at)
}

/** Busiest first, then most recently active, then by name. */
function byActivity<T extends { runs: number; lastRunAt: number | null; name: string }>(a: T, b: T): number {
  return b.runs - a.runs || (b.lastRunAt ?? -Infinity) - (a.lastRunAt ?? -Infinity) || a.name.localeCompare(b.name)
}

// ---------------------------------------------------------------- computeInsights

export function computeInsights(input: InsightsInput): Insights {
  const { now } = input
  const rangeDays = sanitizeRange(input.rangeDays)
  const span = rangeDays * TIME.DAY
  const from = now - span
  const previousFrom = from - span
  const projectId = input.projectId || null
  const kinds = input.kinds?.length ? input.kinds : undefined
  const filtered = projectId !== null || kinds !== undefined
  const matches = runMatcher({ projectId, kind: kinds })
  const inCurrent = (t: number) => t >= from && t <= now
  const inPrevious = (t: number) => t >= previousFrom && t < from
  const labelOf = input.modelLabel ?? ((id: string) => getModel(id)?.label)

  const days = localDaysBetween(from, now)
  const daily: InsightsDay[] = days.map((day, i) => ({
    day,
    partial: day < from || (days[i + 1] ?? addLocalDays(day, 1)) - 1 > now,
    byKind: emptyKindCounts(),
    runs: 0,
    succeeded: 0,
    failed: 0,
    costUsd: 0,
    tokens: 0,
  }))
  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const current = newTotals()
  const previous = newTotals()
  const models = new Map<string, ModelAcc>()
  const agentGroups = new Map<ID, GroupAcc>()
  const workflowGroups = new Map<ID, GroupAcc>()
  const agentLastRun = new Map<ID, number>()
  const workflowLastRun = new Map<ID, number>()
  const failures = new Map<string, FailureAcc>()
  const runsById = new Map<ID, Run>()

  const monthStart = startOfLocalMonth(now)
  const monthEnd = startOfNextLocalMonth(now)
  let liveSpentUsd = 0
  let simulatedSpentUsd = 0

  // Canonical order: float cost sums then never depend on the order rows arrive in.
  const runs = [...input.runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const run of runs) {
    runsById.set(run.id, run)
    const at = runTime(run)
    const usage = usageOf(run)
    if (at >= monthStart && at <= now) {
      if (run.simulated) simulatedSpentUsd += usage.costUsd
      else liveSpentUsd += usage.costUsd
    }
    if (!matches(run)) continue
    if (at <= now) {
      if (run.agentId) bumpLatest(agentLastRun, run.agentId, at)
      if (run.workflowId) bumpLatest(workflowLastRun, run.workflowId, at)
    }
    if (inPrevious(at)) {
      addRunToTotals(previous, run, usage)
      continue
    }
    if (!inCurrent(at)) continue

    addRunToTotals(current, run, usage)
    const di = dayIndex(days, at)
    const bucket = daily[di]
    bucket.runs++
    if (run.kind in bucket.byKind) bucket.byKind[run.kind]++
    if (run.status === 'succeeded') bucket.succeeded++
    else if (run.status === 'failed') bucket.failed++
    bucket.costUsd += usage.costUsd
    bucket.tokens += usage.inputTokens + usage.outputTokens
    heatmap[localWeekday(at)][localHour(at)]++

    const modelId = run.modelId || UNKNOWN_MODEL_ID
    const modelKey = `${modelId}|${run.simulated ? 'simulated' : 'live'}`
    let model = models.get(modelKey)
    if (!model) {
      model = { modelId, simulated: run.simulated, runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
      models.set(modelKey, model)
    }
    model.runs++
    model.inputTokens += usage.inputTokens
    model.outputTokens += usage.outputTokens
    model.costUsd += usage.costUsd

    if (run.agentId) addRunToGroup(groupFor(agentGroups, run.agentId, days.length), run, usage, di)
    if (run.workflowId) addRunToGroup(groupFor(workflowGroups, run.workflowId, days.length), run, usage, di)
    if (run.status === 'failed') addFailure(failures, run, at)
  }

  for (const d of daily) d.costUsd = usd(d.costUsd)

  // Approvals follow their run's project/kind; an approval whose run is gone only counts unfiltered.
  for (const a of input.approvals) {
    if (filtered) {
      const run = runsById.get(a.runId)
      if (!run || !matches(run)) continue
    }
    if (pendingAt(a, now)) current.approvalsPending++
    if (pendingAt(a, from - 1)) previous.approvalsPending++
    if ((a.status === 'approved' || a.status === 'rejected') && a.resolvedAt !== undefined) {
      const wait = Math.max(0, a.resolvedAt - a.createdAt)
      const target = inCurrent(a.resolvedAt) ? current : inPrevious(a.resolvedAt) ? previous : null
      if (target) {
        target.approvalsResolved++
        target.approvalWaits.push(wait)
      }
    }
  }

  for (const t of input.tasks) {
    if (projectId !== null && t.projectId !== projectId) continue
    if (t.status !== 'done' || t.completedAt === undefined) continue
    if (inCurrent(t.completedAt)) current.tasksCompleted++
    else if (inPrevious(t.completedAt)) previous.tasksCompleted++
  }

  // ---- per agent
  const agentsById = new Map(input.agents.map((a) => [a.id, a]))
  const agentIds = new Set<ID>(agentGroups.keys())
  if (!filtered) for (const a of input.agents) if (a.status !== 'archived') agentIds.add(a.id)
  const byAgent: AgentInsight[] = []
  for (const id of agentIds) {
    const agent = agentsById.get(id)
    const g = groupFor(agentGroups, id, days.length)
    byAgent.push({
      agentId: id,
      name: agent?.name ?? 'Deleted agent',
      hue: agent?.hue ?? fallbackHue(id),
      deleted: !agent,
      runs: g.runs,
      succeeded: g.succeeded,
      failed: g.failed,
      successRate: ratio(g.succeeded, g.succeeded + g.failed),
      avgDurationMs: g.durationCount ? Math.round(g.durationTotal / g.durationCount) : null,
      costUsd: usd(g.costUsd),
      costIsEstimate: g.simulatedRuns > 0,
      tokens: g.tokens,
      lastRunAt: agentLastRun.get(id) ?? null,
      daily: g.daily,
    })
  }
  byAgent.sort((a, b) => byActivity(a, b) || a.agentId.localeCompare(b.agentId))

  // ---- per workflow
  const workflowsById = new Map(input.workflows.map((w) => [w.id, w]))
  const workflowIds = new Set<ID>(workflowGroups.keys())
  if (!filtered) for (const w of input.workflows) workflowIds.add(w.id)
  const byWorkflow: WorkflowInsight[] = []
  for (const id of workflowIds) {
    const wf = workflowsById.get(id)
    const g = groupFor(workflowGroups, id, days.length)
    byWorkflow.push({
      workflowId: id,
      name: wf?.name ?? 'Deleted workflow',
      hue: wf?.hue ?? fallbackHue(id),
      deleted: !wf,
      runs: g.runs,
      succeeded: g.succeeded,
      failed: g.failed,
      failureRate: ratio(g.failed, g.succeeded + g.failed),
      avgDurationMs: g.durationCount ? Math.round(g.durationTotal / g.durationCount) : null,
      costUsd: usd(g.costUsd),
      costIsEstimate: g.simulatedRuns > 0,
      lastRunAt: workflowLastRun.get(id) ?? null,
      daily: g.daily,
    })
  }
  byWorkflow.sort((a, b) => byActivity(a, b) || a.workflowId.localeCompare(b.workflowId))

  // ---- per model
  const byModel: ModelUsage[] = [...models.entries()].map(([key, m]) => ({
    key,
    modelId: m.modelId,
    label: m.modelId === UNKNOWN_MODEL_ID ? 'Unknown model' : (labelOf(m.modelId) ?? m.modelId),
    simulated: m.simulated,
    runs: m.runs,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    tokens: m.inputTokens + m.outputTokens,
    costUsd: usd(m.costUsd),
  }))
  byModel.sort(
    (a, b) =>
      b.costUsd - a.costUsd ||
      b.runs - a.runs ||
      a.label.localeCompare(b.label) ||
      Number(a.simulated) - Number(b.simulated) ||
      a.key.localeCompare(b.key),
  )

  // ---- failure reasons
  const failureReasons: FailureReason[] = [...failures.entries()].map(([key, f]) => ({
    key,
    reason: f.reason,
    count: f.count,
    lastAt: f.lastAt,
    exampleRunId: f.lastRunId,
    runIds: f.runs.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id)).map((r) => r.id),
    simulated: f.allSimulated,
  }))
  failureReasons.sort(
    (a, b) => b.count - a.count || b.lastAt - a.lastAt || a.reason.localeCompare(b.reason) || a.key.localeCompare(b.key),
  )

  // ---- budget (account-wide)
  const monthlyUsd = Math.max(0, finite(input.monthlyBudgetUsd))
  const spentThisMonthUsd = usd(liveSpentUsd + simulatedSpentUsd)
  const elapsed = Math.max(now - monthStart, TIME.DAY)
  const projectedUsd = usd(spentThisMonthUsd > 0 ? Math.max(spentThisMonthUsd, (spentThisMonthUsd * (monthEnd - monthStart)) / elapsed) : 0)
  const budget: BudgetSummary = {
    monthlyUsd,
    spentThisMonthUsd,
    liveSpentUsd: usd(liveSpentUsd),
    simulatedSpentUsd: usd(simulatedSpentUsd),
    estimated: simulatedSpentUsd > 0,
    projectedUsd,
    usedRatio: ratio(spentThisMonthUsd, monthlyUsd),
    projectedRatio: ratio(projectedUsd, monthlyUsd),
    monthStart,
    monthEnd,
  }

  return {
    window: { rangeDays, from, to: now, previousFrom, previousTo: from },
    totals: finishTotals(current),
    previous: finishTotals(previous),
    daily,
    byModel,
    byAgent,
    byWorkflow,
    heatmap,
    failureReasons,
    budget,
  }
}
