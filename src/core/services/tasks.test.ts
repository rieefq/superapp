import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables } from '@/core/db'
import { runEngine, type RunEngine } from '@/core/runs'
import { ME, type Task } from '@/core/types'
import {
  addSubtask,
  assignTask,
  createTask,
  deleteTask,
  moveTask,
  removeSubtask,
  toggleSubtask,
  updateTask,
  useMyTasks,
  useTasks,
} from './tasks'
import { fakeStart, fx } from './testFixtures'

let start: MockInstance<RunEngine['start']>

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
  db.insert('projects', fx.project({ id: 'prj_1' }))
  db.insert('agents', fx.agent({ id: 'agt_1', name: 'Forge' }))
})

const order = (status: Task['status'], projectId: string | null = 'prj_1') =>
  db
    .filter('tasks', (t) => t.status === status && t.projectId === projectId)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.title)

describe('createTask', () => {
  it('applies defaults and appends to the bottom of its column', () => {
    const a = createTask({ title: 'First', projectId: 'prj_1' })
    const b = createTask({ title: 'Second', projectId: 'prj_1' })
    const c = createTask({ title: 'Elsewhere', projectId: 'prj_1', status: 'review' })
    expect(a).toMatchObject({ status: 'todo', priority: 'none', labels: [], subtasks: [], runIds: [], assignee: null, order: 0 })
    expect(b.order).toBe(1)
    expect(c.order).toBe(0)
    expect(db.all('activity').filter((e) => e.verb === 'created')).toHaveLength(3)
  })

  it('links the origin and records the task on the origin message', () => {
    db.insert('threads', fx.thread({ id: 'thr_1' }))
    db.insert('messages', fx.message({ id: 'msg_1', content: 'We should fix the redirect.' }))
    const task = createTask({ title: 'Fix redirect', origin: { kind: 'message', id: 'msg_1' }, labels: ['Bug', 'bug', ' UX '] })
    expect(task.labels).toEqual(['bug', 'ux'])
    expect(db.get('messages', 'msg_1')?.derived).toEqual([{ kind: 'task', id: task.id }])
    expect(db.all('links')).toEqual([
      expect.objectContaining({ from: { kind: 'task', id: task.id }, to: { kind: 'message', id: 'msg_1' }, rel: 'derived_from' }),
    ])
    expect(db.all('activity')[0].summary).toContain('from message “We should fix the redirect.”')
  })

  it('starts the agent when assigned to one', () => {
    const task = createTask({ title: 'Migrate invoices', description: 'Use Stripe Billing', projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' } })
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0][0]).toMatchObject({
      kind: 'agent',
      factory: 'agent.task',
      agentId: 'agt_1',
      projectId: 'prj_1',
      origin: { kind: 'task', id: task.id },
      params: { agentId: 'agt_1', instruction: 'Migrate invoices\n\nUse Stripe Billing', taskId: task.id, projectId: 'prj_1' },
    })
    const stored = db.get('tasks', task.id)!
    expect(stored.status).toBe('in_progress')
    expect(stored.runIds).toHaveLength(1)
    expect(task).toEqual(stored)
    expect(db.all('notifications')).toEqual([expect.objectContaining({ kind: 'task.assigned', ref: { kind: 'task', id: task.id } })])
  })

  it('still creates the task when the assigned agent is paused, with a warning', () => {
    db.update('agents', 'agt_1', { status: 'paused' })
    const task = createTask({ title: 'Do it', assignee: { type: 'agent', id: 'agt_1' } })
    expect(start).not.toHaveBeenCalled()
    expect(db.get('tasks', task.id)).toMatchObject({ status: 'todo', assignee: { type: 'agent', id: 'agt_1' } })
    expect(db.all('notifications')[0]).toMatchObject({ kind: 'system', tone: 'warning', body: expect.stringContaining('paused') })
  })
})

describe('updateTask / moveTask', () => {
  it('records status moves and completion time', () => {
    const task = createTask({ title: 'Ship it', projectId: 'prj_1' })
    const done = updateTask(task.id, { status: 'done' })!
    expect(done.completedAt).toBeTypeOf('number')
    expect(db.all('activity').at(-1)).toMatchObject({ verb: 'completed', summary: 'Moved “Ship it” to Done' })
    const reopened = updateTask(task.id, { status: 'todo' })!
    expect(reopened.completedAt).toBeUndefined()
    expect(db.all('activity').at(-1)?.summary).toBe('Moved “Ship it” to To do')
  })

  it('logs field updates and ignores no-op patches', () => {
    const task = createTask({ title: 'Ship it' })
    const before = db.all('activity').length
    updateTask(task.id, { title: 'Ship it' })
    expect(db.all('activity')).toHaveLength(before)
    updateTask(task.id, { priority: 'high', dueAt: 5 })
    expect(db.all('activity').at(-1)?.summary).toBe('Updated priority, due date of “Ship it”')
  })

  it('reorders within a column and moves across columns', () => {
    const [a, b, c] = ['A', 'B', 'C'].map((title) => createTask({ title, projectId: 'prj_1' }))
    moveTask(c.id, 'todo', a.id)
    expect(order('todo')).toEqual(['C', 'A', 'B'])
    moveTask(a.id, 'todo', a.id)
    expect(order('todo')).toEqual(['C', 'A', 'B'])
    moveTask(a.id, 'in_progress')
    expect(order('todo')).toEqual(['C', 'B'])
    expect(order('in_progress')).toEqual(['A'])
    moveTask(b.id, 'in_progress', a.id)
    expect(order('in_progress')).toEqual(['B', 'A'])
    expect(db.filter('activity', (e) => e.verb === 'moved')).toHaveLength(2)
    moveTask(b.id, 'done')
    expect(db.get('tasks', b.id)?.completedAt).toBeTypeOf('number')
  })
})

describe('assignTask', () => {
  it('assigns an agent, starts a run and notifies', () => {
    const task = createTask({ title: 'Investigate flaky test', projectId: 'prj_1' })
    const result = assignTask(task.id, { type: 'agent', id: 'agt_1' })!
    expect(result.run).toBeDefined()
    expect(result.task).toMatchObject({ status: 'in_progress', assignee: { type: 'agent', id: 'agt_1' }, runIds: [result.run!.id] })
    expect(db.all('notifications')[0].kind).toBe('task.assigned')
    // Re-assigning the same agent while its run is active does not start a second run.
    assignTask(task.id, { type: 'agent', id: 'agt_1' })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('refuses paused agents without changing the task', () => {
    db.update('agents', 'agt_1', { status: 'archived' })
    const task = createTask({ title: 'Nope' })
    expect(() => assignTask(task.id, { type: 'agent', id: 'agt_1' })).toThrow(/archived/)
    expect(db.get('tasks', task.id)?.assignee).toBeNull()
  })

  it('assigns the user without starting anything; updateTask delegates assignee changes', () => {
    const task = createTask({ title: 'Mine' })
    assignTask(task.id, ME)
    expect(db.get('tasks', task.id)?.assignee).toEqual(ME)
    updateTask(task.id, { assignee: { type: 'agent', id: 'agt_1' } })
    expect(start).toHaveBeenCalledTimes(1)
  })
})

describe('subtasks and deletion', () => {
  it('adds, toggles and removes subtasks', () => {
    const task = createTask({ title: 'Launch', subtasks: ['Draft post', ' '] })
    expect(task.subtasks).toHaveLength(1)
    const sub = addSubtask(task.id, 'Schedule post')!
    expect(toggleSubtask(task.id, sub.id)?.done).toBe(true)
    removeSubtask(task.id, task.subtasks[0].id)
    expect(db.get('tasks', task.id)?.subtasks).toEqual([{ ...sub, done: true }])
  })

  it('deletes a task and its backlinks', () => {
    db.insert('messages', fx.message({ id: 'msg_1' }))
    const task = createTask({ title: 'From chat', origin: { kind: 'message', id: 'msg_1' } })
    useContextStore.getState().pin({ kind: 'task', id: task.id })
    deleteTask(task.id)
    expect(db.get('tasks', task.id)).toBeUndefined()
    expect(db.get('messages', 'msg_1')?.derived).toEqual([])
    expect(db.all('links')).toEqual([])
    expect(useContextStore.getState().pinned).toEqual([])
  })
})

describe('hooks', () => {
  it('useTasks filters by project, status and assignee', () => {
    db.insertMany('tasks', [
      fx.task({ id: 't1', status: 'todo', order: 1 }),
      fx.task({ id: 't2', status: 'todo', order: 0, assignee: { type: 'agent', id: 'agt_1' } }),
      fx.task({ id: 't3', status: 'done', projectId: null }),
    ])
    expect(renderHook(() => useTasks({ projectId: 'prj_1' })).result.current.map((t) => t.id)).toEqual(['t2', 't1'])
    expect(renderHook(() => useTasks({ projectId: null })).result.current.map((t) => t.id)).toEqual(['t3'])
    expect(renderHook(() => useTasks({ assigneeType: 'agent' })).result.current.map((t) => t.id)).toEqual(['t2'])
    expect(renderHook(() => useTasks({ status: ['done', 'review'] })).result.current.map((t) => t.id)).toEqual(['t3'])
  })

  it('useMyTasks returns my open tasks by due date, then priority', () => {
    db.insertMany('tasks', [
      fx.task({ id: 'late', dueAt: 100, priority: 'low' }),
      fx.task({ id: 'urgent', priority: 'urgent' }),
      fx.task({ id: 'soon', dueAt: 50, assignee: ME }),
      fx.task({ id: 'nodue', priority: 'none' }),
      fx.task({ id: 'agent', assignee: { type: 'agent', id: 'agt_1' } }),
      fx.task({ id: 'done', status: 'done' }),
    ])
    expect(renderHook(() => useMyTasks()).result.current.map((t) => t.id)).toEqual(['soon', 'late', 'urgent', 'nodue'])
  })
})
