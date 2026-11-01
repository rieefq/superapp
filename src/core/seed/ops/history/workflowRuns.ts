import type { ActorRef } from '@/core/types'
import { createRng } from '@/lib/rng'
import { AGENT, BOARD, KNOWLEDGE, PROJECT, WORKFLOW } from '../../ids'
import { composeDigest, type Headline } from '../digest'
import type { RunSpec, StepSpec } from '../runKit'
import type { PullRequestReview, RadarWeek, Story, SupportEmail } from '../story'
import { DAY, MIN } from '../time'
import type { Timeline } from '../timeline'
import { ref, thousands } from '../util'
import { ASSETS, DIGEST, PR_REVIEW, RADAR, TRIAGE } from '../workflows'

const wf = (id: string): ActorRef => ({ type: 'workflow', id })
const ME: ActorRef = { type: 'user', id: 'usr_me' }

/** Slack alert text for an urgent support email. */
export function urgentAlertText(e: SupportEmail): string {
  return `:rotating_light: ${e.account} (${e.plan}): ${e.summary}\n> ${e.quote}\nSLA: ${e.plan} · urgent`
}

export function triageRun(e: SupportEmail): RunSpec {
  const base = {
    id: `run_seed_wf_${e.key}`,
    kind: 'workflow' as const,
    projectId: PROJECT.ops,
    agentId: AGENT.sentinel,
    workflowId: WORKFLOW.triage,
    origin: ref('workflow', WORKFLOW.triage),
    initiator: wf(WORKFLOW.triage),
    modelId: 'sim-swift',
    at: e.at,
  }
  const rng = createRng(e.key)
  const urgent = e.priority === 'urgent'
  const domain = e.from.split('@')[1] ?? e.from
  const verdict = { priority: e.priority, category: e.category, account: e.account, summary: e.summary }
  const steps: StepSpec[] = [
    {
      kind: 'tool', title: `Email from ${e.from}`, tool: 'gmail', capability: 'files.read', integrationId: 'gmail', nodeId: TRIAGE.trigger,
      input: 'to:support@northwind.example', output: `Subject: ${e.subject}\nFrom: ${e.from}\n\n“${e.quote}”`,
      ms: rng.int(900, 1_600), tokens: rng.int(500, 900),
    },
    {
      kind: 'read', title: `Matched ${e.account} · ${e.plan}`, tool: 'knowledge.search', capability: 'knowledge.read', nodeId: TRIAGE.enrich,
      output: `Sender domain ${domain} → ${e.account} (${e.plan} plan). Applied the ${e.plan} tier of the Support SLA policy.`,
      refs: [ref('knowledge', KNOWLEDGE.csvAccounts), ref('knowledge', KNOWLEDGE.slaPolicy)],
      ms: rng.int(1_600, 2_600), tokens: rng.int(1_500, 2_300),
    },
    {
      kind: 'think', title: `Classified ${e.priority} · ${e.category}`, tool: 'agent', capability: 'knowledge.read', nodeId: TRIAGE.classify,
      output: JSON.stringify(verdict, null, 2), refs: [ref('knowledge', KNOWLEDGE.triageRubric), ...(e.refs ?? [])],
      ms: rng.int(3_800, 5_400), tokens: rng.int(3_600, 5_200),
    },
    { kind: 'think', title: `priority == "urgent" → ${urgent}`, nodeId: TRIAGE.urgent, ms: 120 },
  ]
  if (e.failure) {
    steps.push({
      kind: 'tool', title: 'Create Linear issue', tool: 'linear', capability: 'tasks.manage', integrationId: 'linear',
      nodeId: TRIAGE.issue, ms: 24_000, tokens: 350, status: 'failed', error: e.failure,
    })
    return { ...base, title: `Support triage · ${e.subject} (${e.account})`, status: 'failed', error: e.failure, steps }
  }
  if (urgent) {
    const text = urgentAlertText(e)
    steps.push({
      kind: 'message', title: 'Alerted #support-urgent', tool: 'slack', capability: 'messages.send', integrationId: 'slack',
      nodeId: TRIAGE.alert, input: '#support-urgent', output: text, ms: 900, tokens: 400,
      approval: {
        title: `Alert #support-urgent: ${e.account}`,
        description: 'Sentinel classified this email as urgent. Post the alert to #support-urgent?',
        capability: 'messages.send', risk: 'high', requestedBy: wf(WORKFLOW.triage),
        preview: { kind: 'message', label: '#support-urgent', content: text },
        decision: 'approved', waitMs: (e.alertApprovedAfterMin ?? 5) * MIN,
      },
    })
  } else {
    steps.push({
      kind: 'tool', title: `Created Linear issue ${e.issue ?? ''}`.trim(), tool: 'linear', capability: 'tasks.manage', integrationId: 'linear',
      nodeId: TRIAGE.issue, output: `${e.issue} · ${capitalize(e.priority)} · “${e.subject}” · labels: ${e.category}, triage-bot`,
      ms: rng.int(1_000, 1_600), tokens: 350,
    })
  }
  steps.push({
    kind: 'write', title: 'Logged triage decision', nodeId: TRIAGE.log, ms: 250,
    output: `priority=${e.priority} category=${e.category} account="${e.account}" ${urgent ? 'alerted=#support-urgent' : `issue=${e.issue}`}`,
  })

  return {
    ...base,
    title: `Support triage · ${e.subject} (${e.account})`,
    status: 'succeeded',
    steps,
    summary: urgent
      ? `Urgent: ${e.summary} Alert posted to #support-urgent after your approval.`
      : `${capitalize(e.priority)} priority (${e.category}). Filed ${e.issue} in Linear.`,
  }
}

function digestRun(tl: Timeline, story: Story, n: number, at: number, opts: {
  decision: 'approved' | 'rejected'
  waitMin: number
  note?: string
  extra?: Headline[]
  calendar: string
}): RunSpec {
  const text = composeDigest({ tl, story, from: at - 7 * DAY, to: at, extra: opts.extra })
  const words = text.split(/\s+/).filter(Boolean).length
  const rejected = opts.decision === 'rejected'
  const steps: StepSpec[] = [
    { kind: 'tool', title: 'Scheduled run · Mondays at 09:00', tool: 'scheduler', nodeId: DIGEST.trigger, ms: 200 },
    {
      kind: 'read', title: 'Collected last week’s activity', tool: 'workspace', capability: 'tasks.manage', nodeId: DIGEST.collect,
      output: 'Tasks, runs, coding sessions, knowledge and support volume from 4 active projects (read-only).', ms: 2_600, tokens: 2_400 + n * 130,
    },
    {
      kind: 'read', title: 'Read this week’s milestones & meetings', tool: 'google-calendar', capability: 'calendar.manage',
      integrationId: 'google-calendar', nodeId: DIGEST.calendar, output: opts.calendar, ms: 1_500, tokens: 900,
    },
    {
      kind: 'write', title: 'Drafted the digest', tool: 'agent', capability: 'knowledge.read', nodeId: DIGEST.summarize,
      output: text, ms: 7_400, tokens: 9_400 + n * 410,
    },
    {
      kind: 'approval', title: 'Review before posting to #product', nodeId: DIGEST.approve, ms: 300,
      approval: {
        title: 'Post weekly digest to #product',
        description: 'Herald drafted this week’s project digest. Approve to post it to #product on Slack.',
        capability: 'messages.send', risk: 'high', requestedBy: wf(WORKFLOW.digest),
        preview: { kind: 'message', label: '#product', content: text },
        decision: opts.decision, waitMs: opts.waitMin * MIN, note: opts.note,
      },
    },
  ]
  if (!rejected) {
    steps.push(
      {
        kind: 'message', title: 'Posted to #product', tool: 'slack', capability: 'messages.send', integrationId: 'slack',
        nodeId: DIGEST.post, input: '#product', output: `Posted the digest (${words} words).`, ms: 900, tokens: 300,
      },
      { kind: 'write', title: 'Logged and notified you', nodeId: DIGEST.log, output: 'Weekly digest posted to #product.', ms: 200 },
    )
  }
  return {
    id: `run_seed_wf_digest_${n}`,
    kind: 'workflow',
    title: 'Weekly project digest',
    status: rejected ? 'cancelled' : 'succeeded',
    at,
    projectId: PROJECT.ops,
    agentId: AGENT.herald,
    workflowId: WORKFLOW.digest,
    origin: ref('workflow', WORKFLOW.digest),
    initiator: wf(WORKFLOW.digest),
    modelId: 'sim-swift',
    steps,
    summary: rejected ? undefined : `Digest posted to #product (${words} words) after your review.`,
    error: rejected ? 'Stopped: you rejected the post to #product.' : undefined,
  }
}

function prReviewRun(pr: PullRequestReview): RunSpec {
  const changed = pr.additions + pr.deletions
  const reviewable = changed <= 600
  const comments = pr.comments.map((c, i) => `${i + 1}. ${c}`).join('\n\n')
  const steps: StepSpec[] = [
    {
      kind: 'tool', title: `PR #${pr.number} opened by @${pr.author}`, tool: 'github', integrationId: 'github', nodeId: PR_REVIEW.trigger,
      output: `“${pr.title}” → main · +${pr.additions} −${pr.deletions} in ${pr.files} files`, ms: 400,
    },
    {
      kind: 'read', title: 'Fetched diff & checks', tool: 'github', capability: 'repo.read', integrationId: 'github', nodeId: PR_REVIEW.fetch,
      output: `${pr.files} files changed · checks: typecheck ✓ lint ✓ unit ✓ e2e ✓`, ms: 2_100, tokens: Math.min(40_000, 2_500 + changed * 22),
    },
    { kind: 'think', title: `diff.changedLines (${changed}) <= 600 → ${reviewable}`, nodeId: PR_REVIEW.size, ms: 100 },
  ]
  const approval = {
    title: reviewable ? `Post review on PR #${pr.number}` : `Ask @${pr.author} to split PR #${pr.number}`,
    description: reviewable
      ? `Forge reviewed “${pr.title}”. Approve to post ${pr.comments.length} comments on GitHub.`
      : `PR #${pr.number} changes ${thousands(changed)} lines, above the 600-line review limit.`,
    capability: 'repo.pull_request' as const,
    risk: 'high' as const,
    requestedBy: wf(WORKFLOW.prReview),
    preview: { kind: 'text' as const, label: `northwind/atlas-portal#${pr.number}`, content: comments },
    decision: pr.decision,
    note: pr.note,
    waitMs: pr.waitMin * MIN,
  }
  if (reviewable) {
    steps.push(
      {
        kind: 'think', title: `Reviewed the change: ${pr.comments.length} comments`, tool: 'agent', capability: 'repo.read',
        nodeId: PR_REVIEW.review, refs: [ref('knowledge', KNOWLEDGE.codeReview)], output: comments,
        ms: 11_000, tokens: 12_000 + changed * 40,
      },
      { kind: 'approval', title: 'Approve review comments', nodeId: PR_REVIEW.approve, ms: 300, approval },
    )
    if (pr.decision === 'approved') {
      steps.push({
        kind: 'tool', title: `Posted review on #${pr.number}`, tool: 'github', capability: 'repo.pull_request', integrationId: 'github',
        nodeId: PR_REVIEW.post, output: `Review submitted (COMMENT) with ${pr.comments.length} comments.`, ms: 1_200, tokens: 300,
      })
    }
  } else {
    steps.push({
      kind: 'message', title: `Asked @${pr.author} to split #${pr.number}`, tool: 'github', capability: 'repo.pull_request',
      integrationId: 'github', nodeId: PR_REVIEW.split, input: `northwind/atlas-portal#${pr.number}`, output: 'Comment posted.',
      ms: 900, tokens: 2_100, approval,
    })
  }
  const rejected = pr.decision === 'rejected'
  return {
    id: `run_seed_wf_${pr.key}`,
    kind: 'workflow',
    title: `PR review · #${pr.number} ${pr.title}`,
    status: rejected ? 'cancelled' : 'succeeded',
    at: pr.at,
    projectId: PROJECT.atlas,
    agentId: AGENT.forge,
    workflowId: WORKFLOW.prReview,
    origin: ref('workflow', WORKFLOW.prReview),
    initiator: wf(WORKFLOW.prReview),
    modelId: 'sim-deep',
    steps,
    summary: rejected
      ? undefined
      : reviewable
        ? `Posted ${pr.comments.length} review comments on #${pr.number}.`
        : `#${pr.number} is ${thousands(changed)} lines; asked @${pr.author} to split it into three reviewable PRs.`,
    error: rejected ? 'Stopped: you rejected the review comments.' : undefined,
  }
}

function radarRun(w: RadarWeek): RunSpec {
  const kept = w.items.length
  const steps: StepSpec[] = [
    { kind: 'tool', title: 'Scheduled run · Mondays at 08:00', tool: 'scheduler', nodeId: RADAR.trigger, ms: 200 },
    {
      kind: 'search', title: 'Searched news on Tidewell, Freightly and ShipLoom', tool: 'web.search', capability: 'web.search',
      integrationId: 'web-search', nodeId: RADAR.scan, input: '"Tidewell" OR "Freightly" OR "ShipLoom" (past 7 days)',
      output: `${w.results} results from ${w.queries} queries (simulated web corpus).`, ms: 8_200, tokens: 6_200 + w.results * 60,
    },
    {
      kind: 'think', title: `Kept ${kept} of ${w.results} after dedupe & scoring`, nodeId: RADAR.score, ms: 3_800, tokens: 3_400,
      output: kept
        ? w.items.map((i) => `${i.relevance.toFixed(2)}  ${i.text} (${i.source})`).join('\n')
        : 'Everything was a duplicate of a known item or scored below the 0.6 relevance bar.',
    },
    { kind: 'think', title: `items.length > 0 → ${kept > 0}`, nodeId: RADAR.notable, ms: 100 },
  ]
  if (kept) {
    steps.push(
      {
        kind: 'write', title: 'Updated competitor notes', capability: 'knowledge.write', nodeId: RADAR.update, refs: w.updates,
        output: `Appended ${kept} dated ${kept === 1 ? 'entry' : 'entries'} with sources.`, ms: 1_600, tokens: 1_800,
      },
      { kind: 'write', title: 'Notified you', nodeId: RADAR.notify, output: `Competitor radar: ${kept} updates`, ms: 200 },
    )
  } else {
    steps.push({ kind: 'write', title: 'Logged a quiet week', nodeId: RADAR.quiet, output: 'No notable competitor news this week.', ms: 200 })
  }
  return {
    id: `run_seed_wf_${w.key}`,
    kind: 'workflow',
    title: 'Competitor radar',
    status: w.status,
    at: w.at,
    projectId: PROJECT.landscape,
    agentId: AGENT.scout,
    workflowId: WORKFLOW.radar,
    origin: ref('workflow', WORKFLOW.radar),
    initiator: wf(WORKFLOW.radar),
    modelId: 'sim-deep',
    steps,
    outputs: w.updates,
    summary: kept ? `${kept} notable updates: ${w.items.map((i) => i.text).join(' ')}` : 'Quiet week: nothing new above the relevance bar.',
  }
}

function assetsTestRun(tl: Timeline): RunSpec {
  const error =
    'Google Drive returned 403 (insufficientFilePermissions): the folder “Marketing / Lumen launch / Assets” is not shared with this connection.'
  const files = ['1200x628', '1080x1080', '1080x1920'].flatMap((f) => [1, 2, 3].map((v) => `lumen-${f}-v${v}.png`))
  return {
    id: 'run_seed_wf_assets_1',
    kind: 'workflow',
    title: 'Launch asset pipeline · test run',
    status: 'failed',
    at: tl.assetsTestRun,
    projectId: PROJECT.lumen,
    agentId: AGENT.muse,
    workflowId: WORKFLOW.assets,
    origin: ref('workflow', WORKFLOW.assets),
    initiator: ME,
    modelId: 'sim-swift',
    error,
    steps: [
      {
        kind: 'tool', title: 'Started manually', tool: 'manual', nodeId: ASSETS.trigger,
        input: 'brief: Lumen launch key visuals · board: Lumen launch visuals', ms: 300,
      },
      {
        kind: 'generate', title: 'Generated 9 variants (3 formats × 3)', tool: 'image-gen', capability: 'media.generate', integrationId: 'image-gen',
        nodeId: ASSETS.generate, refs: [ref('board', BOARD.launch), ref('knowledge', KNOWLEDGE.brandVoice)],
        output: '1200×628: 3 · 1080×1080: 3 · 1080×1920: 3 (procedural previews)', ms: 16_000, tokens: 4_200,
      },
      {
        kind: 'approval', title: 'Review assets', nodeId: ASSETS.approve, ms: 300,
        approval: {
          title: 'Upload 9 launch assets to Drive',
          description: 'Muse generated the launch set. Approve to upload it to the shared Drive folder.',
          capability: 'files.write', risk: 'medium', requestedBy: wf(WORKFLOW.assets),
          preview: { kind: 'text', label: 'Marketing / Lumen launch / Assets', content: files.join('\n') },
          decision: 'approved', note: 'Looks good, upload them.', waitMs: 9 * MIN,
        },
      },
      {
        kind: 'tool', title: 'Upload to Drive', tool: 'google-drive', capability: 'files.write', integrationId: 'google-drive',
        nodeId: ASSETS.upload, input: 'Marketing / Lumen launch / Assets', ms: 2_400, status: 'failed', error,
      },
    ],
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function workflowRunSpecs(tl: Timeline, story: Story): RunSpec[] {
  const [d1 = 0, d2 = 0, d3 = 0, d4 = 0] = tl.digestMondays
  const lumenBetaClaim: Headline = { at: d3 - DAY, section: 'lumen', text: 'Lumen beta: 14 active accounts, up 5 week over week.' }
  return [
    ...story.supportEmails.map(triageRun),
    digestRun(tl, story, 1, d4, {
      decision: 'approved', waitMin: 18,
      calendar: 'Weekly product sync (Tue 10:00) · Customer call: Meridian Freight (Wed 15:00) · Sprint planning (Thu 11:00)',
    }),
    digestRun(tl, story, 2, d3, {
      decision: 'rejected', waitMin: 41, extra: [lumenBetaClaim],
      note: 'Hold this one: the Lumen beta numbers are from the previous week’s snapshot. I’ll post a corrected update myself.',
      calendar: 'Weekly product sync (Tue 10:00) · Lumen pricing review (Wed 14:00)',
    }),
    digestRun(tl, story, 3, d2, {
      decision: 'approved', waitMin: 12, note: 'Ship it.',
      calendar: 'Weekly product sync (Tue 10:00) · Sprint retro (Thu 16:00) · Lumen launch review (Fri 11:00)',
    }),
    digestRun(tl, story, 4, d1, {
      decision: 'approved', waitMin: 9,
      calendar: 'Weekly product sync (Tue 10:00) · Lumen launch review (Thu 15:00) · Board deck dry run (Fri 09:30)',
    }),
    ...story.pullRequests.map(prReviewRun),
    ...story.radarWeeks.map(radarRun),
    assetsTestRun(tl),
  ]
}
