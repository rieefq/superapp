import { db } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { createKnowledge } from '@/core/services/knowledge'
import { notify } from '@/core/services/notifications'
import { createTask } from '@/core/services/tasks'
import { WORKFLOW_FACTORY } from '@/core/services/workflows'
import { getSettings } from '@/core/settings'
import { configString } from '@/core/sim/params'
import { excerpt, shorten } from '@/core/sim/text'
import {
  agentOutput, delayDuration, evaluateCondition, findCycle, topologicalOrder, triggerPayload, type DigestLine, type FlowContext, type Priority,
} from '@/core/sim/workflow'
import type { ApprovalPreview, EntityRef, Priority as TaskPriority, Run, Workflow, WorkflowNode } from '@/core/types'
import { formatDate, TIME } from '@/lib/format'
import type { Rng } from '@/lib/rng'
import { registerRunFactory } from '../registry'
import { updateStep } from '../service'
import type { RunPlan, StepContext, StepPlan } from '../types'

/**
 * 'workflow.execute' (params { workflowId, trigger? }) — walks the graph from the trigger in
 * topological order, one or more steps per executed node (step.nodeId = node.id):
 * trigger → tool · agent → think + message · action → tool (approval-gated for medium/high risk)
 * · condition → evaluated, only the matching branch continues · transform → tool · approval →
 * explicit approval · delay → short wait · output → artifact that creates a real knowledge note,
 * task or notification.
 */

function failedPlan(message: string): RunPlan {
  return { steps: [{ kind: 'think', title: 'Check the workflow', durationMs: 400, failChance: 1, failMessage: message }] }
}

const TASK_PRIORITY: Record<Priority, TaskPriority> = { urgent: 'urgent', high: 'high', normal: 'medium', low: 'low' }

function digestData(wf: Workflow): { lines: DigestLine[]; pendingApprovals: number; dateLabel: string } {
  const now = Date.now()
  const weekAgo = now - 7 * TIME.DAY
  const projects = db.filter('projects', (p) => p.status === 'active' && (!wf.projectId || p.id === wf.projectId))
  const lines = projects
    .map((p): DigestLine => {
      const tasks = db.filter('tasks', (t) => t.projectId === p.id)
      const nextDue = tasks.filter((t) => t.dueAt && t.status !== 'done' && t.status !== 'cancelled').sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))[0]
      return {
        project: p.name,
        done: tasks.filter((t) => t.status === 'done' && (t.completedAt ?? t.updatedAt) >= weekAgo).length,
        inProgress: tasks.filter((t) => t.status === 'in_progress').length,
        nextDue: nextDue?.title,
      }
    })
    .slice(0, 6)
  return { lines, pendingApprovals: db.filter('approvals', (a) => a.status === 'pending').length, dateLabel: formatDate(now, { weekday: 'long', month: 'short', day: 'numeric' }) }
}

function previewFor(node: WorkflowNode, ctx: FlowContext): ApprovalPreview {
  const message = configString(node.config, 'message', 'template', 'body', 'text') ?? ctx.lastOutput ?? node.label
  const label = configString(node.config, 'channel', 'to', 'recipient', 'path', 'destination')
  const cap = node.capability
  const kind: ApprovalPreview['kind'] = cap === 'messages.send' ? 'message' : cap === 'shell.execute' ? 'command' : 'text'
  return { kind, content: message, ...(label ? { label } : {}) }
}

function actionResult(node: WorkflowNode, ctx: FlowContext, integrationName: string | undefined): string {
  const where = configString(node.config, 'channel', 'to', 'recipient', 'path', 'destination', 'project')
  const via = integrationName ?? 'the integration'
  switch (node.capability) {
    case 'messages.send':
      return `Message prepared for ${where ?? via}: “${shorten((ctx.lastOutput ?? node.label).replace(/\s+/g, ' '), 140)}”\nSimulated delivery via ${via} — nothing was sent.`
    case 'tasks.manage':
      return `Issue “${shorten(ctx.subject ?? node.label, 80)}” filed in ${via}${where ? ` (${where})` : ''}.\nSimulated — no request was sent to ${via}.`
    case 'files.write':
      return `Uploaded ${configString(node.config, 'file', 'name') ?? 'the output'} to ${where ?? via}.\nSimulated — no file was written.`
    case 'knowledge.write':
      return `Synced the output to ${via}.\nSimulated — nothing left Atrium.`
    case 'calendar.manage':
      return `Scheduled “${shorten(ctx.subject ?? node.label, 80)}” on ${via}.\nSimulated — no event was created.`
    case 'data.query':
      return `Ran a read-only query on ${via}${where ? ` (${where})` : ''}.\nSimulated — no database was queried.`
    case 'repo.pull_request':
    case 'repo.write':
      return `Posted the review on ${via}.\nSimulated — no request was sent to ${via}.`
    case 'web.search':
    case 'web.browse':
      return `Collected results from ${via}.\nSimulated — results come from a local corpus.`
    default:
      return `Completed “${node.label}” via ${via}.\nSimulated action.`
  }
}

function outputTitle(node: WorkflowNode, wf: Workflow): string {
  return configString(node.config, 'title', 'name') ?? `${wf.name} — ${formatDate(Date.now(), { month: 'short', day: 'numeric' })}`
}

/** Create the real artifact for an output node. Idempotent per run (looked up before creating). */
function produceOutput(node: WorkflowNode, wf: Workflow, ctx: FlowContext, step: StepContext): string {
  const run: Run = step.run
  const runRef: EntityRef = { kind: 'run', id: run.id }
  const kind = configString(node.config, 'kind', 'type') ?? 'notify'
  const title = outputTitle(node, wf)
  const body = ctx.lastOutput ?? `Workflow “${wf.name}” finished.`
  if (kind === 'knowledge') {
    const existing = db.find('knowledge', (k) => k.source.ref?.kind === 'run' && k.source.ref.id === run.id && k.title === title)
    const collectionId = configString(node.config, 'collectionId')
    const item =
      existing ??
      createKnowledge({
        title,
        content: `${body}\n\n---\n_Produced by the workflow “${wf.name}” (simulated run)._`,
        kind: 'note',
        collectionId: collectionId && db.get('collections', collectionId) ? collectionId : null,
        projectIds: wf.projectId ? [wf.projectId] : [],
        tags: ['workflow'],
        source: { type: 'agent', ref: runRef },
        author: { type: 'workflow', id: wf.id },
        simulated: true,
      })
    step.addOutput({ kind: 'knowledge', id: item.id })
    return `Saved “${item.title}” to Knowledge.`
  }
  if (kind === 'task') {
    const existing = db.find('tasks', (t) => t.origin?.kind === 'run' && t.origin.id === run.id && t.title === title)
    const configured = configString(node.config, 'priority')
    const priority = (['urgent', 'high', 'medium', 'low', 'none'] as const).find((p) => p === configured) ?? (ctx.priority ? TASK_PRIORITY[ctx.priority] : 'medium')
    const task =
      existing ??
      createTask({
        title: configString(node.config, 'title') ?? (ctx.subject ? shorten(ctx.subject, 90) : title),
        projectId: wf.projectId,
        description: `${body}\n\n_Created by the workflow “${wf.name}” (simulated run)._`,
        priority,
        labels: ['workflow'],
        origin: runRef,
        actor: { type: 'workflow', id: wf.id },
      })
    step.addOutput({ kind: 'task', id: task.id })
    return `Created task “${task.title}” (${task.priority} priority).`
  }
  if (kind === 'none') return 'Finished — no output configured.'
  const already = db.find('notifications', (n) => n.ref?.kind === 'workflow' && n.ref.id === wf.id && n.title === title && n.createdAt >= run.createdAt)
  if (!already) notify({ kind: 'system', title, body: excerpt(body, 220), ref: { kind: 'workflow', id: wf.id }, tone: 'info' })
  return `Sent an in-app notification: “${title}”.`
}

export function planWorkflow(params: Record<string, unknown>, rng: Rng): RunPlan {
  const workflowId = typeof params.workflowId === 'string' ? params.workflowId : undefined
  const override = typeof params.trigger === 'string' ? params.trigger : undefined
  const wf = workflowId ? db.get('workflows', workflowId) : undefined
  if (!wf) return failedPlan('This workflow no longer exists.')
  const trigger = wf.nodes.find((n) => n.type === 'trigger')
  if (!trigger) return failedPlan('This workflow has no trigger.')
  const ids = new Set(wf.nodes.map((n) => n.id))
  const edges = wf.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  if (findCycle(wf.nodes, edges)) return failedPlan('This workflow contains a loop. Remove it and run again.')

  const byId = new Map(wf.nodes.map((n) => [n.id, n]))
  const { order } = topologicalOrder(wf.nodes, edges)
  const active = new Set<string>([trigger.id])
  const flow: FlowContext = {}
  const steps: StepPlan[] = []
  const executed: string[] = []
  const branches: string[] = []

  for (const nodeId of order) {
    if (!active.has(nodeId)) continue
    const node = byId.get(nodeId)!
    executed.push(nodeId)
    let branch: 'true' | 'false' | undefined
    const base = { nodeId: node.id }

    switch (node.type) {
      case 'trigger': {
        const payload = triggerPayload(wf.trigger, node, rng, { override, userName: getSettings().profile.name })
        Object.assign(flow, payload.context)
        steps.push({ ...base, kind: 'tool', title: `Triggered by ${node.label || wf.trigger.label}`, detail: payload.detail, tool: 'trigger', integrationId: node.integrationId, output: payload.output, durationMs: rng.int(500, 900), tokens: rng.int(50, 200) })
        if (!flow.lastOutput) flow.lastOutput = payload.output
        break
      }
      case 'agent': {
        const agent = node.agentId ? db.get('agents', node.agentId) : undefined
        if (!agent) {
          steps.push({ ...base, kind: 'think', title: node.label, durationMs: 500, failChance: 1, failMessage: `“${node.label}” has no available agent.` })
          break
        }
        const result = agentOutput({ agent: { name: agent.name, role: agent.role }, node, ctx: flow, rng, digest: digestData(wf) })
        Object.assign(flow, result.context)
        flow.lastOutput = result.message
        const refs: EntityRef[] = [{ kind: 'agent', id: agent.id }]
        steps.push(
          { ...base, kind: 'think', title: `${agent.name} reads the input`, detail: node.label, output: result.thinking, refs, durationMs: rng.int(1200, 2400), tokens: rng.int(600, 1400) },
          { ...base, kind: 'message', title: node.label, detail: `${agent.name} · ${agent.role}`, output: result.message, refs, durationMs: rng.int(1600, 3200), tokens: rng.int(500, 1500) },
        )
        break
      }
      case 'action': {
        const def = getIntegration(node.integrationId)
        const conn = node.integrationId ? db.get('connections', node.integrationId) : undefined
        const capability = node.capability ?? def?.capabilities[0]
        const risk = capability ? CAPABILITIES[capability].risk : 'low'
        const preview = previewFor({ ...node, capability }, flow)
        const notConnected = !!node.integrationId && conn?.status !== 'connected'
        const gated = risk !== 'low'
        steps.push({
          ...base,
          kind: 'tool',
          title: node.label,
          detail: def ? `${def.name}${def.support === 'simulated' ? ' (simulated)' : ''}` : undefined,
          tool: def?.name ?? 'action',
          integrationId: node.integrationId,
          capability,
          input: preview.content,
          output: actionResult({ ...node, capability }, flow, def?.name),
          ...(gated
            ? { approval: { title: node.label, description: `${def?.name ?? 'This action'} will ${capability ? CAPABILITIES[capability].label.toLowerCase() : 'run'} (simulated).`, risk, preview } }
            : notConnected
              ? { failChance: 1, failMessage: `${def?.name ?? node.integrationId} is not connected. Connect it in Integrations and run again.` }
              : {}),
          durationMs: rng.int(1200, 2400),
          tokens: rng.int(150, 500),
        })
        break
      }
      case 'condition': {
        const result = evaluateCondition(node, flow, rng)
        branch = result.branch
        branches.push(`${node.label}: ${branch}`)
        const expression = configString(node.config, 'expression', 'condition', 'rule')
        steps.push({ ...base, kind: 'think', title: `Check: ${node.label}`, detail: `Branch: ${branch} — ${result.reason}`, input: expression, output: `${expression ?? node.label} → ${branch} (${result.reason})`, durationMs: rng.int(500, 900), tokens: rng.int(80, 240) })
        break
      }
      case 'transform': {
        const how = configString(node.config, 'operation', 'template', 'expression', 'format') ?? 'format the previous output'
        const text = flow.lastOutput ?? ''
        const transformed = /slack|chat|message/i.test(how) ? `*${wf.name}*\n${text}` : /short|summary|summar/i.test(how) ? excerpt(text, 240) : text
        flow.lastOutput = transformed
        steps.push({ ...base, kind: 'tool', title: node.label, tool: 'transform', input: how, output: transformed ? shorten(transformed, 600) : 'Nothing to transform.', durationMs: rng.int(600, 1200), tokens: rng.int(100, 400) })
        break
      }
      case 'approval': {
        const preview: ApprovalPreview = { kind: 'message', content: configString(node.config, 'message', 'preview') ?? flow.lastOutput ?? node.label, ...(configString(node.config, 'label', 'channel') ? { label: configString(node.config, 'label', 'channel') } : {}) }
        steps.push({
          ...base,
          kind: 'approval',
          title: node.label,
          capability: 'workflows.run',
          approval: { title: node.label, description: configString(node.config, 'instructions', 'description') ?? 'Review before the workflow continues.', risk: 'medium', preview },
          output: 'Approved — continuing.',
          durationMs: rng.int(300, 600),
        })
        break
      }
      case 'delay': {
        const d = delayDuration(node)
        steps.push({ ...base, kind: 'wait', title: node.label || `Wait ${d.label}`, detail: `Waits ${d.label} in production; shortened for this simulated run`, durationMs: d.simulatedMs })
        break
      }
      case 'output': {
        const snapshot: FlowContext = { ...flow }
        steps.push({
          ...base,
          kind: 'artifact',
          title: node.label,
          detail: configString(node.config, 'kind', 'type') ?? 'notify',
          output: 'Saving the result…',
          durationMs: rng.int(900, 1600),
          tokens: rng.int(100, 300),
          onComplete: (ctx) => {
            const current = db.get('workflows', wf.id) ?? wf
            const message = produceOutput(node, current, snapshot, ctx)
            updateStep(ctx.run.id, ctx.step.id, { output: message })
          },
        })
        break
      }
    }

    for (const e of edges) {
      if (e.source !== nodeId) continue
      if (node.type === 'condition' && (e.sourceHandle ?? 'true') !== branch) continue
      active.add(e.target)
    }
  }

  const skipped = wf.nodes.length - executed.length
  return {
    steps,
    summary: `Ran ${executed.length} of ${wf.nodes.length} steps${branches.length ? ` (${branches.join('; ')})` : ''}${skipped ? `; ${skipped} not on the taken path` : ''}. Simulated run.`,
  }
}

export function registerWorkflowFactories(): void {
  registerRunFactory(WORKFLOW_FACTORY, planWorkflow)
}

