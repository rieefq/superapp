import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { estimateReferenceCost } from '@/core/ai/models'
import { db, emptyTables } from '@/core/db'
import { useSettingsStore } from '@/core/settings'
import type { Agent, IntegrationConnection, Run, Task } from '@/core/types'
import { createRng } from '@/lib/rng'
import {
  __resetEngineForTests, INTERRUPTED_REASON, RELOAD_INTERRUPTED_REASON, REJECTED_REASON, isRunDriven, revealSchedule, runEngine,
  splitTokens,
} from './engine'
import { registerRunFactory } from './registry'
import type { RunPlan } from './types'

const OUTPUT = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
const NOW = new Date('2026-11-01T10:00:00Z').getTime()

let plan: () => RunPlan = () => ({ steps: [] })
registerRunFactory('test.plan', () => plan())

const tick = (ms = 0) => vi.advanceTimersByTime(ms)
const getRun = (id: string): Run => {
  const run = db.get('runs', id)
  if (!run) throw new Error(`run ${id} missing`)
  return run
}
const start = (extra: Partial<Parameters<typeof runEngine.start>[0]> = {}) =>
  runEngine.start({ kind: 'agent', title: 'Test run', factory: 'test.plan', projectId: 'prj_1', ...extra })
const pendingApprovals = (runId: string) => db.filter('approvals', (a) => a.runId === runId && a.status === 'pending')
const updateSettings = useSettingsStore.getState().update

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('helpers', () => {
  it('splits tokens 70/30 and costs them at reference pricing', () => {
    expect(splitTokens(1000)).toEqual({ inputTokens: 700, outputTokens: 300, costUsd: estimateReferenceCost(700, 300) })
    expect(splitTokens(1).inputTokens + splitTokens(1).outputTokens).toBe(1)
  })

  it('reveals output in 4-12 increments, never more than one per line, ending with every line', () => {
    for (let seed = 0; seed < 50; seed++) {
      const schedule = revealSchedule(40, createRng(seed))
      expect(schedule.length).toBeGreaterThanOrEqual(4)
      expect(schedule.length).toBeLessThanOrEqual(12)
      expect(schedule[schedule.length - 1]).toEqual({ at: 1, lines: 40 })
      for (let i = 1; i < schedule.length; i++) expect(schedule[i].lines).toBeGreaterThan(schedule[i - 1].lines)
    }
    expect(revealSchedule(2, createRng(1))).toHaveLength(2)
    expect(revealSchedule(0, createRng(1))).toEqual([])
  })
})

describe('runEngine.start', () => {
  it('throws for an unknown factory', () => {
    expect(() => runEngine.start({ kind: 'agent', title: 'x', factory: 'does.not.exist' })).toThrow(/Unknown run factory/)
  })

  it('creates a simulated run with a persisted script and executes asynchronously', () => {
    plan = () => ({ steps: [{ kind: 'think', title: 'Think', durationMs: 100 }] })
    const run = start({ params: { topic: 'pricing' } })
    expect(run).toMatchObject({ status: 'running', simulated: true, modelId: 'sim-deep', projectId: 'prj_1', progress: 0 })
    expect(run.script).toMatchObject({ factory: 'test.plan', params: { topic: 'pricing' }, cursor: 0 })
    expect(Number.isInteger(run.script?.seed)).toBe(true)
    expect(getRun(run.id).steps).toHaveLength(0)
    tick()
    expect(getRun(run.id).steps).toHaveLength(1)
  })

  it('appends steps when they start, reveals output progressively, records usage and completes', () => {
    const onComplete = vi.fn()
    const onSuccess = vi.fn()
    plan = () => ({
      summary: 'All done',
      onSuccess,
      steps: [
        { kind: 'command', title: 'Install', durationMs: 1000, input: 'npm install', output: OUTPUT, tokens: 1000, onComplete },
        { kind: 'think', title: 'Reflect', durationMs: 500, tokens: 500 },
      ],
    })
    const run = start()
    tick()
    let r = getRun(run.id)
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0]).toMatchObject({ title: 'Install', status: 'running', input: 'npm install', output: '', startedAt: NOW })

    const partials = new Set<string>()
    for (let t = 0; t < 950; t += 50) {
      tick(50)
      const output = getRun(run.id).steps[0].output ?? ''
      expect(OUTPUT.startsWith(output)).toBe(true)
      if (output && output !== OUTPUT) partials.add(output)
    }
    // n increments in [4, 12] capped by 10 lines; the last one lands at completion.
    expect(partials.size).toBeGreaterThanOrEqual(3)
    expect(partials.size).toBeLessThanOrEqual(9)
    expect(getRun(run.id).steps[0].status).toBe('running')

    tick(50)
    r = getRun(run.id)
    expect(r.steps[0]).toMatchObject({ status: 'done', output: OUTPUT, tokens: 1000, endedAt: NOW + 1000 })
    expect(r.progress).toBe(0.5)
    expect(r.script?.cursor).toBe(1)
    expect(r.usage).toEqual(splitTokens(1000))
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete.mock.calls[0][0].step).toMatchObject({ title: 'Install', status: 'done' })
    expect(r.steps).toHaveLength(2)
    expect(r.steps[1]).toMatchObject({ title: 'Reflect', status: 'running' })

    tick(500)
    r = getRun(run.id)
    expect(r).toMatchObject({ status: 'succeeded', progress: 1, summary: 'All done', endedAt: NOW + 1500 })
    expect(r.usage.inputTokens).toBe(700 + 350)
    expect(r.usage.outputTokens).toBe(300 + 150)
    expect(r.usage.costUsd).toBeCloseTo(estimateReferenceCost(700, 300) + estimateReferenceCost(350, 150), 10)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(isRunDriven(run.id)).toBe(false)
    expect(db.filter('notifications', (n) => n.kind === 'run.completed' && n.ref?.id === run.id)).toHaveLength(1)
    const verbs = db.filter('activity', (a) => a.target.id === run.id).map((a) => a.verb)
    expect(verbs).toEqual(expect.arrayContaining(['started', 'completed']))
  })

  it('divides step durations by the simulation speed (min 0.25)', () => {
    updateSettings('simulation', { speed: 4 })
    plan = () => ({ steps: [{ kind: 'think', title: 'Fast', durationMs: 1000 }] })
    const run = start()
    tick()
    tick(249)
    expect(getRun(run.id).steps[0].status).toBe('running')
    tick(1)
    expect(getRun(run.id).status).toBe('succeeded')
  })

  it('counts integration usage for steps that use a connection', () => {
    const connection: IntegrationConnection = {
      id: 'github', status: 'connected', mode: 'live', scopes: [], config: {}, usageCount: 2,
    }
    db.insert('connections', connection)
    plan = () => ({ steps: [{ kind: 'read', title: 'Read repo', durationMs: 100, integrationId: 'github', capability: 'repo.read' }] })
    start()
    tick()
    tick(100)
    expect(db.get('connections', 'github')).toMatchObject({ usageCount: 3, lastUsedAt: NOW + 100 })
  })

  it('records outputs through the step context', () => {
    plan = () => ({
      steps: [{ kind: 'artifact', title: 'Write report', durationMs: 10, onComplete: (ctx) => ctx.addOutput({ kind: 'knowledge', id: 'kno_1' }) }],
    })
    const run = start()
    tick()
    tick(10)
    expect(getRun(run.id).outputs).toEqual([{ kind: 'knowledge', id: 'kno_1' }])
    expect(db.find('links', (l) => l.from.id === run.id && l.to.id === 'kno_1' && l.rel === 'produced')).toBeTruthy()
  })
})

describe('failures', () => {
  it('fails the step and the run when failChance hits', () => {
    const onFailure = vi.fn()
    plan = () => ({
      onFailure,
      steps: [
        { kind: 'test', title: 'Run tests', durationMs: 300, failChance: 1, failMessage: '2 tests failed' },
        { kind: 'write', title: 'Never reached', durationMs: 100 },
      ],
    })
    const run = start()
    tick()
    tick(300)
    const r = getRun(run.id)
    expect(r.status).toBe('failed')
    expect(r.error).toBe('2 tests failed')
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0]).toMatchObject({ status: 'failed', error: '2 tests failed' })
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0].reason).toBe('2 tests failed')
    const failed = db.filter('notifications', (n) => n.kind === 'run.failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].tone).toBe('danger')
  })

  it('never fails a step without failChance', () => {
    plan = () => ({ steps: [{ kind: 'test', title: 'Run tests', durationMs: 300, failChance: 0 }] })
    const run = start()
    tick()
    tick(300)
    expect(getRun(run.id).status).toBe('succeeded')
  })

  it('fails the step and the run when onComplete throws', () => {
    plan = () => ({
      steps: [{ kind: 'write', title: 'Save', durationMs: 50, onComplete: () => { throw new Error('disk full') } }],
    })
    const run = start()
    tick()
    tick(50)
    const r = getRun(run.id)
    expect(r.status).toBe('failed')
    expect(r.error).toBe('disk full')
    expect(r.steps[0]).toMatchObject({ status: 'failed', error: 'disk full' })
  })
})

describe('approvals', () => {
  const gated = (onReject?: 'stop' | 'skip') => () =>
    ({
      steps: [
        {
          kind: 'command',
          title: 'npm install stripe',
          durationMs: 400,
          capability: 'shell.execute',
          approval: { title: 'Install stripe', description: 'Adds a dependency', risk: 'medium', preview: { kind: 'command', content: 'npm install stripe@14' }, onReject },
        },
        { kind: 'test', title: 'Run tests', durationMs: 200 },
      ],
    }) satisfies RunPlan

  it('pauses on an approval and continues once approved', () => {
    plan = gated()
    const run = start()
    tick()
    let r = getRun(run.id)
    expect(r.status).toBe('waiting')
    expect(r.steps[0].status).toBe('waiting')
    const [approval] = pendingApprovals(run.id)
    expect(approval).toMatchObject({
      stepId: r.steps[0].id,
      title: 'Install stripe',
      description: 'Adds a dependency',
      capability: 'shell.execute',
      risk: 'medium',
      requestedBy: { type: 'system', id: 'system' },
      preview: { kind: 'command', content: 'npm install stripe@14' },
      reason: 'Balanced mode asks before medium-risk actions',
    })
    expect(r.steps[0].approvalId).toBe(approval.id)
    const [notification] = db.filter('notifications', (n) => n.kind === 'approval.requested')
    expect(notification).toMatchObject({ tone: 'warning', body: approval.reason, ref: { kind: 'approval', id: approval.id } })

    tick(10_000)
    expect(getRun(run.id).status).toBe('waiting')

    runEngine.resolveApproval(approval.id, 'approved', 'Looks safe')
    expect(db.get('approvals', approval.id)).toMatchObject({
      status: 'approved', resolvedAt: NOW + 10_000, resolution: { by: { type: 'user', id: 'usr_me' }, note: 'Looks safe' },
    })
    expect(getRun(run.id).status).toBe('running')
    tick()
    expect(getRun(run.id).steps[0].status).toBe('running')
    tick(400)
    tick(200)
    r = getRun(run.id)
    expect(r.status).toBe('succeeded')
    expect(r.steps.map((s) => s.status)).toEqual(['done', 'done'])
    expect(db.find('activity', (a) => a.verb === 'approved' && a.target.id === approval.id)).toBeTruthy()
  })

  it('notifies about approvals only when enabled in settings', () => {
    updateSettings('notifications', { approvals: false })
    plan = gated()
    start()
    tick()
    expect(db.filter('notifications', (n) => n.kind === 'approval.requested')).toHaveLength(0)
  })

  it('stops the run when an approval is rejected (default)', () => {
    const onFailure = vi.fn()
    plan = () => ({ ...gated()(), onFailure })
    const run = start()
    tick()
    const [approval] = pendingApprovals(run.id)
    runEngine.resolveApproval(approval.id, 'rejected', 'Not now')
    const r = getRun(run.id)
    expect(r.status).toBe('cancelled')
    expect(r.error).toBe(REJECTED_REASON)
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0].status).toBe('skipped')
    expect(db.get('approvals', approval.id)?.status).toBe('rejected')
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: REJECTED_REASON }))
    tick(5000)
    expect(getRun(run.id).steps).toHaveLength(1)
  })

  it('skips the step and continues when the plan allows skipping', () => {
    plan = gated('skip')
    const run = start()
    tick()
    const [approval] = pendingApprovals(run.id)
    runEngine.resolveApproval(approval.id, 'rejected')
    expect(getRun(run.id).status).toBe('running')
    tick()
    tick(200)
    const r = getRun(run.id)
    expect(r.status).toBe('succeeded')
    expect(r.steps.map((s) => s.status)).toEqual(['skipped', 'done'])
  })

  it('runs gated steps directly when the policy allows them', () => {
    updateSettings('safety', { defaultAutonomy: 'autonomous' })
    plan = gated()
    const run = start()
    tick()
    expect(getRun(run.id).steps[0].status).toBe('running')
    expect(pendingApprovals(run.id)).toHaveLength(0)
  })

  it('fails the run when the policy denies a step', () => {
    plan = () => ({
      steps: [
        { kind: 'message', title: 'Post to #launch', durationMs: 100, capability: 'messages.send', integrationId: 'slack', approval: { title: 'Post', risk: 'high' } },
        { kind: 'think', title: 'After', durationMs: 100 },
      ],
    })
    const run = start()
    tick()
    const r = getRun(run.id)
    expect(r.status).toBe('failed')
    expect(r.error).toBe('Slack is not connected')
    expect(r.steps[0]).toMatchObject({ status: 'failed', error: 'Slack is not connected' })
    expect(pendingApprovals(run.id)).toHaveLength(0)
  })

  it('continues past a denied step when the plan allows skipping', () => {
    plan = () => ({
      steps: [
        { kind: 'message', title: 'Post', durationMs: 100, capability: 'messages.send', integrationId: 'slack', approval: { title: 'Post', risk: 'high', onReject: 'skip' } },
        { kind: 'think', title: 'After', durationMs: 100 },
      ],
    })
    const run = start()
    tick()
    tick()
    tick(100)
    const r = getRun(run.id)
    expect(r.status).toBe('succeeded')
    expect(r.steps.map((s) => s.status)).toEqual(['failed', 'done'])
  })

  it('names the agent as requester and uses its grants', () => {
    const agent: Agent = {
      id: 'agt_forge', name: 'Forge', role: 'Coding agent', description: '', hue: 'sky', sigil: 1, modelId: 'sim-deep',
      instructions: '', capabilities: [{ capability: 'shell.execute', mode: 'ask' }],
      knowledgeScope: { all: true, collectionIds: [], projectIds: [] }, autonomy: 'autonomous', status: 'active',
      createdAt: NOW, updatedAt: NOW,
    }
    db.insert('agents', agent)
    plan = gated()
    const run = start({ agentId: 'agt_forge' })
    tick()
    const [approval] = pendingApprovals(run.id)
    expect(approval.requestedBy).toEqual({ type: 'agent', id: 'agt_forge' })
    expect(approval.reason).toBe('Forge needs your approval to run commands')
  })
})

describe('cancel, pause and resume', () => {
  it('cancels a running run: skips the current step and stops all timers', () => {
    const onFailure = vi.fn()
    plan = () => ({ onFailure, steps: [{ kind: 'command', title: 'Build', durationMs: 1000, output: OUTPUT }, { kind: 'think', title: 'Next', durationMs: 10 }] })
    const run = start()
    tick()
    tick(500)
    runEngine.cancel(run.id, 'No longer needed')
    let r = getRun(run.id)
    expect(r).toMatchObject({ status: 'cancelled', error: 'No longer needed', endedAt: NOW + 500 })
    expect(r.steps[0]).toMatchObject({ status: 'skipped', endedAt: NOW + 500 })
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ reason: 'No longer needed' }))
    const snapshot = r
    tick(10_000)
    r = getRun(run.id)
    expect(r).toBe(snapshot)
    expect(isRunDriven(run.id)).toBe(false)
    expect(db.find('activity', (a) => a.verb === 'cancelled' && a.target.id === run.id)).toBeTruthy()
  })

  it('expires pending approvals when a waiting run is cancelled', () => {
    plan = () => ({ steps: [{ kind: 'command', title: 'Deploy', durationMs: 10, approval: { title: 'Deploy', risk: 'high' } }] })
    const run = start()
    tick()
    const [approval] = pendingApprovals(run.id)
    runEngine.cancel(run.id)
    expect(db.get('approvals', approval.id)?.status).toBe('expired')
    expect(getRun(run.id).steps[0].status).toBe('skipped')
    runEngine.resolveApproval(approval.id, 'approved')
    expect(getRun(run.id).status).toBe('cancelled')
  })

  it('pauses (clearing timers) and resumes the current step from its start', () => {
    plan = () => ({ steps: [{ kind: 'command', title: 'Build', durationMs: 1000, output: OUTPUT }] })
    const run = start()
    tick()
    tick(600)
    expect(getRun(run.id).steps[0].output).not.toBe('')
    runEngine.pause(run.id)
    expect(getRun(run.id).status).toBe('paused')
    expect(getRun(run.id).steps[0].status).toBe('pending')
    tick(60_000)
    expect(getRun(run.id).status).toBe('paused')

    runEngine.resume(run.id)
    expect(getRun(run.id).status).toBe('running')
    tick()
    const step = getRun(run.id).steps[0]
    expect(step).toMatchObject({ status: 'running', output: '', startedAt: NOW + 60_600 })
    expect(getRun(run.id).steps).toHaveLength(1)
    tick(999)
    expect(getRun(run.id).status).toBe('running')
    tick(1)
    expect(getRun(run.id).status).toBe('succeeded')
    expect(getRun(run.id).steps[0].output).toBe(OUTPUT)
  })
})

describe('retry', () => {
  it('starts a fresh run with the same script inputs and links it to the original', () => {
    plan = () => ({ steps: [{ kind: 'think', title: 'Think', durationMs: 10 }] })
    const original = start({ params: { q: 1 }, agentId: 'agt_scout', origin: { kind: 'task', id: 'tsk_1' } })
    runEngine.cancel(original.id)
    const retried = runEngine.retry(original.id)
    expect(retried).toBeDefined()
    if (!retried) return
    expect(retried.id).not.toBe(original.id)
    expect(retried).toMatchObject({
      kind: 'agent', title: 'Test run', projectId: 'prj_1', agentId: 'agt_scout', origin: { kind: 'task', id: 'tsk_1' }, status: 'running',
    })
    expect(retried.script).toMatchObject({ factory: 'test.plan', params: { q: 1 }, cursor: 0 })
    expect(db.find('links', (l) => l.from.id === retried.id && l.to.id === original.id && l.rel === 'related')).toBeTruthy()
    tick()
    tick(10)
    expect(getRun(retried.id).status).toBe('succeeded')
  })

  it('returns undefined for runs without a script', () => {
    db.insert('runs', { ...baseRun('run_chat'), kind: 'chat' })
    expect(runEngine.retry('run_chat')).toBeUndefined()
  })
})

function baseRun(id: string, patch: Partial<Run> = {}): Run {
  return {
    id, kind: 'agent', title: id, status: 'running', projectId: null, initiator: { type: 'user', id: 'usr_me' },
    steps: [], outputs: [], simulated: true, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, progress: 0,
    createdAt: NOW, startedAt: NOW, ...patch,
  }
}

describe('resumeInterrupted', () => {
  it('re-plans running runs and restarts the in-flight step after a reload', () => {
    plan = () => ({
      steps: [
        { kind: 'think', title: 'One', durationMs: 100, tokens: 100 },
        { kind: 'command', title: 'Two', durationMs: 1000, output: OUTPUT, tokens: 200 },
        { kind: 'think', title: 'Three', durationMs: 100 },
      ],
    })
    const run = start()
    tick()
    tick(100)
    tick(400) // midway through step two
    const before = getRun(run.id)
    expect(before.steps.map((s) => s.status)).toEqual(['done', 'running'])
    const stepTwoId = before.steps[1].id

    __resetEngineForTests() // page reload: timers and plans are gone, the DB row remains
    tick(10_000)
    expect(getRun(run.id).steps[1].status).toBe('running')

    runEngine.resumeInterrupted()
    runEngine.resumeInterrupted() // StrictMode double call must not schedule twice
    tick()
    let r = getRun(run.id)
    expect(r.steps).toHaveLength(2)
    expect(r.steps[1]).toMatchObject({ id: stepTwoId, status: 'running', output: '', startedAt: NOW + 10_500 })
    tick(1000)
    tick(100)
    r = getRun(run.id)
    expect(r.status).toBe('succeeded')
    expect(r.steps.map((s) => s.title)).toEqual(['One', 'Two', 'Three'])
    expect(r.usage).toEqual({
      inputTokens: 70 + 140, outputTokens: 30 + 60, costUsd: splitTokens(100).costUsd + splitTokens(200).costUsd,
    })
  })

  it('does not schedule a run that is already being driven', () => {
    plan = () => ({ steps: [{ kind: 'think', title: 'One', durationMs: 100, tokens: 100 }] })
    const run = start()
    runEngine.resumeInterrupted()
    tick()
    runEngine.resumeInterrupted()
    tick(100)
    const r = getRun(run.id)
    expect(r.status).toBe('succeeded')
    expect(r.steps).toHaveLength(1)
    expect(r.usage.inputTokens).toBe(70)
  })

  it('fails runs whose factory is gone, and unscripted runs from a previous session', () => {
    db.insert('runs', baseRun('run_lost', { script: { factory: 'gone.factory', params: {}, seed: 1, cursor: 0 } }))
    db.insert('runs', baseRun('run_chat_old', { kind: 'chat' }))
    db.insert('runs', baseRun('run_waiting', { status: 'waiting', script: { factory: 'test.plan', params: {}, seed: 1, cursor: 0 } }))
    db.insert('runs', baseRun('run_paused', { status: 'paused', script: { factory: 'test.plan', params: {}, seed: 1, cursor: 0 } }))
    runEngine.resumeInterrupted()
    expect(getRun('run_lost')).toMatchObject({ status: 'failed', error: INTERRUPTED_REASON })
    expect(getRun('run_chat_old')).toMatchObject({ status: 'failed', error: RELOAD_INTERRUPTED_REASON })
    expect(getRun('run_waiting').status).toBe('waiting')
    expect(getRun('run_paused').status).toBe('paused')
  })

  it('resolves an approval after a reload by re-planning the run', () => {
    const onSuccess = vi.fn()
    plan = () => ({
      onSuccess,
      steps: [
        { kind: 'plan', title: 'Plan', durationMs: 50 },
        { kind: 'command', title: 'Deploy', durationMs: 100, approval: { title: 'Deploy to prod', risk: 'high' } },
      ],
    })
    const run = start()
    tick()
    tick(50)
    tick()
    expect(getRun(run.id).status).toBe('waiting')
    const [approval] = pendingApprovals(run.id)

    __resetEngineForTests()
    runEngine.resumeInterrupted() // waiting runs are left alone
    expect(getRun(run.id).status).toBe('waiting')

    runEngine.resolveApproval(approval.id, 'approved')
    tick()
    tick(100)
    const r = getRun(run.id)
    expect(r.status).toBe('succeeded')
    expect(r.steps.map((s) => s.status)).toEqual(['done', 'done'])
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })
})

describe("'scripted' factory", () => {
  const task: Task = {
    id: 'tsk_1', projectId: 'prj_1', title: 'Ship it', status: 'in_progress', priority: 'high', assignee: null, labels: [],
    subtasks: [], runIds: [], order: 0, createdAt: NOW - 1000, updatedAt: NOW - 1000,
  }

  it('runs JSON steps, then applies patches and records outputs on success', () => {
    db.insert('tasks', task)
    const run = runEngine.start({
      kind: 'agent',
      title: 'Seeded run',
      factory: 'scripted',
      params: {
        summary: 'Moved the task to review',
        steps: [
          { kind: 'plan', title: 'Plan', durationMs: 100, tokens: 10 },
          { kind: 'edit', title: 'Edit', durationMs: 200, output: 'a\nb\nc' },
        ],
        outputs: [{ kind: 'task', id: 'tsk_1' }],
        onSuccessPatches: [{ table: 'tasks', id: 'tsk_1', patch: { status: 'review', completedAt: '$now' } }],
      },
    })
    tick()
    tick(100)
    tick(200)
    const r = getRun(run.id)
    expect(r).toMatchObject({ status: 'succeeded', summary: 'Moved the task to review', outputs: [{ kind: 'task', id: 'tsk_1' }] })
    expect(r.steps.map((s) => s.title)).toEqual(['Plan', 'Edit'])
    expect(db.get('tasks', 'tsk_1')).toMatchObject({ status: 'review', completedAt: NOW + 300, updatedAt: NOW + 300 })
    expect(db.find('links', (l) => l.from.id === run.id && l.to.id === 'tsk_1' && l.rel === 'produced')).toBeTruthy()
  })

  it('rejects malformed scripts', () => {
    const bad = (params: Record<string, unknown>) => () => runEngine.start({ kind: 'agent', title: 'Bad', factory: 'scripted', params })
    expect(bad({})).toThrow(/steps must be an array/)
    expect(bad({ steps: [{ kind: 'dance', title: 'x', durationMs: 1 }] })).toThrow(/unknown kind/)
    expect(bad({ steps: [{ kind: 'plan', title: 'x', approval: { title: 'y', risk: 'extreme' } }] })).toThrow(/risk/)
    expect(bad({ steps: [], onSuccessPatches: [{ table: 'nope', id: 'x', patch: {} }] })).toThrow(/known table/)
  })
})
