import type { Hue, ID, Timestamp } from './common'
import type { Autonomy, CapabilityGrant } from './permissions'

export interface AgentSchedule {
  /** Cron expression, e.g. "0 9 * * 1". */
  cron: string
  /** Human label, e.g. "Mondays at 09:00". */
  label: string
  enabled: boolean
}

export interface Agent {
  id: ID
  name: string
  /** Short role title, e.g. "Research analyst". */
  role: string
  description: string
  hue: Hue
  /** Seed for the procedural identity sigil. */
  sigil: number
  modelId: string
  /** System instructions. */
  instructions: string
  capabilities: CapabilityGrant[]
  /** Which knowledge the agent may retrieve from. */
  knowledgeScope: { all: boolean; collectionIds: string[]; projectIds: string[] }
  autonomy: Autonomy
  /** Configuration state; live activity is derived from runs. */
  status: 'active' | 'paused' | 'archived'
  schedule?: AgentSchedule
  /** Optional monthly spend ceiling in USD; runs stop asking for more once exceeded. */
  monthlyBudgetUsd?: number
  /** Template id this agent was created from, if any. */
  template?: string
  createdAt: Timestamp
  updatedAt: Timestamp
}
