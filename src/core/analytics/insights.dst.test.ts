import { describe, expect, it } from 'vitest'
import { at, cost, finished, HOUR, mkRun, useTimeZone } from './fixtures.test-utils'
import { computeInsights, type InsightsInput } from './insights'

// New York: clocks spring forward on 2026-03-08 (23h day) and fall back on 2026-11-01 (25h day).
useTimeZone('America/New_York')

function insights(partial: Partial<InsightsInput> & Pick<InsightsInput, 'now'>) {
  return computeInsights({ runs: [], approvals: [], tasks: [], agents: [], workflows: [], rangeDays: 7, ...partial })
}

const localDate = (ts: number) => {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

describe('daily buckets across DST', () => {
  it('buckets by local calendar day over the spring-forward (23h) day', () => {
    const now = at('2026-03-10T12:00:00-04:00')
    const runs = [
      mkRun({ id: 'sat-late', createdAt: at('2026-03-07T23:30:00-05:00') }),
      mkRun({ id: 'sun-late', createdAt: at('2026-03-08T23:30:00-04:00') }),
      // 00:30 EDT on Mar 9 is only 23.5h after Mar 8's midnight: 24h arithmetic would misfile it.
      mkRun({ id: 'mon-early', createdAt: at('2026-03-09T00:30:00-04:00') }),
    ]
    const { daily, heatmap, totals } = insights({ now, runs })
    expect(daily.map((d) => localDate(d.day))).toEqual([
      '3/3 00:00', '3/4 00:00', '3/5 00:00', '3/6 00:00', '3/7 00:00', '3/8 00:00', '3/9 00:00', '3/10 00:00',
    ])
    expect(daily[6].day - daily[5].day).toBe(23 * HOUR)
    expect(daily.map((d) => d.runs)).toEqual([0, 0, 0, 0, 1, 1, 1, 0])
    expect(heatmap[6][23]).toBe(1) // Sunday 23:00
    expect(heatmap[5][23]).toBe(1) // Saturday 23:00
    expect(heatmap[0][0]).toBe(1) // Monday 00:00
    expect(totals.runs).toBe(3)
  })

  it('buckets by local calendar day over the fall-back (25h) day', () => {
    const now = at('2026-11-03T12:00:00-05:00')
    const runs = [
      finished({ id: 'first-0130', start: at('2026-11-01T01:30:00-04:00'), usage: cost(0.1) }),
      finished({ id: 'second-0130', start: at('2026-11-01T01:30:00-05:00'), usage: cost(0.2) }),
      // 23:30 EST on Nov 1 is 24.5h after Nov 1's midnight but still Nov 1.
      finished({ id: 'sun-late', start: at('2026-11-01T23:30:00-05:00'), status: 'failed', error: 'Late failure' }),
      finished({ id: 'mon-early', start: at('2026-11-02T00:15:00-05:00') }),
    ]
    const { daily, heatmap, failureReasons } = insights({ now, runs })
    expect(daily).toHaveLength(8)
    expect(daily.map((d) => new Date(d.day).getHours())).toEqual(new Array(8).fill(0))
    const nov1 = daily.findIndex((d) => localDate(d.day) === '11/1 00:00')
    expect(daily[nov1 + 1].day - daily[nov1].day).toBe(25 * HOUR)
    expect(daily[nov1]).toMatchObject({ runs: 3, failed: 1 })
    expect(daily[nov1].costUsd).toBeCloseTo(0.3)
    expect(daily[nov1 + 1].runs).toBe(1)
    expect(heatmap[6][1]).toBe(2) // both 01:30s are Sunday, hour 1
    expect(heatmap[6][23]).toBe(1)
    expect(heatmap[0][0]).toBe(1)
    expect(failureReasons[0]).toMatchObject({ reason: 'Late failure', count: 1 })
  })

  it('uses local month boundaries for the budget across DST', () => {
    const now = at('2026-11-16T04:00:00-05:00')
    const runs = [
      finished({ id: 'oct-31', start: at('2026-10-31T23:59:00-04:00'), simulated: false, usage: cost(5) }),
      finished({ id: 'nov-1', start: at('2026-11-01T00:00:00-04:00'), simulated: false, usage: cost(3) }),
    ]
    const { budget } = insights({ now, runs, monthlyBudgetUsd: 20 })
    expect(budget.monthStart).toBe(at('2026-11-01T00:00:00-04:00'))
    expect(budget.monthEnd).toBe(at('2026-12-01T00:00:00-05:00'))
    expect(budget.spentThisMonthUsd).toBe(3)
    expect(budget.projectedUsd).toBeCloseTo((3 * (budget.monthEnd - budget.monthStart)) / (now - budget.monthStart))
  })
})
