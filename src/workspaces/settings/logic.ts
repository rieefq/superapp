import { CAPABILITIES, CAPABILITY_LIST, evaluatePermission } from '@/core/permissions'
import type { Agent, Autonomy, Capability, CapabilityGrant, PermissionDecision, RiskLevel, Settings } from '@/core/types'

/*
 * Pure helpers for the Settings workspace (tested in logic.test.ts). Business rules stay in the core
 * services: the permission policy is `evaluatePermission`, agents are written through `updateAgent`.
 */

// ------------------------------------------------------------------------------------------------ autonomy

export const AUTONOMY_OPTIONS: readonly { value: Autonomy; label: string; effect: string }[] = [
  { value: 'supervised', label: 'Supervised', effect: 'Asks before every change, and before any medium- or high-risk action.' },
  { value: 'balanced', label: 'Balanced', effect: 'Asks before medium- and high-risk actions.' },
  { value: 'autonomous', label: 'Autonomous', effect: 'Asks only before high-risk actions.' },
]

export const AUTONOMY_LABEL: Record<Autonomy, string> = { supervised: 'Supervised', balanced: 'Balanced', autonomous: 'Autonomous' }

export const RISK_ORDER: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 }
export const RISK_SHORT: Record<RiskLevel, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' }

/** Capabilities, highest risk first, then catalog order. */
export function capabilitiesByRisk(): Capability[] {
  return CAPABILITY_LIST.map((c, i) => ({ c, i }))
    .sort((a, b) => RISK_ORDER[a.c.risk] - RISK_ORDER[b.c.risk] || a.i - b.i)
    .map(({ c }) => c.id)
}

export interface PolicyRow {
  capability: Capability
  label: string
  risk: RiskLevel
  decision: PermissionDecision
  /** The capability is in the always-ask list. */
  alwaysAsk: boolean
}

/**
 * What a run with no agent overrides may do under these safety settings: the real permission
 * policy (`evaluatePermission`), evaluated for every capability with no agent and no integration.
 */
export function policyRows(safety: Settings['safety']): PolicyRow[] {
  return capabilitiesByRisk().map((capability) => {
    const info = CAPABILITIES[capability]
    return {
      capability,
      label: info.label,
      risk: info.risk,
      decision: evaluatePermission({ capability }, { safety, agent: null, connection: null }),
      alwaysAsk: safety.alwaysAsk.includes(capability),
    }
  })
}

/** Toggle one capability in the always-ask list, keeping catalog order. */
export function toggleAlwaysAsk(list: readonly Capability[], capability: Capability, on: boolean): Capability[] {
  const set = new Set(list)
  if (on) set.add(capability)
  else set.delete(capability)
  return CAPABILITY_LIST.map((c) => c.id).filter((id) => set.has(id))
}

// ------------------------------------------------------------------------------------------------ always-allow grants

export interface AgentGrants {
  agent: Agent
  grants: CapabilityGrant[]
}

/** Every "Always allow" grant (`always: true` with mode allow), grouped by agent, agents by name. */
export function alwaysAllowGrants(agents: readonly Agent[]): AgentGrants[] {
  return agents
    .map((agent) => ({ agent, grants: agent.capabilities.filter((g) => g.always === true && g.mode === 'allow') }))
    .filter((x) => x.grants.length > 0)
    .sort((a, b) => a.agent.name.localeCompare(b.agent.name))
}

/**
 * Revoke one "Always allow": the matching grant goes back to `ask` and loses `always`. Every other
 * grant is kept as it was.
 */
export function grantsWithoutAlways(agent: Pick<Agent, 'capabilities'>, capability: Capability, integrationId?: string): CapabilityGrant[] {
  return agent.capabilities.map((g) => {
    if (g.capability !== capability || (g.integrationId ?? undefined) !== (integrationId ?? undefined) || !g.always) return { ...g }
    const next: CapabilityGrant = { capability: g.capability, mode: 'ask' }
    if (g.integrationId) next.integrationId = g.integrationId
    return next
  })
}

// ------------------------------------------------------------------------------------------------ budget

export type BudgetParse = { ok: true; value: number } | { ok: false; error: string }

export const MAX_BUDGET_USD = 100_000

/** "$50", "50.5", "1,200" → dollars rounded to cents; empty or 0 turns the budget off. */
export function parseBudget(text: string): BudgetParse {
  const cleaned = text.replace(/[$,\s]/g, '').replace(/usd$/i, '')
  if (!cleaned) return { ok: true, value: 0 }
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return { ok: false, error: 'Enter an amount in dollars, like 50.' }
  const value = Math.round(Number(cleaned) * 100) / 100
  if (!Number.isFinite(value)) return { ok: false, error: 'Enter an amount in dollars, like 50.' }
  if (value > MAX_BUDGET_USD) return { ok: false, error: `Keep it at $${MAX_BUDGET_USD.toLocaleString('en-US')} or less.` }
  return { ok: true, value }
}

/** "$50", "$50.50", "Off" for 0. */
export function formatBudget(usd: number): string {
  if (!usd || usd <= 0) return 'Off'
  return Number.isInteger(usd) ? `$${usd.toLocaleString('en-US')}` : `$${usd.toFixed(2)}`
}

/** Plain input text for a stored budget ("50", "50.5", "" for none). */
export function budgetInputText(usd: number): string {
  if (!usd || usd <= 0) return '0'
  return Number.isInteger(usd) ? String(usd) : usd.toFixed(2)
}

// ------------------------------------------------------------------------------------------------ simulator speed

/** The offered speeds (1×–4×, §6.12); a stored value outside them (tests run at 8×) is shown too. */
export function speedOptions(current: number): number[] {
  const base = [1, 2, 4]
  return base.includes(current) || !(current > 0) ? base : [...base, current].sort((a, b) => a - b)
}

export const speedLabel = (speed: number) => `${Number.isInteger(speed) ? speed : speed.toFixed(1)}×`

// ------------------------------------------------------------------------------------------------ profile

export type NameCheck = { ok: true; value: string } | { ok: false; error: string }

export function checkName(text: string): NameCheck {
  const value = text.replace(/\s+/g, ' ').trim()
  if (!value) return { ok: false, error: 'Your name can’t be empty.' }
  if (value.length > 60) return { ok: false, error: 'Keep it under 60 characters.' }
  return { ok: true, value }
}

export type EmailCheck = { ok: true; value: string | undefined } | { ok: false; error: string }

/** Optional: empty clears it. A light shape check only (it is never used to send anything). */
export function checkEmail(text: string): EmailCheck {
  const value = text.trim()
  if (!value) return { ok: true, value: undefined }
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { ok: false, error: 'That doesn’t look like an email address.' }
  return { ok: true, value }
}
