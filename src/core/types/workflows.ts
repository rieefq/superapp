import type { Hue, ID, Timestamp } from './common'
import type { Capability } from './permissions'

export type WorkflowNodeType =
  | 'trigger'
  | 'agent'
  | 'action'
  | 'condition'
  | 'transform'
  | 'approval'
  | 'delay'
  | 'output'

export interface WorkflowNode {
  id: ID
  type: WorkflowNodeType
  label: string
  position: { x: number; y: number }
  /** Node-type specific settings (prompt, channel, expression, delay, …). */
  config: Record<string, unknown>
  integrationId?: string
  agentId?: ID
  capability?: Capability
}

export interface WorkflowEdge {
  id: ID
  source: ID
  target: ID
  /** For condition nodes: 'true' | 'false'. */
  sourceHandle?: string
  label?: string
}

export type WorkflowTriggerType = 'manual' | 'schedule' | 'event' | 'webhook'

export interface WorkflowTrigger {
  type: WorkflowTriggerType
  label: string
  cron?: string
  /** e.g. "github.pull_request.opened", "knowledge.created". */
  event?: string
  integrationId?: string
}

export interface Workflow {
  id: ID
  name: string
  description: string
  projectId: ID | null
  hue: Hue
  trigger: WorkflowTrigger
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  enabled: boolean
  version: number
  lastRunAt?: Timestamp
  createdAt: Timestamp
  updatedAt: Timestamp
}
