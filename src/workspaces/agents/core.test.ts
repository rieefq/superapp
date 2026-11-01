import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { runEngine, type StepContext } from '@/core/runs'
import { buildAgentTaskPlan, parseAgentTaskParams } from '@/core/runs/factories/agent'
import { retrieveKnowledge } from '@/core/search'
import {
  assertAgentCanRun,
  computeAgentSpend,
  createAgent,
  nextCronRun,
  pauseAgent,
  resumeAgent,
  runAgent,
  startAgentScheduler,
  updateAgent,
} from '@/core/services/agents'
import { fakeStart, fx } from '@/core/services/testFixtures'
import { useSettingsStore } from '@/core/settings'
import type { Run, RunStep } from '@/core/types'
import { createRng } from '@/lib/rng'

/* Unit tests for the Agents workspace's core: schedules, spend and budgets, grants, and the
   'agent.task' plan (permission gates, the context you attached, a summary written from what ran). */

vi.mock('@/core/search', () => ({ search: vi.fn(() => []), retrieveKnowledge: vi.fn(() => []) }))
vi.mock('@/core/seed/demoRepo', () => ({
  DEMO_REPO: { owner: 'northwind', name: 'atlas-portal', defaultBranch: 'main', description: 'demo', language: 'TypeScript', files: [] },
}))

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()

beforeEach(() => {
  db.replaceAll(emptyTables())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  useSettingsStore.getState().reset()
})

describe('nextCronRun', () => {
  it('finds the next matching minute for the schedule presets', () => {
    const sunNoon = local(2026, 11, 1, 12, 0) // Sunday
    expect(nextCronRun('0 8 * * 1', sunNoon)).toBe(local(2026, 11, 2, 8, 0))
    expect(nextCronRun('0 9 * * 1-5', local(2026, 11, 6, 10, 0))).toBe(local(2026, 11, 9, 9, 0)) // Fri → Mon
    expect(nextCronRun('0 2 * * *', sunNoon)).toBe(local(2026, 11, 2, 2, 0))
    expect(nextCronRun('0 * * * *', local(2026, 11, 1, 12, 30))).toBe(local(2026, 11, 1, 13, 0))
    expect(nextCronRun('*/15 * * * *', local(2026, 11, 1, 12, 7))).toBe(local(2026, 11, 1, 12, 15))
  })

  it('is strictly after `from` and rejects invalid expressions', () => {
    expect(nextCronRun('0 12 * * *', local(2026, 11, 1, 12, 0))).toBe(local(2026, 11, 2, 12, 0))
    expect(nextCronRun('nope', 0)).toBeUndefined()
    expect(nextCronRun('61 * * * *', 0)).toBeUndefined()
  })
})

describe('spend and budgets', () => {
  const NOW = local(2026, 11, 15, 12)
  const run = (o: Partial<Run>) => fx.run({ agentId: 'agt_1', status: 'succeeded', ...o })

  it('counts month-to-date spend, estimates only when settings say so', () => {
    const runs = [
      run({ id: 'a', simulated: true, endedAt: local(2026, 11, 3), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 } }),
      run({ id: 'b', simulated: false, endedAt: local(2026, 11, 10), usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.25 } }),
      run({ id: 'old', simulated: false, endedAt: local(2026, 10, 30), usage: { inputTokens: 1, outputTokens: 1, costUsd: 9 } }),
    ]
    expect(computeAgentSpend(runs, NOW, false)).toEqual({ liveUsd: 0.25, estimatedUsd: 0.5, countedUsd: 0.25, countsEstimates: false })
    expect(computeAgentSpend(runs, NOW, true)).toMatchObject({ countedUsd: 0.75, countsEstimates: true })
  })

  it('refuses new work once the counted spend reaches the budget', () => {
    db.insert('agents', fx.agent({ id: 'agt_1', name: 'Ledger', monthlyBudgetUsd: 1 }))
    db.insert('runs', run({ id: 'r', simulated: true, endedAt: Date.now(), usage: { inputTokens: 1, outputTokens: 1, costUsd: 2 } }))
    // Simulated estimates don't count by default…
    expect(() => assertAgentCanRun('agt_1')).not.toThrow()
    // …until Settings › Budgets counts them.
    useSettingsStore.getState().update('safety', { countSimulatedSpend: true })
    expect(() => assertAgentCanRun('agt_1')).toThrow(/used its monthly budget/)
  })
})

describe('grants', () => {
  it('keeps “Always allow” on allow grants only', () => {
    const a = createAgent({ name: 'Forge', capabilities: [{ capability: 'shell.execute', mode: 'allow', integrationId: 'sandbox', always: true }] })
    expect(a.capabilities[0]).toEqual({ capability: 'shell.execute', mode: 'allow', integrationId: 'sandbox', always: true })
    const next = updateAgent(a.id, { capabilities: [{ capability: 'shell.execute', mode: 'ask', integrationId: 'sandbox', always: true }] })
    expect(next?.capabilities[0]).toEqual({ capability: 'shell.execute', mode: 'ask', integrationId: 'sandbox' })
  })
})

describe('pause and resume', () => {
  it('pausing an agent pauses its running runs; resuming picks them up', () => {
    db.insert('agents', fx.agent({ id: 'agt_1' }))
    db.insert('runs', fx.run({ id: 'r1', agentId: 'agt_1', status: 'running', script: { factory: 'agent.task', params: {}, seed: 1, cursor: 0 } }))
    const pause = vi.spyOn(runEngine, 'pause').mockImplementation((id) => void db.update('runs', id, { status: 'paused' }))
    const resume = vi.spyOn(runEngine, 'resume').mockImplementation((id) => void db.update('runs', id, { status: 'running' }))
    expect(pauseAgent('agt_1')).toBe(1)
    expect(db.get('agents', 'agt_1')?.status).toBe('paused')
    expect(pause).toHaveBeenCalledWith('r1')
    expect(() => runAgent('agt_1', { instruction: 'x' })).toThrow(/paused/)
    expect(resumeAgent('agt_1')).toBe(1)
    expect(resume).toHaveBeenCalledWith('r1')
    expect(db.get('agents', 'agt_1')?.status).toBe('active')
  })
})

describe('schedules', () => {
  it('starts an enabled schedule once when its minute passes, while Atrium is open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(local(2026, 11, 2, 7, 59)) // Monday 07:59
    db.insert('agents', fx.agent({ id: 'agt_1', name: 'Scout', schedule: { cron: '0 8 * * 1', label: 'Mondays at 08:00', enabled: true } }))
    db.insert('agents', fx.agent({ id: 'agt_2', name: 'Off', schedule: { cron: '0 8 * * 1', label: 'Mondays at 08:00', enabled: false } }))
    const start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
    const stop = startAgentScheduler(20_000)
    try {
      vi.advanceTimersByTime(40_000) // 07:59:40
      expect(start).not.toHaveBeenCalled()
      vi.advanceTimersByTime(40_000) // 08:00:20
      expect(start).toHaveBeenCalledTimes(1)
      expect(start.mock.calls[0][0]).toMatchObject({ agentId: 'agt_1', initiator: { type: 'system', id: 'system' }, params: { trigger: 'Scheduled · Mondays at 08:00' } })
      vi.advanceTimersByTime(120_000)
      expect(start).toHaveBeenCalledTimes(1)
    } finally {
      stop()
    }
  })
})

// ------------------------------------------------------------------------------------------------ 'agent.task'

const GRANTS = [
  { capability: 'knowledge.read', mode: 'allow' },
  { capability: 'web.search', mode: 'ask', integrationId: 'web-search' },
  { capability: 'knowledge.write', mode: 'allow' },
] as const

function ctxFor(run: Run, step: RunStep): StepContext {
  return { run, step, rng: createRng(1), addOutput: vi.fn(), patchRun: vi.fn() }
}

describe("'agent.task' plan", () => {
  beforeEach(() => {
    db.insert('agents', fx.agent({ id: 'agt_1', name: 'Iris', capabilities: GRANTS.map((g) => ({ ...g })) }))
    db.insert('knowledge', fx.knowledge({ id: 'kno_1', title: 'Pricing memo', summary: 'Hybrid pricing beats pure usage.' }))
    vi.mocked(retrieveKnowledge).mockReturnValue([])
  })

  it('gates every capability step behind the live policy, skipping what is denied', () => {
    const params = parseAgentTaskParams({ agentId: 'agt_1', instruction: 'Compare pricing models' })
    // Not connected: the policy blocks the web step (the engine skips it at run time).
    const blocked = buildAgentTaskPlan(params, createRng(2))
    expect(blocked.steps[0].output).toMatch(/Search the web for .*\(blocked: Web search is not connected\)/)
    // Connected: the grant says Ask, so the step raises an approval when it runs.
    db.insert('connections', { id: 'web-search', status: 'connected', mode: 'simulated', scopes: [{ capability: 'web.search', mode: 'allow' }], config: {}, usageCount: 0 })
    const plan = buildAgentTaskPlan(params, createRng(2))
    const gated = plan.steps.filter((s) => s.capability)
    expect(gated.length).toBeGreaterThan(0)
    for (const s of gated) expect(s.approval).toMatchObject({ onReject: 'skip' })
    expect(plan.steps[0].output).toMatch(/Search the web for .*\(asks you first\)/)
  })

  it('reads the context you attached first, so it lands in the run’s Saw list', () => {
    const plan = buildAgentTaskPlan(
      parseAgentTaskParams({ agentId: 'agt_1', instruction: 'Compare pricing models', context: [{ kind: 'knowledge', id: 'kno_1' }, { kind: 'knowledge', id: 'kno_gone' }] }),
      createRng(2),
    )
    expect(plan.steps[1]).toMatchObject({ kind: 'read', title: 'Read 1 item from your context', refs: [{ kind: 'knowledge', id: 'kno_1' }] })
    expect(plan.steps[1].output).toContain('Pricing memo — “Hybrid pricing beats pure usage.”')
  })

  it('writes the summary from what actually ran', () => {
    const plan = buildAgentTaskPlan(parseAgentTaskParams({ agentId: 'agt_1', instruction: 'Compare pricing models' }), createRng(2))
    const summaryStep = plan.steps[plan.steps.length - 1]
    expect(summaryStep.output).toBeUndefined()
    const webIndex = plan.steps.findIndex((s) => s.capability === 'web.search')
    const steps: RunStep[] = plan.steps.map((s, i) => ({ id: `stp_${i}`, kind: s.kind, title: s.title, status: i === webIndex ? 'skipped' : 'done', capability: s.capability }))
    const run = fx.run({ id: 'run_1', agentId: 'agt_1', steps })
    db.insert('runs', run)
    summaryStep.onComplete!(ctxFor(run, steps[steps.length - 1]))
    const output = db.get('runs', 'run_1')!.steps.at(-1)!.output!
    expect(output).toContain('Not done')
    expect(output).toContain('Skipped “Search the web for')
    expect(output).not.toContain('Collected')
    const patchRun = vi.fn()
    plan.onSuccess!({ run, rng: createRng(1), addOutput: vi.fn(), patchRun })
    expect(patchRun).toHaveBeenCalledWith({ summary: expect.stringMatching(/^Iris finished “Compare pricing models”: saved notes\. 1 step didn’t run\.$/) })
  })
})
