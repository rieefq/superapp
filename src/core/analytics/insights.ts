import { getModel } from '@/core/ai/models'
import {
  HUES, isRunActive, type Agent, type Approval, type Hue, type ID, type Run, type RunKind, type RunStatus, type RunStep, type Task,
  type Usage, type Workflow,
} from '@/core/types'
import { TIME } from '@/lib/format'
import { hashString } from '@/lib/rng'
import { failureFingerprint, normalizeFailureReason, runFailureMessage } from './failures'
import { median, percentileSorted, ratio } from './stats'
import {
  addLocalDays, dayIndex, localDaysBetween, localHour, localHoursBetween, localWeekday, startOfLocalMonth, startOfNextLocalMonth,
} from './time'

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
 * - Filters: `projectId` (null = all work), `kinds` (empty or every kind = all) and `provider`
 *   (live or simulated execution) apply to runs, to approvals through their run, and (project only)
 *   to tasks. Unfiltered views also list idle agents and workflows. The budget is account-wide and
 *   ignores filters.
 * - Buckets: hourly for the 24-hour range, daily otherwise (`buckets`); `daily` is always daily.
 */

/** Window lengths in days: 1 (the last 24 hours), 7, 30 and 90. */
export const INSIGHT_RANGES = [1, 7, 30, 90] as const
export type RangeDays = (typeof INSIGHT_RANGES)[number]

/** Which executions to count: every run, runs on real models, or the local simulator's. */
export type ProviderFilter = 'all' | 'live' | 'simulated'
export const PROVIDER_FILTERS: readonly ProviderFilter[] = ['all', 'live', 'simulated']

/** Every run kind, in display order (typed as a full record so a new RunKind fails to compile here). */
const KIND_FLAGS: Record<RunKind, true> = { chat: true, code: true, agent: true, research: true, workflow: true, studio: true }
export const RUN_KINDS: readonly RunKind[] = Object.keys(KIND_FLAGS) as RunKind[]

/** The run fields analytics reads (any full `Run` qualifies). */
export type InsightsRun = Pick<
  Run,
  | 'id' | 'kind' | 'status' | 'projectId' | 'agentId' | 'workflowId' | 'modelId' | 'simulated' | 'usage'
  | 'createdAt' | 'startedAt' | 'endedAt' | 'error' | 'steps'
>

/** `modelId` used in `byModel` for runs that recorded no model. */
export const UNKNOWN_MODEL_ID = 'unknown'

export interface InsightsInput {
  runs: readonly InsightsRun[]
  approvals: readonly Approval[]
  tasks: readonly Task[]
  agents: readonly Agent[]
  workflows: readonly Workflow[]
  /** End of the window (epoch ms). */
  now: number
  rangeDays: RangeDays
  /** Restrict to one project; null/undefined = all work. */
  projectId?: ID | null
  /** Restrict to these run kinds; undefined, empty or every kind = no kind filter. */
  kinds?: readonly RunKind[]
  /** Restrict to live or simulated runs; undefined or 'all' = both. */
  provider?: ProviderFilter
  /** `settings.safety.monthlyBudgetUsd`; 0/undefined = no budget set. */
  monthlyBudgetUsd?: number
  /** `settings.safety.countSimulatedSpend`: simulated estimates count toward the budget (default false). */
  countSimulatedSpend?: boolean
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
  /** Runs on real models (runs − simulatedRuns). */
  liveRuns: number
  /** succeeded / (succeeded + failed); null when nothing finished. */
  successRate: number | null
  inputTokens: number
  outputTokens: number
  /** inputTokens + outputTokens */
  tokens: number
  /** Tokens of runs on real models. */
  liveTokens: number
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
  /** Approvals requested within the window. */
  approvalsAsked: number
  /** Approvals approved or rejected within the window (expired ones are not decisions). */
  approvalsResolved: number
  /** Median of resolvedAt − createdAt over approvalsResolved; null when none. */
  medianApprovalWaitMs: number | null
  /** 90th percentile of the same waits; null when none. */
  p90ApprovalWaitMs: number | null
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
  cancelled: number
  /** Runs still queued, running, waiting or paused. */
  active: number
  costUsd: number
  liveCostUsd: number
  simulatedCostUsd: number
  tokens: number
}

export type BucketUnit = 'hour' | 'day'

/** One time slot of the window: an hour (24-hour range) or a local day. */
export interface InsightsBucket {
  /** Local start of the hour or day (epoch ms). */
  start: number
  /** Start of the next slot (exclusive). */
  end: number
  unit: BucketUnit
  /** The window covers only part of the slot (its first slot and the current one). */
  partial: boolean
  byKind: Record<RunKind, number>
  runs: number
  succeeded: number
  failed: number
  cancelled: number
  active: number
  tokens: number
  costUsd: number
  liveCostUsd: number
  simulatedCostUsd: number
}

export interface KindInsight {
  kind: RunKind
  runs: number
  succeeded: number
  failed: number
  /** Runs executed by the simulator (their tokens and costs are estimates). */
  simulatedRuns: number
  inputTokens: number
  outputTokens: number
  tokens: number
  /** Tokens of simulated runs (estimates). */
  simulatedTokens: number
  costUsd: number
  liveCostUsd: number
  simulatedCostUsd: number
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

/** The most recent failure of an agent (any time up to now, within the filters). */
export interface LastFailure {
  at: number
  reason: string
  runId: ID
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
  liveCostUsd: number
  simulatedCostUsd: number
  /** True when any counted run was simulated, so the cost is an estimate. */
  costIsEstimate: boolean
  tokens: number
  /** Approvals this agent's runs requested within the window. */
  approvalsAsked: number
  /** Latest run at any time up to now (not limited to the window); null when it never ran. */
  lastRunAt: number | null
  lastFailure: LastFailure | null
  /** Runs per day, aligned with `Insights.daily`. */
  daily: number[]
  /** Runs per slot, aligned with `Insights.buckets`. */
  buckets: number[]
  /** Statuses of the latest runs in the window (at most 10), oldest first. */
  recent: RunStatus[]
}

/** The workflow step that fails most often (by node), within the window. */
export interface FailingNode {
  /** Node id, or the step title for runs that recorded none. */
  key: string
  label: string
  count: number
}

export interface WorkflowInsight {
  workflowId: ID
  name: string
  hue: Hue
  deleted: boolean
  runs: number
  succeeded: number
  failed: number
  /** succeeded / (succeeded + failed); null when nothing finished. */
  successRate: number | null
  /** failed / (succeeded + failed); null when nothing finished. */
  failureRate: number | null
  avgDurationMs: number | null
  costUsd: number
  costIsEstimate: boolean
  failingNode: FailingNode | null
  lastRunAt: number | null
  lastRunId: ID | null
  lastRunStatus: RunStatus | null
  daily: number[]
  buckets: number[]
  recent: RunStatus[]
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

/** Resolved-approval waits, bucketed for the approval-wait histogram. */
export interface ApprovalWaitBucket {
  key: string
  label: string
  fromMs: number
  /** Exclusive upper bound; null for the open-ended last bucket. */
  toMs: number | null
  count: number
}

export const APPROVAL_WAIT_BUCKETS: readonly Omit<ApprovalWaitBucket, 'count'>[] = [
  { key: 'lt1m', label: '<1m', fromMs: 0, toMs: TIME.MINUTE },
  { key: '1-5m', label: '1–5m', fromMs: TIME.MINUTE, toMs: 5 * TIME.MINUTE },
  { key: '5-15m', label: '5–15m', fromMs: 5 * TIME.MINUTE, toMs: 15 * TIME.MINUTE },
  { key: '15-60m', label: '15–60m', fromMs: 15 * TIME.MINUTE, toMs: TIME.HOUR },
  { key: '1-4h', label: '1–4h', fromMs: TIME.HOUR, toMs: 4 * TIME.HOUR },
  { key: '4h+', label: '4h+', fromMs: 4 * TIME.HOUR, toMs: null },
]

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
  /** Simulated estimates count toward the budget (`countSimulatedSpend`). */
  countsSimulated: boolean
  /** What counts toward the budget: live spend, plus estimates when `countsSimulated`. */
  countedUsd: number
  /** countedUsd / monthly; null when no budget is set. */
  countedRatio: number | null
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
  /** 'hour' for the 24-hour range, 'day' otherwise. */
  bucketUnit: BucketUnit
  /** One entry per hour (24-hour range) or local day the window touches, zero-filled. */
  buckets: InsightsBucket[]
  /** Run kinds with runs in the window, most tokens first. */
  byKind: KindInsight[]
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
  /** Approvals resolved in the window, by how long they waited (`APPROVAL_WAIT_BUCKETS`). */
  approvalWaits: ApprovalWaitBucket[]
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

/** Does a run pass the provider filter? */
export function matchesProvider(run: Pick<Run, 'simulated'>, provider: ProviderFilter | undefined): boolean {
  return !provider || provider === 'all' || (provider === 'simulated') === !!run.simulated
}

/** The step a failed run failed on: its last failed step (null when none recorded one). */
export function failedStepOf(run: Pick<Run, 'steps'>): RunStep | null {
  for (let i = run.steps.length - 1; i >= 0; i--) if (run.steps[i].status === 'failed') return run.steps[i]
  return null
}

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

/** USD outputs are rounded to a billionth of a dollar: no float noise, sub-cent estimates intact. */
const usd = (n: number): number => Math.round(n * 1e9) / 1e9

/** Durations are reported in whole milliseconds. */
const wholeMs = (n: number | null): number | null => (n === null ? null : Math.round(n))

function usageOf(run: InsightsRun): Usage {
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
  liveTokens: number
  liveCostUsd: number
  simulatedCostUsd: number
  durations: number[]
  tasksCompleted: number
  approvalsPending: number
  approvalsAsked: number
  approvalsResolved: number
  approvalWaits: number[]
}

function newTotals(): TotalsAcc {
  return {
    runs: 0, succeeded: 0, failed: 0, cancelled: 0, active: 0, simulatedRuns: 0, inputTokens: 0, outputTokens: 0, liveTokens: 0,
    liveCostUsd: 0, simulatedCostUsd: 0, durations: [], tasksCompleted: 0, approvalsPending: 0, approvalsAsked: 0,
    approvalsResolved: 0, approvalWaits: [],
  }
}

function addRunToTotals(acc: TotalsAcc, run: InsightsRun, usage: Usage): void {
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
    acc.liveTokens += usage.inputTokens + usage.outputTokens
  }
  acc.inputTokens += usage.inputTokens
  acc.outputTokens += usage.outputTokens
  const duration = runDurationMs(run)
  if (duration !== null) acc.durations.push(duration)
}

function finishTotals(acc: TotalsAcc): InsightsTotals {
  const durations = [...acc.durations].sort((a, b) => a - b)
  const waits = [...acc.approvalWaits].sort((a, b) => a - b)
  return {
    runs: acc.runs,
    succeeded: acc.succeeded,
    failed: acc.failed,
    cancelled: acc.cancelled,
    active: acc.active,
    simulatedRuns: acc.simulatedRuns,
    liveRuns: acc.runs - acc.simulatedRuns,
    successRate: ratio(acc.succeeded, acc.succeeded + acc.failed),
    inputTokens: acc.inputTokens,
    outputTokens: acc.outputTokens,
    tokens: acc.inputTokens + acc.outputTokens,
    liveTokens: acc.liveTokens,
    costUsd: usd(acc.liveCostUsd + acc.simulatedCostUsd),
    liveCostUsd: usd(acc.liveCostUsd),
    simulatedCostUsd: usd(acc.simulatedCostUsd),
    medianDurationMs: wholeMs(percentileSorted(durations, 0.5)),
    p90DurationMs: wholeMs(percentileSorted(durations, 0.9)),
    tasksCompleted: acc.tasksCompleted,
    approvalsPending: acc.approvalsPending,
    approvalsAsked: acc.approvalsAsked,
    approvalsResolved: acc.approvalsResolved,
    medianApprovalWaitMs: wholeMs(median(waits)),
    p90ApprovalWaitMs: wholeMs(percentileSorted(waits, 0.9)),
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
  liveCostUsd: number
  simulatedCostUsd: number
  tokens: number
  simulatedRuns: number
  approvalsAsked: number
  daily: number[]
  buckets: number[]
  /** Runs in the window (for the latest outcomes). */
  seen: { id: ID; at: number; status: RunStatus }[]
  /** Failed steps by node (workflows). */
  failedNodes: Map<string, { label: string; count: number; lastAt: number }>
}

function groupFor(groups: Map<ID, GroupAcc>, id: ID, dayCount: number, bucketCount: number): GroupAcc {
  let acc = groups.get(id)
  if (!acc) {
    acc = {
      runs: 0, succeeded: 0, failed: 0, durationTotal: 0, durationCount: 0, costUsd: 0, liveCostUsd: 0, simulatedCostUsd: 0,
      tokens: 0, simulatedRuns: 0, approvalsAsked: 0, daily: new Array<number>(dayCount).fill(0),
      buckets: new Array<number>(bucketCount).fill(0), seen: [], failedNodes: new Map(),
    }
    groups.set(id, acc)
  }
  return acc
}

function addRunToGroup(acc: GroupAcc, run: InsightsRun, usage: Usage, at: number, day: number, bucket: number): void {
  acc.runs++
  if (run.status === 'succeeded') acc.succeeded++
  else if (run.status === 'failed') acc.failed++
  const duration = runDurationMs(run)
  if (duration !== null) {
    acc.durationTotal += duration
    acc.durationCount++
  }
  acc.costUsd += usage.costUsd
  if (run.simulated) acc.simulatedCostUsd += usage.costUsd
  else acc.liveCostUsd += usage.costUsd
  acc.tokens += usage.inputTokens + usage.outputTokens
  if (run.simulated) acc.simulatedRuns++
  if (day >= 0) acc.daily[day]++
  if (bucket >= 0) acc.buckets[bucket]++
  acc.seen.push({ id: run.id, at, status: run.status })
}

/** Latest outcomes, oldest first (ties break on id so input order never matters). */
function recentOutcomes(seen: GroupAcc['seen'], max = 10): RunStatus[] {
  return [...seen]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .slice(-max)
    .map((s) => s.status)
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

function addFailure(failures: Map<string, FailureAcc>, run: InsightsRun, at: number): void {
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

interface BucketAcc extends Omit<InsightsBucket, 'costUsd' | 'liveCostUsd' | 'simulatedCostUsd'> {
  live: number
  sim: number
}

function emptyBucket(start: number, end: number, unit: BucketUnit, partial: boolean): BucketAcc {
  return {
    start, end, unit, partial, byKind: emptyKindCounts(), runs: 0, succeeded: 0, failed: 0, cancelled: 0, active: 0, tokens: 0,
    live: 0, sim: 0,
  }
}

function addRunToBucket(b: BucketAcc, run: InsightsRun, usage: Usage): void {
  b.runs++
  if (run.kind in b.byKind) b.byKind[run.kind]++
  if (run.status === 'succeeded') b.succeeded++
  else if (run.status === 'failed') b.failed++
  else if (run.status === 'cancelled') b.cancelled++
  else if (isRunActive(run.status)) b.active++
  b.tokens += usage.inputTokens + usage.outputTokens
  if (run.simulated) b.sim += usage.costUsd
  else b.live += usage.costUsd
}

// ---------------------------------------------------------------- computeInsights

export function computeInsights(input: InsightsInput): Insights {
  const { now } = input
  const rangeDays = sanitizeRange(input.rangeDays)
  const span = rangeDays * TIME.DAY
  const from = now - span
  const previousFrom = from - span
  const projectId = input.projectId || null
  // No kinds, or every kind, means no kind filter.
  const kinds = input.kinds?.length && !RUN_KINDS.every((k) => input.kinds?.includes(k)) ? input.kinds : undefined
  const provider: ProviderFilter = input.provider && PROVIDER_FILTERS.includes(input.provider) ? input.provider : 'all'
  const filtered = projectId !== null || kinds !== undefined || provider !== 'all'
  const matches = (run: InsightsRun) =>
    (projectId === null || run.projectId === projectId) && (!kinds || kinds.includes(run.kind)) && matchesProvider(run, provider)
  const inCurrent = (t: number) => t >= from && t <= now
  const inPrevious = (t: number) => t >= previousFrom && t < from
  const labelOf = input.modelLabel ?? ((id: string) => getModel(id)?.label)

  // ---- days and buckets
  const days = localDaysBetween(from, now)
  const dayAccs = days.map((day, i) => emptyBucket(day, days[i + 1] ?? addLocalDays(day, 1), 'day', false))
  for (const d of dayAccs) d.partial = d.start < from || d.end - 1 > now
  const bucketUnit: BucketUnit = rangeDays === 1 ? 'hour' : 'day'
  let bucketAccs: BucketAcc[]
  if (bucketUnit === 'hour') {
    const hours = localHoursBetween(from, now)
    bucketAccs = hours.map((h, i) => emptyBucket(h, hours[i + 1] ?? h + TIME.HOUR, 'hour', false))
    for (const b of bucketAccs) b.partial = b.start < from || b.end - 1 > now
  } else {
    bucketAccs = dayAccs
  }
  const bucketStarts = bucketAccs.map((b) => b.start)

  const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
  const current = newTotals()
  const previous = newTotals()
  const models = new Map<string, ModelAcc>()
  const kindAccs = new Map<RunKind, KindInsight>()
  const agentGroups = new Map<ID, GroupAcc>()
  const workflowGroups = new Map<ID, GroupAcc>()
  const agentLastRun = new Map<ID, number>()
  const workflowLastRun = new Map<ID, { at: number; id: ID; status: RunStatus }>()
  const agentLastFailure = new Map<ID, LastFailure>()
  const failures = new Map<string, FailureAcc>()
  const runsById = new Map<ID, InsightsRun>()
  const workflowsById = new Map(input.workflows.map((w) => [w.id, w]))
  const group = (map: Map<ID, GroupAcc>, id: ID) => groupFor(map, id, days.length, bucketAccs.length)

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
      if (run.agentId) {
        bumpLatest(agentLastRun, run.agentId, at)
        if (run.status === 'failed') {
          const failedAt = run.endedAt ?? at
          const cur = agentLastFailure.get(run.agentId)
          if (!cur || isLater(failedAt, run.id, cur.at, cur.runId)) {
            agentLastFailure.set(run.agentId, { at: failedAt, reason: normalizeFailureReason(runFailureMessage(run)), runId: run.id })
          }
        }
      }
      if (run.workflowId) {
        const cur = workflowLastRun.get(run.workflowId)
        if (!cur || isLater(at, run.id, cur.at, cur.id)) workflowLastRun.set(run.workflowId, { at, id: run.id, status: run.status })
      }
    }
    if (inPrevious(at)) {
      addRunToTotals(previous, run, usage)
      continue
    }
    if (!inCurrent(at)) continue

    addRunToTotals(current, run, usage)
    const di = dayIndex(days, at)
    if (di >= 0) addRunToBucket(dayAccs[di], run, usage)
    const bi = bucketUnit === 'day' ? di : dayIndex(bucketStarts, at)
    if (bucketUnit === 'hour' && bi >= 0) addRunToBucket(bucketAccs[bi], run, usage)
    heatmap[localWeekday(at)][localHour(at)]++

    let kindAcc = kindAccs.get(run.kind)
    if (!kindAcc) {
      kindAcc = {
        kind: run.kind, runs: 0, succeeded: 0, failed: 0, simulatedRuns: 0, inputTokens: 0, outputTokens: 0, tokens: 0, simulatedTokens: 0,
        costUsd: 0, liveCostUsd: 0, simulatedCostUsd: 0,
      }
      kindAccs.set(run.kind, kindAcc)
    }
    kindAcc.runs++
    if (run.status === 'succeeded') kindAcc.succeeded++
    else if (run.status === 'failed') kindAcc.failed++
    kindAcc.inputTokens += usage.inputTokens
    kindAcc.outputTokens += usage.outputTokens
    kindAcc.tokens += usage.inputTokens + usage.outputTokens
    kindAcc.costUsd += usage.costUsd
    if (run.simulated) {
      kindAcc.simulatedRuns++
      kindAcc.simulatedTokens += usage.inputTokens + usage.outputTokens
      kindAcc.simulatedCostUsd += usage.costUsd
    } else {
      kindAcc.liveCostUsd += usage.costUsd
    }

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

    if (run.agentId) addRunToGroup(group(agentGroups, run.agentId), run, usage, at, di, bi)
    if (run.workflowId) {
      const g = group(workflowGroups, run.workflowId)
      addRunToGroup(g, run, usage, at, di, bi)
      if (run.status === 'failed') {
        const step = failedStepOf(run)
        if (step) {
          const key = step.nodeId || step.title
          const node = step.nodeId ? workflowsById.get(run.workflowId)?.nodes.find((n) => n.id === step.nodeId) : undefined
          const failedAt = run.endedAt ?? at
          const cur = g.failedNodes.get(key)
          if (cur) {
            cur.count++
            cur.lastAt = Math.max(cur.lastAt, failedAt)
          } else {
            g.failedNodes.set(key, { label: node?.label ?? step.title, count: 1, lastAt: failedAt })
          }
        }
      }
    }
    if (run.status === 'failed') addFailure(failures, run, at)
  }

  // Approvals follow their run's project/kind/provider; an approval whose run is gone only counts unfiltered.
  const waitCounts = APPROVAL_WAIT_BUCKETS.map(() => 0)
  for (const a of input.approvals) {
    const run = runsById.get(a.runId)
    if (filtered && (!run || !matches(run))) continue
    if (pendingAt(a, now)) current.approvalsPending++
    if (pendingAt(a, from - 1)) previous.approvalsPending++
    if (inCurrent(a.createdAt)) {
      current.approvalsAsked++
      if (run?.agentId) group(agentGroups, run.agentId).approvalsAsked++
    } else if (inPrevious(a.createdAt)) {
      previous.approvalsAsked++
    }
    if ((a.status === 'approved' || a.status === 'rejected') && a.resolvedAt !== undefined) {
      const wait = Math.max(0, a.resolvedAt - a.createdAt)
      const target = inCurrent(a.resolvedAt) ? current : inPrevious(a.resolvedAt) ? previous : null
      if (target) {
        target.approvalsResolved++
        target.approvalWaits.push(wait)
      }
      if (target === current) {
        const bi = APPROVAL_WAIT_BUCKETS.findIndex((b) => wait >= b.fromMs && (b.toMs === null || wait < b.toMs))
        if (bi >= 0) waitCounts[bi]++
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
  const agentIds = new Set<ID>([...agentGroups.entries()].filter(([, g]) => g.runs > 0 || g.approvalsAsked > 0).map(([id]) => id))
  if (!filtered) for (const a of input.agents) if (a.status !== 'archived') agentIds.add(a.id)
  const byAgent: AgentInsight[] = []
  for (const id of agentIds) {
    const agent = agentsById.get(id)
    const g = group(agentGroups, id)
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
      liveCostUsd: usd(g.liveCostUsd),
      simulatedCostUsd: usd(g.simulatedCostUsd),
      costIsEstimate: g.simulatedRuns > 0,
      tokens: g.tokens,
      approvalsAsked: g.approvalsAsked,
      lastRunAt: agentLastRun.get(id) ?? null,
      lastFailure: agentLastFailure.get(id) ?? null,
      daily: g.daily,
      buckets: g.buckets,
      recent: recentOutcomes(g.seen),
    })
  }
  byAgent.sort((a, b) => byActivity(a, b) || a.agentId.localeCompare(b.agentId))

  // ---- per workflow
  const workflowIds = new Set<ID>(workflowGroups.keys())
  if (!filtered) for (const w of input.workflows) workflowIds.add(w.id)
  const byWorkflow: WorkflowInsight[] = []
  for (const id of workflowIds) {
    const wf = workflowsById.get(id)
    const g = group(workflowGroups, id)
    const last = workflowLastRun.get(id)
    let failingNode: FailingNode | null = null
    let failingLastAt = -Infinity
    for (const [key, n] of g.failedNodes) {
      if (!failingNode || n.count > failingNode.count || (n.count === failingNode.count && (n.lastAt > failingLastAt || (n.lastAt === failingLastAt && key < failingNode.key)))) {
        failingNode = { key, label: n.label, count: n.count }
        failingLastAt = n.lastAt
      }
    }
    byWorkflow.push({
      workflowId: id,
      name: wf?.name ?? 'Deleted workflow',
      hue: wf?.hue ?? fallbackHue(id),
      deleted: !wf,
      runs: g.runs,
      succeeded: g.succeeded,
      failed: g.failed,
      successRate: ratio(g.succeeded, g.succeeded + g.failed),
      failureRate: ratio(g.failed, g.succeeded + g.failed),
      avgDurationMs: g.durationCount ? Math.round(g.durationTotal / g.durationCount) : null,
      costUsd: usd(g.costUsd),
      costIsEstimate: g.simulatedRuns > 0,
      failingNode,
      lastRunAt: last?.at ?? null,
      lastRunId: last?.id ?? null,
      lastRunStatus: last?.status ?? null,
      daily: g.daily,
      buckets: g.buckets,
      recent: recentOutcomes(g.seen),
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

  // ---- per kind
  const byKind: KindInsight[] = [...kindAccs.values()].map((k) => ({
    ...k,
    costUsd: usd(k.costUsd),
    liveCostUsd: usd(k.liveCostUsd),
    simulatedCostUsd: usd(k.simulatedCostUsd),
  }))
  byKind.sort((a, b) => b.tokens - a.tokens || b.runs - a.runs || RUN_KINDS.indexOf(a.kind) - RUN_KINDS.indexOf(b.kind))

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
  const countsSimulated = !!input.countSimulatedSpend
  const countedUsd = usd(liveSpentUsd + (countsSimulated ? simulatedSpentUsd : 0))
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
    countsSimulated,
    countedUsd,
    countedRatio: ratio(countedUsd, monthlyUsd),
  }

  const finishBucket = ({ live, sim, ...b }: BucketAcc): InsightsBucket => ({
    ...b,
    costUsd: usd(live + sim),
    liveCostUsd: usd(live),
    simulatedCostUsd: usd(sim),
  })
  const daily: InsightsDay[] = dayAccs.map((b) => {
    const { start, end: _end, unit: _unit, ...rest } = finishBucket(b)
    return { day: start, ...rest }
  })

  return {
    window: { rangeDays, from, to: now, previousFrom, previousTo: from },
    totals: finishTotals(current),
    previous: finishTotals(previous),
    daily,
    bucketUnit,
    buckets: bucketAccs.map(finishBucket),
    byKind,
    byModel,
    byAgent,
    byWorkflow,
    heatmap,
    failureReasons,
    approvalWaits: APPROVAL_WAIT_BUCKETS.map((b, i) => ({ ...b, count: waitCounts[i] })),
    budget,
  }
}
