import { db, ID_PREFIX, useDB, useRow, useRows, type Tables } from '@/core/db'
import { describeTrigger, TRIGGER_EVENTS } from '@/core/assist/triggers'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { runEngine } from '@/core/runs/engine'
import { findCycle, isSidewaysLayout, layoutGraph, nextCronTime, parseCron, reachableFrom } from '@/core/sim/workflow'
import {
  HUES, ME, isRunActive,
  type ActorRef, type EntityRef, type Hue, type ID, type Run, type RunStatus, type Workflow, type WorkflowEdge, type WorkflowNode,
  type WorkflowTrigger, type WorkflowTriggerType,
} from '@/core/types'
import { newId } from '@/lib/id'
import { hashString } from '@/lib/rng'
import { logActivity } from './activity'
import { forgetRef } from './serviceHelpers'

/**
 * Workflows: node graphs executed as 'workflow.execute' runs (src/core/runs/factories/workflow.ts).
 * Enabling a workflow only matters for automatic triggers (schedule, event, webhook); a disabled
 * workflow can still be run manually with `runWorkflow`.
 *
 * Triggers (docs/DESIGN.md §6.6): manual is real; schedules are a real in-app timer that runs only
 * while Atrium is open; events are real internal events (knowledge.created, task.completed,
 * run.failed, approval.resolved); integration events and webhooks are simulated ("Send test event").
 * The timer and event listener live in `startWorkflowTriggers()`.
 */

export const WORKFLOW_FACTORY = 'workflow.execute'

const wfRef = (id: ID): EntityRef => ({ kind: 'workflow', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

function hueFor(name: string): Hue {
  return HUES[hashString(name) % HUES.length]
}

/** Trigger node config mirroring the workflow's trigger. */
export function triggerNodeConfig(trigger: WorkflowTrigger, base: Record<string, unknown> = {}): Record<string, unknown> {
  const { type: _t, cron: _c, event: _e, ...rest } = base
  return { ...rest, type: trigger.type, ...(trigger.cron ? { cron: trigger.cron } : {}), ...(trigger.event ? { event: trigger.event } : {}) }
}

export interface CreateWorkflowInput {
  name: string
  description?: string
  projectId?: ID | null
  trigger?: WorkflowTrigger
  /** A full graph (templates, drafts). Laid out top to bottom when it was drawn sideways. */
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
  /** Default true (automatic triggers fire once created); the editor creates drafts disabled. */
  enabled?: boolean
  hue?: Hue
}

/** Re-key a graph with fresh node and edge ids (templates and drafts carry placeholder ids). */
function freshGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const ids = new Map(nodes.map((n) => [n.id, newId('nod')]))
  return {
    nodes: nodes.map((n) => ({ ...structuredClone(n), id: ids.get(n.id)! })),
    edges: edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e, id: newId('edg'), source: ids.get(e.source)!, target: ids.get(e.target)! })),
  }
}

/** Lay a graph out top to bottom (docs/DESIGN.md §6.6: flow runs top to bottom). */
export function layoutWorkflowGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] {
  const pos = layoutGraph(nodes, edges)
  return nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position }))
}

/**
 * Create a workflow. Without a graph it gets a trigger connected to an output step ("Notify me");
 * with `nodes`/`edges` (templates, rule-based drafts) the graph is re-keyed and laid out top to bottom.
 */
export function createWorkflow(input: CreateWorkflowInput): Workflow {
  const name = input.name.trim() || 'Untitled workflow'
  const trigger: WorkflowTrigger = input.trigger ?? { type: 'manual', label: 'Manual run' }
  const now = Date.now()
  let nodes: WorkflowNode[]
  let edges: WorkflowEdge[]
  if (input.nodes?.length) {
    const fresh = freshGraph(input.nodes, input.edges ?? [])
    edges = fresh.edges
    const sideways = isSidewaysLayout(fresh.nodes, edges) || fresh.nodes.every((n) => n.position.x === 0 && n.position.y === 0)
    nodes = sideways ? layoutWorkflowGraph(fresh.nodes, edges) : fresh.nodes
  } else {
    const triggerNode: WorkflowNode = {
      id: newId('nod'),
      type: 'trigger',
      label: trigger.label,
      position: { x: 0, y: 0 },
      config: triggerNodeConfig(trigger),
      ...(trigger.integrationId ? { integrationId: trigger.integrationId } : {}),
    }
    const outputNode: WorkflowNode = { id: newId('nod'), type: 'output', label: 'Notify me', position: { x: 0, y: 128 }, config: { kind: 'notify' } }
    nodes = [triggerNode, outputNode]
    edges = [{ id: newId('edg'), source: triggerNode.id, target: outputNode.id }]
  }
  const wf: Workflow = {
    id: newId(ID_PREFIX.workflows),
    name,
    description: input.description?.trim() ?? '',
    projectId: input.projectId ?? null,
    hue: input.hue ?? hueFor(name),
    trigger,
    nodes,
    edges,
    enabled: input.enabled ?? true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  db.insert('workflows', wf)
  logActivity({ actor: ME, verb: 'created', target: wfRef(wf.id), summary: `Created workflow ${quoted(name)}`, projectId: wf.projectId })
  return wf
}

export type WorkflowPatch = Partial<Pick<Workflow, 'name' | 'description' | 'projectId' | 'hue' | 'trigger' | 'nodes' | 'edges'>>

export interface UpdateWorkflowOptions {
  /**
   * Autosave: graph edits within 5 minutes of the last version bump join that version (one version
   * and one activity event per editing session instead of one per keystroke).
   */
  coalesce?: boolean
}

const COALESCE_MS = 5 * 60_000
/** Last graph version bump per workflow in this page session (for coalesced autosave). */
const lastGraphBump = new Map<ID, number>()

/** Update a workflow. Changing the graph (nodes or edges) bumps `version`. */
export function updateWorkflow(id: ID, patch: WorkflowPatch, opts: UpdateWorkflowOptions = {}): Workflow | undefined {
  const cur = db.get('workflows', id)
  if (!cur) return undefined
  const graphChanged =
    (patch.nodes !== undefined && JSON.stringify(patch.nodes) !== JSON.stringify(cur.nodes)) ||
    (patch.edges !== undefined && JSON.stringify(patch.edges) !== JSON.stringify(cur.edges))
  const fields = (Object.keys(patch) as Array<keyof WorkflowPatch>).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(cur[k]))
  if (!fields.length) return cur
  const now = Date.now()
  const joins = graphChanged && !!opts.coalesce && now - (lastGraphBump.get(id) ?? Number.NEGATIVE_INFINITY) < COALESCE_MS
  const bump = graphChanged && !joins
  if (bump) lastGraphBump.set(id, now)
  const next = db.update('workflows', id, {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() || cur.name } : {}),
    version: bump ? cur.version + 1 : cur.version,
    updatedAt: now,
  })
  if (!joins) {
    logActivity({
      actor: ME,
      verb: 'updated',
      target: wfRef(id),
      summary: graphChanged ? `Edited the steps of ${quoted(cur.name)} (v${cur.version + 1})` : `Updated ${fields.join(', ')} of ${quoted(cur.name)}`,
      projectId: cur.projectId,
      meta: { fields },
    })
  }
  return next
}

/**
 * Save node positions only (moving nodes on the canvas). Layout is presentation: it neither bumps
 * the version nor writes activity, and it does not reorder the list.
 */
export function saveWorkflowLayout(id: ID, positions: Record<string, { x: number; y: number }>): void {
  db.update('workflows', id, (wf) => {
    let changed = false
    const nodes = wf.nodes.map((n) => {
      const p = positions[n.id]
      if (!p || (p.x === n.position.x && p.y === n.position.y)) return n
      changed = true
      return { ...n, position: { x: Math.round(p.x), y: Math.round(p.y) } }
    })
    return changed ? { ...wf, nodes } : wf
  })
}

/** Copy a workflow (disabled, version 1, no run history). */
export function duplicateWorkflow(id: ID): Workflow | undefined {
  const cur = db.get('workflows', id)
  if (!cur) return undefined
  const now = Date.now()
  const copy: Workflow = {
    ...structuredClone(cur),
    id: newId(ID_PREFIX.workflows),
    name: `${cur.name} (copy)`,
    enabled: false,
    version: 1,
    lastRunAt: undefined,
    createdAt: now,
    updatedAt: now,
  }
  delete copy.lastRunAt
  db.insert('workflows', copy)
  logActivity({ actor: ME, verb: 'duplicated', target: wfRef(copy.id), summary: `Duplicated ${quoted(cur.name)}`, projectId: copy.projectId })
  return copy
}

export function deleteWorkflow(id: ID): void {
  const cur = db.get('workflows', id)
  if (!cur) return
  for (const run of db.filter('runs', (r) => r.workflowId === id && isRunActive(r.status))) runEngine.cancel(run.id, 'Workflow deleted')
  forgetRef(wfRef(id))
  db.remove('workflows', id)
  lastGraphBump.delete(id)
  logActivity({ actor: ME, verb: 'deleted', target: wfRef(id), summary: `Deleted workflow ${quoted(cur.name)}`, projectId: cur.projectId })
}

/** Put a deleted workflow back exactly as it was (Undo). Runs keep pointing at it by id. */
export function restoreWorkflow(wf: Workflow): void {
  if (db.get('workflows', wf.id)) return
  db.insert('workflows', wf)
  logActivity({ actor: ME, verb: 'restored', target: wfRef(wf.id), summary: `Restored workflow ${quoted(wf.name)}`, projectId: wf.projectId })
}

/** Enable or disable automatic triggering. Disabled workflows can still be run manually. */
export function setWorkflowEnabled(id: ID, enabled: boolean): Workflow | undefined {
  const cur = db.get('workflows', id)
  if (!cur || cur.enabled === enabled) return cur
  const next = db.update('workflows', id, { enabled, updatedAt: Date.now() })
  logActivity({ actor: ME, verb: enabled ? 'enabled' : 'disabled', target: wfRef(id), summary: `${enabled ? 'Enabled' : 'Disabled'} workflow ${quoted(cur.name)}`, projectId: cur.projectId })
  return next
}

/** Export as JSON (no run history). Simulated content is marked. */
export function exportWorkflowJson(wf: Workflow): string {
  const { id, name, description, trigger, nodes, edges, version, enabled } = wf
  return JSON.stringify({ format: 'atrium.workflow', exportedAt: new Date().toISOString(), note: 'Integration steps run simulated in this build.', workflow: { id, name, description, trigger, enabled, version, nodes, edges } }, null, 2)
}

// ---------------------------------------------------------------- triggers

/** Atrium's own events: real, they fire while Atrium is open. */
export const INTERNAL_EVENTS: readonly { event: string; label: string; description: string }[] = [
  { event: 'knowledge.created', label: 'When knowledge is added', description: 'A note, upload or saved report lands in Knowledge.' },
  { event: 'task.completed', label: 'When a task is completed', description: 'Any task in scope moves to Done.' },
  { event: 'run.failed', label: 'When a run fails', description: 'An AI run (chat, research, code, agent, studio) ends in failure.' },
  { event: 'approval.resolved', label: 'When an approval is resolved', description: 'You approve or deny a request.' },
]

const INTERNAL_EVENT_IDS = new Set(INTERNAL_EVENTS.map((e) => e.event))

export const isInternalEvent = (event: string | undefined): boolean => !!event && INTERNAL_EVENT_IDS.has(event)

/** Events of connected services. Their payloads are simulated in this build. */
export const INTEGRATION_EVENTS = TRIGGER_EVENTS.filter((e) => !INTERNAL_EVENT_IDS.has(e.event))

/** Schedule presets for the trigger form (cron in local time). */
export const WORKFLOW_SCHEDULE_PRESETS: readonly { cron: string; label: string }[] = [
  { cron: '0 * * * *', label: 'Every hour' },
  { cron: '0 9 * * *', label: 'Every day at 09:00' },
  { cron: '0 9 * * 1-5', label: 'Weekdays at 09:00' },
  { cron: '0 9 * * 1', label: 'Mondays at 09:00' },
  { cron: '0 16 * * 5', label: 'Fridays at 16:00' },
  { cron: '0 9 1 * *', label: 'Monthly on the 1st at 09:00' },
]

/** Human trigger text: "Mondays at 09:00", "When knowledge is added", "Manual". */
export function triggerLabel(trigger: Pick<WorkflowTrigger, 'type'> & Partial<WorkflowTrigger>): string {
  if (trigger.type === 'event' && trigger.event && isInternalEvent(trigger.event)) return INTERNAL_EVENTS.find((e) => e.event === trigger.event)!.label
  return describeTrigger(trigger)
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Terse trigger text for lists (`meta`): "Mon 09:00", "Daily 09:00", "on knowledge.created", "webhook", "manual". */
export function triggerShort(trigger: WorkflowTrigger): string {
  switch (trigger.type) {
    case 'manual':
      return 'manual'
    case 'webhook':
      return 'webhook'
    case 'event':
      return `on ${trigger.event ?? 'event'}`
    case 'schedule': {
      const parts = trigger.cron?.trim().split(/\s+/)
      if (!parts || parts.length !== 5) return trigger.label || 'schedule'
      const [mi, h, dom, mon, dow] = parts
      const time = /^\d+$/.test(mi) && /^\d+$/.test(h) ? `${h.padStart(2, '0')}:${mi.padStart(2, '0')}` : null
      if (h === '*' && /^\d+$/.test(mi)) return 'hourly'
      if (!time) return trigger.cron ?? 'schedule'
      if (dom === '*' && mon === '*' && dow === '*') return `daily ${time}`
      if (dom === '*' && mon === '*' && dow === '1-5') return `weekdays ${time}`
      if (dom === '*' && mon === '*' && /^\d$/.test(dow)) return `${SHORT_DAYS[Number(dow) % 7]} ${time}`
      if (/^\d+$/.test(dom) && mon === '*' && dow === '*') return `monthly ${dom} · ${time}`
      return trigger.cron ?? 'schedule'
    }
  }
}

export interface TriggerPatch {
  type: WorkflowTriggerType
  cron?: string
  event?: string
  integrationId?: string
}

/** Build a full trigger (with its human label) from a form patch. */
export function buildTrigger(patch: TriggerPatch): WorkflowTrigger {
  const integrationId =
    patch.type === 'event' ? (patch.integrationId ?? TRIGGER_EVENTS.find((e) => e.event === patch.event)?.integrationId) : patch.type === 'webhook' ? 'webhooks' : undefined
  const base: WorkflowTrigger = {
    type: patch.type,
    label: '',
    ...(patch.type === 'schedule' && patch.cron ? { cron: patch.cron } : {}),
    ...(patch.type === 'event' && patch.event ? { event: patch.event } : {}),
    ...(integrationId && patch.type === 'event' ? { integrationId } : {}),
  }
  return { ...base, label: triggerLabel(base) }
}

/** Change the trigger: the workflow's trigger and its first trigger step stay in sync. */
export function setWorkflowTrigger(id: ID, patch: TriggerPatch, opts: UpdateWorkflowOptions = { coalesce: true }): Workflow | undefined {
  const cur = db.get('workflows', id)
  if (!cur) return undefined
  const trigger = buildTrigger(patch)
  const first = cur.nodes.find((n) => n.type === 'trigger')
  const nodes = first
    ? cur.nodes.map((n) => {
        if (n.id !== first.id) return n
        const { integrationId: _drop, ...rest } = n
        // Keep a custom step name; re-label steps still named after the old trigger.
        const named = n.label.trim() && n.label !== cur.trigger.label && n.label !== describeTrigger(cur.trigger)
        return { ...rest, label: named ? n.label : trigger.label, config: triggerNodeConfig(trigger, n.config), ...(trigger.integrationId ? { integrationId: trigger.integrationId } : {}) }
      })
    : cur.nodes
  return updateWorkflow(id, { trigger, nodes }, opts)
}

/** A stable, obviously-fictional address for a webhook trigger (nothing listens there in this build). */
export function webhookUrl(wf: Pick<Workflow, 'id'>): string {
  return `https://hooks.atrium.example/w/${wf.id.replace(/^wfl_/, '')}`
}

/** When a schedule fires next (local time), or undefined for other triggers or invalid cron. */
export function nextScheduledRun(trigger: WorkflowTrigger, from = Date.now()): number | undefined {
  if (trigger.type !== 'schedule' || !trigger.cron) return undefined
  return nextCronTime(trigger.cron, from)
}

/** True when a cron expression can be read. */
export const isValidCron = (cron: string): boolean => !!parseCron(cron)

// ---------------------------------------------------------------- validation

export interface WorkflowIssue {
  nodeId?: string
  severity: 'error' | 'warning'
  message: string
}

/**
 * Problems that would stop (errors) or surprise (warnings) a run: no trigger, broken or looping
 * connections, unreachable steps, conditions missing a branch, agent steps without an available
 * agent, and actions whose integration is not connected.
 */
export function validateWorkflow(wf: Pick<Workflow, 'nodes' | 'edges'> & Partial<Pick<Workflow, 'trigger'>>): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []
  const byId = new Map(wf.nodes.map((n) => [n.id, n]))
  const label = (id: string) => byId.get(id)?.label ?? id
  const triggers = wf.nodes.filter((n) => n.type === 'trigger')
  if (!triggers.length) issues.push({ severity: 'error', message: 'Add a trigger so the workflow knows when to start.' })
  for (const extra of triggers.slice(1)) issues.push({ nodeId: extra.id, severity: 'warning', message: 'Only the first trigger starts this workflow; remove the extra one.' })

  const dangling = wf.edges.filter((e) => !byId.has(e.source) || !byId.has(e.target))
  if (dangling.length) issues.push({ severity: 'error', message: `${dangling.length} connection${dangling.length === 1 ? ' points' : 's point'} to a step that no longer exists.` })
  const edges = wf.edges.filter((e) => byId.has(e.source) && byId.has(e.target))

  const cycle = findCycle(wf.nodes, edges)
  if (cycle) issues.push({ nodeId: cycle[0], severity: 'error', message: `These steps form a loop: ${cycle.map(label).join(' → ')}. Workflows must not loop.` })

  if (triggers[0]) {
    const reachable = reachableFrom(triggers[0].id, edges)
    for (const n of wf.nodes) {
      if (n.type !== 'trigger' && !reachable.has(n.id)) issues.push({ nodeId: n.id, severity: 'warning', message: `“${n.label}” is not connected to the trigger, so it never runs.` })
    }
  }

  for (const n of wf.nodes) {
    const outgoing = edges.filter((e) => e.source === n.id)
    if (n.type === 'trigger' && n.integrationId) {
      const def = getIntegration(n.integrationId)
      const conn = db.get('connections', n.integrationId)
      if (def && conn?.status !== 'connected') issues.push({ nodeId: n.id, severity: 'warning', message: `Connect ${def.name} so this trigger can fire; manual runs still work.` })
    }
    if (n.type === 'condition') {
      const hasTrue = outgoing.some((e) => (e.sourceHandle ?? 'true') === 'true')
      const hasFalse = outgoing.some((e) => e.sourceHandle === 'false')
      if (!hasTrue && !hasFalse) issues.push({ nodeId: n.id, severity: 'error', message: `“${n.label}” needs a “true” and a “false” branch.` })
      else if (!hasTrue || !hasFalse) issues.push({ nodeId: n.id, severity: 'warning', message: `“${n.label}” has no “${hasTrue ? 'false' : 'true'}” branch; runs that take it stop there.` })
    }
    if (n.type === 'agent') {
      if (!n.agentId) issues.push({ nodeId: n.id, severity: 'error', message: `Choose an agent for “${n.label}”.` })
      else {
        const agent = db.get('agents', n.agentId)
        if (!agent || agent.status === 'archived') issues.push({ nodeId: n.id, severity: 'error', message: `The agent for “${n.label}” is no longer available.` })
        else if (agent.status === 'paused') issues.push({ nodeId: n.id, severity: 'warning', message: `${agent.name} is paused; resume it before relying on this workflow.` })
      }
    }
    if (n.type === 'action') {
      if (!n.integrationId && !n.capability) issues.push({ nodeId: n.id, severity: 'warning', message: `Choose what “${n.label}” should do.` })
      if (n.integrationId) {
        const def = getIntegration(n.integrationId)
        const conn = db.get('connections', n.integrationId)
        if (!def) issues.push({ nodeId: n.id, severity: 'error', message: `“${n.label}” uses an unknown integration.` })
        else if (conn?.status !== 'connected') issues.push({ nodeId: n.id, severity: 'error', message: `Connect ${def.name} in Integrations to run “${n.label}”.` })
        else if (n.capability && !def.capabilities.includes(n.capability)) {
          issues.push({ nodeId: n.id, severity: 'warning', message: `${def.name} cannot ${CAPABILITIES[n.capability].label.toLowerCase()}.` })
        }
      }
    }
  }
  return issues
}

// ---------------------------------------------------------------- runs

/** The run's agent: set when the workflow has exactly one agent step. */
export function soleAgentId(wf: Pick<Workflow, 'nodes'>): ID | undefined {
  const agentNodes = wf.nodes.filter((n) => n.type === 'agent')
  return agentNodes.length === 1 && agentNodes[0].agentId && db.get('agents', agentNodes[0].agentId) ? agentNodes[0].agentId : undefined
}

export interface RunWorkflowInput {
  /** Free-text description of what triggered it ('manual' = started by hand; 'webhook.test' = Send test event). */
  trigger?: string
  origin?: EntityRef
  /** The internal event behind an event trigger (knowledge item, task, run or approval). */
  event?: EntityRef
  /** Who started it (default: you). Automatic triggers start runs as the workflow. */
  initiator?: ActorRef
}

/**
 * Run a workflow now. Works whether or not the workflow is enabled — `enabled` only gates
 * automatic triggers. `trigger` is an optional free-text description of what triggered it.
 */
export function runWorkflow(workflowId: ID, input: RunWorkflowInput = {}): Run {
  const wf = db.get('workflows', workflowId)
  if (!wf) throw new Error('Workflow not found.')
  const run = runEngine.start({
    kind: 'workflow',
    title: wf.name,
    factory: WORKFLOW_FACTORY,
    params: { workflowId, ...(input.trigger ? { trigger: input.trigger } : {}), ...(input.event ? { event: input.event } : {}) },
    workflowId,
    projectId: wf.projectId,
    agentId: soleAgentId(wf),
    origin: input.origin ?? wfRef(workflowId),
    ...(input.initiator ? { initiator: input.initiator } : {}),
  })
  db.update('workflows', workflowId, { lastRunAt: Date.now() })
  return run
}

/** "Send test event" for a webhook trigger: a run with a simulated test payload. */
export function sendTestEvent(workflowId: ID): Run {
  return runWorkflow(workflowId, { trigger: 'webhook.test' })
}

// ---------------------------------------------------------------- stats

export interface WorkflowStats {
  runs: number
  /** Outcomes of the most recent runs, oldest first (for the outcome strip). */
  outcomes: RunStatus[]
  /** Share of finished runs that succeeded (null without finished runs). */
  successRate: number | null
  last?: Run
  /** Runs started per day over the last `days` days, oldest first. */
  perDay: number[]
}

/** Run statistics for one workflow from its runs (newest first or any order). */
export function workflowStats(runs: readonly Run[], opts: { now?: number; days?: number; outcomes?: number } = {}): WorkflowStats {
  const now = opts.now ?? Date.now()
  const days = opts.days ?? 14
  const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt)
  const finished = sorted.filter((r) => r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled')
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const perDay = Array.from({ length: days }, () => 0)
  for (const r of sorted) {
    const dayIndex = days - 1 - Math.floor((startOfToday.getTime() - new Date(r.createdAt).setHours(0, 0, 0, 0)) / 86_400_000)
    if (dayIndex >= 0 && dayIndex < days) perDay[dayIndex]++
  }
  return {
    runs: sorted.length,
    outcomes: sorted.slice(0, opts.outcomes ?? 10).map((r) => r.status).reverse(),
    successRate: finished.length ? finished.filter((r) => r.status === 'succeeded').length / finished.length : null,
    last: sorted[0],
    perDay,
  }
}

// ---------------------------------------------------------------- hooks

export function useWorkflows(filter: { projectId?: ID | null } = {}): Workflow[] {
  return useRows('workflows', (w) => !filter.projectId || w.projectId === filter.projectId, (a, b) => b.updatedAt - a.updatedAt)
}

export function useWorkflow(id: ID | null | undefined): Workflow | undefined {
  return useRow('workflows', id)
}

/** Runs of a workflow, newest first. */
export function useWorkflowRuns(workflowId: ID | null | undefined): Run[] {
  return useRows('runs', (r) => !!workflowId && r.workflowId === workflowId, (a, b) => b.createdAt - a.createdAt)
}

/** Edges leaving a node (handy for canvas editors). */
export function outgoingEdges(wf: Pick<Workflow, 'edges'>, nodeId: ID): WorkflowEdge[] {
  return wf.edges.filter((e) => e.source === nodeId)
}

// ---------------------------------------------------------------- automatic triggers

/** Most automatic runs one workflow may start per minute (guards against event storms). */
const MAX_FIRES_PER_MINUTE = 6

interface TriggerRuntime {
  stop: () => void
}

let runtime: TriggerRuntime | null = null

/** The latest item that would have fired an internal event (Test run uses it as a sample payload). */
export function sampleEventRef(s: Tables, event: string, projectId: ID | null): EntityRef | undefined {
  const inScope = (p: ID | null | undefined) => !projectId || p === projectId
  const newest = <T extends { id: ID }>(rows: T[], at: (r: T) => number) => rows.sort((a, b) => at(b) - at(a))[0]
  switch (event) {
    case 'knowledge.created': {
      const k = newest(Object.values(s.knowledge).filter((k) => !projectId || k.projectIds.includes(projectId)), (k) => k.createdAt)
      return k ? { kind: 'knowledge', id: k.id } : undefined
    }
    case 'task.completed': {
      const t = newest(Object.values(s.tasks).filter((t) => t.status === 'done' && inScope(t.projectId)), (t) => t.completedAt ?? t.updatedAt)
      return t ? { kind: 'task', id: t.id } : undefined
    }
    case 'run.failed': {
      const r = newest(Object.values(s.runs).filter((r) => r.status === 'failed' && inScope(r.projectId)), (r) => r.endedAt ?? r.createdAt)
      return r ? { kind: 'run', id: r.id } : undefined
    }
    case 'approval.resolved': {
      const a = newest(Object.values(s.approvals).filter((a) => a.status === 'approved' || a.status === 'rejected'), (a) => a.resolvedAt ?? a.createdAt)
      return a ? { kind: 'approval', id: a.id } : undefined
    }
  }
  return undefined
}

/**
 * Start the in-app trigger runtime (idempotent): a timer for enabled schedule triggers and a listener
 * for Atrium's internal events. Both work only while Atrium is open — the UI says so. Runs started
 * here carry the workflow as initiator. Returns a stop function.
 */
export function startWorkflowTriggers(opts: { tickMs?: number } = {}): () => void {
  if (runtime) return runtime.stop
  const startedAt = Date.now()
  let lastTick = startedAt
  const fired = new Set<string>()
  const recent = new Map<ID, number[]>()
  /** Runs started by event triggers: their own failures and approvals never trigger again (no loops). */
  const eventRuns = new Set<ID>()

  const allowFire = (id: ID, now: number) => {
    const times = (recent.get(id) ?? []).filter((t) => now - t < 60_000)
    if (times.length >= MAX_FIRES_PER_MINUTE) return false
    recent.set(id, [...times, now])
    return true
  }

  const fire = (wf: Workflow, trigger: string, event?: EntityRef) => {
    const now = Date.now()
    if (!allowFire(wf.id, now)) return
    try {
      const run = runWorkflow(wf.id, { trigger, ...(event ? { event } : {}), initiator: { type: 'workflow', id: wf.id } })
      if (event) eventRuns.add(run.id)
    } catch (error) {
      console.warn(`[workflows] could not start ${wf.id}`, error)
    }
  }

  const tick = () => {
    const now = Date.now()
    for (const wf of db.all('workflows')) {
      if (!wf.enabled || wf.trigger.type !== 'schedule' || !wf.trigger.cron) continue
      const due = nextCronTime(wf.trigger.cron, lastTick - 60_000)
      if (due === undefined || due > now || due < startedAt) continue
      const key = `${wf.id}@${due}`
      if (fired.has(key)) continue
      fired.add(key)
      fire(wf, `Scheduled · ${triggerLabel(wf.trigger)}`)
    }
    lastTick = now
  }
  const timer = setInterval(tick, opts.tickMs ?? 15_000)

  const unsubscribe = useDB.subscribe((s, prev) => {
    if (s === prev) return
    const listeners = Object.values(s.workflows).filter((w) => w.enabled && w.trigger.type === 'event' && isInternalEvent(w.trigger.event))
    if (!listeners.length) return
    const events: { event: string; ref: EntityRef; projectIds: (ID | null)[]; runWorkflowId?: ID; causedByEventRun?: boolean }[] = []
    if (s.knowledge !== prev.knowledge) {
      for (const k of Object.values(s.knowledge)) {
        if (prev.knowledge[k.id] || k.createdAt < startedAt) continue
        // Knowledge written by a workflow run never re-triggers that workflow (or any event-started run's chain).
        const runId = k.source.ref?.kind === 'run' ? k.source.ref.id : undefined
        const byWorkflow = k.author?.type === 'workflow' ? k.author.id : runId ? s.runs[runId]?.workflowId : undefined
        events.push({ event: 'knowledge.created', ref: { kind: 'knowledge', id: k.id }, projectIds: k.projectIds, runWorkflowId: byWorkflow, causedByEventRun: !!runId && eventRuns.has(runId) })
      }
    }
    if (s.tasks !== prev.tasks) {
      for (const t of Object.values(s.tasks)) {
        if (t.status === 'done' && prev.tasks[t.id] && prev.tasks[t.id].status !== 'done' && (t.completedAt ?? t.updatedAt) >= startedAt) {
          events.push({ event: 'task.completed', ref: { kind: 'task', id: t.id }, projectIds: [t.projectId] })
        }
      }
    }
    if (s.runs !== prev.runs) {
      for (const r of Object.values(s.runs)) {
        const before = prev.runs[r.id]
        if (r.status === 'failed' && before && before.status !== 'failed' && (r.endedAt ?? Date.now()) >= startedAt) {
          events.push({ event: 'run.failed', ref: { kind: 'run', id: r.id }, projectIds: [r.projectId], runWorkflowId: r.workflowId, causedByEventRun: eventRuns.has(r.id) })
        }
      }
    }
    if (s.approvals !== prev.approvals) {
      for (const a of Object.values(s.approvals)) {
        const before = prev.approvals[a.id]
        if (before?.status === 'pending' && (a.status === 'approved' || a.status === 'rejected') && (a.resolvedAt ?? Date.now()) >= startedAt) {
          const run = s.runs[a.runId]
          events.push({ event: 'approval.resolved', ref: { kind: 'approval', id: a.id }, projectIds: [run?.projectId ?? null], runWorkflowId: run?.workflowId, causedByEventRun: eventRuns.has(a.runId) })
        }
      }
    }
    if (!events.length) return
    // Fire after this store update finishes (never start runs from inside a state change).
    queueMicrotask(() => {
      for (const e of events) {
        for (const wf of listeners) {
          if (wf.trigger.event !== e.event) continue
          if (e.runWorkflowId === wf.id || e.causedByEventRun) continue
          if (wf.projectId && !e.projectIds.includes(wf.projectId)) continue
          const key = `${wf.id}:${e.ref.kind}:${e.ref.id}:${e.event}`
          if (fired.has(key)) continue
          fired.add(key)
          fire(wf, `Event · ${e.event}`, e.ref)
        }
      }
    })
  })

  runtime = {
    stop: () => {
      clearInterval(timer)
      unsubscribe()
      runtime = null
    },
  }
  return runtime.stop
}
