import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { getModel } from '@/core/ai/models'
import { db, ID_PREFIX, useDB, useRow, useRows, type Tables } from '@/core/db'
import { DEFAULT_SIM_MODEL_ID, runEngine } from '@/core/runs'
import { getSettings, useSettings } from '@/core/settings'
import {
  ME,
  isRunActive,
  refKey,
  type ActorRef,
  type Agent,
  type AgentSchedule,
  type Autonomy,
  type CapabilityGrant,
  type EntityRef,
  type Hue,
  type ID,
  type Run,
} from '@/core/types'
import { newId } from '@/lib/id'
import { TIME } from '@/lib/format'
import { logActivity } from './activity'
import { getAgentTemplate } from './agentTemplates'
import { changedKeys, clipLine, forgetRef, leastUsedHue, markDerived, memoOnTable, timeBucket, updateRows } from './serviceHelpers'

export { AGENT_TEMPLATES, getAgentTemplate, type AgentTemplate } from './agentTemplates'

/** Registered run factory that simulates an agent working on an instruction. */
export const AGENT_TASK_FACTORY = 'agent.task'

const agentRef = (id: ID): EntityRef => ({ kind: 'agent', id })
const SYSTEM: ActorRef = { type: 'system', id: 'system' }

// ---------------------------------------------------------------- create / update

export interface CreateAgentInput {
  name: string
  role?: string
  description?: string
  hue?: Hue
  /** Seed for the identity sigil (random when omitted). */
  sigil?: number
  modelId?: string
  instructions?: string
  capabilities?: CapabilityGrant[]
  knowledgeScope?: Agent['knowledgeScope']
  autonomy?: Autonomy
  schedule?: AgentSchedule
  monthlyBudgetUsd?: number
  template?: string
}

export const randomSigil = () => Math.floor(Math.random() * 0x7fffffff)

/**
 * One grant per capability + integration (the first wins), copied so templates are never
 * shared by reference. Several grants may exist for one capability via different integrations.
 * "Always allow" (`always`) survives only on allow grants.
 */
function normalizeGrants(grants: readonly CapabilityGrant[]): CapabilityGrant[] {
  const seen = new Set<string>()
  const out: CapabilityGrant[] = []
  for (const g of grants) {
    const key = `${g.capability}|${g.integrationId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const grant: CapabilityGrant = { capability: g.capability, mode: g.mode }
    if (g.integrationId) grant.integrationId = g.integrationId
    if (g.always && g.mode === 'allow') grant.always = true
    out.push(grant)
  }
  return out
}

export function createAgent(input: CreateAgentInput, opts: { summary?: string } = {}): Agent {
  const settings = getSettings()
  const now = Date.now()
  const agent: Agent = {
    id: newId(ID_PREFIX.agents),
    name: input.name.trim() || 'New agent',
    role: input.role?.trim() || 'Assistant',
    description: input.description?.trim() ?? '',
    hue: input.hue ?? leastUsedHue(db.filter('agents', (a) => a.status !== 'archived').map((a) => a.hue)),
    sigil: input.sigil !== undefined && Number.isInteger(input.sigil) ? input.sigil : randomSigil(),
    modelId: input.modelId ?? settings.ai.defaultModelId,
    instructions: input.instructions ?? '',
    capabilities: normalizeGrants(input.capabilities ?? []),
    knowledgeScope: input.knowledgeScope
      ? { all: input.knowledgeScope.all, collectionIds: [...input.knowledgeScope.collectionIds], projectIds: [...input.knowledgeScope.projectIds] }
      : { all: true, collectionIds: [], projectIds: [] },
    autonomy: input.autonomy ?? settings.safety.defaultAutonomy,
    status: 'active',
    schedule: input.schedule ? { ...input.schedule } : undefined,
    monthlyBudgetUsd: input.monthlyBudgetUsd,
    template: input.template,
    createdAt: now,
    updatedAt: now,
  }
  db.insert('agents', agent)
  logActivity({
    actor: ME,
    verb: 'created',
    target: agentRef(agent.id),
    summary: opts.summary ?? `Created agent ${agent.name} (${agent.role})`,
    meta: agent.template ? { template: agent.template } : undefined,
  })
  return agent
}

export function createAgentFromTemplate(templateId: string, overrides: Partial<CreateAgentInput> = {}): Agent {
  const template = getAgentTemplate(templateId)
  if (!template) throw new Error(`Unknown agent template “${templateId}”.`)
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<CreateAgentInput>
  return createAgent({
    name: template.name,
    role: template.role,
    description: template.description,
    hue: template.hue,
    instructions: template.instructions,
    capabilities: template.capabilities,
    autonomy: template.autonomy,
    template: template.id,
    ...defined,
  })
}

export type AgentPatch = Partial<
  Pick<
    Agent,
    | 'name' | 'role' | 'description' | 'hue' | 'sigil' | 'modelId' | 'instructions' | 'capabilities' | 'knowledgeScope' | 'autonomy' | 'schedule'
    | 'monthlyBudgetUsd'
  >
>

const FIELD_LABEL: Partial<Record<keyof Agent, string>> = {
  sigil: 'mark',
  hue: 'color',
  capabilities: 'abilities',
  knowledgeScope: 'knowledge scope',
  modelId: 'model',
  monthlyBudgetUsd: 'monthly budget',
}

export function updateAgent(id: ID, patch: AgentPatch): Agent | undefined {
  const cur = db.get('agents', id)
  if (!cur) return undefined
  const clean: AgentPatch = { ...patch }
  if (clean.name !== undefined) clean.name = clean.name.trim() || cur.name
  if (clean.role !== undefined) clean.role = clean.role.trim() || cur.role
  if (clean.capabilities) clean.capabilities = normalizeGrants(clean.capabilities)
  if (clean.monthlyBudgetUsd !== undefined && !(clean.monthlyBudgetUsd > 0)) clean.monthlyBudgetUsd = undefined
  const fields = changedKeys(cur, clean)
  if (!fields.length) return cur
  const next = db.update('agents', id, { ...clean, updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'updated',
    target: agentRef(id),
    summary: `Updated ${fields.map((f) => FIELD_LABEL[f] ?? f).join(', ')} of ${cur.name}`,
    meta: { fields },
  })
  return next
}

export function duplicateAgent(id: ID): Agent | undefined {
  const cur = db.get('agents', id)
  if (!cur) return undefined
  return createAgent(
    {
      name: `${cur.name} (copy)`,
      role: cur.role,
      description: cur.description,
      hue: cur.hue,
      modelId: cur.modelId,
      instructions: cur.instructions,
      capabilities: cur.capabilities,
      knowledgeScope: cur.knowledgeScope,
      autonomy: cur.autonomy,
      schedule: cur.schedule ? { ...cur.schedule, enabled: false } : undefined,
      monthlyBudgetUsd: cur.monthlyBudgetUsd,
      template: cur.template,
    },
    { summary: `Duplicated agent ${cur.name}` },
  )
}

export function setAgentStatus(id: ID, status: Agent['status']): Agent | undefined {
  const cur = db.get('agents', id)
  if (!cur || cur.status === status) return cur
  const verb = status === 'active' ? (cur.status === 'archived' ? 'restored' : 'resumed') : status
  const next = db.update('agents', id, { status, updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb,
    target: agentRef(id),
    summary: `${verb[0].toUpperCase()}${verb.slice(1)} agent ${cur.name}`,
    meta: { from: cur.status, to: status },
  })
  return next
}

/**
 * Pause an agent: it takes no new work, and its running or queued runs pause where they are
 * (runs waiting on an approval keep waiting). Returns how many runs were paused.
 */
export function pauseAgent(id: ID): number {
  const cur = db.get('agents', id)
  if (!cur || cur.status !== 'active') return 0
  setAgentStatus(id, 'paused')
  let paused = 0
  for (const run of db.filter('runs', (r) => r.agentId === id && (r.status === 'running' || r.status === 'queued') && !!r.script)) {
    try {
      runEngine.pause(run.id)
      paused++
    } catch {
      // A run the engine cannot pause keeps going; the agent itself is still paused.
    }
  }
  return paused
}

/** Resume a paused agent and the runs that are paused. Returns how many runs resumed. */
export function resumeAgent(id: ID): number {
  const cur = db.get('agents', id)
  if (!cur || cur.status !== 'paused') return 0
  setAgentStatus(id, 'active')
  let resumed = 0
  for (const run of db.filter('runs', (r) => r.agentId === id && r.status === 'paused' && !!r.script)) {
    try {
      runEngine.resume(run.id)
      resumed++
    } catch {
      // Unresumable runs stay paused; they can be stopped or retried from the run.
    }
  }
  return resumed
}

/** Delete an agent: cancels its active runs and unassigns its tasks. Run history is kept. */
export function deleteAgent(id: ID): void {
  const cur = db.get('agents', id)
  if (!cur) return
  for (const run of db.filter('runs', (r) => r.agentId === id && isRunActive(r.status))) {
    try {
      runEngine.cancel(run.id, `${cur.name} was deleted`)
    } catch {
      // The engine may be unavailable (e.g. during reset); the run simply stays as recorded.
    }
  }
  const unassigned = updateRows(
    'tasks',
    (t) => t.assignee?.type === 'agent' && t.assignee.id === id,
    (t) => ({ ...t, assignee: null, updatedAt: Date.now() }),
  )
  forgetRef(agentRef(id))
  db.remove('agents', id)
  logActivity({
    actor: ME,
    verb: 'deleted',
    target: agentRef(id),
    summary: unassigned ? `Deleted agent ${cur.name} and unassigned ${unassigned} task${unassigned === 1 ? '' : 's'}` : `Deleted agent ${cur.name}`,
    meta: { unassignedTasks: unassigned },
  })
}

// ---------------------------------------------------------------- spend & budget

export interface AgentSpend {
  /** Month-to-date spend of live (non-simulated) runs. */
  liveUsd: number
  /** Month-to-date estimate of simulated runs at reference pricing (no money was spent). */
  estimatedUsd: number
  /** What counts toward the budget: live spend, plus estimates when Settings › Budgets says so. */
  countedUsd: number
  /** True when `countedUsd` includes simulated estimates. */
  countsEstimates: boolean
}

function startOfMonth(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Month-to-date spend of an agent's runs (pure). Simulated estimates count only when `countSimulated` is on. */
export function computeAgentSpend(runs: readonly Run[], now = Date.now(), countSimulated = false): AgentSpend {
  const from = startOfMonth(now)
  let liveUsd = 0
  let estimatedUsd = 0
  for (const r of runs) {
    const at = r.endedAt ?? r.startedAt ?? r.createdAt
    if (at < from || at > now) continue
    if (r.simulated) estimatedUsd += r.usage.costUsd
    else liveUsd += r.usage.costUsd
  }
  return { liveUsd, estimatedUsd, countedUsd: liveUsd + (countSimulated ? estimatedUsd : 0), countsEstimates: countSimulated && estimatedUsd > 0 }
}

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`)

// ---------------------------------------------------------------- running

export interface RunAgentInput {
  instruction: string
  projectId?: ID | null
  taskId?: ID
  origin?: EntityRef
  /** Who asked (defaults to the user). */
  initiator?: ActorRef
  /**
   * Context from the composer's Context Line (project memory items, held, attached and likely refs).
   * The run reads these first, so they appear in its timeline and in its Saw list.
   */
  context?: EntityRef[]
  /** Why the run started when nobody typed it, e.g. "Scheduled · Mondays at 08:00". */
  trigger?: string
}

/** Throws a friendly error when the agent cannot take new work (paused, archived, over budget). */
export function assertAgentCanRun(agentId: ID): Agent {
  const agent = db.get('agents', agentId)
  if (!agent) throw new Error('This agent no longer exists.')
  if (agent.status === 'paused') throw new Error(`${agent.name} is paused. Resume the agent to give it new work.`)
  if (agent.status === 'archived') throw new Error(`${agent.name} is archived. Restore it before giving it new work.`)
  const budget = agent.monthlyBudgetUsd
  if (budget && budget > 0) {
    const spend = computeAgentSpend(db.filter('runs', (r) => r.agentId === agentId), Date.now(), getSettings().safety.countSimulatedSpend)
    if (spend.countedUsd >= budget) {
      throw new Error(`${agent.name} has used its monthly budget (${usd(spend.countedUsd)} of ${usd(budget)}). Raise the budget to give it more work.`)
    }
  }
  return agent
}

/** Run title from an instruction: first line, ~60 characters. */
export function agentRunTitle(instruction: string): string {
  const firstLine = instruction.trim().split('\n')[0] ?? ''
  return clipLine(firstLine, 60) || 'Agent task'
}

/**
 * The model that executes an agent run. Agent runs are simulated in this build, so a live model
 * configured on the agent is recorded but the run executes on the simulator (and says so).
 */
export function agentExecutorModel(agent: Pick<Agent, 'modelId'>): string {
  return getModel(agent.modelId)?.simulated ? agent.modelId : DEFAULT_SIM_MODEL_ID
}

function dedupeRefs(refs: readonly EntityRef[] | undefined, limit = 24): EntityRef[] {
  const seen = new Set<string>()
  const out: EntityRef[] = []
  for (const r of refs ?? []) {
    const key = refKey(r)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: r.kind, id: r.id })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Start an agent run on an instruction (simulated by the 'agent.task' factory).
 * When `taskId` is given the run is attached to the task, which moves to In progress.
 */
export function runAgent(agentId: ID, input: RunAgentInput): Run {
  const agent = assertAgentCanRun(agentId)
  const instruction = input.instruction.trim()
  if (!instruction) throw new Error(`Tell ${agent.name} what to do first.`)
  const task = input.taskId ? db.get('tasks', input.taskId) : undefined
  const projectId = input.projectId !== undefined ? input.projectId : (task?.projectId ?? null)
  const origin = input.origin ?? (task ? { kind: 'task' as const, id: task.id } : undefined)
  const executor = agentExecutorModel(agent)
  const params: Record<string, unknown> = { agentId, instruction }
  if (task) params.taskId = task.id
  if (projectId) params.projectId = projectId
  const context = dedupeRefs(input.context)
  if (context.length) params.context = context
  if (input.trigger) params.trigger = input.trigger
  if (executor !== agent.modelId) params.configuredModelId = agent.modelId

  const run = runEngine.start({
    kind: 'agent',
    title: agentRunTitle(instruction),
    factory: AGENT_TASK_FACTORY,
    params,
    agentId,
    projectId,
    origin,
    initiator: input.initiator ?? ME,
    modelId: executor,
  })

  // The run service logs “Started …” and links run → origin; record message backlinks too.
  if (origin) markDerived({ kind: 'run', id: run.id }, origin)
  if (task) attachRunToTask(task.id, run.id, agentId)
  return run
}

/**
 * Record that a run works on a task: append it to `task.runIds`, move an open task to
 * In progress and assign the agent when nobody is assigned. Idempotent.
 */
export function attachRunToTask(taskId: ID, runId: ID, agentId: ID): void {
  db.update('tasks', taskId, (t) => {
    const attached = t.runIds.includes(runId)
    const closed = t.status === 'done' || t.status === 'cancelled'
    if (attached && (closed || t.status === 'in_progress') && t.assignee) return t
    return {
      ...t,
      runIds: attached ? t.runIds : [...t.runIds, runId],
      status: closed ? t.status : 'in_progress',
      assignee: t.assignee ?? { type: 'agent', id: agentId },
      updatedAt: Date.now(),
    }
  })
}

// ---------------------------------------------------------------- schedules

/** Schedule presets offered in Configure (cron, local time). */
export const SCHEDULE_PRESETS: readonly { cron: string; label: string }[] = [
  { cron: '0 9 * * 1-5', label: 'Weekdays at 09:00' },
  { cron: '0 8 * * 1', label: 'Mondays at 08:00' },
  { cron: '0 9 * * 1', label: 'Mondays at 09:00' },
  { cron: '0 16 * * 5', label: 'Fridays at 16:00' },
  { cron: '0 8 * * *', label: 'Every day at 08:00' },
  { cron: '0 2 * * *', label: 'Nightly at 02:00' },
  { cron: '0 * * * *', label: 'Every hour' },
]

function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>()
  for (const part of field.split(',')) {
    const [range, stepText] = part.split('/')
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) return null
    let lo: number
    let hi: number
    if (range === '*') {
      lo = min
      hi = max
    } else if (/^\d+-\d+$/.test(range)) {
      const [a, b] = range.split('-').map(Number)
      lo = a
      hi = b
    } else if (/^\d+$/.test(range)) {
      lo = Number(range)
      hi = stepText === undefined ? lo : max
    } else return null
    if (lo < min || hi > max || lo > hi) return null
    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return out
}

/**
 * The first time strictly after `from` (local time, minute precision) that matches a 5-field cron
 * expression (minute hour day-of-month month day-of-week; numbers, `*`, lists, ranges, steps).
 * Searches up to 32 days ahead; undefined when the expression is invalid or never matches.
 */
export function nextCronRun(cron: string, from: number): number | undefined {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return undefined
  const minutes = parseCronField(fields[0], 0, 59)
  const hours = parseCronField(fields[1], 0, 23)
  const doms = parseCronField(fields[2], 1, 31)
  const months = parseCronField(fields[3], 1, 12)
  const dows = parseCronField(fields[4].replace(/\b7\b/g, '0'), 0, 6)
  if (!minutes || !hours || !doms || !months || !dows) return undefined
  const anyDom = fields[2] === '*'
  const anyDow = fields[4] === '*'
  const t = new Date(from)
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  const limit = from + 32 * TIME.DAY
  while (t.getTime() <= limit) {
    const dayOk = anyDom && anyDow ? true : anyDom ? dows.has(t.getDay()) : anyDow ? doms.has(t.getDate()) : doms.has(t.getDate()) || dows.has(t.getDay())
    if (!months.has(t.getMonth() + 1) || !dayOk) {
      t.setDate(t.getDate() + 1)
      t.setHours(0, 0, 0, 0)
      continue
    }
    if (!hours.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0)
      continue
    }
    if (minutes.has(t.getMinutes())) return t.getTime()
    t.setMinutes(t.getMinutes() + 1)
  }
  return undefined
}

/** The instruction a scheduled run works on (agents keep their standing instructions). */
export function scheduledInstruction(agent: Pick<Agent, 'schedule'>): string {
  const label = agent.schedule?.label ?? 'schedule'
  return `Scheduled run (${label})\nWork through your standing instructions and report what changed since the last run.`
}

let schedulerTimer: ReturnType<typeof setInterval> | undefined

/**
 * Fire agent schedules while Atrium is open (§8.4 “Runs only while Atrium is open”): a minute-level
 * check that starts each enabled schedule once per matching minute. Missed times are not replayed.
 * Idempotent; returns a stop function.
 */
export function startAgentScheduler(intervalMs = 20_000): () => void {
  const stop = () => {
    if (schedulerTimer) clearInterval(schedulerTimer)
    schedulerTimer = undefined
  }
  if (schedulerTimer || typeof setInterval === 'undefined') return stop
  let last = Date.now()
  schedulerTimer = setInterval(() => {
    const now = Date.now()
    for (const agent of db.all('agents')) {
      const schedule = agent.schedule
      if (agent.status !== 'active' || !schedule?.enabled) continue
      const due = nextCronRun(schedule.cron, last)
      if (due === undefined || due > now) continue
      const busy = db.find('runs', (r) => r.agentId === agent.id && isRunActive(r.status) && typeof r.script?.params.trigger === 'string')
      if (busy) continue
      try {
        runAgent(agent.id, { instruction: scheduledInstruction(agent), initiator: SYSTEM, trigger: `Scheduled · ${schedule.label}` })
      } catch (error) {
        logActivity({
          actor: SYSTEM,
          verb: 'skipped',
          target: agentRef(agent.id),
          summary: `Skipped ${agent.name}’s scheduled run: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }
    last = now
  }, intervalMs)
  return stop
}

// ---------------------------------------------------------------- live status & stats

export type AgentLiveStatus = 'working' | 'waiting' | 'idle' | 'paused' | 'attention'

const NO_RUNS: Run[] = []

export function runsByAgent(runs: Tables['runs']): Map<ID, Run[]> {
  return memoOnTable(runs, 'runsByAgent', () => {
    const out = new Map<ID, Run[]>()
    for (const run of Object.values(runs)) {
      if (!run.agentId) continue
      const list = out.get(run.agentId)
      if (list) list.push(run)
      else out.set(run.agentId, [run])
    }
    return out
  })
}

/**
 * What an agent is doing right now, derived from its configuration and runs:
 * paused (config) › waiting (a run needs approval or was paused) › working › attention
 * (last finished run failed within 24h) › idle.
 */
export function computeAgentLiveStatus(agent: Pick<Agent, 'status'> | undefined, runs: readonly Run[], now = Date.now()): AgentLiveStatus {
  if (!agent) return 'idle'
  if (agent.status !== 'active') return 'paused'
  if (runs.some((r) => r.status === 'waiting' || r.status === 'paused')) return 'waiting'
  if (runs.some((r) => r.status === 'running' || r.status === 'queued')) return 'working'
  let last: Run | undefined
  for (const r of runs) {
    if (isRunActive(r.status)) continue
    if (!last || (r.endedAt ?? r.createdAt) > (last.endedAt ?? last.createdAt)) last = r
  }
  if (last?.status === 'failed' && now - (last.endedAt ?? last.createdAt) < TIME.DAY) return 'attention'
  return 'idle'
}

export interface AgentStats {
  runs30d: number
  /** succeeded / (succeeded + failed) over the last 30 days; null when nothing finished. */
  successRate: number | null
  /** Mean wall-clock duration of finished runs; null when nothing finished. */
  avgDurationMs: number | null
  costUsd30d: number
  tokens30d: number
  lastRunAt?: number
  /** True when any counted run was simulated, so the cost is an estimate. */
  costIsEstimate: boolean
}

export function computeAgentStats(runs: readonly Run[], now = Date.now()): AgentStats {
  const since = now - 30 * TIME.DAY
  let runs30d = 0
  let succeeded = 0
  let failed = 0
  let durationTotal = 0
  let durationCount = 0
  let costUsd30d = 0
  let tokens30d = 0
  let lastRunAt: number | undefined
  let costIsEstimate = false
  for (const r of runs) {
    const at = r.startedAt ?? r.createdAt
    if (lastRunAt === undefined || at > lastRunAt) lastRunAt = at
    if (r.createdAt < since) continue
    runs30d++
    costUsd30d += r.usage.costUsd
    tokens30d += r.usage.inputTokens + r.usage.outputTokens
    if (r.simulated) costIsEstimate = true
    if (r.status === 'succeeded') succeeded++
    else if (r.status === 'failed') failed++
    if ((r.status === 'succeeded' || r.status === 'failed') && r.startedAt !== undefined && r.endedAt !== undefined) {
      durationTotal += Math.max(0, r.endedAt - r.startedAt)
      durationCount++
    }
  }
  return {
    runs30d,
    successRate: succeeded + failed ? succeeded / (succeeded + failed) : null,
    avgDurationMs: durationCount ? durationTotal / durationCount : null,
    costUsd30d,
    tokens30d,
    lastRunAt,
    costIsEstimate,
  }
}

/** Runs per local day for the last `days` days (oldest first), for sparklines. */
export function computeDailyRuns(runs: readonly Run[], now = Date.now(), days = 30): { t: number; v: number }[] {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - (days - 1))
  const out: { t: number; v: number }[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    out.push({ t: d.getTime(), v: 0 })
  }
  for (const r of runs) {
    const at = new Date(r.createdAt)
    at.setHours(0, 0, 0, 0)
    const index = Math.round((at.getTime() - start.getTime()) / TIME.DAY)
    if (index >= 0 && index < days) out[index].v++
  }
  return out
}

export function useAgent(id: ID | null | undefined): Agent | undefined {
  return useRow('agents', id)
}

/** Agents sorted by name; archived agents are excluded unless asked for. */
export function useAgents(opts: { status?: Agent['status'] | Agent['status'][] } = {}): Agent[] {
  const statuses = opts.status === undefined ? undefined : Array.isArray(opts.status) ? opts.status : [opts.status]
  return useRows(
    'agents',
    (a) => (statuses ? statuses.includes(a.status) : a.status !== 'archived'),
    (a, b) => a.name.localeCompare(b.name),
  )
}

export function useAgentLiveStatus(agentId: ID): AgentLiveStatus {
  return useDB((s) => computeAgentLiveStatus(s.agents[agentId], runsByAgent(s.runs).get(agentId) ?? NO_RUNS))
}

/** Live status of every agent (id → status); re-renders only when one of them changes. */
export function useAgentLiveStatuses(): Record<ID, AgentLiveStatus> {
  return useDB(
    useShallow((s: Tables) => {
      const byAgent = runsByAgent(s.runs)
      const out: Record<ID, AgentLiveStatus> = {}
      for (const a of Object.values(s.agents)) out[a.id] = computeAgentLiveStatus(a, byAgent.get(a.id) ?? NO_RUNS)
      return out
    }),
  )
}

/** 30-day stats for an agent; re-renders only when a value changes. */
export function useAgentStats(agentId: ID): AgentStats {
  return useDB(
    useShallow((s: Tables) => {
      const now = Date.now()
      return memoOnTable(s.runs, `agentStats:${agentId}:${timeBucket(TIME.HOUR, now)}`, () =>
        computeAgentStats(runsByAgent(s.runs).get(agentId) ?? NO_RUNS, now),
      )
    }),
  )
}

/** Month-to-date spend of an agent; re-renders only when a value changes. */
export function useAgentSpend(agentId: ID): AgentSpend {
  const countSimulated = useSettings((st) => st.safety.countSimulatedSpend)
  return useDB(
    useShallow((s: Tables) => {
      const now = Date.now()
      return memoOnTable(s.runs, `agentSpend:${agentId}:${countSimulated}:${timeBucket(TIME.HOUR, now)}`, () =>
        computeAgentSpend(runsByAgent(s.runs).get(agentId) ?? NO_RUNS, now, countSimulated),
      )
    }),
  )
}

/** Runs per day over the last 30 days (sparkline data); stable between run updates within a day. */
export function useAgentDailyRuns(agentId: ID, days = 30): { t: number; v: number }[] {
  const key = useDB((s: Tables) => {
    const now = Date.now()
    return memoOnTable(s.runs, `agentDaily:${agentId}:${days}:${timeBucket(TIME.HOUR, now)}`, () =>
      computeDailyRuns(runsByAgent(s.runs).get(agentId) ?? NO_RUNS, now, days)
        .map((p) => `${p.t}:${p.v}`)
        .join(','),
    )
  })
  return useMemo(
    () =>
      key
        ? key.split(',').map((pair) => {
            const [t, v] = pair.split(':').map(Number)
            return { t, v }
          })
        : [],
    [key],
  )
}
