import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import type { Run } from '@/core/types'
import { summarizeRuns, useActiveRuns, useRun, useRuns, useRunsForOrigin } from './hooks'

function run(id: string, patch: Partial<Run> = {}): Run {
  return {
    id, kind: 'agent', title: id, status: 'succeeded', projectId: null, initiator: { type: 'user', id: 'usr_me' },
    steps: [], outputs: [], simulated: true, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, progress: 1,
    createdAt: 0, ...patch,
  }
}

beforeEach(() => db.replaceAll(emptyTables()))

describe('summarizeRuns', () => {
  it('aggregates counts, usage, durations and success rate', () => {
    const summary = summarizeRuns([
      run('a', { status: 'succeeded', startedAt: 0, endedAt: 1000, usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.5 } }),
      run('b', { status: 'succeeded', startedAt: 0, endedAt: 3000, usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.25 } }),
      run('c', { status: 'failed', startedAt: 0, endedAt: 2000 }),
      run('d', { status: 'cancelled', startedAt: 0, endedAt: 6000 }),
      run('e', { status: 'running', startedAt: 0 }),
      run('f', { status: 'waiting' }),
    ])
    expect(summary).toEqual({
      count: 6, succeeded: 2, failed: 1, cancelled: 1, active: 2, inputTokens: 110, outputTokens: 55, costUsd: 0.75,
      avgDurationMs: 3000, successRate: 2 / 3,
    })
  })

  it('returns zeros for no runs', () => {
    expect(summarizeRuns([])).toMatchObject({ count: 0, avgDurationMs: 0, successRate: 0 })
  })
})

describe('run hooks', () => {
  beforeEach(() => {
    db.insertMany('runs', [
      run('r1', { status: 'running', projectId: 'p1', agentId: 'agt_a', createdAt: 1 }),
      run('r2', { status: 'waiting', projectId: 'p2', kind: 'code', createdAt: 2 }),
      run('r3', { status: 'succeeded', projectId: 'p1', workflowId: 'wfl_1', kind: 'workflow', createdAt: 3, origin: { kind: 'task', id: 't1' } }),
      run('r4', { status: 'paused', projectId: 'p1', createdAt: 4, origin: { kind: 'task', id: 't1' } }),
      run('r5', { status: 'failed', projectId: null, createdAt: 5 }),
    ])
  })

  const ids = (runs: Run[]) => runs.map((r) => r.id)

  it('useActiveRuns lists active runs newest first with filters', () => {
    expect(ids(renderHook(() => useActiveRuns()).result.current)).toEqual(['r4', 'r2', 'r1'])
    expect(ids(renderHook(() => useActiveRuns({ projectId: 'p1' })).result.current)).toEqual(['r4', 'r1'])
    expect(ids(renderHook(() => useActiveRuns({ agentId: 'agt_a' })).result.current)).toEqual(['r1'])
    expect(ids(renderHook(() => useActiveRuns({ kind: 'code' })).result.current)).toEqual(['r2'])
    expect(ids(renderHook(() => useActiveRuns({ projectId: null })).result.current)).toEqual(['r4', 'r2', 'r1'])
  })

  it('useRuns filters by status, workflow, kind and limit', () => {
    expect(ids(renderHook(() => useRuns({ status: ['failed', 'succeeded'] })).result.current)).toEqual(['r5', 'r3'])
    expect(ids(renderHook(() => useRuns({ workflowId: 'wfl_1' })).result.current)).toEqual(['r3'])
    expect(ids(renderHook(() => useRuns({ kind: ['code', 'workflow'] })).result.current)).toEqual(['r3', 'r2'])
    expect(ids(renderHook(() => useRuns({ limit: 2 })).result.current)).toEqual(['r5', 'r4'])
  })

  it('useRunsForOrigin and useRun follow the store', () => {
    const origin = renderHook(() => useRunsForOrigin({ kind: 'task', id: 't1' }))
    expect(ids(origin.result.current)).toEqual(['r4', 'r3'])
    const single = renderHook(() => useRun('r1'))
    expect(single.result.current?.status).toBe('running')
    act(() => {
      db.update('runs', 'r1', { status: 'succeeded' })
    })
    expect(single.result.current?.status).toBe('succeeded')
    expect(renderHook(() => useRunsForOrigin(null)).result.current).toEqual([])
  })

  it('keeps the same array while unrelated data changes', () => {
    const { result } = renderHook(() => useActiveRuns())
    const before = result.current
    act(() => {
      db.insert('notifications', { id: 'n1', kind: 'system', title: 'x', tone: 'neutral', createdAt: 0 })
    })
    expect(result.current).toBe(before)
  })
})
