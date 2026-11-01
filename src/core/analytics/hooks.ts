import { useMemo, useSyncExternalStore } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getModelInfo } from '@/core/ai/registry'
import { db, useDB, useTable, type Tables } from '@/core/db'
import { getSettings, useSettings } from '@/core/settings'
import type { ID, RunKind } from '@/core/types'
import { TIME } from '@/lib/format'
import { computeHomeSummary, type HomeSummary } from './home'
import { computeInsights, type Insights, type RangeDays } from './insights'
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

// ---------------------------------------------------------------- insights

export interface UseInsightsOptions {
  rangeDays: RangeDays
  /** Active project scope; null/undefined = all work. */
  projectId?: ID | null
  /** Run kinds to include; undefined/empty = all. Inline arrays are fine (compared by value). */
  kinds?: readonly RunKind[]
}

/** Model labels from the registry, which also resolves custom-endpoint (`oai:`) models. */
const registryModelLabel = (modelId: string) => getModelInfo(modelId)?.label

const kindsKeyOf = (kinds: readonly RunKind[] | undefined) => (kinds?.length ? [...new Set(kinds)].sort().join(',') : '')
const kindsFromKey = (key: string) => (key ? (key.split(',') as RunKind[]) : undefined)

/**
 * Insights for the current minute (the window ends at the last millisecond of this minute, so
 * runs that start now count immediately). Memoized on the runs, approvals, tasks, agents and
 * workflows tables, the minute, the options and the monthly budget setting.
 */
export function useInsights({ rangeDays, projectId, kinds }: UseInsightsOptions): Insights {
  const runs = useTable('runs')
  const approvals = useTable('approvals')
  const tasks = useTable('tasks')
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const monthlyBudgetUsd = useSettings((s) => s.safety.monthlyBudgetUsd)
  const now = minuteCeil(useMinuteNow())
  const scope = projectId || null
  const kindsKey = kindsKeyOf(kinds)
  return useMemo(
    () =>
      computeInsights({
        runs: Object.values(runs),
        approvals: Object.values(approvals),
        tasks: Object.values(tasks),
        agents: Object.values(agents),
        workflows: Object.values(workflows),
        now,
        rangeDays,
        projectId: scope,
        kinds: kindsFromKey(kindsKey),
        monthlyBudgetUsd,
        modelLabel: registryModelLabel,
      }),
    [runs, approvals, tasks, agents, workflows, now, rangeDays, scope, kindsKey, monthlyBudgetUsd],
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
    monthlyBudgetUsd: getSettings().safety.monthlyBudgetUsd,
    modelLabel: registryModelLabel,
  })
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
