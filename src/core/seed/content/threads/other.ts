import { KNOWLEDGE, PROJECT, THREAD } from '../../ids'
import { ai, dayLabel, kref, MINUTE, textAttachment, user, type SeedCtx, type ThreadSpec } from '../helpers'
import { KNO } from '../keys'

const SEC = 1_000

const INCIDENT_NOTES = `checkout incident: raw notes (UTC)
13:20 deploy portal 2.2.1 (balance banner, PR #211)
~14:00 latency creeping up? (only seen in hindsight)
14:11 db cpu > 90% alert in #infra-alerts (nobody paged)
14:19 Coastal Cargo emails support: checkout spinning
14:24 Theo escalates, incident channel opened, Priya IC
14:33 slow query log -> getOpenInvoices() seq scan on invoice_events
14:41 flag checkout.balanceBanner OFF
14:49 p95 < 1s, resolved
impact: p95 9.4s peak, ~3.1% checkouts timed out, 14 tickets, no dup payments
next: index (account_id, status, created_at) concurrently in the morning`

export function landscapeThreads({ clock, at }: SeedCtx): ThreadSpec[] {
  const { wd } = clock
  const first = at.chat.tidewell
  const start = at.tidewell1 - 6 * MINUTE
  return [
    {
      id: THREAD.tidewell,
      title: 'How does Tidewell position against us?',
      projectId: PROJECT.landscape,
      contextRefs: [kref(KNOWLEDGE.tidewellTeardown), kref(KNO.winloss)],
      turns: [
        user('msg_tidewell_01', first - MINUTE, `Sales keeps hearing that Tidewell does this out of the box. What do we actually know about how Tidewell positions against us?`),
        ai('msg_tidewell_02', first + 40 * SEC, 'sim-deep', `
Less than we should. Here's what Knowledge has today:

### What our notes say
- **Market sizing:** Tidewell sells mostly to large enterprise shippers, which puts most of its customers outside our mid-market definition. The overlap appears when a forwarder starts working for an enterprise shipper.
- **Freightly notes:** when a broker grows into enterprise customers, the incumbent we meet is usually Tidewell, not Freightly.

### What we don't know
- How Tidewell prices and packages, and whether analytics are bundled
- Where its product is strong or weak compared with Atlas: tracking, invoicing, analytics
- Where its customers say it wins and loses

### Suggestion
Run a standard-depth investigation with four angles: who Tidewell sells to and how it describes the problem; pricing and packaging, public and reported; product gaps against Atlas (tracking, invoicing, analytics); and where customers say Tidewell wins and loses. Include the market sizing and the Freightly notes as knowledge sources, so the outside view is checked against what we already know.`, {
          searched: [KNOWLEDGE.marketSizing, KNOWLEDGE.freightlyNotes],
          cites: [
            [KNOWLEDGE.marketSizing, 'Large enterprise shippers, where Tidewell sells most of its contracts, are outside this definition.'],
            [KNOWLEDGE.freightlyNotes, 'When a broker starts serving enterprise shippers, the incumbent we meet is usually Tidewell, not Freightly.'],
          ],
        }),
        user('msg_tidewell_03', start, `Let's run that investigation now, with those four angles.`),
        ai('msg_tidewell_04', start + MINUTE, 'sim-swift', `
Started **Tidewell positioning & pricing** in Research (standard depth, 4 angles). Scout is running it:

1. Who Tidewell sells to and how it describes the problem
2. Pricing and packaging, public and reported
3. Product gaps compared with Atlas: tracking, invoicing, analytics
4. Where customers say Tidewell wins and loses

The market sizing and Freightly notes are included as knowledge sources. Web sources in this workspace come from the simulated search corpus and are labeled as simulated in the report. You'll get the findings and a draft report to review.`),
        user('msg_tidewell_05', wd(1, 10, 30), `The teardown is in, plus two radar updates since. Give me the three things a rep should say when a prospect brings up Tidewell.`),
        ai('msg_tidewell_06', wd(1, 10, 31), 'sim-deep', `
## Three talk tracks for Tidewell

**1. "Customs is their home turf. The daily operation is ours."**
Concede customs: Tidewell is genuinely strong at filings and document checks. Then move to what an operations team does every day: invoices, exceptions and carrier performance.
*Proof:* Brightwater chose us in Q3 for invoices and payments in the portal.

**2. "Count the sites."**
Tidewell sells annual, per-site contracts with an implementation fee, and every site goes live through a project. Forwarders with many small sites pay more and wait longer.
*Landmine question:* "How long did the last site take to go live, and what did the implementation cost?"

**3. "Ask how invoices reach their customers."**
Invoicing is Tidewell's weakest area: invoices leave as exports to the customer's ERP. Atlas customers' customers pay in the portal.
*Landmine question:* "Can your customers see and pay invoices without a separate system?"

### Since the teardown
Tidewell moved its Insights tier to per-tracked-shipment pricing and raised Pro list prices about 8%. **Don't** claim a pricing-model advantage for analytics any more; compare depth instead: lane-level cost, scorecards and alerts. And don't claim they have no analytics; they do.`, {
          searched: [KNOWLEDGE.tidewellTeardown, KNO.winloss],
          cites: [
            [KNOWLEDGE.tidewellTeardown, 'Tidewell sells annual, per-site contracts to enterprise shippers, with a one-time implementation fee'],
            [KNOWLEDGE.tidewellTeardown, 'Tidewell introduced a usage-based Insights tier priced per tracked shipment'],
            [KNO.winloss, 'Invoices and payments in the portal'],
          ],
          feedback: 'up',
        }),
        user('msg_tidewell_07', wd(1, 10, 50), `Turn that into a one-page battlecard draft, and a task for me to finish it with Ravi.`),
        ai('msg_tidewell_08', wd(1, 10, 51), 'sim-swift', `
# Battlecard: Tidewell (draft)

**Where you'll meet them:** forwarders that work for enterprise shippers, especially when customs is in scope.

| | Tidewell | Atlas + Lumen |
|---|---|---|
| Sells to | Enterprise shippers | Mid-market forwarders and shippers |
| Pricing | Annual, per site, plus an implementation fee | Portal per seat; Lumen on active shipments |
| Strongest at | Customs workflows | Invoicing in the portal, time to go-live |
| Analytics | Insights: standard KPIs, now priced per tracked shipment | Lumen: scorecards, lane cost trends, baseline alerts |

**Why we win:** invoices and payments in the portal, self-serve onboarding, API and EDI depth.
**Why we lose:** customs in scope; analytics as a day-one requirement (until Lumen ships).
**Landmines:** time and cost to bring a site live; how customers pay invoices.
**Proof:** the Brightwater and Tidewell wins in Q3; Meridian Freight (quote pending approval).
**Don't:** compete on customs, claim they have no analytics, or quote their prices.

I've created **Write Tidewell battlecard for sales** in **Q4 Competitive Landscape**, assigned to you, with subtasks to review it with Ravi, add two customer proof points and publish it to the sales wiki.`),
      ],
    },
  ]
}

export function opsThreads({ dates, at }: SeedCtx): ThreadSpec[] {
  const triage = at.chat.triage
  const incident = at.chat.incident
  const followUp = at.chat.okrs - 6 * 60 * MINUTE // the morning of the same weekday
  return [
    {
      id: THREAD.triage,
      title: 'Designing a support triage rubric',
      projectId: PROJECT.ops,
      contextRefs: [kref(KNOWLEDGE.triageRubric), kref(KNOWLEDGE.slaPolicy)],
      turns: [
        user('msg_triage_01', triage - MINUTE, `Sentinel triages the support inbox with rubric v1, and it under-prioritizes: login failures hitting several users came through as high instead of urgent, and invoice errors that hit every invoice on an account were filed as medium. Help me design v2.`),
        ai('msg_triage_02', triage + 40 * SEC, 'sim-deep', `
## Why v1 under-prioritizes
v1 sets priority **from the category**: anything filed under account questions is low, anything under outages is urgent. A login failure for several users reads like an access question, and an invoice error reads like a billing question, so both inherit a priority that's too low.

## Proposed v2 structure
**1. Priority first, with definitions and real examples.** Four levels:
| Priority | Definition |
|---|---|
| Urgent | Outages, data not syncing, or login failures for more than one user |
| High | A core workflow broken for one account, or money at risk |
| Medium | Something is wrong, but work continues |
| Low | Questions, admin requests and preferences |

Give two real tickets as examples for each level; examples teach the boundaries better than definitions do.

**2. Category second**, for routing only: auth, billing, shipments, sync-outage, api, notifications, account-admin, sales.

**3. A tie-break rule.** When two priorities seem to fit, choose the higher one and say why in the summary.

**4. Routing.** Urgent tickets alert #support-urgent (with approval) and page on-call for sync outages; everything else becomes a Linear issue.

Your SLA policy already treats "users cannot log in" as the top severity, so v2 brings Sentinel in line with a promise we have already made.`, {
          searched: [KNOWLEDGE.slaPolicy],
          cites: [[KNOWLEDGE.slaPolicy, 'Users cannot log in; shipments not updating for all users; checkout down']],
        }),
        user('msg_triage_03', triage + 20 * MINUTE, `How do we stop Sentinel from over-escalating instead? Theo is worried about alert fatigue.`),
        ai('msg_triage_04', triage + 21 * MINUTE, 'sim-deep', `
Four guardrails, from cheapest to most effective:

1. **Make urgent need evidence.** More than one user affected, data visibly not syncing, or an outage. A single angry email is high, not urgent.
2. **Confidence threshold.** Sentinel reports a confidence with each classification. Below 0.7, the ticket goes to the human queue instead of being guessed.
3. **Approval on alerts.** Sentinel asks before posting to #support-urgent. Approvals stay fast because the alert shows the exact message.
4. **Compare before trusting.** For a week, Theo labels tickets on his own and you compare. Measure agreement, and look hard at the disagreements.

### What to measure in the comparison week
| Metric | Target |
|---|---|
| Agreement with Theo on priority | 85% or more |
| Urgent tickets Sentinel under-rated | 0 |
| Share routed to the human queue | under 15% |

If the misses cluster in one category, that category needs a rule, not a lower threshold.`, { feedback: 'up' }),
        user('msg_triage_05', triage + 40 * MINUTE, `Have Sentinel draft v2 from last month's resolved tickets, using this structure, and send it to me for review.`),
        ai('msg_triage_06', triage + 41 * MINUTE, 'sim-swift', `
Created **Finalize triage rubric v2** in **Support Ops Automation** and handed the draft to **Sentinel**. It will:

- read the last 60 days of resolved SUP issues, plus this conversation and the SLA policy
- draft *Support triage rubric v2* in Knowledge: four priorities with definitions and two real examples each, categories, the tie-break rule and routing
- re-score last month's tickets to show what would change
- move the task to Review and assign it to you`),
        user('msg_triage_07', followUp, `Comparison week results: Sentinel agreed with Theo on 41 of 46 tickets. Three of the five misses were billing tickets it rated medium that Theo rated high. Ready to finalize?`),
        ai('msg_triage_08', followUp + MINUTE, 'sim-deep', `
Almost. **41 of 46 is 89% agreement**, above the 85% target, and none of the misses was an under-rated urgent ticket. But the misses cluster: three of five are billing tickets rated one level too low. That's a rule problem, not a threshold problem.

### Add a billing rule
Failed payments, duplicate charges and overdue notices are at least **high**, even when only one person writes in, because they block the customer's own payment run. They will spike around the first Stripe cutover cohort on ${dayLabel(dates.cutover)}.

### Then finalize
1. Add the billing rule and re-score the three missed tickets (all three become high).
2. Review the other two misses with Theo; they look like genuine judgment calls.
3. Approve v2, and keep checking agreement weekly for the first month.

I've added those steps as subtasks on **Finalize triage rubric v2**, which is already in your Review column.`, {
          searched: [KNOWLEDGE.triageRubric, KNOWLEDGE.slaPolicy, KNOWLEDGE.stripePlan],
          cites: [[KNOWLEDGE.triageRubric, 'Below a confidence of 0.7, Sentinel routes the ticket to the human queue instead of guessing.']],
        }),
      ],
    },

    {
      id: THREAD.incident,
      title: 'Postmortem: checkout latency spike',
      projectId: PROJECT.ops,
      contextRefs: [kref(KNOWLEDGE.incidentLatency)],
      turns: [
        user('msg_incident_01', incident - MINUTE, `I wrote up yesterday's checkout incident last night (it's in Knowledge) and attached my raw notes. Turn it into a blameless postmortem.`, [
          textAttachment('att_incident_01', 'incident-timeline.txt', 'text/plain', INCIDENT_NOTES),
        ]),
        ai('msg_incident_02', incident + 50 * SEC, 'sim-deep', `
# Postmortem: checkout latency spike (draft)

**Duration:** 47 minutes (14:02–14:49 UTC) · **Severity:** S1, checkout degraded for all tenants · **Incident lead:** Priya Natarajan

## Summary
portal 2.2.1 added an outstanding-balance banner to checkout. Its query, \`getOpenInvoices()\`, scanned \`invoice_events\` without a supporting index. Under afternoon load, database CPU saturated and checkout p95 rose to 9.4 s. Turning off the \`checkout.balanceBanner\` flag restored service.

## Detection
The database CPU alert fired at 14:11, but it posts to a channel and pages nobody. **Detection was Coastal Cargo's report at 14:19**: 17 minutes after symptoms began, 8 of them after an alert nobody saw.

## Contributing factors
- The query plan was never checked against production-sized data. Staging's small tables hid the scan, which the Sprint 14 retro had already flagged.
- No checkout-specific latency alert existed.
- The release landed just before the daily traffic peak.

## What went well
- The feature flag allowed mitigation without a rollback.
- Support escalated within 5 minutes of the first customer report.
- Idempotency keys prevented duplicate payments when customers retried.

## Follow-ups
| # | Action | Owner |
|---|---|---|
| 1 | Page on-call when checkout p95 is above 2 s for 5 minutes | Morgan Lee |
| 2 | Query-plan regression check in CI for queries on tables over 1M rows | Priya Natarajan |
| 3 | Migration review checklist: EXPLAIN against production-sized data | Daniel Okafor |
| 4 | Route the database CPU alert to on-call | Priya Natarajan |
| 5 | Load test checkout with production-like volumes before the Stripe backfill | Daniel Okafor |

The index itself is a fix rather than a follow-up: Daniel created it concurrently at 09:30 this morning, so it belongs in the timeline.`, {
          searched: [KNOWLEDGE.incidentLatency],
          cites: [[KNOWLEDGE.incidentLatency, 'In staging the table is small enough that the scan was fast, and nobody checked the plan against production-sized data.']],
          reasoning: 'The written report already has the facts; a blameless postmortem reframes them around system conditions (a missing index, staging data too small to show it, an alert that pages nobody) rather than around who merged the change. Detection deserves its own section, because the gap between the alert and the customer report is the most actionable finding. Five follow-ups with one owner each are easier to track than a long list.',
          feedback: 'up',
        }),
        user('msg_incident_03', incident + 45 * MINUTE, `Daniel re-enabled the flag at 11:00 and p95 looks normal. Add the 09:30 index and the 11:00 re-enable to the timeline, and keep the follow-ups exactly as they are.`),
        ai('msg_incident_04', incident + 46 * MINUTE, 'sim-deep', `
Updated the timeline:

| Time (UTC) | Event |
|---|---|
| 14:41 | \`checkout.balanceBanner\` turned off |
| 14:49 | p95 back under 1 s; incident resolved |
| Next day, 09:30 | Composite index on \`(account_id, status, created_at)\` created concurrently |
| Next day, 11:00 | Flag re-enabled; p95 stays normal |

The five follow-ups are unchanged. Two of them are cheap to finish this week (the checkout alert and routing the CPU alert to on-call); the CI query-plan check is the one most worth protecting, because it is the only follow-up that prevents the next slow query rather than detecting it.`),
        user('msg_incident_05', incident + 60 * MINUTE, `Update the report in Knowledge with the postmortem, and create tasks for the first two follow-ups.`),
        ai('msg_incident_06', incident + 61 * MINUTE, 'sim-swift', `
Done:

- Updated **Incident report: checkout latency (${dayLabel(dates.incident)})** in Knowledge with the postmortem: summary, impact, detection, timeline, root cause and the five follow-ups with owners.
- Created in **Atlas Portal v2**:
  - **Alert on checkout p95 > 2s for 5 minutes**: you, high priority, due this week
  - **Add query-plan regression check to CI**: you, tracking Priya's work, high priority, due before the Stripe backfill

Follow-ups 3 to 5 are recorded in the report with their owners.`),
      ],
    },
  ]
}

export function personalThreads({ clock, at }: SeedCtx): ThreadSpec[] {
  const { day } = clock
  const agents = at.chat.agentsReading
  return [
    {
      id: THREAD.agentsReading,
      title: 'Notes on agent reliability patterns',
      projectId: PROJECT.fieldNotes,
      contextRefs: [kref(KNOWLEDGE.agentPatterns)],
      turns: [
        user('msg_agents_01', agents - MINUTE, `I've been collecting notes on making AI agents reliable (they're in context). Boil them down to a handful of patterns I can use when we design workflows for Sentinel and Forge.`),
        ai('msg_agents_02', agents + 40 * SEC, 'sim-swift', `
## Five patterns

| # | Pattern | In one line | In Atrium terms |
|---|---|---|---|
| 1 | **Explicit plans** | The agent writes its steps down before acting | Plan steps at the top of every run |
| 2 | **Small tool surfaces** | Each agent gets the fewest tools that do the job | Capability grants per agent |
| 3 | **Approvals for side effects** | Anything that sends, merges, pays or deletes asks first, and shows the exact payload | Approval requests with previews |
| 4 | **Idempotent steps** | Running a step twice changes nothing the second time | Natural keys: message-id, PR number, invoice id |
| 5 | **Evals on your own data** | Compare against human labels before trusting a change | A comparison week before going live |

Two of these come straight from your own notes: Sentinel creating two tasks for one email thread is pattern 4, and insisting that approvals show the exact Slack message is pattern 3.

### What I left out
Visible traces, budgets and kill switches matter, but they are operating controls rather than design patterns. Keep them on the checklist for launching any agent.`, {
          searched: [KNOWLEDGE.agentPatterns],
          cites: [
            [KNOWLEDGE.agentPatterns, 'Reading is cheap; writing is where agents hurt you.'],
            [KNOWLEDGE.agentPatterns, 'Sentinel creating two tasks for the same email thread was our first real agent bug.'],
          ],
          feedback: 'up',
        }),
        user('msg_agents_03', agents + 18 * MINUTE, `Which of these matter most for Sentinel specifically?`),
        ai('msg_agents_04', agents + 19 * MINUTE, 'sim-swift', `
Sentinel runs on every inbound email without anyone watching, so the order changes:

1. **Approvals for side effects.** Labelling and filing issues are cheap to undo and can stay automatic. Slack alerts should keep asking until Sentinel has a few weeks of clean history.
2. **Idempotent steps.** Email providers redeliver events. Key every action on the email's message-id so one thread never files two issues.
3. **Evals on your own data.** Before any rubric change goes live, compare Sentinel's labels with Theo's for a week.
4. **Small tool surfaces.** Sentinel has no tool that can email a customer, and it shouldn't get one.

| Action | Mode today | Earns "allow" when… |
|---|---|---|
| Label and categorize | allow | already earned |
| File a Linear issue | allow | already earned |
| Alert #support-urgent | ask | 4 weeks without a false urgent |
| Reply to the customer | deny | not planned |`),
        user('msg_agents_05', agents + 33 * MINUTE, `Turn the patterns into a short talk outline for the engineering all-hands.`),
        ai('msg_agents_06', agents + 34 * MINUTE, 'sim-swift', `
## Talk: "Agents you can trust on a Monday" (15 minutes)

1. **Opening story (2 min).** Sentinel created two tasks for one support email. Nobody was hurt, but it shows why agents need different engineering habits.
2. **Explicit plans (2 min).** Show a run's plan step next to what actually happened.
3. **Small tool surfaces (2 min).** Sentinel's grants: what it can do, and what it deliberately can't.
4. **Approvals for side effects (3 min).** What a good approval shows (the exact payload) and how approval fatigue creeps in.
5. **Idempotent steps (3 min).** Natural keys; resuming instead of restarting.
6. **Evals on your own data (2 min).** The comparison week against human labels.
7. **Close (1 min).** A checklist for launching any new agent.

I've added a task in **Field Notes** to turn this into the all-hands talk.`),
      ],
    },

    {
      id: THREAD.rust,
      title: 'Learning plan: Rust for TypeScript devs',
      projectId: PROJECT.fieldNotes,
      contextRefs: [kref(KNOWLEDGE.rustPlan)],
      turns: [
        user('msg_rust_01', day(20, 20, 30), `I want to learn Rust properly over six weeks, about four hours a week. I write TypeScript every day. Make me a plan that builds on what I already know.`),
        ai('msg_rust_02', day(20, 20, 31), 'sim-swift', `
## Six weeks of Rust for a TypeScript developer

| Week | Topic | Read (the official Rust book) | Build |
|---|---|---|---|
| 1 | Ownership and borrowing | Chapter 4 | Small ownership exercises |
| 2 | Structs, enums, pattern matching | Chapters 5–6 | Model shipment statuses as an enum |
| 3 | Error handling | Chapter 9 | Start a CLI log parser |
| 4 | Traits and generics | Chapter 10 | Pluggable output formats |
| 5 | Collections, iterators, closures | Chapters 8 and 13 | Aggregate the parsed logs |
| 6 | Project week | | Finish the CLI |

### Your biggest shortcut: discriminated unions
You already think in Rust enums. This TypeScript union…

~~~ts
type Shipment =
  | { status: 'in_transit'; etaHours: number }
  | { status: 'delivered'; signedBy: string }
  | { status: 'exception'; reason: string }
~~~

…is this Rust enum, and \`match\` is an exhaustive \`switch\` that the compiler checks for you:

~~~rust
enum Shipment {
    InTransit { eta_hours: u32 },
    Delivered { signed_by: String },
    Exception { reason: String },
}

fn label(s: &Shipment) -> String {
    match s {
        Shipment::InTransit { eta_hours } => format!("Arriving in {eta_hours}h"),
        Shipment::Delivered { signed_by } => format!("Delivered, signed by {signed_by}"),
        Shipment::Exception { reason } => format!("Exception: {reason}"),
    }
}
~~~

### Where you'll struggle
Ownership, in week 1. TypeScript never makes you think about who owns a value. Budget extra time there and don't skip ahead.`),
        user('msg_rust_03', day(20, 21, 0), `Ownership is where I gave up last time. Explain borrowing with a TypeScript mental model.`),
        ai('msg_rust_04', day(20, 21, 1), 'sim-swift', `
## Borrowing for TypeScript developers

In TypeScript, every object is shared by reference and the garbage collector cleans up once nothing points at it. Anyone holding a reference can read it or change it, at any time.

Rust replaces that with three rules:
1. **Every value has exactly one owner.** When the owner goes out of scope, the value is dropped.
2. **You can lend it out as \`&T\`:** a read-only view, as many at once as you like. Think of a \`Readonly<T>\` that the compiler enforces.
3. **Or as \`&mut T\`:** exclusive write access. While it exists, nobody else can read or write.

The compiler checks that no borrow outlives the value, and that shared and exclusive borrows never overlap.

~~~rust
fn total_weight(loads: &[u32]) -> u32 {
    loads.iter().sum()
}

fn main() {
    let mut loads = vec![1200, 800, 450];
    let total = total_weight(&loads); // shared borrow, ends when the call returns
    loads.push(300);                  // fine: no borrows are alive
    println!("{total} kg before, {} loads now", loads.len());
}
~~~

And the error everyone hits:

~~~rust
let first = &loads[0];   // shared borrow starts
loads.push(300);         // error[E0502]: cannot borrow \`loads\` as mutable
                         // because it is also borrowed as immutable
println!("{first}");     // ...because the shared borrow is still used here
~~~

Why it matters: \`push\` may reallocate the vector, which would leave \`first\` pointing at freed memory. TypeScript avoids the problem with a garbage collector; Rust rejects it at compile time.`, { feedback: 'up' }),
        user('msg_rust_05', day(16, 21, 0), `That clicked. Save the plan to my notes and give me a task for this week's exercises.`),
        ai('msg_rust_06', day(16, 21, 1), 'sim-swift', `
Saved **Rust learning plan** to Knowledge (*Notes*) with the six-week table, your rules for yourself and a progress checklist.

Created **Rust week 1: ownership exercises** in **Field Notes**:
- [ ] Rewrite three small TypeScript utilities in Rust
- [ ] Trigger E0502 on purpose and explain it in one sentence
- [ ] Return a \`&str\` slice from a function without cloning`),
      ],
    },
  ]
}

export function unscopedThreads({ clock, at }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  const okrs = at.chat.okrs
  const hiring = at.chat.hiring
  return [
    {
      id: THREAD.okrs,
      title: 'Drafting Q1 OKRs',
      projectId: null,
      contextRefs: [kref(KNOWLEDGE.okrsDraft), kref(KNOWLEDGE.lumenPrd)],
      turns: [
        user('msg_okrs_01', okrs - MINUTE, `My Q1 product OKR draft is in Knowledge. Tighten it: three objectives at most, measurable key results. Themes are Lumen adoption after launch, reducing churn, and finishing Portal v2.`),
        ai('msg_okrs_02', okrs + 50 * SEC, 'sim-deep', `
## Tightened: three objectives

### O1. Make Lumen a habit for operations teams
- **KR1:** 15% of Growth and Enterprise accounts on paid Lumen
- **KR2:** 60% of Lumen accounts with at least 3 weekly active users
- **KR3:** median time to first dashboard under 2 days

### O2. Customers stay because Atlas gets easier to start with
- **KR1:** gross revenue retention of 92%
- **KR2:** median time to first value down from 21 days to 10
- **KR3:** S1/S2 tickets meeting the first-response target up from 91% to 97%

### O3. Finish Portal v2
- **KR1:** 100% of accounts on Portal v2
- **KR2:** p95 page load under 1.5 s on the shipments board
- **KR3:** zero billing-related S1 incidents after the Stripe cutover

### Two of your KRs were really tasks
"Publish five help-center articles" and "Finish the Stripe cutover" are things to do, not outcomes to measure. I moved them out; the outcomes behind them are O1 KR3 and O3 KR1.

**Baselines I couldn't find:** last quarter's GRR and a measured time to first value. Your draft says 21 days, which matches the churn interviews' "about three weeks"; check it against real onboarding data.`, {
          searched: [KNOWLEDGE.okrsDraft, KNOWLEDGE.lumenPrd],
          cites: [[KNOWLEDGE.lumenPrd, '25% of Growth and Enterprise accounts on paid Lumen within two quarters of launch.']],
          feedback: 'down',
        }),
        user('msg_okrs_03', okrs + 25 * MINUTE, `Baselines: GRR was 89% last quarter, and median time to first value is 19 days, not 21. Also drop O3 KR3; incident-count guardrails don't belong in OKRs.`),
        ai('msg_okrs_04', okrs + 26 * MINUTE, 'sim-deep', `
## Revised draft

| Objective | Key result | Baseline | Target | Owner |
|---|---|---|---|---|
| **O1.** Make Lumen a habit | Growth and Enterprise accounts on paid Lumen | 0% | 15% | Morgan |
| | Lumen accounts with ≥3 weekly active users | 5 of 8 beta partners | 60% | Morgan |
| | Median time to first dashboard | not measured | under 2 days | Marcus |
| **O2.** Easier to start, so customers stay | Gross revenue retention | 89% | 92% | Theo and Morgan |
| | Median time to first value | 19 days | 10 days | Morgan |
| | S1/S2 first-response target met | 91% | 97% | Theo |
| **O3.** Finish Portal v2 | Accounts on Portal v2 | beta tenants only | 100% | Priya |
| | p95 page load, shipments board | 2.4 s | under 1.5 s | Priya |
| | Invoices mismatched in Stripe reconciliation | not started | under 0.5% | Daniel |

**Changes:** real baselines for GRR and time to first value, and O3 KR3 now measures the quality of the migration instead of counting incidents.

**One risk:** O2 KR2 nearly halves onboarding time in a quarter. If the integration templates slip, it fails, so ask Priya whether 12 days is the honest target.`),
        user('msg_okrs_05', back(0, 5), `Keep 10 days; it's a stretch goal and we'll say so. Update the draft in Knowledge, and give me a task to review it with Grace before the leadership offsite.`),
        ai('msg_okrs_06', back(0, 4, 58), 'sim-swift', `
Updated **Q1 OKRs (draft)** in Knowledge with the baselines, owners and notes, including that O2 KR2 is a stretch goal and which two KRs became tasks.

Created **Review Q1 OKR draft with Grace**, assigned to you and due before the offsite, with two subtasks: align O1 with Ravi's sales targets, and confirm the time-to-first-value baseline with Marcus.`),
      ],
    },

    {
      id: THREAD.hiring,
      title: 'Interview loop for a senior frontend engineer',
      projectId: null,
      contextRefs: [kref(KNOWLEDGE.onboarding), kref(KNOWLEDGE.codeReview)],
      turns: [
        user('msg_hiring_01', hiring - MINUTE, `We're hiring a senior frontend engineer for the portal team: React, TypeScript, design systems, performance. Design an interview loop that takes under four hours of the candidate's time and tests what actually matters.`),
        ai('msg_hiring_02', hiring + 40 * SEC, 'sim-swift', `
## Interview loop: senior frontend engineer (3 h 45 min of candidate time)

| Stage | Length | With | What it tests |
|---|---|---|---|
| 1. Recruiter screen | 30 min | Recruiter | Motivation, logistics, compensation range |
| 2. Hiring manager | 45 min | Priya | Past impact, scope, handling ambiguity |
| 3. Take-home | 90 min, timeboxed and paid | Async | A small copy of the portal: fix a slow shipments table and add a test |
| 4. Final round | 60 min | Sofia, Hana and Morgan | Walk through the take-home, then a short frontend design discussion and collaboration questions |

**Why a take-home here:** it mirrors real portal work, and the walkthrough in stage 4 shows how candidates explain trade-offs. Timebox it and pay for it, so it doesn't favour people with free evenings.

### Structured scorecard
Each interviewer scores the relevant competencies from 1 to 4 against written anchors, before the debrief:
- **React and TypeScript craft:** state, effects, types that prevent bugs
- **Performance:** measures before optimizing; understands rendering costs
- **Design systems:** tokens, accessibility, component API design
- **Collaboration:** explains trade-offs clearly; open to feedback

Decide on the evidence in the scorecards, not on the loudest voice in the debrief. The take-home should follow our own code review handbook, so candidates see how we actually work.`, {
          searched: [KNOWLEDGE.onboarding, KNOWLEDGE.codeReview],
          cites: [[KNOWLEDGE.codeReview, 'Every bug fix ships with a regression test that fails without the fix.']],
        }),
        user('msg_hiring_03', hiring + 20 * MINUTE, `What does a strong answer look like in the design discussion, compared with a weak one?`),
        ai('msg_hiring_04', hiring + 21 * MINUTE, 'sim-swift', `
## Designing the shipments board: strong vs. weak

| Area | Strong signal | Weak signal |
|---|---|---|
| Data fetching | Pagination or cursors, stale-while-revalidate caching, clear loading states | Fetches everything on mount |
| Live updates | Server-sent events or websockets, merging updates into cached data, handling reconnects | Polls every second |
| Large lists | Virtualization for 10,000 rows; keeps the scroll position when updates arrive | Renders every row |
| State | Separates server state from UI state; filters live in the URL | One global store for everything |
| Accessibility | Keyboard navigation in the grid; announces live changes | Not mentioned |
| Performance | Sets a budget (p95 load, interaction latency) and says how to measure it | "We'll optimize later" |
| Failure modes | Partial failures, offline, a stale-data banner | Happy path only |
| Testing | Component tests for logic, a few end-to-end tests on the critical path | "We'd add tests" |

A strong senior candidate asks questions before drawing anything: how many shipments, how often they update, and who uses the board.`, { feedback: 'up' }),
        user('msg_hiring_05', hiring + 35 * MINUTE, `Great. Make a task to post the role, and draft the "What you'll do" section of the job post.`),
        ai('msg_hiring_06', hiring + 36 * MINUTE, 'sim-swift', `
Created **Post senior frontend engineer role** in your tasks.

**What you'll do**
- Build the screens operations teams live in all day: the shipments board, tracking timelines and Lumen dashboards
- Own frontend performance: set budgets, measure them, and keep pages fast as data grows
- Shape our design system with the design team: tokens, accessible components and dark mode
- Pair with backend engineers on APIs that keep the frontend simple
- Review code generously and help raise the bar for the whole team
- Talk directly with customers' operations teams to understand what slows them down`),
      ],
    },
  ]
}
