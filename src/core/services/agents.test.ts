import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { getRunFactory, runEngine, type RunPlan, type StepContext } from '@/core/runs'
import { buildAgentTaskPlan, registerAgentFactories } from '@/core/runs/factories/agent'
import { retrieveKnowledge } from '@/core/search'
import { ME, type Run, type RunStep } from '@/core/types'
import { createRng } from '@/lib/rng'
import {
  AGENT_TEMPLATES,
  computeAgentLiveStatus,
  computeAgentStats,
  createAgent,
  createAgentFromTemplate,
  deleteAgent,
  duplicateAgent,
  runAgent,
  setAgentStatus,
  updateAgent,
  useAgentLiveStatus,
  useAgentStats,
} from './agents'
import { fakeStart, fx } from './testFixtures'

vi.mock('@/core/search', () => ({ search: vi.fn(() => []), retrieveKnowledge: vi.fn(() => []) }))
vi.mock('@/core/seed/demoRepo', () => ({
  DEMO_REPO: {
    owner: 'northwind',
    name: 'atlas-portal',
    defaultBranch: 'main',
    description: 'demo',
    language: 'TypeScript',
    files: [
      { path: 'src/auth/session.ts', content: 'export function refreshSession(token: string) {\n  return token\n}\n' },
      { path: 'src/billing/invoices.ts', content: 'export const invoices = []\n' },
    ],
  },
}))

const DAY = 86_400_000
const NOW = 1_800_000_000_000

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
})

describe('agent service', () => {
  it('creates agents with sensible defaults', () => {
    const grants = [
      { capability: 'messages.send', mode: 'ask', integrationId: 'slack' },
      { capability: 'messages.send', mode: 'allow', integrationId: 'gmail' },
    ] as const
    expect(createAgent({ name: 'Herald', capabilities: grants.map((g) => ({ ...g })) }).capabilities).toEqual(grants)
    const a = createAgent({ name: 'Scout', capabilities: [{ capability: 'web.search', mode: 'allow' }, { capability: 'web.search', mode: 'deny' }] })
    expect(a).toMatchObject({
      status: 'active', role: 'Assistant', modelId: 'sim-swift', autonomy: 'balanced',
      knowledgeScope: { all: true, collectionIds: [], projectIds: [] },
      capabilities: [{ capability: 'web.search', mode: 'allow' }],
    })
    expect(Number.isInteger(a.sigil)).toBe(true)
    expect(db.all('activity')[1]).toMatchObject({ verb: 'created', target: { kind: 'agent', id: a.id } })
  })

  it('ships 8 complete templates that all create valid agents', () => {
    expect(AGENT_TEMPLATES).toHaveLength(8)
    expect(new Set(AGENT_TEMPLATES.map((t) => t.hue)).size).toBe(8)
    for (const t of AGENT_TEMPLATES) {
      const lines = t.instructions.split('\n').length
      expect(lines, t.id).toBeGreaterThanOrEqual(5)
      expect(lines, t.id).toBeLessThanOrEqual(8)
      const agent = createAgentFromTemplate(t.id, { name: undefined })
      expect(agent).toMatchObject({ name: t.name, role: t.role, template: t.id, autonomy: t.autonomy })
      expect(agent.capabilities).toEqual(t.capabilities)
      expect(agent.capabilities).not.toBe(t.capabilities)
    }
    expect(() => createAgentFromTemplate('nope')).toThrow(/Unknown agent template/)
  })

  it('updates, duplicates, pauses and deletes agents', () => {
    const start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
    const cancel = vi.spyOn(runEngine, 'cancel').mockImplementation(() => {})
    const a = createAgent({ name: 'Forge' })
    updateAgent(a.id, { instructions: 'Be careful.' })
    const copy = duplicateAgent(a.id)!
    expect(copy).toMatchObject({ name: 'Forge (copy)', instructions: 'Be careful.' })
    expect(setAgentStatus(a.id, 'paused')?.status).toBe('paused')
    expect(setAgentStatus(a.id, 'active')?.status).toBe('active')
    db.insert('tasks', fx.task({ id: 'tsk_1', assignee: { type: 'agent', id: a.id } }))
    const run = runAgent(a.id, { instruction: 'Do the thing' })
    expect(start).toHaveBeenCalledTimes(1)
    deleteAgent(a.id)
    expect(cancel).toHaveBeenCalledWith(run.id, 'Forge was deleted')
    expect(db.get('tasks', 'tsk_1')?.assignee).toBeNull()
    expect(db.get('agents', a.id)).toBeUndefined()
    expect(db.all('activity').map((e) => e.verb)).toEqual(['created', 'updated', 'created', 'paused', 'resumed', 'deleted'])
  })
})

describe('runAgent', () => {
  beforeEach(() => {
    db.insert('agents', fx.agent({ id: 'agt_1', name: 'Scout', modelId: 'claude-sonnet-5-5' }))
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: 'prj_1', status: 'todo' }))
  })

  it('starts an agent.task run and attaches it to the task', () => {
    const start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
    const instruction = `Summarize competitor pricing changes for Tidewell and Freightly across the last two quarters\nwith sources`
    const run = runAgent('agt_1', { instruction, taskId: 'tsk_1' })
    const input = start.mock.calls[0][0]
    // Agent runs are simulated: the run executes on the simulator and records the configured live model separately,
    // so receipts never label a simulated run with a live model.
    expect(input).toMatchObject({
      kind: 'agent', factory: 'agent.task', agentId: 'agt_1', projectId: 'prj_1', modelId: 'sim-deep',
      origin: { kind: 'task', id: 'tsk_1' }, initiator: ME,
      params: { agentId: 'agt_1', instruction, taskId: 'tsk_1', projectId: 'prj_1', configuredModelId: 'claude-sonnet-5-5' },
    })
    expect(input.title.length).toBeLessThanOrEqual(60)
    expect(input.title.startsWith('Summarize competitor pricing')).toBe(true)
    expect(db.get('tasks', 'tsk_1')).toMatchObject({ status: 'in_progress', runIds: [run.id], assignee: { type: 'agent', id: 'agt_1' } })
    expect(db.all('links')[0]).toMatchObject({ from: { kind: 'run', id: run.id }, to: { kind: 'task', id: 'tsk_1' }, rel: 'derived_from' })
    // “Started …” is logged by the run service; runAgent adds no duplicate event.
    expect(db.all('activity')).toEqual([])
  })

  it('refuses paused, archived and missing agents with friendly errors', () => {
    const start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
    db.update('agents', 'agt_1', { status: 'paused' })
    expect(() => runAgent('agt_1', { instruction: 'x' })).toThrow('Scout is paused. Resume the agent to give it new work.')
    db.update('agents', 'agt_1', { status: 'archived' })
    expect(() => runAgent('agt_1', { instruction: 'x' })).toThrow(/archived/)
    expect(() => runAgent('agt_missing', { instruction: 'x' })).toThrow(/no longer exists/)
    db.update('agents', 'agt_1', { status: 'active' })
    expect(() => runAgent('agt_1', { instruction: '   ' })).toThrow(/what to do/)
    expect(start).not.toHaveBeenCalled()
  })
})

describe('agent stats and live status', () => {
  const run = (o: Partial<Run>) => fx.run({ agentId: 'agt_1', createdAt: NOW - DAY, ...o })

  it('computes 30-day stats', () => {
    const runs = [
      run({ id: 'a', status: 'succeeded', startedAt: NOW - DAY, endedAt: NOW - DAY + 4000, usage: { inputTokens: 700, outputTokens: 300, costUsd: 0.02 } }),
      run({ id: 'b', status: 'failed', startedAt: NOW - 2 * DAY, endedAt: NOW - 2 * DAY + 2000, createdAt: NOW - 2 * DAY, usage: { inputTokens: 100, outputTokens: 100, costUsd: 0.01 } }),
      run({ id: 'c', status: 'cancelled', startedAt: NOW - 1000, createdAt: NOW - 1000 }),
      run({ id: 'old', status: 'succeeded', createdAt: NOW - 40 * DAY, startedAt: NOW - 40 * DAY, usage: { inputTokens: 9999, outputTokens: 1, costUsd: 9 } }),
    ]
    expect(computeAgentStats(runs, NOW)).toEqual({
      runs30d: 3, successRate: 0.5, avgDurationMs: 3000, costUsd30d: 0.03, tokens30d: 1200, lastRunAt: NOW - 1000, costIsEstimate: true,
    })
    expect(computeAgentStats([], NOW)).toMatchObject({ runs30d: 0, successRate: null, avgDurationMs: null, lastRunAt: undefined })
  })

  it('derives live status from configuration and runs', () => {
    const active = { status: 'active' as const }
    expect(computeAgentLiveStatus({ status: 'paused' }, [run({ status: 'running' })], NOW)).toBe('paused')
    expect(computeAgentLiveStatus(active, [run({ status: 'running' }), run({ status: 'waiting' })], NOW)).toBe('waiting')
    expect(computeAgentLiveStatus(active, [run({ status: 'queued' })], NOW)).toBe('working')
    expect(computeAgentLiveStatus(active, [run({ status: 'failed', endedAt: NOW - 3600_000 })], NOW)).toBe('attention')
    expect(computeAgentLiveStatus(active, [run({ status: 'failed', endedAt: NOW - 2 * DAY })], NOW)).toBe('idle')
    expect(computeAgentLiveStatus(active, [run({ status: 'failed', endedAt: NOW - 3000 }), run({ status: 'succeeded', endedAt: NOW - 1000 })], NOW)).toBe('idle')
  })

  it('hooks follow the runs table', () => {
    db.insert('agents', fx.agent({ id: 'agt_1' }))
    const status = renderHook(() => useAgentLiveStatus('agt_1'))
    const stats = renderHook(() => useAgentStats('agt_1'))
    expect(status.result.current).toBe('idle')
    const first = stats.result.current
    act(() => db.insert('runs', fx.run({ id: 'r1', agentId: 'agt_1', status: 'running', createdAt: Date.now() })))
    expect(status.result.current).toBe('working')
    expect(stats.result.current.runs30d).toBe(1)
    expect(stats.result.current).not.toBe(first)
  })
})

// ---------------------------------------------------------------- 'agent.task' factory

const FULL_GRANTS = [
  { capability: 'knowledge.read', mode: 'allow' },
  { capability: 'repo.read', mode: 'allow', integrationId: 'github' },
  { capability: 'web.search', mode: 'allow', integrationId: 'web-search' },
  { capability: 'web.browse', mode: 'allow', integrationId: 'web-search' },
  { capability: 'data.query', mode: 'allow', integrationId: 'postgres' },
  { capability: 'knowledge.write', mode: 'allow' },
  { capability: 'tasks.manage', mode: 'allow' },
  { capability: 'messages.send', mode: 'ask', integrationId: 'slack' },
  { capability: 'payments.spend', mode: 'deny', integrationId: 'stripe' },
] as const

const PARAMS = { agentId: 'agt_1', instruction: 'Summarize churn drivers for logistics customers', taskId: 'tsk_1', projectId: 'prj_1' }

function withoutFns(plan: RunPlan) {
  return JSON.parse(JSON.stringify(plan.steps)) as unknown
}

function stepCtx(run: Run, step: RunStep): StepContext {
  return {
    run,
    step,
    rng: createRng(1),
    addOutput: vi.fn((ref) => {
      run.outputs = [...run.outputs, ref]
    }),
    patchRun: vi.fn(),
  }
}

function runFromPlan(plan: RunPlan, overrides: Partial<Run> = {}): Run {
  const steps: RunStep[] = plan.steps.map((s, i) => ({ id: `stp_${i}`, kind: s.kind, title: s.title, status: 'done', capability: s.capability }))
  const run = fx.run({ id: 'run_a', agentId: 'agt_1', projectId: 'prj_1', steps, status: 'running', ...overrides })
  db.insert('runs', run)
  return run
}

describe("'agent.task' factory", () => {
  beforeEach(() => {
    db.insert('agents', fx.agent({ id: 'agt_1', name: 'Scout', capabilities: FULL_GRANTS.map((g) => ({ ...g })) }))
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: 'prj_1', status: 'in_progress', runIds: ['run_a'] }))
    db.insert('knowledge', fx.knowledge({ id: 'kno_churn', title: 'Churn interview synthesis' }))
    vi.mocked(retrieveKnowledge).mockReturnValue([
      { item: db.get('knowledge', 'kno_churn')!, passage: 'Customers cited onboarding friction and missing exports.', score: 0.9 },
    ])
  })

  it('registers under agent.task', () => {
    registerAgentFactories()
    expect(getRunFactory('agent.task')).toBeTypeOf('function')
  })

  it('plans steps from the agent’s capabilities, never using denied ones', () => {
    const plan = buildAgentTaskPlan(PARAMS, createRng(7))
    expect(plan.steps.map((s) => `${s.kind}:${s.capability ?? '-'}`)).toEqual([
      'plan:-', 'search:knowledge.read', 'read:repo.read', 'search:web.search', 'browse:web.browse', 'tool:data.query',
      'think:-', 'write:knowledge.write', 'tool:tasks.manage', 'message:messages.send', 'message:-',
    ])
    expect(plan.steps.some((s) => s.capability === 'payments.spend')).toBe(false)
    for (const s of plan.steps) {
      expect(s.durationMs).toBeGreaterThanOrEqual(600)
      expect(s.durationMs).toBeLessThanOrEqual(4000)
      expect(s.tokens).toBeGreaterThanOrEqual(300)
      expect(s.tokens).toBeLessThanOrEqual(4000)
    }
    const [planStep, knowledge, repo, web, browse, data] = plan.steps
    expect(planStep.output?.split('\n')).toHaveLength(plan.steps.length - 1)
    expect(knowledge.refs).toEqual([{ kind: 'knowledge', id: 'kno_churn' }])
    expect(knowledge.output).toContain('Churn interview synthesis')
    expect(repo.output).toContain('src/')
    expect(web).toMatchObject({ integrationId: 'web-search', failChance: 0.04 })
    for (const line of web.output!.split('\n').filter((l) => /^\d+\./.test(l))) {
      expect(line).toContain('(simulated source)')
    }
    expect(web.output).toMatch(/https:\/\/[a-z0-9-]+\.example\//)
    expect(web.output).not.toMatch(/https:\/\/(?![a-z0-9-]+\.example\/)/)
    expect(web.output).not.toContain('summarize-')
    expect(browse.output).toContain('simulated content')
    expect(data).toMatchObject({ integrationId: 'postgres', failChance: 0.04 })
    expect(data.input).toMatch(/^SELECT/)
    expect(data.output).toContain('simulated result')
    expect(plan.summary).toContain('Scout finished')
  })

  it('gates the Slack post behind a high-risk approval', () => {
    const plan = buildAgentTaskPlan(PARAMS, createRng(7))
    const post = plan.steps.find((s) => s.capability === 'messages.send')!
    expect(post).toMatchObject({ integrationId: 'slack', tool: 'slack', failChance: 0.04 })
    expect(post.approval).toMatchObject({ title: 'Post update to #support-ops', risk: 'high', onReject: 'skip', preview: { kind: 'message', label: '#support-ops' } })
    expect(post.approval?.preview?.content).toContain('Update from Scout')
    expect(post.output).toContain('simulated')
  })

  it('is deterministic for a seed and varies across seeds', () => {
    expect(withoutFns(buildAgentTaskPlan(PARAMS, createRng(42)))).toEqual(withoutFns(buildAgentTaskPlan(PARAMS, createRng(42))))
    expect(withoutFns(buildAgentTaskPlan(PARAMS, createRng(42)))).not.toEqual(withoutFns(buildAgentTaskPlan(PARAMS, createRng(43))))
  })

  it('falls back gracefully when retrieval finds nothing, and fails cleanly for missing agents', () => {
    vi.mocked(retrieveKnowledge).mockReturnValue([])
    const plan = buildAgentTaskPlan(PARAMS, createRng(1))
    expect(plan.steps[1]).toMatchObject({ refs: [], output: expect.stringContaining('No matching knowledge found') })
    const missing = buildAgentTaskPlan({ ...PARAMS, agentId: 'agt_gone' }, createRng(1))
    expect(missing.steps).toHaveLength(1)
    expect(missing.steps[0]).toMatchObject({ failChance: 1, failMessage: expect.stringContaining('no longer exists') })
  })

  it('creates a real knowledge note and follow-up task, idempotently', () => {
    const plan = buildAgentTaskPlan(PARAMS, createRng(3))
    const run = runFromPlan(plan)
    const noteIdx = plan.steps.findIndex((s) => s.capability === 'knowledge.write')
    const taskIdx = plan.steps.findIndex((s) => s.capability === 'tasks.manage')

    const noteCtx = stepCtx(run, run.steps[noteIdx])
    plan.steps[noteIdx].onComplete!(noteCtx)
    plan.steps[noteIdx].onComplete!(noteCtx)
    const notes = db.filter('knowledge', (k) => k.source.type === 'agent')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({
      kind: 'note', author: { type: 'agent', id: 'agt_1' }, source: { type: 'agent', ref: { kind: 'run', id: 'run_a' } },
      projectIds: ['prj_1'], simulated: true,
    })
    expect(notes[0].content).toContain('## What the run did')
    expect(notes[0].content).toContain('Churn interview synthesis')
    expect(notes[0].content).toContain('simulated run')
    expect(noteCtx.addOutput).toHaveBeenCalledTimes(1)

    const taskCtx = stepCtx(run, run.steps[taskIdx])
    plan.steps[taskIdx].onComplete!(taskCtx)
    plan.steps[taskIdx].onComplete!(taskCtx)
    const followUps = db.filter('tasks', (t) => t.origin?.kind === 'run')
    expect(followUps).toHaveLength(1)
    expect(followUps[0]).toMatchObject({ assignee: ME, projectId: 'prj_1', priority: 'medium', origin: { kind: 'run', id: 'run_a' } })
    expect(followUps[0].subtasks).toHaveLength(3)
    expect(db.all('activity').find((e) => e.target.id === followUps[0].id)?.actor).toEqual({ type: 'agent', id: 'agt_1' })
  })

  it('moves the task to Review on success and back to To do on failure', () => {
    const plan = buildAgentTaskPlan(PARAMS, createRng(3))
    const run = runFromPlan(plan)
    const ctx = { run, rng: createRng(1), addOutput: vi.fn(), patchRun: vi.fn() }
    plan.onSuccess!(ctx)
    expect(db.get('tasks', 'tsk_1')?.status).toBe('review')
    expect(db.all('activity').at(-1)).toMatchObject({ actor: { type: 'agent', id: 'agt_1' }, summary: 'Scout finished “Fix login redirect” — ready for review' })

    db.update('tasks', 'tsk_1', { status: 'in_progress' })
    plan.onFailure!({ ...ctx, reason: 'cancelled' })
    expect(db.get('tasks', 'tsk_1')?.status).toBe('todo')

    // An older run must not override a task that has moved on to a newer run.
    db.insert('runs', fx.run({ id: 'run_b', agentId: 'agt_1', status: 'running', createdAt: run.createdAt + 1000 }))
    db.update('tasks', 'tsk_1', { status: 'in_progress', runIds: ['run_a', 'run_b'] })
    plan.onSuccess!(ctx)
    expect(db.get('tasks', 'tsk_1')?.status).toBe('in_progress')
  })

  it('attaches retried runs (started by the engine, not runAgent) to their task', () => {
    const plan = buildAgentTaskPlan(PARAMS, createRng(3))
    db.update('tasks', 'tsk_1', { status: 'review', runIds: [] })
    const run = runFromPlan(plan, { id: 'run_retry' })
    plan.steps[0].onComplete!(stepCtx(run, run.steps[0]))
    plan.steps[0].onComplete!(stepCtx(run, run.steps[0]))
    expect(db.get('tasks', 'tsk_1')).toMatchObject({ status: 'in_progress', runIds: ['run_retry'] })
  })
})

describe("'agent.task' through the real run engine", () => {
  beforeEach(() => {
    registerAgentFactories()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('runs end to end: note + follow-up task are produced and the task moves to Review', async () => {
    db.insert('agents', fx.agent({
      id: 'agt_1',
      name: 'Scout',
      capabilities: [
        { capability: 'knowledge.read', mode: 'allow' },
        { capability: 'knowledge.write', mode: 'allow' },
        { capability: 'tasks.manage', mode: 'allow' },
      ],
    }))
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: 'prj_1', status: 'todo' }))
    const run = runAgent('agt_1', { instruction: 'Summarize churn drivers', taskId: 'tsk_1' })
    expect(db.get('tasks', 'tsk_1')).toMatchObject({ status: 'in_progress', runIds: [run.id] })

    await vi.advanceTimersByTimeAsync(10 * 60_000)

    const finished = db.get('runs', run.id)!
    expect(finished.status).toBe('succeeded')
    expect(finished.simulated).toBe(true)
    expect(finished.steps.map((s) => s.status)).toEqual(finished.steps.map(() => 'done'))
    expect(finished.outputs.map((o) => o.kind).sort()).toEqual(['knowledge', 'task'])
    expect(finished.summary).toContain('Scout finished')
    expect(db.get('tasks', 'tsk_1')?.status).toBe('review')
    const note = db.get('knowledge', finished.outputs.find((o) => o.kind === 'knowledge')!.id)!
    expect(note.content).toContain('1. ✓ Plan the approach')
    expect(db.all('activity').map((e) => e.verb)).toEqual(expect.arrayContaining(['started', 'saved', 'created', 'completed']))
  })
})
