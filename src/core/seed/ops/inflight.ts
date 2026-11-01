import type { StepPlan } from '@/core/runs/types'
import type { ActorRef, Finding } from '@/core/types'
import { AGENT, BOARD, INVESTIGATION, KNOWLEDGE, PROJECT, SESSION, TASK, WORKFLOW } from '../ids'
import { STRIPE_INFLIGHT_RUN, stripeChecks, unitFilesWith, unitOutput } from './code'
import { composeDigest } from './digest'
import type { SessionChanges } from './repo'
import type { InflightSpec } from './runKit'
import type { Story, SupportEmail } from './story'
import { DAY } from './time'
import type { Timeline } from './timeline'
import { ref } from './util'
import { TRIAGE } from './workflows'

const ME: ActorRef = { type: 'user', id: 'usr_me' }
const src = (n: number) => ref('source', `src_pricing_${n}`)
const sources = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => src(from + i))

export const PRICING_REPORT = `## Summary

Usage-based pricing has become the default way to price **add-ons** in B2B SaaS, but very few companies price their core product on usage alone. The pattern that holds up across the sources is **hybrid**: a platform fee for predictability plus a metered component tied to a value metric customers already track [1][3]. For Atlas Lumen that points to a per-account platform fee with included tracked shipments and a metered tier above it, not per-seat pricing.

## What the sources agree on

- **Hybrid beats pure usage.** Companies that moved to usage-based models mostly kept a committed minimum or platform fee; pure pay-as-you-go is concentrated in developer infrastructure [1][3].
- **The value metric matters more than the model.** Pricing on a unit buyers already budget for (shipments, documents, API calls) shortens procurement; abstract units such as credits slow it down [2][5].
- **Buyers want predictability.** Finance teams push back on uncapped bills. Spend alerts, caps and annual commits with overage rates are now table stakes [4][6].
- **Expansion improves, forecasting gets harder.** Usage-priced add-ons show stronger net revenue retention, but revenue forecasting and quota setting get noisier [3][7].

## Where they disagree

The sources differ on how much of the bill should be variable. Infrastructure vendors report the best results with mostly variable pricing [3], while vertical SaaS vendors selling to operations teams see procurement reviews once roughly a third of the bill is variable [6][8]. Logistics buyers look like the second group.

## Implications for Atlas Lumen

1. **Price Lumen as an add-on with a platform fee plus metered tracked shipments**, with enough included volume that most accounts never see an overage [1][2].
2. **Ship spend controls on day one:** usage alerts at 80% and 100% of included volume, and an optional hard cap [4].
3. **Offer an annual commit with a discounted overage rate** for enterprise accounts such as Meridian Freight [6][7].
4. **Instrument the value metric before launch**, so usage per account is reportable from the first invoice [5][8].

## Confidence and gaps

Medium-high confidence in the direction, low confidence in specific percentages, which vary by source and sample. None of the sources cover freight software specifically: validate the included volume and the variable share in five or six customer conversations before finalizing tiers.`

export const PRICING_FINDINGS: Finding[] = [
  {
    id: 'fnd_pricing_1',
    text: 'Hybrid pricing (platform fee plus metered usage) is the dominant pattern; pure pay-as-you-go is mostly limited to developer infrastructure.',
    sourceIds: ['src_pricing_1', 'src_pricing_3'],
    confidence: 'high',
  },
  {
    id: 'fnd_pricing_2',
    text: 'Choosing a value metric buyers already budget for (for Lumen: tracked shipments) matters more than the pricing model itself.',
    sourceIds: ['src_pricing_2', 'src_pricing_5'],
    confidence: 'medium',
  },
  {
    id: 'fnd_pricing_3',
    text: 'Buyers expect spend controls (alerts, caps, committed-use discounts) before they accept variable pricing.',
    sourceIds: ['src_pricing_4', 'src_pricing_6'],
    confidence: 'high',
  },
  {
    id: 'fnd_pricing_4',
    text: 'Usage-priced add-ons improve net revenue retention but make revenue forecasting noisier.',
    sourceIds: ['src_pricing_3', 'src_pricing_7'],
    confidence: 'medium',
  },
  {
    id: 'fnd_pricing_5',
    text: 'Operations-focused buyers push back when more than roughly a third of the bill is variable.',
    sourceIds: ['src_pricing_6', 'src_pricing_8'],
    confidence: 'low',
  },
]

function pricingResearch(): InflightSpec {
  const web = { tool: 'web.search', capability: 'web.search' as const, integrationId: 'web-search' }
  const browse = { tool: 'web.browse', capability: 'web.browse' as const, integrationId: 'web-search' }
  const plan: StepPlan[] = [
    {
      kind: 'plan', title: 'Planned 4 angles', durationMs: 3_200, tokens: 2_300,
      output: '1. How widely B2B SaaS has adopted usage-based pricing\n2. Which value metrics work, and which create friction\n3. How buyers react: predictability, caps, commits\n4. What it means for an analytics add-on like Lumen',
    },
    {
      kind: 'search', title: 'Searched: usage-based and hybrid pricing in B2B SaaS', ...web,
      input: 'usage-based pricing adoption B2B SaaS hybrid platform fee value metric spend caps',
      output: '21 results · kept 8 (simulated web corpus)', refs: sources(1, 8), durationMs: 4_600, tokens: 4_100,
    },
    { kind: 'browse', title: 'Read 3 sources', ...browse, refs: sources(1, 3), durationMs: 5_800, tokens: 14_200 },
    { kind: 'browse', title: 'Read 3 more sources', ...browse, refs: sources(4, 6), durationMs: 5_600, tokens: 13_100 },
    { kind: 'browse', title: 'Read the last 2 sources', ...browse, refs: sources(7, 8), durationMs: 4_900, tokens: 8_400 },
    {
      kind: 'think', title: 'Cross-checked claims across sources', durationMs: 4_800, tokens: 6_900,
      output: 'Sources agree on the hybrid pattern and on spend controls; they disagree on how much of the bill can be variable before procurement pushes back.',
    },
    { kind: 'write', title: 'Wrote 5 findings with confidence ratings', durationMs: 4_200, tokens: 6_200 },
    { kind: 'write', title: 'Drafted the report with citations', durationMs: 5_600, tokens: 9_800 },
    { kind: 'write', title: 'Marked cited sources and moved the investigation to review', durationMs: 1_800, tokens: 900 },
  ]
  return {
    id: 'run_seed_inv_pricing',
    kind: 'research',
    title: 'Usage-based pricing trends in B2B SaaS',
    projectId: PROJECT.landscape,
    agentId: AGENT.scout,
    origin: ref('investigation', INVESTIGATION.pricingTrends),
    initiator: ME,
    modelId: 'sim-deep',
    plan,
    done: 3,
    // Lines up with the content part: the investigation started ~38 min ago and its eight
    // sources were found by the first search within a few minutes; three have been read.
    windows: [[37.4, 36.9], [36.9, 33.3], [33.2, 0.4]],
    seed: 41_001,
    summary: 'Report ready for review: hybrid pricing (platform fee + metered tracked shipments) with spend controls fits Lumen best. 5 findings, 8 sources cited.',
    onSuccessPatches: [
      {
        table: 'investigations',
        id: INVESTIGATION.pricingTrends,
        patch: { status: 'review', report: PRICING_REPORT, findings: PRICING_FINDINGS },
      },
      ...sources(1, 8).map((src) => ({ table: 'sources' as const, id: src.id, patch: { status: 'cited' } })),
    ],
  }
}

function stripeMigration(changes: SessionChanges): InflightSpec {
  const write = { tool: 'editor', capability: 'repo.write' as const, integrationId: 'github' }
  const { pkg, adapter, invoices, tests } = changes.stripe
  const command = 'npm install stripe@^18 --save'
  const plan: StepPlan[] = [
    {
      kind: 'plan', title: 'Planned step 1 of the migration', durationMs: 2_600, tokens: 2_200,
      output: '1. Add the official stripe package (types only, no keys in the browser)\n2. Implement list, get and send in src/billing/stripe.ts\n3. Route src/api/invoices.ts through Stripe when VITE_FLAG_STRIPE_BILLING is on\n4. Add mapping and pagination tests\n5. Run checks',
    },
    { kind: 'read', title: 'Read src/api/invoices.ts and src/billing/stripe.ts', tool: 'repo', capability: 'repo.read', integrationId: 'github', durationMs: 2_200, tokens: 7_400 },
    {
      kind: 'read', title: 'Read the Stripe Billing migration plan', tool: 'knowledge.search', capability: 'knowledge.read',
      refs: [ref('knowledge', KNOWLEDGE.stripePlan)], durationMs: 1_800, tokens: 5_600,
    },
    {
      kind: 'command', title: `Run ${command}`, tool: 'terminal', capability: 'shell.execute', integrationId: 'sandbox', input: command,
      output: 'added 1 package, and audited 412 packages in 3s\n\n87 packages are looking for funding\n  run `npm fund` for details\n\nfound 0 vulnerabilities',
      fileChanges: [pkg], durationMs: 4_800, tokens: 600,
      approval: {
        title: `Run ${command}`,
        description:
          'Forge wants to add the official Stripe SDK (v18) so src/billing/stripe.ts can use Stripe’s invoice and list types. It only changes package.json and package-lock.json in the session sandbox.',
        risk: 'medium',
        preview: { kind: 'command', content: command, label: 'session sandbox · atrium/stripe-billing-invoices' },
      },
    },
    { kind: 'edit', title: 'Implement Stripe invoice calls in src/billing/stripe.ts', ...write, fileChanges: [adapter], durationMs: 5_200, tokens: 9_800 },
    { kind: 'edit', title: 'Route src/api/invoices.ts through Stripe behind the flag', ...write, fileChanges: [invoices], durationMs: 3_600, tokens: 6_200 },
    { kind: 'write', title: 'Add src/billing/stripe.test.ts', ...write, fileChanges: [tests], durationMs: 4_100, tokens: 7_300 },
    {
      kind: 'test', title: 'Run checks: typecheck, lint, unit, e2e', tool: 'checks', integrationId: 'sandbox', durationMs: 5_800, tokens: 1_100,
      output: unitOutput(unitFilesWith({ 'src/billing/stripe.test.ts': 5 }), '2.17'),
    },
    {
      kind: 'write', title: 'Summarize the change for review', durationMs: 2_400, tokens: 3_100,
      output: 'Invoices come from Stripe Billing when VITE_FLAG_STRIPE_BILLING is on; legacy stays the default. 5 new tests cover mapping and pagination.',
    },
  ]
  return {
    id: STRIPE_INFLIGHT_RUN,
    kind: 'code',
    title: 'Migrate invoices to Stripe Billing (step 1)',
    projectId: PROJECT.atlas,
    agentId: AGENT.forge,
    origin: ref('session', SESSION.stripe),
    initiator: ME,
    modelId: 'sim-deep',
    plan,
    done: 3,
    waiting: { approvalId: 'apv_seed_npm', capability: 'shell.execute', requestedBy: { type: 'agent', id: AGENT.forge }, sinceMinutes: 11 },
    seed: 41_002,
    summary:
      'Invoices are served from Stripe Billing when VITE_FLAG_STRIPE_BILLING is on; the legacy service stays the default. Added the stripe package for types, implemented list, get and send, and 5 tests for mapping and pagination. All checks pass; ready for review.',
    onSuccessPatches: [
      {
        table: 'sessions',
        id: SESSION.stripe,
        patch: { status: 'needs_review', changes: [pkg, adapter, invoices, tests], checks: stripeChecks() },
      },
    ],
  }
}

export const DIGEST_DECISIONS = [
  'Approve the `stripe` dependency so Forge can finish the invoice migration (waiting in Approvals).',
  'Review Forge’s SSO session fix: it closes the “signed out after an hour” reports from Meridian Freight.',
  'Decide who owns the Checkout.tsx polling fix: the flaky test and Coastal Cargo’s double charge share that root cause.',
  'Jira sync is disconnected (token expired): reconnect it or retire it.',
]

function heraldDigest(tl: Timeline, story: Story): InflightSpec {
  const digest = composeDigest({ tl, story, from: tl.clock.now - 7 * DAY, to: tl.clock.now, decisions: DIGEST_DECISIONS })
  const plan: StepPlan[] = [
    { kind: 'plan', title: 'Planned this week’s digest', output: 'Window: the last 7 days · 4 active projects · decisions first · under 250 words', durationMs: 1_900, tokens: 1_500 },
    {
      kind: 'read', title: 'Collected activity from 4 projects', tool: 'workspace', capability: 'tasks.manage',
      refs: [ref('session', SESSION.sso), ref('session', SESSION.stripe), ref('investigation', INVESTIGATION.churn), ref('task', TASK.competitorBrief)],
      durationMs: 3_200, tokens: 4_800,
    },
    {
      kind: 'read', title: 'Read meeting notes and recent decisions', tool: 'knowledge.search', capability: 'knowledge.read',
      refs: [ref('knowledge', KNOWLEDGE.syncOct28), ref('knowledge', KNOWLEDGE.meridianCall)], durationMs: 2_400, tokens: 5_200,
    },
    { kind: 'write', title: 'Drafted the digest', output: digest, durationMs: 5_600, tokens: 8_400 },
    {
      kind: 'message', title: 'Post digest to #product', tool: 'slack', capability: 'messages.send', integrationId: 'slack', input: '#product',
      output: 'Posted the digest to #product.', durationMs: 1_500, tokens: 400,
      approval: {
        title: 'Post weekly digest to #product',
        description: 'Herald drafted this week’s project digest and wants to post it to #product on Slack.',
        risk: 'high',
        preview: { kind: 'message', label: '#product', content: digest },
      },
    },
  ]
  return {
    id: 'run_seed_herald_digest',
    kind: 'agent',
    title: 'Send weekly project digest',
    projectId: PROJECT.ops,
    agentId: AGENT.herald,
    origin: ref('task', TASK.weeklyDigest),
    initiator: ME,
    modelId: 'sim-swift',
    plan,
    done: 4,
    waiting: { approvalId: 'apv_seed_slack', capability: 'messages.send', requestedBy: { type: 'agent', id: AGENT.herald }, sinceMinutes: 4 },
    seed: 41_003,
    summary: 'Weekly digest posted to #product after your approval.',
  }
}

/** The email Sentinel is triaging right now. */
export const LIVE_EMAIL: Omit<SupportEmail, 'at'> = {
  key: 'triage_live',
  from: 'billing@coastalcargo.example',
  account: 'Coastal Cargo',
  plan: 'Starter',
  subject: 'Invoices show EUR instead of GBP',
  quote: 'Our last two invoices are in EUR, but our contract is in GBP. Can you reissue them?',
  priority: 'high',
  category: 'billing',
  issue: 'SUP-426',
  summary: 'Coastal Cargo’s last two invoices were issued in EUR instead of their contract currency (GBP); they need reissued invoices.',
}

function sentinelTriage(): InflightSpec {
  const e = LIVE_EMAIL
  const verdict = { priority: e.priority, category: e.category, account: e.account, summary: e.summary }
  const plan: StepPlan[] = [
    {
      kind: 'tool', title: `Email from ${e.from}`, tool: 'gmail', capability: 'files.read', integrationId: 'gmail', nodeId: TRIAGE.trigger,
      input: 'to:support@northwind.example', output: `Subject: ${e.subject}\nFrom: ${e.from}\n\n“${e.quote}”`, durationMs: 1_600, tokens: 700,
    },
    {
      kind: 'read', title: `Matched ${e.account} · ${e.plan}`, tool: 'knowledge.search', capability: 'knowledge.read', nodeId: TRIAGE.enrich,
      output: `Sender domain coastalcargo.example → ${e.account} (${e.plan} plan). Applied the ${e.plan} tier of the Support SLA policy.`,
      refs: [ref('knowledge', KNOWLEDGE.csvAccounts), ref('knowledge', KNOWLEDGE.slaPolicy)], durationMs: 2_300, tokens: 1_900,
    },
    {
      kind: 'think', title: `Classified ${e.priority} · ${e.category}`, tool: 'agent', capability: 'knowledge.read', nodeId: TRIAGE.classify,
      output: JSON.stringify(verdict, null, 2), refs: [ref('knowledge', KNOWLEDGE.triageRubric)], durationMs: 4_700, tokens: 4_400,
    },
    { kind: 'think', title: 'priority == "urgent" → false', nodeId: TRIAGE.urgent, durationMs: 1_500 },
    {
      kind: 'tool', title: `Created Linear issue ${e.issue}`, tool: 'linear', capability: 'tasks.manage', integrationId: 'linear', nodeId: TRIAGE.issue,
      output: `${e.issue} · High · “${e.subject}” · labels: billing, triage-bot`, durationMs: 1_900, tokens: 350,
    },
    {
      kind: 'write', title: 'Logged triage decision', nodeId: TRIAGE.log, durationMs: 1_500,
      output: `priority=high category=billing account="${e.account}" issue=${e.issue}`,
    },
  ]
  return {
    id: 'run_seed_sentinel_triage',
    kind: 'workflow',
    title: `Support triage · ${e.subject} (${e.account})`,
    projectId: PROJECT.ops,
    agentId: AGENT.sentinel,
    workflowId: WORKFLOW.triage,
    origin: ref('workflow', WORKFLOW.triage),
    initiator: { type: 'workflow', id: WORKFLOW.triage },
    modelId: 'sim-swift',
    plan,
    done: 2,
    seed: 41_004,
    summary: `High priority (billing). Filed ${e.issue} in Linear.`,
  }
}

function museStoryboard(): InflightSpec {
  const gen = { tool: 'image-gen', capability: 'media.generate' as const, integrationId: 'image-gen' }
  const plan: StepPlan[] = [
    {
      kind: 'read', title: 'Read the beat sheet, messaging house and brand voice', tool: 'knowledge.search', capability: 'knowledge.read',
      refs: [ref('task', TASK.heroVideo), ref('knowledge', KNOWLEDGE.messagingHouse), ref('knowledge', KNOWLEDGE.brandVoice)],
      durationMs: 2_100, tokens: 6_200,
    },
    {
      kind: 'plan', title: 'Planned 6 storyboard frames', durationMs: 3_400, tokens: 3_600,
      output: '1. Dispatcher at 6 a.m., one late container\n2. “Why is Rotterdam → Chicago late again?”\n3. Lumen lane view, dwell time highlighted\n4. Carriers compared side by side\n5. On-time rate climbing over four weeks\n6. End card: Atlas Lumen',
    },
    { kind: 'generate', title: 'Generated frames 1–3', ...gen, refs: [ref('board', BOARD.launch)], output: '3 procedural frames (simulated)', durationMs: 5_600, tokens: 2_900 },
    { kind: 'generate', title: 'Generated frames 4–6', ...gen, refs: [ref('board', BOARD.launch)], output: '3 procedural frames (simulated)', durationMs: 5_400, tokens: 2_800 },
    { kind: 'artifact', title: 'Saved the storyboard to Lumen launch visuals', refs: [ref('board', BOARD.launch)], durationMs: 1_600, tokens: 400 },
  ]
  return {
    id: 'run_seed_muse_storyboard',
    kind: 'studio',
    title: 'Storyboard the launch hero video',
    projectId: PROJECT.lumen,
    agentId: AGENT.muse,
    origin: ref('task', TASK.heroVideo),
    initiator: ME,
    modelId: 'sim-swift',
    plan,
    done: 1,
    seed: 41_005,
    summary: 'Six-frame storyboard for the 45-second hero video, saved to Lumen launch visuals (procedural previews).',
  }
}

export function inflightSpecs(tl: Timeline, story: Story, changes: SessionChanges): InflightSpec[] {
  return [pricingResearch(), stripeMigration(changes), heraldDigest(tl, story), sentinelTriage(), museStoryboard()]
}
