import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useSettingsStore } from '@/core/settings'
import { ME, type Approval } from '@/core/types'
import {
  __resetRunServiceForTests, addRunOutput, addUsage, appendStep, cancelRun, completeRun, createRun, failRun, isSessionRun,
  updateStep,
} from './service'

const NOW = new Date('2026-11-01T09:00:00Z').getTime()

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetRunServiceForTests()
  return () => vi.useRealTimers()
})

const notifications = (kind: string) => db.filter('notifications', (n) => n.kind === kind)

describe('createRun', () => {
  it('creates a running run with defaults, logs activity and links its origin', () => {
    const run = createRun({ kind: 'research', title: 'Pricing trends', projectId: 'prj_1', simulated: true, origin: { kind: 'investigation', id: 'inv_1' } })
    expect(run).toMatchObject({
      status: 'running', projectId: 'prj_1', initiator: ME, steps: [], outputs: [], progress: 0, simulated: true,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, createdAt: NOW, startedAt: NOW,
    })
    expect(run.id).toMatch(/^run_/)
    expect(db.get('runs', run.id)).toEqual(run)
    expect(isSessionRun(run.id)).toBe(true)
    const [event] = db.filter('activity', (a) => a.target.id === run.id)
    expect(event).toMatchObject({ verb: 'started', summary: 'Started “Pricing trends”', projectId: 'prj_1', actor: ME })
    expect(db.find('links', (l) => l.from.id === run.id && l.to.id === 'inv_1' && l.rel === 'derived_from')).toBeTruthy()
  })

  it('defaults projectId to null and omits absent optional fields', () => {
    const run = createRun({ kind: 'chat', title: 'Reply', simulated: false })
    expect(run.projectId).toBeNull()
    expect('agentId' in run).toBe(false)
    expect(db.all('links')).toHaveLength(0)
  })
})

describe('steps and usage', () => {
  it('appends steps with generated ids, patches them and accumulates usage', () => {
    const run = createRun({ kind: 'chat', title: 'Reply', simulated: true })
    const step = appendStep(run.id, { kind: 'search', title: 'Search knowledge', status: 'running' })
    expect(step.id).toMatch(/^stp_/)
    const custom = appendStep(run.id, { id: 'stp_custom', kind: 'message', title: 'Answer', status: 'pending' })
    expect(custom.id).toBe('stp_custom')
    updateStep(run.id, step.id, { status: 'done', output: '3 results', id: 'ignored' })
    expect(db.get('runs', run.id)?.steps).toEqual([
      { id: step.id, kind: 'search', title: 'Search knowledge', status: 'done', output: '3 results' },
      { id: 'stp_custom', kind: 'message', title: 'Answer', status: 'pending' },
    ])
    addUsage(run.id, { inputTokens: 100, outputTokens: 50, costUsd: 0.01 })
    addUsage(run.id, { inputTokens: 10, outputTokens: 5, costUsd: 0.002 })
    expect(db.get('runs', run.id)?.usage).toEqual({ inputTokens: 110, outputTokens: 55, costUsd: 0.012 })
  })

  it('records outputs once and links them', () => {
    const run = createRun({ kind: 'agent', title: 'Agent task', simulated: true })
    addRunOutput(run.id, { kind: 'task', id: 'tsk_1' })
    addRunOutput(run.id, { kind: 'task', id: 'tsk_1' })
    expect(db.get('runs', run.id)?.outputs).toEqual([{ kind: 'task', id: 'tsk_1' }])
    expect(db.filter('links', (l) => l.rel === 'produced')).toHaveLength(1)
  })
})

describe('completeRun', () => {
  it('finishes the run, merges outputs, links them, notifies and logs', () => {
    const run = createRun({ kind: 'agent', title: 'Write brief', projectId: 'prj_1', agentId: 'agt_scout', simulated: true })
    addRunOutput(run.id, { kind: 'knowledge', id: 'kno_1' })
    appendStep(run.id, { kind: 'write', title: 'Draft', status: 'running' })
    vi.advanceTimersByTime(5000)
    completeRun(run.id, { summary: 'Brief written', outputs: [{ kind: 'knowledge', id: 'kno_1' }, { kind: 'task', id: 'tsk_9' }] })
    const done = db.get('runs', run.id)
    expect(done).toMatchObject({ status: 'succeeded', progress: 1, summary: 'Brief written', endedAt: NOW + 5000 })
    expect(done?.outputs).toEqual([{ kind: 'knowledge', id: 'kno_1' }, { kind: 'task', id: 'tsk_9' }])
    expect(done?.steps[0]).toMatchObject({ status: 'done', endedAt: NOW + 5000 })
    expect(db.find('links', (l) => l.to.id === 'tsk_9' && l.rel === 'produced')).toBeTruthy()
    const [n] = notifications('run.completed')
    expect(n).toMatchObject({ title: 'Completed: Write brief', body: 'Brief written', tone: 'success', ref: { kind: 'run', id: run.id } })
    const completed = db.find('activity', (a) => a.verb === 'completed')
    expect(completed?.actor).toEqual({ type: 'agent', id: 'agt_scout' })

    completeRun(run.id, { summary: 'again' })
    expect(notifications('run.completed')).toHaveLength(1)
    expect(db.get('runs', run.id)?.summary).toBe('Brief written')
  })

  it('never notifies for chat runs and respects the runCompleted setting', () => {
    const chat = createRun({ kind: 'chat', title: 'Reply', simulated: true })
    completeRun(chat.id)
    expect(notifications('run.completed')).toHaveLength(0)
    useSettingsStore.getState().update('notifications', { runCompleted: false })
    const agentRun = createRun({ kind: 'agent', title: 'Task', simulated: true })
    completeRun(agentRun.id)
    expect(notifications('run.completed')).toHaveLength(0)
    expect(db.get('runs', agentRun.id)?.status).toBe('succeeded')
  })
})

describe('failRun and cancelRun', () => {
  it('fails the run, settles in-flight steps, expires approvals and notifies', () => {
    const run = createRun({ kind: 'code', title: 'Fix login', simulated: true })
    const step = appendStep(run.id, { kind: 'command', title: 'npm test', status: 'running' })
    appendStep(run.id, { kind: 'test', title: 'Later', status: 'pending' })
    const approval: Approval = {
      id: 'apv_1', runId: run.id, stepId: step.id, title: 'Run tests', capability: 'shell.execute', risk: 'medium',
      requestedBy: { type: 'system', id: 'system' }, status: 'pending', createdAt: NOW,
    }
    db.insert('approvals', approval)
    failRun(run.id, 'Provider error')
    const failed = db.get('runs', run.id)
    expect(failed).toMatchObject({ status: 'failed', error: 'Provider error', endedAt: NOW })
    expect(failed?.steps.map((s) => [s.status, s.error])).toEqual([['failed', 'Provider error'], ['skipped', undefined]])
    expect(db.get('approvals', 'apv_1')).toMatchObject({ status: 'expired', resolvedAt: NOW })
    const [n] = notifications('run.failed')
    expect(n).toMatchObject({ title: 'Failed: Fix login', body: 'Provider error', tone: 'danger' })
    expect(db.find('activity', (a) => a.verb === 'failed')?.meta).toMatchObject({ error: 'Provider error' })
  })

  it('respects the runFailed setting and skips chat runs', () => {
    useSettingsStore.getState().update('notifications', { runFailed: false })
    failRun(createRun({ kind: 'agent', title: 'A', simulated: true }).id, 'x')
    useSettingsStore.getState().reset()
    failRun(createRun({ kind: 'chat', title: 'B', simulated: true }).id, 'x')
    expect(notifications('run.failed')).toHaveLength(0)
  })

  it('cancels with a reason and ignores runs that already finished', () => {
    const run = createRun({ kind: 'workflow', title: 'Digest', simulated: true })
    appendStep(run.id, { kind: 'wait', title: 'Wait', status: 'running' })
    cancelRun(run.id, 'Stopped by you')
    expect(db.get('runs', run.id)).toMatchObject({ status: 'cancelled', error: 'Stopped by you' })
    expect(db.get('runs', run.id)?.steps[0].status).toBe('skipped')
    expect(db.find('activity', (a) => a.verb === 'cancelled')?.summary).toBe('Cancelled “Digest”')
    failRun(run.id, 'late failure')
    completeRun(run.id)
    expect(db.get('runs', run.id)?.status).toBe('cancelled')
    expect(notifications('run.failed')).toHaveLength(0)
  })

  it('is a no-op for unknown runs', () => {
    expect(() => {
      completeRun('run_missing')
      failRun('run_missing', 'x')
      cancelRun('run_missing')
      updateStep('run_missing', 'stp_x', { status: 'done' })
    }).not.toThrow()
    expect(db.all('activity')).toHaveLength(0)
  })
})
