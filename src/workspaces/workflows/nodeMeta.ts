import { Braces, Clock, Hand, Hourglass, MousePointerClick, Orbit, Package, Plug, Radio, Split, Webhook, Zap, type LucideIcon } from 'lucide-react'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { configNumber, configString } from '@/core/sim/params'
import type { Agent, WorkflowNode, WorkflowNodeType, WorkflowTrigger } from '@/core/types'

/** The eight step types (docs/DESIGN.md §6.6), in palette order. */
export const NODE_TYPE_ORDER: readonly WorkflowNodeType[] = ['trigger', 'agent', 'action', 'condition', 'transform', 'approval', 'delay', 'output']

export interface NodeTypeMeta {
  /** Kicker on the node (`label` style). */
  label: string
  icon: LucideIcon
  /** One line for the Add node palette. */
  description: string
  /** A new node of this type (label + config; ids and positions are set by the caller). */
  create: () => Pick<WorkflowNode, 'type' | 'label' | 'config'> & Partial<Pick<WorkflowNode, 'integrationId' | 'capability' | 'agentId'>>
}

export const NODE_TYPES: Record<WorkflowNodeType, NodeTypeMeta> = {
  trigger: {
    label: 'Trigger',
    icon: Zap,
    description: 'When the workflow starts: by hand, on a schedule, on an event or a webhook.',
    create: () => ({ type: 'trigger', label: 'Manual run', config: { type: 'manual' } }),
  },
  agent: {
    label: 'Agent',
    icon: Orbit,
    description: 'An agent reads the input and writes, classifies or researches.',
    create: () => ({ type: 'agent', label: 'Ask an agent', config: { prompt: '' } }),
  },
  action: {
    label: 'Action',
    icon: Plug,
    description: 'Do something in a connected service: post, file, upload, schedule.',
    create: () => ({ type: 'action', label: 'New action', config: {} }),
  },
  condition: {
    label: 'Condition',
    icon: Split,
    description: 'Branch on the result: Yes continues one way, No the other.',
    create: () => ({ type: 'condition', label: 'Check something', config: { expression: '' } }),
  },
  transform: {
    label: 'Transform',
    icon: Braces,
    description: 'Reshape the result: format, shorten, look something up.',
    create: () => ({ type: 'transform', label: 'Format the result', config: { operation: 'Format for Slack' } }),
  },
  approval: {
    label: 'Approval',
    icon: Hand,
    description: 'Stop and ask you. The step after it waits for your decision.',
    create: () => ({ type: 'approval', label: 'Review before continuing', config: {} }),
  },
  delay: {
    label: 'Delay',
    icon: Hourglass,
    description: 'Wait a while before the next step.',
    create: () => ({ type: 'delay', label: 'Wait 1 hour', config: { hours: 1 } }),
  },
  output: {
    label: 'Output',
    icon: Package,
    description: 'Finish with a notification, a Knowledge note or a task.',
    create: () => ({ type: 'output', label: 'Notify me', config: { kind: 'notify' } }),
  },
}

/** Trigger icons follow the trigger type. */
export const TRIGGER_ICON: Record<WorkflowTrigger['type'], LucideIcon> = { manual: MousePointerClick, schedule: Clock, event: Radio, webhook: Webhook }

export const OUTPUT_KINDS: readonly { value: string; label: string; description: string }[] = [
  { value: 'notify', label: 'Notify me', description: 'An update in Atrium with the result' },
  { value: 'knowledge', label: 'Save to Knowledge', description: 'A note in Knowledge, linked to the run' },
  { value: 'task', label: 'Create a task', description: 'A task in the workflow’s project' },
  { value: 'none', label: 'Nothing', description: 'End without an output' },
]

const OUTPUT_LABEL: Record<string, string> = { notify: 'Notification', knowledge: 'Knowledge note', task: 'Task', none: 'No output', notification: 'Notification', activity: 'Activity log' }

/** Output kind of an output node (`kind`, or the demo data's `output` field). */
export function outputKindOf(node: Pick<WorkflowNode, 'config'>): string {
  return configString(node.config, 'kind', 'type') ?? (configString(node.config, 'output') === 'activity' ? 'activity' : 'notify')
}

/** Delay in human words: "2 hours", "30 minutes". */
export function delayWords(node: Pick<WorkflowNode, 'config'>): string {
  const h = configNumber(node.config, 'hours')
  const m = configNumber(node.config, 'minutes')
  if (h && h >= 24 && h % 24 === 0) return `${h / 24} day${h === 24 ? '' : 's'}`
  if (h) return `${h} hour${h === 1 ? '' : 's'}`
  if (m) return `${m} minute${m === 1 ? '' : 's'}`
  return configString(node.config, 'duration', 'delay') ?? '1 minute'
}

/**
 * The one-line config summary under a node's label (ink-3): agent and prompt, integration and
 * destination, expression, delay, output kind.
 */
export function nodeSummary(node: WorkflowNode, ctx: { agent?: Pick<Agent, 'name'>; trigger?: WorkflowTrigger }): string {
  switch (node.type) {
    case 'trigger': {
      const t = ctx.trigger
      if (!t) return 'Starts the workflow'
      if (t.type === 'schedule') return 'Schedule · while Atrium is open'
      if (t.type === 'event') return `Event · ${t.event ?? 'not chosen'}`
      if (t.type === 'webhook') return 'Webhook · test events only'
      return 'Manual · Test run starts it'
    }
    case 'agent': {
      const prompt = configString(node.config, 'prompt', 'instructions', 'task')
      return [ctx.agent?.name ?? 'No agent chosen', prompt].filter(Boolean).join(' · ')
    }
    case 'action': {
      const def = getIntegration(node.integrationId)
      const where = configString(node.config, 'channel', 'to', 'recipient', 'folder', 'team', 'project', 'repo')
      const cap = node.capability ? CAPABILITIES[node.capability]?.label : undefined
      if (!def && !cap) return 'Choose an integration'
      return [def?.name, where ?? cap].filter(Boolean).join(' · ')
    }
    case 'condition': {
      const expr = configString(node.config, 'expression', 'condition', 'rule')
      return expr ? expr : 'Write the condition'
    }
    case 'transform': {
      const def = getIntegration(node.integrationId)
      const how = configString(node.config, 'operation', 'template', 'expression', 'format', 'lookup', 'window')
      return [def?.name, how].filter(Boolean).join(' · ') || 'Reshape the result'
    }
    case 'approval':
      return 'Asks you before continuing'
    case 'delay':
      return `Waits ${delayWords(node)}`
    case 'output':
      return OUTPUT_LABEL[outputKindOf(node)] ?? 'Notification'
  }
}

/** Does this node touch a simulated integration (dashed edge, §5.2)? */
export function usesSimulatedIntegration(node: Pick<WorkflowNode, 'integrationId'>): boolean {
  const def = getIntegration(node.integrationId)
  return !!def && def.support === 'simulated'
}
