import type { ID, Timestamp } from './common'
import type { Capability, GrantMode } from './permissions'

export type IntegrationCategory =
  | 'models'
  | 'code'
  | 'communication'
  | 'productivity'
  | 'storage'
  | 'data'
  | 'search'
  | 'design'
  | 'media'
  | 'cloud'

/**
 * Static catalog entry (lives in code, not the database).
 * `support` states honestly what this build can actually do:
 * - 'live':      real network calls are made from the browser (e.g. GitHub public API, Anthropic API).
 * - 'simulated': connection and usage are simulated by the local engine.
 */
export interface IntegrationDef {
  id: string
  name: string
  category: IntegrationCategory
  description: string
  capabilities: Capability[]
  auth: 'oauth' | 'apiKey' | 'token' | 'endpoint' | 'none'
  support: 'live' | 'simulated'
  /** Short explanation shown when connecting (what is real, what is not). */
  supportNote?: string
  /** Brand-neutral monogram color token (identity hue name). */
  hue: string
  /** 1-3 letter monogram used instead of third-party logos. */
  monogram: string
  docsUrl?: string
  /** Fields requested when connecting (non-secret config + secrets). */
  fields?: { key: string; label: string; type: 'text' | 'password' | 'url'; placeholder?: string; secret?: boolean; optional?: boolean }[]
}

export type ConnectionStatus = 'connected' | 'connecting' | 'error' | 'disconnected'

export interface IntegrationConnection {
  /** Same as the IntegrationDef id. */
  id: string
  status: ConnectionStatus
  mode: 'live' | 'simulated'
  /** Display account, e.g. "@octocat" or "acme.slack.com". */
  account?: string
  /** Per-capability policy for this integration. */
  scopes: { capability: Capability; mode: GrantMode }[]
  /** Non-secret configuration (base URLs, workspace names). Secrets live in the secrets vault. */
  config: Record<string, string>
  usageCount: number
  lastUsedAt?: Timestamp
  connectedAt?: Timestamp
  error?: string
  /** Agents/workflows using this connection are derived; this caches the last computed list. */
  usedBy?: ID[]
}
