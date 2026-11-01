import type { RiskLevel } from './common'

/**
 * Capabilities are the unit of permission. Agents, workflows and integrations
 * declare which capabilities they use; the permission service decides whether
 * a step may run automatically, needs human approval, or is denied.
 */
export type Capability =
  | 'knowledge.read'
  | 'knowledge.write'
  | 'web.search'
  | 'web.browse'
  | 'repo.read'
  | 'repo.write'
  | 'repo.pull_request'
  | 'shell.execute'
  | 'tasks.manage'
  | 'messages.send'
  | 'calendar.manage'
  | 'files.read'
  | 'files.write'
  | 'media.generate'
  | 'workflows.run'
  | 'data.query'
  | 'payments.spend'

export interface CapabilityInfo {
  id: Capability
  label: string
  description: string
  risk: RiskLevel
  /** Lucide icon name, resolved by the UI. */
  icon: string
}

/**
 * How much an agent may do without asking.
 * - supervised: every capability use that changes something asks first
 * - balanced:   only medium/high-risk capability uses ask
 * - autonomous: only high-risk uses ask (and anything the global policy forces)
 */
export type Autonomy = 'supervised' | 'balanced' | 'autonomous'

export type GrantMode = 'allow' | 'ask' | 'deny'

export interface CapabilityGrant {
  capability: Capability
  mode: GrantMode
  /** Which connected integration provides this capability (e.g. 'github', 'slack'). */
  integrationId?: string
  /**
   * Set by "Always allow" on an approval card: with mode 'allow', the agent may use this capability
   * without asking regardless of its autonomy level (global always-ask settings still apply).
   * Listed in Settings › Permissions with Revoke.
   */
  always?: boolean
}

export type PermissionDecision =
  | { outcome: 'allow'; reason: string }
  | { outcome: 'ask'; reason: string }
  | { outcome: 'deny'; reason: string }
