import { describe, expect, it, vi } from 'vitest'
import { getIntegration, INTEGRATIONS } from '@/core/integrations/catalog'
import type { IntegrationListItem, IntegrationStatus } from '@/core/services/integrations'
import type { IntegrationConnection } from '@/core/types'
import { configLabel, connectedToast, editLabel, keyWarning, modelsFact, submitLabel, whatsReal, whatsRealBody } from './copy'
import {
  alwaysAskNote,
  buildSections,
  catalogSummary,
  filterHref,
  filterTitle,
  matchesQuery,
  paneCounts,
  parseFilter,
  policyExplanation,
  sameFilter,
  simulatorMatches,
  statusWord,
  usageLine,
} from './logic'

const conn = (id: string, status: IntegrationConnection['status'], o: Partial<IntegrationConnection> = {}): IntegrationConnection => ({
  id,
  status,
  mode: 'simulated',
  scopes: [],
  config: {},
  usageCount: 0,
  ...o,
})

/** The catalog with a few connections: Slack and GitHub connected, Jira failing. */
function world(extra: Record<string, IntegrationConnection> = {}): IntegrationListItem[] {
  const rows: Record<string, IntegrationConnection> = {
    slack: conn('slack', 'connected', { lastUsedAt: 50 }),
    github: conn('github', 'connected', { mode: 'live', lastUsedAt: 90 }),
    jira: conn('jira', 'error', { error: 'Token expired' }),
    ...extra,
  }
  return INTEGRATIONS.map((def) => ({ def, connection: rows[def.id], status: (rows[def.id]?.status ?? 'available') as IntegrationStatus }))
}

describe('filters', () => {
  it('parses, links and names the catalog filters', () => {
    expect(parseFilter(new URLSearchParams(''))).toEqual({ kind: 'all' })
    expect(parseFilter(new URLSearchParams('filter=connected'))).toEqual({ kind: 'connected' })
    expect(parseFilter(new URLSearchParams('category=code'))).toEqual({ kind: 'category', category: 'code' })
    expect(parseFilter(new URLSearchParams('category=nope'))).toEqual({ kind: 'all' })
    expect(filterHref({ kind: 'category', category: 'data' })).toBe('/integrations?category=data')
    expect(filterHref({ kind: 'connected' })).toBe('/integrations?filter=connected')
    expect(filterTitle({ kind: 'category', category: 'models' })).toBe('AI models')
    expect(sameFilter({ kind: 'category', category: 'code' }, { kind: 'category', category: 'data' })).toBe(false)
    expect(sameFilter({ kind: 'all' }, { kind: 'all' })).toBe(true)
  })
})

describe('sections', () => {
  it('leads with AI models (with the Simulator), then Connected (errors first), then the catalog in category order', () => {
    const sections = buildSections(world(), { kind: 'all' })
    expect(sections.map((s) => s.id)).toEqual(['models', 'connected', 'catalog'])
    expect(sections[0]).toMatchObject({ simulator: true })
    expect(sections[0].items.map((i) => i.def.id)).toEqual(['anthropic', 'openai-compatible'])
    expect(sections[1].items.map((i) => i.def.id)).toEqual(['jira', 'github', 'slack'])
    const catalog = sections[2].items.map((i) => i.def.category)
    expect(catalog[0]).toBe('code')
    expect(catalog.at(-1)).toBe('cloud')
    expect(sections[2].items.some((i) => i.def.id === 'slack')).toBe(false)
  })

  it('narrows to one section for a filter, and search drops empty sections', () => {
    const connected = buildSections(world({ anthropic: conn('anthropic', 'connected', { mode: 'live' }) }), { kind: 'connected' })
    expect(connected).toHaveLength(1)
    expect(connected[0].items.map((i) => i.def.id)).toContain('anthropic')
    const models = buildSections(world(), { kind: 'category', category: 'models' })
    expect(models[0]).toMatchObject({ kind: 'models', simulator: true })
    const comms = buildSections(world(), { kind: 'category', category: 'communication' })
    expect(comms[0].items[0].def.id).toBe('slack')
    const search = buildSections(world(), { kind: 'all' }, 'send messages')
    expect(search.flatMap((s) => s.items.map((i) => i.def.id)).sort()).toEqual(['gmail', 'slack'])
    expect(search.some((s) => s.simulator)).toBe(false)
    expect(buildSections(world(), { kind: 'all' }, 'zzz')).toEqual([])
    expect(buildSections(world(), { kind: 'connected' }, 'figma')).toEqual([])
  })

  it('matches names, categories, capabilities and mode', () => {
    const slack = getIntegration('slack')!
    expect(matchesQuery(slack, 'SLACK')).toBe(true)
    expect(matchesQuery(slack, 'communication send')).toBe(true)
    expect(matchesQuery(slack, 'simulated')).toBe(true)
    expect(matchesQuery(getIntegration('github')!, 'live')).toBe(true)
    expect(matchesQuery(slack, 'github')).toBe(false)
    expect(simulatorMatches('swift')).toBe(true)
    expect(simulatorMatches('slack')).toBe(false)
  })

  it('counts the list pane (the Simulator is an AI model)', () => {
    const counts = paneCounts(world())
    expect(counts).toMatchObject({ all: INTEGRATIONS.length + 1, connected: 3, errors: 1 })
    expect(counts.byCategory.models).toBe(3)
    expect(catalogSummary(counts)).toBe('3 connected · 1 error')
  })
})

describe('words', () => {
  it('names statuses and usage', () => {
    expect(statusWord(getIntegration('anthropic')!, 'available')).toBe('Not connected')
    expect(statusWord(getIntegration('slack')!, 'available')).toBe('Available')
    expect(statusWord(getIntegration('slack')!, 'error')).toBe('Error')
    expect(usageLine(0, undefined)).toBe('Not used yet')
    expect(usageLine(1, undefined)).toBe('1 use')
    const now = Date.now()
    expect(usageLine(29, now - 2 * 3_600_000, now)).toBe('29 uses · 2h ago')
  })

  it('explains each policy the way the permission engine applies it', () => {
    expect(policyExplanation('Slack', 'messages.send', 'deny')).toBe('Blocked. Runs that try to send messages through Slack stop at that step.')
    expect(policyExplanation('Slack', 'messages.send', 'ask')).toMatch(/waits for your approval in Needs you/)
    expect(policyExplanation('GitHub', 'repo.read', 'allow')).toMatch(/without asking here/)
    expect(alwaysAskNote('repo.pull_request')).toBe('Your safety settings always ask before runs open pull requests.')
  })

  it('writes the key warning, honest notes and labels (§6.11, §8.4)', () => {
    expect(keyWarning(getIntegration('anthropic')!)).toBe(
      'Your key is stored only in this browser and sent directly to Anthropic. Anyone with access to this browser profile can use it. Use a key with a spending limit.',
    )
    expect(keyWarning(getIntegration('openai-compatible')!, 'http://localhost:11434/v1')).toMatch(/sent directly to localhost:11434\./)
    expect(keyWarning(getIntegration('openai-compatible')!)).toMatch(/sent directly to your endpoint\./)
    expect(keyWarning(getIntegration('slack')!)).toBeUndefined()
    expect(whatsReal(getIntegration('slack')!)).toMatch(/^Simulated\. Atrium emulates Slack locally/)
    expect(whatsRealBody(getIntegration('sandbox')!)).toMatch(/^Terminal output/)
    expect(whatsRealBody(getIntegration('github')!)).toBe(getIntegration('github')!.supportNote)
    expect(whatsReal(getIntegration('openai-compatible')!)).toMatch(/^Live\. Calls your base URL\/chat\/completions/)
    expect(whatsReal(getIntegration('openai-compatible')!, 'http://localhost:11434/v1/')).toMatch(/Calls http:\/\/localhost:11434\/v1\/chat\/completions/)
    expect(submitLabel(getIntegration('anthropic')!, false)).toBe('Save key and connect')
    expect(submitLabel(getIntegration('anthropic')!, true)).toBe('Replace key')
    expect(editLabel(getIntegration('github')!, false)).toBe('Add a token')
    expect(modelsFact(getIntegration('anthropic')!)).toBe('Adds 4 Claude models to every model picker')
    expect(configLabel('defaultChannel')).toBe('Default channel')
    expect(configLabel('timeout_minutes')).toBe('Timeout minutes')
    expect(connectedToast(getIntegration('slack')!, conn('slack', 'connected'))).toEqual({
      title: 'Slack connected (simulated)',
      description: 'Simulated — nothing leaves your browser.',
    })
  })
})

describe('manifest commands (⌘K)', () => {
  it('offers every catalog entry with its live status, plus model and filter shortcuts', async () => {
    const { db, emptyTables } = await import('@/core/db')
    const { manifest } = await import('./manifest')
    db.replaceAll(emptyTables())
    db.insert('connections', { id: 'jira', status: 'error', mode: 'simulated', scopes: [], config: {}, usageCount: 0, error: 'Token expired' })
    db.insert('connections', { id: 'slack', status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0 })
    const navigate = vi.fn()
    const close = vi.fn()
    const commands = manifest.commands!({ navigate, close, scopeProjectId: null, pathname: '/' })
    const byId = Object.fromEntries(commands.map((c) => [c.id, c]))
    expect(commands.filter((c) => c.id.startsWith('integrations.open.'))).toHaveLength(INTEGRATIONS.length)
    expect(byId['integrations.open.slack'].subtitle).toBe('Integration · Connected · simulated')
    expect(byId['integrations.open.jira'].subtitle).toBe('Integration · Error: Token expired')
    expect(byId['integrations.open.github'].subtitle).toBe('Integration · Available · live')
    expect(byId['integrations.open.slack'].keywords).toContain('send messages')
    await byId['integrations.connect-anthropic'].run({ navigate, close, scopeProjectId: null, pathname: '/' })
    expect(close).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/integrations/anthropic')
  })
})
