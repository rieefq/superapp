import { describe, expect, it } from 'vitest'
import type { Run, RunStatus } from '@/core/types'
import { budgetTone, computeSpend, fitPills, orderRunLine, splitPills, totalsParts } from './runline'

let n = 0
function run(status: RunStatus, over: Partial<Run> = {}): Run {
  n++
  return {
    id: `run_${n}`,
    kind: 'agent',
    title: `Run ${n}`,
    status,
    projectId: null,
    initiator: { type: 'user', id: 'usr_me' },
    steps: [],
    outputs: [],
    simulated: true,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    progress: 0,
    createdAt: 1000 + n,
    startedAt: 1000 + n,
    ...over,
  }
}

describe('orderRunLine (§3.6)', () => {
  it('orders waiting · failed · running (scope first) · queued · paused', () => {
    const paused = run('paused')
    const queued = run('queued')
    const runningOther = run('running', { projectId: 'prj_b', startedAt: 5000 })
    const runningScoped = run('running', { projectId: 'prj_a', startedAt: 2000 })
    const waiting = run('waiting')
    const failed = run('failed', { endedAt: 9000 })
    const out = orderRunLine({ active: [paused, queued, runningOther, runningScoped, waiting], failedUnopened: [failed], justFinished: [], scopeProjectId: 'prj_a' })
    expect(out.map((r) => r.id)).toEqual([waiting.id, failed.id, runningScoped.id, runningOther.id, queued.id, paused.id])
  })

  it('keeps just-finished runs among the running ones and never duplicates', () => {
    const a = run('running', { startedAt: 100 })
    const done = run('succeeded', { startedAt: 200 })
    const out = orderRunLine({ active: [a], failedUnopened: [], justFinished: [done, done], scopeProjectId: null })
    expect(out.map((r) => r.id)).toEqual([done.id, a.id])
  })

  it('fits as many readable pills as the width allows, within the range maximum', () => {
    const list = [run('waiting'), run('waiting'), run('running'), run('running'), run('running'), run('running')]
    expect(fitPills(list, 2000, 5)).toBe(5)
    expect(fitPills(list, 900, 5)).toBe(3)
    expect(fitPills(list, 700, 5)).toBe(2)
    expect(fitPills(list, 1100, 4)).toBe(3)
    expect(fitPills(list, 120, 3)).toBe(1)
    expect(fitPills([], 900, 3)).toBe(0)
  })

  it('splits into visible pills and a +N overflow', () => {
    const list = [run('running'), run('running'), run('running'), run('running')]
    expect(splitPills(list, 3)).toMatchObject({ overflow: 1 })
    expect(splitPills(list, 3).shown).toHaveLength(3)
    expect(splitPills(list, 0)).toMatchObject({ overflow: 4 })
  })
})

describe('spend and totals', () => {
  const now = new Date(2026, 10, 1, 15, 0).getTime()
  const today = new Date(2026, 10, 1, 9, 0).getTime()
  const lastMonth = new Date(2026, 9, 20, 9, 0).getTime()

  it('separates live spend today from simulated estimates', () => {
    const runs = [
      run('succeeded', { simulated: false, startedAt: today, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.42 } }),
      run('succeeded', { simulated: true, startedAt: today, usage: { inputTokens: 1, outputTokens: 1, costUsd: 1.84 } }),
      run('succeeded', { simulated: false, startedAt: lastMonth, usage: { inputTokens: 1, outputTokens: 1, costUsd: 9 } }),
    ]
    expect(computeSpend(runs, now, false)).toEqual({ liveToday: 0.42, simToday: 1.84, monthCounted: 0.42 })
    expect(computeSpend(runs, now, true).monthCounted).toBeCloseTo(2.26)
  })

  it('reads “est. … today” with no live usage today', () => {
    const t = totalsParts([run('running'), run('queued'), run('paused')], 1, { liveToday: 0, simToday: 1.84, monthCounted: 0 })
    expect(t).toMatchObject({ running: 2, paused: 1, needsYou: 1, estimated: true, spendLabel: 'est. $1.84 today' })
    expect(totalsParts([], 0, { liveToday: 0.42, simToday: 3, monthCounted: 0 }).spendLabel).toBe('$0.42 today')
  })

  it('colors the totals by month-to-date spend against the budget', () => {
    expect(budgetTone(10, 50)).toBe('normal')
    expect(budgetTone(40, 50)).toBe('attn')
    expect(budgetTone(50, 50)).toBe('fail')
    expect(budgetTone(500, 0)).toBe('normal')
  })
})
