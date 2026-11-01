import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables, useDB } from '@/core/db'
import { runEngine, type RunEngine } from '@/core/runs'
import {
  approveTaskReview,
  archiveProject,
  computeProjectMembers,
  computeProjectNeedsYou,
  computeProjectSignal,
  computeProjectSpend,
  createTask,
  latestTaskRun,
  milestonesByDue,
  nextMilestone,
  requestTaskChanges,
  taskRunIdsIn,
} from '@/core/services'
import { fakeStart, fx } from '@/core/services/testFixtures'
import { ME } from '@/core/types'

/*
 * Tests for what the Projects workspace added to the project and task services: review decisions,
 * runs from linked coding sessions, archive with scope, live signals, members and spend.
 */

let start: MockInstance<RunEngine['start']>

beforeEach(() => {
  db.replaceAll(emptyTables())
  useContextStore.setState({ scopeProjectId: null, pinned: [] })
  start = vi.spyOn(runEngine, 'start').mockImplementation(fakeStart)
  db.insert('projects', fx.project({ id: 'prj_1' }))
  db.insert('agents', fx.agent({ id: 'agt_1', name: 'Forge' }))
})

describe('review decisions', () => {
  it('approves agent work under review: Review → Done, logged as approved', () => {
    const task = createTask({ title: 'Fix refresh', projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' } })
    db.update('tasks', task.id, { status: 'review' })
    expect(approveTaskReview(task.id)?.status).toBe('done')
    expect(db.get('tasks', task.id)?.completedAt).toBeTypeOf('number')
    const event = db.all('activity').find((e) => e.verb === 'approved')
    expect(event?.summary).toMatch(/Approved Forge’s work on “Fix refresh”/)
  })

  it('does nothing for a task that is not in review', () => {
    const task = createTask({ title: 'Not yet', projectId: 'prj_1' })
    expect(approveTaskReview(task.id)?.status).toBe('todo')
  })

  it('sends agent work back with the note in a new run; the task returns to In progress', () => {
    const task = createTask({ title: 'Fix refresh', projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' } })
    db.update('tasks', task.id, { status: 'review' })
    const result = requestTaskChanges(task.id, 'Keep the legacy retry header')!
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[1][0].params).toMatchObject({ instruction: expect.stringContaining('Keep the legacy retry header'), taskId: task.id })
    expect(result.run).toBeDefined()
    expect(db.get('tasks', task.id)).toMatchObject({ status: 'in_progress', runIds: [expect.any(String), result.run!.id] })
    expect(db.all('activity').some((e) => e.verb === 'requested_changes')).toBe(true)
  })

  it('sends your own work back to In progress without starting anything', () => {
    const task = createTask({ title: 'Mine', projectId: 'prj_1', assignee: ME, status: 'review' })
    expect(requestTaskChanges(task.id, '')?.task.status).toBe('in_progress')
    expect(start).not.toHaveBeenCalled()
  })

  it('refuses a paused agent before logging anything', () => {
    const task = createTask({ title: 'Paused', projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' }, status: 'review' })
    db.update('agents', 'agt_1', { status: 'paused' })
    const before = db.all('activity').length
    expect(() => requestTaskChanges(task.id, 'again')).toThrow(/paused/)
    expect(db.all('activity')).toHaveLength(before)
  })
})

describe('runs of a task', () => {
  it('include the turns of coding sessions linked to the task, oldest first', () => {
    db.insert('tasks', fx.task({ id: 'tsk_1', runIds: ['run_b'] }))
    db.insert('runs', fx.run({ id: 'run_a', createdAt: 1 }))
    db.insert('runs', fx.run({ id: 'run_b', createdAt: 2 }))
    db.insert('runs', fx.run({ id: 'run_c', createdAt: 3, agentId: 'agt_1' }))
    db.insert('sessions', fx.session({ id: 'ses_1', taskId: 'tsk_1', turns: [{ id: 't1', prompt: 'x', runId: 'run_a', createdAt: 1 }, { id: 't2', prompt: 'y', runId: 'run_c', createdAt: 3 }] }))
    const s = useDB.getState()
    expect(taskRunIdsIn(s, s.tasks.tsk_1)).toEqual(['run_a', 'run_b', 'run_c'])
    expect(latestTaskRun(s.tasks.tsk_1)?.id).toBe('run_c')
    // Tasks without linked sessions keep their own list.
    db.insert('tasks', fx.task({ id: 'tsk_2', runIds: ['run_b'] }))
    expect(taskRunIdsIn(useDB.getState(), useDB.getState().tasks.tsk_2)).toEqual(['run_b'])
  })
})

describe('projects', () => {
  it('archives a project, moving the scope back to All work, and reports the previous status', () => {
    useContextStore.setState({ scopeProjectId: 'prj_1' })
    expect(archiveProject('prj_1')).toEqual({ previous: 'active', wasScope: true })
    expect(db.get('projects', 'prj_1')?.status).toBe('archived')
    expect(useContextStore.getState().scopeProjectId).toBeNull()
    expect(archiveProject('prj_1')).toBeUndefined()
  })

  it('orders milestones by due date and finds the next one', () => {
    const project = fx.project({
      milestones: [
        { id: 'c', title: 'GA', dueAt: 30, status: 'upcoming' },
        { id: 'x', title: 'Someday', status: 'upcoming' },
        { id: 'a', title: 'Beta', dueAt: 10, status: 'done' },
        { id: 'b', title: 'Cutover', dueAt: 20, status: 'active' },
      ],
    })
    expect(milestonesByDue(project).map((m) => m.id)).toEqual(['a', 'b', 'c', 'x'])
    expect(nextMilestone(project)?.id).toBe('b')
  })

  it('computes live signals and what needs you per project', () => {
    db.insert('runs', fx.run({ id: 'run_1', projectId: 'prj_1', status: 'running' }))
    db.insert('runs', fx.run({ id: 'run_2', projectId: 'prj_1', status: 'waiting' }))
    db.insert('runs', fx.run({ id: 'run_3', projectId: 'prj_1', status: 'succeeded', agentId: 'agt_1' }))
    db.insert('approvals', fx.approval({ id: 'apv_1', runId: 'run_2', status: 'pending' }))
    db.insert('tasks', fx.task({ id: 'tsk_r', projectId: 'prj_1', status: 'review', runIds: ['run_3'] }))
    db.insert('tasks', fx.task({ id: 'tsk_s', projectId: 'prj_1', status: 'review', runIds: ['run_3'] }))
    db.insert('sessions', fx.session({ id: 'ses_1', projectId: 'prj_1', status: 'needs_review', taskId: 'tsk_s' }))
    const s = useDB.getState()
    // A session in review covers its task: approvals 1 + session 1 + task 1.
    expect(computeProjectSignal(s, 'prj_1')).toEqual({ running: 1, waiting: 1, needsYou: 3 })
    const needs = computeProjectNeedsYou(s, 'prj_1')
    expect(needs.approvals.map((a) => a.id)).toEqual(['apv_1'])
    expect(needs.sessions.map((x) => x.id)).toEqual(['ses_1'])
    expect(needs.tasks.map((t) => t.id)).toEqual(['tsk_r'])
    expect(computeProjectSignal(s, 'prj_other')).toEqual({ running: 0, waiting: 0, needsYou: 0 })
  })

  it('derives members from the work: you first, then agents with tasks or active runs', () => {
    db.insert('agents', fx.agent({ id: 'agt_2', name: 'Scout' }))
    db.insert('tasks', fx.task({ id: 't1', projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' } }))
    db.insert('tasks', fx.task({ id: 't2', projectId: 'prj_1', assignee: null }))
    db.insert('tasks', fx.task({ id: 't3', projectId: 'prj_1', assignee: { type: 'agent', id: 'agt_1' }, status: 'done' }))
    db.insert('runs', fx.run({ id: 'r1', projectId: 'prj_1', agentId: 'agt_2', status: 'running', createdAt: Date.now() }))
    const members = computeProjectMembers(useDB.getState(), 'prj_1')
    expect(members.map((m) => m.actor)).toEqual([ME, { type: 'agent', id: 'agt_2' }, { type: 'agent', id: 'agt_1' }])
    expect(members[0].openTasks).toBe(1)
    expect(members[1]).toMatchObject({ activeRuns: 1, openTasks: 0 })
    expect(members[2]).toMatchObject({ activeRuns: 0, openTasks: 1 })
  })

  it('splits month-to-date spend into live spend and the simulated estimate', () => {
    const now = new Date(2026, 10, 15).getTime()
    db.insert('runs', fx.run({ id: 'a', projectId: 'prj_1', simulated: false, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.5 }, createdAt: now - 1000 }))
    db.insert('runs', fx.run({ id: 'b', projectId: 'prj_1', simulated: true, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.25 }, createdAt: now - 2000 }))
    db.insert('runs', fx.run({ id: 'c', projectId: 'prj_1', simulated: false, usage: { inputTokens: 1, outputTokens: 1, costUsd: 9 }, createdAt: new Date(2026, 9, 30).getTime() }))
    db.insert('runs', fx.run({ id: 'd', projectId: 'prj_2', simulated: false, usage: { inputTokens: 1, outputTokens: 1, costUsd: 9 }, createdAt: now }))
    expect(computeProjectSpend(useDB.getState().runs, 'prj_1', now)).toEqual({ liveUsd: 0.5, estimatedUsd: 0.25, runs: 2 })
  })
})
