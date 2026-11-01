import type { ActorRef } from '@/core/types'
import { AGENT, KNOWLEDGE, PROJECT, SESSION, TASK, THREAD } from '../../ids'
import type { RunSpec, StepSpec } from '../runKit'
import type { Story } from '../story'
import { DAY, MIN } from '../time'
import type { Timeline } from '../timeline'
import { ref } from '../util'

const ME: ActorRef = { type: 'user', id: 'usr_me' }
const k = (id: string) => ref('knowledge', id)

function scoutRuns(tl: Timeline): RunSpec[] {
  const scout = { kind: 'agent' as const, agentId: AGENT.scout, modelId: 'sim-deep', initiator: ME }
  return [
    {
      ...scout,
      id: 'run_seed_agent_scout_1',
      title: 'Refresh market sizing for mid-market freight portals',
      status: 'succeeded',
      at: tl.scoutSizing,
      projectId: PROJECT.landscape,
      outputs: [k(KNOWLEDGE.marketSizing)],
      summary: 'Market sizing refreshed: bottom-up and top-down estimates now agree within 20%. Method, ranges and caveats are updated in Knowledge.',
      steps: [
        {
          kind: 'plan', title: 'Planned the sizing approach', ms: 3_200, tokens: 1_900,
          output: 'Bottom-up: mid-market forwarders and shippers (50–500 employees) in the EU and North America × portal adoption × ACV.\nTop-down: cross-check against published analyst ranges.\nReport ranges, not points.',
        },
        { kind: 'read', title: 'Read the current sizing note', tool: 'knowledge.search', capability: 'knowledge.read', refs: [k(KNOWLEDGE.marketSizing)], ms: 1_800, tokens: 3_300 },
        {
          kind: 'search', title: 'Searched: mid-market freight forwarders by region', tool: 'web.search', capability: 'web.search', integrationId: 'web-search',
          input: 'number of freight forwarders 50-500 employees EU North America', output: '16 results · kept 5 (simulated web corpus)', ms: 5_600, tokens: 4_100,
        },
        {
          kind: 'browse', title: 'Read 5 sources', tool: 'web.browse', capability: 'web.browse', integrationId: 'web-search', ms: 26_000, tokens: 18_200,
          output: 'Two trade-association member directories, two analyst summaries and a customs-broker census. One vendor report kept as weak evidence.',
        },
        {
          kind: 'think', title: 'Reconciled bottom-up and top-down', ms: 6_400, tokens: 5_200,
          output: 'The gap shrinks from 45% to under 20% once 3PL subsidiaries counted twice in the directories are de-duplicated.',
        },
        {
          kind: 'write', title: 'Updated “Market sizing: mid-market freight portals”', capability: 'knowledge.write', refs: [k(KNOWLEDGE.marketSizing)],
          output: 'Updated the estimate ranges, the method section and confidence; added the de-duplication caveat.', ms: 5_200, tokens: 6_100,
        },
      ],
    },
    {
      ...scout,
      id: 'run_seed_agent_scout_2',
      title: 'Track Freightly pricing page changes',
      status: 'cancelled',
      at: tl.scoutFreightly,
      projectId: PROJECT.landscape,
      error: 'Cancelled by you: the weekly Competitor radar covers this now.',
      steps: [
        { kind: 'plan', title: 'Planned a daily diff of the Freightly pricing page', ms: 2_100, tokens: 1_200 },
        {
          kind: 'browse', title: 'Captured today’s pricing page', tool: 'web.browse', capability: 'web.browse', integrationId: 'web-search',
          output: 'Three public tiers; enterprise is “contact sales”.', ms: 7_800, tokens: 5_400,
        },
        {
          kind: 'think', title: 'Compared with the notes in Knowledge', refs: [k(KNOWLEDGE.freightlyNotes)], ms: 2_600, tokens: 2_300,
          output: 'No change since the pricing recorded in “Freightly product notes”.',
        },
      ],
    },
    {
      ...scout,
      id: 'run_seed_agent_scout_3',
      title: 'Draft competitor brief for the board deck',
      status: 'succeeded',
      at: tl.scoutBrief,
      projectId: PROJECT.landscape,
      origin: ref('task', TASK.competitorBrief),
      summary:
        'One-page brief drafted: Portbase leads on enterprise customs workflows, Freightly is moving upmarket in the EU, and Atlas wins on invoicing and self-serve. Ready for your edits on the task.',
      steps: [
        {
          kind: 'plan', title: 'Outlined a one-page brief', ms: 2_600, tokens: 1_700,
          output: '1. Where each competitor wins\n2. Pricing and packaging side by side\n3. Moves in the last 90 days\n4. Where Atlas is exposed\n5. What we do next',
        },
        {
          kind: 'read', title: 'Read the Portbase teardown, Freightly notes and market sizing', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [k(KNOWLEDGE.portbaseTeardown), k(KNOWLEDGE.freightlyNotes), k(KNOWLEDGE.marketSizing)], ms: 4_200, tokens: 9_800,
        },
        {
          kind: 'search', title: 'Checked for news since the teardown', tool: 'web.search', capability: 'web.search', integrationId: 'web-search',
          output: '9 results · 2 new: Portbase’s usage-based Insights tier, Freightly carbon reporting.', ms: 5_100, tokens: 3_900,
        },
        { kind: 'think', title: 'Compared positioning and pricing', ms: 7_300, tokens: 6_200 },
        {
          kind: 'write', title: 'Drafted the brief', ms: 9_600, tokens: 8_800,
          output:
            'Portbase sells annual, per-site contracts to enterprise shippers and is strongest on customs. Freightly is hiring enterprise sellers in the EU and adding sustainability features. Atlas wins mid-market deals on invoicing and self-serve onboarding, and is exposed on analytics until Lumen ships.',
        },
      ],
    },
    {
      ...scout,
      id: 'run_seed_agent_scout_4',
      title: 'Competitor brief: add ShipLoom and tighten positioning',
      status: 'succeeded',
      at: tl.scoutBriefRevision,
      projectId: PROJECT.landscape,
      origin: ref('task', TASK.competitorBrief),
      summary: 'Brief revised: ShipLoom added (EDI marketplace, e-invoicing next quarter), the history section cut and the exposure section made blunter. Now 410 words.',
      steps: [
        {
          kind: 'read', title: 'Read your comments on the draft', tool: 'workspace', refs: [ref('task', TASK.competitorBrief)], ms: 1_200, tokens: 2_100,
          output: 'Add ShipLoom · cut the history section · make “where we are exposed” blunter.',
        },
        {
          kind: 'search', title: 'Searched ShipLoom launches and pricing', tool: 'web.search', capability: 'web.search', integrationId: 'web-search',
          output: '12 results · kept 4 (simulated web corpus)', ms: 5_400, tokens: 4_200,
        },
        { kind: 'browse', title: 'Read 4 sources on ShipLoom', tool: 'web.browse', capability: 'web.browse', integrationId: 'web-search', ms: 19_000, tokens: 13_600 },
        { kind: 'write', title: 'Revised the brief', ms: 8_100, tokens: 7_400 },
      ],
    },
  ]
}

function heraldRuns(tl: Timeline): RunSpec[] {
  const herald = { kind: 'agent' as const, agentId: AGENT.herald, modelId: 'sim-swift', initiator: ME, projectId: PROJECT.atlas }
  const retroUpdate = [
    '*Sprint 14 retro: what we’re changing*',
    '• Keep: pairing on risky changes, and the PR review assistant’s first pass.',
    '• Change: no PRs over 600 changed lines; flaky tests get a ticket the same day.',
    '• Try: one meeting-free morning a week for deep work.',
    'Owners are on the tasks. Thanks, everyone.',
  ].join('\n')
  return [
    {
      ...herald,
      id: 'run_seed_agent_herald_1',
      title: 'Draft release notes for Atlas 2.3',
      status: 'succeeded',
      at: tl.heraldReleaseNotes,
      summary: 'Release notes for Atlas 2.3 drafted: faster dashboard, status filter, ETAs in destination time and more resilient connections. Not posted; ready for you to publish.',
      steps: [
        {
          kind: 'read', title: 'Collected work merged since 2.2', tool: 'workspace', refs: [ref('session', SESSION.bundle)], ms: 2_300, tokens: 3_100,
          output: '#208 shipments status filter · #209 retries with backoff · #211 ETAs in destination time (SUP-401) · #214 dashboard bundle −62%',
        },
        { kind: 'read', title: 'Read the brand voice guide', tool: 'knowledge.search', capability: 'knowledge.read', refs: [k(KNOWLEDGE.brandVoice)], ms: 1_400, tokens: 2_600 },
        {
          kind: 'write', title: 'Drafted release notes', ms: 6_200, tokens: 5_900,
          output: [
            'Atlas 2.3',
            '• Faster dashboard: the first screen loads about 60% less JavaScript, so it’s ready sooner on everyday laptops.',
            '• Filter shipments by status, right from the shipments table.',
            '• ETAs show in the destination’s local time, so overnight arrivals land on the right day.',
            '• Steadier connections: the portal retries briefly when our API is busy instead of showing an error.',
          ].join('\n'),
        },
      ],
    },
    {
      ...herald,
      id: 'run_seed_agent_herald_2',
      title: 'Share the Sprint 14 retro summary in #eng',
      status: 'succeeded',
      at: tl.heraldRetro,
      origin: ref('thread', THREAD.retro),
      summary: 'Retro summary posted to #eng after your approval.',
      steps: [
        { kind: 'read', title: 'Read the retro conversation', tool: 'workspace', refs: [ref('thread', THREAD.retro)], ms: 1_600, tokens: 4_800 },
        { kind: 'write', title: 'Drafted the update', output: retroUpdate, ms: 4_400, tokens: 3_900 },
        {
          kind: 'message', title: 'Posted to #eng', tool: 'slack', capability: 'messages.send', integrationId: 'slack', input: '#eng',
          output: 'Posted (62 words).', ms: 800, tokens: 250,
          approval: {
            title: 'Post the Sprint 14 retro summary to #eng',
            description: 'Herald summarized the retro conversation for the engineering channel.',
            capability: 'messages.send', risk: 'high', requestedBy: { type: 'agent', id: AGENT.herald },
            preview: { kind: 'message', label: '#eng', content: retroUpdate },
            decision: 'approved', waitMs: 7 * MIN,
          },
        },
      ],
    },
  ]
}

function sentinelRuns(tl: Timeline, story: Story): RunSpec[] {
  const sentinel = { kind: 'agent' as const, agentId: AGENT.sentinel, modelId: 'sim-swift', initiator: ME, projectId: PROJECT.ops }
  const week = story.supportEmails.filter((e) => !e.failure && e.at < tl.sentinelWeekly && e.at >= tl.sentinelWeekly - 7 * DAY)
  const weekLines = week.length
    ? week.map((e) => `• ${e.priority.toUpperCase()} · ${e.account} · ${e.subject}${e.issue ? ` (${e.issue})` : ''}`).join('\n')
    : '• No new support email this week.'
  return [
    {
      ...sentinel,
      id: 'run_seed_agent_sentinel_1',
      title: 'Draft triage rubric v2 from last month’s tickets',
      status: 'succeeded',
      at: tl.sentinelRubric,
      origin: ref('task', TASK.triageRubric),
      outputs: [k(KNOWLEDGE.triageRubric)],
      summary:
        'Rubric v2 drafted: login failures for more than one user and account-wide invoice errors are now urgent, with an example for every priority. Assigned to you for review.',
      steps: [
        {
          kind: 'read', title: 'Read 41 resolved SUP issues from the last 60 days', tool: 'linear', capability: 'tasks.manage', integrationId: 'linear',
          ms: 6_800, tokens: 21_400, output: 'Pulled title, first customer message, final priority and time to resolution for each issue.',
        },
        {
          kind: 'read', title: 'Read the SLA policy and the rubric discussion', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [k(KNOWLEDGE.slaPolicy), ref('thread', THREAD.triage)], ms: 2_200, tokens: 5_600,
        },
        {
          kind: 'think', title: 'Found 7 issues the current rubric under-prioritized', ms: 7_900, tokens: 6_800,
          output: 'Login failures affecting several users were filed as high; two invoice errors that hit every invoice on an account were filed as medium.',
        },
        {
          kind: 'write', title: 'Drafted “Support triage rubric v2”', capability: 'knowledge.write', refs: [k(KNOWLEDGE.triageRubric)], ms: 8_800, tokens: 7_900,
          output: 'Four priorities with definitions, two real examples each, and tie-break rules (choose the higher priority and say why).',
        },
        {
          kind: 'tool', title: 'Assigned the review to you', tool: 'tasks', capability: 'tasks.manage', refs: [ref('task', TASK.triageRubric)], ms: 400,
          output: 'Moved “Finalize triage rubric v2” to Review and assigned it to you.',
        },
      ],
    },
    {
      ...sentinel,
      id: 'run_seed_agent_sentinel_2',
      title: 'Weekly support summary',
      status: 'succeeded',
      at: tl.sentinelWeekly,
      summary: `${week.length} support emails triaged this week; nothing waiting on a first response.`,
      steps: [
        { kind: 'read', title: 'Read this week’s SUP issues', tool: 'linear', capability: 'tasks.manage', integrationId: 'linear', ms: 2_900, tokens: 6_300 },
        { kind: 'think', title: 'Grouped by priority, category and account', ms: 3_100, tokens: 2_700 },
        { kind: 'write', title: 'Wrote the summary', output: weekLines, ms: 3_700, tokens: 3_200 },
      ],
    },
    {
      ...sentinel,
      id: 'run_seed_agent_sentinel_3',
      title: 'Escalation summary: Meridian Freight shipments not syncing',
      status: 'succeeded',
      at: tl.sentinelEscalation,
      summary: 'Escalation summary filed as SUP-419 with timeline, impact and next update time.',
      steps: [
        {
          kind: 'read', title: 'Read the urgent email and the alert thread', tool: 'gmail', capability: 'files.read', integrationId: 'gmail',
          ms: 1_800, tokens: 3_400,
        },
        {
          kind: 'write', title: 'Wrote the escalation summary', ms: 6_900, tokens: 6_100,
          output: [
            'Impact: Meridian Freight ocean shipments stopped updating at ~05:00 UTC; the dashboard showed stale positions for about 3 hours.',
            'Timeline: 06:52 customer email · alert in #support-urgent after approval · carrier feed reconnected by on-call.',
            'Suspected cause: the carrier rotated API credentials without notice.',
            'Next: on-call adds an alert when a carrier feed is silent for 30 minutes.',
          ].join('\n'),
        },
        {
          kind: 'tool', title: 'Created Linear issue SUP-419', tool: 'linear', capability: 'tasks.manage', integrationId: 'linear', ms: 1_100, tokens: 400,
          output: 'SUP-419 · Urgent · “Meridian Freight: ocean shipments not syncing” · labels: sync-outage, escalation',
        },
      ],
    },
  ]
}

function museRuns(tl: Timeline): RunSpec[] {
  const muse = { kind: 'agent' as const, agentId: AGENT.muse, modelId: 'sim-swift', initiator: ME, projectId: PROJECT.lumen }
  const brandRefs = [k(KNOWLEDGE.messagingHouse), k(KNOWLEDGE.brandVoice)]
  return [
    {
      ...muse,
      id: 'run_seed_agent_muse_1',
      title: 'Hero copy in brand voice: 6 variations',
      status: 'succeeded',
      at: tl.museHeroCopy,
      origin: ref('thread', THREAD.heroCopy),
      summary: 'Six headline and subline pairs ready. #3 and #4 follow the messaging house most closely.',
      steps: [
        { kind: 'read', title: 'Read the messaging house and brand voice guide', tool: 'knowledge.search', capability: 'knowledge.read', refs: brandRefs, ms: 1_900, tokens: 6_400 },
        {
          kind: 'write', title: 'Wrote 6 headline + subline pairs', ms: 6_800, tokens: 5_300,
          output: [
            '1. See where every shipment’s time goes. / Lumen turns your Atlas data into lane-by-lane answers.',
            '2. Your operation, measured. / On-time rates, dwell times and costs by lane, carrier and customer.',
            '3. From tracking to knowing. / Atlas shows where shipments are. Lumen shows why they’re late.',
            '4. Fewer surprises at the dock. / Spot slipping lanes a week before your customers do.',
            '5. Every lane. Every carrier. One answer. / Benchmarks your team can act on Monday morning.',
            '6. Analytics your ops team will actually open. / Built into Atlas. No exports, no spreadsheets.',
          ].join('\n'),
        },
        {
          kind: 'think', title: 'Checked every line against the voice guide', ms: 2_600, tokens: 2_100,
          output: 'Cut two clichés (“unlock”, “seamless”). Every line now names a concrete outcome.',
        },
      ],
    },
    {
      ...muse,
      id: 'run_seed_agent_muse_2',
      title: 'Storyboard beats for the launch hero video',
      status: 'succeeded',
      at: tl.museBeats,
      origin: ref('task', TASK.heroVideo),
      summary: 'Six beats for a 45-second hero video. Storyboard frames are next.',
      steps: [
        {
          kind: 'read', title: 'Read the messaging house, voice guide and launch checklist', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [...brandRefs, k(KNOWLEDGE.launchChecklist)], ms: 2_200, tokens: 7_900,
        },
        {
          kind: 'plan', title: 'Outlined a 45-second structure', ms: 4_900, tokens: 4_400,
          output: [
            '1. Cold open (0–5 s): a dispatcher at 6 a.m., three screens, one late container.',
            '2. The question (5–12 s): “Why is Rotterdam → Chicago late again?”',
            '3. Lumen appears (12–22 s): the lane view, dwell time highlighted.',
            '4. The answer (22–32 s): carriers compared, a better routing chosen.',
            '5. Outcome (32–40 s): the lane’s on-time rate climbing over four weeks.',
            '6. Close (40–45 s): “Atlas Lumen. From tracking to knowing.”',
          ].join('\n'),
        },
        { kind: 'write', title: 'Wrote the beat sheet with shot notes', ms: 5_600, tokens: 5_100 },
      ],
    },
  ]
}

const PAYMENTS_QUERY = [
  'select charge_id, amount, currency, status, created_at, description',
  'from billing.charges',
  "where account_name = 'Coastal Cargo' and created_at >= current_date",
  'order by created_at;',
].join('\n')

function ledgerRuns(tl: Timeline): RunSpec[] {
  const ledger = { kind: 'agent' as const, agentId: AGENT.ledger, modelId: 'sim-swift', initiator: ME, projectId: null }
  const pg = { tool: 'postgres', capability: 'data.query' as const, integrationId: 'postgres' }
  return [
    {
      ...ledger,
      id: 'run_seed_agent_ledger_1',
      title: 'Weekly revenue snapshot',
      status: 'succeeded',
      at: tl.ledgerSnapshot,
      summary: 'Net new MRR is up 4.1% week over week; expansion is concentrated in three accounts. No week outside 2σ.',
      steps: [
        {
          kind: 'tool', title: 'Queried new, expansion and churned MRR (8 weeks)', ...pg, ms: 4_200, tokens: 2_600,
          input: [
            "select date_trunc('week', occurred_at) as week, kind, sum(mrr_delta) as mrr",
            'from billing.mrr_events',
            "where occurred_at >= now() - interval '8 weeks'",
            'group by 1, 2 order by 1;',
          ].join('\n'),
          output: '24 rows (8 weeks × new, expansion, churn).',
        },
        { kind: 'think', title: 'Checked for anomalies', output: 'No week outside 2σ. Expansion came from three accounts adding seats.', ms: 2_800, tokens: 2_200 },
        { kind: 'write', title: 'Wrote the snapshot', ms: 3_300, tokens: 2_900 },
      ],
    },
    {
      ...ledger,
      id: 'run_seed_agent_ledger_2',
      title: 'Net revenue retention by cohort',
      status: 'failed',
      at: tl.ledgerNrrFailed,
      error: 'Query cancelled: statement timeout (30 s) on the analytics replica.',
      steps: [
        { kind: 'plan', title: 'Planned cohort NRR by signup quarter', ms: 2_300, tokens: 1_600 },
        {
          kind: 'read', title: 'Read the NRR definition in the Atlas glossary', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [k(KNOWLEDGE.glossary)], ms: 1_300, tokens: 2_200, output: 'NRR = (starting MRR + expansion − contraction − churn) ÷ starting MRR, per cohort.',
        },
        {
          kind: 'tool', title: 'Queried revenue by cohort (daily rows, 24 months)', ...pg, ms: 30_400, tokens: 1_900, status: 'failed',
          input: 'select cohort_quarter, day, sum(mrr) from billing.daily_mrr join accounts using (account_id) group by 1, 2;',
          error: 'ERROR: canceling statement due to statement timeout (30 s). Joining 24 months of daily rows is too heavy for the replica.',
        },
      ],
    },
    {
      ...ledger,
      id: 'run_seed_agent_ledger_3',
      title: 'Net revenue retention by cohort (monthly rollup)',
      status: 'succeeded',
      at: tl.ledgerNrr,
      summary: 'NRR is 106% overall. Younger cohorts trail older ones, mostly from seat contraction on Starter.',
      steps: [
        {
          kind: 'tool', title: 'Queried monthly MRR rollup by cohort', ...pg, ms: 3_600, tokens: 2_400,
          input: 'select cohort_quarter, month, sum(mrr) from billing.monthly_mrr group by 1, 2 order by 1, 2;',
          output: '96 rows in 1.8 s.',
        },
        {
          kind: 'think', title: 'Checked cohorts against the 2σ anomaly rule', ms: 2_400, tokens: 2_000,
          output: 'No cohort outside 2σ. The youngest cohort is too small (n = 6) to read yet.',
        },
        {
          kind: 'write', title: 'Wrote NRR by cohort', ms: 4_100, tokens: 3_600,
          output: 'Cohorts 4–6 quarters old: 109% · 2–3 quarters old: 104% · last quarter: 97% (too early to read).\nMain drag: Starter accounts removing seats after onboarding.',
        },
      ],
    },
    {
      ...ledger,
      id: 'run_seed_agent_ledger_4',
      title: 'Lumen beta usage by account',
      status: 'succeeded',
      at: tl.ledgerLumenUsage,
      projectId: PROJECT.lumen,
      summary: 'The top three beta accounts drive 61% of tracked-shipment volume; a shipment-based tier would put most accounts in the first tier.',
      steps: [
        {
          kind: 'read', title: 'Read the pricing memo and the accounts list', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [k(KNOWLEDGE.pricingMemo), k(KNOWLEDGE.csvAccounts)], ms: 1_900, tokens: 5_200,
        },
        {
          kind: 'tool', title: 'Queried tracked shipments per beta account (30 days)', ...pg, ms: 3_900, tokens: 2_300,
          input: "select account_name, count(*) as tracked from lumen.tracked_shipments where tracked_at >= now() - interval '30 days' group by 1 order by 2 desc;",
          output: '23 beta accounts.',
        },
        {
          kind: 'write', title: 'Summarized usage for pricing', ms: 3_800, tokens: 3_400,
          output: 'Usage is highly concentrated: the top three accounts are 61% of volume. Median account volume sits well inside a first tier.',
        },
      ],
    },
    {
      ...ledger,
      id: 'run_seed_agent_ledger_5',
      title: 'Check Coastal Cargo’s stuck upgrade for a double charge',
      status: 'succeeded',
      at: tl.ledgerDoubleCharge,
      summary:
        'Coastal Cargo was charged twice ($1,065.00 × 2). Ledger is not allowed to issue refunds, so it drafted a refund request for Finance. The cause matches the stale-poll bug behind the flaky checkout test.',
      steps: [
        {
          kind: 'tool', title: 'Queried Coastal Cargo’s charges today', ...pg, input: PAYMENTS_QUERY, ms: 2_700, tokens: 2_100,
          output: '2 succeeded charges of $1,065.00, 11 minutes apart, both “Upgrade to Growth (20 seats)”. One active subscription.',
        },
        {
          kind: 'tool', title: 'Refund the duplicate charge', tool: 'stripe', capability: 'payments.spend', integrationId: 'stripe', ms: 200,
          status: 'skipped', detail: 'Denied by policy: Ledger may not spend money (payments.spend is set to deny).',
        },
        {
          kind: 'write', title: 'Drafted a refund request for Finance', refs: [ref('session', SESSION.flaky)], ms: 3_900, tokens: 3_300,
          output:
            'Refund one $1,065.00 charge to Coastal Cargo (duplicate upgrade). Evidence: two succeeded charges 11 minutes apart, one active subscription. Cause: the upgrade page stayed on “Processing payment…”, so the customer upgraded again.',
        },
      ],
    },
  ]
}

function archivistRuns(tl: Timeline): RunSpec[] {
  const nights: { pages: number; updated: string[]; merge?: string }[] = [
    { pages: 6, updated: [KNOWLEDGE.glossary, KNOWLEDGE.onboarding], merge: '“Release checklist” and “Launch checklist (old)” look like duplicates; proposed a merge.' },
    { pages: 3, updated: [KNOWLEDGE.codeReview] },
    { pages: 9, updated: [KNOWLEDGE.rateLimits, KNOWLEDGE.adrSessions, KNOWLEDGE.onboarding] },
    { pages: 4, updated: [KNOWLEDGE.slaPolicy, KNOWLEDGE.glossary] },
  ]
  const archivist = {
    kind: 'agent' as const, agentId: AGENT.archivist, modelId: 'sim-swift', projectId: null,
    initiator: { type: 'agent', id: AGENT.archivist } as ActorRef,
  }
  const runs: RunSpec[] = nights.map((night, i) => {
    const steps: StepSpec[] = [
      {
        kind: 'tool', title: 'Fetched changed Notion pages', tool: 'notion', capability: 'files.read', integrationId: 'notion', ms: 9_400, tokens: 2_000 + night.pages * 900,
        output: `${night.pages} pages changed in the Product and Engineering spaces since the last sync.`,
      },
      { kind: 'think', title: 'Matched pages to knowledge items', ms: 3_100, tokens: 2_400 },
      {
        kind: 'write', title: `Updated ${night.updated.length} knowledge ${night.updated.length === 1 ? 'item' : 'items'}`, capability: 'knowledge.write',
        refs: night.updated.map(k), ms: 4_600, tokens: 3_100 + night.updated.length * 700,
        output: `Refreshed content and summaries; ${night.pages - night.updated.length} pages skipped (drafts or private).`,
      },
      { kind: 'think', title: 'Checked for duplicates', ms: 2_200, tokens: 1_800, output: night.merge ?? 'No duplicates found.' },
    ]
    return {
      ...archivist,
      id: `run_seed_agent_archivist_${i + 1}`,
      title: 'Nightly knowledge sync',
      status: 'succeeded' as const,
      at: tl.archivistNights[i] ?? tl.archivistPaused,
      outputs: night.updated.map(k),
      summary: `Synced ${night.pages} changed pages: ${night.updated.length} updated, ${night.pages - night.updated.length} skipped${night.merge ? ', 1 merge proposed' : ''}.`,
      steps,
    }
  })
  const rateLimited = 'Notion API rate limited the sync (HTTP 429) after 3 retries; 18 of 64 changed pages fetched, nothing written.'
  runs.push({
    ...archivist,
    id: 'run_seed_agent_archivist_5',
    title: 'Nightly knowledge sync',
    status: 'failed',
    at: tl.archivistNights[4] ?? tl.archivistPaused,
    error: rateLimited,
    steps: [
      {
        kind: 'tool', title: 'Listed changed Notion pages', tool: 'notion', capability: 'files.read', integrationId: 'notion', ms: 3_900, tokens: 1_800,
        output: '64 pages changed since the last sync: the Product and Engineering spaces were reorganized.',
      },
      {
        kind: 'tool', title: 'Fetched pages 1–18', tool: 'notion', capability: 'files.read', integrationId: 'notion', ms: 21_000, tokens: 7_400,
        output: '18 pages fetched; Notion started returning 429 (rate limited).',
      },
      {
        kind: 'tool', title: 'Fetch the remaining 46 pages', tool: 'notion', capability: 'files.read', integrationId: 'notion', ms: 27_000, tokens: 600,
        status: 'failed', error: rateLimited,
      },
    ],
  })
  return runs
}

export function agentRunSpecs(tl: Timeline, story: Story): RunSpec[] {
  return [...scoutRuns(tl), ...heraldRuns(tl), ...sentinelRuns(tl, story), ...museRuns(tl), ...ledgerRuns(tl), ...archivistRuns(tl)]
}
