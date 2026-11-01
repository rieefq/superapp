import { describe, expect, it } from 'vitest'
import { emptyTables, type Tables } from '@/core/db'
import { fx } from '@/core/services/testFixtures'
import type { Approval, Notification } from '@/core/types'
import {
  BUSY_THRESHOLD,
  computeNeedsYou,
  groupByProject,
  inFlightRuns,
  landedNotifications,
  numberWord,
  sentenceInput,
  spendToday,
  stateSentence,
  statusDate,
} from './logic'

const T0 = 1_700_000_000_000

function approval(o: Partial<Approval> = {}): Approval {
  return {
    id: 'apv_1',
    runId: 'run_1',
    stepId: 'stp_1',
    title: 'Run npm test',
    capability: 'shell.execute',
    risk: 'medium',
    requestedBy: { type: 'agent', id: 'agt_forge' },
    status: 'pending',
    createdAt: T0,
    ...o,
  }
}

function note(o: Partial<Notification> = {}): Notification {
  return { id: 'ntf_1', kind: 'run.completed', title: 'Completed: x', tone: 'success', createdAt: T0, ref: { kind: 'run', id: 'run_1' }, ...o }
}

function world(build: (t: Tables) => void): Tables {
  const t = emptyTables()
  build(t)
  return t
}

describe('stateSentence', () => {
  it('names the single requester when one agent is waiting', () => {
    expect(stateSentence({ needsYou: 1, oldestRequester: 'Forge', requesters: 1, running: 3, landed: 0 }).text).toBe('Forge is waiting on you.')
    expect(stateSentence({ needsYou: 2, oldestRequester: 'Forge', requesters: 1, running: 0, landed: 0 }).text).toBe(
      'Forge is waiting on you for two things.',
    )
  })

  it('counts things when several requesters wait', () => {
    expect(stateSentence({ needsYou: 2, oldestRequester: 'Forge', requesters: 2, running: 1, landed: 4 }).text).toBe('Two things are waiting on you.')
  })

  it('names the oldest request when busy', () => {
    const r = stateSentence({ needsYou: BUSY_THRESHOLD + 1, oldestRequester: 'Sentinel', requesters: 3, running: 0, landed: 0 })
    expect(r.state).toBe('busy')
    expect(r.text).toBe('Six things are waiting on you, the oldest from Sentinel.')
  })

  it('falls through to in flight, landed and quiet in that order', () => {
    expect(stateSentence({ needsYou: 0, requesters: 0, running: 3, landed: 4 }).text).toBe('Three runs in flight. Nothing needs you.')
    expect(stateSentence({ needsYou: 0, requesters: 0, running: 1, landed: 0 }).text).toBe('One run in flight. Nothing needs you.')
    expect(stateSentence({ needsYou: 0, requesters: 0, running: 0, landed: 4 }).text).toBe('Four results landed while you were away.')
    expect(stateSentence({ needsYou: 0, requesters: 0, running: 0, landed: 0 })).toEqual({ text: 'All quiet. What’s next?', state: 'quiet' })
  })

  it('spells numbers up to twelve', () => {
    expect(numberWord(5)).toBe('Five')
    expect(numberWord(12)).toBe('Twelve')
    expect(numberWord(14)).toBe('14')
  })
})

describe('computeNeedsYou', () => {
  const s = world((t) => {
    t.projects.prj_1 = fx.project({ id: 'prj_1' })
    t.projects.prj_2 = fx.project({ id: 'prj_2', name: 'Lumen Launch' })
    t.agents.agt_forge = fx.agent({ id: 'agt_forge', name: 'Forge' })
    t.agents.agt_scout = fx.agent({ id: 'agt_scout', name: 'Scout' })
    t.runs.run_1 = fx.run({ id: 'run_1', projectId: 'prj_1', status: 'waiting', agentId: 'agt_forge' })
    t.runs.run_2 = fx.run({ id: 'run_2', projectId: 'prj_2', status: 'waiting', agentId: 'agt_scout' })
    t.runs.run_3 = fx.run({ id: 'run_3', projectId: 'prj_2', agentId: 'agt_scout' })
    t.approvals.apv_low = approval({ id: 'apv_low', runId: 'run_1', risk: 'low', createdAt: T0 })
    t.approvals.apv_high = approval({ id: 'apv_high', runId: 'run_2', risk: 'high', createdAt: T0 + 10, requestedBy: { type: 'agent', id: 'agt_scout' } })
    t.approvals.apv_done = approval({ id: 'apv_done', status: 'approved' })
    t.sessions.ses_1 = { ...fx.session(), id: 'ses_1', projectId: 'prj_1', status: 'needs_review', taskId: 'tsk_s', agentId: 'agt_forge', updatedAt: T0 + 5 }
    t.tasks.tsk_s = fx.task({ id: 'tsk_s', status: 'review', projectId: 'prj_1', runIds: ['run_1'] })
    t.tasks.tsk_a = fx.task({ id: 'tsk_a', status: 'review', projectId: 'prj_2', runIds: ['run_3'], updatedAt: T0 + 1 })
    t.tasks.tsk_me = fx.task({ id: 'tsk_me', status: 'review', projectId: 'prj_2', runIds: [] })
  })

  it('sorts approvals by risk, then age, and collects reviews like the Needs-you badge', () => {
    const needs = computeNeedsYou(s, null)
    expect(needs.approvals.map((a) => a.id)).toEqual(['apv_high', 'apv_low'])
    // The session's task is represented by the session; a task with no agent run is not "agent work".
    expect(needs.reviews.map((r) => `${r.kind}:${r.id}`)).toEqual(['task:tsk_a', 'session:ses_1'])
    expect(needs.count).toBe(4)
  })

  it('respects scope', () => {
    const needs = computeNeedsYou(s, 'prj_1')
    expect(needs.approvals.map((a) => a.id)).toEqual(['apv_low'])
    expect(needs.reviews.map((r) => r.id)).toEqual(['ses_1'])
  })

  it('feeds the sentence with the oldest requester and how many asked', () => {
    const input = sentenceInput(s, computeNeedsYou(s, null), 0, 0)
    expect(input).toMatchObject({ needsYou: 4, oldestRequester: 'Forge', requesters: 2 })
  })
})

describe('in flight and landed', () => {
  const s = world((t) => {
    t.runs.a = fx.run({ id: 'a', status: 'running', projectId: 'prj_1', createdAt: T0 })
    t.runs.b = fx.run({ id: 'b', status: 'waiting', projectId: 'prj_2', createdAt: T0 - 5 })
    t.runs.c = fx.run({ id: 'c', status: 'succeeded', projectId: 'prj_1' })
    t.runs.d = fx.run({ id: 'd', status: 'queued', projectId: null, createdAt: T0 + 5 })
    t.notifications.n1 = note({ id: 'n1', kind: 'run.completed', createdAt: T0 + 2, ref: { kind: 'run', id: 'c' } })
    t.notifications.n2 = note({ id: 'n2', kind: 'run.failed', createdAt: T0, ref: { kind: 'run', id: 'a' } })
    t.notifications.n3 = note({ id: 'n3', kind: 'run.completed', createdAt: T0 + 9, readAt: T0 + 10 })
    t.notifications.n4 = note({ id: 'n4', kind: 'approval.requested', createdAt: T0 + 9 })
  })

  it('lists active runs, waiting first, and groups them by project with "no project" last', () => {
    const runs = inFlightRuns(s, null)
    expect(runs.map((r) => r.id)).toEqual(['b', 'a', 'd'])
    expect(groupByProject(runs).map((g) => g.projectId)).toEqual(['prj_2', 'prj_1', null])
    expect(inFlightRuns(s, 'prj_1').map((r) => r.id)).toEqual(['a'])
  })

  it('lands unread completions and failures, failures first', () => {
    expect(landedNotifications(s, null).map((n) => n.id)).toEqual(['n2', 'n1'])
    expect(landedNotifications(s, 'prj_2').map((n) => n.id)).toEqual([])
  })
})

describe('status line', () => {
  it('formats the date as weekday, day and month', () => {
    expect(statusDate(new Date(2026, 10, 1, 9).getTime())).toBe('Sun 1 Nov')
  })

  it('reports live spend today, or the simulated estimate when nothing live ran', () => {
    const now = new Date(2026, 10, 1, 15).getTime()
    const today = new Date(2026, 10, 1, 10).getTime()
    const sim = world((t) => {
      t.runs.a = fx.run({ id: 'a', simulated: true, createdAt: today, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.2 } })
      t.runs.old = fx.run({ id: 'old', simulated: true, createdAt: today - 86_400_000, usage: { inputTokens: 1, outputTokens: 1, costUsd: 5 } })
    })
    expect(spendToday(sim, now, null)).toEqual({ usd: 0.2, estimated: true })
    sim.runs.b = fx.run({ id: 'b', simulated: false, createdAt: today, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.04 } })
    expect(spendToday(sim, now, null)).toEqual({ usd: 0.04, estimated: false })
  })
})
