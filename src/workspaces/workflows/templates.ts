import { CalendarClock, FileSearch, Inbox, Plus, Siren, type LucideIcon } from 'lucide-react'
import { pickAgentForInstruction } from '@/core/assist'
import { buildTrigger, triggerNodeConfig, type TriggerPatch } from '@/core/services/workflows'
import type { Agent, ID, IntegrationConnection, Run, WorkflowEdge, WorkflowNode, WorkflowTrigger } from '@/core/types'

/**
 * Workflow templates (docs/DESIGN.md §6.6 empty state: Weekly digest, Triage new tickets, Research when
 * a doc is added, plus Blank). Each builds a graph with placeholder ids and zero positions; the service
 * re-keys it and lays it out top to bottom. Agents are picked from the workspace by role (rules, not AI).
 */

export interface TemplateContext {
  agents: readonly Agent[]
  connections: readonly IntegrationConnection[]
  runs?: readonly Run[]
}

export interface TemplateGraph {
  name: string
  description: string
  trigger: WorkflowTrigger
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowTemplate {
  id: string
  name: string
  /** One sentence: what it does. */
  blurb: string
  /** The steps, as a short path: "Schedule → Agent → Approval → Slack → Knowledge". */
  path: string[]
  icon: LucideIcon
  /** True when the steps touch simulated services (shown as SIM on the card). */
  simulated: boolean
  build: (ctx: TemplateContext) => TemplateGraph
}

const at = { x: 0, y: 0 }

function agentFor(ctx: TemplateContext, role: RegExp, instruction: string): ID | undefined {
  const active = ctx.agents.filter((a) => a.status === 'active')
  const byRole = active.find((a) => role.test(a.role) || role.test(a.name))
  if (byRole) return byRole.id
  return pickAgentForInstruction(instruction, active, { runs: ctx.runs })?.agentId
}

function slackChannel(ctx: TemplateContext, fallback: string): string {
  return ctx.connections.find((c) => c.id === 'slack')?.config.defaultChannel ?? fallback
}

function triggerNode(id: string, patch: TriggerPatch): { node: WorkflowNode; trigger: WorkflowTrigger } {
  const trigger = buildTrigger(patch)
  return {
    trigger,
    node: { id, type: 'trigger', label: trigger.label, position: at, config: triggerNodeConfig(trigger), ...(trigger.integrationId ? { integrationId: trigger.integrationId } : {}) },
  }
}

const edge = (id: string, source: string, target: string, handle?: 'true' | 'false'): WorkflowEdge =>
  handle ? { id, source, target, sourceHandle: handle, label: handle === 'true' ? 'Yes' : 'No' } : { id, source, target }

export const TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: 'weekly-digest',
    name: 'Weekly digest',
    blurb: 'Every Monday an agent summarizes the week; you review it before it is posted and saved.',
    path: ['Schedule', 'Agent', 'Approval', 'Slack', 'Knowledge'],
    icon: CalendarClock,
    simulated: true,
    build: (ctx) => {
      const prompt = 'Write the weekly digest: decisions needed first, then one short section per active project with owners and links. Under 250 words.'
      const t = triggerNode('t', { type: 'schedule', cron: '0 9 * * 1' })
      const channel = slackChannel(ctx, '#general')
      const agentId = agentFor(ctx, /communicat|herald|writer/i, prompt)
      const nodes: WorkflowNode[] = [
        t.node,
        { id: 'collect', type: 'transform', label: 'Collect last week’s activity', position: at, capability: 'tasks.manage', config: { window: '7d', include: ['tasks', 'runs', 'knowledge'], readOnly: true } },
        { id: 'write', type: 'agent', label: 'Write the digest', position: at, capability: 'knowledge.read', ...(agentId ? { agentId } : {}), config: { prompt } },
        { id: 'review', type: 'approval', label: 'Review before posting', position: at, capability: 'messages.send', config: {} },
        { id: 'post', type: 'action', label: `Post to ${channel}`, position: at, integrationId: 'slack', capability: 'messages.send', config: { channel } },
        { id: 'save', type: 'output', label: 'Save the digest to Knowledge', position: at, config: { kind: 'knowledge', title: 'Weekly digest' } },
      ]
      return {
        name: 'Weekly digest',
        description: 'Every Monday at 09:00 an agent writes the week’s digest; you review it before it is posted to Slack and saved to Knowledge.',
        trigger: t.trigger,
        nodes,
        edges: [edge('e1', 't', 'collect'), edge('e2', 'collect', 'write'), edge('e3', 'write', 'review'), edge('e4', 'review', 'post'), edge('e5', 'post', 'save')],
      }
    },
  },
  {
    id: 'triage-tickets',
    name: 'Triage new tickets',
    blurb: 'Each new ticket is classified; urgent ones alert a channel, the rest become tasks.',
    path: ['Event', 'Agent', 'Condition', 'Slack · Task'],
    icon: Inbox,
    simulated: true,
    build: (ctx) => {
      const prompt = 'Triage and classify the ticket: priority (urgent, high, normal, low), category and a two-sentence summary quoting the reporter.'
      const t = triggerNode('t', { type: 'event', event: 'linear.issue.created' })
      const agentId = agentFor(ctx, /triage|support|sentinel/i, prompt)
      const nodes: WorkflowNode[] = [
        t.node,
        { id: 'classify', type: 'agent', label: 'Classify the ticket', position: at, capability: 'knowledge.read', ...(agentId ? { agentId } : {}), config: { prompt } },
        { id: 'urgent', type: 'condition', label: 'Urgent?', position: at, config: { expression: 'priority is urgent' } },
        { id: 'alert', type: 'action', label: 'Alert #support-urgent', position: at, integrationId: 'slack', capability: 'messages.send', config: { channel: '#support-urgent', message: 'Urgent: {{subject}} — {{summary}}' } },
        { id: 'task', type: 'output', label: 'Create a follow-up task', position: at, config: { kind: 'task' } },
      ]
      return {
        name: 'Triage new tickets',
        description: 'When a Linear issue is created, an agent classifies it; urgent issues alert #support-urgent, everything else becomes a follow-up task.',
        trigger: t.trigger,
        nodes,
        edges: [edge('e1', 't', 'classify'), edge('e2', 'classify', 'urgent'), edge('e3', 'urgent', 'alert', 'true'), edge('e4', 'urgent', 'task', 'false')],
      }
    },
  },
  {
    id: 'research-on-doc',
    name: 'Research when a doc is added',
    blurb: 'When something lands in Knowledge, an agent finds related reading and saves it next to it.',
    path: ['Knowledge event', 'Agent', 'Knowledge'],
    icon: FileSearch,
    simulated: true,
    build: (ctx) => {
      const prompt = 'Research related sources for the new document and summarize what is new compared with it. Cite every source.'
      const t = triggerNode('t', { type: 'event', event: 'knowledge.created' })
      const agentId = agentFor(ctx, /research|analyst|scout/i, prompt)
      const nodes: WorkflowNode[] = [
        t.node,
        { id: 'research', type: 'agent', label: 'Research related sources', position: at, capability: 'web.search', ...(agentId ? { agentId } : {}), config: { prompt } },
        { id: 'save', type: 'output', label: 'Save related reading', position: at, config: { kind: 'knowledge', title: 'Related reading — {{subject}}' } },
      ]
      return {
        name: 'Research when a doc is added',
        description: 'When knowledge is added, an agent researches related sources and saves a reading list to Knowledge.',
        trigger: t.trigger,
        nodes,
        edges: [edge('e1', 't', 'research'), edge('e2', 'research', 'save')],
      }
    },
  },
  {
    id: 'run-failed-alert',
    name: 'Tell me when a run fails',
    blurb: 'Any failed run is summarized into a task, so nothing breaks quietly.',
    path: ['Run event', 'Transform', 'Task'],
    icon: Siren,
    simulated: false,
    build: () => {
      const t = triggerNode('t', { type: 'event', event: 'run.failed' })
      const nodes: WorkflowNode[] = [
        t.node,
        { id: 'shorten', type: 'transform', label: 'Summarize the failure', position: at, config: { operation: 'Shorten to a summary' } },
        { id: 'task', type: 'output', label: 'Create a task to look into it', position: at, config: { kind: 'task', priority: 'high' } },
      ]
      return {
        name: 'Tell me when a run fails',
        description: 'When any run fails, its error is summarized into a high-priority task.',
        trigger: t.trigger,
        nodes,
        edges: [edge('e1', 't', 'shorten'), edge('e2', 'shorten', 'task')],
      }
    },
  },
]

/** The Blank start: a manual trigger and "Notify me". */
export const BLANK = { id: 'blank', name: 'Blank', blurb: 'A manual trigger and a notification. Build the rest on the canvas.', icon: Plus } as const

export function getTemplate(id: string | null | undefined): WorkflowTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id)
}
