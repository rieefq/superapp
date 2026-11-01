import { describe, expect, it } from 'vitest'
import { HUES, type Approval, type Run, type RunKind } from '@/core/types'
import { at, cost, DAY, finished, HOUR, mkAgent, mkApproval, mkRun, mkTask, mkWorkflow, SEC, useTimeZone } from './fixtures.test-utils'
import { computeInsights, RUN_KINDS, type InsightsInput } from './insights'

useTimeZone('UTC')

/** Monday 2026-06-15 12:00 UTC. 7-day window: [Jun 8 12:00, Jun 15 12:00]; previous: [Jun 1 12:00, Jun 8 12:00). */
const NOW = at('2026-06-15T12:00:00Z')
const FROM = NOW - 7 * DAY
const PREV_FROM = FROM - 7 * DAY

function insights(partial: Partial<InsightsInput> = {}) {
  return computeInsights({ runs: [], approvals: [], tasks: [], agents: [], workflows: [], now: NOW, rangeDays: 7, ...partial })
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

describe('window and daily buckets', () => {
  it('zero-fills every local day the window touches and flags partial edge days', () => {
    const r = insights()
    expect(r.window).toEqual({ rangeDays: 7, from: FROM, to: NOW, previousFrom: PREV_FROM, previousTo: FROM })
    expect(r.daily.map((d) => new Date(d.day).toISOString().slice(0, 10))).toEqual([
      '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14', '2026-06-15',
    ])
    expect(r.daily.map((d) => d.partial)).toEqual([true, false, false, false, false, false, false, true])
    for (const d of r.daily) {
      expect(d).toMatchObject({ runs: 0, succeeded: 0, failed: 0, costUsd: 0, tokens: 0 })
      expect(Object.keys(d.byKind).sort()).toEqual([...RUN_KINDS].sort())
      expect(sum(Object.values(d.byKind))).toBe(0)
    }
    expect(insights({ rangeDays: 30 }).daily).toHaveLength(31)
    expect(insights({ rangeDays: 90 }).daily).toHaveLength(91)
  })

  it('does not flag the first day when the window starts at midnight', () => {
    const r = insights({ now: at('2026-06-15T00:00:00Z') })
    expect(r.daily).toHaveLength(8)
    expect(r.daily[0].partial).toBe(false)
    expect(r.daily[7].partial).toBe(true)
  })

  it('buckets runs by the local day they started, falling back to creation', () => {
    const runs = [
      mkRun({ id: 'a', kind: 'agent', createdAt: at('2026-06-09T10:00:00Z'), startedAt: at('2026-06-09T10:00:00Z') }),
      mkRun({ id: 'b', kind: 'chat', createdAt: at('2026-06-09T23:59:59Z'), startedAt: at('2026-06-09T23:59:59Z') }),
      // Created on the 9th, started on the 10th: the start decides.
      mkRun({ id: 'c', kind: 'code', createdAt: at('2026-06-09T23:59:00Z'), startedAt: at('2026-06-10T00:00:00Z') }),
      // Queued (not started): the creation time decides.
      mkRun({ id: 'd', kind: 'research', status: 'queued', createdAt: at('2026-06-12T08:00:00Z') }),
      mkRun({
        id: 'e', kind: 'workflow', status: 'failed', createdAt: at('2026-06-15T11:00:00Z'), startedAt: at('2026-06-15T11:00:00Z'),
        usage: cost(0.5, 700, 300),
      }),
    ]
    const r = insights({ runs })
    expect(r.daily[1]).toMatchObject({ runs: 2, succeeded: 2, byKind: { agent: 1, chat: 1, code: 0 } })
    expect(r.daily[2]).toMatchObject({ runs: 1, byKind: { code: 1 } })
    expect(r.daily[4]).toMatchObject({ runs: 1, byKind: { research: 1 } })
    expect(r.daily[7]).toMatchObject({ runs: 1, failed: 1, costUsd: 0.5, tokens: 1000, byKind: { workflow: 1 } })
    expect(sum(r.daily.map((d) => d.runs))).toBe(r.totals.runs)
    expect(r.totals.runs).toBe(5)
  })

  it('counts runs in the current window inclusively and the previous window half-open', () => {
    const runs = [
      mkRun({ id: 'now', createdAt: NOW }),
      mkRun({ id: 'from', createdAt: FROM }),
      mkRun({ id: 'justBefore', createdAt: FROM - 1 }),
      mkRun({ id: 'prevFrom', createdAt: PREV_FROM }),
      mkRun({ id: 'tooOld', createdAt: PREV_FROM - 1 }),
      mkRun({ id: 'future', createdAt: NOW + 1 }),
    ]
    const r = insights({ runs })
    expect(r.totals.runs).toBe(2)
    expect(r.previous.runs).toBe(2)
    expect(r.daily[0].runs).toBe(1) // FROM itself lands in the partial first day
  })

  it('places runs on the weekday (Monday = 0) × hour heatmap', () => {
    const runs = [
      mkRun({ id: 'mon', createdAt: at('2026-06-15T11:30:00Z') }), // Monday
      mkRun({ id: 'sun', createdAt: at('2026-06-14T23:00:00Z') }), // Sunday
      mkRun({ id: 'sun2', createdAt: at('2026-06-14T23:59:00Z') }),
      mkRun({ id: 'old', createdAt: at('2026-06-01T09:00:00Z') }), // previous window: not on the heatmap
    ]
    const r = insights({ runs })
    expect(r.heatmap).toHaveLength(7)
    for (const row of r.heatmap) expect(row).toHaveLength(24)
    expect(r.heatmap[0][11]).toBe(1)
    expect(r.heatmap[6][23]).toBe(2)
    expect(sum(r.heatmap.flat())).toBe(r.totals.runs)
  })
})

describe('totals', () => {
  it('counts statuses; success rate ignores cancelled and active runs', () => {
    const t0 = at('2026-06-14T10:00:00Z')
    const runs = [
      finished({ id: 's1', start: t0 }), finished({ id: 's2', start: t0 }), finished({ id: 's3', start: t0 }),
      finished({ id: 'f1', start: t0, status: 'failed' }),
      finished({ id: 'c1', start: t0, status: 'cancelled' }),
      mkRun({ id: 'r1', status: 'running', createdAt: t0, startedAt: t0 }),
      mkRun({ id: 'w1', status: 'waiting', createdAt: t0, startedAt: t0 }),
      mkRun({ id: 'p1', status: 'paused', createdAt: t0, startedAt: t0 }),
    ]
    const { totals } = insights({ runs })
    expect(totals).toMatchObject({ runs: 8, succeeded: 3, failed: 1, cancelled: 1, active: 3, successRate: 0.75 })
    expect(insights({ runs: [finished({ id: 'c', start: t0, status: 'cancelled' })] }).totals.successRate).toBeNull()
    expect(insights().totals).toMatchObject({ runs: 0, successRate: null, medianDurationMs: null, p90DurationMs: null, medianApprovalWaitMs: null })
  })

  it('keeps live costs and simulated estimates apart', () => {
    const t0 = at('2026-06-14T10:00:00Z')
    const runs = [
      finished({ id: 'live', start: t0, simulated: false, usage: cost(1.5, 1000, 200) }),
      finished({ id: 'sim1', start: t0, simulated: true, usage: cost(0.25, 400, 100) }),
      finished({ id: 'sim2', start: t0, simulated: true, usage: cost(0.05, 10, 5) }),
    ]
    const { totals } = insights({ runs })
    expect(totals.costUsd).toBeCloseTo(1.8)
    expect(totals.liveCostUsd).toBeCloseTo(1.5)
    expect(totals.simulatedCostUsd).toBeCloseTo(0.3)
    expect(totals).toMatchObject({ simulatedRuns: 2, inputTokens: 1410, outputTokens: 305, tokens: 1715 })
  })

  it('computes median and p90 durations over succeeded and failed runs only', () => {
    const t0 = at('2026-06-14T10:00:00Z')
    const runs = [
      finished({ id: 'a', start: t0, durationMs: 10 * SEC }),
      finished({ id: 'b', start: t0, durationMs: 20 * SEC, status: 'failed' }),
      finished({ id: 'c', start: t0, durationMs: 30 * SEC }),
      finished({ id: 'd', start: t0, durationMs: 40 * SEC }),
      finished({ id: 'cancelled', start: t0, durationMs: 1000 * SEC, status: 'cancelled' }),
      mkRun({ id: 'running', status: 'running', createdAt: t0, startedAt: t0 }),
      // Never started (no startedAt): no duration even though it has an end.
      mkRun({ id: 'unstarted', status: 'failed', createdAt: t0, endedAt: t0 + 500 * SEC }),
    ]
    const { totals } = insights({ runs })
    expect(totals.medianDurationMs).toBe(25 * SEC)
    expect(totals.p90DurationMs).toBeCloseTo(37 * SEC)
  })

  it('computes the same totals for the previous window, for deltas', () => {
    const runs = [
      finished({ id: 'cur', start: at('2026-06-14T10:00:00Z'), usage: cost(1) }),
      finished({ id: 'prev1', start: at('2026-06-05T10:00:00Z'), usage: cost(2), durationMs: 60 * SEC }),
      finished({ id: 'prev2', start: at('2026-06-02T10:00:00Z'), status: 'failed', durationMs: 20 * SEC }),
    ]
    const r = insights({ runs })
    expect(r.totals).toMatchObject({ runs: 1, succeeded: 1, successRate: 1, costUsd: 1 })
    expect(r.previous).toMatchObject({ runs: 2, succeeded: 1, failed: 1, successRate: 0.5, costUsd: 2, medianDurationMs: 40 * SEC })
  })

  it('counts tasks completed in each window, scoped by project', () => {
    const tasks = [
      mkTask({ id: 't1', status: 'done', completedAt: NOW - DAY, projectId: 'prj_a' }),
      mkTask({ id: 't2', status: 'done', completedAt: NOW - 10 * DAY, projectId: 'prj_a' }),
      mkTask({ id: 't3', status: 'done', completedAt: NOW - 2 * DAY, projectId: 'prj_b' }),
      mkTask({ id: 't4', status: 'todo', completedAt: NOW - DAY }), // reopened
      mkTask({ id: 't5', status: 'done' }), // no completion time
    ]
    expect(insights({ tasks }).totals.tasksCompleted).toBe(2)
    expect(insights({ tasks }).previous.tasksCompleted).toBe(1)
    expect(insights({ tasks, projectId: 'prj_a' }).totals.tasksCompleted).toBe(1)
    // A kinds filter does not apply to tasks.
    expect(insights({ tasks, kinds: ['chat'] }).totals.tasksCompleted).toBe(2)
  })

  it('reports the approval backlog at each window end, decisions in each window and the median wait', () => {
    const approvals: Approval[] = [
      mkApproval({ id: 'a1', status: 'pending', createdAt: NOW - 2 * DAY }),
      mkApproval({ id: 'a2', status: 'pending', createdAt: NOW - 10 * DAY }),
      mkApproval({ id: 'a3', status: 'approved', createdAt: NOW - 9 * DAY, resolvedAt: NOW - 8 * DAY }),
      mkApproval({ id: 'a4', status: 'rejected', createdAt: NOW - 3 * HOUR, resolvedAt: NOW - HOUR }),
      mkApproval({ id: 'a5', status: 'approved', createdAt: NOW - 5 * HOUR, resolvedAt: NOW - 4 * HOUR }),
      mkApproval({ id: 'a6', status: 'expired', createdAt: NOW - DAY, resolvedAt: NOW - 12 * HOUR }),
      mkApproval({ id: 'a7', status: 'approved', createdAt: NOW - 7.5 * DAY, resolvedAt: NOW - 6 * DAY }),
    ]
    const r = insights({ approvals })
    expect(r.totals).toMatchObject({ approvalsPending: 2, approvalsResolved: 3, medianApprovalWaitMs: 2 * HOUR })
    expect(r.previous).toMatchObject({ approvalsPending: 2, approvalsResolved: 1, medianApprovalWaitMs: DAY })
  })
})

describe('breakdowns', () => {
  const t = (iso: string) => at(iso)

  it('splits model usage into live and simulated rows, sorted by cost', () => {
    const runs = [
      finished({ id: 'l1', start: t('2026-06-14T10:00:00Z'), modelId: 'claude-sonnet-5-5', simulated: false, usage: cost(1, 100, 10) }),
      finished({ id: 'l2', start: t('2026-06-14T11:00:00Z'), modelId: 'claude-sonnet-5-5', simulated: false, usage: cost(1, 100, 10) }),
      finished({ id: 's1', start: t('2026-06-14T12:00:00Z'), modelId: 'claude-sonnet-5-5', simulated: true, usage: cost(3) }),
      finished({ id: 'x1', start: t('2026-06-14T12:00:00Z'), modelId: 'sim-swift' }),
      finished({ id: 'x2', start: t('2026-06-14T12:00:00Z'), modelId: 'sim-swift' }),
      finished({ id: 'n1', start: t('2026-06-14T12:00:00Z') }),
      finished({ id: 'o1', start: t('2026-06-14T12:00:00Z'), modelId: 'oai:llama3.2', simulated: false }),
    ]
    const r = insights({ runs })
    expect(r.byModel.map((m) => [m.label, m.simulated, m.runs, m.costUsd])).toEqual([
      ['Claude Sonnet 5.5', true, 1, 3],
      ['Claude Sonnet 5.5', false, 2, 2],
      ['Simulator · Swift', true, 2, 0],
      ['oai:llama3.2', false, 1, 0],
      ['Unknown model', true, 1, 0],
    ])
    expect(r.byModel[1]).toMatchObject({ modelId: 'claude-sonnet-5-5', inputTokens: 200, outputTokens: 20, tokens: 220 })
    expect(new Set(r.byModel.map((m) => m.key)).size).toBe(r.byModel.length)
    expect(sum(r.byModel.map((m) => m.runs))).toBe(r.totals.runs)

    const custom = insights({ runs, modelLabel: (id) => (id.startsWith('oai:') ? `${id.slice(4)} · custom endpoint` : undefined) })
    expect(custom.byModel.map((m) => m.label)).toContain('llama3.2 · custom endpoint')
    expect(custom.byModel.map((m) => m.label)).toContain('claude-sonnet-5-5') // resolver had no label: falls back to the id
  })

  it('summarizes agents with sparklines aligned to the daily buckets', () => {
    const agents = [
      mkAgent({ id: 'agt_scout', name: 'Scout', hue: 'sky' }),
      mkAgent({ id: 'agt_herald', name: 'Herald' }),
      mkAgent({ id: 'agt_old', name: 'Old', status: 'archived' }),
      mkAgent({ id: 'agt_muse', name: 'Muse', status: 'archived' }),
    ]
    const runs: Run[] = [
      finished({ id: 'a1', agentId: 'agt_scout', start: t('2026-06-09T10:00:00Z'), durationMs: 10 * SEC, usage: cost(0.1, 50, 50) }),
      finished({ id: 'a2', agentId: 'agt_scout', start: t('2026-06-09T12:00:00Z'), durationMs: 30 * SEC, usage: cost(0.2) }),
      finished({ id: 'a3', agentId: 'agt_scout', start: t('2026-06-15T09:00:00Z'), durationMs: 20 * SEC, status: 'failed' }),
      finished({ id: 'a4', agentId: 'agt_scout', start: t('2026-06-15T10:00:00Z'), status: 'cancelled' }),
      finished({ id: 'h1', agentId: 'agt_herald', start: t('2026-05-20T10:00:00Z') }), // outside both windows
      finished({ id: 'm1', agentId: 'agt_muse', start: t('2026-06-12T10:00:00Z'), simulated: false }),
      finished({ id: 'g1', agentId: 'agt_gone', start: t('2026-06-13T10:00:00Z') }),
    ]
    const r = insights({ runs, agents })
    expect(r.byAgent.map((a) => a.name)).toEqual(['Scout', 'Deleted agent', 'Muse', 'Herald'])
    const scout = r.byAgent[0]
    expect(scout).toMatchObject({
      agentId: 'agt_scout', hue: 'sky', deleted: false, runs: 4, succeeded: 2, failed: 1, successRate: 2 / 3,
      avgDurationMs: 20 * SEC, costIsEstimate: true, tokens: 100, lastRunAt: t('2026-06-15T10:00:00Z'),
    })
    expect(scout.costUsd).toBeCloseTo(0.3)
    expect(scout.daily).toEqual([0, 2, 0, 0, 0, 0, 0, 2])
    expect(scout.daily).toHaveLength(r.daily.length)
    expect(r.byAgent[1]).toMatchObject({ agentId: 'agt_gone', deleted: true, runs: 1 })
    expect(HUES).toContain(r.byAgent[1].hue)
    expect(r.byAgent[2]).toMatchObject({ name: 'Muse', costIsEstimate: false, daily: [0, 0, 0, 0, 1, 0, 0, 0] })
    // Idle agents keep their last run (outside the window) and zero stats.
    expect(r.byAgent[3]).toMatchObject({ name: 'Herald', runs: 0, successRate: null, avgDurationMs: null, lastRunAt: t('2026-05-20T10:00:00Z') })

    // Filtered views only list agents that ran in scope.
    expect(insights({ runs, agents, kinds: ['agent'] }).byAgent.map((a) => a.name)).toEqual(['Scout', 'Deleted agent', 'Muse'])
    expect(insights({ runs, agents, kinds: ['chat'] }).byAgent).toEqual([])
  })

  it('summarizes workflows with failure rates', () => {
    const workflows = [mkWorkflow({ id: 'wfl_triage', name: 'Support triage' }), mkWorkflow({ id: 'wfl_digest', name: 'Digest', hue: 'amber' })]
    const runs = [
      ...['w1', 'w2', 'w3'].map((id, i) => finished({ id, kind: 'workflow', workflowId: 'wfl_triage', start: t('2026-06-10T10:00:00Z') + i * HOUR, durationMs: 4 * SEC })),
      finished({ id: 'w4', kind: 'workflow', workflowId: 'wfl_triage', start: t('2026-06-11T10:00:00Z'), status: 'failed', durationMs: 8 * SEC }),
    ]
    const r = insights({ runs, workflows })
    expect(r.byWorkflow.map((w) => [w.name, w.runs, w.failureRate])).toEqual([
      ['Support triage', 4, 0.25],
      ['Digest', 0, null],
    ])
    expect(r.byWorkflow[0]).toMatchObject({ avgDurationMs: 5 * SEC, lastRunAt: t('2026-06-11T10:00:00Z'), deleted: false })
    expect(r.byWorkflow[1]).toMatchObject({ hue: 'amber', lastRunAt: null, daily: new Array(8).fill(0) })
    expect(insights({ runs, workflows, projectId: 'prj_other' }).byWorkflow).toEqual([])
  })

  it('groups failure reasons, newest example first', () => {
    const fail = (id: string, iso: string, o: Partial<Run> = {}) =>
      finished({ id, status: 'failed', start: t(iso), durationMs: 5 * SEC, ...o })
    const runs = [
      fail('slack1', '2026-06-10T10:00:00Z', { error: 'Slack is not connected. Connect it in Integrations and run again.' }),
      fail('slack2', '2026-06-14T10:00:00Z', { error: 'Slack is not connected.' }),
      fail('node1', '2026-06-11T10:00:00Z', { error: '“Draft reply” has no available agent.' }),
      fail('node2', '2026-06-12T10:00:00Z', { error: '“Classify” has no available agent.', simulated: false }),
      fail('step', '2026-06-13T10:00:00Z', {
        steps: [{ id: 's', kind: 'tool', title: 'Query', status: 'failed', error: 'The query timed out (simulated).' }],
      }),
      finished({ id: 'cancelled', status: 'cancelled', start: t('2026-06-13T10:00:00Z'), error: 'Rejected by you' }),
      fail('previous', '2026-06-03T10:00:00Z', { error: 'Old failure' }),
    ]
    const r = insights({ runs })
    expect(r.failureReasons.map((f) => [f.reason, f.count, f.simulated])).toEqual([
      ['Slack is not connected', 2, true],
      ['“Classify” has no available agent', 2, false],
      ['The query timed out (simulated)', 1, true],
    ])
    expect(r.failureReasons[0]).toMatchObject({ exampleRunId: 'slack2', runIds: ['slack2', 'slack1'], lastAt: t('2026-06-14T10:00:00Z') + 5 * SEC })
    expect(r.failureReasons[1]).toMatchObject({ exampleRunId: 'node2', runIds: ['node2', 'node1'] })
    expect(sum(r.failureReasons.map((f) => f.count))).toBe(r.totals.failed)
  })
})

describe('filters', () => {
  const t0 = at('2026-06-14T10:00:00Z')
  const runs = [
    finished({ id: 'a-agent', projectId: 'prj_a', kind: 'agent', start: t0 }),
    finished({ id: 'a-code', projectId: 'prj_a', kind: 'code', start: t0 }),
    finished({ id: 'b-chat', projectId: 'prj_b', kind: 'chat', start: t0 }),
    finished({ id: 'none-agent', projectId: null, kind: 'agent', start: t0 }),
  ]
  const approvals = [
    mkApproval({ id: 'ap-a', runId: 'a-agent', createdAt: t0 }),
    mkApproval({ id: 'ap-b', runId: 'b-chat', createdAt: t0 }),
    mkApproval({ id: 'ap-orphan', runId: 'run_gone', createdAt: t0 }),
  ]
  const count = (projectId?: string | null, kinds?: RunKind[]) => {
    const r = insights({ runs, approvals, projectId, kinds })
    return [r.totals.runs, r.totals.approvalsPending]
  }

  it('scopes runs and approvals (through their run) to a project', () => {
    expect(count()).toEqual([4, 3])
    expect(count(null)).toEqual([4, 3])
    expect(count('prj_a')).toEqual([2, 1])
    expect(count('prj_b')).toEqual([1, 1])
  })

  it('scopes to run kinds; an empty kind list means all kinds', () => {
    expect(count(undefined, ['agent'])).toEqual([2, 1])
    expect(count(undefined, ['agent', 'code'])).toEqual([3, 1])
    expect(count('prj_a', ['agent'])).toEqual([1, 1])
    expect(count(undefined, [])).toEqual([4, 3])
  })
})

describe('budget', () => {
  it('sums month-to-date spend account-wide and projects it linearly to month end', () => {
    const now = at('2026-06-11T00:00:00Z') // 10 of June's 30 days elapsed
    const runs = [
      finished({ id: 'live', start: at('2026-06-02T10:00:00Z'), simulated: false, usage: cost(4), projectId: 'prj_b' }),
      finished({ id: 'sim', start: at('2026-06-05T10:00:00Z'), simulated: true, usage: cost(6), projectId: 'prj_b' }),
      finished({ id: 'may', start: at('2026-05-31T23:59:00Z'), simulated: false, usage: cost(100) }),
    ]
    const { budget, totals } = insights({ runs, now, monthlyBudgetUsd: 50, projectId: 'prj_a' })
    expect(totals.runs).toBe(0) // the project filter applies to totals…
    expect(budget).toEqual({
      // …but not to the account-wide budget.
      monthlyUsd: 50, spentThisMonthUsd: 10, liveSpentUsd: 4, simulatedSpentUsd: 6, estimated: true, projectedUsd: 30,
      usedRatio: 0.2, projectedRatio: 0.6, monthStart: at('2026-06-01T00:00:00Z'), monthEnd: at('2026-07-01T00:00:00Z'),
    })
  })

  it('measures pace over at least a day early in the month', () => {
    const now = at('2026-06-01T06:00:00Z')
    const runs = [finished({ id: 'r', start: at('2026-06-01T01:00:00Z'), simulated: false, usage: cost(1) })]
    expect(insights({ runs, now, monthlyBudgetUsd: 50 }).budget.projectedUsd).toBeCloseTo(30)
  })

  it('reports no ratios without a budget and nothing projected without spend', () => {
    const { budget } = insights()
    expect(budget).toMatchObject({ monthlyUsd: 0, spentThisMonthUsd: 0, projectedUsd: 0, usedRatio: null, projectedRatio: null, estimated: false })
  })
})

describe('determinism', () => {
  it('returns the same result regardless of input order', () => {
    const runs = Array.from({ length: 40 }, (_, i) =>
      finished({
        id: `run_${String(i).padStart(2, '0')}`,
        start: NOW - (i * 9 + 1) * HOUR,
        status: i % 5 === 0 ? 'failed' : 'succeeded',
        error: i % 5 === 0 ? `Timeout ${i % 2 ? 'A' : 'B'}` : undefined,
        agentId: i % 3 ? 'agt_a' : 'agt_b',
        modelId: i % 2 ? 'sim-swift' : 'claude-haiku-5-5',
        usage: cost(i / 100, i, i),
        durationMs: (i + 1) * SEC,
      }),
    )
    const agents = [mkAgent({ id: 'agt_a', name: 'Ada' }), mkAgent({ id: 'agt_b', name: 'Bo' })]
    const forward = insights({ runs, agents })
    const backward = insights({ runs: [...runs].reverse(), agents: [...agents].reverse() })
    expect(backward).toEqual(forward)
  })
})
