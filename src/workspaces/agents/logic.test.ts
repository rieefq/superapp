import { describe, expect, it } from 'vitest'
import type { Run } from '@/core/types'
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  agentWorksIn,
  applyBoardFilters,
  bandOf,
  bandRuns,
  fleetCounts,
  formatWhen,
  groupByRisk,
  hourlyBurn,
  parseBoardFilters,
  parseFleetStatus,
  runMatches,
  sortFleet,
} from './logic'

const NOW = new Date(2026, 10, 1, 12, 0, 0).getTime()
const HOUR = 3_600_000

function run(o: Partial<Run>): Run {
  return {
    id: 'run_a1b2c3d4', kind: 'agent', title: 'Summarize churn drivers', status: 'succeeded', projectId: null,
    initiator: { type: 'user', id: 'usr_me' }, steps: [], outputs: [], simulated: true,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, progress: 1, createdAt: NOW - HOUR, ...o,
  }
}

const AGENTS = [
  { id: 'agt_scout', name: 'Scout' },
  { id: 'agt_herald', name: 'Herald' },
]

describe('board filters', () => {
  it('parses the spec’s query parameters, with aliases and agent names', () => {
    const f = parseBoardFilters(new URLSearchParams('status=waiting&kind=coding&agent=scout&provider=simulated&since=7d&q=%20pricing%20'), AGENTS)
    expect(f).toEqual({ kind: 'code', owner: 'agt_scout', provider: 'sim', status: 'waiting', since: '7d', q: 'pricing' })
    expect(parseBoardFilters(new URLSearchParams('agent=Herald&status=done'), AGENTS)).toMatchObject({ owner: 'agt_herald', status: 'succeeded' })
    expect(parseBoardFilters(new URLSearchParams('agent=me&status=needs-you'), AGENTS)).toMatchObject({ owner: 'you', status: 'waiting' })
    expect(parseBoardFilters(new URLSearchParams('agent=nobody&kind=nope&since=forever'), AGENTS)).toEqual(DEFAULT_FILTERS)
  })

  it('writes filters back without touching other parameters', () => {
    const params = applyBoardFilters(new URLSearchParams('inspect=run:run_1&status=failed'), { ...DEFAULT_FILTERS, kind: 'research', q: 'tide' })
    expect(params.get('inspect')).toBe('run:run_1')
    expect(params.get('status')).toBeNull()
    expect(params.toString()).toBe('inspect=run%3Arun_1&kind=research&q=tide')
    expect(activeFilterCount({ ...DEFAULT_FILTERS, kind: 'research', q: 'tide' })).toBe(2)
  })

  it('matches runs by scope, kind, owner, provider, status, time and handle', () => {
    const r = run({ projectId: 'prj_a', agentId: 'agt_scout', endedAt: NOW - 3 * 24 * HOUR })
    expect(runMatches(r, DEFAULT_FILTERS, null, NOW)).toBe(true)
    expect(runMatches(r, DEFAULT_FILTERS, 'prj_b', NOW)).toBe(false)
    expect(runMatches(r, { ...DEFAULT_FILTERS, owner: 'you' }, null, NOW)).toBe(false)
    expect(runMatches(run({ agentId: undefined }), { ...DEFAULT_FILTERS, owner: 'you' }, null, NOW)).toBe(true)
    expect(runMatches(r, { ...DEFAULT_FILTERS, provider: 'live' }, null, NOW)).toBe(false)
    expect(runMatches(r, { ...DEFAULT_FILTERS, since: '24h' }, null, NOW)).toBe(false)
    // Active runs are happening now, whatever the window.
    expect(runMatches(run({ status: 'running', createdAt: NOW - 40 * 24 * HOUR }), { ...DEFAULT_FILTERS, since: '24h' }, null, NOW)).toBe(true)
    expect(runMatches(r, { ...DEFAULT_FILTERS, status: 'finished' }, null, NOW)).toBe(true)
    expect(runMatches(r, { ...DEFAULT_FILTERS, status: 'active' }, null, NOW)).toBe(false)
    expect(runMatches(r, { ...DEFAULT_FILTERS, q: 'CHURN' }, null, NOW)).toBe(true)
    expect(runMatches(r, { ...DEFAULT_FILTERS, q: 'run-a1b2' }, null, NOW)).toBe(true)
    expect(runMatches(r, { ...DEFAULT_FILTERS, q: 'pricing' }, null, NOW)).toBe(false)
  })
})

describe('bands', () => {
  it('assigns runs to bands, recent meaning the last 24 hours', () => {
    expect(bandOf(run({ status: 'waiting' }), NOW)).toBe('needs')
    expect(bandOf(run({ status: 'paused' }), NOW)).toBe('paused')
    expect(bandOf(run({ status: 'failed', endedAt: NOW - 2 * HOUR }), NOW)).toBe('recent')
    expect(bandOf(run({ status: 'succeeded', endedAt: NOW - 30 * HOUR }), NOW)).toBe('earlier')
  })

  it('orders needs-you by risk then age, and puts unopened failures first in recent', () => {
    const runs = [
      run({ id: 'w_low', status: 'waiting' }),
      run({ id: 'w_high_new', status: 'waiting' }),
      run({ id: 'w_high_old', status: 'waiting' }),
      run({ id: 'ok', status: 'succeeded', endedAt: NOW - HOUR }),
      run({ id: 'fail_seen', status: 'failed', endedAt: NOW - 10 * 60_000 }),
      run({ id: 'fail_new', status: 'failed', endedAt: NOW - 5 * HOUR }),
    ]
    const bands = bandRuns(runs, {
      now: NOW,
      unopenedFailed: new Set(['fail_new']),
      pending: new Map([
        ['w_low', { risk: 'low' as const, at: NOW - 9 * HOUR }],
        ['w_high_new', { risk: 'high' as const, at: NOW - HOUR }],
        ['w_high_old', { risk: 'high' as const, at: NOW - 2 * HOUR }],
      ]),
    })
    expect(bands.needs).toEqual(['w_high_old', 'w_high_new', 'w_low'])
    expect(bands.recent).toEqual(['fail_new', 'fail_seen', 'ok'])
  })

  it('estimates the running band’s hourly burn', () => {
    const burn = hourlyBurn([run({ status: 'running', startedAt: NOW - 30 * 60_000, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.1 } })], NOW)
    expect(burn.usd).toBeCloseTo(0.2)
    // A run that just started counts as five minutes old.
    expect(hourlyBurn([run({ status: 'running', startedAt: NOW - 10_000, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.01 } })], NOW).usd).toBeCloseTo(0.12)
    expect(burn.estimate).toBe(true)
    expect(hourlyBurn([run({ status: 'succeeded' })], NOW)).toEqual({ usd: 0, estimate: false })
  })
})

describe('fleet', () => {
  it('counts and sorts agents needs-you first', () => {
    const statuses = { a: 'idle', b: 'working', c: 'waiting', d: 'paused', e: 'attention' } as const
    const agents = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Bo' }, { id: 'c', name: 'Cy' }, { id: 'd', name: 'Di' }, { id: 'e', name: 'Ed' }]
    expect(sortFleet(agents, statuses).map((a) => a.id)).toEqual(['c', 'b', 'e', 'a', 'd'])
    expect(fleetCounts(['a', 'b', 'c', 'x'], statuses)).toEqual({ working: 1, waiting: 1, attention: 0, idle: 2, paused: 0 })
    expect(parseFleetStatus('needs-you')).toBe('waiting')
    expect(parseFleetStatus('archived')).toBe('archived')
    expect(parseFleetStatus('bogus')).toBeNull()
  })

  it('decides whether an agent works in a project', () => {
    const agent = { id: 'agt_1', knowledgeScope: { all: true, collectionIds: [], projectIds: [] } }
    expect(agentWorksIn(agent, 'prj_1', [], [])).toBe(false)
    expect(agentWorksIn(agent, 'prj_1', [{ agentId: 'agt_1', projectId: 'prj_1' }], [])).toBe(true)
    expect(agentWorksIn(agent, 'prj_1', [], [{ projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' } }])).toBe(true)
    expect(agentWorksIn({ ...agent, knowledgeScope: { all: false, collectionIds: [], projectIds: ['prj_1'] } }, 'prj_1', [], [])).toBe(true)
  })

  it('groups grants by risk, high first', () => {
    const risk = (c: string) => (c === 'messages.send' ? 'high' : c === 'data.query' ? 'medium' : 'low') as 'high' | 'medium' | 'low'
    const groups = groupByRisk([{ capability: 'knowledge.read' }, { capability: 'messages.send' }, { capability: 'data.query' }] as const, risk)
    expect(groups.map((g) => [g.risk, g.items.map((i) => i.index)])).toEqual([['high', [1]], ['medium', [2]], ['low', [0]]])
  })
})

describe('formats', () => {
  it('describes upcoming times relative to now', () => {
    expect(formatWhen(new Date(2026, 10, 1, 16, 0).getTime(), NOW)).toBe('today 16:00')
    expect(formatWhen(new Date(2026, 10, 2, 8, 0).getTime(), NOW)).toBe('tomorrow 08:00')
    expect(formatWhen(new Date(2026, 10, 5, 9, 30).getTime(), NOW)).toBe('Thu 09:30')
  })
})
