import { describe, expect, it } from 'vitest'
import { emptyTables, type Tables } from '@/core/db'
import type { Approval, CodeSession, Run, Task } from '@/core/types'
import { needsYouCount, selectNeedsYou, selectRailBadges, sortApprovals } from './signals'

function approval(id: string, risk: Approval['risk'], createdAt: number, runId = 'run_1'): Approval {
  return {
    id,
    runId,
    stepId: 'stp_1',
    title: id,
    capability: 'shell.execute',
    risk,
    requestedBy: { type: 'agent', id: 'agt_forge' },
    status: 'pending',
    createdAt,
  }
}

function runRow(id: string, over: Partial<Run> = {}): Run {
  return {
    id,
    kind: 'code',
    title: id,
    status: 'running',
    projectId: 'prj_a',
    initiator: { type: 'user', id: 'usr_me' },
    steps: [],
    outputs: [],
    simulated: true,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    progress: 0,
    createdAt: 1,
    ...over,
  }
}

function world(): Tables {
  const t = emptyTables()
  t.runs = {
    run_1: runRow('run_1', { status: 'waiting' }),
    run_2: runRow('run_2', { kind: 'research', projectId: 'prj_b' }),
    run_3: runRow('run_3', { kind: 'agent', agentId: 'agt_scout', status: 'succeeded' }),
  }
  t.approvals = {
    a_low_old: approval('a_low_old', 'low', 10),
    a_high_new: approval('a_high_new', 'high', 30),
    a_high_old: approval('a_high_old', 'high', 20),
    a_done: { ...approval('a_done', 'low', 5), status: 'approved' },
  }
  t.sessions = {
    ses_1: { id: 'ses_1', repoId: 'rep_1', title: 'Fix', projectId: null, taskId: 'tsk_1', branch: 'b', baseBranch: 'main', status: 'needs_review', turns: [], changes: [], checks: [], createdAt: 1, updatedAt: 2 } as CodeSession,
  }
  const task = (id: string, runIds: string[]): Task => ({
    id, projectId: 'prj_a', title: id, status: 'review', priority: 'none', assignee: null, labels: [], subtasks: [], runIds, order: 0, createdAt: 1, updatedAt: 1,
  })
  t.tasks = { tsk_1: task('tsk_1', ['run_3']), tsk_2: task('tsk_2', ['run_3']), tsk_3: task('tsk_3', []) }
  return t
}

describe('Needs you (§3.8)', () => {
  it('sorts approvals by risk (high → low), then oldest first', () => {
    const t = world()
    expect(sortApprovals(Object.values(t.approvals).filter((a) => a.status === 'pending')).map((a) => a.id)).toEqual(['a_high_old', 'a_high_new', 'a_low_old'])
  })

  it('counts approvals + sessions in review + agent tasks in review not represented by a session', () => {
    const n = selectNeedsYou(world())
    expect(n.approvals).toHaveLength(3)
    expect(n.sessions.map((s) => s.id)).toEqual(['ses_1'])
    // tsk_1 is represented by ses_1; tsk_3 has no agent run.
    expect(n.tasks.map((t) => t.id)).toEqual(['tsk_2'])
    expect(needsYouCount(n)).toBe(5)
  })
})

describe('rail badges (§3.3)', () => {
  it('marks live work in scope and attention by run kind', () => {
    const t = world()
    const all = selectRailBadges(t, null)
    expect(all.research).toEqual({ live: true, attn: false })
    expect(all.code).toEqual({ live: false, attn: true })
    expect(all.projects).toEqual({ live: false, attn: true })
    const scoped = selectRailBadges(t, 'prj_a')
    expect(scoped.research).toBeUndefined()
  })
})
