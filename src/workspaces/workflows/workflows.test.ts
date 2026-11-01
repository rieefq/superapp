import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { __resetEngineForTests, runEngine } from '@/core/runs/engine'
import { guardedAction, planWorkflow, registerWorkflowFactories } from '@/core/runs/factories/workflow'
import { fx } from '@/core/services/testFixtures'
import {
  buildTrigger, createWorkflow, runWorkflow, setWorkflowTrigger, startWorkflowTriggers, triggerShort, updateWorkflow, workflowStats,
} from '@/core/services/workflows'
import { useSettingsStore } from '@/core/settings'
import { cronMatches, isSidewaysLayout, layoutGraph, nextCronTime, parseCron, renderTemplate } from '@/core/sim/workflow'
import { isRunActive, type IntegrationConnection, type Run, type WorkflowEdge, type WorkflowNode } from '@/core/types'
import { createRng } from '@/lib/rng'
import { workflowCapabilities } from './capabilities'
import { connect, connectionProblem, insertAfter, removeNode, type Graph } from './graph'
import { buildOutline } from './outline'
import { computeOverlay } from './overlay'
import { TEMPLATES } from './templates'

const NOW = new Date('2026-11-01T10:00:00').getTime()
registerWorkflowFactories()

const n = (id: string, type: WorkflowNode['type'], extra: Partial<WorkflowNode> = {}): WorkflowNode => ({ id, type, label: id, position: { x: 0, y: 0 }, config: {}, ...extra })
const e = (source: string, target: string, sourceHandle?: 'true' | 'false'): WorkflowEdge => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })
const connected = (id: string): IntegrationConnection => ({ id, status: 'connected', mode: 'simulated', scopes: [], config: { defaultChannel: '#product' }, usageCount: 0, connectedAt: NOW })

/** The seeded "Weekly project digest" shape: trigger → (collect, calendar) → agent → approval → post → log. */
function digestGraph(): Graph {
  return {
    nodes: [
      n('t', 'trigger', { label: 'Mondays at 09:00', config: { cron: '0 9 * * 1' } }),
      n('collect', 'transform', { capability: 'tasks.manage', config: { window: '7d' } }),
      n('cal', 'transform', { integrationId: 'google-calendar', capability: 'calendar.manage' }),
      n('write', 'agent', { label: 'Write the digest', agentId: 'agt_herald', config: { prompt: 'Write the weekly digest' } }),
      n('review', 'approval', { label: 'Review before posting', capability: 'messages.send' }),
      n('post', 'action', { label: 'Post to #product', integrationId: 'slack', capability: 'messages.send', config: { channel: '#product' } }),
      n('log', 'output', { label: 'Log & notify', config: { kind: 'notify' } }),
    ],
    edges: [e('t', 'collect'), e('t', 'cal'), e('collect', 'write'), e('cal', 'write'), e('write', 'review'), e('review', 'post'), e('post', 'log')],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
  db.insert('agents', fx.agent({ id: 'agt_herald', name: 'Herald', role: 'Communications', capabilities: [{ capability: 'messages.send', mode: 'ask', integrationId: 'slack' }, { capability: 'knowledge.read', mode: 'allow' }] }))
  for (const id of ['slack', 'google-calendar', 'linear']) db.insert('connections', connected(id))
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('layout', () => {
  it('lays a graph out top to bottom: ranks by depth, branches side by side, the trigger in the center column', () => {
    const g = digestGraph()
    const pos = layoutGraph(g.nodes, g.edges)
    expect(pos.t).toEqual({ x: 0, y: 0 })
    expect(pos.collect.y).toBe(pos.cal.y)
    expect(pos.collect.x).toBeLessThan(pos.cal.x)
    expect(pos.write).toEqual({ x: 0, y: 256 })
    expect(pos.log.y).toBe(128 * 5)
    // A condition puts Yes left of No.
    const cond = layoutGraph([n('t', 'trigger'), n('c', 'condition'), n('no', 'output'), n('yes', 'output')], [e('t', 'c'), e('c', 'no', 'false'), e('c', 'yes', 'true')])
    expect(cond.yes.x).toBeLessThan(cond.no.x)
  })

  it('recognizes sideways (left to right) graphs', () => {
    const g = digestGraph()
    const sideways = g.nodes.map((node, i) => ({ ...node, position: { x: i * 280, y: 0 } }))
    expect(isSidewaysLayout(sideways, g.edges)).toBe(true)
    const pos = layoutGraph(g.nodes, g.edges)
    expect(isSidewaysLayout(g.nodes.map((node) => ({ ...node, position: pos[node.id] })), g.edges)).toBe(false)
  })
})

describe('cron and templates', () => {
  it('parses cron, matches minutes and finds the next run (local time)', () => {
    expect(parseCron('0 9 * * 1-5')).not.toBeNull()
    expect(parseCron('61 9 * * *')).toBeNull()
    expect(parseCron('every monday')).toBeNull()
    const monday9 = new Date('2026-11-02T09:00:00').getTime()
    expect(cronMatches('0 9 * * 1', monday9)).toBe(true)
    expect(cronMatches('0 9 * * 2', monday9)).toBe(false)
    expect(nextCronTime('0 9 * * 1', NOW)).toBe(monday9)
    expect(nextCronTime('*/15 * * * *', NOW)).toBe(NOW + 15 * 60_000)
    expect(nextCronTime('0 9 1 * *', NOW)).toBe(new Date('2026-12-01T09:00:00').getTime())
  })

  it('fills {{placeholders}} from the run and keeps unknown ones', () => {
    expect(renderTemplate('Urgent: {{subject}} — {{summary}} ({{plan}})', { subject: 'Locked out', lastOutput: '**Access issue**\nmore' })).toBe('Urgent: Locked out — Access issue ({{plan}})')
  })

  it('describes triggers tersely for lists', () => {
    expect(triggerShort(buildTrigger({ type: 'schedule', cron: '0 9 * * 1' }))).toBe('Mon 09:00')
    expect(triggerShort(buildTrigger({ type: 'schedule', cron: '0 9 * * 1-5' }))).toBe('weekdays 09:00')
    expect(triggerShort(buildTrigger({ type: 'event', event: 'knowledge.created' }))).toBe('on knowledge.created')
    expect(buildTrigger({ type: 'event', event: 'knowledge.created' }).label).toBe('When knowledge is added')
    expect(buildTrigger({ type: 'webhook' })).toMatchObject({ type: 'webhook', label: 'When a webhook is received' })
  })
})

describe('graph edits', () => {
  it('inserts after the selection, taking over its connections, and moves the steps below', () => {
    const g = digestGraph()
    const placed = { nodes: g.nodes.map((node) => ({ ...node, position: layoutGraph(g.nodes, g.edges)[node.id] })), edges: g.edges }
    const r = insertAfter(placed, 'delay', 'write')
    const added = r.nodes.find((x) => x.id === r.nodeId)!
    expect(added).toMatchObject({ type: 'delay', label: 'Wait 1 hour' })
    expect(r.edges.some((x) => x.source === 'write' && x.target === r.nodeId)).toBe(true)
    expect(r.edges.some((x) => x.source === r.nodeId && x.target === 'review')).toBe(true)
    expect(r.edges.some((x) => x.source === 'write' && x.target === 'review')).toBe(false)
    const reviewBefore = placed.nodes.find((x) => x.id === 'review')!.position.y
    expect(r.nodes.find((x) => x.id === 'review')!.position.y).toBe(reviewBefore + 128)
  })

  it('gives a condition its free branch and refuses loops, duplicates and edges into the trigger', () => {
    const g: Graph = { nodes: [n('t', 'trigger'), n('c', 'condition'), n('a', 'output'), n('b', 'output')], edges: [e('t', 'c'), e('c', 'a', 'true')] }
    const r = insertAfter(g, 'output', 'c')
    expect(r.edges.find((x) => x.target === r.nodeId)).toMatchObject({ source: 'c', sourceHandle: 'false', label: 'No' })
    expect(connectionProblem(g, 'a', 't')).toMatch(/trigger/)
    expect(connectionProblem(g, 'a', 'c')).toMatch(/loop/)
    expect(connectionProblem(g, 'c', 'a', 'true')).toMatch(/already/)
    expect(connectionProblem(g, 'c', 'b', 'false')).toBeNull()
    // Reconnecting a branch replaces it.
    expect(connect(g, 'c', 'b', 'true').edges.filter((x) => x.source === 'c' && x.sourceHandle === 'true').map((x) => x.target)).toEqual(['b'])
  })

  it('bridges a simple chain when a step is removed', () => {
    const g = digestGraph()
    const r = removeNode(g, 'review')
    expect(r.nodes.some((x) => x.id === 'review')).toBe(false)
    expect(r.edges.some((x) => x.source === 'write' && x.target === 'post')).toBe(true)
  })
})

describe('outline', () => {
  it('numbers steps and indents branches until they meet', () => {
    const nodes = [n('t', 'trigger'), n('c', 'condition', { label: 'Urgent?' }), n('alert', 'action'), n('issue', 'action'), n('log', 'output')]
    const edges = [e('t', 'c'), e('c', 'alert', 'true'), e('c', 'issue', 'false'), e('alert', 'log'), e('issue', 'log')]
    const { items, orphans } = buildOutline([...nodes, n('lost', 'output')], edges)
    expect(items.map((i) => [i.node.id, i.number, i.depth])).toEqual([
      ['t', '1', 0],
      ['c', '2', 0],
      ['alert', '2a', 1],
      ['issue', '2b', 1],
      ['log', '3', 0],
    ])
    expect(items.find((i) => i.node.id === 'issue')?.branch).toBe('false')
    expect(orphans.map((o) => o.id)).toEqual(['lost'])
  })
})

describe('workflow runs', () => {
  it('an approval step guards the next action with its capability: one decision, no second card', () => {
    const g = digestGraph()
    expect(guardedAction(g.nodes.find((x) => x.id === 'review')!, g.nodes, g.edges)?.id).toBe('post')
    db.insert('workflows', fx.workflow({ id: 'wfl_d', name: 'Weekly project digest', trigger: { type: 'schedule', label: 'Mondays at 09:00', cron: '0 9 * * 1' }, ...g }))
    const plan = planWorkflow({ workflowId: 'wfl_d', trigger: 'manual' }, createRng(3))
    expect(plan.steps.map((s) => s.nodeId)).toEqual(['t', 'collect', 'cal', 'write', 'write', 'review', 'post', 'log'])
    const review = plan.steps.find((s) => s.nodeId === 'review')!
    expect(review).toMatchObject({ kind: 'approval', capability: 'messages.send', integrationId: 'slack', approval: { title: 'Post to #product', risk: 'high', preview: { kind: 'message', label: '#product' } } })
    expect(plan.steps.find((s) => s.nodeId === 'post')!.approval).toBeUndefined()
    expect(plan.steps.find((s) => s.nodeId === 'post')!.detail).toContain('approved at “Review before posting”')
    expect(plan.steps[0].detail).toMatch(/^Started now by Test run/)
    // The activity read is real (counts from this workspace); the calendar read is simulated.
    expect(plan.steps.find((s) => s.nodeId === 'collect')!.output).toContain('Read from this workspace.')
    expect(plan.steps.find((s) => s.nodeId === 'cal')!.output).toContain('simulated')
  })

  it('runs the digest to success with exactly one approval', async () => {
    db.insert('workflows', fx.workflow({ id: 'wfl_d', name: 'Weekly project digest', ...digestGraph() }))
    const run = runWorkflow('wfl_d')
    for (let round = 0; round < 30; round++) {
      await vi.advanceTimersByTimeAsync(20_000)
      for (const a of db.filter('approvals', (x) => x.status === 'pending')) runEngine.resolveApproval(a.id, 'approved')
      if (!isRunActive(db.get('runs', run.id)!.status)) break
    }
    expect(db.get('runs', run.id)?.status).toBe('succeeded')
    expect(db.filter('approvals', (a) => a.runId === run.id)).toHaveLength(1)
  })

  it('draws the run on the graph: done, waiting, pending, and the active edge', () => {
    const g = digestGraph()
    const step = (nodeId: string, status: Run['steps'][number]['status']) => ({ id: `s_${nodeId}_${status}`, kind: 'tool' as const, title: nodeId, status, nodeId })
    const run = fx.run({ id: 'run_x', kind: 'workflow', status: 'waiting', steps: [step('t', 'done'), step('collect', 'done'), step('cal', 'done'), step('write', 'done'), step('review', 'waiting')] })
    const o = computeOverlay(run, g)
    expect(o.nodes).toMatchObject({ t: 'done', write: 'done', review: 'waiting', post: 'pending', log: 'pending' })
    expect(o.currentNodeId).toBe('review')
    expect(o.edges['write-review']).toBe('active')
    expect(o.edges['t-collect']).toBe('traversed')
    expect(o.edges['review-post']).toBe('idle')
    const ended = computeOverlay({ ...run, status: 'cancelled', steps: run.steps.map((s) => (s.status === 'waiting' ? { ...s, status: 'skipped' as const } : s)) }, g)
    expect(ended.nodes).toMatchObject({ review: 'skipped', post: 'skipped' })
  })

  it('reads what a workflow can do the way its runs decide', () => {
    const rows = workflowCapabilities(digestGraph())
    const post = rows.find((r) => r.short === 'Post to #product')!
    expect(post).toMatchObject({ word: 'asks you', simulated: true })
    expect(post.decision.reason).toContain('Review before posting')
    expect(rows.find((r) => r.capability === 'tasks.manage')).toMatchObject({ word: 'allowed', simulated: false })
  })

  it('summarizes run history', () => {
    const runs = [
      fx.run({ id: 'a', status: 'succeeded', createdAt: NOW - 3_600_000 }),
      fx.run({ id: 'b', status: 'failed', createdAt: NOW - 2 * 86_400_000 }),
      fx.run({ id: 'c', status: 'running', createdAt: NOW - 60_000 }),
    ]
    const s = workflowStats(runs, { now: NOW, days: 7 })
    expect(s.runs).toBe(3)
    expect(s.outcomes).toEqual(['failed', 'succeeded', 'running'])
    expect(s.successRate).toBe(0.5)
    expect(s.perDay.reduce((a, b) => a + b, 0)).toBe(3)
    expect(s.perDay[6]).toBe(2)
  })
})

describe('service', () => {
  it('creates graphs laid out top to bottom, off when asked, and keeps the trigger step in sync', () => {
    const t = TEMPLATES.find((x) => x.id === 'triage-tickets')!.build({ agents: db.all('agents'), connections: db.all('connections') })
    const wf = createWorkflow({ name: t.name, trigger: t.trigger, nodes: t.nodes, edges: t.edges, enabled: false })
    expect(wf.enabled).toBe(false)
    expect(isSidewaysLayout(wf.nodes, wf.edges)).toBe(false)
    expect(new Set(wf.nodes.map((x) => x.id)).size).toBe(t.nodes.length)
    const next = setWorkflowTrigger(wf.id, { type: 'schedule', cron: '0 9 * * 1-5' })!
    expect(next.trigger).toMatchObject({ type: 'schedule', cron: '0 9 * * 1-5', label: 'Weekdays at 09:00' })
    expect(next.nodes.find((x) => x.type === 'trigger')).toMatchObject({ label: 'Weekdays at 09:00', config: { type: 'schedule', cron: '0 9 * * 1-5' } })
  })

  it('coalesces autosaved graph edits into one version per editing session', () => {
    const wf = createWorkflow({ name: 'Edits' })
    const v2 = updateWorkflow(wf.id, { nodes: wf.nodes.map((x) => ({ ...x, label: `${x.label}!` })) }, { coalesce: true })!
    expect(v2.version).toBe(2)
    const again = updateWorkflow(wf.id, { nodes: v2.nodes.map((x) => ({ ...x, label: `${x.label}?` })) }, { coalesce: true })!
    expect(again.version).toBe(2)
    vi.setSystemTime(NOW + 6 * 60_000)
    expect(updateWorkflow(wf.id, { nodes: again.nodes.map((x) => ({ ...x, label: x.label.slice(0, -1) })) }, { coalesce: true })!.version).toBe(3)
  })
})

describe('automatic triggers', () => {
  it('fires on Atrium events (not for knowledge the workflow wrote itself) and on schedules while open', async () => {
    const stop = startWorkflowTriggers({ tickMs: 10_000 })
    try {
      const onDoc = createWorkflow({ name: 'Research when a doc is added', trigger: buildTrigger({ type: 'event', event: 'knowledge.created' }) })
      setWorkflowTrigger(onDoc.id, { type: 'event', event: 'knowledge.created' })
      db.insert('knowledge', fx.knowledge({ id: 'kno_new', title: 'Pricing notes', createdAt: Date.now() }))
      await vi.advanceTimersByTimeAsync(1)
      const fired = db.filter('runs', (r) => r.workflowId === onDoc.id)
      expect(fired).toHaveLength(1)
      expect(fired[0].initiator).toEqual({ type: 'workflow', id: onDoc.id })
      expect(fired[0].steps[0]?.title ?? '').toContain('Pricing notes')
      // Knowledge written by this workflow's own run doesn't trigger it again.
      db.insert('knowledge', fx.knowledge({ id: 'kno_own', title: 'Related reading', createdAt: Date.now(), author: { type: 'workflow', id: onDoc.id } }))
      await vi.advanceTimersByTimeAsync(1)
      expect(db.filter('runs', (r) => r.workflowId === onDoc.id)).toHaveLength(1)

      const hourly = createWorkflow({ name: 'Hourly check', trigger: buildTrigger({ type: 'schedule', cron: '0 * * * *' }) })
      await vi.advanceTimersByTimeAsync(61 * 60_000)
      expect(db.filter('runs', (r) => r.workflowId === hourly.id).length).toBe(1)
    } finally {
      stop()
    }
  })
})
