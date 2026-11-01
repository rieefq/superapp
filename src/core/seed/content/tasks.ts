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

export function buildTasks({ clock, dates, at }: SeedCtx, messages: Record<ID, Message>): Task[] {
  const { back, ago, ahead, wd, day } = clock
  /** Tasks created from a message appear a minute after it. */
  const afterMsg = (id: ID): number => (messages[id]?.createdAt ?? day(30, 10, 0)) + MINUTE
  const flakyCreated = wd(7, 9, 0)

  const specs: TaskSpec[] = [
    // ------------------------------------------------------------ Atlas Portal v2
    {
      id: TASK.ssoFix, projectId: PROJECT.atlas, title: 'Fix session expiry after SSO login',
      status: 'review', priority: 'high', assignee: FORGE, milestoneId: MILESTONE.atlasGa, dueAt: ahead(1, 'd'),
      labels: ['bug', 'auth', 'sso', 'customer-escalation'], origin: MSG.ssoTask, updatedAt: at.ssoTurn2 + 12 * MINUTE,
      description: `
**Problem.** Users whose identity provider issues shorter tokens on refresh are signed out about an hour after SSO sign-in. The refresh timer reuses the lifetime of the sign-in token, so after the first refresh the next one is scheduled too late (ADR-012). Reported by Meridian Freight; Halden Logistics has seen it for weeks.

**Acceptance criteria**
- [ ] Every refresh is scheduled from the expiry of the token currently held; no lifetime is remembered from sign-in
- [ ] Regression test: after a refresh, the next one follows the refreshed token's lifetime
- [ ] Regression test: six hours of 15-minute tokens never let the session outlive its token
- [ ] Both tests fail on \`main\` and pass with the fix
- [ ] No change to \`REFRESH_LEAD_MS\`, to 401 handling or to the public API
- [ ] Verified on staging with Meridian's and Halden's session policies`,
      subtasks: [
        ["Schedule each refresh from the held token's expiry", true],
        ["Regression test: the refreshed token's lifetime", true],
        ['Regression test: six hours of 15-minute tokens', true],
        ["Verify on staging with Meridian's and Halden's policies", false],
      ],
    },
    {
      id: TASK.stripeMigration, projectId: PROJECT.atlas, title: 'Migrate invoices to Stripe Billing',
      status: 'in_progress', priority: 'high', assignee: FORGE, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(6, 'd'),
      labels: ['billing', 'stripe', 'migration', 'frontend'], createdAt: wd(12, 10, 0), updatedAt: back(0, 0, 25),
      description: `
Move the portal's invoice views from the legacy invoicing service to Stripe Billing, following phase 1 of the **Stripe Billing migration plan**.

**Acceptance criteria**
- [ ] \`src/billing/stripe.ts\` maps Stripe invoices to the portal's Invoice type, with amounts in integer minor units
- [ ] \`src/api/invoices.ts\` picks the source with \`VITE_FLAG_STRIPE_BILLING\`; legacy stays the default
- [ ] Mapping and pagination tests pass
- [ ] Currency comes from the Stripe invoice, never from a default
- [ ] No secrets in the browser: Stripe is reached only through portal-api

**Notes**
- Forge mapped the legacy invoicing calls first; three call sites move behind the flag.
- Installing the \`stripe\` package runs a shell command in the session, which needs your approval.`,
      subtasks: [
        ['Map the legacy invoicing calls in the portal', true],
        ['Map accounts to Stripe customers', true],
        ['Add the stripe package and the invoice adapter behind the flag', false],
        ['Mapping and pagination tests', false],
        ['Backfill open invoices and history', false],
        ['Reconcile two consecutive billing cycles per customer', false],
      ],
    },
    {
      id: TASK.bundleSize, projectId: PROJECT.atlas, title: 'Reduce dashboard bundle size',
      status: 'done', priority: 'medium', assignee: FORGE, milestoneId: MILESTONE.atlasPerf,
      labels: ['performance', 'frontend'], createdAt: wd(12, 16, 0), completedAt: at.bundleMerged + 15 * MINUTE,
      description: `
The dashboard took more than 4 seconds to become interactive on a mid-range laptop: the entry chunk carried every page plus the chart library.

**Acceptance criteria**
- [x] Every route is its own lazy chunk
- [x] The volume chart and its chart library load after first paint
- [x] The chunk-size warning limit is back at 450 kB, so regressions show up in the build
- [x] No behaviour change; typecheck, lint, unit and e2e pass

**Result:** initial JS for the dashboard went from 912 kB to 348 kB (−62%). Merged as PR #214.`,
      subtasks: [
        ['Find what lands in the entry chunk', true],
        ['Split routes into lazy chunks', true],
        ['Lazy-load the volume chart', true],
        ['Restore a real chunk budget', true],
      ],
    },
    {
      id: TASK.flakyTest, projectId: PROJECT.atlas, title: 'Fix flaky checkout e2e test',
      status: 'todo', priority: 'high', assignee: FORGE, dueAt: ahead(2, 'd'),
      labels: ['testing', 'ci', 'flaky', 'checkout'], createdAt: flakyCreated, updatedAt: at.flakyTurn2 + 20 * MINUTE,
      description: `
The checkout e2e spec fails on CI about one run in ten (6 failures in Sprint 14).

**What we know so far**
- Forge's first pass replaced a fixed 3-second wait and a one-shot \`textContent()\` read with a web-first assertion. The spec passed.
- A 20× repeat run still failed once: poll responses can arrive out of order in \`Checkout.tsx\`, so a stale "pending" response can overwrite "confirmed". That needs an app fix, not a test fix.

**Acceptance criteria**
- [ ] \`Checkout.tsx\` ignores poll responses older than the latest one it has applied
- [ ] A unit test covers out-of-order responses
- [ ] No fixed sleeps anywhere in the spec
- [ ] 20 consecutive repeat runs pass on CI`,
    },
    {
      id: TSK.runbook, projectId: PROJECT.atlas, title: 'Write migration runbook for Stripe cutover',
      status: 'todo', priority: 'high', assignee: ME, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(5, 'd'),
      labels: ['billing', 'stripe', 'runbook'], origin: MSG.stripeTasks, updatedAt: at.chat.stripeRisks + 43 * MINUTE,
      description: `
Step-by-step runbook for the first Stripe Billing cohort on ${dayLabel(dates.cutover)}, reused for every later cohort.

1. The per-customer flag flip, with a freeze window and comms owner for each cohort
2. Reconciliation checks: totals, currency and duplicates
3. Rollback: the flag off for that customer, legacy dunning back on
4. Support macros for the first Stripe invoices
5. Database safety from the checkout incident: EXPLAIN for new queries, the \`stripe_invoice_id\` index before the backfill, reconciliation on the read replica`,
      subtasks: [
        ['Flag flip, freeze window and comms owner per cohort', false],
        ['Reconciliation checks: totals, currency, duplicates', false],
        ['Rollback steps', false],
        ['Support macros', false],
        ['Database safety checks from the incident', false],
      ],
    },
    {
      id: TSK.numbering, projectId: PROJECT.atlas, title: 'Decide invoice numbering scheme after cutover',
      status: 'in_progress', priority: 'medium', assignee: ME, milestoneId: MILESTONE.atlasBilling, dueAt: ahead(2, 'd'),
      labels: ['billing', 'decision'], origin: MSG.stripeTasks, updatedAt: wd(2, 16, 0),
      description: `
Decide whether Stripe continues the \`NW-\` invoice sequence or starts a fresh series.

- **Decision owner:** Owen Fitzgerald (RevOps). **Consulted:** Daniel Okafor.
- **Proposal:** continue the sequence and record the boundary (last legacy number, first Stripe number) in the cutover memo for each cohort.
- **Deadline:** before the first cohort.`,
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
      labels: ['reliability', 'ci', 'database'], origin: MSG.incidentTasks,
      description: `
Incident follow-up 2 (owner: Priya Natarajan; tracked here).

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
      labels: ['reliability', 'monitoring', 'checkout'], origin: MSG.incidentTasks, completedAt: wd(5, 16, 0),
      description: 'Incident follow-up 1. Page on-call when checkout p95 latency stays above 2 s for 5 minutes.\n\n**Done:** the alert is live and was tested with a synthetic slow checkout on staging.',
    },
    {
      id: TSK.carrierMap, projectId: PROJECT.atlas, title: 'Lazy-load the carrier map on the shipments page',
      status: 'backlog', priority: 'low', assignee: ME, milestoneId: MILESTONE.atlasPerf,
      labels: ['performance', 'frontend'], createdAt: wd(3, 11, 30),
      description: "The carrier map is the next suspect for the shipments board's ~2.1 s p95 (weekly product sync). Profile first; if confirmed, lazy-load the map below the fold.",
    },
    {
      id: TSK.rateLimits, projectId: PROJECT.atlas, title: 'Audit public API rate limits for large nightly syncs',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.atlasGa, dueAt: ahead(8, 'd'),
      labels: ['api', 'reliability'], createdAt: at.haldenRateLimitEmail + 55 * MINUTE,
      description: "Halden's nightly sync hit 429s on `/v1/shipments` while paging about 40,000 shipments (SUP-417). Check that `updated_since` and `batchGet` cover their use case, add the guidance to **Public API rate limits**, and decide whether Growth needs a higher daily cap. Changing a plan's default limits needs an ADR.",
    },
    {
      id: TSK.scim, projectId: PROJECT.atlas, title: 'Spike: SCIM provisioning for enterprise SSO',
      status: 'backlog', priority: 'medium', assignee: ME,
      labels: ['auth', 'sso', 'enterprise', 'spike'], createdAt: day(26, 11, 0),
      description: 'Follow-up from ADR-012. A three-day spike: what SCIM would take, how deprovisioning revokes refresh tokens, and which Enterprise customers are asking.',
    },
    {
      id: TSK.canvasCharts, projectId: PROJECT.atlas, title: 'Evaluate canvas rendering for dashboard charts',
      status: 'cancelled', priority: 'low', assignee: ME,
      labels: ['performance', 'frontend'], createdAt: wd(13, 15, 0), updatedAt: at.bundleMerged + 60 * MINUTE,
      description: '**Cancelled.** Lazy-loading the chart in the bundle-size work brought the dashboard under budget, and canvas charts would cost accessibility (screen-reader tables, keyboard focus).',
    },
    {
      id: TSK.prLimit, projectId: PROJECT.atlas, title: 'Make the PR review assistant ask for a split above 600 lines',
      status: 'done', priority: 'medium', assignee: ME,
      labels: ['process', 'code-review'], origin: MSG.retroTasks, completedAt: wd(9, 15, 0),
      description: 'From the Sprint 14 retro: no PRs over 600 changed lines. The PR review assistant now asks for a split above that, and the code review handbook and README say so.',
    },
    {
      id: TSK.sameDayTickets, projectId: PROJECT.atlas, title: 'Ticket every flaky test the same day',
      status: 'done', priority: 'medium', assignee: ME,
      labels: ['ci', 'testing', 'process'], origin: MSG.retroTasks, completedAt: flakyCreated + 10 * MINUTE,
      description: 'From the Sprint 14 retro. Added a "flaky test" issue template and a CI hint that links to it from failed runs. First ticket: *Fix flaky checkout e2e test*.',
    },
    {
      id: TSK.focusMornings, projectId: PROJECT.atlas, title: 'Trial one meeting-free morning a week',
      status: 'in_progress', priority: 'low', assignee: ME, dueAt: ahead(4, 'd'),
      labels: ['process', 'team'], origin: MSG.retroTasks, updatedAt: wd(3, 9, 0),
      description: 'From the Sprint 14 retro: two sprints with no recurring meetings on one morning a week. Ask the team at the Sprint 16 retro whether to keep it.',
      subtasks: [
        ['Pick the morning and move recurring meetings', true],
        ['Ask for feedback at the Sprint 16 retro', false],
      ],
    },

    // ------------------------------------------------------------ Q4 Competitive Landscape
    {
      id: TASK.competitorBrief, projectId: PROJECT.landscape, title: 'Competitor brief for board deck',
      status: 'review', priority: 'high', assignee: SCOUT, milestoneId: MILESTONE.landBrief, dueAt: ahead(5, 'd'),
      labels: ['research', 'competitive', 'board'], createdAt: wd(5, 9, 0), updatedAt: at.scoutBriefRevision + 15 * MINUTE,
      description: `
A one-page brief on Tidewell, Freightly and ShipLoom for the board deck.

**For each competitor:** where they win, pricing and packaging side by side, moves in the last 90 days, where Atlas is exposed, and what we do next.

**Sources:** the Tidewell teardown, Freightly product notes and the market sizing. Cite every claim, and mark anything that rests only on simulated web sources.

**Status:** Scout drafted it, then revised it after your comments (ShipLoom added, history cut, the exposure section made blunter). Now about 410 words and waiting for your review.`,
    },
    {
      id: TSK.battlecard, projectId: PROJECT.landscape, title: 'Write Tidewell battlecard for sales',
      status: 'in_progress', priority: 'high', assignee: ME, milestoneId: MILESTONE.landBrief, dueAt: ahead(1, 'd'),
      labels: ['competitive', 'sales-enablement'], origin: MSG.battlecardTask,
      description: "Finish the battlecard drafted in *How does Tidewell position against us?* with Ravi's team. Keep claims to what the teardown and the radar support, and don't quote Tidewell prices.",
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
      labels: ['competitive', 'pricing'], createdAt: day(13, 10, 0),
      description: 'Follow-up from the Freightly product notes. Capture their three tiers, spend caps and notification thresholds, and compare them with the Lumen bill-shock guardrails. Scout checks the page daily for changes.',
    },
    {
      id: TSK.shiploomInterviews, projectId: PROJECT.landscape, title: 'Interview three deals lost to ShipLoom',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.landReview, dueAt: ahead(10, 'd'),
      labels: ['win-loss', 'research'], createdAt: at.scoutBriefRevision + 30 * MINUTE,
      description: 'Larchfield Logistics from Q3, plus two earlier losses. Focus on price sensitivity versus missing features, and whether ShipLoom’s EDI marketplace or upcoming e-invoicing support came up.',
    },
    {
      id: TSK.radar, projectId: PROJECT.landscape, title: 'Set up the weekly competitor radar workflow',
      status: 'done', priority: 'medium', assignee: ME,
      labels: ['automation', 'research'], createdAt: day(31, 10, 0), completedAt: day(29, 15, 0),
      description: 'A weekly workflow: Scout searches for competitor news and pricing changes, updates the related notes in Knowledge and notifies me.\n\n**Done:** it runs every Monday morning. Web results are simulated in this workspace.',
    },
    {
      id: TSK.churnReview, projectId: PROJECT.landscape, title: 'Review churn research draft',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ahead(5, 'h'),
      labels: ['churn', 'research', 'review'], origin: ref('investigation', INVESTIGATION.churn), createdAt: at.churn1 + 30 * MINUTE,
      description: "Scout's draft report *Why do logistics customers churn?* is ready for review. Check the findings against the interview notes, decide what goes into the Q4 readout, and mark the investigation complete.",
    },
    {
      id: TSK.analystReport, projectId: PROJECT.landscape, title: 'Commission a paid analyst report on freight portals',
      status: 'cancelled', priority: 'low', assignee: ME,
      labels: ['research', 'budget'], createdAt: day(20, 10, 0), updatedAt: day(11, 16, 0),
      description: '**Cancelled.** Not worth the spend this quarter: the competitor radar, the Tidewell teardown and our own win/loss notes cover what the board brief needs.',
    },

    // ------------------------------------------------------------ Lumen Launch
    {
      id: TASK.heroVideo, projectId: PROJECT.lumen, title: 'Storyboard the launch hero video',
      status: 'in_progress', priority: 'high', assignee: MUSE, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(3, 'd'),
      labels: ['launch', 'video', 'creative'], createdAt: at.heroCopyPick + 40 * MINUTE, updatedAt: back(0, 0, 20),
      description: `
A 45-second hero video for the landing page and the keynote opener, ending on the tagline "From tracking to knowing."

**Brief**
- Follow the messaging house and the brand voice guide
- Six beats with shot notes, then six storyboard frames
- A version without narration for social
- Deliver to the *Lumen launch visuals* board for Aisha's review

**Status:** Muse's beat sheet is on the board; the six storyboard frames are being generated now.`,
      subtasks: [
        ['Beat sheet with shot notes', true],
        ['Narration draft', true],
        ['Six storyboard frames', false],
        ['No-narration cut for social', false],
      ],
    },
    {
      id: TSK.pricingLock, projectId: PROJECT.lumen, title: 'Lock Lumen pricing & packaging',
      status: 'in_progress', priority: 'urgent', assignee: ME, milestoneId: MILESTONE.lumenPricing, dueAt: dates.pricingLock,
      labels: ['pricing', 'decision', 'launch'], createdAt: wd(13, 11, 5), updatedAt: back(0, 0, 37),
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
      labels: ['launch', 'email', 'copy'], createdAt: wd(8, 11, 0), updatedAt: wd(1, 14, 5),
      description: 'The draft is in Studio (*Launch email — existing customers*). Aisha finished her tone pass; legal checks the "no surprise charges" line against the pricing guardrails.',
    },
    {
      id: TSK.salesBrief, projectId: PROJECT.lumen, title: 'Brief sales team on Lumen pricing',
      status: 'todo', priority: 'high', assignee: ME, milestoneId: MILESTONE.lumenLaunch, dueAt: ahead(8, 'd'),
      labels: ['sales-enablement', 'pricing', 'launch'], origin: MSG.launchTasks,
      description: "Blocked by the pricing lock. Cover the tiers, what not to quote yet, the design-partner offer and the Tidewell talk tracks. 30 minutes with Ravi's team, recorded for later hires.",
    },
    {
      id: TSK.heroCopy, projectId: PROJECT.lumen, title: 'Finalize hero copy for landing page',
      status: 'in_progress', priority: 'high', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(1, 'd'),
      labels: ['copy', 'landing-page', 'launch'], createdAt: wd(9, 14, 0), updatedAt: at.heroCopyPick + 2 * MINUTE,
      description: '"From tracking to knowing." won the five-second test against "Fewer surprises at the dock." Aisha is tightening the subline, then it goes to the landing page build.',
      subtasks: [
        ['Six options from Muse', true],
        ['Test the top two with beta users', true],
        ['Aisha tightens the subline', false],
        ['Hand off to the landing page build', false],
      ],
    },
    {
      id: TSK.meridianQuote, projectId: PROJECT.lumen, title: "Get Meridian's launch quote approved",
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(6, 'd'),
      labels: ['customer', 'launch', 'proof'], createdAt: dates.meridianCall + 70 * MINUTE,
      description: "Dana Whitfield agreed in principle on the customer call. Ravi sends the wording and Meridian's legal team approves it. Needed for the landing page, keynote slide 3 and the quote cutdowns.",
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
      labels: ['beta', 'alerts'], createdAt: day(24, 10, 0), completedAt: wd(11, 16, 0),
      description: "Alerts now default to each account's 30-day baseline (feedback from Brightwater and Meridian). Added a dwell-time tooltip and glossary entry (Pinecrest).",
    },
    {
      id: TSK.keynoteReview, projectId: PROJECT.lumen, title: 'Review keynote deck v2',
      status: 'todo', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenAssets, dueAt: ahead(5, 'd'),
      labels: ['launch', 'keynote'], createdAt: wd(4, 10, 0),
      description: 'Studio: *Lumen launch keynote*. Check the story arc, the pricing slide (no prices until the lock) and the Meridian quote (pending approval).',
    },
    {
      id: TSK.helpCenter, projectId: PROJECT.lumen, title: 'Write five Lumen help-center articles',
      status: 'backlog', priority: 'medium', assignee: ME, milestoneId: MILESTONE.lumenLaunch,
      labels: ['docs', 'support', 'launch'], createdAt: wd(9, 11, 0),
      description: 'Getting started; reading carrier scorecards; setting alert thresholds; what counts as an active shipment; exporting data.',
    },
    {
      id: TSK.videoCutdowns, projectId: PROJECT.lumen, title: 'Cut 15-second versions of the hero video',
      status: 'backlog', priority: 'medium', assignee: MUSE, milestoneId: MILESTONE.lumenAssets,
      labels: ['social', 'video', 'launch'], createdAt: wd(5, 12, 0),
      description: 'Two 15-second cuts of the hero video (one per message) without narration, for launch week. Starts once the storyboard frames are approved.',
    },
    {
      id: TSK.launchDate, projectId: PROJECT.lumen, title: 'Confirm launch date with leadership',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['launch', 'planning'], createdAt: day(19, 10, 0), completedAt: day(14, 16, 0),
      description: `Confirmed with Grace: public launch on ${dayLabel(dates.launch)}, customer preview two weeks earlier.`,
    },
    {
      id: TSK.revenueModel, projectId: PROJECT.lumen, title: 'Model Lumen revenue scenarios',
      status: 'todo', priority: 'high', assignee: LEDGER, milestoneId: MILESTONE.lumenPricing, dueAt: ahead(3, 'd'),
      labels: ['pricing', 'finance', 'analysis'], origin: MSG.pricingScenarios, updatedAt: dates.sync + 4 * 60 * MINUTE,
      description: `
Compare monthly recurring revenue under option A (the draft tiers) and option B (Core capped at 6,000 active shipments, overage $0.15) across all Growth and Enterprise accounts, using read-only queries.

**Output:** a table by account and a summary for the pricing memo: who changes tier, the MRR difference, and the largest bill increases.`,
    },
    {
      id: TSK.betaUsage, projectId: PROJECT.lumen, title: 'Pull Lumen beta usage by account',
      status: 'done', priority: 'medium', assignee: LEDGER,
      labels: ['beta', 'analysis'], createdAt: dates.sync + 3 * 60 * MINUTE, completedAt: at.ledgerLumenUsage + 15 * MINUTE,
      description: 'Tracked shipments per beta account over the last 30 days, for the pricing decision.\n\n**Result:** 23 beta accounts. Usage is highly concentrated: the top three accounts are 61% of volume, and the median account sits well inside the first tier.',
    },

    // ------------------------------------------------------------ Support Ops Automation
    {
      id: TASK.weeklyDigest, projectId: PROJECT.ops, title: 'Send weekly project digest',
      status: 'in_progress', priority: 'medium', assignee: HERALD, dueAt: ahead(3, 'h'),
      labels: ['digest', 'comms', 'recurring'], createdAt: day(20, 9, 0), updatedAt: back(0, 0, 45),
      description: `
Every Monday, summarize the week across Atlas Portal v2, Lumen Launch, Q4 Competitive Landscape and Support Ops Automation.

- Shipped, slipped, decisions and risks, in under 250 words
- No personal data
- Post to #product in Slack **after approval**`,
    },
    {
      id: TASK.triageRubric, projectId: PROJECT.ops, title: 'Finalize triage rubric v2',
      status: 'review', priority: 'high', assignee: ME, milestoneId: MILESTONE.opsTriage, dueAt: ahead(4, 'h'),
      labels: ['support', 'triage', 'rubric'], origin: MSG.triageHandoff, updatedAt: wd(2, 11, 31),
      description: "Sentinel drafted **Support triage rubric v2** from last month's tickets and moved this task to Review. Add the billing rule, review the remaining comparison-week misses with Theo, then approve v2.",
      subtasks: [
        ["Sentinel's draft from last month's tickets", true],
        ['Comparison week with Theo (41 of 46 agreed)', true],
        ['Add the billing rule', true],
        ['Review the two remaining misses with Theo', false],
        ['Approve v2', false],
      ],
    },
    {
      id: TSK.tagTickets, projectId: PROJECT.ops, title: 'Tag last 30 days of tickets with rubric v2 categories',
      status: 'todo', priority: 'medium', assignee: SENTINEL, milestoneId: MILESTONE.opsTriage, dueAt: ahead(5, 'd'),
      labels: ['support', 'data', 'triage'], createdAt: wd(2, 12, 0),
      description: 'Backfill v2 priorities and categories on the last 30 days of tickets so the SLA report can compare before and after. Labels only: no customer replies and no Slack alerts.',
    },
    {
      id: TSK.slaUpdate, projectId: PROJECT.ops, title: 'Update SLA policy for enterprise tier',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ago(2, 'd'),
      labels: ['support', 'sla', 'enterprise'], createdAt: day(15, 10, 0), updatedAt: day(6, 11, 0),
      description: 'Enterprise renewals are asking for a 30-minute S1 first response, 24/7. Decide with Theo whether we can staff it, update the **Support SLA policy**, and map its severities to the rubric v2 priorities.',
    },
    {
      id: TSK.incidentSummaries, projectId: PROJECT.ops, title: 'Auto-draft incident summaries from status-page updates',
      status: 'backlog', priority: 'medium', assignee: ME, milestoneId: MILESTONE.opsIncidents,
      labels: ['automation', 'incidents'], createdAt: wd(7, 15, 0),
      description: 'When a status-page incident is resolved, an agent drafts a summary in the incident report format (impact, timeline, root cause, follow-ups) for a person to edit. It never posts on its own.',
    },
    {
      id: TSK.supportInbox, projectId: PROJECT.ops, title: 'Connect the support inbox to the triage workflow',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['automation', 'support', 'integration'], createdAt: day(32, 10, 0), completedAt: day(29, 12, 0),
      description: 'The support inbox (simulated Gmail connection) now feeds the *Support triage* workflow, where Sentinel classifies every email and alerts or files a Linear issue.',
    },
    {
      id: TSK.customerFollowUp, projectId: PROJECT.ops, title: 'Follow up with Meridian and Halden once the SSO fix ships',
      status: 'todo', priority: 'high', assignee: ME, dueAt: ahead(2, 'd'),
      labels: ['customer', 'escalation', 'sso'], createdAt: at.chat.ssoBug + 30 * MINUTE,
      description: "Once the fix is on staging, ask Meridian's and Halden's admins to verify it with their own session policies, then confirm the release date. Halden's renewal is in under four months.",
    },
    {
      id: TSK.postmortem, projectId: PROJECT.ops, title: 'Write postmortem for checkout latency incident',
      status: 'done', priority: 'high', assignee: ME,
      labels: ['incident', 'postmortem'], createdAt: wd(8, 17, 0), completedAt: at.chat.incident + 63 * MINUTE,
      description: 'The incident report written that evening, turned into a blameless postmortem in chat the next morning, with five follow-ups and owners.',
    },

    // ------------------------------------------------------------ Field Notes
    {
      id: TSK.rustWeek1, projectId: PROJECT.fieldNotes, title: 'Rust week 1: ownership exercises',
      status: 'done', priority: 'low', assignee: ME, milestoneId: MILESTONE.notesRust,
      labels: ['rust', 'learning'], origin: MSG.rustSaved, completedAt: day(12, 21, 0),
      subtasks: [
        ['Rewrite three small TypeScript utilities in Rust', true],
        ['Trigger E0502 on purpose and explain it', true],
        ['Return a &str slice from a function without cloning', true],
      ],
    },
    {
      id: TSK.rustWeek3, projectId: PROJECT.fieldNotes, title: 'Rust week 3: build the CLI log parser',
      status: 'in_progress', priority: 'low', assignee: ME, milestoneId: MILESTONE.notesRust, dueAt: ahead(3, 'd'),
      labels: ['rust', 'learning', 'project'], createdAt: day(6, 20, 0), updatedAt: day(2, 20, 35),
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
      labels: ['okrs', 'planning', 'leadership'], origin: MSG.okrsTask,
      subtasks: [
        ["Align O1 with Ravi's sales targets", false],
        ['Confirm the time-to-first-value baseline with Marcus', false],
      ],
    },
    {
      id: TSK.jobPost, projectId: null, title: 'Post senior frontend engineer role',
      status: 'todo', priority: 'medium', assignee: ME, dueAt: ahead(3, 'd'),
      labels: ['hiring'], origin: MSG.hiringTask,
      description: "Use the \"What you'll do\" draft from *Interview loop for a senior frontend engineer*; add requirements and the four-stage loop with the paid, timeboxed take-home.",
    },
    {
      id: TSK.expenses, projectId: null, title: 'Submit monthly expense report',
      status: 'todo', priority: 'low', assignee: ME, dueAt: ago(1, 'd'),
      labels: ['admin'], createdAt: day(9, 9, 0),
    },
    {
      id: TSK.oneOnOne, projectId: null, title: 'Prepare 1:1 agenda with Grace',
      status: 'done', priority: 'medium', assignee: ME,
      labels: ['leadership'], createdAt: day(2, 8, 30), completedAt: day(1, 9, 0),
      description: 'Pricing decision path, the Meridian SSO escalation, hiring plan for the portal team.',
    },
    {
      id: TSK.conference, projectId: null, title: 'Register for the logistics technology conference',
      status: 'cancelled', priority: 'low', assignee: ME,
      labels: ['events'], createdAt: day(21, 10, 0), updatedAt: day(13, 12, 0),
      description: '**Cancelled.** It clashes with launch week.',
    },
  ]

  const orderByStatus = new Map<TaskStatus, number>()
  return specs.map((s) => {
    const origin: EntityRef | undefined =
      typeof s.origin === 'string' ? ref('message', s.origin) : s.origin
    const createdAt = s.createdAt ?? (typeof s.origin === 'string' ? afterMsg(s.origin) : day(10, 10, 0))
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
