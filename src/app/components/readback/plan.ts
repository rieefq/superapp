import { estimateCost, estimateReferenceCost, getModel } from '@/core/ai/models'
import type { Tables } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES, evaluatePermission, type PermissionEnvironment } from '@/core/permissions'
import type { Autonomy, Capability, ID, PermissionDecision, RiskLevel, RunKind, Settings } from '@/core/types'

/**
 * ReadBack data: what a delegated run will be able to do (capability decisions from the real
 * permission policy), what it is likely to cost, and how that sits against the monthly budget.
 * Pure functions over a database snapshot so they are easy to test; hooks live in ./useReadBack.
 */

/** Kinds of work a ReadBack describes. */
export type ReadBackKind = 'research' | 'session' | 'agent' | 'workflow' | 'studio' | 'task' | 'note' | 'chat'

export interface CapabilityUse {
  capability: Capability
  integrationId?: string
  risk?: RiskLevel
  /** The capability is provided by the local simulator (SIM), not a live service. */
  simulated: boolean
}

export interface CapabilityRow extends CapabilityUse {
  label: string
  decision: PermissionDecision
  /** Display word: allowed · asks you · blocked. */
  word: 'allowed' | 'asks you' | 'blocked'
}

export interface PlanInput {
  kind: ReadBackKind
  /** Acting agent (Scout for research, Forge for code, the picked agent…). */
  agentId?: ID
  /** Session approval policy (coding sessions) — overrides the agent's autonomy. */
  autonomy?: Autonomy
  /** Coding sessions: the repository (live GitHub reads vs. the simulated demo repo). */
  repoId?: ID
  workflowId?: ID
  /** Studio: what is being generated. */
  studioKind?: 'image' | 'video' | 'presentation' | 'document' | 'audio'
}

const isSimIntegration = (s: Tables, integrationId: string | undefined): boolean => {
  if (!integrationId) return false
  const conn = s.connections[integrationId]
  if (conn) return conn.mode === 'simulated'
  return getIntegration(integrationId)?.support !== 'live'
}

/** Capabilities served by Atrium itself (local knowledge and tasks are real, not simulated). */
const LOCAL_CAPABILITIES = new Set<Capability>(['knowledge.read', 'knowledge.write', 'tasks.manage'])

/** Integrations the agent script falls back to when a grant names none (src/core/runs/factories/agent.ts). */
const AGENT_FALLBACK_INTEGRATION: Partial<Record<Capability, string>> = {
  'web.search': 'web-search',
  'web.browse': 'web-search',
  'files.read': 'google-drive',
  'data.query': 'postgres',
  'calendar.manage': 'google-calendar',
  'messages.send': 'slack',
}

const STUDIO_INTEGRATION: Record<NonNullable<PlanInput['studioKind']>, string> = {
  image: 'image-gen',
  video: 'video-gen',
  audio: 'voice',
  presentation: 'studio-docs',
  document: 'studio-docs',
}

/** The capabilities a kind of run uses, mirroring what its simulation script actually does. */
export function capabilityUses(s: Tables, input: PlanInput): CapabilityUse[] {
  switch (input.kind) {
    case 'research':
      return [
        { capability: 'knowledge.read', simulated: false },
        { capability: 'web.search', integrationId: 'web-search', simulated: isSimIntegration(s, 'web-search') },
        { capability: 'web.browse', integrationId: 'web-search', simulated: isSimIntegration(s, 'web-search') },
      ]
    case 'session': {
      const repo = input.repoId ? s.repos[input.repoId] : undefined
      const live = repo?.provider === 'github'
      return [
        { capability: 'repo.read', integrationId: live ? 'github' : undefined, simulated: !live },
        // Edits are computed by the local engine and live on the session branch inside Atrium.
        { capability: 'repo.write', simulated: true, risk: 'medium' },
        { capability: 'shell.execute', integrationId: 'sandbox', simulated: true, risk: 'medium' },
      ]
    }
    case 'agent':
    case 'task': {
      const agent = input.agentId ? s.agents[input.agentId] : undefined
      if (!agent) return []
      const seen = new Set<string>()
      const out: CapabilityUse[] = []
      for (const g of agent.capabilities) {
        if (seen.has(g.capability)) continue
        seen.add(g.capability)
        // Same integration the agent script would use when the grant names none (for the permission
        // check). Agent runs are simulated scripts: only Atrium's own knowledge and tasks are touched for real.
        const integrationId = g.integrationId ?? AGENT_FALLBACK_INTEGRATION[g.capability]
        out.push({ capability: g.capability, integrationId, simulated: !LOCAL_CAPABILITIES.has(g.capability) })
      }
      return out
    }
    case 'workflow': {
      const wf = input.workflowId ? s.workflows[input.workflowId] : undefined
      if (!wf) return []
      const seen = new Set<string>()
      const out: CapabilityUse[] = []
      for (const node of wf.nodes) {
        if (!node.capability) continue
        const key = `${node.capability}:${node.integrationId ?? ''}`
        if (seen.has(key)) continue
        seen.add(key)
        // Workflow steps run as simulated scripts; only Atrium's own knowledge and tasks are real.
        out.push({ capability: node.capability, integrationId: node.integrationId, simulated: !LOCAL_CAPABILITIES.has(node.capability) })
      }
      return out
    }
    case 'studio': {
      const integrationId = STUDIO_INTEGRATION[input.studioKind ?? 'image']
      return [
        { capability: 'knowledge.read', simulated: false },
        { capability: 'media.generate', integrationId: s.connections[integrationId] ? integrationId : undefined, simulated: true },
      ]
    }
    case 'note':
    case 'chat':
      return []
  }
}

const WORD: Record<PermissionDecision['outcome'], CapabilityRow['word']> = { allow: 'allowed', ask: 'asks you', deny: 'blocked' }

/** Capability rows with decisions from the live permission policy (`evaluatePermission`). */
export function capabilityRows(s: Tables, input: PlanInput, env?: Partial<PermissionEnvironment>): CapabilityRow[] {
  const agentId = input.agentId && s.agents[input.agentId] ? input.agentId : undefined
  return capabilityUses(s, input).map((use) => {
    const decision = evaluatePermission(
      { capability: use.capability, risk: use.risk, agentId, integrationId: use.integrationId, autonomy: input.autonomy },
      env,
    )
    return { ...use, label: CAPABILITIES[use.capability].label, decision, word: WORD[decision.outcome] }
  })
}

// ---------------------------------------------------------------- cost

const FALLBACK_TOKENS: Record<RunKind, number> = { chat: 2_400, code: 24_000, agent: 9_000, research: 18_000, workflow: 6_000, studio: 4_000 }

export const RUN_KIND_FOR: Record<ReadBackKind, RunKind | null> = {
  research: 'research',
  session: 'code',
  agent: 'agent',
  workflow: 'workflow',
  studio: 'studio',
  task: 'agent',
  chat: 'chat',
  note: null,
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface CostEstimate {
  usd: number
  tokens: number
  /** Simulated work is costed at reference pricing — an estimate, no money is spent. */
  simulated: boolean
  /** How many past runs the estimate is based on (0 = a default for this kind). */
  basedOn: number
}

/**
 * Estimated cost: the median token use of finished runs of the same kind (or a default),
 * priced on the chosen model — at reference pricing when the model is simulated.
 */
export function estimateRunCost(s: Tables, kind: ReadBackKind, modelId: string | undefined, extraInputTokens = 0): CostEstimate | null {
  const runKind = RUN_KIND_FOR[kind]
  if (!runKind) return null
  const finished = Object.values(s.runs).filter(
    (r) => r.kind === runKind && r.status === 'succeeded' && r.usage.inputTokens + r.usage.outputTokens > 0,
  )
  const basedOn = finished.length
  const input = basedOn ? median(finished.map((r) => r.usage.inputTokens)) : Math.round(FALLBACK_TOKENS[runKind] * 0.7)
  const output = basedOn ? median(finished.map((r) => r.usage.outputTokens)) : Math.round(FALLBACK_TOKENS[runKind] * 0.3)
  const inTok = Math.round(input + Math.max(0, extraInputTokens))
  const outTok = Math.round(output)
  const model = getModel(modelId)
  const simulated = !model || model.simulated
  const usd = simulated ? estimateReferenceCost(inTok, outTok) : estimateCost(modelId, inTok, outTok)
  return { usd, tokens: inTok + outTok, simulated, basedOn }
}

// ---------------------------------------------------------------- budget

export interface BudgetState {
  monthlyUsd: number
  /** Month-to-date spend that counts toward the budget (live, plus simulated estimates when enabled). */
  spentUsd: number
  leftUsd: number
  /** spent / monthly, null when no budget is set. */
  ratio: number | null
  /** True when simulated estimates are part of `spentUsd`. */
  includesEstimates: boolean
}

function startOfMonth(now: number): number {
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Month-to-date spend against `settings.safety.monthlyBudgetUsd` (§3.6: simulated counts only when enabled). */
export function budgetState(s: Tables, safety: Pick<Settings['safety'], 'monthlyBudgetUsd' | 'countSimulatedSpend'>, now = Date.now()): BudgetState {
  const from = startOfMonth(now)
  let live = 0
  let sim = 0
  for (const r of Object.values(s.runs)) {
    const at = r.endedAt ?? r.startedAt ?? r.createdAt
    if (at < from || at > now) continue
    if (r.simulated) sim += r.usage.costUsd
    else live += r.usage.costUsd
  }
  const spentUsd = live + (safety.countSimulatedSpend ? sim : 0)
  const monthlyUsd = Math.max(0, safety.monthlyBudgetUsd || 0)
  return {
    monthlyUsd,
    spentUsd,
    leftUsd: Math.max(0, monthlyUsd - spentUsd),
    ratio: monthlyUsd > 0 ? spentUsd / monthlyUsd : null,
    includesEstimates: safety.countSimulatedSpend && sim > 0,
  }
}

/** "$0.06", "$0.004" (3 decimals below a cent), "$37.60". */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  if (usd < 1000) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}
