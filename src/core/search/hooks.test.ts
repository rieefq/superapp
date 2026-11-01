import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { fx } from './fixtures.test-utils'
import { __resetSearchForTests, useSearch } from './index'

beforeEach(() => {
  vi.useFakeTimers()
  db.replaceAll(emptyTables())
  __resetSearchForTests()
  db.insertMany('tasks', [fx.task('t1', 'Release notes'), fx.task('t2', 'Launch checklist')])
})

afterEach(() => {
  __resetSearchForTests()
  vi.useRealTimers()
})

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))
const ids = (results: { ref: { id: string } }[]) => results.map((r) => r.ref.id)

describe('useSearch', () => {
  it('warms the index, debounces queries and keeps previous results while typing', () => {
    const { result, rerender } = renderHook(({ q }) => useSearch(q), { initialProps: { q: 'release' } })
    expect(result.current.ready).toBe(false)
    advance(0)
    expect(result.current.ready).toBe(true)
    expect(ids(result.current.results)).toEqual(['t1'])

    rerender({ q: 'checklist' })
    expect(result.current.ready).toBe(false)
    expect(ids(result.current.results)).toEqual(['t1'])
    advance(119)
    expect(ids(result.current.results)).toEqual(['t1'])
    advance(1)
    expect(result.current.ready).toBe(true)
    expect(ids(result.current.results)).toEqual(['t2'])

    rerender({ q: '' })
    expect(result.current).toEqual({ results: [], ready: true })
  })

  it('refreshes results when indexed data changes', () => {
    const { result } = renderHook(() => useSearch('launch', { kinds: ['task'] }))
    advance(0)
    expect(ids(result.current.results)).toEqual(['t2'])
    act(() => {
      db.insert('tasks', fx.task('t3', 'Launch retro', { updatedAt: 10 }))
    })
    advance(250)
    expect(ids(result.current.results).sort()).toEqual(['t2', 't3'])
  })
})
