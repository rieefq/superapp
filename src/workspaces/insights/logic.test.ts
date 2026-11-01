import { describe, expect, it } from 'vitest'
import { percentDelta } from '@/core/analytics'
import type { ActivityEvent } from '@/core/types'
import {
  actorMatches, barShare, bucketLabel, bucketTitle, deltaPhrase, filterJournal, formatWait, journalExport, journalKinds, journalVerbs,
  outcomeLine, windowLabel,
} from './logic'
import { filterQuery, parseKind, parseProvider, parseRange, readFilters, resolveProject } from './state'
import { parseCell, parseSlot, parseSort, parseStatus } from './History'
import { summaryAfterActor } from './Journal'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const day = new Date(2026, 9, 28).getTime() // Wed, Oct 28 (local)

describe('labels', () => {
  it('labels hour and day buckets for axes and tables', () => {
    expect(bucketLabel({ start: day + 14 * HOUR, unit: 'hour' })).toBe('14:00')
    expect(bucketLabel({ start: day, unit: 'day' })).toBe('Oct 28')
    expect(bucketTitle({ start: day, end: day + DAY, unit: 'day', partial: false })).toBe('Wed, Oct 28')
    expect(bucketTitle({ start: day, end: day + DAY, unit: 'day', partial: true }, day + 5 * HOUR)).toBe('Wed, Oct 28 (today)')
    expect(bucketTitle({ start: day + 9 * HOUR, end: day + 10 * HOUR, unit: 'hour', partial: false })).toBe('Wed, Oct 28 · 09:00–10:00')
    expect(windowLabel(day - 7 * DAY, day, 7)).toBe('Oct 21 – Oct 28')
    expect(windowLabel(day - DAY + 30 * 60_000, day + 30 * 60_000, 1)).toBe('Oct 27 00:30 – Oct 28 00:30')
  })

  it('phrases deltas plainly, including an empty previous period', () => {
    expect(deltaPhrase(percentDelta(12, 10), 'vs previous 7 days')).toBe('+20% vs previous 7 days')
    expect(deltaPhrase(percentDelta(10, 10), 'vs previous 7 days')).toBe('No change vs previous 7 days')
    expect(deltaPhrase(percentDelta(3, 0), 'vs previous 90 days')).toBe('none in the previous 90 days')
    expect(deltaPhrase(null, 'vs previous 7 days')).toBeNull()
  })

  it('formats waits as spans, never clock times', () => {
    expect(formatWait(42_000)).toBe('42s')
    expect(formatWait(6 * 60_000)).toBe('6m')
    expect(formatWait(9 * 60_000 + 30_000)).toBe('9m 30s')
    expect(formatWait(HOUR + 12 * 60_000)).toBe('1h 12m')
    expect(formatWait(2 * HOUR)).toBe('2h')
    expect(formatWait(null)).toBe('—')
  })

  it('describes how runs ended and sizes bars', () => {
    expect(outcomeLine({ failed: 2, cancelled: 1, succeeded: 9 })).toBe('2 failed · 1 stopped')
    expect(outcomeLine({ failed: 0, cancelled: 0, succeeded: 9 })).toBe('No failures')
    expect(outcomeLine({ failed: 0, cancelled: 0, succeeded: 0 })).toBe('Nothing finished yet')
    expect(barShare(5, 10)).toBe(0.5)
    expect(barShare(0.0001, 10)).toBeGreaterThan(0)
    expect(barShare(0, 10)).toBe(0)
    expect(barShare(3, 0)).toBe(0)
  })
})

describe('journal', () => {
  const ev = (o: Partial<ActivityEvent> & { id: string; at: number }): ActivityEvent => ({
    actor: { type: 'user', id: 'usr_me' }, verb: 'created', target: { kind: 'task', id: 'tsk_1' }, summary: 'Created “A”', projectId: null, ...o,
  })
  const events = [
    ev({ id: 'e1', at: day + HOUR, projectId: 'prj_a' }),
    ev({ id: 'e2', at: day + 2 * HOUR, actor: { type: 'agent', id: 'agt_forge' }, verb: 'completed', target: { kind: 'run', id: 'run_1' }, summary: 'Forge completed “Fix”', projectId: 'prj_a' }),
    ev({ id: 'e3', at: day + 3 * HOUR, actor: { type: 'workflow', id: 'wfl_1' }, verb: 'started', target: { kind: 'run', id: 'run_2' }, summary: 'Support triage started “Ticket”' }),
    ev({ id: 'e4', at: day - 10 * DAY, summary: 'Created “Old”' }),
    ev({ id: 'e5', at: day + 4 * HOUR, actor: { type: 'system', id: 'system' }, verb: 'failed', target: { kind: 'integration', id: 'int_jira' }, summary: 'Jira sync failed: token expired' }),
  ]
  const q = { from: day - DAY, to: day + DAY, projectId: null, actor: 'all' as const, verb: null, kind: null }

  it('filters by window, project, actor, verb, kind and text, newest first', () => {
    expect(filterJournal(events, q).map((e) => e.id)).toEqual(['e5', 'e3', 'e2', 'e1'])
    expect(filterJournal(events, { ...q, projectId: 'prj_a' }).map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(filterJournal(events, { ...q, actor: 'me' }).map((e) => e.id)).toEqual(['e1'])
    expect(filterJournal(events, { ...q, actor: 'agents' }).map((e) => e.id)).toEqual(['e2'])
    expect(filterJournal(events, { ...q, actor: 'agent:agt_forge' }).map((e) => e.id)).toEqual(['e2'])
    expect(filterJournal(events, { ...q, actor: 'workflows' }).map((e) => e.id)).toEqual(['e3'])
    expect(filterJournal(events, { ...q, verb: 'started' }).map((e) => e.id)).toEqual(['e3'])
    expect(filterJournal(events, { ...q, kind: 'run' }).map((e) => e.id)).toEqual(['e3', 'e2'])
    expect(filterJournal(events, { ...q, text: 'token' }).map((e) => e.id)).toEqual(['e5'])
    expect(actorMatches({ type: 'system', id: 'system' }, 'system')).toBe(true)
    expect(actorMatches({ type: 'agent', id: 'agt_a' }, 'agent:agt_b')).toBe(false)
  })

  it('lists verbs and kinds by frequency', () => {
    expect(journalVerbs(events)[0]).toEqual({ verb: 'created', count: 2 })
    expect(journalKinds(events).map((k) => k.kind)).toEqual(['run', 'task', 'integration'])
  })

  it('exports what is shown, with its filters', () => {
    const json = JSON.parse(journalExport(events.slice(0, 2), { exportedAt: day, range: 'Last 7 days', project: 'All work', filters: { actor: 'all' } }))
    expect(json).toMatchObject({ kind: 'atrium.activity-journal', version: 1, count: 2, range: 'Last 7 days', project: 'All work', filters: { actor: 'all' } })
    expect(json.events[1]).toMatchObject({ id: 'e2', verb: 'completed', actor: { type: 'agent', id: 'agt_forge' }, target: { kind: 'run', id: 'run_1' } })
    expect(json.events[0].at).toBe(new Date(day + HOUR).toISOString())
  })

  it('reads summaries after the actor without repeating the name', () => {
    expect(summaryAfterActor('Completed “A”', 'You')).toBe('completed “A”')
    expect(summaryAfterActor('Forge requested approval: Run npm install', 'Forge')).toBe('requested approval: Run npm install')
    expect(summaryAfterActor('Support triage started “Ticket”', 'Support triage')).toBe('started “Ticket”')
    expect(summaryAfterActor('PR review assistant completed “PR review”', 'PR review assistant')).toBe('completed “PR review”')
    expect(summaryAfterActor('PR #48 opened', 'You')).toBe('PR #48 opened')
    expect(summaryAfterActor('Jira sync failed: token expired', 'Atrium', true)).toBe('— Jira sync failed: token expired')
  })
})

describe('URL state', () => {
  it('parses the range, provider and kind, with safe defaults', () => {
    expect(parseRange('24h')).toBe(1)
    expect(parseRange('30d')).toBe(30)
    expect(parseRange('90d')).toBe(90)
    expect(parseRange('14d')).toBe(7)
    expect(parseRange(null)).toBe(7)
    expect(parseProvider('live')).toBe('live')
    expect(parseProvider('nonsense')).toBe('all')
    expect(parseKind('code')).toBe('code')
    expect(parseKind('nope')).toBeNull()
  })

  it('follows the scope unless a project is chosen', () => {
    expect(resolveProject(null, 'prj_a')).toEqual({ projectId: 'prj_a', followsScope: true })
    expect(resolveProject(null, null)).toEqual({ projectId: null, followsScope: true })
    expect(resolveProject('all', 'prj_a')).toEqual({ projectId: null, followsScope: false })
    expect(resolveProject('prj_b', 'prj_a')).toEqual({ projectId: 'prj_b', followsScope: false })
    const f = readFilters(new URLSearchParams('range=30d&provider=simulated&kind=agent'), 'prj_a')
    expect(f).toEqual({ rangeDays: 30, projectId: 'prj_a', followsScope: true, provider: 'simulated', kind: 'agent' })
  })

  it('carries shared filters into links and drops view-specific ones', () => {
    const params = new URLSearchParams('range=30d&project=all&status=failed&q=x&page=3')
    expect(filterQuery(params)).toBe('?range=30d&project=all')
    expect(filterQuery(params, { agent: 'agt_a', status: 'failed' })).toBe('?range=30d&project=all&agent=agt_a&status=failed')
    expect(filterQuery(new URLSearchParams(), { agent: null })).toBe('')
  })

  it('parses history drill-downs', () => {
    expect(parseStatus('failed')).toBe('failed')
    expect(parseStatus('weird')).toBe('all')
    expect(parseSort('cost:asc')).toEqual({ key: 'cost', direction: 'asc' })
    expect(parseSort('bogus:asc')).toEqual({ key: 'started', direction: 'desc' })
    expect(parseSlot('100-200')).toEqual({ start: 100, end: 200 })
    expect(parseSlot('200-100')).toBeUndefined()
    expect(parseCell('0-9')).toEqual({ weekday: 0, hour: 9 })
    expect(parseCell('7-9')).toBeUndefined()
    expect(parseCell('1-24')).toBeUndefined()
  })
})
