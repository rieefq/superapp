import { describe, expect, it } from 'vitest'
import { buildSeed } from '@/core/seed'
import type { RunKind } from '@/core/types'
import { useTimeZone } from './fixtures.test-utils'
import { computeHomeSummary } from './home'
import { computeInsights, runTime, type InsightsInput } from './insights'
import { addLocalDays } from './time'

// Invariants over the realistic demo world (78 runs across agents, workflows, chat, code, research, studio).
useTimeZone('UTC')

const NOW = Date.parse('2026-11-01T15:00:00Z')
const seed = buildSeed(NOW)
const base = {
  runs: Object.values(seed.runs),
  approvals: Object.values(seed.approvals),
  tasks: Object.values(seed.tasks),
  agents: Object.values(seed.agents),
  workflows: Object.values(seed.workflows),
  now: NOW,
  monthlyBudgetUsd: 50,
}
const firstProject = Object.keys(seed.projects).sort()[0]
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0)

const scenarios: Array<[string, Partial<InsightsInput>]> = [
  ['all work', {}],
  ['one project', { projectId: firstProject }],
  ['agent + workflow kinds', { kinds: ['agent', 'workflow'] as RunKind[] }],
]

describe('computeInsights over the demo seed', () => {
  it('has data to aggregate', () => {
    expect(base.runs.length).toBeGreaterThan(20)
    expect(computeInsights({ ...base, rangeDays: 30 }).totals.runs).toBeGreaterThan(20)
  })

  for (const rangeDays of [7, 30, 90] as const) {
    for (const [name, filter] of scenarios) {
      it(`keeps every breakdown consistent with the totals (${rangeDays} days, ${name})`, () => {
        const r = computeInsights({ ...base, rangeDays, ...filter })
        const { totals, daily } = r

        // Independent recount of the window.
        const kinds = filter.kinds
        const inWindow = base.runs.filter((run) => {
          const t = runTime(run)
          return t >= r.window.from && t <= NOW && (!filter.projectId || run.projectId === filter.projectId) && (!kinds || kinds.includes(run.kind))
        })
        expect(totals.runs).toBe(inWindow.length)
        expect(totals.succeeded + totals.failed + totals.cancelled + totals.active).toBe(totals.runs)

        // Daily buckets: consecutive local days, kinds add up, total matches.
        for (let i = 1; i < daily.length; i++) expect(daily[i].day).toBe(addLocalDays(daily[i - 1].day, 1))
        for (const d of daily) expect(sum(Object.values(d.byKind))).toBe(d.runs)
        expect(sum(daily.map((d) => d.runs))).toBe(totals.runs)
        expect(sum(daily.map((d) => d.failed))).toBe(totals.failed)
        expect(sum(daily.map((d) => d.tokens))).toBe(totals.tokens)
        expect(sum(daily.map((d) => d.costUsd))).toBeCloseTo(totals.costUsd, 6)

        expect(sum(r.heatmap.flat())).toBe(totals.runs)
        expect(sum(r.byModel.map((m) => m.runs))).toBe(totals.runs)
        expect(sum(r.byModel.map((m) => m.tokens))).toBe(totals.tokens)
        expect(sum(r.byModel.map((m) => m.costUsd))).toBeCloseTo(totals.costUsd, 6)
        expect(totals.liveCostUsd + totals.simulatedCostUsd).toBeCloseTo(totals.costUsd, 9)
        expect(sum(r.failureReasons.map((f) => f.count))).toBe(totals.failed)

        const agentRuns = inWindow.filter((run) => run.agentId).length
        expect(sum(r.byAgent.map((a) => a.runs))).toBe(agentRuns)
        for (const a of r.byAgent) {
          expect(a.daily).toHaveLength(daily.length)
          expect(sum(a.daily)).toBe(a.runs)
        }
        const workflowRuns = inWindow.filter((run) => run.workflowId).length
        expect(sum(r.byWorkflow.map((w) => w.runs))).toBe(workflowRuns)

        for (const rate of [totals.successRate, ...r.byAgent.map((a) => a.successRate)]) {
          if (rate !== null) expect(rate).toBeGreaterThanOrEqual(0)
          if (rate !== null) expect(rate).toBeLessThanOrEqual(1)
        }
        if (totals.medianDurationMs !== null) expect(totals.medianDurationMs).toBeLessThanOrEqual(totals.p90DurationMs ?? Infinity)
        expect(r.budget.projectedUsd).toBeGreaterThanOrEqual(r.budget.spentThisMonthUsd)
      })
    }
  }

  it('is stable under input order', () => {
    const shuffled = { ...base, runs: [...base.runs].reverse(), approvals: [...base.approvals].reverse(), tasks: [...base.tasks].reverse() }
    expect(computeInsights({ ...shuffled, rangeDays: 30 })).toEqual(computeInsights({ ...base, rangeDays: 30 }))
  })

  it('summarizes Home consistently with the runs', () => {
    const home = computeHomeSummary(base)
    expect(home.activeRuns).toBe(base.runs.filter((r) => ['queued', 'running', 'waiting', 'paused'].includes(r.status)).length)
    expect(home.waitingOnYou).toBe(base.approvals.filter((a) => a.status === 'pending').length)
    expect(home.working).toBeLessThanOrEqual(base.agents.length)
  })
})
