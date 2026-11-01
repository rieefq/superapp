import type { Approval, EntityRef, ID, Notification, NotificationKind, Run, Tone } from '@/core/types'
import { INVESTIGATION, SESSION, TASK } from '../ids'
import { MIN } from './time'
import type { Timeline } from './timeline'
import { ref } from './util'

interface Lookup {
  run(id: ID): Run
  approval(id: ID): Approval
}

/** Recent inbox: the two pending approvals, finished and failed work, and the Jira error. */
export function buildNotifications(tl: Timeline, find: Lookup): Notification[] {
  const items: Notification[] = []
  const add = (n: {
    id: string
    kind: NotificationKind
    title: string
    body: string
    ref: EntityRef
    tone: Tone
    at: number
    readAfterMin?: number
  }) => {
    const row: Notification = { id: n.id, kind: n.kind, title: n.title, body: n.body, ref: n.ref, tone: n.tone, createdAt: n.at }
    if (n.readAfterMin !== undefined) row.readAt = Math.min(n.at + n.readAfterMin * MIN, tl.clock.now - MIN)
    items.push(row)
  }
  const ended = (runId: ID) => {
    const run = find.run(runId)
    return run.endedAt ?? run.createdAt
  }

  const npm = find.approval('apv_seed_npm')
  const slack = find.approval('apv_seed_slack')
  add({
    id: 'ntf_seed_01', kind: 'approval.requested', title: 'Forge needs approval to run a command',
    body: 'npm install stripe@^18 --save · Migrate invoices to Stripe Billing', ref: ref('approval', npm.id), tone: 'warning', at: npm.createdAt + 900,
  })
  add({
    id: 'ntf_seed_02', kind: 'approval.requested', title: 'Herald wants to post the weekly digest to #product',
    body: 'Review the draft before it goes to Slack.', ref: ref('approval', slack.id), tone: 'warning', at: slack.createdAt + 900,
  })
  add({
    id: 'ntf_seed_03', kind: 'task.assigned', title: 'Muse picked up “Storyboard the launch hero video”',
    body: 'Generating six storyboard frames for the 45-second hero video.', ref: ref('task', TASK.heroVideo), tone: 'info',
    at: find.run('run_seed_muse_storyboard').createdAt + 1_000,
  })
  add({
    id: 'ntf_seed_04', kind: 'run.completed', title: 'Ledger found a double charge for Coastal Cargo',
    body: 'Two $1,065.00 charges 11 minutes apart. Ledger can’t issue refunds, so it drafted a request for Finance.',
    ref: ref('run', 'run_seed_agent_ledger_5'), tone: 'warning', at: ended('run_seed_agent_ledger_5'),
  })
  add({
    id: 'ntf_seed_05', kind: 'run.completed', title: 'SSO session fix is ready for review',
    body: 'Forge added two regression tests; typecheck, lint, unit and e2e pass.', ref: ref('session', SESSION.sso), tone: 'success',
    at: ended('run_seed_code_sso_2'),
  })
  add({
    id: 'ntf_seed_06', kind: 'integration.error', title: 'Jira disconnected',
    body: 'Token expired — reconnect to resume syncing.', ref: ref('integration', 'jira'), tone: 'danger', at: tl.jiraTokenExpired,
  })
  add({
    id: 'ntf_seed_07', kind: 'run.completed', title: 'Competitor brief revised',
    body: 'ShipLoom added, positioning tightened. Now 410 words.', ref: ref('task', TASK.competitorBrief), tone: 'success',
    at: ended('run_seed_agent_scout_4'), readAfterMin: 35,
  })
  add({
    id: 'ntf_seed_08', kind: 'run.completed', title: 'Churn research is ready for review',
    body: '“Why do logistics customers churn?” has findings and a draft report.', ref: ref('investigation', INVESTIGATION.churn), tone: 'success',
    at: ended('run_seed_research_churn_1'), readAfterMin: 50,
  })
  add({
    id: 'ntf_seed_09', kind: 'run.completed', title: 'Urgent support alert: Meridian Freight',
    body: 'Dispatchers signed out about an hour after SSO login. Alert posted to #support-urgent.', ref: ref('run', 'run_seed_wf_triage_03'),
    tone: 'warning', at: ended('run_seed_wf_triage_03'), readAfterMin: 4,
  })
  add({
    id: 'ntf_seed_10', kind: 'run.completed', title: 'PR review posted on #215',
    body: 'Three comments on “Export shipments to CSV”, including CSV injection.', ref: ref('run', 'run_seed_wf_pr_05'), tone: 'success',
    at: ended('run_seed_wf_pr_05'), readAfterMin: 90,
  })
  const radar = find.run('run_seed_wf_radar_4')
  add({
    id: 'ntf_seed_11', kind: 'run.completed', title: 'Competitor radar: 2 updates',
    body: 'ShipLoom plans EU e-invoicing next quarter; Tidewell raised Pro list prices by about 8%.', ref: ref('run', radar.id), tone: 'info',
    at: radar.endedAt ?? radar.createdAt, readAfterMin: 70,
  })
  const digest = find.approval('apv_seed_wf_digest_4')
  add({
    id: 'ntf_seed_12', kind: 'approval.resolved', title: 'Weekly digest posted to #product',
    body: 'You approved Herald’s digest.', ref: ref('approval', digest.id), tone: 'success', at: (digest.resolvedAt ?? digest.createdAt) + 2_000,
    readAfterMin: 1,
  })
  add({
    id: 'ntf_seed_13', kind: 'run.failed', title: 'Checkout spec still flaky: 1 of 20 runs failed',
    body: 'The cause is an out-of-order poll response in Checkout.tsx, not the test.', ref: ref('session', SESSION.flaky), tone: 'danger',
    at: ended('run_seed_code_flaky_2'), readAfterMin: 12,
  })
  add({
    id: 'ntf_seed_14', kind: 'run.failed', title: 'Archivist: nightly knowledge sync failed',
    body: 'Notion rate limited the sync (HTTP 429) after 18 of 64 pages. Nothing was written.', ref: ref('run', 'run_seed_agent_archivist_5'),
    tone: 'danger', at: ended('run_seed_agent_archivist_5'), readAfterMin: 7 * 60 + 10,
  })
  add({
    id: 'ntf_seed_15', kind: 'task.assigned', title: 'Sentinel assigned you “Finalize triage rubric v2”',
    body: 'The draft is in Knowledge; seven past tickets would change priority.', ref: ref('task', TASK.triageRubric), tone: 'accent',
    at: ended('run_seed_agent_sentinel_1'), readAfterMin: 25,
  })
  add({
    id: 'ntf_seed_16', kind: 'run.failed', title: 'Support triage couldn’t file a Linear issue',
    body: 'Linear returned 503 after 3 retries for Halden’s bulk-upload email. The next run will file it.', ref: ref('run', 'run_seed_wf_triage_07'),
    tone: 'danger', at: ended('run_seed_wf_triage_07'), readAfterMin: 20,
  })
  return items
}
