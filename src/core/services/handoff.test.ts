import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getContext, useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { runEngine } from '@/core/runs'
import type { EntityRef } from '@/core/types'
import {
  describeSource,
  toAgent,
  toCodeSession,
  toInvestigation,
  toKnowledge,
  toStudio,
  toTask,
  toWorkflowRun,
} from './handoff'
import { fakeStart, fx } from './testFixtures'

const stubs = vi.hoisted(() => ({
  createInvestigation: vi.fn(),
  createSession: vi.fn(),
  generateAsset: vi.fn(),
  runWorkflow: vi.fn(),
}))
vi.mock('./research', () => ({ createInvestigation: stubs.createInvestigation }))
vi.mock('./code', () => ({ createSession: stubs.createSession }))
vi.mock('./studio', () => ({ generateAsset: stubs.generateAsset }))
vi.mock('./workflows', () => ({ runWorkflow: stubs.runWorkflow }))

const MESSAGE: EntityRef = { kind: 'message', id: 'msg_1' }

const linkedFrom = (target: EntityRef, source: EntityRef) =>
  db.all('links').some(
    (l) => l.rel === 'derived_from' && l.from.kind === target.kind && l.from.id === target.id && l.to.kind === source.kind && l.to.id === source.id,
  )

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  db.insert('projects', fx.project({ id: 'prj_1' }))
  db.insert('threads', fx.thread({ id: 'thr_1', projectId: 'prj_1', messageIds: ['msg_0', 'msg_1'] }))
  db.insert('messages', fx.message({ id: 'msg_0', role: 'user', content: 'Why do sessions expire after SSO?' }))
  db.insert('messages', fx.message({ id: 'msg_1', content: '## Likely cause\n\nThe **refresh token** is dropped after the SSO redirect.', simulated: true }))
  db.insert('agents', fx.agent({ id: 'agt_1', name: 'Forge' }))

  stubs.createInvestigation.mockImplementation((input: { question: string; projectId?: string | null }) =>
    db.insert('investigations', fx.investigation({ id: 'inv_new', title: 'SSO session research', question: input.question, projectId: input.projectId ?? null })),
  )
  stubs.createSession.mockImplementation((input: { repoId: string; projectId?: string | null }) =>
    db.insert('sessions', fx.session({ id: 'ses_new', repoId: input.repoId, title: 'Fix refresh token', projectId: input.projectId ?? null })),
  )
  stubs.generateAsset.mockImplementation((input: { prompt: string }) => db.insert('assets', fx.asset({ id: 'ast_new', title: 'SSO diagram', prompt: input.prompt })))
  stubs.runWorkflow.mockImplementation((workflowId: string) =>
    db.insert('runs', fx.run({ id: 'run_wf', kind: 'workflow', workflowId, title: 'Support triage', projectId: null })),
  )
})

describe('toTask', () => {
  it('creates a linked task in the source’s project and records it on the message', () => {
    const res = toTask(MESSAGE, { title: 'Keep refresh token across SSO redirect' })
    const task = db.get('tasks', res.ref.id)!
    expect(task).toMatchObject({ projectId: 'prj_1', origin: MESSAGE })
    expect(res.route).toBe(`/projects/prj_1?task=${task.id}`)
    expect(linkedFrom(res.ref, MESSAGE)).toBe(true)
    expect(db.get('messages', 'msg_1')?.derived).toEqual([res.ref])
    expect(db.all('activity')).toEqual([expect.objectContaining({ verb: 'created', summary: expect.stringContaining('from message') })])
  })

  it('respects an explicit “no project” and falls back to the active scope', () => {
    expect(toTask(MESSAGE, { title: 'Loose', projectId: null }).route).toMatch(/^\/projects\/my-tasks\?task=/)
    getContext().setScope('prj_1')
    const res = toTask({ kind: 'agent', id: 'agt_1' }, { title: 'From agent page' })
    expect(db.get('tasks', res.ref.id)?.projectId).toBe('prj_1')
  })
})

describe('toKnowledge', () => {
  it('derives content from a simulated message and keeps it labeled', () => {
    const res = toKnowledge(MESSAGE)
    const item = db.get('knowledge', res.ref.id)!
    expect(item).toMatchObject({ title: 'Likely cause', kind: 'note', simulated: true, projectIds: ['prj_1'], source: { type: 'chat', ref: MESSAGE } })
    expect(item.content.startsWith('> Saved from a simulated assistant reply')).toBe(true)
    expect(item.content).toContain('The **refresh token** is dropped')
    expect(res.route).toBe(`/knowledge/${item.id}`)
    expect(linkedFrom(res.ref, MESSAGE)).toBe(true)
    expect(db.get('messages', 'msg_1')?.derived).toEqual([res.ref])
    expect(db.all('activity')[0]).toMatchObject({ verb: 'saved', summary: expect.stringContaining('to Knowledge from message') })
  })

  it('uses explicit content but still flags simulated provenance', () => {
    const item = db.get('knowledge', toKnowledge(MESSAGE, { title: 'Mine', content: 'My own words', kind: 'doc' }).ref.id)!
    expect(item).toMatchObject({ title: 'Mine', content: 'My own words', kind: 'doc', simulated: true })
  })

  it('saves investigation reports and records the back-reference', () => {
    db.insert('runs', fx.run({ id: 'run_r', kind: 'research', simulated: true }))
    db.insert('investigations', fx.investigation({ id: 'inv_1', report: '# Tidewell\n\nPositioning summary.', runIds: ['run_r'], projectId: 'prj_1' }))
    const ref = toKnowledge({ kind: 'investigation', id: 'inv_1' }).ref
    const item = db.get('knowledge', ref.id)!
    expect(item).toMatchObject({ kind: 'report', source: { type: 'research' }, simulated: true })
    expect(item.content).toContain('Positioning summary.')
    expect(item.content).toContain('From simulated research')
    expect(db.get('investigations', 'inv_1')?.knowledgeId).toBe(ref.id)
  })

  it('summarizes runs with their steps', () => {
    db.insert('runs', fx.run({
      id: 'run_1', kind: 'code', title: 'Fix SSO', summary: 'Patched the redirect handler.',
      steps: [{ id: 's1', kind: 'edit', title: 'Edit session.ts', status: 'done', output: 'changed 3 lines' }],
    }))
    const item = db.get('knowledge', toKnowledge({ kind: 'run', id: 'run_1' }).ref.id)!
    expect(item.source.type).toBe('code')
    expect(item.content).toContain('Patched the redirect handler.')
    expect(item.content).toContain('1. ✓ Edit session.ts')
  })
})

describe('handoffs to other workspaces', () => {
  it('toInvestigation creates, links and logs the handoff', () => {
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: 'prj_1' }))
    const source: EntityRef = { kind: 'task', id: 'tsk_1' }
    const res = toInvestigation(source, { question: 'Why do SSO sessions expire?', depth: 'deep' })
    expect(stubs.createInvestigation).toHaveBeenCalledWith(expect.objectContaining({ question: 'Why do SSO sessions expire?', depth: 'deep', projectId: 'prj_1', origin: source }))
    expect(res).toEqual({ ref: { kind: 'investigation', id: 'inv_new' }, route: '/research/inv_new' })
    expect(linkedFrom(res.ref, source)).toBe(true)
    expect(db.all('activity').at(-1)).toMatchObject({ verb: 'handed_off', summary: 'Started research “SSO session research” from task “Fix login redirect”' })
  })

  it('toAgent starts a run that works on a task source', () => {
    const start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: 'prj_1' }))
    const res = toAgent({ kind: 'task', id: 'tsk_1' }, { agentId: 'agt_1', instruction: 'Investigate the flaky test' })
    expect(start.mock.calls[0][0].params).toMatchObject({ taskId: 'tsk_1', projectId: 'prj_1' })
    expect(res.route).toBe(`/agents/agt_1?run=${res.ref.id}`)
    expect(db.get('tasks', 'tsk_1')?.runIds).toEqual([res.ref.id])
    expect(linkedFrom(res.ref, { kind: 'task', id: 'tsk_1' })).toBe(true)
    expect(db.all('activity').at(-1)).toMatchObject({ verb: 'handed_off', summary: 'Asked Forge to “Investigate the flaky test” from task “Fix login redirect”' })
  })

  it('toAgent from a message records the run on the message', () => {
    vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
    const res = toAgent(MESSAGE, { agentId: 'agt_1', instruction: 'Draft the fix' })
    expect(db.get('messages', 'msg_1')?.derived).toEqual([res.ref])
  })

  it('toCodeSession, toStudio and toWorkflowRun create linked targets', () => {
    db.insert('workflows', fx.workflow({ id: 'wfl_1', name: 'Support triage' }))
    const session = toCodeSession(MESSAGE, { repoId: 'rep_1', prompt: 'Keep the refresh token' })
    const asset = toStudio(MESSAGE, { kind: 'image', prompt: 'Diagram of the SSO flow' })
    const wf = toWorkflowRun(MESSAGE, { workflowId: 'wfl_1' })
    expect(stubs.createSession).toHaveBeenCalledWith(expect.objectContaining({ repoId: 'rep_1', prompt: 'Keep the refresh token', projectId: 'prj_1', origin: MESSAGE }))
    expect(stubs.generateAsset).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', origin: MESSAGE }))
    expect(stubs.runWorkflow).toHaveBeenCalledWith('wfl_1', { trigger: 'manual', origin: MESSAGE })
    expect([session.route, asset.route, wf.route]).toEqual(['/code/ses_new', '/studio/ast_new', '/workflows/wfl_1?run=run_wf'])
    for (const res of [session, asset, wf]) expect(linkedFrom(res.ref, MESSAGE), res.ref.kind).toBe(true)
    expect(db.get('messages', 'msg_1')?.derived).toEqual([session.ref, asset.ref, wf.ref])
    expect(db.all('activity').map((e) => e.verb)).toEqual(['handed_off', 'handed_off', 'handed_off'])
  })
})

it('refuses to hand off from a deleted source', () => {
  expect(() => toTask({ kind: 'message', id: 'msg_gone' }, { title: 'x' })).toThrow('no longer exists')
  expect(() => toKnowledge({ kind: 'run', id: 'run_gone' })).toThrow('no longer exists')
  expect(db.all('tasks')).toEqual([])
})

describe('describeSource', () => {
  it('returns plain text for dialogs', () => {
    expect(describeSource(MESSAGE)).toEqual({ title: 'Likely cause', text: 'Likely cause\n\nThe refresh token is dropped after the SSO redirect.' })
    db.insert('tasks', fx.task({ id: 'tsk_1', description: 'Repro with **Okta**', subtasks: [{ id: 's', title: 'Write test', done: true }] }))
    expect(describeSource({ kind: 'task', id: 'tsk_1' }).text).toBe('Repro with Okta\n\n- [x] Write test\n\nStatus: To do')
    expect(describeSource({ kind: 'thread', id: 'thr_1' }).text).toContain('You: Why do sessions expire after SSO?')
    expect(describeSource({ kind: 'knowledge', id: 'gone' })).toEqual({ title: 'Deleted item', text: '' })
  })
})
