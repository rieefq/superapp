import { db } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { getSettings } from '@/core/settings'
import type {
  Agent, Autonomy, Capability, CapabilityGrant, GrantMode, ID, IntegrationConnection, PermissionDecision, RiskLevel, Settings,
} from '@/core/types'
import { CAPABILITIES } from './capabilities'

export interface PermissionRequest {
  capability: Capability
  /** Risk of this specific use; defaults to the capability's catalog risk. */
  risk?: RiskLevel
  agentId?: ID
  integrationId?: string
  /** Overrides the agent's autonomy (e.g. a coding session's approval policy). */
  autonomy?: Autonomy
}

/**
 * Optional overrides for previews (e.g. an agent editor showing what an unsaved
 * configuration would do) and tests. Omitted fields are read from the live stores.
 */
export interface PermissionEnvironment {
  safety: Settings['safety']
  /** The acting agent; `null` = no agent. */
  agent: Agent | null
  /** The integration connection; `null` = not connected. */
  connection: IntegrationConnection | null
}

/** Capability id suffixes that change something outside Atrium's read-only view of the world. */
const MUTATING_SUFFIXES = ['.write', '.send', '.execute', '.pull_request', '.spend', '.manage', '.run', '.generate']

/** True for capabilities that change things (write, send, execute, open PRs, spend, manage, run, generate). */
export function isMutatingCapability(capability: Capability): boolean {
  return MUTATING_SUFFIXES.some((suffix) => capability.endsWith(suffix))
}

const allow = (reason: string): PermissionDecision => ({ outcome: 'allow', reason })
const ask = (reason: string): PermissionDecision => ({ outcome: 'ask', reason })
const deny = (reason: string): PermissionDecision => ({ outcome: 'deny', reason })

const RESTRICTIVENESS: Record<GrantMode, number> = { allow: 0, ask: 1, deny: 2 }

/**
 * The agent's grant for a capability. A grant for the exact integration wins; otherwise
 * integration-agnostic grants apply, and when only grants for other integrations exist
 * the most restrictive of them is used.
 */
export function findGrant(grants: readonly CapabilityGrant[], capability: Capability, integrationId?: string): CapabilityGrant | undefined {
  const matching = grants.filter((g) => g.capability === capability)
  if (!matching.length) return undefined
  if (integrationId) {
    const exact = matching.find((g) => g.integrationId === integrationId)
    if (exact) return exact
  }
  const generic = matching.filter((g) => !g.integrationId)
  const pool = generic.length ? generic : matching
  return pool.reduce((a, b) => (RESTRICTIVENESS[b.mode] > RESTRICTIVENESS[a.mode] ? b : a))
}

function autonomyAsks(autonomy: Autonomy, risk: RiskLevel, capability: Capability): boolean {
  switch (autonomy) {
    case 'supervised':
      return risk !== 'low' || isMutatingCapability(capability)
    case 'balanced':
      return risk !== 'low'
    case 'autonomous':
      return risk === 'high'
  }
}

function autonomyReason(autonomy: Autonomy, risk: RiskLevel, verb: string, agent: Agent | null): string {
  if (autonomy === 'autonomous') return 'High-risk actions need your approval, even in autonomous mode'
  if (autonomy === 'supervised') {
    return agent ? `${agent.name} is supervised and asks before it can ${verb}` : `Supervised mode asks before runs can ${verb}`
  }
  return agent
    ? `${agent.name} works in balanced mode and asks before ${risk}-risk actions`
    : `Balanced mode asks before ${risk}-risk actions`
}

/**
 * Decide whether a capability use may run automatically, needs approval, or is denied.
 *
 * Constraints are combined so that a denial always wins over a request for approval
 * (approving something that cannot run would be pointless). Among requests for approval,
 * the first applicable reason is reported, in this order:
 *  (a) the global safety policy (`settings.safety.alwaysAsk`),
 *  (b) the integration connection's scope for the capability,
 *  (c) the agent's grant for the capability (missing grant → ask),
 *  (d) autonomy (agent's, else the default) against the use's risk.
 */
export function evaluatePermission(req: PermissionRequest, env?: Partial<PermissionEnvironment>): PermissionDecision {
  const { capability } = req
  const info = CAPABILITIES[capability]
  const verb = info.label.toLowerCase()
  const safety = env?.safety ?? getSettings().safety
  const asks: string[] = []

  if (safety.alwaysAsk.includes(capability)) asks.push(`Your safety settings require approval to ${verb}`)

  // (b) integration
  if (req.integrationId) {
    const name = getIntegration(req.integrationId)?.name ?? req.integrationId
    const connection = env?.connection !== undefined ? env.connection : db.get('connections', req.integrationId)
    if (!connection || connection.status !== 'connected') return deny(`${name} is not connected`)
    const scope = connection.scopes.find((s) => s.capability === capability)
    if (scope?.mode === 'deny') return deny(`${name} is not allowed to ${verb}`)
    if (scope?.mode === 'ask') asks.push(`${name} is set to ask before it can ${verb}`)
  }

  // (c) agent
  let agent: Agent | null = null
  if (env?.agent !== undefined) {
    agent = env.agent
  } else if (req.agentId) {
    agent = db.get('agents', req.agentId) ?? null
    if (!agent) asks.push('The agent that started this run no longer exists')
  }
  if (agent) {
    const grant = findGrant(agent.capabilities, capability, req.integrationId)
    if (grant?.mode === 'deny') return deny(`${agent.name} is not allowed to ${verb}`)
    if (grant?.mode === 'ask') asks.push(`${agent.name} needs your approval to ${verb}`)
    if (!grant) asks.push(`${agent.name} has not been granted permission to ${verb}`)
  }

  if (asks.length) return ask(asks[0])

  // An explicit "Always allow" grant skips the autonomy check (global always-ask was handled above).
  if (agent) {
    const grant = findGrant(agent.capabilities, capability, req.integrationId)
    if (grant?.mode === 'allow' && grant.always) return allow(`You always allow ${agent.name} to ${verb}`)
  }

  // (d) autonomy vs risk
  const autonomy = req.autonomy ?? agent?.autonomy ?? safety.defaultAutonomy
  const risk = req.risk ?? info.risk
  if (autonomyAsks(autonomy, risk, capability)) return ask(autonomyReason(autonomy, risk, verb, agent))

  return allow(agent ? `${agent.name} is allowed to ${verb}` : `Allowed: ${risk}-risk action in ${autonomy} mode`)
}
