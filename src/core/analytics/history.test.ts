import { describe, expect, it } from 'vitest'
import { at, cost, DAY, finished, HOUR, MIN, mkRun, SEC, useTimeZone } from './fixtures.test-utils'
import { failureFingerprint } from './failures'
import { modelKeyOf, queryRuns, recordDurationMs, runRecord, sortRunRecords, statusGroup, type RunRecord } from './history'

useTimeZone('UTC')

const NOW = at('2026-06-15T12:00:00Z')

const records: RunRecord[] = [
  runRecord(finished({ id: 'run_aaaaaaaa01', title: 'Weekly digest', start: NOW - DAY, kind: 'workflow', workflowId: 'wfl_digest', agentId: 'agt_herald', modelId: 'sim-deep', usage: cost(0.05, 900, 300), durationMs: 30 * SEC })),
  runRecord(finished({ id: 'run_aaaaaaaa02', title: 'Fix session refresh', start: NOW - 2 * HOUR, kind: 'code', agentId: 'agt_forge', projectId: 'prj_atlas', modelId: 'claude-sonnet-5-5', simulated: false, usage: cost(0.4, 9000, 2000), durationMs: 4 * MIN })),
  runRecord(finished({ id: 'run_aaaaaaaa03', title: 'Nightly knowledge sync', start: NOW - 3 * DAY, kind: 'agent', agentId: 'agt_archivist', status: 'failed', error: 'Notion API rate limited the sync (HTTP 429) after 3 retries; 18 pages fetched.', usage: cost(0.02) })),
  runRecord(mkRun({ id: 'run_aaaaaaaa04', title: 'Competitor teardown', kind: 'research', status: 'running', createdAt: NOW - 10 * MIN, startedAt: NOW - 10 * MIN, projectId: 'prj_landscape', modelId: 'sim-deep' })),
  runRecord(finished({ id: 'run_aaaaaaaa05', title: 'Old chat', start: NOW - 40 * DAY, kind: 'chat', status: 'cancelled', error: 'Stopped by you' })),
]

const ids = (rs: RunRecord[]) => rs.map((r) => r.id.slice(-2))

describe('queryRuns', () => {
  it('filters by window, project, kind, provider and status group', () => {
    expect(ids(queryRuns(records, { from: NOW - 7 * DAY, to: NOW }))).toEqual(['01', '02', '03', '04'])
    expect(ids(queryRuns(records, { projectId: 'prj_atlas' }))).toEqual(['02'])
    expect(ids(queryRuns(records, { kinds: ['agent', 'research'] }))).toEqual(['03', '04'])
    expect(ids(queryRuns(records, { kinds: [] }))).toHaveLength(5)
    expect(ids(queryRuns(records, { provider: 'live' }))).toEqual(['02'])
    expect(ids(queryRuns(records, { status: 'active' }))).toEqual(['04'])
    expect(ids(queryRuns(records, { status: 'cancelled' }))).toEqual(['05'])
    expect(statusGroup('waiting')).toBe('active')
  })

  it('drills into an agent, workflow, model, failure reason, slot or heatmap cell', () => {
    expect(ids(queryRuns(records, { agentId: 'agt_forge' }))).toEqual(['02'])
    expect(ids(queryRuns(records, { workflowId: 'wfl_digest' }))).toEqual(['01'])
    expect(ids(queryRuns(records, { modelKey: 'sim-deep|simulated' }))).toEqual(['01', '04'])
    expect(modelKeyOf(records[1])).toBe('claude-sonnet-5-5|live')
    const key = failureFingerprint(records[2].error!)
    expect(ids(queryRuns(records, { failureKey: key }))).toEqual(['03'])
    expect(ids(queryRuns(records, { slot: { start: NOW - 3 * HOUR, end: NOW } }))).toEqual(['02', '04'])
    const t = NOW - 2 * HOUR // Monday 10:00 UTC
    expect(ids(queryRuns(records, { weekday: 0, hour: new Date(t).getUTCHours() }))).toEqual(['02'])
  })

  it('searches title, handle, failure text and names', () => {
    expect(ids(queryRuns(records, { text: 'digest' }))).toEqual(['01'])
    expect(ids(queryRuns(records, { text: 'RUN-AAAA' }))).toHaveLength(5)
    expect(ids(queryRuns(records, { text: 'http 429' }))).toEqual(['03'])
    expect(ids(queryRuns(records, { text: 'herald' }, { agent: (id) => (id === 'agt_herald' ? 'Herald' : undefined) }))).toEqual(['01'])
    expect(ids(queryRuns(records, { text: 'sonnet' }, { model: (id) => (id === 'claude-sonnet-5-5' ? 'Claude Sonnet 5.5' : undefined) }))).toEqual(['02'])
    expect(ids(queryRuns(records, { text: 'teardown competitor' }))).toEqual(['04'])
    expect(queryRuns(records, { text: 'nothing like this' })).toEqual([])
  })
})

describe('records', () => {
  it('keeps the failure or stop reason and marks scripted runs retryable', () => {
    expect(records[2].error).toMatch(/HTTP 429/)
    expect(records[4].error).toBe('Stopped by you')
    expect(records[0].error).toBeUndefined()
    expect(records[0].retryable).toBe(false)
    const scripted = runRecord(mkRun({ id: 'run_s', script: { factory: 'x', params: {}, seed: 1, cursor: 0 } }))
    expect(scripted.retryable).toBe(true)
  })

  it('measures durations of finished runs and the elapsed time of active ones', () => {
    expect(recordDurationMs(records[1], NOW)).toBe(4 * MIN)
    expect(recordDurationMs(records[3], NOW)).toBe(10 * MIN)
    expect(recordDurationMs({ status: 'queued' }, NOW)).toBeNull()
  })
})

describe('sortRunRecords', () => {
  it('sorts by each column, missing values last, ties newest first', () => {
    expect(ids(sortRunRecords(records, 'started', 'desc', NOW))).toEqual(['04', '02', '01', '03', '05'])
    expect(ids(sortRunRecords(records, 'started', 'asc', NOW))).toEqual(['05', '03', '01', '02', '04'])
    expect(ids(sortRunRecords(records, 'cost', 'desc', NOW))).toEqual(['02', '01', '03', '04', '05'])
    expect(ids(sortRunRecords(records, 'tokens', 'asc', NOW)).slice(-2)).toEqual(['01', '02'])
    expect(ids(sortRunRecords(records, 'status', 'asc', NOW))).toEqual(['04', '03', '05', '02', '01'])
    expect(ids(sortRunRecords(records, 'title', 'asc', NOW))).toEqual(['04', '02', '03', '05', '01'])
    const byDuration = ids(sortRunRecords(records, 'duration', 'desc', NOW))
    expect(byDuration[0]).toBe('04')
    expect(sortRunRecords(records, 'kind', 'asc', NOW).map((r) => r.kind)).toEqual(['agent', 'chat', 'code', 'research', 'workflow'])
  })
})
