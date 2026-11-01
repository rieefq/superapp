import type { EntityRef, ID, Run, RunKind, RunStatus, Usage } from '@/core/types'
import { isRunActive } from '@/core/types'
import { shortCode } from '@/lib/id'
import { failureFingerprint } from './failures'
import { matchesProvider, runTime, type ProviderFilter } from './insights'
import { localHour, localWeekday } from './time'

/**
 * Execution history: the runs behind every Insights number, as narrow records (no steps), with a
 * pure query (window, filters, drill-downs, text) and sort. Pure; pass `now` where time matters.
 */

/** The fields of a run the history shows and filters on. */
export interface RunRecord {
  id: ID
  kind: RunKind
  title: string
  status: RunStatus
  projectId: ID | null
  agentId?: ID
  workflowId?: ID
  modelId?: string
  simulated: boolean
  usage: Usage
  createdAt: number
  startedAt?: number
  endedAt?: number
  /** Why it failed (failed runs) or why it stopped (cancelled runs), when known. */
  error?: string
  /** What started it (message, task, workflow…): "Open origin". */
  origin?: EntityRef
  /** Started from a simulation script, so Retry can run it again. */
  retryable: boolean
}

/** Status groups the history filters on. */
export type HistoryStatus = 'all' | 'succeeded' | 'failed' | 'cancelled' | 'active'
export const HISTORY_STATUSES: readonly HistoryStatus[] = ['all', 'succeeded', 'failed', 'cancelled', 'active']

export interface RunQuery {
  /** Window start (inclusive) and end (inclusive), by `runTime`. */
  from?: number
  to?: number
  /** One project; null/undefined = all work. */
  projectId?: ID | null
  /** Empty or undefined = every kind. */
  kinds?: readonly RunKind[]
  provider?: ProviderFilter
  status?: HistoryStatus
  agentId?: ID
  workflowId?: ID
  /** A `ModelUsage.key`: `<modelId>|live` or `<modelId>|simulated`. */
  modelKey?: string
  /** A `FailureReason.key`: failed runs whose message has this fingerprint. */
  failureKey?: string
  /** Runs that happened in [start, end): one chart bucket. */
  slot?: { start: number; end: number }
  /** A heatmap cell: local weekday (0 = Monday) and hour (0–23). */
  weekday?: number
  hour?: number
  /** Free text over title, handle (RUN-K3J9), failure message, model, agent and workflow names. */
  text?: string
}

/** Names used by text search (agents, workflows, models). */
export interface RunNames {
  agent?: (id: ID) => string | undefined
  workflow?: (id: ID) => string | undefined
  model?: (id: string) => string | undefined
}

/** A record from a full run (the hook caches these per run). */
export function runRecord(run: Run, failureMessage?: string): RunRecord {
  return {
    id: run.id,
    kind: run.kind,
    title: run.title,
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
    error: run.status === 'failed' ? (failureMessage ?? run.error) : run.status === 'cancelled' ? run.error : undefined,
    origin: run.origin,
    retryable: !!run.script,
  }
}

export function statusGroup(status: RunStatus): Exclude<HistoryStatus, 'all'> {
  if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status
  return 'active'
}

/** `<modelId>|live` or `<modelId>|simulated` — the same key as `ModelUsage.key`. */
export function modelKeyOf(r: Pick<RunRecord, 'modelId' | 'simulated'>): string {
  return `${r.modelId || 'unknown'}|${r.simulated ? 'simulated' : 'live'}`
}

/**
 * Wall-clock duration for display and sorting: end − start for finished runs (stopped ones too),
 * now − start while active, null when the run never started.
 */
export function recordDurationMs(r: Pick<RunRecord, 'status' | 'startedAt' | 'endedAt'>, now: number): number | null {
  if (r.startedAt === undefined) return null
  if (isRunActive(r.status)) return Math.max(0, now - r.startedAt)
  return r.endedAt === undefined ? null : Math.max(0, r.endedAt - r.startedAt)
}

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/** Runs matching every given condition, in input order. */
export function queryRuns(records: readonly RunRecord[], q: RunQuery, names: RunNames = {}): RunRecord[] {
  const kinds = q.kinds?.length ? q.kinds : undefined
  const terms = q.text ? normalize(q.text).split(/\s+/).filter(Boolean) : []
  return records.filter((r) => {
    const at = runTime(r)
    if (q.from !== undefined && at < q.from) return false
    if (q.to !== undefined && at > q.to) return false
    if (q.projectId && r.projectId !== q.projectId) return false
    if (kinds && !kinds.includes(r.kind)) return false
    if (!matchesProvider(r, q.provider)) return false
    if (q.status && q.status !== 'all' && statusGroup(r.status) !== q.status) return false
    if (q.agentId && r.agentId !== q.agentId) return false
    if (q.workflowId && r.workflowId !== q.workflowId) return false
    if (q.modelKey && modelKeyOf(r) !== q.modelKey) return false
    if (q.failureKey && (r.status !== 'failed' || failureFingerprint(r.error ?? '') !== q.failureKey)) return false
    if (q.slot && (at < q.slot.start || at >= q.slot.end)) return false
    if (q.weekday !== undefined && localWeekday(at) !== q.weekday) return false
    if (q.hour !== undefined && localHour(at) !== q.hour) return false
    if (terms.length) {
      const hay = normalize(
        [
          r.title,
          shortCode(r.id),
          r.error ?? '',
          r.modelId ? (names.model?.(r.modelId) ?? r.modelId) : '',
          r.agentId ? (names.agent?.(r.agentId) ?? '') : '',
          r.workflowId ? (names.workflow?.(r.workflowId) ?? '') : '',
          r.kind,
        ].join(' '),
      )
      if (!terms.every((t) => hay.includes(t))) return false
    }
    return true
  })
}

export type HistorySortKey = 'started' | 'title' | 'status' | 'kind' | 'duration' | 'tokens' | 'cost'
export type SortDirection = 'asc' | 'desc'

/** Waiting on you first, then running, queued, paused, failed, stopped, done. */
const STATUS_RANK: Record<RunStatus, number> = { waiting: 0, running: 1, queued: 2, paused: 3, failed: 4, cancelled: 5, succeeded: 6 }

/** A sorted copy. Missing values (no duration) sort last in either direction; ties: newest first, then id. */
export function sortRunRecords(records: readonly RunRecord[], key: HistorySortKey, direction: SortDirection, now: number): RunRecord[] {
  const sign = direction === 'asc' ? 1 : -1
  const value = (r: RunRecord): number | string | null => {
    switch (key) {
      case 'started':
        return runTime(r)
      case 'title':
        return r.title.toLowerCase()
      case 'status':
        return STATUS_RANK[r.status]
      case 'kind':
        return r.kind
      case 'duration':
        return recordDurationMs(r, now)
      case 'tokens':
        return r.usage.inputTokens + r.usage.outputTokens
      case 'cost':
        return r.usage.costUsd
    }
  }
  return [...records].sort((a, b) => {
    const va = value(a)
    const vb = value(b)
    if (va === null && vb !== null) return 1
    if (vb === null && va !== null) return -1
    if (va !== null && vb !== null && va !== vb) {
      const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : (va as number) - (vb as number)
      if (cmp !== 0) return cmp * sign
    }
    return runTime(b) - runTime(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}
