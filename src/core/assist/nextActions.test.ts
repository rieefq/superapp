import { describe, expect, it } from 'vitest'
import type { Tables } from '@/core/db'
import type { FileChange } from '@/core/types'
import { DAY, fx, HOUR, MIN, NOW, tables } from './fixtures.test-utils'
import { ASSIST_ROUTES, NEXT_ACTION_KINDS, suggestNextActions } from './nextActions'
import type { NextAction } from './types'

const suggest = (t: Tables, scopeProjectId: string | null = null, limit?: number) =>
  suggestNextActions({ tables: t, now: NOW, scopeProjectId }, limit === undefined ? {} : { limit })
const ids = (list: NextAction[]) => list.map((a) => a.id)

const change = (path: string, review?: FileChange['review']): FileChange => ({
  path, changeType: 'modified', additions: 3, deletions: 1, ...(review ? { review } : {}),
})

describe('suggestNextActions', () => {
  it('returns nothing for an empty workspace', () => {
    expect(suggest(tables())).toEqual([])
  })

  it('suggests reviewing reports waiting in research', () => {
    const t = tables({
      investigations: [
        fx.investigation('inv_a', { title: 'Lumen pricing benchmarks', status: 'review', sourceIds: ['s1', 's2', 's3'], findings: [
          { id: 'f1', text: 'x', sourceIds: [], confidence: 'high' }, { id: 'f2', text: 'y', sourceIds: [], confidence: 'low' },
        ] }),
        fx.investigation('inv_b', { status: 'complete' }),
      ],
    })
    expect(suggest(t)).toEqual([{
      id: 'review:investigation:inv_a',
      kind: 'review',
      title: 'Review the report “Lumen pricing benchmarks”',
      reason: 'Research finished 2h ago with 2 findings from 3 sources; it is waiting for your review.',
      ref: { kind: 'investigation', id: 'inv_a' },
      actionLabel: 'Review report',
      route: '/research/inv_a',
      priority: 78,
    }])
  })

  it('suggests reviewing changed files in coding sessions', () => {
    const t = tables({
      agents: [fx.agent('agt_forge', { name: 'Forge' })],
      tasks: [fx.task('tsk_sso', { title: 'Fix SSO session expiry' })],
      sessions: [
        fx.session('ses_a', {
          title: 'Fix session expiry', status: 'needs_review', agentId: 'agt_forge', taskId: 'tsk_sso',
          changes: [change('a.ts'), change('b.ts'), change('c.ts', 'accepted')],
          checks: [{ id: 'c1', name: 'unit', status: 'passed' }, { id: 'c2', name: 'lint', status: 'passed' }],
        }),
        fx.session('ses_b', { title: 'Old work', status: 'needs_review', changes: [change('x.ts', 'accepted')], updatedAt: NOW - 2 * DAY }),
        fx.session('ses_c', { status: 'working' }),
      ],
    })
    const [first, second] = suggest(t)
    expect(first).toMatchObject({
      id: 'review:session:ses_a',
      title: 'Review 2 changed files in “Fix session expiry”',
      reason: 'Forge finished 3h ago · all 2 checks passed · for “Fix SSO session expiry”.',
      actionLabel: 'Review changes',
      route: '/code/ses_a',
    })
    expect(second).toMatchObject({
      id: 'review:session:ses_b',
      title: 'Finish reviewing “Old work”',
      reason: 'The changed file is reviewed — apply or open a pull request · no checks ran.',
      actionLabel: 'Open session',
    })
  })

  it('aggregates pending approvals into one item, scoped through their runs', () => {
    const t = tables({
      agents: [fx.agent('agt_herald', { name: 'Herald' })],
      runs: [fx.run('run_1', { status: 'waiting', projectId: 'prj_a' }), fx.run('run_2', { status: 'waiting', projectId: 'prj_b' })],
      approvals: [
        fx.approval('apv_1', 'run_1', { title: 'Install stripe@18', risk: 'high', createdAt: NOW - 2 * HOUR }),
        fx.approval('apv_2', 'run_2', { title: 'Post digest to #product', createdAt: NOW - 10 * MIN }),
        fx.approval('apv_3', 'run_2', { status: 'approved' }),
      ],
    })
    expect(suggest(t)[0]).toEqual({
      id: 'approve:pending',
      kind: 'approve',
      title: 'Decide on 2 approvals',
      reason: '2 runs are paused until you approve or reject · oldest: “Install stripe@18” (2h ago).',
      actionLabel: 'Review approvals',
      route: ASSIST_ROUTES.approvals,
      priority: 94.7,
    })
    const scoped = suggest(t, 'prj_b')
    expect(scoped[0]).toMatchObject({
      id: 'approve:apv_2',
      title: 'Decide on “Post digest to #product”',
      reason: 'Herald is waiting for your approval · medium risk · asked 10m ago.',
      ref: { kind: 'approval', id: 'apv_2' },
      actionLabel: 'Decide',
    })
  })

  it('names who requested a single approval', () => {
    const t = tables({
      agents: [fx.agent('agt_herald', { name: 'Herald' })],
      runs: [fx.run('run_1', { kind: 'workflow', status: 'waiting', workflowId: 'wfl_1' })],
      workflows: [fx.workflow('wfl_1', { name: 'Weekly digest' })],
      approvals: [fx.approval('apv_1', 'run_1', { requestedBy: { type: 'workflow', id: 'wfl_1' } })],
    })
    expect(suggest(t)[0]).toMatchObject({
      reason: 'The “Weekly digest” workflow is waiting for your approval · medium risk · asked 30m ago.',
      route: '/workflows/wfl_1?run=run_1',
    })
  })

  it('suggests inspecting recent failures once per workflow, skipping retried, old, chat and child runs', () => {
    const t = tables({
      workflows: [fx.workflow('wfl_triage', { name: 'Support triage' })],
      runs: [
        fx.run('run_w1', { kind: 'workflow', workflowId: 'wfl_triage', title: 'Support triage · Locked out', status: 'failed', error: 'Linear rejected the request', endedAt: NOW - HOUR }),
        fx.run('run_w2', { kind: 'workflow', workflowId: 'wfl_triage', title: 'Support triage · Invoice', status: 'failed', endedAt: NOW - 3 * HOUR }),
        fx.run('run_old', { status: 'failed', endedAt: NOW - 2 * DAY }),
        fx.run('run_chat', { kind: 'chat', status: 'failed', endedAt: NOW - HOUR }),
        fx.run('run_child', { status: 'failed', parentRunId: 'run_w1', endedAt: NOW - HOUR }),
        fx.run('run_retried', { title: 'Research pricing', status: 'failed', endedAt: NOW - 4 * HOUR, createdAt: NOW - 5 * HOUR,
          script: { factory: 'research.investigate', params: { id: 'inv_1' }, seed: 1, cursor: 2 } }),
        fx.run('run_retry', { title: 'Research pricing', status: 'running', createdAt: NOW - 3 * HOUR,
          script: { factory: 'research.investigate', params: { id: 'inv_1' }, seed: 2, cursor: 0 } }),
        fx.run('run_task', { title: 'Draft the FAQ', status: 'failed', error: '', origin: { kind: 'task', id: 'tsk_faq' }, endedAt: NOW - 5 * HOUR,
          steps: [{ id: 'st1', kind: 'write', title: 'Write', status: 'failed', error: 'Budget exceeded' }] }),
      ],
      tasks: [fx.task('tsk_faq', { title: 'Publish the FAQ' })],
    })
    const retries = suggest(t).filter((a) => a.kind === 'retry')
    expect(ids(retries)).toEqual(['retry:run_w1', 'retry:run_task'])
    expect(retries[0]).toMatchObject({
      title: 'Retry or inspect “Support triage · Locked out”',
      reason: 'Linear rejected the request · failed 1h ago · 2 failures in 24h.',
      route: '/workflows/wfl_triage?run=run_w1',
      actionLabel: 'Inspect',
    })
    expect(retries[1].reason).toBe('Budget exceeded · failed 5h ago · for “Publish the FAQ”.')
  })

  it('suggests reconnecting broken integrations, ranked by who depends on them', () => {
    const t = tables({
      connections: [
        fx.connection('jira', { status: 'error', error: 'Token expired — reconnect to resume syncing' }),
        fx.connection('slack', { status: 'error' }),
        fx.connection('gmail'),
      ],
      workflows: [fx.workflow('wfl_1', { projectId: 'prj_ops', nodes: [{ id: 'n1', type: 'action', label: 'Post', position: { x: 0, y: 0 }, config: {}, integrationId: 'slack' }] })],
      agents: [fx.agent('agt_herald', { capabilities: [{ capability: 'messages.send', mode: 'ask', integrationId: 'slack' }] })],
    })
    const list = suggest(t).filter((a) => a.kind === 'reconnect')
    expect(list.map((a) => [a.title, a.reason, a.route])).toEqual([
      ['Reconnect Slack', 'Slack reported a connection error. Used by 1 enabled workflow and 1 agent.', '/integrations/slack'],
      ['Reconnect Jira', 'Token expired — reconnect to resume syncing.', '/integrations/jira'],
    ])
    expect(list[0].priority).toBeGreaterThan(list[1].priority)
    // In a project scope only integrations that project relies on are suggested.
    expect(ids(suggest(t, 'prj_ops').filter((a) => a.kind === 'reconnect'))).toEqual(['reconnect:slack'])
    expect(suggest(t, 'prj_other').filter((a) => a.kind === 'reconnect')).toEqual([])
  })

  it('suggests finishing my overdue and due-today tasks, overdue first', () => {
    const t = tables({
      projects: [fx.project('prj_atlas', { name: 'Atlas Portal v2' })],
      tasks: [
        fx.task('tsk_today', { title: 'Send the board update', dueAt: NOW + 2 * HOUR, priority: 'urgent' }),
        fx.task('tsk_over', { title: 'Approve pricing page', dueAt: NOW - 2 * DAY, priority: 'high', projectId: 'prj_atlas', assignee: { type: 'user', id: 'usr_me' } }),
        fx.task('tsk_agent', { dueAt: NOW - DAY, assignee: { type: 'agent', id: 'agt_forge' } }),
        fx.task('tsk_done', { dueAt: NOW - DAY, status: 'done' }),
        fx.task('tsk_later', { dueAt: NOW + 3 * DAY }),
      ],
    })
    const due = suggest(t).filter((a) => a.kind === 'due')
    expect(due.map((a) => [a.title, a.reason, a.route])).toEqual([
      ['Finish “Approve pricing page”', 'Overdue by 2 days · High priority · Atlas Portal v2.', '/projects/prj_atlas?task=tsk_over'],
      ['Finish “Send the board update”', 'Due today at 14:00 · Urgent.', '/projects/my-tasks?task=tsk_today'],
    ])
    expect(due[0].priority).toBe(88)
    // Urgent bonus (+3) minus the within-rule rank offset (0.1).
    expect(due[1].priority).toBe(68.9)
  })

  it('suggests resuming conversations whose last reply stopped or failed this week', () => {
    const t = tables({
      threads: [
        fx.thread('thr_err', { title: 'Stripe migration risks', messageIds: ['m1', 'm2'] }),
        fx.thread('thr_stop', { title: 'Naming tokens', messageIds: ['m3'] }),
        fx.thread('thr_ok', { messageIds: ['m4'] }),
        fx.thread('thr_old', { messageIds: ['m5'] }),
        fx.thread('thr_arch', { archived: true, messageIds: ['m6'] }),
        fx.thread('thr_user', { messageIds: ['m7'] }),
      ],
      messages: [
        fx.message('m1', 'thr_err', { role: 'user' }),
        fx.message('m2', 'thr_err', { status: 'error', error: 'Rate limited by Anthropic (429).', createdAt: NOW - 20 * MIN }),
        fx.message('m3', 'thr_stop', { status: 'stopped', createdAt: NOW - 3 * HOUR }),
        fx.message('m4', 'thr_ok'),
        fx.message('m5', 'thr_old', { status: 'stopped', createdAt: NOW - 9 * DAY }),
        fx.message('m6', 'thr_arch', { status: 'error' }),
        fx.message('m7', 'thr_user', { role: 'user', status: 'error' }),
      ],
    })
    expect(suggest(t).map((a) => [a.id, a.title, a.reason, a.route])).toEqual([
      ['resume:thr_err', 'Resume “Stripe migration risks”', 'The last reply failed: Rate limited by Anthropic (429) · 20m ago.', '/chat/thr_err'],
      ['resume:thr_stop', 'Resume “Naming tokens”', 'The last reply was stopped before it finished · 3h ago.', '/chat/thr_stop'],
    ])
  })

  it('nudges about active agents idle for over a week without an enabled schedule (low priority)', () => {
    const t = tables({
      agents: [
        fx.agent('agt_off', { name: 'Archivist', schedule: { cron: '0 2 * * *', label: 'Nightly at 02:00', enabled: false } }),
        fx.agent('agt_none', { name: 'Ledger', createdAt: NOW - 20 * DAY }),
        fx.agent('agt_on', { name: 'Scout', schedule: { cron: '0 8 * * 1', label: 'Mondays at 08:00', enabled: true } }),
        fx.agent('agt_busy', { name: 'Forge' }),
        fx.agent('agt_paused', { name: 'Muse', status: 'paused' }),
        fx.agent('agt_new', { name: 'Nova', createdAt: NOW - 2 * DAY }),
      ],
      runs: [
        fx.run('r_off', { agentId: 'agt_off', startedAt: NOW - 12 * DAY, createdAt: NOW - 12 * DAY }),
        fx.run('r_busy', { agentId: 'agt_busy', startedAt: NOW - DAY }),
      ],
    })
    const idle = suggest(t)
    expect(idle.map((a) => [a.title, a.reason, a.actionLabel, a.priority])).toEqual([
      ['Put Archivist to work', 'No runs in 12 days and its schedule (Nightly at 02:00) is off.', 'Review schedule', 14],
      ['Put Ledger to work', 'No runs since it was created 20 days ago and it has no schedule.', 'Open agent', 9.9],
    ])
    expect(idle.every((a) => a.kind === 'idle-agent')).toBe(true)
  })

  it('orders across rules by priority, dedupes covered entities and respects the limit', () => {
    const t = tables({
      runs: [fx.run('run_1', { status: 'waiting' })],
      approvals: [fx.approval('apv_1', 'run_1')],
      tasks: [
        fx.task('tsk_review', { title: 'Ship the SSO fix', dueAt: NOW + HOUR }),
        fx.task('tsk_late', { title: 'Late thing', dueAt: NOW - HOUR }),
      ],
      sessions: [fx.session('ses_1', { status: 'needs_review', taskId: 'tsk_review', changes: [change('a.ts')] })],
      investigations: [fx.investigation('inv_1', { status: 'review' })],
      connections: [fx.connection('jira', { status: 'error' })],
      agents: [fx.agent('agt_idle', { name: 'Idle' })],
    })
    const all = suggest(t)
    expect(ids(all)).toEqual([
      'approve:apv_1', 'due:tsk_late', 'review:session:ses_1', 'review:investigation:inv_1', 'reconnect:jira', 'idle-agent:agt_idle',
    ])
    // The due-today task is covered by the session that is doing it.
    expect(ids(all)).not.toContain('due:tsk_review')
    for (let i = 1; i < all.length; i++) expect(all[i - 1].priority).toBeGreaterThanOrEqual(all[i].priority)
    expect(ids(suggest(t, null, 2))).toEqual(['approve:apv_1', 'due:tsk_late'])
    expect(suggest(t, null, 0)).toEqual([])
  })

  it('respects the project scope', () => {
    const t = tables({
      tasks: [fx.task('tsk_a', { projectId: 'prj_a', dueAt: NOW - HOUR }), fx.task('tsk_b', { projectId: 'prj_b', dueAt: NOW - HOUR })],
      sessions: [fx.session('ses_a', { projectId: 'prj_a', status: 'needs_review' }), fx.session('ses_b', { projectId: 'prj_b', status: 'needs_review' })],
      investigations: [fx.investigation('inv_b', { projectId: 'prj_b', status: 'review' })],
      threads: [fx.thread('thr_b', { projectId: 'prj_b', messageIds: ['m1'] })],
      messages: [fx.message('m1', 'thr_b', { status: 'stopped' })],
      runs: [fx.run('run_b', { projectId: 'prj_b', status: 'failed' })],
      agents: [
        fx.agent('agt_a', { name: 'A', knowledgeScope: { all: false, collectionIds: [], projectIds: ['prj_a'] } }),
        fx.agent('agt_b', { name: 'B' }),
      ],
    })
    expect(ids(suggest(t, 'prj_a'))).toEqual(['due:tsk_a', 'review:session:ses_a', 'idle-agent:agt_a'])
    expect(ids(suggest(t, null)).length).toBeGreaterThan(5)
  })

  it('is deterministic for the same state and time', () => {
    const t = tables({
      tasks: [fx.task('tsk_a', { dueAt: NOW - HOUR }), fx.task('tsk_b', { dueAt: NOW - HOUR })],
      agents: [fx.agent('agt_x', { name: 'X' }), fx.agent('agt_y', { name: 'Y' })],
    })
    expect(suggest(t)).toEqual(suggest(t))
    expect(ids(suggest(t))).toEqual(['due:tsk_a', 'due:tsk_b', 'idle-agent:agt_x', 'idle-agent:agt_y'])
  })

  it('has display metadata for every kind', () => {
    for (const kind of ['review', 'approve', 'retry', 'reconnect', 'due', 'resume', 'idle-agent'] as const) {
      expect(NEXT_ACTION_KINDS[kind].label.length).toBeGreaterThan(0)
      expect(NEXT_ACTION_KINDS[kind].icon).toMatch(/^[A-Z]/)
    }
  })
})
