import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelAllConfirms, confirm, confirmStore, resolveConfirm, setConfirmFallback } from './confirm'
import { dismissToast, MAX_TOASTS, pauseToasts, resumeToasts, toast, toastStore } from './toast'
import { findTypeaheadMatch } from './typeahead'

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('confirm()', () => {
  beforeEach(() => setConfirmFallback('queue'))
  afterEach(() => {
    cancelAllConfirms()
    setConfirmFallback('native')
  })

  it('queues a request and resolves true on confirm', async () => {
    const p = confirm({ title: 'Delete project?', tone: 'danger', confirmLabel: 'Delete' })
    const [req] = confirmStore.getState().queue
    expect(req).toMatchObject({ title: 'Delete project?', tone: 'danger', confirmLabel: 'Delete' })
    resolveConfirm(req.id, true)
    await expect(p).resolves.toBe(true)
    expect(confirmStore.getState().queue).toHaveLength(0)
  })

  it('resolves false on cancel and accepts a plain string', async () => {
    const p = confirm('Discard draft?')
    const [req] = confirmStore.getState().queue
    expect(req.title).toBe('Discard draft?')
    resolveConfirm(req.id, false)
    await expect(p).resolves.toBe(false)
  })

  it('shows requests one at a time, in order', async () => {
    const a = confirm('First?')
    const b = confirm('Second?')
    const q = confirmStore.getState().queue
    expect(q.map((r) => r.title)).toEqual(['First?', 'Second?'])
    resolveConfirm(q[0].id, true)
    expect(confirmStore.getState().queue[0].title).toBe('Second?')
    resolveConfirm(q[1].id, false)
    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(false)
  })

  it('cancelAllConfirms resolves everything false', async () => {
    const a = confirm('One?')
    const b = confirm('Two?')
    cancelAllConfirms()
    await expect(Promise.all([a, b])).resolves.toEqual([false, false])
  })

  it('falls back to window.confirm when no host is mounted', async () => {
    setConfirmFallback('native')
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await expect(confirm({ title: 'Proceed?', description: 'This sends 3 emails.' })).resolves.toBe(true)
    expect(spy).toHaveBeenCalledWith('Proceed?\n\nThis sends 3 emails.')
  })
})

describe('toast()', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    dismissToast()
    resumeToasts()
  })
  afterEach(() => {
    dismissToast()
    resumeToasts()
    vi.useRealTimers()
  })

  const list = () => toastStore.getState().toasts

  it('adds a toast from a string and auto-dismisses after its duration', () => {
    const id = toast('Saved')
    expect(list()).toHaveLength(1)
    expect(list()[0]).toMatchObject({ id, title: 'Saved', tone: 'neutral', duration: 4000 })
    vi.advanceTimersByTime(3999)
    expect(list()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(list()).toHaveLength(0)
  })

  it('tone helpers set tone and sensible durations', () => {
    toast.success('Done')
    toast.error('Failed')
    toast.loading('Working')
    const [s, e, l] = list()
    expect(s).toMatchObject({ tone: 'success', duration: 4000 })
    expect(e).toMatchObject({ tone: 'error', duration: 8000 })
    expect(l).toMatchObject({ tone: 'loading', duration: Infinity })
    vi.advanceTimersByTime(60_000)
    expect(list().map((t) => t.tone)).toEqual(['loading'])
  })

  it('updates in place by id (loading → success) and restarts the timer', () => {
    const id = toast.loading('Exporting…')
    toast.update(id, { tone: 'success', title: 'Exported' })
    expect(list()).toHaveLength(1)
    expect(list()[0]).toMatchObject({ id, tone: 'success', title: 'Exported', version: 2 })
    vi.advanceTimersByTime(4000)
    expect(list()).toHaveLength(0)
  })

  it('dismisses by id and calls onDismiss', () => {
    const onDismiss = vi.fn()
    const id = toast({ title: 'Undo?', onDismiss, action: { label: 'Undo', onClick: () => {} } })
    expect(list()[0].duration).toBe(6000)
    dismissToast(id)
    expect(list()).toHaveLength(0)
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('pauses and resumes timers with the remaining time', () => {
    toast({ title: 'Paused', duration: 1000 })
    vi.advanceTimersByTime(600)
    pauseToasts()
    vi.advanceTimersByTime(5000)
    expect(list()).toHaveLength(1)
    resumeToasts()
    vi.advanceTimersByTime(599)
    expect(list()).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(list()).toHaveLength(0)
  })

  it('caps the stack, dropping the oldest non-loading toast', () => {
    const loading = toast.loading('Sync')
    for (let i = 0; i < MAX_TOASTS + 2; i++) toast(`T${i}`)
    expect(list()).toHaveLength(MAX_TOASTS)
    expect(list()[0].id).toBe(loading)
    expect(list().at(-1)?.title).toBe(`T${MAX_TOASTS + 1}`)
  })

  it('toast.promise maps a resolved promise to success', async () => {
    vi.useRealTimers()
    const p = toast.promise(Promise.resolve(42), { loading: 'Saving…', success: (v) => `Saved ${v}`, error: 'Nope' })
    expect(list()[0]).toMatchObject({ tone: 'loading', title: 'Saving…' })
    await p
    await flush()
    expect(list()[0]).toMatchObject({ tone: 'success', title: 'Saved 42' })
  })

  it('toast.promise maps a rejection to error and still rejects', async () => {
    vi.useRealTimers()
    const p = toast.promise(Promise.reject(new Error('boom')), { loading: 'Saving…', success: 'ok', error: (e) => `Failed: ${(e as Error).message}` })
    await expect(p).rejects.toThrow('boom')
    await flush()
    expect(list()[0]).toMatchObject({ tone: 'error', title: 'Failed: boom' })
  })
})

describe('findTypeaheadMatch', () => {
  const labels = ['Apple', 'Banana', 'Blueberry', 'Cherry', 'Date']

  it('finds the next item starting with the typed character', () => {
    expect(findTypeaheadMatch(labels, 'b', -1)).toBe(1)
    expect(findTypeaheadMatch(labels, 'b', 1)).toBe(2)
    expect(findTypeaheadMatch(labels, 'b', 2)).toBe(1) // wraps
  })

  it('matches multi-character prefixes from the current item', () => {
    expect(findTypeaheadMatch(labels, 'bl', 1)).toBe(2)
    expect(findTypeaheadMatch(labels, 'ch', 0)).toBe(3)
  })

  it('cycles when the same character repeats', () => {
    expect(findTypeaheadMatch(labels, 'bb', 1)).toBe(2)
  })

  it('skips disabled items and returns -1 without a match', () => {
    expect(findTypeaheadMatch(labels, 'b', -1, (i) => i === 1)).toBe(2)
    expect(findTypeaheadMatch(labels, 'z', 0)).toBe(-1)
  })
})
