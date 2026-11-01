import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useContextStore } from '@/core/context'
import { fx, HOUR, MIN, NOW } from './fixtures.test-utils'
import { __resetAssistCacheForTests, getNextActions, useMinuteClock, useNextActions } from './hooks'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  __resetAssistCacheForTests()
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  db.replaceAll(emptyTables())
  db.insertMany('agents', [fx.agent('agt_herald', { name: 'Herald' })])
  // Herald ran recently, so it is not suggested as an idle agent.
  db.insertMany('runs', [fx.run('run_a', { status: 'waiting', projectId: 'prj_a' }), fx.run('run_h', { agentId: 'agt_herald', startedAt: NOW - HOUR })])
  db.insertMany('approvals', [fx.approval('apv_a', 'run_a', { title: 'Post the digest', createdAt: NOW - 30 * MIN })])
  db.insertMany('tasks', [
    fx.task('tsk_a', { title: 'Approve pricing page', projectId: 'prj_a', dueAt: NOW - HOUR }),
    fx.task('tsk_b', { title: 'Book the offsite', projectId: 'prj_b', dueAt: NOW - HOUR }),
  ])
  db.insertMany('threads', [fx.thread('thr_1', { messageIds: ['msg_1'] })])
  db.insertMany('messages', [fx.message('msg_1', 'thr_1', { status: 'streaming', content: 'Hel' })])
})

afterEach(() => {
  // vitest runs without globals, so Testing Library cannot unmount hooks automatically.
  cleanup()
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  vi.useRealTimers()
})

const ids = (list: { id: string }[]) => list.map((a) => a.id)

describe('useNextActions', () => {
  it('suggests actions for the current scope, most important first, within the limit', () => {
    const { result } = renderHook(() => useNextActions(5))
    expect(ids(result.current)).toEqual(['approve:apv_a', 'due:tsk_a', 'due:tsk_b'])
    const limited = renderHook(() => useNextActions(1))
    expect(ids(limited.result.current)).toEqual(['approve:apv_a'])
  })

  it('follows the active project scope, unless a projectId is given', () => {
    const { result } = renderHook(() => useNextActions(5))
    act(() => useContextStore.getState().setScope('prj_b'))
    expect(ids(result.current)).toEqual(['due:tsk_b'])
    const all = renderHook(() => useNextActions(5, { projectId: null }))
    expect(ids(all.result.current)).toEqual(['approve:apv_a', 'due:tsk_a', 'due:tsk_b'])
  })

  it('keeps the same array (and skips re-renders) across unrelated writes and streaming tokens', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useNextActions(5)
    })
    const first = result.current
    const before = renders
    act(() => {
      db.insert('knowledge', {
        id: 'kno_1', kind: 'note', title: 'Notes', content: '', tags: [], collectionId: null, projectIds: [], source: { type: 'manual' },
        author: { type: 'user', id: 'usr_me' }, createdAt: NOW, updatedAt: NOW,
      })
      db.update('messages', 'msg_1', { content: 'Hello the' })
      db.update('messages', 'msg_1', { content: 'Hello there' })
      db.update('tasks', 'tsk_a', { description: 'Edited' })
    })
    expect(result.current).toBe(first)
    expect(renders).toBe(before)
  })

  it('updates when the suggestions change', () => {
    const { result } = renderHook(() => useNextActions(5))
    act(() => db.update('approvals', 'apv_a', { status: 'approved' }))
    expect(ids(result.current)).toEqual(['due:tsk_a', 'due:tsk_b'])
    act(() => db.update('messages', 'msg_1', { status: 'stopped' }))
    expect(ids(result.current)).toEqual(['due:tsk_a', 'due:tsk_b', 'resume:thr_1'])
  })

  it('refreshes time-based reasons as the minute clock ticks', () => {
    const { result } = renderHook(() => useNextActions(1))
    expect(result.current[0].reason).toContain('asked 30m ago')
    act(() => vi.advanceTimersByTime(5 * MIN))
    expect(result.current[0].reason).toContain('asked 35m ago')
  })
})

describe('useMinuteClock', () => {
  it('returns the current minute and ticks at most once a minute', () => {
    const { result } = renderHook(() => useMinuteClock())
    expect(result.current).toBe(Math.floor(NOW / MIN) * MIN)
    act(() => vi.advanceTimersByTime(30_000))
    expect(result.current).toBe(Math.floor(NOW / MIN) * MIN)
    act(() => vi.advanceTimersByTime(31_000))
    expect(result.current).toBe(Math.floor(NOW / MIN) * MIN + MIN)
  })
})

describe('getNextActions', () => {
  it('reads a snapshot for the current scope or the given project', () => {
    expect(ids(getNextActions())).toEqual(['approve:apv_a', 'due:tsk_a', 'due:tsk_b'])
    expect(ids(getNextActions({ projectId: 'prj_a', limit: 1 }))).toEqual(['approve:apv_a'])
    useContextStore.getState().setScope('prj_b')
    expect(ids(getNextActions())).toEqual(['due:tsk_b'])
  })
})
