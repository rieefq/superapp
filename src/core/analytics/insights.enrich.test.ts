import { describe, expect, it } from 'vitest'
import type { RunStep } from '@/core/types'
import { at, cost, DAY, finished, HOUR, MIN, mkAgent, mkApproval, mkRun, mkWorkflow, SEC, useTimeZone } from './fixtures.test-utils'
import { comparisonLabel, parseRangeToken, rangeLabel, rangeToken } from './format'
import { APPROVAL_WAIT_BUCKETS, computeInsights, failedStepOf, matchesProvider, RUN_KINDS, type InsightsInput } from './insights'
import { localHoursBetween, startOfLocalHour } from './time'

useTimeZone('UTC')

const NOW = at('2026-06-15T12:00:00Z')

function insights(partial: Partial<InsightsInput> = {}) {
  return computeInsights({ runs: [], approvals: [], tasks: [], agents: [], workflows: [], now: NOW, rangeDays: 7, ...partial })
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

const step = (o: Partial<RunStep> & { id: string }): RunStep => ({ kind: 'tool', title: o.id, status: 'done', ...o })

describe('provider filter', () => {
  const runs = [
    finished({ id: 'live', start: NOW - 2 * HOUR, simulated: false, usage: cost(0.4, 1000, 500), agentId: 'agt_a' }),
    finished({ id: 'sim1', start: NOW - 3 * HOUR, simulated: true, usage: cost(0.1, 100, 50), agentId: 'agt_a' }),
    finished({ id: 'sim2', start: NOW - 4 * HOUR, simulated: true, status: 'failed', error: 'Timeout', usage: cost(0.2) }),
  ]

  it('counts live and simulated runs apart in the totals', () => {
    const t = insights({ runs }).totals
    expect(t).toMatchObject({ runs: 3, liveRuns: 1, simulatedRuns: 2, liveTokens: 1500, liveCostUsd: 0.4, simulatedCostUsd: 0.3 })
  })

  it('keeps only live or only simulated runs when asked', () => {
    expect(insights({ runs, provider: 'live' }).totals).toMatchObject({ runs: 1, simulatedRuns: 0, costUsd: 0.4 })
    expect(insights({ runs, provider: 'simulated' }).totals).toMatchObject({ runs: 2, liveRuns: 0, failed: 1 })
    expect(insights({ runs, provider: 'all' }).totals.runs).toBe(3)
    expect(matchesProvider({ simulated: true }, 'live')).toBe(false)
    expect(matchesProvider({ simulated: false }, undefined)).toBe(true)
  })

  it('treats a provider filter as filtered: idle agents are not listed', () => {
    const agents = [mkAgent({ id: 'agt_a', name: 'Ada' }), mkAgent({ id: 'agt_idle', name: 'Idle' })]
    expect(insights({ runs, agents }).byAgent.map((a) => a.name)).toEqual(['Ada', 'Idle'])
    expect(insights({ runs, agents, provider: 'live' }).byAgent.map((a) => [a.name, a.runs])).toEqual([['Ada', 1]])
  })
})

describe('buckets', () => {
  it('uses daily buckets that mirror `daily` for multi-day ranges', () => {
    const runs = [finished({ id: 'a', start: NOW - DAY, usage: cost(0.5, 10, 5) })]
    const r = insights({ runs })
    expect(r.bucketUnit).toBe('day')
    expect(r.buckets.map((b) => b.start)).toEqual(r.daily.map((d) => d.day))
    expect(r.buckets[6]).toMatchObject({ runs: 1, succeeded: 1, tokens: 15, costUsd: 0.5, simulatedCostUsd: 0.5, liveCostUsd: 0, unit: 'day' })
    expect(r.buckets[6].end).toBe(r.buckets[7].start)
  })

  it('uses hourly buckets for the 24-hour range, partial at both ends', () => {
    const now = at('2026-06-15T12:30:00Z')
    const runs = [
      finished({ id: 'a', start: at('2026-06-15T09:10:00Z') }),
      mkRun({ id: 'b', status: 'running', createdAt: at('2026-06-15T09:40:00Z'), startedAt: at('2026-06-15T09:40:00Z') }),
      finished({ id: 'c', start: at('2026-06-14T12:40:00Z'), status: 'cancelled' }),
      finished({ id: 'old', start: at('2026-06-14T12:10:00Z') }),
    ]
    const r = insights({ runs, now, rangeDays: 1 })
    expect(r.bucketUnit).toBe('hour')
    expect(r.buckets).toHaveLength(25)
    expect(r.buckets[0]).toMatchObject({ start: at('2026-06-14T12:00:00Z'), partial: true, runs: 1, cancelled: 1 })
    expect(r.buckets[24]).toMatchObject({ start: at('2026-06-15T12:00:00Z'), partial: true })
    const nine = r.buckets.find((b) => b.start === at('2026-06-15T09:00:00Z'))
    expect(nine).toMatchObject({ runs: 2, succeeded: 1, active: 1, partial: false, end: at('2026-06-15T10:00:00Z') })
    expect(sum(r.buckets.map((b) => b.runs))).toBe(r.totals.runs)
    expect(r.totals.runs).toBe(3)
    // Daily buckets still exist for the same window.
    expect(r.daily).toHaveLength(2)
    expect(rangeLabel(1)).toBe('Last 24 hours')
    expect(comparisonLabel(1)).toBe('vs previous 24 hours')
  })

  it('aligns agent and workflow bucket series with the buckets', () => {
    const now = at('2026-06-15T12:30:00Z')
    const runs = [finished({ id: 'a', start: at('2026-06-15T11:05:00Z'), agentId: 'agt_a', workflowId: 'wfl_a' })]
    const r = insights({ runs, now, rangeDays: 1 })
    expect(r.byAgent[0].buckets).toHaveLength(r.buckets.length)
    expect(r.byAgent[0].buckets[23]).toBe(1)
    expect(r.byWorkflow[0].buckets[23]).toBe(1)
  })
})

describe('local hours', () => {
  it('floors to the local hour and lists hours between two instants', () => {
    expect(startOfLocalHour(at('2026-06-15T09:59:59Z'))).toBe(at('2026-06-15T09:00:00Z'))
    expect(localHoursBetween(at('2026-06-15T09:30:00Z'), at('2026-06-15T12:00:00Z'))).toEqual([
      at('2026-06-15T09:00:00Z'), at('2026-06-15T10:00:00Z'), at('2026-06-15T11:00:00Z'), at('2026-06-15T12:00:00Z'),
    ])
    expect(localHoursBetween(2, 1)).toEqual([])
  })
})

describe('by kind', () => {
  it('sums runs, tokens and costs per run kind, most tokens first', () => {
    const runs = [
      finished({ id: 'a', start: NOW - HOUR, kind: 'chat', usage: cost(0.01, 100, 100) }),
      finished({ id: 'b', start: NOW - HOUR, kind: 'code', usage: cost(0.2, 5000, 1000), simulated: false }),
      finished({ id: 'c', start: NOW - HOUR, kind: 'code', status: 'failed', usage: cost(0.1, 1000, 0) }),
    ]
    const r = insights({ runs })
    expect(r.byKind.map((k) => [k.kind, k.runs, k.tokens])).toEqual([['code', 2, 7000], ['chat', 1, 200]])
    expect(r.byKind[0]).toMatchObject({ succeeded: 1, failed: 1, liveCostUsd: 0.2, simulatedCostUsd: 0.1, costUsd: 0.3, simulatedRuns: 1, simulatedTokens: 1000 })
    expect(RUN_KINDS).toContain(r.byKind[1].kind)
  })
})

describe('approvals', () => {
  it('buckets resolved waits for the histogram and reports p90', () => {
    const approvals = [
      mkApproval({ id: 'a1', status: 'approved', createdAt: NOW - 2 * HOUR, resolvedAt: NOW - 2 * HOUR + 30 * SEC }),
      mkApproval({ id: 'a2', status: 'approved', createdAt: NOW - 2 * HOUR, resolvedAt: NOW - 2 * HOUR + 3 * MIN }),
      mkApproval({ id: 'a3', status: 'rejected', createdAt: NOW - 3 * HOUR, resolvedAt: NOW - 3 * HOUR + 20 * MIN }),
      mkApproval({ id: 'a4', status: 'approved', createdAt: NOW - 9 * HOUR, resolvedAt: NOW - 9 * HOUR + 5 * HOUR }),
      mkApproval({ id: 'p', status: 'pending', createdAt: NOW - 10 * MIN }),
      // Expired requests are not decisions.
      mkApproval({ id: 'x', status: 'expired', createdAt: NOW - 3 * HOUR, resolvedAt: NOW - HOUR }),
    ]
    const r = insights({ approvals })
    expect(r.approvalWaits.map((b) => b.key)).toEqual(APPROVAL_WAIT_BUCKETS.map((b) => b.key))
    expect(r.approvalWaits.map((b) => b.count)).toEqual([1, 1, 0, 1, 0, 1])
    expect(sum(r.approvalWaits.map((b) => b.count))).toBe(r.totals.approvalsResolved)
    expect(r.totals).toMatchObject({ approvalsResolved: 4, approvalsPending: 1, approvalsAsked: 6 })
    expect(r.totals.p90ApprovalWaitMs).toBeGreaterThan(r.totals.medianApprovalWaitMs ?? Infinity)
  })

  it('counts the approvals each agent asked for', () => {
    const runs = [finished({ id: 'run_a', start: NOW - DAY, agentId: 'agt_a' }), finished({ id: 'run_b', start: NOW - DAY, agentId: 'agt_b' })]
    const approvals = [
      mkApproval({ id: 'a1', runId: 'run_a', createdAt: NOW - DAY + MIN }),
      mkApproval({ id: 'a2', runId: 'run_a', createdAt: NOW - DAY + 2 * MIN, status: 'approved', resolvedAt: NOW - DAY + 3 * MIN }),
      mkApproval({ id: 'old', runId: 'run_b', createdAt: NOW - 20 * DAY }),
    ]
    const agents = [mkAgent({ id: 'agt_a', name: 'Ada' }), mkAgent({ id: 'agt_b', name: 'Bo' })]
    const r = insights({ runs, approvals, agents })
    expect(r.byAgent.find((a) => a.agentId === 'agt_a')?.approvalsAsked).toBe(2)
    expect(r.byAgent.find((a) => a.agentId === 'agt_b')?.approvalsAsked).toBe(0)
  })
})

describe('agents and workflows', () => {
  it('reports each agent’s last failure (within the filters, at any time) and latest outcomes', () => {
    const runs = [
      finished({ id: 'r1', start: NOW - 30 * DAY, agentId: 'agt_a', status: 'failed', error: 'Old: quota exceeded' }),
      finished({ id: 'r2', start: NOW - 2 * DAY, agentId: 'agt_a', status: 'failed', error: 'Error: Notion API returned 429. Retried 3 times.' }),
      finished({ id: 'r3', start: NOW - DAY, agentId: 'agt_a' }),
      mkRun({ id: 'r4', agentId: 'agt_a', status: 'running', createdAt: NOW - HOUR, startedAt: NOW - HOUR }),
    ]
    const r = insights({ runs, agents: [mkAgent({ id: 'agt_a', name: 'Ada' })] })
    const ada = r.byAgent[0]
    expect(ada.lastFailure).toEqual({ at: NOW - 2 * DAY + 10 * SEC, reason: 'Notion API returned 429', runId: 'r2' })
    expect(ada.recent).toEqual(['failed', 'succeeded', 'running'])
    expect(insights({ runs, agents: [mkAgent({ id: 'agt_a' })], kinds: ['chat'] }).byAgent).toEqual([])
  })

  it('finds the node a workflow fails on most often and its latest run', () => {
    const failing = (id: string, start: number, nodeId: string | undefined, title: string) =>
      finished({ id, start, workflowId: 'wfl_a', status: 'failed', error: 'boom', steps: [step({ id: `${id}_s1` }), step({ id: `${id}_s2`, status: 'failed', nodeId, title })] })
    const runs = [
      failing('w1', NOW - 3 * DAY, 'n_post', 'Posted to Slack'),
      failing('w2', NOW - 2 * DAY, 'n_post', 'Posted to Slack'),
      failing('w3', NOW - DAY, undefined, 'Fetched the inbox'),
      finished({ id: 'w4', start: NOW - HOUR, workflowId: 'wfl_a', durationMs: 4 * SEC }),
    ]
    const workflows = [
      mkWorkflow({ id: 'wfl_a', name: 'Digest', nodes: [{ id: 'n_post', type: 'action', label: 'Post to #launch', position: { x: 0, y: 0 }, config: {} }] }),
    ]
    const wf = insights({ runs, workflows }).byWorkflow[0]
    expect(wf.failingNode).toEqual({ key: 'n_post', label: 'Post to #launch', count: 2 })
    expect(wf).toMatchObject({ successRate: 0.25, failureRate: 0.75, lastRunId: 'w4', lastRunStatus: 'succeeded', recent: ['failed', 'failed', 'failed', 'succeeded'] })
    expect(failedStepOf(runs[2])?.title).toBe('Fetched the inbox')
    expect(failedStepOf(runs[3])).toBeNull()
  })
})

describe('range tokens', () => {
  it('round-trips the URL tokens', () => {
    expect([1, 7, 30, 90].map(rangeToken)).toEqual(['24h', '7d', '30d', '90d'])
    expect(['24h', '7d', '30d', '90', 'x', '', null, '12h', '0d'].map(parseRangeToken)).toEqual([1, 7, 30, 90, null, null, null, null, null])
  })
})
