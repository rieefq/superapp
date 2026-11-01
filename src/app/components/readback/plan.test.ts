import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables, type Tables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/core/settings'
import type { IntegrationConnection } from '@/core/types'
import { budgetState, capabilityRows, estimateRunCost, formatCost } from './plan'
import { meterLevel } from '../context/ContextMeter'
import { formatTokenCount, formatWindow } from '../context/tokens'

const T0 = new Date(2026, 10, 15, 12).getTime()

function connection(id: string, o: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return { id, status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, ...o }
}

let t: Tables
beforeEach(() => {
  t = emptyTables()
  t.agents.agt_scout = fx.agent({ id: 'agt_scout', name: 'Scout', autonomy: 'balanced', capabilities: [
    { capability: 'knowledge.read', mode: 'allow' },
    { capability: 'web.search', mode: 'allow' },
    { capability: 'web.browse', mode: 'allow' },
    { capability: 'knowledge.write', mode: 'ask' },
  ] })
  t.agents.agt_forge = fx.agent({ id: 'agt_forge', name: 'Forge', autonomy: 'balanced', capabilities: [
    { capability: 'repo.read', mode: 'allow' },
    { capability: 'repo.write', mode: 'allow' },
    { capability: 'shell.execute', mode: 'allow', integrationId: 'sandbox' },
  ] })
  t.connections['web-search'] = connection('web-search', { scopes: [{ capability: 'web.search', mode: 'allow' }, { capability: 'web.browse', mode: 'allow' }] })
  t.connections.sandbox = connection('sandbox', { scopes: [{ capability: 'shell.execute', mode: 'ask' }] })
  t.repos.rep_demo = { ...fx.repo(), id: 'rep_demo', provider: 'demo', mode: 'simulated' }
  db.replaceAll(t)
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
})

describe('capabilityRows', () => {
  it('reads research back: local knowledge is live, the web is simulated', () => {
    const rows = capabilityRows(t, { kind: 'research', agentId: 'agt_scout' })
    expect(rows.map((r) => [r.label, r.word, r.simulated])).toEqual([
      ['Read knowledge', 'allowed', false],
      ['Search the web', 'allowed', true],
      ['Browse pages', 'allowed', true],
    ])
  })

  it('applies the coding session policy (supervised asks before changes)', () => {
    const balanced = capabilityRows(t, { kind: 'session', agentId: 'agt_forge', autonomy: 'balanced', repoId: 'rep_demo' })
    const supervised = capabilityRows(t, { kind: 'session', agentId: 'agt_forge', autonomy: 'supervised', repoId: 'rep_demo' })
    const word = (rows: typeof balanced, label: string) => rows.find((r) => r.label === label)?.word
    // The sandbox connection asks before commands regardless of the policy.
    expect(word(balanced, 'Run commands')).toBe('asks you')
    expect(word(balanced, 'Modify code')).toBe('asks you')
    expect(word(supervised, 'Modify code')).toBe('asks you')
    expect(word(balanced, 'Read repositories')).toBe('allowed')
    // The demo repository is simulated.
    expect(balanced.every((r) => r.simulated)).toBe(true)
  })

  it('marks an agent’s grants with the policy decision and its reason', () => {
    const rows = capabilityRows(t, { kind: 'agent', agentId: 'agt_scout' })
    const write = rows.find((r) => r.capability === 'knowledge.write')!
    expect(write.word).toBe('asks you')
    expect(write.decision.reason).toMatch(/Scout needs your approval/)
    expect(write.simulated).toBe(false)
    expect(rows.find((r) => r.capability === 'web.search')!.simulated).toBe(true)
  })

  it('blocks capabilities a connection denies', () => {
    t.connections['web-search'] = connection('web-search', { scopes: [{ capability: 'web.search', mode: 'deny' }] })
    db.replaceAll(t)
    const rows = capabilityRows(t, { kind: 'research', agentId: 'agt_scout' })
    expect(rows.find((r) => r.capability === 'web.search')?.word).toBe('blocked')
  })

  it('has nothing to read back for notes', () => {
    expect(capabilityRows(t, { kind: 'note' })).toEqual([])
  })
})

describe('estimateRunCost', () => {
  it('uses the median of finished runs of the same kind, priced at reference rates when simulated', () => {
    t.runs.a = fx.run({ id: 'a', kind: 'research', usage: { inputTokens: 10_000, outputTokens: 2_000, costUsd: 0 } })
    t.runs.b = fx.run({ id: 'b', kind: 'research', usage: { inputTokens: 30_000, outputTokens: 6_000, costUsd: 0 } })
    t.runs.c = fx.run({ id: 'c', kind: 'research', usage: { inputTokens: 20_000, outputTokens: 4_000, costUsd: 0 } })
    t.runs.f = fx.run({ id: 'f', kind: 'research', status: 'failed', usage: { inputTokens: 999_000, outputTokens: 0, costUsd: 0 } })
    const est = estimateRunCost(t, 'research', 'sim-deep')!
    expect(est.basedOn).toBe(3)
    expect(est.tokens).toBe(24_000)
    expect(est.simulated).toBe(true)
    // Claude Sonnet 5.5 reference pricing: $2 / $10 per million tokens.
    expect(est.usd).toBeCloseTo((20_000 * 2 + 4_000 * 10) / 1_000_000, 6)
  })

  it('falls back to a typical size for a kind with no history, and has no cost for notes', () => {
    expect(estimateRunCost(t, 'session', 'sim-deep')).toMatchObject({ basedOn: 0, tokens: 24_000 })
    expect(estimateRunCost(t, 'note', 'sim-deep')).toBeNull()
  })
})

describe('budgetState', () => {
  it('counts live spend this month; simulated estimates only when enabled', () => {
    t.runs.live = fx.run({ id: 'live', simulated: false, createdAt: T0, endedAt: T0, usage: { inputTokens: 1, outputTokens: 1, costUsd: 12.4 } })
    t.runs.sim = fx.run({ id: 'sim', simulated: true, createdAt: T0, endedAt: T0, usage: { inputTokens: 1, outputTokens: 1, costUsd: 3 } })
    t.runs.lastMonth = fx.run({ id: 'lastMonth', simulated: false, createdAt: T0 - 40 * 86_400_000, endedAt: T0 - 40 * 86_400_000, usage: { inputTokens: 1, outputTokens: 1, costUsd: 99 } })
    const off = budgetState(t, { monthlyBudgetUsd: 50, countSimulatedSpend: false }, T0 + 1000)
    expect(off).toMatchObject({ spentUsd: 12.4, leftUsd: 37.6, includesEstimates: false })
    expect(off.ratio).toBeCloseTo(0.248)
    const on = budgetState(t, { monthlyBudgetUsd: 50, countSimulatedSpend: true }, T0 + 1000)
    expect(on).toMatchObject({ spentUsd: 15.4, includesEstimates: true })
    expect(budgetState(t, { monthlyBudgetUsd: 0, countSimulatedSpend: false }, T0).ratio).toBeNull()
  })
})

describe('formats', () => {
  it('formats costs with 3 decimals below a cent', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(0.004)).toBe('$0.004')
    expect(formatCost(0.06)).toBe('$0.06')
    expect(formatCost(37.6)).toBe('$37.60')
  })

  it('reads the context meter: ~3.2k / 200k, attention at 80%, over above 100%', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(840)).toBe('~840')
    expect(formatTokenCount(3_240)).toBe('~3.2k')
    expect(formatTokenCount(12_400)).toBe('~12k')
    expect(formatWindow(200_000)).toBe('200k')
    expect(formatWindow(1_000_000)).toBe('1M')
    expect(meterLevel(100, 1000)).toBe('ok')
    expect(meterLevel(800, 1000)).toBe('attn')
    expect(meterLevel(1000, 1000)).toBe('attn')
    expect(meterLevel(1001, 1000)).toBe('over')
  })
})
