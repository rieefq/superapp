import { useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getModelInfo } from '@/core/ai/registry'
import { db, useDB, useTable, type Tables } from '@/core/db'
import { getSettings, useSettings } from '@/core/settings'
import type { ID, Run, RunKind, RunStep } from '@/core/types'
import { TIME } from '@/lib/format'
import { runFailureMessage } from './failures'
import { runRecord, type RunRecord } from './history'
import { computeHomeSummary, type HomeSummary } from './home'
import { computeInsights, type Insights, type InsightsRun, type ProviderFilter, type RangeDays } from './insights'
import { minuteCeil, minuteFloor } from './time'

/**
 * React bindings over the pure analytics. Values recompute when the tables they read change
 * and when the wall-clock minute changes (one shared timer for every subscriber).
 */

// ---------------------------------------------------------------- minute clock

const minuteListeners = new Set<() => void>()
let minuteTimer: ReturnType<typeof setTimeout> | null = null

function scheduleMinuteTick(): void {
  // Fire just after the next minute boundary.
  const delay = TIME.MINUTE - (Date.now() % TIME.MINUTE) + 20
  minuteTimer = setTimeout(() => {
    minuteTimer = null
    for (const listener of [...minuteListeners]) listener()
    if (minuteListeners.size && !minuteTimer) scheduleMinuteTick()
  }, delay)
}

function subscribeMinute(listener: () => void): () => void {
  minuteListeners.add(listener)
  if (!minuteTimer) scheduleMinuteTick()
  return () => {
    minuteListeners.delete(listener)
    if (!minuteListeners.size && minuteTimer) {
      clearTimeout(minuteTimer)
      minuteTimer = null
    }
  }
}

const currentMinute = () => minuteFloor(Date.now())

/** The current minute (epoch ms, floored). Re-renders the caller when the minute changes. */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribeMinute, currentMinute, currentMinute)
}

// ---------------------------------------------------------------- run facts

/*
 * Active simulated runs rewrite their row several times a second (step output, progress).
 * Analytics only reads a few fields, so hooks subscribe to "facts": per-run objects holding
 * just those fields, reused while they are unchanged. Step churn then neither recomputes
 * insights nor re-renders the page.
 */

const NO_STEPS: RunStep[] = []

function factsOf(run: Run): InsightsRun {
  return {
    id: run.id,
    kind: run.kind,
    status: run.status,
    projectId: run.projectId,
    agentId: run.agentId,
    workflowId: run.workflowId,
    modelId: run.modelId,
    simulated: run.simulated,
    usage: run.usage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    // Steps only matter for a failed run (its message and the node it failed on): resolve the
    // message once and keep just the failed steps. A failed run no longer changes.
    error: run.status === 'failed' ? runFailureMessage(run) : undefined,
    steps: run.status === 'failed' ? failedSteps(run.steps) : NO_STEPS,
  }
}

function failedSteps(steps: readonly RunStep[]): RunStep[] {
  const out = steps.filter((st) => st.status === 'failed')
  return out.length ? out : NO_STEPS
}

function sameFacts(a: InsightsRun, b: InsightsRun): boolean {
  return (
    a.kind === b.kind && a.status === b.status && a.projectId === b.projectId && a.agentId === b.agentId &&
    a.workflowId === b.workflowId && a.modelId === b.modelId && a.simulated === b.simulated &&
    a.createdAt === b.createdAt && a.startedAt === b.startedAt && a.endedAt === b.endedAt && a.error === b.error &&
    a.usage?.inputTokens === b.usage?.inputTokens && a.usage?.outputTokens === b.usage?.outputTokens &&
    a.usage?.costUsd === b.usage?.costUsd
  )
}

const factsByRun = new WeakMap<Run, InsightsRun>()
const factsByTable = new WeakMap<Tables['runs'], InsightsRun[]>()
let latestFacts = new Map<ID, InsightsRun>()

/** Facts for every run, reusing each run's previous facts object while its analytics fields are unchanged. */
function selectRunFacts(runs: Tables['runs']): InsightsRun[] {
  const cached = factsByTable.get(runs)
  if (cached) return cached
  const next = new Map<ID, InsightsRun>()
  const list: InsightsRun[] = []
  for (const run of Object.values(runs)) {
    let facts = factsByRun.get(run)
    if (!facts) {
      const fresh = factsOf(run)
      const previous = latestFacts.get(run.id)
      facts = previous && sameFacts(previous, fresh) ? previous : fresh
      factsByRun.set(run, facts)
    }
    next.set(run.id, facts)
    list.push(facts)
  }
  latestFacts = next
  factsByTable.set(runs, list)
  return list
}

/** Analytics fields of every run; a new array only when one of those fields changes. */
function useRunFacts(): InsightsRun[] {
  return useDB(useShallow((s: Tables) => selectRunFacts(s.runs)))
}

// ---------------------------------------------------------------- insights

export interface UseInsightsOptions {
  rangeDays: RangeDays
  /** Active project scope; null/undefined = all work. */
  projectId?: ID | null
  /** Run kinds to include; undefined/empty = all. Inline arrays are fine (compared by value). */
  kinds?: readonly RunKind[]
  /** Live or simulated runs only; undefined/'all' = both. */
  provider?: ProviderFilter
}

/** Model labels from the registry, which also resolves custom-endpoint (`oai:`) models. */
const registryModelLabel = (modelId: string) => getModelInfo(modelId)?.label

const kindsKeyOf = (kinds: readonly RunKind[] | undefined) => (kinds?.length ? [...new Set(kinds)].sort().join(',') : '')
const kindsFromKey = (key: string) => (key ? (key.split(',') as RunKind[]) : undefined)

/**
 * Insights for the current minute (the window ends at the last millisecond of this minute, so
 * runs that start now count immediately). Recomputes when run analytics fields (status, times,
 * usage, model, owner…), approvals, tasks, agents or workflows change, when the minute turns
 * over, or when the options or the monthly budget setting change — not on step/progress churn.
 */
export function useInsights({ rangeDays, projectId, kinds, provider }: UseInsightsOptions): Insights {
  const runs = useRunFacts()
  const approvals = useTable('approvals')
  const tasks = useTable('tasks')
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const monthlyBudgetUsd = useSettings((s) => s.safety.monthlyBudgetUsd)
  const countSimulatedSpend = useSettings((s) => s.safety.countSimulatedSpend)
  const now = minuteCeil(useMinuteNow())
  const scope = projectId || null
  const kindsKey = kindsKeyOf(kinds)
  const providerKey = provider ?? 'all'
  return useMemo(
    () =>
      computeInsights({
        runs,
        approvals: Object.values(approvals),
        tasks: Object.values(tasks),
        agents: Object.values(agents),
        workflows: Object.values(workflows),
        now,
        rangeDays,
        projectId: scope,
        kinds: kindsFromKey(kindsKey),
        provider: providerKey,
        monthlyBudgetUsd,
        countSimulatedSpend,
        modelLabel: registryModelLabel,
      }),
    [runs, approvals, tasks, agents, workflows, now, rangeDays, scope, kindsKey, providerKey, monthlyBudgetUsd, countSimulatedSpend],
  )
}

/** Non-React snapshot of insights (for services, the command center or AI answers). */
export function readInsights(opts: UseInsightsOptions & { now?: number }): Insights {
  return computeInsights({
    runs: db.all('runs'),
    approvals: db.all('approvals'),
    tasks: db.all('tasks'),
    agents: db.all('agents'),
    workflows: db.all('workflows'),
    now: opts.now ?? Date.now(),
    rangeDays: opts.rangeDays,
    projectId: opts.projectId,
    kinds: opts.kinds,
    provider: opts.provider,
    monthlyBudgetUsd: getSettings().safety.monthlyBudgetUsd,
    countSimulatedSpend: getSettings().safety.countSimulatedSpend,
    modelLabel: registryModelLabel,
  })
}

// ---------------------------------------------------------------- run history

/*
 * History records: the run fields the execution history shows (title, status, owner, model,
 * usage, times, origin). Like facts, each run's record is reused while those fields are
 * unchanged, so step and progress churn never re-renders the history.
 */

function sameRecord(a: RunRecord, b: RunRecord): boolean {
  return (
    a.title === b.title && a.kind === b.kind && a.status === b.status && a.projectId === b.projectId && a.agentId === b.agentId &&
    a.workflowId === b.workflowId && a.modelId === b.modelId && a.simulated === b.simulated && a.createdAt === b.createdAt &&
    a.startedAt === b.startedAt && a.endedAt === b.endedAt && a.error === b.error && a.retryable === b.retryable &&
    a.origin?.kind === b.origin?.kind && a.origin?.id === b.origin?.id &&
    a.usage?.inputTokens === b.usage?.inputTokens && a.usage?.outputTokens === b.usage?.outputTokens &&
    a.usage?.costUsd === b.usage?.costUsd
  )
}

const recordByRun = new WeakMap<Run, RunRecord>()
const recordsByTable = new WeakMap<Tables['runs'], RunRecord[]>()
let latestRecords = new Map<ID, RunRecord>()

function selectRunRecords(runs: Tables['runs']): RunRecord[] {
  const cached = recordsByTable.get(runs)
  if (cached) return cached
  const next = new Map<ID, RunRecord>()
  const list: RunRecord[] = []
  for (const run of Object.values(runs)) {
    let record = recordByRun.get(run)
    if (!record) {
      const fresh = runRecord(run, run.status === 'failed' ? runFailureMessage(run) : undefined)
      const previous = latestRecords.get(run.id)
      record = previous && sameRecord(previous, fresh) ? previous : fresh
      recordByRun.set(run, record)
    }
    next.set(run.id, record)
    list.push(record)
  }
  latestRecords = next
  recordsByTable.set(runs, list)
  return list
}

/** Every run as a history record; a new array only when a shown field of some run changes. */
export function useRunRecords(): RunRecord[] {
  return useDB(useShallow((s: Tables) => selectRunRecords(s.runs)))
}

// ---------------------------------------------------------------- home summary

interface HomeMemo {
  approvals: Tables['approvals']
  tasks: Tables['tasks']
  value: HomeSummary
}

/** Per runs-table memo so unrelated writes (e.g. streaming messages) never recompute the summary. */
const homeMemo = new WeakMap<Tables['runs'], Map<string, HomeMemo>>()

function selectHomeSummary(s: Tables, now: number, projectId: ID | null): HomeSummary {
  let entries = homeMemo.get(s.runs)
  if (!entries) {
    entries = new Map()
    homeMemo.set(s.runs, entries)
  }
  const key = `${now}|${projectId ?? ''}`
  const hit = entries.get(key)
  if (hit && hit.approvals === s.approvals && hit.tasks === s.tasks) return hit.value
  const value = computeHomeSummary({
    runs: Object.values(s.runs),
    approvals: Object.values(s.approvals),
    tasks: Object.values(s.tasks),
    now,
    projectId,
  })
  if (entries.size >= 16) entries.clear()
  entries.set(key, { approvals: s.approvals, tasks: s.tasks, value })
  return value
}

/**
 * Counts for Home's one-line state sentence. Re-renders only when a count changes (or the
 * minute turns over and a due time passes). Pass the active scope to restrict to one project.
 */
export function useHomeSummary(opts: { projectId?: ID | null } = {}): HomeSummary {
  const projectId = opts.projectId || null
  const now = useMinuteNow()
  return useDB(useShallow((s: Tables) => selectHomeSummary(s, now, projectId)))
}

/** Non-React snapshot of the Home summary. */
export function readHomeSummary(opts: { projectId?: ID | null; now?: number } = {}): HomeSummary {
  return computeHomeSummary({
    runs: db.all('runs'),
    approvals: db.all('approvals'),
    tasks: db.all('tasks'),
    now: opts.now ?? Date.now(),
    projectId: opts.projectId,
  })
}
