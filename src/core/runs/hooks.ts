import { useShallow } from 'zustand/react/shallow'
import { useDB, useRow } from '@/core/db'
import { ACTIVE_RUN_STATUSES, type EntityRef, type ID, type Run, type RunKind, type RunStatus } from '@/core/types'

export interface ActiveRunsFilter {
  /** Restrict to one project (null/undefined = all work). */
  projectId?: ID | null
  agentId?: ID
  kind?: RunKind | readonly RunKind[]
}

export interface RunsFilter extends ActiveRunsFilter {
  workflowId?: ID
  status?: RunStatus | readonly RunStatus[]
  /** Maximum number of runs returned (newest first). */
  limit?: number
}

const asList = <T>(v: T | readonly T[] | undefined): readonly T[] | undefined =>
  v === undefined ? undefined : Array.isArray(v) ? (v as readonly T[]) : [v as T]

const newestFirst = (a: Run, b: Run) => b.createdAt - a.createdAt

/** Build a predicate for a runs filter (exported for non-React callers such as analytics). */
export function runMatcher(filter: RunsFilter = {}): (run: Run) => boolean {
  const kinds = asList(filter.kind)
  const statuses = asList(filter.status)
  return (run) =>
    (!filter.projectId || run.projectId === filter.projectId) &&
    (!filter.agentId || run.agentId === filter.agentId) &&
    (!filter.workflowId || run.workflowId === filter.workflowId) &&
    (!kinds || kinds.includes(run.kind)) &&
    (!statuses || statuses.includes(run.status))
}

/** Select runs (newest first) with a stable, shallow-compared result. */
function useRunSelection(filter: RunsFilter): Run[] {
  const match = runMatcher(filter)
  const { limit } = filter
  return useDB(
    useShallow((s) => {
      const rows = Object.values(s.runs).filter(match).sort(newestFirst)
      return limit !== undefined ? rows.slice(0, Math.max(0, limit)) : rows
    }),
  )
}

export function useRun(id: ID | null | undefined): Run | undefined {
  return useRow('runs', id)
}

/** Runs that are queued, running, waiting on an approval or paused — newest first. */
export function useActiveRuns(opts: ActiveRunsFilter = {}): Run[] {
  return useRunSelection({ ...opts, status: ACTIVE_RUN_STATUSES })
}

export function useRuns(opts: RunsFilter = {}): Run[] {
  return useRunSelection(opts)
}

/** Runs started from an entity (message, task, investigation…) — newest first. */
export function useRunsForOrigin(ref: EntityRef | null | undefined): Run[] {
  const kind = ref?.kind
  const id = ref?.id
  return useDB(
    useShallow((s) => {
      if (!kind || !id) return []
      return Object.values(s.runs).filter((r) => r.origin?.kind === kind && r.origin.id === id).sort(newestFirst)
    }),
  )
}

export interface RunSummary {
  count: number
  succeeded: number
  failed: number
  cancelled: number
  /** queued, running, waiting or paused */
  active: number
  inputTokens: number
  outputTokens: number
  /** Sum of run costs (estimates for simulated runs). */
  costUsd: number
  /** Mean wall-clock duration of finished runs that have start and end times (0 when none). */
  avgDurationMs: number
  /** succeeded / (succeeded + failed), 0..1. Cancelled runs are excluded; 0 when nothing finished. */
  successRate: number
}

export function summarizeRuns(runs: readonly Run[]): RunSummary {
  const summary: RunSummary = {
    count: runs.length, succeeded: 0, failed: 0, cancelled: 0, active: 0,
    inputTokens: 0, outputTokens: 0, costUsd: 0, avgDurationMs: 0, successRate: 0,
  }
  let durationTotal = 0
  let durationCount = 0
  for (const run of runs) {
    if (run.status === 'succeeded') summary.succeeded++
    else if (run.status === 'failed') summary.failed++
    else if (run.status === 'cancelled') summary.cancelled++
    else summary.active++
    summary.inputTokens += run.usage.inputTokens
    summary.outputTokens += run.usage.outputTokens
    summary.costUsd += run.usage.costUsd
    const startedAt = run.startedAt ?? run.createdAt
    if (run.endedAt !== undefined && (run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled')) {
      durationTotal += Math.max(0, run.endedAt - startedAt)
      durationCount++
    }
  }
  summary.avgDurationMs = durationCount ? durationTotal / durationCount : 0
  const decided = summary.succeeded + summary.failed
  summary.successRate = decided ? summary.succeeded / decided : 0
  return summary
}
