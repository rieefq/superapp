import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { updateSettings, useSettingsStore } from '@/core/settings'
import type { Notification } from '@/core/types'
import { at, DAY, finished, HOUR, MIN, mkAgent, mkApproval, mkRun, mkTask, SEC, useTimeZone } from './fixtures.test-utils'
import { readHomeSummary, readInsights, useHomeSummary, useInsights, useMinuteNow, type UseInsightsOptions } from './hooks'
import { computeInsights } from './insights'

useTimeZone('UTC')

const NOW = at('2026-06-15T12:00:00Z')

const note = (id: string): Notification => ({ id, kind: 'system', title: id, tone: 'neutral', createdAt: NOW })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useSettingsStore.getState().reset()
})

describe('useMinuteNow', () => {
  it('ticks at minute boundaries with one shared timer', () => {
    vi.setSystemTime(NOW + 45 * SEC)
    const a = renderHook(() => useMinuteNow())
    const b = renderHook(() => useMinuteNow())
    expect(a.result.current).toBe(NOW)
    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      vi.advanceTimersByTime(15 * SEC + 100) // the clock fires just after the boundary
    })
    expect(a.result.current).toBe(NOW + MIN)
    expect(b.result.current).toBe(NOW + MIN)
    a.unmount()
    b.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useInsights', () => {
  it('computes from the database and memoizes across unrelated changes', () => {
    db.insertMany('agents', [mkAgent({ id: 'agt_a', name: 'Ada' })])
    db.insertMany('runs', [
      finished({ id: 'r1', agentId: 'agt_a', start: NOW - DAY, kind: 'agent' }),
      finished({ id: 'r2', start: NOW - 2 * DAY, kind: 'chat', status: 'failed', error: 'Nope' }),
    ])
    const { result, rerender } = renderHook((opts: UseInsightsOptions) => useInsights(opts), {
      initialProps: { rangeDays: 7, kinds: ['agent', 'chat'] },
    })
    const first = result.current
    expect(first.totals).toMatchObject({ runs: 2, succeeded: 1, failed: 1 })
    expect(first.byAgent.map((a) => a.name)).toEqual(['Ada'])

    // A new inline array with the same kinds, or a write to an unrelated table, reuses the result.
    rerender({ rangeDays: 7, kinds: ['chat', 'agent'] })
    expect(result.current).toBe(first)
    act(() => {
      db.insert('notifications', note('ntf_1'))
    })
    expect(result.current).toBe(first)

    act(() => {
      db.insert('runs', finished({ id: 'r3', start: NOW - HOUR, kind: 'chat' }))
    })
    expect(result.current).not.toBe(first)
    expect(result.current.totals.runs).toBe(3)

    rerender({ rangeDays: 7, kinds: ['agent'] })
    expect(result.current.totals.runs).toBe(1)
    rerender({ rangeDays: 7, kinds: [] })
    expect(result.current.totals.runs).toBe(3)
  })

  it('ignores step and progress churn but recomputes when analytics fields change', () => {
    db.insertMany('runs', [mkRun({ id: 'live', status: 'running', createdAt: NOW - HOUR, startedAt: NOW - HOUR, progress: 0 })])
    const { result } = renderHook(() => useInsights({ rangeDays: 7 }))
    const first = result.current
    expect(first.totals.active).toBe(1)
    act(() => {
      db.update('runs', 'live', (r) => ({
        ...r,
        progress: 0.5,
        steps: [{ id: 'stp_1', kind: 'command', title: 'npm test', status: 'running', output: 'line 1' }],
      }))
    })
    expect(result.current).toBe(first)
    act(() => {
      db.update('runs', 'live', (r) => ({ ...r, usage: { inputTokens: 70, outputTokens: 30, costUsd: 0.001 } }))
    })
    expect(result.current).not.toBe(first)
    expect(result.current.totals.tokens).toBe(100)
    const second = result.current
    act(() => {
      db.update('runs', 'live', (r) => ({
        ...r,
        status: 'failed',
        endedAt: NOW,
        steps: [{ id: 'stp_1', kind: 'command', title: 'npm test', status: 'failed', error: 'Tests failed (simulated).' }],
      }))
    })
    expect(result.current).not.toBe(second)
    expect(result.current.totals).toMatchObject({ active: 0, failed: 1 })
    expect(result.current.failureReasons[0]).toMatchObject({ reason: 'Tests failed (simulated)', exampleRunId: 'live' })
  })

  it('counts runs started this minute and slides the window as minutes pass', () => {
    db.insertMany('runs', [
      mkRun({ id: 'just-now', createdAt: NOW + 30 * SEC }), // later this minute
      mkRun({ id: 'edge', createdAt: NOW - 7 * DAY + 90 * SEC }), // falls out after one minute
    ])
    const { result } = renderHook(() => useInsights({ rangeDays: 7 }))
    expect(result.current.totals.runs).toBe(2)
    act(() => {
      vi.advanceTimersByTime(MIN + SEC)
    })
    expect(result.current.totals.runs).toBe(1)
    expect(result.current.previous.runs).toBe(1)
  })

  it('reads the monthly budget from settings and scopes to a project', () => {
    db.insertMany('runs', [
      finished({ id: 'a', projectId: 'prj_a', start: NOW - HOUR, simulated: false, usage: { inputTokens: 0, outputTokens: 0, costUsd: 2 } }),
      finished({ id: 'b', projectId: 'prj_b', start: NOW - HOUR }),
    ])
    act(() => updateSettings('safety', { monthlyBudgetUsd: 80 }))
    const { result } = renderHook(() => useInsights({ rangeDays: 30, projectId: 'prj_a' }))
    expect(result.current.totals.runs).toBe(1)
    expect(result.current.budget).toMatchObject({ monthlyUsd: 80, spentThisMonthUsd: 2, usedRatio: 2 / 80 })
    act(() => updateSettings('safety', { monthlyBudgetUsd: 40 }))
    expect(result.current.budget.monthlyUsd).toBe(40)
  })
})

describe('useHomeSummary', () => {
  it('counts live state, keeps its object stable and updates when a due time passes', () => {
    db.insertMany('runs', [
      mkRun({ id: 'r1', agentId: 'agt_a', status: 'running', projectId: 'prj_a' }),
      mkRun({ id: 'r2', agentId: 'agt_b', status: 'waiting', projectId: 'prj_b' }),
    ])
    db.insertMany('approvals', [mkApproval({ id: 'ap1', runId: 'r2' })])
    db.insertMany('tasks', [mkTask({ id: 't1', dueAt: NOW + 30 * SEC, projectId: 'prj_a' })])

    const { result } = renderHook(() => useHomeSummary())
    const first = result.current
    expect(first).toEqual({ working: 1, waitingOnYou: 1, dueToday: 1, overdue: 0, activeRuns: 2 })

    act(() => {
      db.insert('notifications', note('ntf_1'))
    })
    expect(result.current).toBe(first)

    act(() => {
      vi.advanceTimersByTime(MIN + SEC)
    })
    expect(result.current).toMatchObject({ dueToday: 0, overdue: 1 })

    act(() => {
      db.update('approvals', 'ap1', { status: 'approved', resolvedAt: Date.now() })
    })
    expect(result.current.waitingOnYou).toBe(0)
  })

  it('scopes to a project', () => {
    db.insertMany('runs', [
      mkRun({ id: 'r1', agentId: 'agt_a', status: 'running', projectId: 'prj_a' }),
      mkRun({ id: 'r2', agentId: 'agt_b', status: 'running', projectId: 'prj_b' }),
    ])
    const { result } = renderHook(() => useHomeSummary({ projectId: 'prj_b' }))
    expect(result.current).toMatchObject({ working: 1, activeRuns: 1 })
  })
})

describe('snapshots', () => {
  it('readInsights matches computeInsights over the database, with registry model labels', () => {
    db.insertMany('runs', [
      finished({ id: 'r1', start: NOW - DAY, modelId: 'oai:llama3.2', simulated: false }),
      finished({ id: 'r2', start: NOW - DAY, modelId: 'claude-sonnet-5-5' }),
    ])
    updateSettings('safety', { monthlyBudgetUsd: 25 })
    const snap = readInsights({ rangeDays: 7, now: NOW })
    expect(snap.byModel.map((m) => m.label).sort()).toEqual(['Claude Sonnet 5.5', 'llama3.2 · custom endpoint'])
    expect(snap.budget.monthlyUsd).toBe(25)
    const pure = computeInsights({
      runs: db.all('runs'), approvals: [], tasks: [], agents: [], workflows: [], now: NOW, rangeDays: 7, monthlyBudgetUsd: 25,
    })
    expect(snap.totals).toEqual(pure.totals)
  })

  it('readHomeSummary reads the database', () => {
    db.insertMany('tasks', [mkTask({ id: 't', dueAt: NOW - MIN })])
    expect(readHomeSummary({ now: NOW })).toMatchObject({ overdue: 1, dueToday: 0 })
  })
})

