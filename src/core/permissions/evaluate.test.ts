import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/core/settings'
import type { Agent, Autonomy, Capability, CapabilityGrant, IntegrationConnection, RiskLevel } from '@/core/types'
import { evaluatePermission, findGrant, isMutatingCapability } from './evaluate'

function agent(patch: Partial<Agent> = {}): Agent {
  return {
    id: 'agt_forge', name: 'Forge', role: 'Coding agent', description: '', hue: 'sky', sigil: 1, modelId: 'sim-deep',
    instructions: '', capabilities: [], knowledgeScope: { all: true, collectionIds: [], projectIds: [] },
    autonomy: 'balanced', status: 'active', createdAt: 0, updatedAt: 0, ...patch,
  }
}

function connection(patch: Partial<IntegrationConnection> = {}): IntegrationConnection {
  return { id: 'slack', status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, ...patch }
}

const setSafety = (patch: Partial<typeof DEFAULT_SETTINGS.safety>) => useSettingsStore.getState().update('safety', patch)

beforeEach(() => {
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  setSafety({ alwaysAsk: [] })
})

describe('autonomy × risk matrix (no agent, no integration)', () => {
  const cases: Array<[Autonomy, Capability, RiskLevel | undefined, 'allow' | 'ask']> = [
    // supervised: asks for medium/high and for anything that changes things
    ['supervised', 'knowledge.read', undefined, 'allow'],
    ['supervised', 'web.search', 'low', 'allow'],
    ['supervised', 'knowledge.write', undefined, 'ask'],
    ['supervised', 'media.generate', 'low', 'ask'],
    ['supervised', 'tasks.manage', undefined, 'ask'],
    ['supervised', 'data.query', undefined, 'ask'],
    // balanced: asks for medium/high only
    ['balanced', 'knowledge.write', undefined, 'allow'],
    ['balanced', 'tasks.manage', undefined, 'allow'],
    ['balanced', 'shell.execute', undefined, 'ask'],
    ['balanced', 'repo.pull_request', undefined, 'ask'],
    ['balanced', 'shell.execute', 'low', 'allow'],
    ['balanced', 'web.browse', 'high', 'ask'],
    // autonomous: asks for high only
    ['autonomous', 'shell.execute', undefined, 'allow'],
    ['autonomous', 'repo.write', 'medium', 'allow'],
    ['autonomous', 'payments.spend', undefined, 'ask'],
    ['autonomous', 'knowledge.read', 'high', 'ask'],
  ]
  it.each(cases)('%s · %s (risk %s) → %s', (autonomy, capability, risk, outcome) => {
    setSafety({ defaultAutonomy: autonomy })
    const decision = evaluatePermission({ capability, risk })
    expect(decision.outcome).toBe(outcome)
    expect(decision.reason.length).toBeGreaterThan(10)
  })

  it('explains autonomy decisions in plain sentences', () => {
    setSafety({ defaultAutonomy: 'balanced' })
    expect(evaluatePermission({ capability: 'shell.execute' }).reason).toBe('Balanced mode asks before medium-risk actions')
    setSafety({ defaultAutonomy: 'supervised' })
    expect(evaluatePermission({ capability: 'knowledge.write' }).reason).toBe('Supervised mode asks before runs can write knowledge')
    setSafety({ defaultAutonomy: 'autonomous' })
    expect(evaluatePermission({ capability: 'payments.spend' }).reason).toBe('High-risk actions need your approval, even in autonomous mode')
  })
})

describe('global safety policy', () => {
  it('asks for capabilities listed in alwaysAsk regardless of autonomy', () => {
    setSafety({ alwaysAsk: ['knowledge.read'], defaultAutonomy: 'autonomous' })
    expect(evaluatePermission({ capability: 'knowledge.read', risk: 'low' })).toEqual({
      outcome: 'ask', reason: 'Your safety settings require approval to read knowledge',
    })
  })

  it('uses the default settings (messages, pull requests, payments always ask)', () => {
    useSettingsStore.getState().reset()
    db.insert('agents', agent({ autonomy: 'autonomous', capabilities: [{ capability: 'messages.send', mode: 'allow' }] }))
    expect(evaluatePermission({ capability: 'messages.send', agentId: 'agt_forge' }).outcome).toBe('ask')
  })
})

describe('integrations', () => {
  it('denies when the integration is missing or not connected', () => {
    expect(evaluatePermission({ capability: 'messages.send', integrationId: 'slack' })).toEqual({ outcome: 'deny', reason: 'Slack is not connected' })
    db.insert('connections', connection({ status: 'error' }))
    expect(evaluatePermission({ capability: 'messages.send', integrationId: 'slack' }).outcome).toBe('deny')
    expect(evaluatePermission({ capability: 'files.read', integrationId: 'unknown-svc' }).reason).toBe('unknown-svc is not connected')
  })

  it('applies the connection scope for the capability', () => {
    db.insert('connections', connection({ scopes: [{ capability: 'messages.send', mode: 'deny' }, { capability: 'files.read', mode: 'ask' }] }))
    setSafety({ defaultAutonomy: 'autonomous' })
    expect(evaluatePermission({ capability: 'messages.send', integrationId: 'slack' })).toEqual({ outcome: 'deny', reason: 'Slack is not allowed to send messages' })
    expect(evaluatePermission({ capability: 'files.read', integrationId: 'slack' })).toEqual({ outcome: 'ask', reason: 'Slack is set to ask before it can read files' })
    expect(evaluatePermission({ capability: 'knowledge.read', integrationId: 'slack' }).outcome).toBe('allow')
  })

  it('lets a denial win over the always-ask policy', () => {
    setSafety({ alwaysAsk: ['messages.send'] })
    expect(evaluatePermission({ capability: 'messages.send', integrationId: 'slack' }).outcome).toBe('deny')
  })
})

describe('agents', () => {
  const grants = (...g: CapabilityGrant[]) => agent({ capabilities: g })

  it('denies, asks or defers to autonomy according to the grant', () => {
    db.insert('agents', grants({ capability: 'repo.write', mode: 'deny' }, { capability: 'shell.execute', mode: 'ask' }, { capability: 'repo.read', mode: 'allow' }))
    expect(evaluatePermission({ capability: 'repo.write', agentId: 'agt_forge' })).toEqual({ outcome: 'deny', reason: 'Forge is not allowed to modify code' })
    expect(evaluatePermission({ capability: 'shell.execute', agentId: 'agt_forge' })).toEqual({ outcome: 'ask', reason: 'Forge needs your approval to run commands' })
    expect(evaluatePermission({ capability: 'repo.read', agentId: 'agt_forge' })).toEqual({ outcome: 'allow', reason: 'Forge is allowed to read repositories' })
    expect(evaluatePermission({ capability: 'repo.read', agentId: 'agt_forge', risk: 'high' }).outcome).toBe('ask')
  })

  it('asks when the agent was never granted the capability', () => {
    db.insert('agents', grants())
    expect(evaluatePermission({ capability: 'web.search', agentId: 'agt_forge' })).toEqual({
      outcome: 'ask', reason: 'Forge has not been granted permission to search the web',
    })
  })

  it("uses the agent's autonomy instead of the default", () => {
    setSafety({ defaultAutonomy: 'supervised' })
    db.insert('agents', grants({ capability: 'shell.execute', mode: 'allow' }))
    db.update('agents', 'agt_forge', { autonomy: 'autonomous' })
    expect(evaluatePermission({ capability: 'shell.execute', agentId: 'agt_forge' }).outcome).toBe('allow')
    db.update('agents', 'agt_forge', { autonomy: 'supervised' })
    expect(evaluatePermission({ capability: 'shell.execute', agentId: 'agt_forge' })).toEqual({
      outcome: 'ask', reason: 'Forge is supervised and asks before it can run commands',
    })
  })

  it('asks when the agent no longer exists', () => {
    expect(evaluatePermission({ capability: 'knowledge.read', agentId: 'agt_gone' }).outcome).toBe('ask')
  })

  it('reports integration problems before agent grants', () => {
    db.insert('agents', grants({ capability: 'messages.send', mode: 'deny' }))
    expect(evaluatePermission({ capability: 'messages.send', agentId: 'agt_forge', integrationId: 'slack' }).reason).toBe('Slack is not connected')
  })
})

describe('environment overrides (previews)', () => {
  it('evaluates an unsaved configuration without touching the stores', () => {
    const preview = agent({ name: 'Draft', autonomy: 'autonomous', capabilities: [{ capability: 'shell.execute', mode: 'allow' }] })
    expect(evaluatePermission({ capability: 'shell.execute', agentId: 'agt_whatever' }, { agent: preview }).outcome).toBe('allow')
    expect(evaluatePermission({ capability: 'messages.send', integrationId: 'slack' }, { connection: connection() }).outcome).toBe('ask')
    expect(
      evaluatePermission({ capability: 'knowledge.read' }, { safety: { ...DEFAULT_SETTINGS.safety, alwaysAsk: ['knowledge.read'] } }).outcome,
    ).toBe('ask')
    expect(evaluatePermission({ capability: 'web.search', agentId: 'agt_gone' }, { agent: null }).outcome).toBe('allow')
  })
})

describe('helpers', () => {
  it('classifies capabilities that change things', () => {
    expect(['knowledge.write', 'messages.send', 'shell.execute', 'repo.pull_request', 'payments.spend', 'tasks.manage', 'workflows.run', 'media.generate'].every((c) => isMutatingCapability(c as Capability))).toBe(true)
    expect(['knowledge.read', 'web.search', 'web.browse', 'repo.read', 'files.read', 'data.query'].some((c) => isMutatingCapability(c as Capability))).toBe(false)
  })

  it('prefers the grant for the exact integration, then generic grants, then the most restrictive', () => {
    const g: CapabilityGrant[] = [
      { capability: 'messages.send', mode: 'allow', integrationId: 'slack' },
      { capability: 'messages.send', mode: 'deny', integrationId: 'gmail' },
    ]
    expect(findGrant(g, 'messages.send', 'slack')?.mode).toBe('allow')
    expect(findGrant(g, 'messages.send')?.mode).toBe('deny')
    expect(findGrant([...g, { capability: 'messages.send', mode: 'ask' }], 'messages.send', 'teams')?.mode).toBe('ask')
    expect(findGrant(g, 'web.search')).toBeUndefined()
  })
})

describe('always-allow grants', () => {
  it('lets an "Always allow" grant skip the autonomy check but not global always-ask', async () => {
    const { db: database } = await import('@/core/db')
    const { evaluatePermission: evaluate } = await import('./evaluate')
    const base = database.get('agents', 'agt_always')
    if (!base) {
      database.insert('agents', {
        id: 'agt_always', name: 'Ally', role: 'Coder', description: '', hue: 'sky', sigil: 1, modelId: 'sim-deep',
        instructions: '', knowledgeScope: { all: true, collectionIds: [], projectIds: [] }, autonomy: 'balanced',
        status: 'active', createdAt: 0, updatedAt: 0,
        capabilities: [{ capability: 'repo.write', mode: 'allow' }],
      })
    }
    // Plain allow: balanced autonomy still asks for a medium-risk capability.
    expect(evaluate({ capability: 'repo.write', agentId: 'agt_always' }).outcome).toBe('ask')
    database.update('agents', 'agt_always', (a) => ({ ...a, capabilities: [{ capability: 'repo.write', mode: 'allow', always: true }] }))
    expect(evaluate({ capability: 'repo.write', agentId: 'agt_always' }).outcome).toBe('allow')
    // Global always-ask still wins.
    setSafety({ alwaysAsk: ['messages.send'] })
    database.update('agents', 'agt_always', (a) => ({ ...a, capabilities: [{ capability: 'messages.send', mode: 'allow', always: true }] }))
    expect(evaluate({ capability: 'messages.send', agentId: 'agt_always' }).outcome).toBe('ask')
  })
})
