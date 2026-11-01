import { describe, expect, it } from 'vitest'
import { ME } from '@/core/types'
import { at, HOUR, mkApproval, mkRun, mkTask, useTimeZone } from './fixtures.test-utils'
import { computeHomeSummary, isMyOpenTask, type HomeSummaryInput } from './home'

useTimeZone('UTC')

const NOW = at('2026-06-15T12:00:00Z')

function summary(partial: Partial<HomeSummaryInput> = {}) {
  return computeHomeSummary({ runs: [], approvals: [], tasks: [], now: NOW, ...partial })
}

describe('computeHomeSummary', () => {
  it('is all zeros for an empty world', () => {
    expect(summary()).toEqual({ working: 0, waitingOnYou: 0, dueToday: 0, overdue: 0, activeRuns: 0 })
  })

  it('counts distinct working agents and active runs', () => {
    const runs = [
      mkRun({ id: 'r1', agentId: 'agt_a', status: 'running' }),
      mkRun({ id: 'r2', agentId: 'agt_a', status: 'queued' }),
      mkRun({ id: 'r3', agentId: 'agt_b', status: 'running' }),
      mkRun({ id: 'r4', agentId: 'agt_c', status: 'waiting' }), // waiting on you, not working
      mkRun({ id: 'r5', agentId: 'agt_d', status: 'paused' }),
      mkRun({ id: 'r6', status: 'running', kind: 'chat' }), // no agent
      mkRun({ id: 'r7', agentId: 'agt_e', status: 'succeeded' }),
    ]
    expect(summary({ runs })).toMatchObject({ working: 2, activeRuns: 6 })
  })

  it('counts pending approvals', () => {
    const approvals = [
      mkApproval({ id: 'a1', status: 'pending' }),
      mkApproval({ id: 'a2', status: 'pending' }),
      mkApproval({ id: 'a3', status: 'approved' }),
      mkApproval({ id: 'a4', status: 'expired' }),
    ]
    expect(summary({ approvals }).waitingOnYou).toBe(2)
  })

  it('splits my open tasks into overdue (past due) and due later today', () => {
    const tasks = [
      mkTask({ id: 'earlier-today', dueAt: NOW - HOUR }),
      mkTask({ id: 'yesterday', dueAt: NOW - 30 * HOUR }),
      mkTask({ id: 'tonight', dueAt: at('2026-06-15T23:59:00Z') }),
      mkTask({ id: 'now', dueAt: NOW }),
      mkTask({ id: 'tomorrow', dueAt: at('2026-06-16T00:00:00Z') }),
      mkTask({ id: 'mine', dueAt: NOW + HOUR, assignee: ME }),
      mkTask({ id: 'agent', dueAt: NOW + HOUR, assignee: { type: 'agent', id: 'agt_a' } }),
      mkTask({ id: 'done', dueAt: NOW - HOUR, status: 'done' }),
      mkTask({ id: 'cancelled', dueAt: NOW - HOUR, status: 'cancelled' }),
      mkTask({ id: 'undated' }),
    ]
    expect(summary({ tasks })).toMatchObject({ overdue: 2, dueToday: 3 })
  })

  it('scopes runs, approvals (through their run) and tasks to a project', () => {
    const runs = [
      mkRun({ id: 'ra', projectId: 'prj_a', agentId: 'agt_a', status: 'running' }),
      mkRun({ id: 'rb', projectId: 'prj_b', agentId: 'agt_b', status: 'waiting' }),
    ]
    const approvals = [mkApproval({ id: 'ap', runId: 'rb' }), mkApproval({ id: 'orphan', runId: 'run_gone' })]
    const tasks = [mkTask({ id: 'ta', projectId: 'prj_a', dueAt: NOW + HOUR }), mkTask({ id: 'tb', projectId: 'prj_b', dueAt: NOW - HOUR })]
    expect(summary({ runs, approvals, tasks })).toEqual({ working: 1, waitingOnYou: 2, dueToday: 1, overdue: 1, activeRuns: 2 })
    expect(summary({ runs, approvals, tasks, projectId: 'prj_a' })).toEqual({ working: 1, waitingOnYou: 0, dueToday: 1, overdue: 0, activeRuns: 1 })
    expect(summary({ runs, approvals, tasks, projectId: 'prj_b' })).toEqual({ working: 0, waitingOnYou: 1, dueToday: 0, overdue: 1, activeRuns: 1 })
  })
})

describe('isMyOpenTask', () => {
  it('matches unassigned or user-assigned tasks that are still open', () => {
    expect(isMyOpenTask(mkTask({ id: 't' }))).toBe(true)
    expect(isMyOpenTask(mkTask({ id: 't', assignee: ME, status: 'review' }))).toBe(true)
    expect(isMyOpenTask(mkTask({ id: 't', assignee: { type: 'agent', id: 'agt_a' } }))).toBe(false)
    expect(isMyOpenTask(mkTask({ id: 't', status: 'done' }))).toBe(false)
  })
})
