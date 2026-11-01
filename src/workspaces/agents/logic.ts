import type { AgentLiveStatus } from '@/core/services'
import type { Agent, Autonomy, Capability, CapabilityGrant, ID, RiskLevel, Run, RunKind, RunStatus, Task } from '@/core/types'
import { shortCode } from '@/lib/id'
import type { GlyphShape, GlyphTone } from '@/ui'

/**
 * Pure logic for the Agents workspace: run-board filters (URL ⇄ state), bands, fleet ordering,
 * scope relevance and the plain-language copy for autonomy and agent status. No React, no store.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

// ------------------------------------------------------------------------------------------------ filters

export const RUN_KINDS: readonly RunKind[] = ['chat', 'code', 'research', 'agent', 'workflow', 'studio']
export const KIND_CHIP_LABEL: Record<RunKind, string> = {
  chat: 'Chat',
  code: 'Code',
  research: 'Research',
  agent: 'Agent',
  workflow: 'Workflow',
  studio: 'Studio',
}

export type ProviderFilter = 'all' | 'live' | 'sim'
export type StatusFilter = 'any' | 'waiting' | 'running' | 'queued' | 'paused' | 'active' | 'succeeded' | 'failed' | 'cancelled' | 'finished'
export type SinceFilter = 'any' | '24h' | '7d' | '30d'

export interface BoardFilters {
  kind: RunKind | 'all'
  /** 'you' (runs you did yourself), an agent id, or null for anyone. */
  owner: 'you' | ID | null
  provider: ProviderFilter
  status: StatusFilter
  since: SinceFilter
  q: string
}

export const DEFAULT_FILTERS: BoardFilters = { kind: 'all', owner: null, provider: 'all', status: 'any', since: 'any', q: '' }

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  any: 'Any status',
  waiting: 'Needs you',
  running: 'Running',
  queued: 'Queued',
  paused: 'Paused',
  active: 'In flight',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
  finished: 'Finished',
}

export const SINCE_LABEL: Record<SinceFilter, string> = { any: 'Any time', '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days' }
export const PROVIDER_LABEL: Record<ProviderFilter, string> = { all: 'Any provider', live: 'Live only', sim: 'Simulated only' }

const STATUS_ALIASES: Record<string, StatusFilter> = {
  waiting: 'waiting',
  'needs-you': 'waiting',
  needs_you: 'waiting',
  needsyou: 'waiting',
  approval: 'waiting',
  running: 'running',
  queued: 'queued',
  paused: 'paused',
  active: 'active',
  inflight: 'active',
  'in-flight': 'active',
  succeeded: 'succeeded',
  done: 'succeeded',
  success: 'succeeded',
  failed: 'failed',
  failure: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  stopped: 'cancelled',
  finished: 'finished',
}

const SINCE_ALIASES: Record<string, SinceFilter> = { '24h': '24h', '1d': '24h', day: '24h', '7d': '7d', week: '7d', '30d': '30d', month: '30d' }

/** Read the board filters from the URL (`?status=`, `?kind=`, `?agent=`, `?provider=`, `?since=`, `?q=`). */
export function parseBoardFilters(params: URLSearchParams, agents: readonly Pick<Agent, 'id' | 'name'>[]): BoardFilters {
  const kindRaw = (params.get('kind') ?? '').toLowerCase()
  const kind: BoardFilters['kind'] = kindRaw === 'coding' ? 'code' : (RUN_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as RunKind) : 'all'
  const agentRaw = (params.get('agent') ?? params.get('owner') ?? '').trim()
  let owner: BoardFilters['owner'] = null
  if (agentRaw) {
    const lower = agentRaw.toLowerCase()
    if (lower === 'you' || lower === 'me') owner = 'you'
    else {
      const hit =
        agents.find((a) => a.id === agentRaw) ??
        agents.find((a) => a.id === `agt_${lower}`) ??
        agents.find((a) => a.name.toLowerCase() === lower)
      owner = hit?.id ?? null
    }
  }
  const providerRaw = (params.get('provider') ?? '').toLowerCase()
  const provider: ProviderFilter = providerRaw === 'live' ? 'live' : providerRaw === 'sim' || providerRaw === 'simulated' ? 'sim' : 'all'
  const status = STATUS_ALIASES[(params.get('status') ?? '').toLowerCase()] ?? 'any'
  const since = SINCE_ALIASES[(params.get('since') ?? '').toLowerCase()] ?? 'any'
  const q = (params.get('q') ?? '').trim()
  return { kind, owner, provider, status, since, q }
}

/** Write filters back into URL params, keeping unrelated params (e.g. `?inspect=`). Defaults are omitted. */
export function applyBoardFilters(params: URLSearchParams, f: BoardFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of ['kind', 'agent', 'owner', 'provider', 'status', 'since', 'q']) next.delete(key)
  if (f.kind !== 'all') next.set('kind', f.kind)
  if (f.owner) next.set('agent', f.owner)
  if (f.provider !== 'all') next.set('provider', f.provider)
  if (f.status !== 'any') next.set('status', f.status)
  if (f.since !== 'any') next.set('since', f.since)
  if (f.q) next.set('q', f.q)
  return next
}

export function activeFilterCount(f: BoardFilters): number {
  return (
    Number(f.kind !== 'all') + Number(!!f.owner) + Number(f.provider !== 'all') + Number(f.status !== 'any') + Number(f.since !== 'any') + Number(!!f.q)
  )
}

const ACTIVE: readonly RunStatus[] = ['queued', 'running', 'waiting', 'paused']
const FINISHED: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled']

function statusMatches(status: RunStatus, filter: StatusFilter): boolean {
  switch (filter) {
    case 'any':
      return true
    case 'active':
      return ACTIVE.includes(status)
    case 'finished':
      return FINISHED.includes(status)
    default:
      return status === filter
  }
}

const SINCE_MS: Record<Exclude<SinceFilter, 'any'>, number> = { '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY }

/** When a run last happened (its end, or its start, or its creation). */
export const runTime = (run: Pick<Run, 'endedAt' | 'startedAt' | 'createdAt'>): number => run.endedAt ?? run.startedAt ?? run.createdAt

/** Does a run pass the board filters and the project scope? Active runs always pass `since` (they are happening now). */
export function runMatches(run: Run, f: BoardFilters, scope: ID | null, now: number): boolean {
  if (scope && run.projectId !== scope) return false
  if (f.kind !== 'all' && run.kind !== f.kind) return false
  if (f.owner === 'you' && (run.agentId || run.workflowId || run.initiator.type !== 'user')) return false
  if (f.owner && f.owner !== 'you' && run.agentId !== f.owner) return false
  if (f.provider === 'live' && run.simulated) return false
  if (f.provider === 'sim' && !run.simulated) return false
  if (!statusMatches(run.status, f.status)) return false
  if (f.since !== 'any' && !ACTIVE.includes(run.status) && runTime(run) < now - SINCE_MS[f.since]) return false
  if (f.q) {
    const q = f.q.toLowerCase()
    const handle = shortCode(run.id).toLowerCase()
    if (!run.title.toLowerCase().includes(q) && !handle.includes(q) && !run.id.toLowerCase().includes(q)) return false
  }
  return true
}

// ------------------------------------------------------------------------------------------------ bands

export type BandId = 'needs' | 'running' | 'queued' | 'paused' | 'recent' | 'earlier'
export const BAND_ORDER: readonly BandId[] = ['needs', 'running', 'queued', 'paused', 'recent', 'earlier']
export const BAND_LABEL: Record<BandId, string> = {
  needs: 'Needs you',
  running: 'Running',
  queued: 'Queued',
  paused: 'Paused',
  recent: 'Recent',
  earlier: 'Earlier',
}

/** Recent = finished in the last 24 hours (§6.4). */
export const RECENT_WINDOW = DAY

export function bandOf(run: Pick<Run, 'status' | 'endedAt' | 'startedAt' | 'createdAt'>, now: number): BandId {
  switch (run.status) {
    case 'waiting':
      return 'needs'
    case 'running':
      return 'running'
    case 'queued':
      return 'queued'
    case 'paused':
      return 'paused'
    default:
      return runTime(run) >= now - RECENT_WINDOW ? 'recent' : 'earlier'
  }
}

const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }

export interface BandContext {
  now: number
  /** Failed runs nobody opened yet (they lead Recent). */
  unopenedFailed: ReadonlySet<ID>
  /** For waiting runs: the risk and age of their pending approval. */
  pending: ReadonlyMap<ID, { risk: RiskLevel; at: number }>
}

/** Group run ids into bands, each in its display order. */
export function bandRuns(runs: readonly Run[], ctx: BandContext): Record<BandId, ID[]> {
  const bands: Record<BandId, Run[]> = { needs: [], running: [], queued: [], paused: [], recent: [], earlier: [] }
  for (const run of runs) bands[bandOf(run, ctx.now)].push(run)
  // Needs you: riskiest first, then the longest waiting.
  bands.needs.sort((a, b) => {
    const pa = ctx.pending.get(a.id)
    const pb = ctx.pending.get(b.id)
    const ra = pa ? RISK_RANK[pa.risk] : 3
    const rb = pb ? RISK_RANK[pb.risk] : 3
    return ra - rb || (pa?.at ?? a.createdAt) - (pb?.at ?? b.createdAt)
  })
  const newestStart = (a: Run, b: Run) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt)
  bands.running.sort(newestStart)
  bands.queued.sort((a, b) => a.createdAt - b.createdAt)
  bands.paused.sort(newestStart)
  // Recent: unopened failures first, then newest.
  bands.recent.sort((a, b) => {
    const fa = a.status === 'failed' && ctx.unopenedFailed.has(a.id) ? 0 : 1
    const fb = b.status === 'failed' && ctx.unopenedFailed.has(b.id) ? 0 : 1
    return fa - fb || runTime(b) - runTime(a)
  })
  bands.earlier.sort((a, b) => runTime(b) - runTime(a))
  return {
    needs: bands.needs.map((r) => r.id),
    running: bands.running.map((r) => r.id),
    queued: bands.queued.map((r) => r.id),
    paused: bands.paused.map((r) => r.id),
    recent: bands.recent.map((r) => r.id),
    earlier: bands.earlier.map((r) => r.id),
  }
}

/**
 * The running band's burn rate: each running run's cost so far divided by its elapsed time
 * (at least five minutes, so a run that just started doesn't read as a spike), summed and scaled to
 * an hour. `estimate` when any run is simulated.
 */
export function hourlyBurn(runs: readonly Pick<Run, 'status' | 'startedAt' | 'createdAt' | 'usage' | 'simulated'>[], now: number): { usd: number; estimate: boolean } {
  let usd = 0
  let estimate = false
  for (const r of runs) {
    if (r.status !== 'running') continue
    const elapsed = Math.max(5 * 60_000, now - (r.startedAt ?? r.createdAt))
    usd += (r.usage.costUsd / elapsed) * HOUR
    if (r.simulated) estimate = true
  }
  return { usd, estimate }
}

// ------------------------------------------------------------------------------------------------ fleet

/** Roster order (§6.4): needs you → running → failed recently → idle → paused. */
export const FLEET_ORDER: readonly AgentLiveStatus[] = ['waiting', 'working', 'attention', 'idle', 'paused']

export interface AgentStatusMeta {
  /** Fleet filter and chip word. */
  word: string
  /** `?status=` value on the roster. */
  param: string
  shape: GlyphShape
  tone: GlyphTone
  live?: boolean
}

export const AGENT_STATUS_META: Record<AgentLiveStatus, AgentStatusMeta> = {
  working: { word: 'Working', param: 'working', shape: 'dot', tone: 'live', live: true },
  waiting: { word: 'Needs you', param: 'waiting', shape: 'diamond', tone: 'attn' },
  attention: { word: 'Needs attention', param: 'attention', shape: 'cross', tone: 'fail' },
  idle: { word: 'Idle', param: 'idle', shape: 'ring', tone: 'ink-3' },
  paused: { word: 'Paused', param: 'paused', shape: 'bars', tone: 'ink-2' },
}

export function parseFleetStatus(value: string | null): AgentLiveStatus | 'archived' | null {
  if (!value) return null
  const v = value.toLowerCase()
  if (v === 'archived') return 'archived'
  const hit = (Object.keys(AGENT_STATUS_META) as AgentLiveStatus[]).find((k) => AGENT_STATUS_META[k].param === v || k === v)
  return hit ?? (v === 'needs-you' ? 'waiting' : v === 'failed' ? 'attention' : null)
}

export function fleetCounts(ids: readonly ID[], statuses: Readonly<Record<ID, AgentLiveStatus>>): Record<AgentLiveStatus, number> {
  const out: Record<AgentLiveStatus, number> = { working: 0, waiting: 0, attention: 0, idle: 0, paused: 0 }
  for (const id of ids) out[statuses[id] ?? 'idle']++
  return out
}

/** Sort agents for the roster and the list pane: by fleet order, then by name. */
export function sortFleet<T extends Pick<Agent, 'id' | 'name'>>(agents: readonly T[], statuses: Readonly<Record<ID, AgentLiveStatus>>): T[] {
  const rank = (id: ID) => FLEET_ORDER.indexOf(statuses[id] ?? 'idle')
  return [...agents].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
}

/**
 * Does an agent work in a project? Yes when it has runs there, holds tasks there, or its knowledge
 * scope names the project. Agents with "All knowledge" and no work there are not counted.
 */
export function agentWorksIn(
  agent: Pick<Agent, 'id' | 'knowledgeScope'>,
  projectId: ID,
  runs: readonly Pick<Run, 'agentId' | 'projectId'>[],
  tasks: readonly Pick<Task, 'assignee' | 'projectId'>[],
): boolean {
  if (agent.knowledgeScope.projectIds.includes(projectId)) return true
  if (runs.some((r) => r.agentId === agent.id && r.projectId === projectId)) return true
  return tasks.some((t) => t.projectId === projectId && t.assignee?.type === 'agent' && t.assignee.id === agent.id)
}

// ------------------------------------------------------------------------------------------------ autonomy & abilities

export const AUTONOMY_ORDER: readonly Autonomy[] = ['supervised', 'balanced', 'autonomous']

export const AUTONOMY_COPY: Record<Autonomy, { label: string; effect: string }> = {
  supervised: {
    label: 'Supervised',
    effect: 'Asks before anything that changes something and before any medium- or high-risk action. Reading runs on its own.',
  },
  balanced: {
    label: 'Balanced',
    effect: 'Asks before medium- and high-risk actions. Low-risk work, like reading and saving notes, runs on its own.',
  },
  autonomous: {
    label: 'Autonomous',
    effect: 'Asks only before high-risk actions. Everything else runs on its own.',
  },
}

export const RISK_ORDER: readonly RiskLevel[] = ['high', 'medium', 'low']
export const RISK_GROUP_LABEL: Record<RiskLevel, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' }

/** Group grant indexes by the capability's risk (high first), keeping their order inside a group. */
export function groupByRisk<T extends Pick<CapabilityGrant, 'capability'>>(
  grants: readonly T[],
  riskOf: (c: Capability) => RiskLevel,
): { risk: RiskLevel; items: { grant: T; index: number }[] }[] {
  return RISK_ORDER.map((risk) => ({
    risk,
    items: grants.map((grant, index) => ({ grant, index })).filter(({ grant }) => riskOf(grant.capability) === risk),
  })).filter((g) => g.items.length > 0)
}

// ------------------------------------------------------------------------------------------------ small formats

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad = (n: number) => String(n).padStart(2, '0')

/** "today 16:00", "tomorrow 09:00", "Mon 08:00", "Nov 9 08:00". */
export function formatWhen(ts: number, now: number): string {
  const d = new Date(ts)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const days = Math.floor((ts - startOfToday.getTime()) / DAY)
  if (days === 0) return `today ${time}`
  if (days === 1) return `tomorrow ${time}`
  if (days > 1 && days < 7) return `${WEEKDAY[d.getDay()]} ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

/** "96%" or "—". */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** Plural helper: "1 run", "3 runs". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
