import type { ActorRef, EntityRef, ID, Message, Priority, Task, TaskStatus } from '@/core/types'
import { AGENT, INVESTIGATION, PROJECT, TASK } from '../ids'
import { agentActor, dayLabel, ME, MINUTE, ref, type SeedCtx } from './helpers'
import { MILESTONE, MSG, TSK } from './keys'

interface TaskSpec {
  id: ID
  projectId: ID | null
  title: string
  status: TaskStatus
  priority: Priority
  assignee?: ActorRef | null
  milestoneId?: ID
  dueAt?: number
  labels: string[]
  description?: string
  subtasks?: Array<[string, boolean]>
  /** A message id (string) or any entity ref. */
  origin?: ID | EntityRef
  createdAt?: number
  updatedAt?: number
  completedAt?: number
}

const FORGE = agentActor(AGENT.forge)
const SCOUT = agentActor(AGENT.scout)
const MUSE = agentActor(AGENT.muse)
const HERALD = agentActor(AGENT.herald)
const SENTINEL = agentActor(AGENT.sentinel)
const LEDGER = agentActor(AGENT.ledger)

export function buildTasks({ clock, dates }: SeedCtx, messages: Record<ID, Message>): Task[] {
  const { back, ago, ahead } = clock
  /** Tasks created from a message appear a minute after it. */
  const afterMsg = (id: ID): number => (messages[id]?.createdAt ?? back(30)) + MINUTE

  const specs: TaskSpec[] = [
    // ------------------------------------------------------------ Atlas Portal v2
    {
      id: TASK.ssoFix, projectId: PROJECT.atlas, title: 'Fix session expiry after SSO login',
      status: 'review', priority: 'high', assignee: FORGE, milestoneId: MILESTONE.atlasGa, dueAt: ahead(1, 'd'),
      labels: ['bug', 'auth', 'sso', 'customer-escalation'], origin: MSG.ssoTask, updatedAt: back(0, 1, 30),
      description: `
**Problem.** Users who sign in through IdP-initiated SSO are logged out about 15 minutes later, even while active. The SAML callback stores tokens but never schedules the silent refresh, so the 15-minute access token expires (ADR-012). Reported by Halden Logistics, ticket #4821.

**Acceptance criteria**
- [ ] Password, SP-initiated and IdP-initiated sign-in all go through one \`establishSession()\` that always schedules the refresh
- [ ] Tokens can't be stored from outside the session module without scheduling a refresh
- [ ] Regression test: the IdP-initiated callback triggers exactly one \`/auth/refresh\` after ~12 minutes (fake timers)
- [ ] A table-driven test covers all three sign-in paths
- [ ] No change to token lifetimes, cookie attributes or the public API
- [ ] Verified on Halden's staging tenant

**Out of scope:** refresh-token reuse detection, SCIM.`,
      subtasks: [
        ['Route every sign-in path through establishSession()', true],
        ['Regression test for the IdP-initiated callback', true],
        ['Table-driven test for all three sign-in paths', true],
        ["Verify on Halden's staging tenant", false],
      ],
    },
    {
      id: TASK.stripeMigration, projectId: PROJECT.atlas, title: 'Migrate invoices to Stripe Billing',
      status: 'in_progress', priority: 'high', assignee: FORGE, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(6, 'd'),
      labels: ['billing', 'stripe', 'migration', 'backend'], createdAt: back(16, 2), updatedAt: back(0, 0, 25),
      description: `
Move invoice generation and payment tracking from the in-house invoicer to Stripe Billing, following phases 1–3 of the **Stripe Billing migration plan**.

**Acceptance criteria**
- [ ] Every active account mapped to a Stripe customer (\`metadata.atlas_account_id\`)
- [ ] Webhook handlers idempotent and replay-safe in staging
- [ ] Open invoices and 13 months of history backfilled; totals match the invoicer to the cent for every account
- [ ] Dual-run report with fewer than 0.5% of invoices mismatched, each mismatch explained
- [ ] \`stripe_invoice_id\` index created concurrently before the backfill
- [ ] No change to customers' billing dates

**Notes**
- Installing the Stripe SDK runs a shell command in the session, which needs approval.
- Invoice numbering is decided separately (*Decide invoice numbering scheme after cutover*).`,
      subtasks: [
        ['Map accounts to Stripe customers', true],
        ['Recreate the price catalog in Stripe', true],
        ['Idempotent webhook handlers', true],
        ['Install the Stripe SDK and wire up invoice sync', false],
        ['Backfill open invoices and history', false],
        ['Dual-run reconciliation report', false],
      ],
    },
    {
      id: TASK.bundleSize, projectId: PROJECT.atlas, title: 'Reduce dashboard bundle size',
      status: 'done', priority: 'medium', assignee: FORGE, milestoneId: MILESTONE.atlasPerf,
      labels: ['performance', 'frontend'], createdAt: back(14, 3), completedAt: back(3, 5),
      description: `
The dashboard's entry chunk is the biggest contributor to slow first loads on the dashboard and shipments board.

**Acceptance criteria**
- [x] Charts and other heavy dependencies load lazily, only on routes that use them
- [x] Dashboard entry chunk under 300 KB gzipped
- [x] No visual regressions (screenshot tests green)
- [x] A bundle-size budget in CI, so regressions fail the build`,
      subtasks: [
        ['Analyze the bundle and list the largest dependencies', true],
        ['Lazy-load chart routes', true],
        ['Add a bundle-size budget to CI', true],
      ],
    },
    {
      id: TASK.flakyTest, projectId: PROJECT.atlas, title: 'Fix flaky checkout e2e test',
      status: 'todo', priority: 'high', assignee: FORGE, dueAt: ahead(2, 'd'),
      labels: ['testing', 'ci', 'flaky', 'checkout'], createdAt: back(8, 4), updatedAt: back(1, 2),
      description: `
\`checkout.spec.ts › pays an open invoice\` fails intermittently on CI: 6 failures in Sprint 14, usually a timeout waiting for the Pay button. It started around the time the outstanding-balance banner shipped, so a race between the banner's fetch and the button becoming enabled is the main suspect.

Forge's first attempt failed. The next attempt should start by reproducing the failure deterministically.

**Acceptance criteria**
- [ ] Root cause identified and written up in the pull request
- [ ] No fixed sleeps: wait on an explicit condition (network idle, a test id, or the button's enabled state)
- [ ] 50 consecutive CI runs green
- [ ] Removed from the flaky-test quarantine lane once fixed`,
    },
    {
      id: TSK.runbook, projectId: PROJECT.atlas, title: 'Write migration runbook for Stripe cutover',
      status: 'todo', priority: 'high', assignee: ME, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(5, 'd'),
      labels: ['billing', 'stripe', 'runbook'], origin: MSG.stripeTasks, updatedAt: back(5, 2, 50),
      description: `
Step-by-step runbook for the Stripe Billing cutover on ${dayLabel(dates.cutover)}.

1. Freeze window and comms owner
2. Dual-run reconciliation checks, including EU VAT
3. Rollback trigger: more than 0.5% of invoices mismatched, or a systemic error in the first batch
4. Support macros for the first Stripe invoices
5. Database safety from the checkout incident: EXPLAIN for new queries, the \`stripe_invoice_id\` index before the backfill, reconciliation on the read replica`,
      subtasks: [
        ['Freeze window and comms owner', false],
        ['Dual-run reconciliation checks', false],
        ['Rollback trigger and steps', false],
        ['Support macros', false],
        ['Database safety checks from the incident', false],
      ],
    },
    {
      id: TSK.numbering, projectId: PROJECT.atlas, title: 'Decide invoice numbering scheme after cutover',
      status: 'in_progress', priority: 'medium', assignee: ME, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(2, 'd'),
      labels: ['billing', 'decision'], origin: MSG.stripeTasks, updatedAt: back(1, 6),
      description: `
Decide whether Stripe continues the \`NW-\` invoice sequence or starts a fresh series.

- **Decision owner:** Owen Fitzgerald (RevOps). **Consulted:** Daniel Okafor.
- **Proposal:** continue the sequence and record the boundary (last invoicer number, first Stripe number) in the cutover memo.
- **Deadline:** before the cutover freeze.`,
      subtasks: [
        ['Write up both options', true],
        ['Check with two Enterprise accounts-payable teams', false],
        ['Owen decides; record it in the cutover memo', false],
      ],
    },
    {
      id: TSK.tokens, projectId: PROJECT.atlas, title: 'Rename color tokens to the semantic scheme',
      status: 'todo', priority: 'medium', assignee: ME, dueAt: ahead(10, 'd'),
      labels: ['design-system', 'frontend', 'dark-mode'], origin: MSG.tokensTask,
      description: `
**Acceptance criteria**
- [ ] Semantic tokens defined for surface, text, border, action and status roles
- [ ] All ~140 hard-coded hex values mapped to a role or removed
- [ ] Components reference only semantic tokens; a lint rule fails CI otherwise
- [ ] No visual change in the light theme (screenshot tests green)
- [ ] Dark mapping drafted but not shipped`,
    },
    {
      id: TSK.queryPlan, projectId: PROJECT.atlas, title: 'Add query-plan regression check to CI',
      status: 'todo', priority: 'high', assignee: ME, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(7, 'd'),
      labels: ['reliability', 'ci', 'database'], origin: MSG.incidentSaved,
      description: `
Incident action item 2 (owner: Priya Natarajan; tracked here).

Fail CI when a new or changed query on a table with more than 1M rows plans a sequential scan against production-sized data.

**Acceptance criteria**
- [ ] CI runs EXPLAIN for queries touched by the pull request against an anonymized, production-sized snapshot
- [ ] Sequential scans on large tables fail the job, with an allow-list for intentional scans
- [ ] The job runs in under 5 minutes
- [ ] In place before the Stripe backfill starts`,
    },
    {
      id: TSK.p95Alert, projectId: PROJECT.atlas, title: 'Alert on checkout p95 > 2s for 5 minutes',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['reliability', 'monitoring', 'checkout'], origin: MSG.incidentSaved, completedAt: back(7, 3),
      description: 'Incident action item 1. Page on-call when checkout p95 latency stays above 2 s for 5 minutes.\n\n**Done:** alert live and tested with a synthetic slow checkout on staging.',
    },
    {
      id: TSK.carrierMap, projectId: PROJECT.atlas, title: 'Lazy-load the carrier map on the shipments page',
      status: 'backlog', priority: 'low', assignee: ME, milestoneId: MILESTONE.atlasPerf,
      labels: ['performance', 'frontend'], createdAt: back(4, 1),
      description: "The carrier map is the next suspect for the shipments board's ~2.1 s p95 (weekly product sync). Profile first; if confirmed, lazy-load the map below the fold.",
    },
    {
      id: TSK.rateLimits, projectId: PROJECT.atlas, title: 'Audit public API rate limits for v2 endpoints',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.atlasGa, dueAt: ahead(8, 'd'),
      labels: ['api', 'reliability'], createdAt: back(13, 6),
      description: 'Check every `/v2/*` endpoint against **Public API rate limits**: correct bucket, headers present, and a 429 body that matches the doc. Changing the default limits of a plan needs an ADR.',
    },
    {
      id: TSK.scim, projectId: PROJECT.atlas, title: 'Spike: SCIM provisioning for enterprise SSO',
      status: 'backlog', priority: 'medium', assignee: ME,
      labels: ['auth', 'sso', 'enterprise', 'spike'], createdAt: back(26, 5),
      description: 'Follow-up from ADR-012. A three-day spike: what SCIM would take, how deprovisioning revokes refresh tokens, and which Enterprise customers are asking (Halden and Meridian so far).',
    },
    {
      id: TSK.canvasCharts, projectId: PROJECT.atlas, title: 'Evaluate canvas rendering for dashboard charts',
      status: 'cancelled', priority: 'low', assignee: ME,
      labels: ['performance', 'frontend'], createdAt: back(17, 2), updatedAt: back(3, 4),
      description: '**Cancelled.** Lazy-loading charts in the bundle-size work brought the dashboard under budget, and canvas charts would cost accessibility (screen-reader tables, keyboard focus).',
    },
    {
      id: TSK.reviewSla, projectId: PROJECT.atlas, title: 'Timebox PR reviews to one business day (trial)',
      status: 'in_progress', priority: 'medium', assignee: ME, dueAt: ahead(8, 'd'),
      labels: ['process', 'code-review'], origin: MSG.retroTasks, updatedAt: back(5, 2),
      description: 'Trial from the Sprint 14 retro: a first response on every pull request within one business day, with a daily 30-minute review slot. Measure the median time to first review in Sprints 15 and 16, then keep or drop the rule at the Sprint 16 retro.',
      subtasks: [
        ['Add the expectation to the code review handbook', true],
        ['Baseline: median time to first review in Sprint 14', true],
        ['Review the numbers at the Sprint 16 retro', false],
      ],
    },
    {
      id: TSK.flakyQuarantine, projectId: PROJECT.atlas, title: 'Quarantine lane for flaky tests in CI',
      status: 'todo', priority: 'medium', assignee: ME, dueAt: ahead(6, 'd'),
      labels: ['ci', 'testing', 'process'], origin: MSG.retroTasks,
      description: `
**Acceptance criteria**
- [ ] A non-blocking CI job runs tests tagged \`@flaky\`
- [ ] Every quarantined test has an owner and a 7-day expiry; expired tests fail the main build again
- [ ] The checkout e2e test is the first entry
- [ ] A weekly list of quarantined tests posted to #eng`,
    },

    // ------------------------------------------------------------ Q4 Competitive Landscape
    {
      id: TASK.competitorBrief, projectId: PROJECT.landscape, title: 'Competitor brief for board deck',
      status: 'todo', priority: 'high', assignee: SCOUT, milestoneId: MILESTONE.landBrief, dueAt: ahead(5, 'd'),
      labels: ['research', 'competitive', 'board'], createdAt: back(2, 6),
      description: `
A one-page brief on Portbase, Freightly and ShipLoom for the board deck.

**For each competitor:** positioning in one line, where they beat us, where we beat them, threat level (low, medium, high) and our response.

**Sources:** the Portbase teardown, Freightly product notes, the Q3 win/loss notes and the churn interviews. Cite every claim, and mark anything that rests only on simulated web sources.`,
    },
    {
      id: TSK.battlecard, projectId: PROJECT.landscape, title: 'Write Portbase battlecard for sales',
      status: 'in_progress', priority: 'high', assignee: ME, milestoneId: MILESTONE.landBrief, dueAt: ahead(1, 'd'),
      labels: ['competitive', 'sales-enablement'], origin: MSG.battlecardTask,
      description: "Finish the battlecard drafted in *How does Portbase position against us?* with Ravi's team. Keep claims to what the teardown supports, and don't quote Portbase prices.",
      subtasks: [
        ['Draft from the teardown', true],
        ['Review with Ravi', false],
        ['Add two customer proof points', false],
        ['Publish to the sales wiki', false],
      ],
    },
    {
      id: TSK.freightlyPricing, projectId: PROJECT.landscape, title: "Review Freightly's per-load pricing page",
      status: 'todo', priority: 'medium', assignee: ME, dueAt: ahead(3, 'd'),
      labels: ['competitive', 'pricing'], createdAt: back(12, 5),
      description: 'Follow-up from the Freightly product notes. Capture their tiers, spend caps and notification thresholds, and compare them with the Lumen bill-shock guardrails.',
    },
    {
      id: TSK.shiploomInterviews, projectId: PROJECT.landscape, title: 'Interview three deals lost to ShipLoom',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.landReview, dueAt: ahead(10, 'd'),
      labels: ['win-loss', 'research'], createdAt: back(7, 2),
      description: 'Larchfield Logistics from Q3, plus two earlier losses. Focus on price sensitivity versus missing features, and whether Lumen changes the conversation at the low end.',
    },
    {
      id: TSK.radar, projectId: PROJECT.landscape, title: 'Set up the weekly competitor radar workflow',
      status: 'done', priority: 'medium', assignee: ME,
      labels: ['automation', 'research'], createdAt: back(15, 2), completedAt: back(9, 4),
      description: 'A weekly workflow: Scout searches for competitor news and changelog updates, writes a summary to Knowledge and notifies me.\n\n**Done:** the first run completed. Web results are simulated in this workspace.',
    },
    {
      id: TSK.churnReview, projectId: PROJECT.landscape, title: 'Review churn research draft',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ahead(5, 'h'),
      labels: ['churn', 'research', 'review'], origin: ref('investigation', INVESTIGATION.churn), createdAt: back(2, 1),
      description: "Scout's draft report *Why do logistics customers churn?* is ready for review. Check the findings against the interview notes, decide what goes into the Q4 readout, and mark the investigation complete.",
    },
    {
      id: TSK.analystReport, projectId: PROJECT.landscape, title: 'Commission a paid analyst report on freight portals',
      status: 'cancelled', priority: 'low', assignee: ME,
      labels: ['research', 'budget'], createdAt: back(20, 3), updatedAt: back(11, 2),
      description: '**Cancelled.** Not worth the spend this quarter: the competitor radar, the Portbase teardown and our own win/loss interviews cover what the board brief needs.',
    },

    // ------------------------------------------------------------ Lumen Launch
    {
      id: TASK.heroVideo, projectId: PROJECT.lumen, title: 'Storyboard the launch hero video',
      status: 'in_progress', priority: 'high', assignee: MUSE, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(3, 'd'),
      labels: ['launch', 'video', 'creative'], createdAt: back(5, 2), updatedAt: back(0, 0, 20),
      description: `
A 45-second hero video for the landing page and the keynote opener.

**Brief**
- Story: night port → the Monday spreadsheet → Lumen → exceptions caught early → tagline
- Follow the messaging house (pillars 1 and 2) and the brand voice guide
- 8 shots with narration timing, plus a version without narration for social cutdowns
- Deliver to the *Lumen launch visuals* board for Aisha's review

**Status:** the v1 storyboard is on the board; v2 adds narration timing and the no-narration cut.`,
      subtasks: [
        ['Shot list and v1 storyboard', true],
        ['Narration script and timing', true],
        ["v2 storyboard with Aisha's notes", false],
        ['No-narration cut for social', false],
      ],
    },
    {
      id: TSK.pricingLock, projectId: PROJECT.lumen, title: 'Lock Lumen pricing & packaging',
      status: 'in_progress', priority: 'urgent', assignee: ME, milestoneId: MILESTONE.lumenPricing, dueAt: dates.pricingLock,
      labels: ['pricing', 'decision', 'launch'], createdAt: back(18, 5), updatedAt: back(0, 0, 37),
      description: `
The final decision on Lumen tiers, overage, guardrails and the design-partner offer. See the **Pricing strategy memo (draft)**.

**Open questions**
1. Core/Pro break-even: option A (feature gating only) or option B (Core capped at 6,000 active shipments, overage $0.15)
2. Scorecards in Core: full, read-only monthly, or Pro only
3. The Enterprise floor of $40,000 a year

**Sign-off:** Grace Holloway and Owen Fitzgerald.`,
      subtasks: [
        ['Pressure-test the tiers against beta volumes', true],
        ['Feature-gating proposal from beta usage', true],
        ['Outside evidence: usage-based pricing research', false],
        ['Revenue scenarios from Ledger', false],
        ['Sign-off with Grace and Owen', false],
      ],
    },
    {
      id: TSK.launchEmail, projectId: PROJECT.lumen, title: 'Draft launch email to existing customers',
      status: 'review', priority: 'high', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(2, 'd'),
      labels: ['launch', 'email', 'copy'], createdAt: back(9, 2), updatedAt: back(1, 3),
      description: 'The draft is in Studio (*Launch email — existing customers*). Aisha is reviewing the tone, and legal checks the "no surprise charges" line against the pricing guardrails.',
    },
    {
      id: TSK.salesBrief, projectId: PROJECT.lumen, title: 'Brief sales team on Lumen pricing',
      status: 'todo', priority: 'high', assignee: ME, milestoneId: MILESTONE.lumenLaunch, dueAt: ahead(8, 'd'),
      labels: ['sales-enablement', 'pricing', 'launch'], origin: MSG.launchTasks,
      description: "Blocked by the pricing lock. Cover the tiers, what not to quote yet, the design-partner offer and the Portbase talk tracks. 30 minutes with Ravi's team, recorded for later hires.",
    },
    {
      id: TSK.heroCopy, projectId: PROJECT.lumen, title: 'Finalize hero copy for landing page',
      status: 'in_progress', priority: 'high', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(1, 'd'),
      labels: ['copy', 'landing-page', 'launch'], createdAt: back(3, 2), updatedAt: back(0, 3, 8),
      description: 'Variant 3b selected: "From spreadsheet Mondays to answers in minutes." Aisha reviews it next to the visuals, then it goes to the landing page build.',
      subtasks: [
        ['Five directions', true],
        ['Tighten options 2 and 3', true],
        ['Aisha review', false],
        ['Hand off to the landing page build', false],
      ],
    },
    {
      id: TSK.meridianQuote, projectId: PROJECT.lumen, title: "Get Meridian's launch quote approved",
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(6, 'd'),
      labels: ['customer', 'launch', 'proof'], createdAt: back(9, 2),
      description: "Dana Whitfield agreed in principle on the customer call. Ravi sends the wording and Meridian's legal team approves it. Needed for the landing page, keynote slide 3 and the social quote card.",
    },
    {
      id: TSK.webinar, projectId: PROJECT.lumen, title: 'Schedule launch webinar',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenLaunch, dueAt: ahead(7, 'd'),
      labels: ['launch', 'webinar'], origin: MSG.launchTasks,
      description: '30 minutes plus Q&A during the customer preview, reusing the keynote. Invite admins and ops leads at Growth and Enterprise accounts.',
    },
    {
      id: TSK.betaFixes, projectId: PROJECT.lumen, title: 'Ship beta feedback fixes (alert thresholds)',
      status: 'done', priority: 'high', assignee: ME, milestoneId: MILESTONE.lumenBeta,
      labels: ['beta', 'alerts'], createdAt: back(24, 3), completedAt: back(10, 5),
      description: "Alerts now default to each account's 30-day baseline (feedback from Brightwater and Meridian). Added a dwell-time tooltip and glossary entry (Pinecrest).",
    },
    {
      id: TSK.keynoteReview, projectId: PROJECT.lumen, title: 'Review keynote deck v2',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(5, 'd'),
      labels: ['launch', 'keynote'], createdAt: back(4, 6),
      description: 'Studio: *Lumen launch keynote*. Check the story arc, the pricing slide (no prices until the lock) and the Meridian quote (pending approval).',
    },
    {
      id: TSK.helpCenter, projectId: PROJECT.lumen, title: 'Write five Lumen help-center articles',
      status: 'backlog', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenLaunch,
      labels: ['docs', 'support', 'launch'], createdAt: back(8, 5),
      description: 'Getting started; reading carrier scorecards; setting alert thresholds; what counts as an active shipment; exporting data.',
    },
    {
      id: TSK.socialCutdowns, projectId: PROJECT.lumen, title: 'Create social cutdowns from the hero video',
      status: 'backlog', priority: 'medium', assignee: MUSE, milestoneId: MILESTONE.lumenAssets,
      labels: ['social', 'video', 'launch'], createdAt: back(4, 1),
      description: 'Square and vertical cutdowns from the no-narration version of the hero video, for launch week. Starts once storyboard v2 is approved.',
    },
    {
      id: TSK.launchDate, projectId: PROJECT.lumen, title: 'Confirm launch date with leadership',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['launch', 'planning'], createdAt: back(19, 4), completedAt: back(14, 2),
      description: `Confirmed with Grace: public launch on ${dayLabel(dates.launch)}, customer preview two weeks earlier.`,
    },
    {
      id: TSK.revenueModel, projectId: PROJECT.lumen, title: 'Model Lumen revenue scenarios',
      status: 'todo', priority: 'high', assignee: LEDGER, milestoneId: MILESTONE.lumenPricing, dueAt: ahead(3, 'd'),
      labels: ['pricing', 'finance', 'analysis'], origin: MSG.pricingScenarios, updatedAt: back(3, 3),
      description: `
Compare monthly recurring revenue under option A (the draft tiers) and option B (Core capped at 6,000 active shipments, overage $0.15) across all Growth and Enterprise accounts, using read-only queries.

**Output:** a table by account and a summary for the pricing memo: who changes tier, the MRR difference, and the largest bill increases.`,
    },
    {
      id: TSK.betaUsage, projectId: PROJECT.lumen, title: 'Pull Lumen beta usage by account',
      status: 'done', priority: 'medium', assignee: LEDGER,
      labels: ['beta', 'analysis'], createdAt: back(6, 4), completedAt: back(4, 9),
      description: 'Weekly active users, dashboard views and feature usage for the eight design partners, exported as a CSV for the pricing discussion.',
    },

    // ------------------------------------------------------------ Support Ops Automation
    {
      id: TASK.weeklyDigest, projectId: PROJECT.ops, title: 'Send weekly project digest',
      status: 'in_progress', priority: 'medium', assignee: HERALD, dueAt: ahead(3, 'h'),
      labels: ['digest', 'comms', 'recurring'], createdAt: back(20, 2), updatedAt: back(0, 0, 45),
      description: `
Every Monday, summarize the week across Atlas Portal v2, Lumen Launch and Support Ops Automation.

- Shipped, slipped, decisions and risks, in under 250 words
- No personal data
- Post to #product-updates in Slack **after approval**`,
    },
    {
      id: TASK.triageRubric, projectId: PROJECT.ops, title: 'Finalize triage rubric v2',
      status: 'review', priority: 'high', assignee: ME, milestoneId: MILESTONE.opsTriage, dueAt: ahead(4, 'h'),
      labels: ['support', 'triage', 'rubric'], origin: MSG.triageTask, updatedAt: back(0, 6),
      description: 'Add the billing urgency rule, review the remaining shadow-week misses with Theo, then switch Sentinel to v2. Doc: **Support triage rubric v2**.',
      subtasks: [
        ['Shadow week with Sentinel (41 of 46 agreed)', true],
        ['Add the billing urgency rule', true],
        ['Review the two remaining misses with Theo', false],
        ['Switch Sentinel to v2', false],
      ],
    },
    {
      id: TSK.tagTickets, projectId: PROJECT.ops, title: 'Tag last 30 days of tickets with rubric v2 categories',
      status: 'todo', priority: 'medium', assignee: SENTINEL, milestoneId: MILESTONE.opsTriage, dueAt: ahead(5, 'd'),
      labels: ['support', 'data', 'triage'], createdAt: back(4, 3),
      description: 'Backfill v2 categories and severities on the last 30 days of tickets so the SLA report can compare before and after. Labels only: no customer replies and no Slack alerts.',
    },
    {
      id: TSK.slaUpdate, projectId: PROJECT.ops, title: 'Update SLA policy for enterprise tier',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ago(2, 'd'),
      labels: ['support', 'sla', 'enterprise'], createdAt: back(15, 2), updatedAt: back(6, 1),
      description: 'Enterprise renewals are asking for a 30-minute S1 first response, 24/7. Decide with Theo whether we can staff it, update the **Support SLA policy**, and align its severity definitions with rubric v2.',
    },
    {
      id: TSK.incidentSummaries, projectId: PROJECT.ops, title: 'Auto-draft incident summaries from status-page updates',
      status: 'backlog', priority: 'medium', assignee: ME, milestoneId: MILESTONE.opsIncidents,
      labels: ['automation', 'incidents'], createdAt: back(8, 3),
      description: 'When a status-page incident is resolved, an agent drafts a summary in the incident report format (impact, timeline, root cause, actions) for a person to edit. It never posts on its own.',
    },
    {
      id: TSK.supportInbox, projectId: PROJECT.ops, title: 'Connect the support inbox to the triage workflow',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['automation', 'support', 'integration'], createdAt: back(30, 2), completedAt: back(26, 4),
      description: 'The support inbox (simulated Gmail connection) now feeds the *Support triage* workflow, where Sentinel labels and routes every ticket.',
    },
    {
      id: TSK.haldenFollowUp, projectId: PROJECT.ops, title: 'Follow up with Halden Logistics once the SSO fix ships',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ahead(2, 'd'),
      labels: ['customer', 'escalation', 'sso'], createdAt: back(2, 2, 50),
      description: "Ticket #4821. Once the fix is on staging, ask Halden's admin to verify it with IdP-initiated sign-in, then confirm the release date. Their renewal is in under four months.",
    },
    {
      id: TSK.postmortem, projectId: PROJECT.ops, title: 'Write postmortem for checkout latency incident',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['incident', 'postmortem'], createdAt: back(10, 8), completedAt: back(9, 7, 55),
      description: 'Blameless postmortem drafted in chat, corrected, and saved to Knowledge with five action items.',
    },

    // ------------------------------------------------------------ Field Notes
    {
      id: TSK.rustWeek1, projectId: PROJECT.fieldNotes, title: 'Rust week 1: ownership exercises',
      status: 'done', priority: 'low', assignee: ME, milestoneId: MILESTONE.notesRust,
      labels: ['rust', 'learning'], origin: MSG.rustSaved, completedAt: back(12, 10),
      subtasks: [
        ['Rewrite three small TypeScript utilities in Rust', true],
        ['Trigger E0502 on purpose and explain it', true],
        ['Return a &str slice from a function without cloning', true],
      ],
    },
    {
      id: TSK.rustWeek3, projectId: PROJECT.fieldNotes, title: 'Rust week 3: build the CLI log parser',
      status: 'in_progress', priority: 'low', assignee: ME, milestoneId: MILESTONE.notesRust, dueAt: ahead(3, 'd'),
      labels: ['rust', 'learning', 'project'], createdAt: back(5, 10), updatedAt: back(2, 9),
      subtasks: [
        ['Parse log lines into a struct', true],
        ['Error handling with Result and ?', true],
        ['Summary output by status code', false],
      ],
    },
    {
      id: TSK.agentsTalk, projectId: PROJECT.fieldNotes, title: 'Turn agent reliability notes into an all-hands talk',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.notesTalk, dueAt: ahead(12, 'd'),
      labels: ['agents', 'talk', 'writing'], origin: MSG.agentsTalk,
      description: 'Fifteen minutes, seven sections, built from the outline in *Notes on agent reliability patterns*. Rehearse once with Priya.',
    },

    // ------------------------------------------------------------ No project
    {
      id: TSK.okrReview, projectId: null, title: 'Review Q1 OKR draft with Grace',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ahead(4, 'd'),
      labels: ['okrs', 'planning', 'leadership'], origin: MSG.okrsSaved,
      subtasks: [
        ["Align O1 with Ravi's sales targets", false],
        ['Confirm the time-to-first-value baseline with Marcus', false],
      ],
    },
    {
      id: TSK.jobPost, projectId: null, title: 'Post senior frontend engineer role',
      status: 'todo', priority: 'medium', assignee: ME, dueAt: ahead(3, 'd'),
      labels: ['hiring'], origin: MSG.hiringTask,
      description: "Use the \"What you'll do\" draft from *Interview loop for a senior frontend engineer*; add requirements and the interview loop overview.",
    },
    {
      id: TSK.expenses, projectId: null, title: 'Submit monthly expense report',
      status: 'todo', priority: 'low', assignee: ME, dueAt: ago(1, 'd'),
      labels: ['admin'], createdAt: back(9, 1),
    },
    {
      id: TSK.oneOnOne, projectId: null, title: 'Prepare 1:1 agenda with Grace',
      status: 'done', priority: 'medium', assignee: ME,
      labels: ['leadership'], createdAt: back(2, 8), completedAt: back(1, 5),
      description: 'Pricing decision path, Halden escalation, hiring plan for the portal team.',
    },
    {
      id: TSK.conference, projectId: null, title: 'Register for the logistics technology conference',
      status: 'cancelled', priority: 'low', assignee: ME,
      labels: ['events'], createdAt: back(21, 3), updatedAt: back(13, 2),
      description: '**Cancelled.** It clashes with launch week.',
    },
  ]

  const orderByStatus = new Map<TaskStatus, number>()
  return specs.map((s) => {
    const origin: EntityRef | undefined =
      typeof s.origin === 'string' ? ref('message', s.origin) : s.origin
    const createdAt = s.createdAt ?? (typeof s.origin === 'string' ? afterMsg(s.origin) : back(10))
    const completedAt = s.status === 'done' ? (s.completedAt ?? s.updatedAt ?? createdAt) : undefined
    const updatedAt = Math.max(createdAt, s.updatedAt ?? completedAt ?? createdAt)
    const order = (orderByStatus.get(s.status) ?? 0) + 1000
    orderByStatus.set(s.status, order)
    const task: Task = {
      id: s.id,
      projectId: s.projectId,
      title: s.title,
      ...(s.description ? { description: s.description.trim() } : {}),
      status: s.status,
      priority: s.priority,
      assignee: s.assignee ?? null,
      ...(s.milestoneId ? { milestoneId: s.milestoneId } : {}),
      ...(s.dueAt !== undefined ? { dueAt: s.dueAt } : {}),
      labels: s.labels,
      subtasks: (s.subtasks ?? []).map(([title, done], i) => ({ id: `${s.id}_s${i + 1}`, title, done })),
      ...(origin ? { origin } : {}),
      runIds: [],
      order,
      createdAt,
      updatedAt,
      ...(completedAt !== undefined ? { completedAt } : {}),
    }
    return task
  })
}
