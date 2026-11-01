import type { Workflow, WorkflowEdge, WorkflowNode } from '@/core/types'
import { AGENT, BOARD, COLLECTION, KNOWLEDGE, PROJECT, WORKFLOW } from '../ids'
import type { Clock } from './time'

/** Layout grid: columns every 280px left → right, lanes every 150px. */
const X = 280
const Y = 150
const pos = (col: number, lane = 0) => ({ x: col * X, y: lane * Y })

export const TRIAGE = {
  trigger: 'triage-trigger',
  enrich: 'triage-enrich',
  classify: 'triage-classify',
  urgent: 'triage-urgent',
  alert: 'triage-alert',
  issue: 'triage-issue',
  log: 'triage-log',
} as const

export const DIGEST = {
  trigger: 'digest-trigger',
  collect: 'digest-collect',
  calendar: 'digest-calendar',
  summarize: 'digest-summarize',
  approve: 'digest-approve',
  post: 'digest-post',
  log: 'digest-log',
} as const

export const PR_REVIEW = {
  trigger: 'pr-trigger',
  fetch: 'pr-fetch',
  size: 'pr-size',
  review: 'pr-review',
  approve: 'pr-approve',
  post: 'pr-post',
  split: 'pr-split',
} as const

export const RADAR = {
  trigger: 'radar-trigger',
  scan: 'radar-scan',
  score: 'radar-score',
  notable: 'radar-notable',
  update: 'radar-update',
  notify: 'radar-notify',
  quiet: 'radar-quiet',
} as const

export const ASSETS = {
  trigger: 'assets-trigger',
  generate: 'assets-generate',
  approve: 'assets-approve',
  upload: 'assets-upload',
  share: 'assets-share',
} as const

const edge = (id: string, source: string, target: string, branch?: { handle: 'true' | 'false'; label: string }): WorkflowEdge =>
  branch ? { id, source, target, sourceHandle: branch.handle, label: branch.label } : { id, source, target }

/** Connect nodes in a straight line: a → b → c. */
const chain = (prefix: string, ids: string[]): WorkflowEdge[] =>
  ids.slice(1).map((target, i) => edge(`${prefix}-e${i + 1}`, ids[i] ?? '', target))

function triage(clock: Clock): Workflow {
  const nodes: WorkflowNode[] = [
    {
      id: TRIAGE.trigger,
      type: 'trigger',
      label: 'New email to support@',
      position: pos(0),
      integrationId: 'gmail',
      capability: 'files.read',
      config: { event: 'gmail.message.received', mailbox: 'support@northwind.example', filter: 'to:support@northwind.example -label:auto-reply' },
    },
    {
      id: TRIAGE.enrich,
      type: 'transform',
      label: 'Look up account & SLA',
      position: pos(1),
      capability: 'knowledge.read',
      config: {
        lookup: 'sender domain → account',
        knowledgeIds: [KNOWLEDGE.csvAccounts, KNOWLEDGE.slaPolicy],
        output: 'account',
      },
    },
    {
      id: TRIAGE.classify,
      type: 'agent',
      label: 'Classify & summarize',
      position: pos(2),
      agentId: AGENT.sentinel,
      capability: 'knowledge.read',
      config: {
        prompt:
          'Classify this support email with the Support triage rubric v2. Return priority (urgent | high | medium | low), category, the affected account and a two-sentence summary that quotes the customer. Outages, data not syncing and login failures for more than one user are urgent.',
        knowledgeIds: [KNOWLEDGE.triageRubric],
        output: { kind: 'json', fields: ['priority', 'category', 'account', 'summary'] },
      },
    },
    {
      id: TRIAGE.urgent,
      type: 'condition',
      label: 'Urgent?',
      position: pos(3),
      config: { expression: 'priority == "urgent"' },
    },
    {
      id: TRIAGE.alert,
      type: 'action',
      label: 'Alert #support-urgent',
      position: pos(4, 0),
      integrationId: 'slack',
      capability: 'messages.send',
      config: {
        channel: '#support-urgent',
        message: ':rotating_light: {{account}} ({{plan}}): {{summary}}\nSLA: {{sla.tier}} · urgent',
      },
    },
    {
      id: TRIAGE.issue,
      type: 'action',
      label: 'Create Linear issue',
      position: pos(4, 1),
      integrationId: 'linear',
      capability: 'tasks.manage',
      config: { team: 'SUP', title: '{{subject}}', priority: '{{priority}}', labels: ['{{category}}', 'triage-bot'] },
    },
    {
      id: TRIAGE.log,
      type: 'output',
      label: 'Log triage decision',
      position: pos(5),
      config: { output: 'activity', fields: ['priority', 'category', 'account'] },
    },
  ]
  const edges = [
    ...chain('triage', [TRIAGE.trigger, TRIAGE.enrich, TRIAGE.classify, TRIAGE.urgent]),
    edge('triage-e4', TRIAGE.urgent, TRIAGE.alert, { handle: 'true', label: 'Urgent' }),
    edge('triage-e5', TRIAGE.urgent, TRIAGE.issue, { handle: 'false', label: 'Not urgent' }),
    edge('triage-e6', TRIAGE.alert, TRIAGE.log),
    edge('triage-e7', TRIAGE.issue, TRIAGE.log),
  ]
  return {
    id: WORKFLOW.triage,
    name: 'Support triage',
    description:
      'Every email to support@ is matched to its account, classified by Sentinel with the triage rubric, and either alerted to #support-urgent or filed as a Linear issue.',
    projectId: PROJECT.ops,
    hue: 'mint',
    trigger: { type: 'event', label: 'New email to support@', event: 'gmail.message.received', integrationId: 'gmail' },
    nodes,
    edges,
    enabled: true,
    version: 4,
    createdAt: clock.day(38, 14, 20),
    updatedAt: clock.wd(12, 16, 45),
  }
}

function digest(clock: Clock): Workflow {
  const nodes: WorkflowNode[] = [
    {
      id: DIGEST.trigger,
      type: 'trigger',
      label: 'Mondays at 09:00',
      position: pos(0),
      config: { cron: '0 9 * * 1', timezone: 'local' },
    },
    {
      id: DIGEST.collect,
      type: 'transform',
      label: 'Collect last week’s activity',
      position: pos(1, 0),
      capability: 'tasks.manage',
      config: { window: '7d', include: ['tasks', 'runs', 'sessions', 'knowledge', 'support volume'], projects: 'all active', readOnly: true },
    },
    {
      id: DIGEST.calendar,
      type: 'transform',
      label: 'Upcoming milestones & meetings',
      position: pos(1, 1),
      integrationId: 'google-calendar',
      capability: 'calendar.manage',
      config: { calendar: 'Product team', lookaheadDays: 7, readOnly: true },
    },
    {
      id: DIGEST.summarize,
      type: 'agent',
      label: 'Write the digest',
      position: pos(2),
      agentId: AGENT.herald,
      capability: 'knowledge.read',
      config: {
        prompt:
          'Write the weekly product digest for #product. Lead with decisions needed, then one section per active project with at most three bullets each, every bullet with an owner or a link. Plain and specific, under 250 words.',
        output: { kind: 'message' },
      },
    },
    {
      id: DIGEST.approve,
      type: 'approval',
      label: 'Review before posting',
      position: pos(3),
      capability: 'messages.send',
      config: { approver: 'Morgan Lee', timeoutHours: 4, onTimeout: 'skip' },
    },
    {
      id: DIGEST.post,
      type: 'action',
      label: 'Post to #product',
      position: pos(4),
      integrationId: 'slack',
      capability: 'messages.send',
      config: { channel: '#product', unfurlLinks: false },
    },
    {
      id: DIGEST.log,
      type: 'output',
      label: 'Log & notify',
      position: pos(5),
      config: { output: 'notification', title: 'Weekly digest posted to #product' },
    },
  ]
  const edges = [
    edge('digest-e1', DIGEST.trigger, DIGEST.collect),
    edge('digest-e2', DIGEST.trigger, DIGEST.calendar),
    edge('digest-e3', DIGEST.collect, DIGEST.summarize),
    edge('digest-e4', DIGEST.calendar, DIGEST.summarize),
    ...chain('digest-p', [DIGEST.summarize, DIGEST.approve, DIGEST.post, DIGEST.log]),
  ]
  return {
    id: WORKFLOW.digest,
    name: 'Weekly project digest',
    description:
      'Every Monday at 09:00 Herald summarizes last week across all active projects; you review the draft before it is posted to #product.',
    projectId: PROJECT.ops,
    hue: 'amber',
    trigger: { type: 'schedule', label: 'Mondays at 09:00', cron: '0 9 * * 1' },
    nodes,
    edges,
    enabled: true,
    version: 2,
    createdAt: clock.day(36, 11, 0),
    updatedAt: clock.day(29, 9, 50),
  }
}

function prReview(clock: Clock): Workflow {
  const nodes: WorkflowNode[] = [
    {
      id: PR_REVIEW.trigger,
      type: 'trigger',
      label: 'Pull request opened',
      position: pos(0),
      integrationId: 'github',
      config: { event: 'github.pull_request.opened', repo: 'northwind/atlas-portal', ignoreDrafts: true },
    },
    {
      id: PR_REVIEW.fetch,
      type: 'transform',
      label: 'Fetch diff & checks',
      position: pos(1),
      integrationId: 'github',
      capability: 'repo.read',
      config: { include: ['diff', 'checks', 'linked issues'] },
    },
    {
      id: PR_REVIEW.size,
      type: 'condition',
      label: 'Reviewable size?',
      position: pos(2),
      config: { expression: 'diff.changedLines <= 600' },
    },
    {
      id: PR_REVIEW.review,
      type: 'agent',
      label: 'Review the change',
      position: pos(3, 0),
      agentId: AGENT.forge,
      capability: 'repo.read',
      config: {
        prompt:
          'Review this pull request against the Engineering handbook: code review. Lead with correctness bugs, missing tests and risky migrations; mention style only when it is cheap to fix. For every comment give file, line, why it matters and a suggested fix.',
        knowledgeIds: [KNOWLEDGE.codeReview],
        output: { kind: 'review' },
      },
    },
    {
      id: PR_REVIEW.approve,
      type: 'approval',
      label: 'Approve review comments',
      position: pos(4, 0),
      capability: 'repo.pull_request',
      config: { approver: 'Morgan Lee', timeoutHours: 24 },
    },
    {
      id: PR_REVIEW.post,
      type: 'action',
      label: 'Post review on GitHub',
      position: pos(5, 0),
      integrationId: 'github',
      capability: 'repo.pull_request',
      config: { event: 'COMMENT', includeSummary: true },
    },
    {
      id: PR_REVIEW.split,
      type: 'action',
      label: 'Ask author to split',
      position: pos(3, 1),
      integrationId: 'github',
      capability: 'repo.pull_request',
      config: {
        comment:
          'This PR changes {{diff.changedLines}} lines. Could you split it so each part can be reviewed in under 30 minutes? Suggested split: {{suggestedSplit}}',
      },
    },
  ]
  const edges = [
    ...chain('pr', [PR_REVIEW.trigger, PR_REVIEW.fetch, PR_REVIEW.size]),
    edge('pr-e3', PR_REVIEW.size, PR_REVIEW.review, { handle: 'true', label: 'Reviewable' }),
    edge('pr-e4', PR_REVIEW.size, PR_REVIEW.split, { handle: 'false', label: 'Too large' }),
    edge('pr-e5', PR_REVIEW.review, PR_REVIEW.approve),
    edge('pr-e6', PR_REVIEW.approve, PR_REVIEW.post),
  ]
  return {
    id: WORKFLOW.prReview,
    name: 'PR review assistant',
    description:
      'When a pull request opens on atlas-portal, Forge reviews the diff against the code review handbook. You approve the comments before they are posted; oversized PRs get a polite request to split.',
    projectId: PROJECT.atlas,
    hue: 'sky',
    trigger: { type: 'event', label: 'Pull request opened', event: 'github.pull_request.opened', integrationId: 'github' },
    nodes,
    edges,
    enabled: true,
    version: 3,
    createdAt: clock.day(30, 15, 40),
    updatedAt: clock.wd(9, 11, 5),
  }
}

function radar(clock: Clock): Workflow {
  const nodes: WorkflowNode[] = [
    {
      id: RADAR.trigger,
      type: 'trigger',
      label: 'Mondays at 08:00',
      position: pos(0),
      config: { cron: '0 8 * * 1', timezone: 'local' },
    },
    {
      id: RADAR.scan,
      type: 'agent',
      label: 'Scan competitor news',
      position: pos(1),
      agentId: AGENT.scout,
      integrationId: 'web-search',
      capability: 'web.search',
      config: {
        prompt:
          'Find announcements from Portbase, Freightly and ShipLoom in the last 7 days: pricing changes, launches, funding, partnerships and hiring signals. Prefer primary sources and link every item.',
        competitors: ['Portbase', 'Freightly', 'ShipLoom'],
        sinceDays: 7,
      },
    },
    {
      id: RADAR.score,
      type: 'transform',
      label: 'Dedupe & score relevance',
      position: pos(2),
      config: { minRelevance: 0.6, dedupeAgainst: COLLECTION.research },
    },
    {
      id: RADAR.notable,
      type: 'condition',
      label: 'Anything notable?',
      position: pos(3),
      config: { expression: 'items.length > 0' },
    },
    {
      id: RADAR.update,
      type: 'action',
      label: 'Update competitor notes',
      position: pos(4, 0),
      capability: 'knowledge.write',
      config: { mode: 'append', targets: { Portbase: KNOWLEDGE.portbaseTeardown, Freightly: KNOWLEDGE.freightlyNotes } },
    },
    {
      id: RADAR.notify,
      type: 'output',
      label: 'Notify me',
      position: pos(5, 0),
      config: { output: 'notification', title: 'Competitor radar: {{items.length}} updates' },
    },
    {
      id: RADAR.quiet,
      type: 'output',
      label: 'Log a quiet week',
      position: pos(4, 1),
      config: { output: 'activity' },
    },
  ]
  const edges = [
    ...chain('radar', [RADAR.trigger, RADAR.scan, RADAR.score, RADAR.notable]),
    edge('radar-e4', RADAR.notable, RADAR.update, { handle: 'true', label: 'Yes' }),
    edge('radar-e5', RADAR.notable, RADAR.quiet, { handle: 'false', label: 'Quiet week' }),
    edge('radar-e6', RADAR.update, RADAR.notify),
  ]
  return {
    id: WORKFLOW.radar,
    name: 'Competitor radar',
    description:
      'Every Monday at 08:00 Scout scans the week’s news on Portbase, Freightly and ShipLoom, keeps what is relevant and appends it to the competitor notes in Knowledge.',
    projectId: PROJECT.landscape,
    hue: 'violet',
    trigger: { type: 'schedule', label: 'Mondays at 08:00', cron: '0 8 * * 1' },
    nodes,
    edges,
    enabled: true,
    version: 2,
    createdAt: clock.day(29, 17, 15),
    updatedAt: clock.day(22, 10, 40),
  }
}

function assets(clock: Clock): Workflow {
  const nodes: WorkflowNode[] = [
    {
      id: ASSETS.trigger,
      type: 'trigger',
      label: 'Run manually',
      position: pos(0),
      config: { inputs: ['brief', 'boardId'] },
    },
    {
      id: ASSETS.generate,
      type: 'agent',
      label: 'Generate launch variants',
      position: pos(1),
      agentId: AGENT.muse,
      integrationId: 'image-gen',
      capability: 'media.generate',
      config: {
        formats: ['1200×628 (LinkedIn)', '1080×1080 (feed)', '1080×1920 (stories)'],
        variantsPerFormat: 3,
        boardId: BOARD.launch,
        styleGuide: KNOWLEDGE.brandVoice,
      },
    },
    {
      id: ASSETS.approve,
      type: 'approval',
      label: 'Review assets',
      position: pos(2),
      capability: 'files.write',
      config: { approver: 'Morgan Lee' },
    },
    {
      id: ASSETS.upload,
      type: 'action',
      label: 'Upload to Drive',
      position: pos(3),
      integrationId: 'google-drive',
      capability: 'files.write',
      config: { folder: 'Marketing / Lumen launch / Assets', naming: 'lumen-{{format}}-v{{n}}' },
    },
    {
      id: ASSETS.share,
      type: 'action',
      label: 'Share in #lumen-launch',
      position: pos(4),
      integrationId: 'slack',
      capability: 'messages.send',
      config: { channel: '#lumen-launch', message: 'New launch assets are ready for review in Drive: {{folderUrl}}' },
    },
  ]
  return {
    id: WORKFLOW.assets,
    name: 'Launch asset pipeline',
    description:
      'Muse generates launch visuals in every social format, you review them, and the approved set is uploaded to Drive and shared in #lumen-launch. Disabled until the Drive folder is shared with the integration.',
    projectId: PROJECT.lumen,
    hue: 'rose',
    trigger: { type: 'manual', label: 'Run manually' },
    nodes,
    edges: chain('assets', [ASSETS.trigger, ASSETS.generate, ASSETS.approve, ASSETS.upload, ASSETS.share]),
    enabled: false,
    version: 1,
    createdAt: clock.wd(13, 16, 30),
    updatedAt: clock.wd(11, 10, 5),
  }
}

export function buildWorkflows(clock: Clock): Workflow[] {
  return [triage(clock), digest(clock), prReview(clock), radar(clock), assets(clock)]
}
