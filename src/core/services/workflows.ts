import { db, ID_PREFIX, useRow, useRows } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { runEngine } from '@/core/runs/engine'
import { findCycle, reachableFrom } from '@/core/sim/workflow'
import {
  HUES, ME, isRunActive,
  type EntityRef, type Hue, type ID, type Run, type Workflow, type WorkflowEdge, type WorkflowNode, type WorkflowTrigger,
} from '@/core/types'
import { newId } from '@/lib/id'
import { hashString } from '@/lib/rng'
import { logActivity } from './activity'
import { forgetRef } from './serviceHelpers'

/**
 * Workflows: node graphs executed as 'workflow.execute' runs (src/core/runs/factories/workflow.ts).
 * Enabling a workflow only matters for automatic triggers (schedule, event, webhook); a disabled
 * workflow can still be run manually with `runWorkflow`.
 */

export const WORKFLOW_FACTORY = 'workflow.execute'

const wfRef = (id: ID): EntityRef => ({ kind: 'workflow', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

function hueFor(name: string): Hue {
  return HUES[hashString(name) % HUES.length]
}

export interface CreateWorkflowInput {
  name: string
  description?: string
  projectId?: ID | null
  trigger?: WorkflowTrigger
}

/** Create a workflow with a trigger connected to an output step ("Notify me"). */
export function createWorkflow(input: CreateWorkflowInput): Workflow {
  const name = input.name.trim() || 'Untitled workflow'
  const trigger: WorkflowTrigger = input.trigger ?? { type: 'manual', label: 'Manual run' }
  const now = Date.now()
  const triggerNode: WorkflowNode = {
    id: newId('nod'),
    type: 'trigger',
    label: trigger.label,
    position: { x: 80, y: 160 },
    config: { type: trigger.type, ...(trigger.cron ? { cron: trigger.cron } : {}), ...(trigger.event ? { event: trigger.event } : {}) },
    ...(trigger.integrationId ? { integrationId: trigger.integrationId } : {}),
  }
  const outputNode: WorkflowNode = { id: newId('nod'), type: 'output', label: 'Notify me', position: { x: 420, y: 160 }, config: { kind: 'notify' } }
  const wf: Workflow = {
    id: newId(ID_PREFIX.workflows),
    name,
    description: input.description?.trim() ?? '',
    projectId: input.projectId ?? null,
    hue: hueFor(name),
    trigger,
    nodes: [triggerNode, outputNode],
    edges: [{ id: newId('edg'), source: triggerNode.id, target: outputNode.id }],
    enabled: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  }
  db.insert('workflows', wf)
  logActivity({ actor: ME, verb: 'created', target: wfRef(wf.id), summary: `Created workflow ${quoted(name)}`, projectId: wf.projectId })
  return wf
}

export type WorkflowPatch = Partial<Pick<Workflow, 'name' | 'description' | 'projectId' | 'hue' | 'trigger' | 'nodes' | 'edges'>>

/** Update a workflow. Changing the graph (nodes or edges) bumps `version`. */
export function updateWorkflow(id: ID, patch: WorkflowPatch): Workflow | undefined {
  const cur = db.get('workflows', id)
  if (!cur) return undefined
  const graphChanged =
    (patch.nodes !== undefined && JSON.stringify(patch.nodes) !== JSON.stringify(cur.nodes)) ||
    (patch.edges !== undefined && JSON.stringify(patch.edges) !== JSON.stringify(cur.edges))
  const fields = (Object.keys(patch) as Array<keyof WorkflowPatch>).filter((k) => JSON.stringify(patch[k]) !== JSON.stringify(cur[k]))
  if (!fields.length) return cur
  const next = db.update('workflows', id, {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() || cur.name } : {}),
    version: graphChanged ? cur.version + 1 : cur.version,
    updatedAt: Date.now(),
  })
  logActivity({
    actor: ME,
    verb: 'updated',
    target: wfRef(id),
    summary: graphChanged ? `Edited the steps of ${quoted(cur.name)} (v${cur.version + 1})` : `Updated ${fields.join(', ')} of ${quoted(cur.name)}`,
    projectId: cur.projectId,
    meta: { fields },
  })
  return next
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
  logActivity({ actor: ME, verb: 'deleted', target: wfRef(id), summary: `Deleted workflow ${quoted(cur.name)}`, projectId: cur.projectId })
}

/** Enable or disable automatic triggering. Disabled workflows can still be run manually. */
export function setWorkflowEnabled(id: ID, enabled: boolean): Workflow | undefined {
  const cur = db.get('workflows', id)
  if (!cur || cur.enabled === enabled) return cur
  const next = db.update('workflows', id, { enabled, updatedAt: Date.now() })
  logActivity({ actor: ME, verb: enabled ? 'enabled' : 'disabled', target: wfRef(id), summary: `${enabled ? 'Enabled' : 'Disabled'} workflow ${quoted(cur.name)}`, projectId: cur.projectId })
  return next
}

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
function soleAgentId(wf: Workflow): ID | undefined {
  const agentNodes = wf.nodes.filter((n) => n.type === 'agent')
  return agentNodes.length === 1 && agentNodes[0].agentId && db.get('agents', agentNodes[0].agentId) ? agentNodes[0].agentId : undefined
}

/**
 * Run a workflow now. Works whether or not the workflow is enabled — `enabled` only gates
 * automatic triggers. `trigger` is an optional free-text description of what triggered it.
 */
export function runWorkflow(workflowId: ID, input: { trigger?: string; origin?: EntityRef } = {}): Run {
  const wf = db.get('workflows', workflowId)
  if (!wf) throw new Error('Workflow not found.')
  const run = runEngine.start({
    kind: 'workflow',
    title: wf.name,
    factory: WORKFLOW_FACTORY,
    params: { workflowId, ...(input.trigger ? { trigger: input.trigger } : {}) },
    workflowId,
    projectId: wf.projectId,
    agentId: soleAgentId(wf),
    origin: input.origin ?? wfRef(workflowId),
  })
  db.update('workflows', workflowId, { lastRunAt: Date.now() })
  return run
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
