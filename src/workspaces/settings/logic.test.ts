import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/core/settings'
import { fx } from '@/core/services/testFixtures'
import type { Settings } from '@/core/types'
import {
  alwaysAllowGrants,
  budgetInputText,
  capabilitiesByRisk,
  checkEmail,
  checkName,
  formatBudget,
  grantsWithoutAlways,
  parseBudget,
  policyRows,
  speedLabel,
  speedOptions,
  toggleAlwaysAsk,
} from './logic'
import { getSection, searchSettings, SECTION_ALIASES, SECTIONS } from './sections'

const safety = (patch: Partial<Settings['safety']> = {}): Settings['safety'] => ({ ...DEFAULT_SETTINGS.safety, ...patch })

describe('policy preview (the real permission policy, no agent)', () => {
  it('orders capabilities high risk first', () => {
    const order = capabilitiesByRisk()
    expect(order).toHaveLength(17)
    expect(order.slice(0, 3).sort()).toEqual(['messages.send', 'payments.spend', 'repo.pull_request'])
    expect(order.at(-1)).toBe('media.generate')
  })

  it('balanced asks before medium and high risk, plus the always-ask list', () => {
    const rows = policyRows(safety({ defaultAutonomy: 'balanced', alwaysAsk: ['knowledge.read'] }))
    const asks = rows.filter((r) => r.decision.outcome === 'ask').map((r) => r.capability)
    expect(asks).toContain('shell.execute')
    expect(asks).toContain('payments.spend')
    expect(asks).toContain('knowledge.read')
    expect(asks).not.toContain('web.search')
    expect(rows.find((r) => r.capability === 'knowledge.read')).toMatchObject({ alwaysAsk: true })
    expect(rows.find((r) => r.capability === 'knowledge.read')!.decision.reason).toBe('Your safety settings require approval to read knowledge')
  })

  it('autonomous asks only before high risk; supervised before every change', () => {
    const autonomous = policyRows(safety({ defaultAutonomy: 'autonomous', alwaysAsk: [] })).filter((r) => r.decision.outcome === 'ask')
    expect(autonomous.map((r) => r.risk)).toEqual(['high', 'high', 'high'])
    const supervised = policyRows(safety({ defaultAutonomy: 'supervised', alwaysAsk: [] }))
    expect(supervised.find((r) => r.capability === 'knowledge.write')!.decision.outcome).toBe('ask')
    expect(supervised.find((r) => r.capability === 'knowledge.read')!.decision.outcome).toBe('allow')
  })

  it('toggles always-ask in catalog order without duplicates', () => {
    expect(toggleAlwaysAsk(['payments.spend'], 'knowledge.read', true)).toEqual(['knowledge.read', 'payments.spend'])
    expect(toggleAlwaysAsk(['knowledge.read', 'payments.spend'], 'knowledge.read', true)).toEqual(['knowledge.read', 'payments.spend'])
    expect(toggleAlwaysAsk(['knowledge.read', 'payments.spend'], 'payments.spend', false)).toEqual(['knowledge.read'])
  })
})

describe('always-allow grants', () => {
  const forge = fx.agent({
    id: 'agt_forge',
    name: 'Forge',
    capabilities: [
      { capability: 'shell.execute', mode: 'allow', integrationId: 'sandbox', always: true },
      { capability: 'repo.write', mode: 'allow', always: true },
      { capability: 'repo.read', mode: 'allow' },
    ],
  })
  const scout = fx.agent({ id: 'agt_scout', name: 'Scout', capabilities: [{ capability: 'web.search', mode: 'allow' }] })
  const archived = fx.agent({ id: 'agt_ally', name: 'Ally', capabilities: [{ capability: 'messages.send', mode: 'ask', always: true }] })

  it('lists only allow + always grants, grouped by agent and sorted by name', () => {
    const groups = alwaysAllowGrants([scout, forge, archived])
    expect(groups.map((g) => g.agent.name)).toEqual(['Forge'])
    expect(groups[0].grants.map((g) => g.capability)).toEqual(['shell.execute', 'repo.write'])
  })

  it('revoking one grant sends it back to ask and keeps every other grant as it was', () => {
    const next = grantsWithoutAlways(forge, 'shell.execute', 'sandbox')
    expect(next[0]).toEqual({ capability: 'shell.execute', mode: 'ask', integrationId: 'sandbox' })
    expect(next[1]).toEqual({ capability: 'repo.write', mode: 'allow', always: true })
    expect(next[2]).toEqual({ capability: 'repo.read', mode: 'allow' })
    // A grant for another integration is not touched.
    expect(grantsWithoutAlways(forge, 'shell.execute', 'github')[0]).toMatchObject({ mode: 'allow', always: true })
  })
})

describe('budget input', () => {
  it('parses dollars, rounds to cents and treats empty as off', () => {
    expect(parseBudget('$1,200')).toEqual({ ok: true, value: 1200 })
    expect(parseBudget(' 50.555 ')).toEqual({ ok: true, value: 50.56 })
    expect(parseBudget('')).toEqual({ ok: true, value: 0 })
    expect(parseBudget('50 USD')).toEqual({ ok: true, value: 50 })
  })

  it('rejects text, negatives and absurd amounts with a sentence', () => {
    expect(parseBudget('abc')).toMatchObject({ ok: false })
    expect(parseBudget('-5')).toMatchObject({ ok: false })
    expect(parseBudget('.')).toMatchObject({ ok: false })
    expect(parseBudget('1000000')).toMatchObject({ ok: false, error: expect.stringContaining('$100,000') })
  })

  it('formats for rows and inputs', () => {
    expect(formatBudget(50)).toBe('$50')
    expect(formatBudget(50.5)).toBe('$50.50')
    expect(formatBudget(0)).toBe('Off')
    expect(budgetInputText(50)).toBe('50')
    expect(budgetInputText(12.5)).toBe('12.50')
  })
})

describe('profile checks', () => {
  it('requires a name and collapses spaces', () => {
    expect(checkName('  Morgan   Lee ')).toEqual({ ok: true, value: 'Morgan Lee' })
    expect(checkName('   ')).toMatchObject({ ok: false })
    expect(checkName('x'.repeat(61))).toMatchObject({ ok: false })
  })

  it('treats email as optional and checks its shape', () => {
    expect(checkEmail('')).toEqual({ ok: true, value: undefined })
    expect(checkEmail(' morgan@northwind.example ')).toEqual({ ok: true, value: 'morgan@northwind.example' })
    expect(checkEmail('morgan@')).toMatchObject({ ok: false })
  })
})

describe('simulator speed', () => {
  it('offers 1×, 2×, 4× and keeps an unusual stored value visible', () => {
    expect(speedOptions(1)).toEqual([1, 2, 4])
    expect(speedOptions(8)).toEqual([1, 2, 4, 8])
    expect(speedOptions(0)).toEqual([1, 2, 4])
    expect(speedLabel(8)).toBe('8×')
    expect(speedLabel(1.5)).toBe('1.5×')
  })
})

describe('sections and Find a setting', () => {
  it('lists the ten sections in the spec order with unique setting anchors', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['profile', 'appearance', 'models', 'permissions', 'budgets', 'notifications', 'keyboard', 'simulator', 'data', 'about'])
    for (const s of SECTIONS) expect(new Set(s.settings.map((x) => x.id)).size).toBe(s.settings.length)
  })

  it('aliases resolve to real sections', () => {
    for (const target of Object.values(SECTION_ALIASES)) expect(getSection(target)).toBeDefined()
    expect(SECTION_ALIASES.safety).toBe('permissions')
  })

  it('finds settings by label, keyword and section, best first', () => {
    expect(searchSettings('theme')[0]).toMatchObject({ section: { id: 'appearance' }, setting: { id: 'theme' } })
    expect(searchSettings('dark')[0].setting?.id).toBe('theme')
    expect(searchSettings('api key')[0].setting?.id).toBe('providers')
    expect(searchSettings('budget').map((h) => h.setting?.id ?? h.section.id)).toEqual(expect.arrayContaining(['budgets', 'monthly-budget']))
    expect(searchSettings('erase')[0].setting?.id).toBe('erase')
    expect(searchSettings('   ')).toEqual([])
    expect(searchSettings('zzzz')).toEqual([])
  })

  it('needs every word to match', () => {
    const hits = searchSettings('reset demo')
    expect(hits[0].setting?.id).toBe('reset')
    expect(searchSettings('reset banana')).toEqual([])
  })
})
