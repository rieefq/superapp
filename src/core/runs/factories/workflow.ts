import { db, useDB } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { evaluatePermission } from '@/core/permissions/evaluate'
import { createKnowledge } from '@/core/services/knowledge'
import { notify } from '@/core/services/notifications'
import { createTask } from '@/core/services/tasks'
import { sampleEventRef, WORKFLOW_FACTORY } from '@/core/services/workflows'
import { getSettings } from '@/core/settings'
import { configString } from '@/core/sim/params'
import { excerpt, shorten } from '@/core/sim/text'
import {
  agentOutput, delayDuration, evaluateCondition, findCycle, renderTemplate, topologicalOrder, triggerPayload,
  type DigestLine, type FlowContext, type Priority, type TriggerEventSample,
} from '@/core/sim/workflow'
import type { ApprovalPreview, Capability, EntityRef, Priority as TaskPriority, RiskLevel, Run, Workflow, WorkflowEdge, WorkflowNode } from '@/core/types'
import { formatDate, TIME } from '@/lib/format'
import type { Rng } from '@/lib/rng'
import { registerRunFactory } from '../registry'
import { updateStep } from '../service'
import type { RunPlan, StepContext, StepPlan } from '../types'

/**
 * 'workflow.execute' (params { workflowId, trigger?, event? }) — walks the graph from the trigger in
 * topological order, one or more steps per executed node (step.nodeId = node.id):
 * trigger → tool · agent → think + message · action → tool, gated by the permission policy
 * (approval when it asks, a failed step when it denies) · condition → evaluated, only the matching
 * branch continues · transform → tool · approval → an explicit approval that always asks you; it
 * guards the next action with the same capability, which then runs without a second card ·
 * delay → short wait · output → artifact that creates a real knowledge note, task or notification.
 */

function failedPlan(message: string): RunPlan {
  return { steps: [{ kind: 'think', title: 'Check the workflow', durationMs: 400, failChance: 1, failMessage: message }] }
}

const TASK_PRIORITY: Record<Priority, TaskPriority> = { urgent: 'urgent', high: 'high', normal: 'medium', low: 'low' }
const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 }

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

/** Where an action goes, for previews: "#product", "support@…", a folder, a team. */
function destinationOf(node: WorkflowNode): string | undefined {
  return configString(node.config, 'channel', 'to', 'recipient', 'path', 'destination', 'folder', 'team', 'project', 'repo')
}

function previewFor(node: WorkflowNode, ctx: FlowContext): ApprovalPreview {
  const template = configString(node.config, 'message', 'template', 'body', 'text', 'comment')
  const message = template ? renderTemplate(template, ctx) : (ctx.lastOutput ?? node.label)
  const label = destinationOf(node)
  const cap = node.capability
  const kind: ApprovalPreview['kind'] = cap === 'messages.send' ? 'message' : cap === 'shell.execute' ? 'command' : 'text'
  return { kind, content: message, ...(label ? { label } : {}) }
}

function actionResult(node: WorkflowNode, ctx: FlowContext, integrationName: string | undefined): string {
  const where = destinationOf(node)
  const via = integrationName ?? 'the integration'
  switch (node.capability) {
    case 'messages.send':
      return `Message prepared for ${where ?? via}: “${shorten(previewFor(node, ctx).content.replace(/\s+/g, ' '), 140)}”\nSimulated delivery via ${via} — nothing was sent.`
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
      return `Posted on ${via}${where ? ` (${where})` : ''}.\nSimulated — no request was sent to ${via}.`
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

/** Output kind: config.kind (or .type); the demo data's "output: notification|activity" reads as notify. */
function outputKind(node: WorkflowNode): string {
  return configString(node.config, 'kind', 'type') ?? 'notify'
}

/** Create the real artifact for an output node. Idempotent per run (looked up before creating). */
function produceOutput(node: WorkflowNode, wf: Workflow, ctx: FlowContext, step: StepContext): string {
  const run: Run = step.run
  const runRef: EntityRef = { kind: 'run', id: run.id }
  const kind = outputKind(node)
  const title = renderTemplate(outputTitle(node, wf), ctx)
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
    const existing = db.find('tasks', (t) => t.origin?.kind === 'run' && t.origin.id === run.id)
    const configured = configString(node.config, 'priority')
    const priority = (['urgent', 'high', 'medium', 'low', 'none'] as const).find((p) => p === configured) ?? (ctx.priority ? TASK_PRIORITY[ctx.priority] : 'medium')
    const taskTitle = configString(node.config, 'title') ? title : ctx.subject ? shorten(ctx.subject, 90) : title
    const task =
      existing ??
      createTask({
        title: taskTitle,
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

// ---------------------------------------------------------------- approvals

/**
 * The action an approval step guards: the first action downstream (breadth-first, any branch) with
 * the approval's capability, or the first action at all when the approval names none.
 */
export function guardedAction(approval: WorkflowNode, nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): WorkflowNode | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>([approval.id])
  const queue = [approval.id]
  while (queue.length) {
    const id = queue.shift()!
    for (const e of edges) {
      if (e.source !== id || seen.has(e.target)) continue
      seen.add(e.target)
      const n = byId.get(e.target)
      if (!n) continue
      if (n.type === 'approval') continue // the next approval guards what follows it
      if (n.type === 'action' && (!approval.capability || n.capability === approval.capability || !n.capability)) return n
      queue.push(n.id)
    }
  }
  return undefined
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** Plan the explicit approval step for an approval node. It always asks (it is your decision point). */
function approvalStep(node: WorkflowNode, wf: Workflow, run: { agentId?: string }, flow: FlowContext, guarded: WorkflowNode | undefined): StepPlan {
  const capability: Capability = node.capability ?? guarded?.capability ?? 'workflows.run'
  const def = guarded?.integrationId ? getIntegration(guarded.integrationId) : undefined
  const integrationId = guarded && guarded.capability === capability ? guarded.integrationId : undefined
  const catalogRisk = CAPABILITIES[capability]?.risk ?? 'medium'
  let risk: RiskLevel = RISK_ORDER[catalogRisk] >= RISK_ORDER.medium ? catalogRisk : 'medium'
  // An approval step is a human checkpoint: when the policy would let it pass silently, raise its risk so it asks.
  const predict = (r: RiskLevel) => evaluatePermission({ capability, risk: r, agentId: run.agentId, integrationId })
  let decision = predict(risk)
  if (decision.outcome === 'allow' && risk !== 'high') {
    risk = 'high'
    decision = predict(risk)
  }
  const preview: ApprovalPreview = guarded ? previewFor({ ...guarded, capability: guarded.capability ?? capability }, flow) : { kind: 'text', content: flow.lastOutput ?? node.label }
  const configured = configString(node.config, 'instructions', 'description', 'message')
  const via = def ? ` via ${def.name}${def.support === 'simulated' ? ' (simulated)' : ''}` : ''
  const description = configured ?? (guarded ? `Approve to ${lowerFirst(guarded.label)}${via}. Nothing is ${capability === 'messages.send' ? 'sent' : 'done'} until you decide.` : `Review before “${wf.name}” continues.`)
  return {
    nodeId: node.id,
    kind: 'approval',
    title: node.label,
    detail: guarded ? `Guards “${guarded.label}”` : 'Your checkpoint',
    capability,
    ...(integrationId ? { integrationId } : {}),
    approval: { title: guarded ? guarded.label : `Continue “${wf.name}”`, description, risk, preview },
    output: decision.outcome === 'allow' ? `Passed without asking: ${decision.reason}.` : guarded ? `Approved — “${guarded.label}” runs next.` : 'Approved — continuing.',
    durationMs: 400,
  }
}

// ---------------------------------------------------------------- events

/** A real Atrium event as a trigger payload (title and a few facts), read from the database. */
function eventSample(ref: EntityRef, event: string, sample: boolean): TriggerEventSample | undefined {
  switch (ref.kind) {
    case 'knowledge': {
      const k = db.get('knowledge', ref.id)
      return k ? { event, sample, title: `“${k.title}” was added to Knowledge`, lines: [`Kind: ${k.kind}`, ...(k.summary ? [`Summary: ${shorten(k.summary, 160)}`] : [])] } : undefined
    }
    case 'task': {
      const t = db.get('tasks', ref.id)
      const project = t?.projectId ? db.get('projects', t.projectId)?.name : undefined
      return t ? { event, sample, title: `Task “${t.title}” was completed`, lines: project ? [`Project: ${project}`] : [] } : undefined
    }
    case 'run': {
      const r = db.get('runs', ref.id)
      return r ? { event, sample, title: `Run “${r.title}” failed`, lines: r.error ? [`Error: ${shorten(r.error, 200)}`] : [] } : undefined
    }
    case 'approval': {
      const a = db.get('approvals', ref.id)
      return a ? { event, sample, title: `“${a.title}” was ${a.status === 'rejected' ? 'denied' : 'approved'}`, lines: a.resolution?.note ? [`Note: ${a.resolution.note}`] : [] } : undefined
    }
  }
  return undefined
}

const isRef = (v: unknown): v is EntityRef => !!v && typeof v === 'object' && typeof (v as EntityRef).kind === 'string' && typeof (v as EntityRef).id === 'string'

// ---------------------------------------------------------------- plan

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
  const agentNodes = wf.nodes.filter((n) => n.type === 'agent')
  const runAgentId = agentNodes.length === 1 && agentNodes[0].agentId && db.get('agents', agentNodes[0].agentId) ? agentNodes[0].agentId : undefined
  const active = new Set<string>([trigger.id])
  /** Actions whose decision you make at an approval step (no second card). */
  const covered = new Map<string, string>()
  const flow: FlowContext = {}
  const steps: StepPlan[] = []
  const executed: string[] = []
  const branches: string[] = []

  // The event behind an event trigger: the one that fired it, or (by hand) the latest matching item.
  const eventId = wf.trigger.event ?? configString(trigger.config, 'event')
  let event: TriggerEventSample | undefined
  if (wf.trigger.type === 'event' && eventId) {
    const fired = isRef(params.event) ? params.event : undefined
    const ref = fired ?? sampleEventRef(useDB.getState(), eventId, wf.projectId)
    if (ref) event = eventSample(ref, eventId, !fired)
  }

  for (const nodeId of order) {
    if (!active.has(nodeId)) continue
    const node = byId.get(nodeId)!
    executed.push(nodeId)
    let branch: 'true' | 'false' | undefined
    const base = { nodeId: node.id }

    switch (node.type) {
      case 'trigger': {
        const payload = triggerPayload(wf.trigger, node, rng, { override, userName: getSettings().profile.name, event, webhookTest: override === 'webhook.test' })
        Object.assign(flow, payload.context)
        const scheduled = wf.trigger.type === 'schedule' && (!override || override === 'manual')
        steps.push({
          ...base,
          kind: 'tool',
          title: payload.title ?? (scheduled ? `Scheduled run · ${wf.trigger.label}` : `Triggered by ${node.label || wf.trigger.label}`),
          detail: scheduled ? `Started now; normally ${wf.trigger.label.toLowerCase().startsWith('every') ? lowerFirst(wf.trigger.label) : wf.trigger.label} — runs only while Atrium is open` : payload.detail,
          tool: 'trigger',
          integrationId: node.integrationId,
          output: payload.output,
          durationMs: rng.int(500, 900),
          tokens: rng.int(50, 200),
        })
        if (!flow.lastOutput) flow.lastOutput = payload.output
        break
      }
      case 'agent': {
        const agent = node.agentId ? db.get('agents', node.agentId) : undefined
        if (!agent || agent.status === 'archived') {
          steps.push({ ...base, kind: 'think', title: node.label, durationMs: 500, failChance: 1, failMessage: `“${node.label}” has no available agent. Choose one in the step settings and run again.` })
          break
        }
        const result = agentOutput({ agent: { name: agent.name, role: agent.role }, node, ctx: flow, rng, digest: digestData(wf) })
        Object.assign(flow, result.context)
        flow.lastOutput = result.message
        const refs: EntityRef[] = [{ kind: 'agent', id: agent.id }]
        steps.push(
          { ...base, kind: 'think', title: `Plan “${node.label}”`, detail: `${agent.name} · ${agent.role}`, output: result.thinking, refs, durationMs: rng.int(1200, 2400), tokens: rng.int(600, 1400) },
          { ...base, kind: 'message', title: node.label, detail: `${agent.name} · ${agent.role}`, output: result.message, refs, durationMs: rng.int(1600, 3200), tokens: rng.int(500, 1500) },
        )
        break
      }
      case 'action': {
        const def = getIntegration(node.integrationId)
        const conn = node.integrationId ? db.get('connections', node.integrationId) : undefined
        const capability = node.capability ?? def?.capabilities[0]
        const risk = capability ? CAPABILITIES[capability].risk : 'low'
        const acting = { ...node, capability }
        const preview = previewFor(acting, flow)
        const notConnected = !!node.integrationId && conn?.status !== 'connected'
        const approvedAt = covered.get(node.id)
        const via = def ? `${def.name}${def.support === 'simulated' ? ' (simulated)' : ''}` : undefined
        steps.push({
          ...base,
          kind: capability === 'messages.send' ? 'message' : 'tool',
          title: node.label,
          detail: approvedAt ? `${via ? `${via} · ` : ''}approved at “${approvedAt}”` : via,
          tool: def?.name ?? 'action',
          integrationId: node.integrationId,
          capability,
          input: preview.content,
          output: actionResult(acting, flow, def?.name),
          ...(notConnected
            ? { failChance: 1, failMessage: `${def?.name ?? node.integrationId} is not connected. Connect it in Integrations and run again.` }
            : approvedAt || !capability
              ? {}
              : { approval: { title: node.label, description: `${def?.name ?? 'This step'} will ${CAPABILITIES[capability].label.toLowerCase()}${def?.support === 'simulated' ? ' (simulated)' : ''}.`, risk, preview } }),
          durationMs: rng.int(1200, 2400),
          tokens: rng.int(150, 500),
        })
        if (capability === 'messages.send' || capability === 'tasks.manage') flow.lastOutput = flow.lastOutput ?? preview.content
        break
      }
      case 'condition': {
        const result = evaluateCondition(node, flow, rng)
        branch = result.branch
        const word = branch === 'true' ? 'Yes' : 'No'
        branches.push(`${node.label} ${word.toLowerCase()}`)
        const expression = configString(node.config, 'expression', 'condition', 'rule')
        steps.push({ ...base, kind: 'think', title: `Check “${node.label}”`, detail: `Branch: ${branch} — ${result.reason}`, input: expression, output: `${expression ?? node.label} → ${word.toLowerCase()} (${result.reason})`, durationMs: rng.int(500, 900), tokens: rng.int(80, 240) })
        break
      }
      case 'transform': {
        const how = configString(node.config, 'operation', 'template', 'expression', 'format', 'lookup') ?? 'format the previous output'
        const def = getIntegration(node.integrationId)
        const conn = node.integrationId ? db.get('connections', node.integrationId) : undefined
        if (def && conn?.status !== 'connected') {
          steps.push({ ...base, kind: 'read', title: node.label, tool: def.name, integrationId: node.integrationId, durationMs: 700, failChance: 1, failMessage: `${def.name} is not connected. Connect it in Integrations and run again.` })
          break
        }
        const text = flow.lastOutput ?? ''
        const transformed = /slack|chat|message/i.test(how) ? `*${wf.name}*\n${text}` : /short|summary|summar/i.test(how) ? excerpt(text, 240) : text
        flow.lastOutput = transformed
        steps.push({
          ...base,
          kind: def ? 'read' : 'tool',
          title: node.label,
          detail: def ? `${def.name}${def.support === 'simulated' ? ' (simulated)' : ''} · read only` : undefined,
          tool: def?.name ?? 'transform',
          integrationId: node.integrationId,
          input: how,
          output: transformed ? shorten(transformed, 600) : 'Nothing to transform.',
          durationMs: rng.int(600, 1200),
          tokens: rng.int(100, 400),
        })
        break
      }
      case 'approval': {
        const guarded = guardedAction(node, wf.nodes, edges)
        if (guarded) covered.set(guarded.id, node.label)
        steps.push(approvalStep(node, wf, { agentId: runAgentId }, flow, guarded))
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
          detail: { knowledge: 'Save to Knowledge', task: 'Create a task', none: 'No output' }[outputKind(node)] ?? 'Notify you in Atrium',
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
