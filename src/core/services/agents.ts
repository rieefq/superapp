import { useShallow } from 'zustand/react/shallow'
import { db, ID_PREFIX, useDB, useRow, useRows, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import { getSettings } from '@/core/settings'
import {
  ME,
  isRunActive,
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

// ---------------------------------------------------------------- create / update

export interface CreateAgentInput {
  name: string
  role?: string
  description?: string
  hue?: Hue
  modelId?: string
  instructions?: string
  capabilities?: CapabilityGrant[]
  knowledgeScope?: Agent['knowledgeScope']
  autonomy?: Autonomy
  schedule?: AgentSchedule
  monthlyBudgetUsd?: number
  template?: string
}

const randomSigil = () => Math.floor(Math.random() * 0x7fffffff)

/**
 * One grant per capability + integration (the first wins), copied so templates are never
 * shared by reference. Several grants may exist for one capability via different integrations.
 */
function normalizeGrants(grants: readonly CapabilityGrant[]): CapabilityGrant[] {
  const seen = new Set<string>()
  const out: CapabilityGrant[] = []
  for (const g of grants) {
    const key = `${g.capability}|${g.integrationId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(g.integrationId ? { capability: g.capability, mode: g.mode, integrationId: g.integrationId } : { capability: g.capability, mode: g.mode })
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
    sigil: randomSigil(),
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
    'name' | 'role' | 'description' | 'hue' | 'modelId' | 'instructions' | 'capabilities' | 'knowledgeScope' | 'autonomy' | 'schedule' | 'monthlyBudgetUsd'
  >
>

export function updateAgent(id: ID, patch: AgentPatch): Agent | undefined {
  const cur = db.get('agents', id)
  if (!cur) return undefined
  const clean: AgentPatch = { ...patch }
  if (clean.name !== undefined) clean.name = clean.name.trim() || cur.name
  if (clean.capabilities) clean.capabilities = normalizeGrants(clean.capabilities)
  const fields = changedKeys(cur, clean)
  if (!fields.length) return cur
  const next = db.update('agents', id, { ...clean, updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: 'updated',
    target: agentRef(id),
    summary: `Updated ${fields.join(', ')} of ${cur.name}`,
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

// ---------------------------------------------------------------- running

export interface RunAgentInput {
  instruction: string
  projectId?: ID | null
  taskId?: ID
  origin?: EntityRef
  /** Who asked (defaults to the user). */
  initiator?: ActorRef
}

/** Throws a friendly error when the agent cannot take new work. */
export function assertAgentCanRun(agentId: ID): Agent {
  const agent = db.get('agents', agentId)
  if (!agent) throw new Error('This agent no longer exists.')
  if (agent.status === 'paused') throw new Error(`${agent.name} is paused. Resume the agent to give it new work.`)
  if (agent.status === 'archived') throw new Error(`${agent.name} is archived. Restore it before giving it new work.`)
  return agent
}

/** Run title from an instruction: first line, ~60 characters. */
export function agentRunTitle(instruction: string): string {
  const firstLine = instruction.trim().split('\n')[0] ?? ''
  return clipLine(firstLine, 60) || 'Agent task'
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
  const params: Record<string, unknown> = { agentId, instruction }
  if (task) params.taskId = task.id
  if (projectId) params.projectId = projectId

  const run = runEngine.start({
    kind: 'agent',
    title: agentRunTitle(instruction),
    factory: AGENT_TASK_FACTORY,
    params,
    agentId,
    projectId,
    origin,
    initiator: input.initiator ?? ME,
    modelId: agent.modelId,
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

// ---------------------------------------------------------------- live status & stats

export type AgentLiveStatus = 'working' | 'waiting' | 'idle' | 'paused' | 'attention'

const NO_RUNS: Run[] = []

function runsByAgent(runs: Tables['runs']): Map<ID, Run[]> {
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
