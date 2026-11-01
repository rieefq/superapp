import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import type { EntityKind, EntityRef } from '@/core/types'
import { entityRoute, KIND_META, resolveEntity, useEntity } from './entities'
import { fx } from './testFixtures'

const ALL_KINDS: EntityKind[] = [
  'project', 'task', 'thread', 'message', 'run', 'approval', 'agent', 'workflow', 'knowledge', 'collection',
  'investigation', 'source', 'repo', 'session', 'asset', 'board', 'integration',
]

beforeEach(() => db.replaceAll(emptyTables()))

describe('KIND_META', () => {
  it('describes every entity kind', () => {
    for (const kind of ALL_KINDS) {
      expect(KIND_META[kind].label).toBeTruthy()
      expect(KIND_META[kind].plural).toBeTruthy()
      expect(KIND_META[kind].icon).toMatch(/^[A-Z][A-Za-z0-9]+$/)
      expect(KIND_META[kind].workspace).toBeTruthy()
    }
  })
})

describe('entityRoute', () => {
  beforeEach(() => {
    db.insert('projects', fx.project({ id: 'prj_1' }))
    db.insert('threads', fx.thread({ id: 'thr_1' }))
    db.insert('messages', fx.message({ id: 'msg_1', threadId: 'thr_1' }))
    db.insert('agents', fx.agent({ id: 'agt_1' }))
    db.insert('workflows', fx.workflow({ id: 'wfl_1' }))
    db.insert('knowledge', fx.knowledge({ id: 'kno_1' }))
    db.insert('collections', fx.collection({ id: 'col_1' }))
    db.insert('investigations', fx.investigation({ id: 'inv_1', runIds: ['run_res'] }))
    db.insert('repos', fx.repo({ id: 'rep_1' }))
    db.insert('sessions', fx.session({ id: 'ses_1', turns: [{ id: 'trn_1', prompt: 'Fix it', runId: 'run_code', createdAt: 1 }] }))
    db.insert('assets', fx.asset({ id: 'ast_1', runId: 'run_studio' }))
    db.insert('boards', fx.board({ id: 'brd_1' }))
  })

  it('routes simple kinds', () => {
    const cases: Array<[EntityRef, string]> = [
      [{ kind: 'project', id: 'prj_1' }, '/projects/prj_1'],
      [{ kind: 'thread', id: 'thr_1' }, '/chat/thr_1'],
      [{ kind: 'message', id: 'msg_1' }, '/chat/thr_1?m=msg_1'],
      [{ kind: 'agent', id: 'agt_1' }, '/agents/agt_1'],
      [{ kind: 'workflow', id: 'wfl_1' }, '/workflows/wfl_1'],
      [{ kind: 'knowledge', id: 'kno_1' }, '/knowledge/kno_1'],
      [{ kind: 'collection', id: 'col_1' }, '/knowledge?collection=col_1'],
      [{ kind: 'investigation', id: 'inv_1' }, '/research/inv_1'],
      [{ kind: 'repo', id: 'rep_1' }, '/code/repos/rep_1'],
      [{ kind: 'session', id: 'ses_1' }, '/code/ses_1'],
      [{ kind: 'asset', id: 'ast_1' }, '/studio/ast_1'],
      [{ kind: 'board', id: 'brd_1' }, '/studio?board=brd_1'],
      [{ kind: 'integration', id: 'github' }, '/integrations/github'],
    ]
    for (const [ref, route] of cases) expect(entityRoute(ref), ref.kind).toBe(route)
  })

  it('routes tasks to their project, or to My tasks', () => {
    db.insert('tasks', fx.task({ id: 'tsk_a', projectId: 'prj_1' }))
    db.insert('tasks', fx.task({ id: 'tsk_b', projectId: null }))
    expect(entityRoute({ kind: 'task', id: 'tsk_a' })).toBe('/projects/prj_1?task=tsk_a')
    expect(entityRoute({ kind: 'task', id: 'tsk_b' })).toBe('/projects/my-tasks?task=tsk_b')
  })

  it('routes sources to their investigation, or to the knowledge item they were saved as', () => {
    db.insert('sources', fx.source({ id: 'src_a', investigationId: 'inv_1' }))
    db.insert('sources', fx.source({ id: 'src_b', investigationId: null, knowledgeId: 'kno_1' }))
    expect(entityRoute({ kind: 'source', id: 'src_a' })).toBe('/research/inv_1?source=src_a')
    expect(entityRoute({ kind: 'source', id: 'src_b' })).toBe('/knowledge/kno_1')
  })

  it('routes runs by kind', () => {
    db.insertMany('runs', [
      fx.run({ id: 'run_code', kind: 'code' }),
      fx.run({ id: 'run_res', kind: 'research' }),
      fx.run({ id: 'run_res_origin', kind: 'research', origin: { kind: 'investigation', id: 'inv_1' } }),
      fx.run({ id: 'run_wf', kind: 'workflow', workflowId: 'wfl_1' }),
      fx.run({ id: 'run_studio', kind: 'studio' }),
      fx.run({ id: 'run_agent', kind: 'agent', agentId: 'agt_1' }),
      fx.run({ id: 'run_chat', kind: 'chat' }),
      fx.run({ id: 'run_orphan', kind: 'agent' }),
    ])
    db.insert('messages', fx.message({ id: 'msg_2', threadId: 'thr_1', runId: 'run_chat' }))
    expect(entityRoute({ kind: 'run', id: 'run_code' })).toBe('/code/ses_1?run=run_code')
    expect(entityRoute({ kind: 'run', id: 'run_res' })).toBe('/research/inv_1')
    expect(entityRoute({ kind: 'run', id: 'run_res_origin' })).toBe('/research/inv_1')
    expect(entityRoute({ kind: 'run', id: 'run_wf' })).toBe('/workflows/wfl_1?run=run_wf')
    expect(entityRoute({ kind: 'run', id: 'run_studio' })).toBe('/studio/ast_1')
    expect(entityRoute({ kind: 'run', id: 'run_agent' })).toBe('/agents/agt_1?run=run_agent')
    expect(entityRoute({ kind: 'run', id: 'run_chat' })).toBe('/chat/thr_1?m=msg_2')
    expect(entityRoute({ kind: 'run', id: 'run_orphan' })).toBe('/agents/runs/run_orphan')
  })

  it('routes approvals to their run', () => {
    db.insert('runs', fx.run({ id: 'run_agent', kind: 'agent', agentId: 'agt_1' }))
    db.insert('approvals', fx.approval({ id: 'apv_1', runId: 'run_agent' }))
    expect(entityRoute({ kind: 'approval', id: 'apv_1' })).toBe('/agents/agt_1?run=run_agent')
  })

  it('sends missing entities home', () => {
    for (const kind of ALL_KINDS) expect(entityRoute({ kind, id: 'nope' }), kind).toBe('/')
  })
})

describe('resolveEntity', () => {
  it('resolves missing rows as deleted items', () => {
    const r = resolveEntity({ kind: 'task', id: 'gone' })
    expect(r).toMatchObject({ exists: false, title: 'Deleted item', route: '/', icon: KIND_META.task.icon })
  })

  it('titles messages with the first 60 characters of their content', () => {
    db.insert('threads', fx.thread({ id: 'thr_1', projectId: 'prj_9' }))
    db.insert('messages', fx.message({ id: 'msg_1', content: `## Plan\n\n**Bold** ${'word '.repeat(30)}`, simulated: true }))
    const r = resolveEntity({ kind: 'message', id: 'msg_1' })
    expect(r.title.length).toBeLessThanOrEqual(60)
    expect(r.title.startsWith('Plan Bold word')).toBe(true)
    expect(r).toMatchObject({ exists: true, projectId: 'prj_9', simulated: true, route: '/chat/thr_1?m=msg_1' })
  })

  it('uses catalog names for integrations and reports connection status', () => {
    expect(resolveEntity({ kind: 'integration', id: 'slack' })).toMatchObject({ title: 'Slack', status: 'available', simulated: true, exists: true })
    db.insert('connections', { id: 'github', status: 'connected', mode: 'live', account: 'Public access', scopes: [], config: {}, usageCount: 0 })
    expect(resolveEntity({ kind: 'integration', id: 'github' })).toMatchObject({ title: 'GitHub', subtitle: 'Public access', status: 'connected', simulated: false })
  })

  it('carries project, hue and status for tasks and runs', () => {
    db.insert('projects', fx.project({ id: 'prj_1', hue: 'amber', name: 'Lumen' }))
    db.insert('tasks', fx.task({ id: 'tsk_1', status: 'review' }))
    db.insert('agents', fx.agent({ id: 'agt_1', hue: 'rose' }))
    db.insert('runs', fx.run({ id: 'run_1', agentId: 'agt_1', projectId: 'prj_1', status: 'running' }))
    expect(resolveEntity({ kind: 'task', id: 'tsk_1' })).toMatchObject({ subtitle: 'Lumen', hue: 'amber', status: 'review', projectId: 'prj_1' })
    expect(resolveEntity({ kind: 'run', id: 'run_1' })).toMatchObject({ subtitle: 'Agent run · Scout', hue: 'rose', status: 'running', simulated: true })
  })
})

describe('useEntity', () => {
  it('re-renders when the entity changes and stays referentially stable otherwise', () => {
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: null }))
    const { result } = renderHook(() => useEntity({ kind: 'task', id: 'tsk_1' }))
    const first = result.current
    expect(first.title).toBe('Fix login redirect')

    act(() => db.insert('knowledge', fx.knowledge({ id: 'kno_other' })))
    expect(result.current).toBe(first)

    act(() => {
      db.update('tasks', 'tsk_1', { title: 'Fix SSO redirect' })
    })
    expect(result.current.title).toBe('Fix SSO redirect')

    act(() => db.remove('tasks', 'tsk_1'))
    expect(result.current.exists).toBe(false)
  })
})
