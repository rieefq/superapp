import { KNOWLEDGE, PROJECT, THREAD } from '../../ids'
import { ai, dayLabel, kref, textAttachment, user, type SeedCtx, type ThreadSpec } from '../helpers'
import { KNO } from '../keys'

const INCIDENT_NOTES = `checkout incident: raw notes (UTC)
13:20 deploy web 4.18.0 (balance banner, PR #1482)
~14:00 latency creeping up? (only seen in hindsight)
14:11 db cpu > 90% alert in #infra-alerts (nobody paged)
14:19 Coastal Cargo emails support: checkout spinning
14:24 Theo escalates, incident channel opened, Priya IC
14:33 slow query log -> getOpenInvoices() seq scan on invoice_events
14:44 flag checkout.balanceBanner OFF   <- check exact time
14:49 p95 < 1s, resolved
impact: p95 9.4s peak, ~3.1% checkouts timed out, 14 tickets, no dup payments
next: index (account_id, status, created_at) concurrently in the morning`

export function landscapeThreads({ clock }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  return [
    {
      id: THREAD.portbase,
      title: 'How does Portbase position against us?',
      projectId: PROJECT.landscape,
      contextRefs: [kref(KNOWLEDGE.portbaseTeardown), kref(KNO.winloss)],
      turns: [
        user('msg_portbase_01', back(13, 6), `Sales keeps hearing that Portbase does this out of the box. How does Portbase actually position against us?`),
        ai('msg_portbase_02', back(13, 5, 58), 'sim-deep', `
What we know internally is useful but thin.

### What our own notes say
- **Where we lose to them:** we lost two Q3 deals to Portbase. Both evaluations were led by customer experience or sales, and both buyers named the ready-made customer portal as the deciding factor.
- **Where we beat them:** when an operations or IT evaluator cares about lane-level reporting, the API, EDI or SSO (Brightwater and Tidewell in Q3).
- **After the sale:** two churned customers had evaluated Portbase. Bluefen switched for the look of the portal, and later reported slow support there.

### What we don't know
- How they price, and whether analytics are bundled or sold separately
- How deep their analytics actually go, beyond demo impressions
- Whether they are deliberately moving into the mid-market

### Suggestion
Run a standard-depth investigation with five angles: positioning and messaging, pricing and packaging, product gaps against Atlas, customer sentiment, and recent launches. I'd include our win/loss notes and churn interviews as sources, so the outside view is checked against what our customers actually told us.`, {
          searched: [KNO.winloss, KNOWLEDGE.churnInterviews, KNOWLEDGE.freightlyNotes],
          cites: [
            [KNO.winloss, 'when the evaluation is led by customer experience or sales and the demo centres on the customer-facing portal'],
            [KNOWLEDGE.churnInterviews, 'Two had evaluated Portbase. Bluefen switched, citing the look of the customer-facing portal; its former CSM later heard about slow support responses there.'],
          ],
        }),
        user('msg_portbase_03', back(13, 5, 50), `Run it.`),
        ai('msg_portbase_04', back(13, 5, 49), 'sim-swift', `
Started **Portbase positioning & pricing** in Research (standard depth, 5 angles):

1. Positioning and messaging
2. Pricing and packaging
3. Product gaps compared with Atlas
4. Customer sentiment
5. Recent launches and funding

Our win/loss notes and churn interviews are included as knowledge sources. Web sources in this workspace come from the simulated search corpus and will be labeled as simulated in the report. You'll get a notification when the report is ready to review.`),
        user('msg_portbase_05', back(1, 5), `The teardown is in. Give me the three things a rep should say when a prospect brings up Portbase.`),
        ai('msg_portbase_06', back(1, 4, 58), 'sim-deep', `
## Three talk tracks for Portbase

**1. "Pretty on day one, or useful on day ninety?"**
Portbase leads with how fast you can launch a portal. Concede it: their templates are good. Then move to what happens next. Lane-level cost, carrier scorecards and exception alerts are where their Insights module is thin.
*Proof:* Meridian trialed Portbase's analytics and went back to spreadsheets because they couldn't get cost by lane and carrier without exporting.

**2. "Share it with everyone; pay for shipments."**
Portbase prices per user, with analytics only from its Business plan up. Lumen is priced on active shipments, so customers can give every coordinator and carrier contact access without rationing seats.
*Landmine question:* "How many people outside your ops team will need these reports, and what does that cost per user?"

**3. "Ask how fast they answer when an integration breaks."**
Slow support is the most consistent complaint in public reviews, and it came up with two of our churned customers. Every Atlas plan has written first-response targets.
*Landmine question:* "What's their committed response time when your TMS feed stops updating?"

**Don't** claim Portbase has no analytics (it does), and don't quote their prices; the teardown couldn't verify them.`, {
          searched: [KNOWLEDGE.portbaseTeardown, KNOWLEDGE.meridianCall, KNO.winloss],
          cites: [
            [KNOWLEDGE.portbaseTeardown, 'It prices per user, includes its new Insights analytics only from the Business plan upward, and offers no usage-based option'],
            [KNOWLEDGE.portbaseTeardown, 'Lead Lumen messaging with lane-level cost and carrier scorecards, where Insights is thinnest.'],
            [KNOWLEDGE.meridianCall, "we couldn't get cost by lane and carrier without exporting"],
          ],
          feedback: 'up',
        }),
        user('msg_portbase_07', back(1, 4, 40), `Turn that into a one-page battlecard draft, and a task for me to finish it with Ravi.`),
        ai('msg_portbase_08', back(1, 4, 39), 'sim-swift', `
# Battlecard: Portbase (draft)

**Where you'll meet them:** mid-market forwarders, especially when customer experience or sales leads the evaluation.

| | Portbase | Atlas + Lumen |
|---|---|---|
| Pitch | Launch a customer portal in days | Run operations on the data you already have |
| Pricing | Per user; analytics from the Business plan | Portal per seat; Lumen on active shipments |
| Analytics | Standard KPIs, fixed reports | Scorecards, lane cost trends, baseline-tuned alerts |
| Support | Recurring complaints about response times | Written first-response targets on every plan |

**Why we win:** lane-level cost, API and EDI depth, SSO, support responsiveness.
**Why we lose:** demo polish and time to a first portal.
**Landmines:** the cost of sharing reports with occasional users; response time when an integration breaks.
**Proof:** Meridian Freight (quote pending approval); the Brightwater and Tidewell wins in Q3.
**Don't:** claim they have no analytics, or quote their prices.

I've created **Write Portbase battlecard for sales** in **Q4 Competitive Landscape**, assigned to you, with subtasks to review it with Ravi, add two customer proof points and publish it to the sales wiki.`),
      ],
    },
  ]
}

export function opsThreads({ clock, dates }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  return [
    {
      id: THREAD.triage,
      title: 'Designing a support triage rubric',
      projectId: PROJECT.ops,
      contextRefs: [kref(KNOWLEDGE.triageRubric), kref(KNOWLEDGE.slaPolicy)],
      turns: [
        user('msg_triage_01', back(12, 5), `Sentinel triages the support inbox with rubric v1 and gets the urgent ones wrong. Last week an SSO lockout at an Enterprise account came through as "how-to". Help me design v2.`),
        ai('msg_triage_02', back(12, 4, 58), 'sim-deep', `
## Why v1 misfires
v1 assigns severity **from the category**: how-to is always low, outage is always high. An SSO lockout reads like a question ("how do I get back in?"), so it lands in how-to and inherits a low priority. The fix is to stop deriving severity from the category.

## Proposed v2 structure
**Step 1: category**, meaning what kind of problem it is. Seven categories: Access & SSO, Billing, Tracking accuracy, Integrations, Performance, How-to, Feature request.

**Step 2: severity from impact × urgency**, meaning how bad and how soon:

| Impact | Urgent | Soon | Whenever |
|---|---|---|---|
| Many users or all tenants | S1 | S2 | S3 |
| One team or tenant | S2 | S3 | S4 |
| One user | S3 | S4 | S4 |

**Step 3: account modifiers:** Enterprise plan, renewal within 90 days, repeat issue.

**Step 4: route** by severity, with Slack alerts for S1 and S2.

Under v2, last week's lockout scores one tenant × urgent = S2, and the Enterprise modifier lifts it to S1 because nobody at that account could sign in. It would have paged on-call instead of waiting in the how-to queue.`, {
          searched: [KNOWLEDGE.slaPolicy, KNOWLEDGE.glossary],
          cites: [[KNOWLEDGE.slaPolicy, 'Users cannot log in; shipments not updating for all users; checkout down']],
        }),
        user('msg_triage_03', back(12, 4, 30), `How do we stop Sentinel over-escalating? Theo is worried about alert fatigue.`),
        ai('msg_triage_04', back(12, 4, 29), 'sim-deep', `
Four guardrails, from cheapest to most effective:

1. **Cap the modifiers.** At most +1 level in total, however many apply. Without a cap, an Enterprise account with a repeat issue and a renewal coming up jumps three levels.
2. **Make S1 need evidence.** S1 only when the impact is "many users", or the account is Enterprise and its users cannot sign in at all. Everything else tops out at S2.
3. **Confidence threshold.** Sentinel reports a confidence with each classification. Below 0.7, the ticket goes to the human queue instead of being guessed.
4. **Shadow mode first.** Run v2 for a week next to Theo's manual labels. Sentinel labels but doesn't route or alert. Measure agreement, and look hard at the disagreements.

### What to measure in the shadow week
| Metric | Target |
|---|---|
| Agreement with Theo on severity | 85% or more |
| S1/S2 tickets Sentinel under-rated | 0 |
| Share routed to the human queue | under 15% |

If the misses cluster in one category, that category needs a rule, not a lower threshold.`, { feedback: 'up' }),
        user('msg_triage_05', back(9, 6), `Write v2 up as a doc I can keep in Knowledge.`),
        ai('msg_triage_06', back(9, 5, 58), 'sim-swift', `
Saved **Support triage rubric v2** to Knowledge in the *Product* collection. It covers:

- What changed from v1, with the SSO-lockout example
- **Step 1:** seven categories with default owners
- **Step 2:** the impact × urgency matrix
- **Step 3:** modifiers capped at +1, with the S1 evidence rule
- **Step 4:** routing; Sentinel asks for approval before posting S1 alerts to Slack
- Worked examples, and a calibration section to fill in after the shadow week

It's marked **in review** until Theo signs off. Sentinel keeps using v1 until then.`),
        user('msg_triage_07', back(4, 5), `Shadow week results: Sentinel agreed with Theo on 41 of 46 tickets. Three of the five misses were billing tickets it rated S3 that Theo rated S2. Ready to finalize?`),
        ai('msg_triage_08', back(4, 4, 58), 'sim-deep', `
Almost. **41 of 46 is 89% agreement**, above the 85% target, and none of the misses was an under-rated S1. But the misses cluster: three of five are billing tickets rated one level too low. That's a rule problem, not a threshold problem.

### Add a billing urgency rule
Treat a ticket as **urgent** when it mentions a failed payment, an overdue notice or a duplicate charge. Those block a customer's own payment run even when only one person writes in, and they'll spike around the Stripe cutover on ${dayLabel(dates.cutover)}.

### Then finalize
1. Add the billing rule to the rubric and re-score the three missed tickets (all three become S2).
2. Review the other two misses with Theo; they look like genuine judgment calls.
3. Switch Sentinel to v2, and check agreement weekly for the first month.

I've created **Finalize triage rubric v2** in **Support Ops Automation**, assigned to you, with those steps as subtasks.`, {
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
        user('msg_incident_01', back(10, 7), `Here are my raw notes and the timeline from yesterday's checkout incident. Draft a blameless postmortem.`, [
          textAttachment('att_incident_01', 'incident-timeline.txt', 'text/plain', INCIDENT_NOTES),
        ]),
        ai('msg_incident_02', back(10, 6, 58), 'sim-deep', `
# Postmortem: checkout latency spike (draft)

**Duration:** 47 minutes (14:02–14:49 UTC) · **Severity:** S1, checkout degraded for all tenants · **Incident lead:** Priya Natarajan

## Summary
web 4.18.0 added an outstanding-balance banner to checkout. Its query, \`getOpenInvoices()\`, scanned \`invoice_events\` without a supporting index. Under afternoon load, database CPU saturated and checkout p95 rose to 9.4 s. Turning off the \`checkout.balanceBanner\` flag restored service.

## Impact
- Checkout p95 latency peaked at 9.4 s
- About 3.1% of checkout attempts timed out; retries afterwards succeeded
- 14 support tickets; no duplicate payments

## Timeline (UTC)
| Time | Event |
|---|---|
| 13:20 | web 4.18.0 deployed (PR #1482) |
| 14:02 | Latency starts rising |
| 14:11 | Database CPU alert fires: **incident detected** |
| 14:19 | Coastal Cargo reports a slow checkout |
| 14:24 | Incident declared; Priya leads |
| 14:33 | Slow-query log points to \`getOpenInvoices()\` |
| 14:44 | \`checkout.balanceBanner\` turned off |
| 14:49 | Resolved |

## Root cause
A new query on a large table without a supporting index, never checked against production-sized data.

## What went well
- The feature flag allowed mitigation without a rollback
- Idempotency keys prevented duplicate payments

## Action items (draft)
- Add an index on \`invoice_events (account_id, status, created_at)\`
- Add a latency alert for checkout
- Check query plans for new queries

Two things I'm unsure about from the notes: the exact time the flag was turned off (marked "check exact time"), and whether the CPU alert actually reached anyone.`, {
          reasoning: 'The notes give a clear sequence from deploy to resolution. A blameless format describes system conditions (a missing index, small staging data, alert routing) rather than who merged the change. Two details are uncertain in the raw notes: the flag-off time is marked for checking, and the 14:11 alert is described as not paging anyone, which conflicts with treating it as the detection point. Flag both rather than guess.',
        }),
        user('msg_incident_03', back(10, 6, 20), `Two corrections: the flag went off at 14:41, not 14:44, and detection was the customer report. The CPU alert fired at 14:11 but it doesn't page anyone. Make the action items specific, with owners.`),
        ai('msg_incident_04', back(10, 6, 18), 'sim-deep', `
Updated. Detection is now the customer report at 14:19, which makes the gap a finding in itself: **17 minutes from first symptoms to detection, 8 of them after an alert nobody saw.**

## Action items
| # | Action | Owner | Due |
|---|---|---|---|
| 1 | Page on-call when checkout p95 is above 2 s for 5 minutes | Morgan Lee | This week |
| 2 | Query-plan regression check in CI for queries on tables over 1M rows | Priya Natarajan | Before the Stripe backfill |
| 3 | Migration review checklist: EXPLAIN against production-sized data | Daniel Okafor | This sprint |
| 4 | Route the database CPU alert to on-call | Priya Natarajan | This week |
| 5 | Load test checkout with production-like volumes before the Stripe backfill | Daniel Okafor | Before the backfill |

The index itself is a fix rather than an action item. Daniel is creating it concurrently and will re-enable the flag afterwards, so it belongs in the timeline instead.

### Timeline changes
- 14:11: database CPU alert fires; posted to a channel, **not paged**
- 14:19: Coastal Cargo reports a slow checkout (**detection**)
- 14:41: \`checkout.balanceBanner\` turned off`, { feedback: 'up' }),
        user('msg_incident_05', back(9, 8), `Create tasks for the first two and save the postmortem to Knowledge.`),
        ai('msg_incident_06', back(9, 7, 58), 'sim-swift', `
Done:

- Saved **Incident report: checkout latency (${dayLabel(dates.incident)})** to Knowledge (*Engineering*) with the corrected timeline, root cause, impact and all five action items.
- Created in **Atlas Portal v2**:
  - **Alert on checkout p95 > 2s for 5 minutes**: you, high priority, due this week
  - **Add query-plan regression check to CI**: you, tracking Priya's work, high priority, due before the Stripe backfill

Items 3 to 5 are recorded in the report with their owners. Say the word if you want tasks for those too.`),
      ],
    },
  ]
}

export function personalThreads({ clock }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  return [
    {
      id: THREAD.agentsReading,
      title: 'Notes on agent reliability patterns',
      projectId: PROJECT.fieldNotes,
      contextRefs: [kref(KNOWLEDGE.agentPatterns)],
      turns: [
        user('msg_agents_01', back(18, 4), `I've been collecting notes on making AI agents reliable (they're in context). Help me boil them down to a few principles I can use when we design workflows for Sentinel and Forge.`),
        ai('msg_agents_02', back(18, 3, 58), 'sim-deep', `
## Seven principles

| # | Principle | In one line | In Atrium terms |
|---|---|---|---|
| 1 | **Bound the blast radius** | Grant capabilities per action, not per agent | Capability grants: allow, ask or deny |
| 2 | **Gate side effects** | Anything that sends, merges, pays or deletes asks first | Approvals that show the exact payload |
| 3 | **Idempotent tools** | Running a step twice changes nothing the second time | Natural keys: message-id, PR number, invoice id |
| 4 | **Checkpoint and resume** | A crash resumes the run instead of restarting it | Runs persist every step |
| 5 | **Show the work** | Every step records inputs, outputs, time and cost | The run timeline |
| 6 | **Hand off when unsure** | Low confidence goes to a person, with context | Confidence thresholds and a human queue |
| 7 | **Evaluate on your own data** | Shadow runs against human labels beat benchmarks | A shadow week before going live |

Two of these come straight from your own notes: Sentinel creating two tasks for one email thread is principle 3, and insisting that approvals show the exact Slack message is principle 2.

### What I'd move out
"Budgets and kill switches" matters, but it's an operational control rather than a design principle. Keep it on the checklist for launching any agent instead.`, {
          searched: [KNOWLEDGE.agentPatterns],
          cites: [
            [KNOWLEDGE.agentPatterns, 'Reading is cheap; writing is where agents hurt you.'],
            [KNOWLEDGE.agentPatterns, 'Sentinel creating two tasks for the same email thread was our first real agent bug.'],
          ],
          feedback: 'up',
        }),
        user('msg_agents_03', back(18, 3, 30), `Which of these matter most for Sentinel specifically?`),
        ai('msg_agents_04', back(18, 3, 29), 'sim-deep', `
Sentinel is autonomous and runs on every inbound email, so the order changes:

1. **Hand off when unsure** matters most. Triage is classification, so a confidence threshold that routes unclear tickets to a person is the main safety valve. Rubric v1 doesn't have one.
2. **Idempotent tools.** Email providers redeliver events. Key every action on the email's message-id so one thread never creates two tasks.
3. **Gate side effects.** Labelling and creating tasks can stay automatic because they're cheap to undo. Slack alerts should keep asking until Sentinel has a few weeks of clean history.
4. **Evaluate on your own data.** Before any rubric change goes live, run it for a week in shadow mode against Theo's labels.

| Action | Mode today | Earns "allow" when… |
|---|---|---|
| Label and categorize | allow | already earned |
| Create a task | allow | already earned |
| Slack alert (#support-urgent) | ask | 4 weeks without a false S1 |
| Reply to the customer | deny | not planned |`),
        user('msg_agents_05', back(18, 3), `Turn the principles into a short talk outline for the engineering all-hands.`),
        ai('msg_agents_06', back(18, 2, 58), 'sim-swift', `
## Talk: "Agents you can trust on a Monday" (15 minutes)

1. **Opening story (2 min).** Sentinel created two tasks for one support email. Nobody was hurt, but it shows why agents need different engineering habits.
2. **Autonomy is a budget (2 min).** Grant per action, not per agent. Show Sentinel's grants: labelling is allowed, Slack alerts ask.
3. **Side effects and approvals (3 min).** What a good approval shows (the exact payload) and how approval fatigue creeps in.
4. **Idempotency and checkpoints (3 min).** Natural keys; resuming instead of restarting.
5. **Show the work (2 min).** Walk through one run timeline: steps, inputs, cost.
6. **Evaluate on your own data (2 min).** Shadow mode against human labels.
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
        user('msg_rust_01', back(20, 3), `I want to learn Rust properly over six weeks, about four hours a week. I write TypeScript every day. Make me a plan that builds on what I already know.`),
        ai('msg_rust_02', back(20, 2, 59), 'sim-swift', `
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
        user('msg_rust_03', back(20, 2, 30), `Ownership is where I gave up last time. Explain borrowing with a TypeScript mental model.`),
        ai('msg_rust_04', back(20, 2, 29), 'sim-swift', `
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
        user('msg_rust_05', back(16, 4), `That clicked. Save the plan to my notes and give me a task for this week's exercises.`),
        ai('msg_rust_06', back(16, 3, 59), 'sim-swift', `
Saved **Rust learning plan** to Knowledge (*Notes*) with the six-week table, your rules for yourself and a progress checklist.

Created **Rust week 1: ownership exercises** in **Field Notes**:
- [ ] Rewrite three small TypeScript utilities in Rust
- [ ] Trigger E0502 on purpose and explain it in one sentence
- [ ] Return a \`&str\` slice from a function without cloning`),
      ],
    },
  ]
}

export function unscopedThreads({ clock }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  return [
    {
      id: THREAD.okrs,
      title: 'Drafting Q1 OKRs',
      projectId: null,
      contextRefs: [kref(KNOWLEDGE.okrsDraft), kref(KNOWLEDGE.lumenPrd)],
      turns: [
        user('msg_okrs_01', back(3, 5), `Help me draft Q1 OKRs for product. Themes: Lumen adoption after launch, reducing churn, and finishing Portal v2. Three objectives at most, with measurable key results.`),
        ai('msg_okrs_02', back(3, 4, 58), 'sim-deep', `
## Q1 product OKRs: first draft

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

### Why these
- **O1** is a step toward the PRD goal of 25% attach within two quarters; 15% in the first full quarter is ambitious but plausible.
- **O2** goes after the top churn themes. I took "21 days" from the interviews' "about three weeks", so check it against real onboarding data.
- **O3 KR3** is more of a guardrail than a goal; consider whether it belongs.

**Baselines I couldn't find:** last quarter's GRR and a measured time to first value.`, {
          searched: [KNOWLEDGE.lumenPrd, KNOWLEDGE.churnInterviews, KNOWLEDGE.slaPolicy],
          cites: [
            [KNOWLEDGE.lumenPrd, '25% of Growth and Enterprise accounts on paid Lumen within two quarters of launch.'],
            [KNOWLEDGE.churnInterviews, 'Onboarding took about three weeks or more before the first customer saw a live shipment.'],
            [KNOWLEDGE.slaPolicy, 'Last quarter, 91% of S1 and S2 tickets met the first-response target.'],
          ],
          feedback: 'down',
        }),
        user('msg_okrs_03', back(3, 4, 20), `Baselines: GRR was 89% last quarter, and median time to first value is 19 days, not 21. Also drop O3 KR3; incident-count guardrails don't belong in OKRs.`),
        ai('msg_okrs_04', back(3, 4, 18), 'sim-deep', `
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
| | Invoices mismatched in the Stripe dual-run | not started | under 0.5% | Daniel |

**Changes:** real baselines for GRR and time to first value, and O3 KR3 now measures the quality of the migration (dual-run mismatches) instead of counting incidents.

**One risk:** O2 KR2 nearly halves onboarding time in a quarter. If the integration templates slip, it fails, so ask Priya whether 12 days is the honest target.`),
        user('msg_okrs_05', back(0, 5), `Keep 10 days; it's a stretch goal and we'll say so. Save this as the draft in Knowledge, and give me a task to review it with Grace before the leadership offsite.`),
        ai('msg_okrs_06', back(0, 4, 58), 'sim-swift', `
Saved **Q1 OKRs (draft)** to Knowledge (*Product*) with the baselines, owners and notes, including that O2 KR2 is a stretch goal.

Created **Review Q1 OKR draft with Grace**, assigned to you and due before the offsite, with two subtasks: align O1 with Ravi's sales targets, and confirm the time-to-first-value baseline with Marcus.`),
      ],
    },

    {
      id: THREAD.hiring,
      title: 'Interview loop for a senior frontend engineer',
      projectId: null,
      turns: [
        user('msg_hiring_01', back(7, 4), `We're hiring a senior frontend engineer for the portal team: React, TypeScript, design systems, performance. Design an interview loop that takes under four hours of the candidate's time and tests what actually matters.`),
        ai('msg_hiring_02', back(7, 3, 59), 'sim-swift', `
## Interview loop: senior frontend engineer (3 h 45 min)

| Stage | Length | With | What it tests |
|---|---|---|---|
| 1. Recruiter screen | 30 min | Recruiter | Motivation, logistics, compensation range |
| 2. Hiring manager | 45 min | Priya | Past impact, scope, handling ambiguity |
| 3. Pairing session | 75 min | Sofia and one engineer | Fix a slow table component and add a test in a small, realistic repo |
| 4. Frontend system design | 45 min | Daniel or Priya | Design the shipments board with live updates |
| 5. Collaboration | 30 min | Hana (design) and Morgan | Working with design and product; giving and receiving feedback |

**No take-home.** The pairing session covers the same ground in less of the candidate's time, and shows how they think out loud.

### Scorecard
Each interviewer scores the relevant competencies from 1 to 4 against written anchors, before the debrief:
- **React and TypeScript craft:** state, effects, types that prevent bugs
- **Performance:** measures before optimizing; understands rendering costs
- **Design systems:** tokens, accessibility, component API design
- **Collaboration:** explains trade-offs clearly; open to feedback

Decide on the evidence in the scorecards, not on the loudest voice in the debrief.`),
        user('msg_hiring_03', back(7, 3, 30), `What does a strong answer look like in the frontend system design interview, compared with a weak one?`),
        ai('msg_hiring_04', back(7, 3, 29), 'sim-swift', `
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
        user('msg_hiring_05', back(7, 3, 10), `Great. Make a task to post the role, and draft the "What you'll do" section of the job post.`),
        ai('msg_hiring_06', back(7, 3, 9), 'sim-swift', `
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
