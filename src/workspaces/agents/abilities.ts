import { useMemo } from 'react'
import { useDB, type Tables } from '@/core/db'
import { getIntegration, INTEGRATIONS } from '@/core/integrations/catalog'
import { CAPABILITIES, evaluatePermission, type PermissionEnvironment } from '@/core/permissions'
import { useSettings } from '@/core/settings'
import type { Agent, Capability, CapabilityGrant, CapabilityInfo, IntegrationConnection, PermissionDecision, Settings } from '@/core/types'

/**
 * Abilities: each capability grant with the integration that provides it, that integration's
 * connection status, and what the live permission policy decides right now (§6.4 Configure, §5.4.11).
 * The fallbacks mirror the agent run script (src/core/runs/factories/agent.ts), so what is shown is
 * what a run will do.
 */

/** Capabilities Atrium serves itself (real, local). */
export const LOCAL_CAPABILITIES = new Set<Capability>(['knowledge.read', 'knowledge.write', 'tasks.manage'])

/** The integration the agent script uses when a grant names none (and so the one the policy checks). */
export const SCRIPT_INTEGRATION: Partial<Record<Capability, string>> = {
  'web.search': 'web-search',
  'web.browse': 'web-search',
  'files.read': 'google-drive',
  'data.query': 'postgres',
  'calendar.manage': 'google-calendar',
  'messages.send': 'slack',
}

/** The provider shown for a grant that names none. */
const DISPLAY_INTEGRATION: Partial<Record<Capability, string>> = {
  ...SCRIPT_INTEGRATION,
  'repo.read': 'github',
  'repo.write': 'github',
  'repo.pull_request': 'github',
  'shell.execute': 'sandbox',
  'media.generate': 'image-gen',
  'files.write': 'google-drive',
  'workflows.run': 'webhooks',
  'payments.spend': 'stripe',
}

/** The default provider when a grant is added (Atrium for local capabilities). */
export function defaultIntegration(capability: Capability): string | undefined {
  if (LOCAL_CAPABILITIES.has(capability)) return undefined
  return DISPLAY_INTEGRATION[capability] ?? INTEGRATIONS.find((d) => d.capabilities.includes(capability))?.id
}

export type ProviderStatus = 'local' | 'connected' | 'error' | 'disconnected' | 'available'

export interface ProviderInfo {
  /** Integration id, or undefined for Atrium itself. */
  id?: string
  name: string
  /** A live service (or Atrium's own local data) vs. a simulated integration. */
  live: boolean
  status: ProviderStatus
  /** Integrations that can provide this capability (for the provider picker). */
  options: { id?: string; name: string; live: boolean }[]
}

export function providersFor(capability: Capability): { id?: string; name: string; live: boolean }[] {
  const out: { id?: string; name: string; live: boolean }[] = []
  if (LOCAL_CAPABILITIES.has(capability)) out.push({ name: 'Atrium', live: true })
  for (const def of INTEGRATIONS) if (def.capabilities.includes(capability)) out.push({ id: def.id, name: def.name, live: def.support === 'live' })
  return out
}

export function providerFor(grant: Pick<CapabilityGrant, 'capability' | 'integrationId'>, connections: Readonly<Record<string, IntegrationConnection>>): ProviderInfo {
  const options = providersFor(grant.capability)
  const id = grant.integrationId ?? defaultIntegration(grant.capability)
  if (!id) return { name: 'Atrium', live: true, status: 'local', options }
  const def = getIntegration(id)
  const conn = connections[id]
  const live = conn ? conn.mode === 'live' : def?.support === 'live'
  const status: ProviderStatus = conn ? (conn.status === 'connecting' ? 'disconnected' : conn.status) : 'available'
  return { id, name: def?.name ?? id, live, status, options }
}

export interface AbilityRow {
  grant: CapabilityGrant
  index: number
  info: CapabilityInfo
  provider: ProviderInfo
  /** The live policy's decision for this grant right now. */
  decision: PermissionDecision
  /** Settings › Permissions always asks before this capability (Allow can't skip it). */
  alwaysAsk: boolean
}

export function abilityRows(
  agent: Agent,
  connections: Readonly<Record<string, IntegrationConnection>>,
  safety: Settings['safety'],
): AbilityRow[] {
  const env: Partial<PermissionEnvironment> = { agent, safety }
  return agent.capabilities.map((grant, index) => {
    const provider = providerFor(grant, connections)
    // The same integration the run script checks (src/core/runs/factories/agent.ts).
    const checked = grant.integrationId ?? SCRIPT_INTEGRATION[grant.capability]
    const decision = evaluatePermission(
      { capability: grant.capability, agentId: agent.id, integrationId: checked },
      { ...env, connection: checked ? (connections[checked] ?? null) : undefined },
    )
    return { grant, index, info: CAPABILITIES[grant.capability], provider, decision, alwaysAsk: safety.alwaysAsk.includes(grant.capability) }
  })
}

/** Ability rows for an agent (saved or a draft), following connections and safety settings live. */
export function useAbilityRows(agent: Agent | undefined): AbilityRow[] {
  const connections = useDB((s: Tables) => s.connections)
  const safety = useSettings((s) => s.safety)
  return useMemo(() => (agent ? abilityRows(agent, connections, safety) : []), [agent, connections, safety])
}

export interface AbilitySummary {
  /** Capability labels that ask first (in grant order, deduplicated). */
  asks: string[]
  blocked: string[]
  allowed: string[]
}

export function summarizeAbilities(rows: readonly AbilityRow[]): AbilitySummary {
  const asks = new Set<string>()
  const blocked = new Set<string>()
  const allowed = new Set<string>()
  for (const r of rows) {
    if (r.grant.mode === 'deny') continue
    const set = r.decision.outcome === 'ask' ? asks : r.decision.outcome === 'deny' ? blocked : allowed
    set.add(r.info.label)
  }
  return { asks: [...asks], blocked: [...blocked], allowed: [...allowed] }
}

/** Plain words for a decision, shown in the Effective column. */
export function decisionWord(d: PermissionDecision): string {
  return d.outcome === 'allow' ? 'Runs on its own' : d.outcome === 'ask' ? 'Asks you first' : 'Blocked'
}
