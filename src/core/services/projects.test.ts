import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { getContext, useContextStore } from '@/core/context'
import { db, emptyTables, useDB } from '@/core/db'
import { link } from './links'
import {
  addMilestone,
  computeProjectStats,
  createProject,
  deleteProject,
  pinToProject,
  removeMilestone,
  setProjectStatus,
  toggleStar,
  unpinFromProject,
  updateMilestone,
  updateProject,
  useProjectItems,
  useProjectStats,
} from './projects'
import { fx } from './testFixtures'

const activityVerbs = () => db.all('activity').map((a) => a.verb)

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
})

describe('project mutations', () => {
  it('creates a project with defaults, a free hue and an activity event', () => {
    db.insert('projects', fx.project({ id: 'prj_old', hue: 'volt' }))
    const p = createProject({ name: '  Lumen Launch  ', goal: 'Ship the add-on' })
    expect(p).toMatchObject({ name: 'Lumen Launch', status: 'active', icon: 'Folder', milestones: [], pinnedRefs: [], repoIds: [], goal: 'Ship the add-on' })
    expect(p.hue).not.toBe('volt')
    expect(db.all('activity')).toEqual([expect.objectContaining({ verb: 'created', target: { kind: 'project', id: p.id }, projectId: p.id })])
  })

  it('updates, renames, changes status and stars with activity for each change', () => {
    const p = createProject({ name: 'Atlas' })
    expect(updateProject(p.id, { name: 'Atlas v2', description: 'Rebuild' })?.name).toBe('Atlas v2')
    expect(updateProject(p.id, { name: 'Atlas v2' })).toBe(db.get('projects', p.id)) // no-op
    setProjectStatus(p.id, 'paused')
    setProjectStatus(p.id, 'active')
    toggleStar(p.id)
    expect(db.get('projects', p.id)).toMatchObject({ status: 'active', starred: true, description: 'Rebuild' })
    expect(activityVerbs()).toEqual(['created', 'renamed', 'paused', 'reactivated', 'starred'])
  })

  it('manages milestones and clears them from tasks when removed', () => {
    const p = createProject({ name: 'Atlas' })
    const m = addMilestone(p.id, { title: 'Beta', dueAt: 123 })!
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: p.id, milestoneId: m.id }))
    expect(updateMilestone(p.id, m.id, { status: 'done' })?.status).toBe('done')
    expect(activityVerbs()).toContain('completed')
    removeMilestone(p.id, m.id)
    expect(db.get('projects', p.id)?.milestones).toEqual([])
    expect(db.get('tasks', 'tsk_1')?.milestoneId).toBeUndefined()
  })

  it('pins and unpins entities to project memory', () => {
    const p = createProject({ name: 'Atlas' })
    db.insert('knowledge', fx.knowledge({ id: 'kno_1' }))
    pinToProject(p.id, { kind: 'knowledge', id: 'kno_1' })
    pinToProject(p.id, { kind: 'knowledge', id: 'kno_1' })
    expect(db.get('projects', p.id)?.pinnedRefs).toEqual([{ kind: 'knowledge', id: 'kno_1' }])
    unpinFromProject(p.id, { kind: 'knowledge', id: 'kno_1' })
    expect(db.get('projects', p.id)?.pinnedRefs).toEqual([])
  })
})

describe('deleteProject', () => {
  beforeEach(() => {
    db.insert('projects', fx.project({ id: 'prj_1' }))
    db.insert('threads', fx.thread({ id: 'thr_1', projectId: 'prj_1' }))
    db.insert('knowledge', fx.knowledge({ id: 'kno_1', projectIds: ['prj_1', 'prj_2'] }))
    db.insert('investigations', fx.investigation({ id: 'inv_1', projectId: 'prj_1' }))
    db.insert('sessions', fx.session({ id: 'ses_1', projectId: 'prj_1' }))
    db.insert('assets', fx.asset({ id: 'ast_1', projectId: 'prj_1' }))
    db.insert('workflows', fx.workflow({ id: 'wfl_1', projectId: 'prj_1' }))
    db.insert('runs', fx.run({ id: 'run_1', projectId: 'prj_1' }))
    db.insert('agents', fx.agent({ id: 'agt_1', knowledgeScope: { all: false, collectionIds: [], projectIds: ['prj_1'] } }))
    db.insert('tasks', fx.task({ id: 'tsk_1', projectId: 'prj_1', milestoneId: 'mst_1' }))
    link({ kind: 'task', id: 'tsk_1' }, { kind: 'project', id: 'prj_1' }, 'part_of')
    getContext().setScope('prj_1')
    getContext().pin({ kind: 'project', id: 'prj_1' })
  })

  it('detaches everything, orphans tasks and clears the scope', () => {
    deleteProject('prj_1')
    expect(db.get('projects', 'prj_1')).toBeUndefined()
    expect(db.get('threads', 'thr_1')?.projectId).toBeNull()
    expect(db.get('knowledge', 'kno_1')?.projectIds).toEqual(['prj_2'])
    for (const [table, id] of [['investigations', 'inv_1'], ['sessions', 'ses_1'], ['assets', 'ast_1'], ['workflows', 'wfl_1'], ['runs', 'run_1']] as const) {
      expect(db.get(table, id)?.projectId, table).toBeNull()
    }
    expect(db.get('agents', 'agt_1')?.knowledgeScope.projectIds).toEqual([])
    expect(db.get('tasks', 'tsk_1')).toMatchObject({ projectId: null, milestoneId: undefined })
    expect(db.all('links')).toEqual([])
    expect(getContext().scopeProjectId).toBeNull()
    expect(getContext().pinned).toEqual([])
    expect(db.all('activity').at(-1)).toMatchObject({ verb: 'deleted', target: { kind: 'project', id: 'prj_1' } })
  })

  it('deletes tasks when asked', () => {
    deleteProject('prj_1', { deleteTasks: true })
    expect(db.get('tasks', 'tsk_1')).toBeUndefined()
    expect(db.all('activity').at(-1)?.summary).toContain('1 task')
  })
})

describe('project stats', () => {
  const NOW = 1_800_000_000_000

  beforeEach(() => {
    db.insert('projects', fx.project({ id: 'prj_1', updatedAt: 5 }))
    db.insertMany('tasks', [
      fx.task({ id: 't1', status: 'done' }),
      fx.task({ id: 't2', status: 'in_progress', dueAt: NOW - 1000 }),
      fx.task({ id: 't3', status: 'review' }),
      fx.task({ id: 't4', status: 'todo', dueAt: NOW + 1000 }),
      fx.task({ id: 't5', status: 'cancelled', dueAt: NOW - 1000 }),
      fx.task({ id: 't6', status: 'todo', projectId: 'prj_other' }),
    ])
    db.insertMany('runs', [
      fx.run({ id: 'r1', projectId: 'prj_1', status: 'running' }),
      fx.run({ id: 'r2', projectId: 'prj_1', status: 'waiting' }),
      fx.run({ id: 'r3', projectId: 'prj_1', status: 'failed' }),
    ])
    db.insert('threads', fx.thread({ id: 'th1', projectId: 'prj_1' }))
    db.insert('knowledge', fx.knowledge({ id: 'k1', projectIds: ['prj_1'] }))
    db.insert('activity', { id: 'act_1', at: 999, actor: { type: 'system', id: 'system' }, verb: 'x', target: { kind: 'project', id: 'prj_1' }, summary: '', projectId: 'prj_1' })
  })

  it('computes counts, overdue and progress', () => {
    const stats = computeProjectStats(useDB.getState(), 'prj_1', NOW)
    expect(stats.tasks).toEqual({ total: 4, done: 1, inProgress: 1, review: 1, overdue: 1 })
    expect(stats).toMatchObject({ activeRuns: 2, threads: 1, knowledge: 1, sessions: 0, lastActivityAt: 999, progress: 0.25 })
  })

  it('useProjectStats updates when tasks change', () => {
    const { result } = renderHook(() => useProjectStats('prj_1'))
    expect(result.current.tasks.done).toBe(1)
    const before = result.current
    act(() => db.insert('notifications', { id: 'n1', kind: 'system', title: 'x', tone: 'neutral', createdAt: 1 }))
    expect(result.current).toBe(before)
    act(() => {
      db.update('tasks', 't4', { status: 'done' })
    })
    expect(result.current.tasks.done).toBe(2)
    expect(result.current.progress).toBe(0.5)
  })

  it('useProjectItems lists the project’s things, most recent first', () => {
    db.insert('threads', fx.thread({ id: 'th2', projectId: 'prj_1', updatedAt: 10 }))
    const { result } = renderHook(() => useProjectItems('prj_1'))
    expect(result.current.threads.map((t) => t.id)).toEqual(['th1', 'th2'])
    expect(result.current.runs).toHaveLength(3)
    expect(result.current.knowledge.map((k) => k.id)).toEqual(['k1'])
  })
})
