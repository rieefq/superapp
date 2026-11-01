import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { __resetEngineForTests, runEngine } from '@/core/runs/engine'
import { planWorkflow, registerWorkflowFactories } from '@/core/runs/factories/workflow'
import { useSettingsStore } from '@/core/settings'
import { HUES, isRunActive, type IntegrationConnection, type Run, type Workflow, type WorkflowEdge, type WorkflowNode } from '@/core/types'
import { createRng } from '@/lib/rng'
import { fx } from './testFixtures'
import { createWorkflow, duplicateWorkflow, runWorkflow, setWorkflowEnabled, updateWorkflow, validateWorkflow } from './workflows'

const NOW = new Date('2026-11-01T10:00:00Z').getTime()

registerWorkflowFactories()

const connected = (id: string): IntegrationConnection => ({ id, status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, connectedAt: NOW })
const node = (id: string, type: WorkflowNode['type'], extra: Partial<WorkflowNode> = {}): WorkflowNode => ({ id, type, label: id, position: { x: 0, y: 0 }, config: {}, ...extra })
const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id: `${source}-${target}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

/** Support triage: email → Sentinel classifies → urgent? → Slack alert : Linear-style task. */
function triage(branch?: 'true' | 'false'): Workflow {
  return fx.workflow({
    id: 'wfl_triage',
    name: 'Support triage',
    trigger: { type: 'event', label: 'New support email', event: 'gmail.message.received', integrationId: 'gmail' },
    nodes: [
      node('t', 'trigger', { label: 'New support email', integrationId: 'gmail', config: { event: 'gmail.message.received' } }),
      node('a', 'agent', { label: 'Classify the request', agentId: 'agt_sentinel', config: { prompt: 'Triage and classify the email by urgency' } }),
      node('c', 'condition', { label: 'Is it urgent?', config: { expression: "priority == 'urgent'", ...(branch ? { branch } : {}) } }),
      node('s', 'action', { label: 'Alert #support-urgent', integrationId: 'slack', capability: 'messages.send', config: { channel: '#support-urgent' } }),
      node('o', 'output', { label: 'Create follow-up task', config: { kind: 'task' } }),
    ],
    edges: [edge('t', 'a'), edge('a', 'c'), edge('c', 's', 'true'), edge('c', 'o', 'false')],
  })
}

async function drive(): Promise<void> {
  for (let round = 0; round < 40; round++) {
    await vi.advanceTimersByTimeAsync(30_000)
    const pending = db.filter('approvals', (a) => a.status === 'pending')
    for (const a of pending) runEngine.resolveApproval(a.id, 'approved')
    if (!pending.length && !db.all('runs').some((r) => isRunActive(r.status))) return
  }
}

const runOf = (id: string): Run => db.get('runs', id)!

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
  db.insert('agents', fx.agent({ id: 'agt_sentinel', name: 'Sentinel', role: 'Support triage' }))
  for (const id of ['gmail', 'slack']) db.insert('connections', connected(id))
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('workflow CRUD', () => {
  it('creates a trigger → output workflow and versions graph edits only', () => {
    const wf = createWorkflow({ name: 'Weekly digest', trigger: { type: 'schedule', label: 'Mondays at 09:00', cron: '0 9 * * 1' } })
    expect(wf.nodes.map((n) => n.type)).toEqual(['trigger', 'output'])
    expect(wf.edges).toEqual([expect.objectContaining({ source: wf.nodes[0].id, target: wf.nodes[1].id })])
    expect(wf.nodes[0].config).toMatchObject({ type: 'schedule', cron: '0 9 * * 1' })
    expect(HUES).toContain(wf.hue)
    expect(wf).toMatchObject({ version: 1, enabled: true })
    expect(validateWorkflow(wf)).toEqual([])

    expect(updateWorkflow(wf.id, { name: 'Weekly project digest' })?.version).toBe(1)
    const moved = updateWorkflow(wf.id, { nodes: wf.nodes.map((n) => ({ ...n, position: { x: n.position.x + 10, y: n.position.y } })) })
    expect(moved?.version).toBe(2)
    expect(updateWorkflow(wf.id, { edges: moved!.edges })?.version).toBe(2)

    const copy = duplicateWorkflow(wf.id)!
    expect(copy).toMatchObject({ name: 'Weekly project digest (copy)', enabled: false, version: 1 })
    expect(copy.id).not.toBe(wf.id)
    expect(setWorkflowEnabled(wf.id, false)?.enabled).toBe(false)
  })
})

describe('validateWorkflow', () => {
  it('reports missing triggers, loops, unreachable steps and incomplete conditions', () => {
    const noTrigger = validateWorkflow({ nodes: [node('o', 'output')], edges: [] })
    expect(noTrigger).toContainEqual({ severity: 'error', message: 'Add a trigger so the workflow knows when to start.' })

    const loop = validateWorkflow({ nodes: [node('t', 'trigger'), node('x', 'transform'), node('y', 'transform')], edges: [edge('t', 'x'), edge('x', 'y'), edge('y', 'x')] })
    expect(loop.find((i) => i.message.includes('loop'))).toMatchObject({ severity: 'error', nodeId: 'x' })

    const unreachable = validateWorkflow({ nodes: [node('t', 'trigger'), node('o', 'output'), node('lost', 'output')], edges: [edge('t', 'o')] })
    expect(unreachable).toEqual([{ nodeId: 'lost', severity: 'warning', message: '“lost” is not connected to the trigger, so it never runs.' }])

    const noBranches = validateWorkflow({ nodes: [node('t', 'trigger'), node('c', 'condition')], edges: [edge('t', 'c')] })
    expect(noBranches).toContainEqual({ nodeId: 'c', severity: 'error', message: '“c” needs a “true” and a “false” branch.' })
    const oneBranch = validateWorkflow({ nodes: [node('t', 'trigger'), node('c', 'condition'), node('o', 'output')], edges: [edge('t', 'c'), edge('c', 'o', 'true')] })
    expect(oneBranch).toContainEqual({ nodeId: 'c', severity: 'warning', message: '“c” has no “false” branch; runs that take it stop there.' })
  })

  it('checks agents and integrations', () => {
    expect(validateWorkflow(triage())).toEqual([])
    db.remove('connections', 'slack')
    db.insert('agents', fx.agent({ id: 'agt_paused', name: 'Archivist', status: 'paused' }))
    const issues = validateWorkflow({
      nodes: [
        node('t', 'trigger'),
        node('a1', 'agent'),
        node('a2', 'agent', { agentId: 'agt_paused' }),
        node('s', 'action', { label: 'Post', integrationId: 'slack', capability: 'messages.send' }),
      ],
      edges: [edge('t', 'a1'), edge('a1', 'a2'), edge('a2', 's')],
    })
    expect(issues).toEqual(
      expect.arrayContaining([
        { nodeId: 'a1', severity: 'error', message: 'Choose an agent for “a1”.' },
        { nodeId: 'a2', severity: 'warning', message: 'Archivist is paused; resume it before relying on this workflow.' },
        { nodeId: 's', severity: 'error', message: 'Connect Slack in Integrations to run “Post”.' },
      ]),
    )
  })
})

describe('workflow.execute', () => {
  it('walks the graph in order and follows only the matching branch', () => {
    db.insert('workflows', triage('false'))
    const plan = planWorkflow({ workflowId: 'wfl_triage' }, createRng(1))
    expect(plan.steps.map((s) => s.nodeId)).toEqual(['t', 'a', 'a', 'c', 'o'])
    expect(plan.steps.map((s) => s.kind)).toEqual(['tool', 'think', 'message', 'think', 'artifact'])
    expect(plan.steps[0].output).toContain('.example')
    expect(plan.steps[2].output).toMatch(/^I classified this as \*\*/)
    expect(plan.steps[3].detail).toBe('Branch: false — branch fixed in the step settings')
  })

  it('evaluates conditions from the agent output when not forced', () => {
    db.insert('workflows', triage())
    for (let seed = 0; seed < 12; seed++) {
      const plan = planWorkflow({ workflowId: 'wfl_triage' }, createRng(seed))
      const urgent = /\*\*urgent\*\* priority/.test(plan.steps[2].output ?? '')
      expect(plan.steps[3].detail).toMatch(urgent ? /^Branch: true — priority is urgent/ : /^Branch: false — priority is (high|normal|low)/)
      expect(plan.steps[4].nodeId).toBe(urgent ? 's' : 'o')
    }
  })

  it('gates risky actions behind approval and runs them', async () => {
    db.insert('workflows', triage('true'))
    const run = runWorkflow('wfl_triage')
    expect(run).toMatchObject({ kind: 'workflow', workflowId: 'wfl_triage', agentId: 'agt_sentinel', origin: { kind: 'workflow', id: 'wfl_triage' } })
    expect(db.get('workflows', 'wfl_triage')?.lastRunAt).toBe(NOW)
    await vi.advanceTimersByTimeAsync(30_000)
    const approval = db.find('approvals', (a) => a.runId === run.id)
    expect(approval).toMatchObject({ capability: 'messages.send', risk: 'high', preview: { kind: 'message', label: '#support-urgent' } })
    await drive()
    const done = runOf(run.id)
    expect(done.status).toBe('succeeded')
    expect(done.steps.find((s) => s.nodeId === 's')?.output).toContain('nothing was sent')
  })

  it('creates a real task at a task output, with the run as origin (idempotently)', async () => {
    db.insert('workflows', triage('false'))
    const run = runWorkflow('wfl_triage')
    await drive()
    const tasks = db.filter('tasks', (t) => t.origin?.kind === 'run' && t.origin.id === run.id)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].labels).toEqual(['workflow'])
    expect(runOf(run.id).outputs).toContainEqual({ kind: 'task', id: tasks[0].id })
    expect(runOf(run.id).steps.find((s) => s.nodeId === 'o')?.output).toMatch(/^Created task “/)
  })

  it('saves a simulated knowledge note and runs disabled workflows manually', async () => {
    const wf = createWorkflow({ name: 'Competitor radar' })
    const agentNode = node('scan', 'agent', { label: 'Scan the market', agentId: 'agt_sentinel', config: { prompt: 'Monitor competitor news for freight portals' } })
    const output = { ...wf.nodes[1], config: { kind: 'knowledge', title: 'Radar notes' } }
    updateWorkflow(wf.id, { nodes: [wf.nodes[0], agentNode, output], edges: [edge(wf.nodes[0].id, 'scan'), edge('scan', output.id)] })
    setWorkflowEnabled(wf.id, false)
    const run = runWorkflow(wf.id, { trigger: 'Weekly check' })
    await drive()
    const note = db.find('knowledge', (k) => k.source.ref?.id === run.id)
    expect(note).toMatchObject({ title: 'Radar notes', kind: 'note', simulated: true, source: { type: 'agent', ref: { kind: 'run', id: run.id } } })
    expect(note?.content).toContain('.example')
    expect(runOf(run.id).steps[0]).toMatchObject({ detail: 'Weekly check' })
  })

  it('fails low-risk actions on disconnected integrations and plans for missing workflows', () => {
    db.insert('workflows', fx.workflow({ id: 'wfl_x', nodes: [node('t', 'trigger'), node('l', 'action', { integrationId: 'linear', capability: 'tasks.manage' })], edges: [edge('t', 'l')] }))
    const plan = planWorkflow({ workflowId: 'wfl_x' }, createRng(1))
    expect(plan.steps[1]).toMatchObject({ failChance: 1, failMessage: 'Linear is not connected. Connect it in Integrations and run again.' })
    expect(planWorkflow({ workflowId: 'nope' }, createRng(1)).steps[0].failMessage).toBe('This workflow no longer exists.')
  })
})
