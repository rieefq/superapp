import type { KnowledgeItem } from '@/core/types'
import { AGENT, COLLECTION, KNOWLEDGE, PROJECT } from '../../ids'
import { agentActor, dayLabel, type SeedCtx } from '../helpers'
import { KNO, MSG } from '../keys'
import { item } from './build'

/** CSV export of the top 15 accounts. Also the source of the beta volumes used in pricing threads. */
export const ACCOUNTS_CSV = `account,segment,region,plan,arr_usd,seats,active_shipments_mo,lumen_beta,health,renewal_in_days,csm
Meridian Freight,Enterprise,NA,Enterprise,186000,140,18400,yes,green,203,Nadia Rahman
Tidewell Intermodal,Enterprise,EU,Enterprise,142000,96,9800,yes,green,151,Tom Becker
Halden Logistics,Enterprise,EU,Enterprise,128500,88,7700,no,red,112,Tom Becker
Brightwater Haulage,Mid-market,NA,Growth,96000,64,6900,yes,green,265,Nadia Rahman
Coastal Cargo,Mid-market,NA,Growth,88800,58,5400,no,red,47,Nadia Rahman
Vantor Freight Systems,Mid-market,EU,Growth,74400,47,5000,yes,yellow,88,Tom Becker
Rookwood Logistics,Mid-market,NA,Growth,61200,41,4200,yes,green,312,Nadia Rahman
Kestrelway Air Freight,Mid-market,APAC,Growth,57600,35,3900,no,green,190,Tom Becker
Pinecrest Forwarding,Mid-market,NA,Growth,52800,33,3100,yes,green,134,Nadia Rahman
Saltmarsh Shipping Co.,Mid-market,EU,Growth,43200,29,2600,yes,yellow,76,Tom Becker
Ashgrove Cold Chain,SMB,NA,Starter,18000,10,1450,yes,green,221,Nadia Rahman
Quarrystone Haulage,SMB,EU,Starter,16200,9,1800,no,yellow,58,Tom Becker
Ferncliff Couriers,SMB,NA,Starter,14400,8,1200,no,green,287,Nadia Rahman
Marlowe Bay Logistics,SMB,APAC,Starter,12600,7,950,no,yellow,102,Tom Becker
Driftwood Freightways,SMB,NA,Starter,10800,6,700,no,green,175,Nadia Rahman`

export function productKnowledge({ clock, dates }: SeedCtx): KnowledgeItem[] {
  const { back } = clock
  return [
    item({
      id: KNOWLEDGE.lumenPrd,
      kind: 'doc',
      title: 'Atlas Lumen PRD',
      summary: 'Requirements for Atlas Lumen, the analytics add-on: problem, users, v1 scope by tier, success metrics, pricing summary and rollout.',
      tags: ['lumen', 'prd', 'analytics', 'launch'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.lumen],
      source: { type: 'integration', integrationId: 'notion' },
      pinned: true,
      createdAt: back(52, 3),
      updatedAt: back(6, 4),
      content: `
# Atlas Lumen — product requirements

**Owner:** Morgan Lee (Product) · **Engineering:** Priya Natarajan · **Data:** Marcus Chen · **Design:** Hana Kim · **Marketing:** Aisha Bello
**Status:** Approved for launch · **Public launch:** ${dayLabel(dates.launch)}

## 1. Summary
Atlas Lumen is an analytics add-on for Atlas Portal. It turns the shipment, tracking and invoice data customers already keep in Atlas into live dashboards, carrier scorecards, lane cost trends and exception alerts, so operations teams can see what is slipping and act before their own customers notice.

## 2. Problem
Operations managers at mid-market forwarders and 3PLs run their week on spreadsheets. Every Monday they export shipments from Atlas, rebuild the same carrier report by hand and argue about whose numbers are right. In our churn interviews, four of six customers described this export-and-rebuild loop, and two had bought a separate BI tool to do it. The data is already in Atlas; the insight is not.

## 3. Who it is for
- **Primary:** operations managers like Olivia (see the persona) who own on-time performance and carrier relationships.
- **Secondary:** heads of operations who want a weekly view of service levels, and carrier managers preparing quarterly business reviews.
- **Not for v1:** finance teams that need invoice-level reconciliation. That stays in Atlas Billing.

## 4. Goals and non-goals
**Goals**
1. Replace the Monday spreadsheet: a carrier review should take minutes, not hours.
2. Catch exceptions early: surface late, stuck or at-risk shipments before the customer calls.
3. Create an expansion path: Lumen is our first add-on and the template for the next ones.

**Non-goals for v1:** custom SQL, data from systems outside Atlas, predictive ETAs, temperature monitoring.

## 5. Scope (v1)
| Capability | What it does | Tier |
|---|---|---|
| Shipment performance dashboard | On-time %, dwell time and transit time by lane, week over week | Core |
| Weekly exception digest | Email and in-app summary of late and stuck shipments | Core |
| Carrier scorecards | On-time, damage and invoice-accuracy scores per carrier, exportable for QBRs | Pro |
| Lane cost trends | Cost per shipment and per kg by lane, with outliers flagged | Pro |
| Real-time exception alerts | Thresholds tuned to the account's own 30-day baseline, routed to email or Slack | Pro |
| API and CSV export | Every chart exportable; read API for dashboards | Pro |
| Warehouse sync | Daily sync to the customer's own data warehouse | Enterprise |
| SSO-scoped data | Restrict dashboards by region or business unit using SSO groups | Enterprise |

Data freshness: dashboards refresh every 15 minutes; alerts evaluate every 5 minutes.

## 6. Success metrics
- **Attach rate:** 25% of Growth and Enterprise accounts on paid Lumen within two quarters of launch.
- **Habit:** 60% of Lumen accounts with at least 3 weekly active users by week 8.
- **Time to first dashboard:** median under 2 days from enablement.
- **Guardrail:** no increase in S1/S2 support tickets for Atlas core.

## 7. Pricing and packaging
Lumen is priced on active shipments (a shipment with at least one tracking event in the calendar month) in three tiers: Core at $500 per month with 2,000 active shipments included, Pro at $1,500 per month with 10,000 included, and Enterprise on annual contracts from $40,000 per year. Overage rates, guardrails and open questions are in the pricing strategy memo. Pricing locks on ${dayLabel(dates.pricingLock)}.

## 8. Rollout
1. **Private beta (complete):** eight design partners, including Meridian Freight and Tidewell Intermodal.
2. **Customer preview:** existing customers can turn on Lumen two weeks before launch, free until launch day.
3. **Public launch (${dayLabel(dates.launch)}):** landing page, keynote video and launch email.

## 9. Risks and open questions
- **Pricing confidence:** willingness to pay is untested because the beta was free. Mitigation: design-partner pricing (50% off year one) and a bill-shock guardrail.
- **Alert noise:** early beta alerts were too noisy; thresholds now default to the account's 30-day baseline.
- **Data scoping:** SSO-scoped dashboards depend on the session model from ADR-012 being stable.
- **Open:** do we gate carrier scorecards out of Core? Decided with the pricing lock.
`,
    }),

    item({
      id: KNOWLEDGE.pricingMemo,
      kind: 'doc',
      title: 'Pricing strategy memo (draft)',
      summary: 'Draft recommendation to price Lumen as a hybrid: tiered platform fee with included active shipments plus overage, with bill-shock guardrails. Lists the open Core/Pro break-even question.',
      tags: ['pricing', 'lumen', 'packaging', 'strategy'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.lumen, PROJECT.landscape],
      source: { type: 'manual' },
      pinned: true,
      createdAt: back(18, 5),
      updatedAt: back(3, 4),
      content: `
# Pricing strategy memo: Atlas Lumen (draft)

**Author:** Morgan Lee · **Reviewers:** Grace Holloway, Owen Fitzgerald, Aisha Bello · **Decision by:** ${dayLabel(dates.pricingLock)}

## TL;DR
Price Lumen as a hybrid: a monthly platform fee per tier that includes a block of active shipments, plus a per-shipment overage. Three tiers: Core, Pro and Enterprise. Gate on features and volume, protect customers from bill shock, and discount design partners in year one.

## Why not seats?
Atlas core is priced per seat, and two of six churn interviews named per-seat pricing as a reason to leave: occasional users such as warehouse leads and customers' own staff made seats expensive. Analytics value scales with shipment volume, not with the number of people looking at a chart. Seat pricing would also discourage exactly the behaviour we want, which is sharing dashboards widely.

## Why not pure usage?
Pure per-shipment pricing is the most direct but the least predictable. In the Meridian Freight call, Dana Whitfield said predictability matters more than the unit price because their budget is set once a year. Freightly moved to per-load pricing this year and added spend caps a few weeks later, which we read as a sign of bill-shock complaints (our inference, not confirmed).

## Recommendation (draft tiers)
| Tier | Platform fee | Included active shipments | Overage | Key features |
|---|---|---|---|---|
| **Core** | $500 / month | 2,000 | $0.12 per shipment | Performance dashboard, weekly exception digest, 13 months of history |
| **Pro** | $1,500 / month | 10,000 | $0.08 per shipment | Core plus carrier scorecards, lane cost trends, real-time alerts, API and CSV export, 25 months of history |
| **Enterprise** | from $40,000 / year | Custom | Custom | Pro plus warehouse sync, SSO-scoped data, a dedicated onboarding analyst and a 99.9% uptime SLA |

- **Annual billing:** two months free.
- **Design partners:** 50% off year one for the eight beta accounts.
- **Active shipment:** a shipment with at least one tracking event in the calendar month. Shipments with no events are free.

## Bill-shock guardrails
1. Usage alerts at 80% and 100% of included volume, sent to account admins.
2. For the first three months, overage is capped at 25% of the plan fee.
3. Enterprise contracts true up once a year at renewal, never mid-term.

## Expected impact
At list price, the eight design partners would generate roughly $8,000 in monthly recurring revenue before the design-partner discount, and seven of the eight would be cheapest on Core. That is the main weakness of this draft (see open question 1).

## Open questions
1. **Core and Pro break-even.** Core plus overage stays cheaper than Pro until about 10,300 active shipments a month, so volume alone never pushes anyone to Pro. Option B caps Core at 6,000 active shipments and raises Core overage to $0.15.
2. **Scorecards in Core?** Scorecards are the most-used beta feature (6 of 8 partners weekly). Gating them drives upgrades but may slow adoption.
3. **Enterprise floor.** Is $40,000 a year right for accounts like Meridian Freight at 18,400 active shipments a month?
4. **Outside evidence.** We need a view on how hybrid and usage-based pricing is working elsewhere before the decision.

## Next steps
- Ledger: model Option A (this draft) against Option B on current accounts.
- Morgan: fold outside research into this memo and review with Grace and Owen before ${dayLabel(dates.pricingLock)}.
`,
    }),

    item({
      id: KNOWLEDGE.personaOlivia,
      kind: 'doc',
      title: 'Persona: Olivia, operations manager',
      summary: 'Composite persona of the primary Lumen user: an operations manager at a mid-market forwarder who lives in spreadsheets on Mondays and wants fewer surprises.',
      tags: ['persona', 'ux-research', 'operations', 'lumen'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.lumen, PROJECT.atlas],
      source: { type: 'manual' },
      createdAt: back(58, 2),
      updatedAt: back(30, 6),
      content: `
# Persona: Olivia, operations manager

> "I don't need more data. I need to know which five shipments I should worry about today."

## Snapshot
- **Role:** operations manager at a mid-market freight forwarder with 120 to 400 employees
- **Team:** 6 to 12 coordinators and dispatchers; reports to a head of operations
- **Tools today:** Atlas Portal, a transportation management system (TMS), email, and a shared spreadsheet she rebuilds every Monday
- **Measured on:** on-time delivery, cost per shipment, customer complaints and carrier performance

## A day in Olivia's life
Olivia starts at 7:30 with the overnight exceptions: shipments that missed a milestone, trucks that never checked in, a customer email asking where their container is. By 9:00 she has triaged the urgent ones and handed the rest to coordinators. Mondays are worse: before the 10:00 carrier review she exports the previous week's shipments, rebuilds the pivot tables and checks the numbers twice, because last month a carrier disputed them in the meeting.

## Goals
- Fewer surprises: hear about a problem before the customer does.
- Hold carriers accountable with numbers nobody argues with.
- Spend Monday mornings on decisions, not on spreadsheets.
- Show her boss that service levels are improving.

## Frustrations
- Reports go stale the moment she exports them.
- Alerts in other tools fire for everything, so she ignores all of them.
- Every system has a slightly different definition of "on time".
- Getting a new view built means asking IT and waiting weeks.

## Jobs to be done
| When… | I want to… | So I can… |
|---|---|---|
| a shipment starts to slip | be told early, with context | warn the customer and re-plan before it becomes a complaint |
| I prepare a carrier review | pull an agreed scorecard in one click | spend the meeting on decisions |
| a lane gets more expensive | see the trend and the outliers | renegotiate or move volume |
| my boss asks how we are doing | share a live dashboard | avoid building another slide |

## How Atlas and Lumen help
- The performance dashboard and weekly exception digest replace the Monday export.
- Carrier scorecards use one definition of on time for everyone.
- Alerts tuned to her account's own baseline keep the noise down.

## What would make her churn
Bad data she has to explain to her boss, alerts she learns to ignore, or a tool that only her team can see because extra seats cost too much.

## Where this persona comes from
A composite from 14 discovery interviews and the eight Lumen design partners. Olivia is not a real person.
`,
    }),

    item({
      id: KNOWLEDGE.glossary,
      kind: 'doc',
      title: 'Atlas glossary',
      summary: 'Shared definitions for logistics and Atlas terms: active shipment, lane, dwell time, exception, scorecard, TTFV, GRR and more.',
      tags: ['glossary', 'onboarding', 'logistics', 'definitions'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.atlas, PROJECT.lumen, PROJECT.ops],
      source: { type: 'agent' },
      author: agentActor(AGENT.archivist),
      createdAt: back(55, 1),
      updatedAt: back(9, 23),
      content: `
# Atlas glossary

Shared definitions used across product, support and sales. Maintained by Archivist; duplicates from the old Notion "Terms" page were merged into this one.

| Term | Definition |
|---|---|
| **Active shipment** | A shipment with at least one tracking event in a calendar month. The billing unit for Lumen. |
| **Add-on** | A paid module on top of an Atlas plan. Lumen is the first one. |
| **BOL (bill of lading)** | The carrier-issued document listing goods, origin and destination. Stored as a shipment document in Atlas. |
| **Carrier scorecard** | A Lumen report rating carriers on on-time rate, damage rate and invoice accuracy. |
| **Design partner** | One of the eight customers in the Lumen private beta. |
| **Dwell time** | Time a shipment spends stationary at a facility between two milestones. |
| **EDI** | Electronic data interchange: structured messages many carriers and TMSs use instead of APIs. |
| **Exception** | A shipment event outside expectation: late pickup, missed milestone, damage, or no tracking update for 24 hours. |
| **GRR (gross revenue retention)** | Revenue kept from existing customers over a period, excluding expansion. |
| **Lane** | An origin and destination pair, for example a port to a regional distribution center. |
| **Milestone (shipment)** | A tracked step: booked, picked up, departed, arrived, delivered. |
| **OTIF** | On time, in full: delivered by the promised date with the full quantity. |
| **POD (proof of delivery)** | Signed confirmation that a shipment was delivered. |
| **Seat** | A named Atlas user licence. Atlas core plans are priced per seat. |
| **SP-initiated / IdP-initiated SSO** | Sign-in that starts at the Atlas login page (SP) or at the customer's identity provider dashboard (IdP). |
| **Tenant** | One customer's isolated Atlas environment. SSO is configured per tenant. |
| **TMS** | Transportation management system, the system of record most customers connect to Atlas by API or EDI. |
| **TTFV (time to first value)** | Days from contract signature to the customer's first live shipment tracked in Atlas. |

## Usage notes
- Say "exception", not "issue", in product copy.
- "On time" means within the carrier's committed window, not the original booking estimate.
- When in doubt about a Lumen metric, link to this page rather than redefining it in a doc.
`,
    }),

    item({
      id: KNOWLEDGE.okrsDraft,
      kind: 'doc',
      title: 'Q1 OKRs (draft)',
      summary: 'Draft product OKRs for Q1: make Lumen a habit, reduce churn by making Atlas easier to start with, and finish Portal v2. Baselines included.',
      tags: ['okrs', 'planning', 'strategy', 'q1'],
      collectionId: COLLECTION.product,
      projectIds: [],
      source: { type: 'chat', ref: { kind: 'message', id: MSG.okrsSaved } },
      createdAt: back(0, 4, 57),
      content: `
# Q1 product OKRs (draft)

Draft for leadership review with Grace Holloway. Three objectives; baselines are from last quarter unless noted.

## O1. Make Lumen a habit for operations teams
| Key result | Baseline | Target | Owner |
|---|---|---|---|
| Growth and Enterprise accounts on paid Lumen | 0% (launches this quarter) | 15% | Morgan |
| Lumen accounts with at least 3 weekly active users | 5 of 8 beta partners | 60% | Morgan |
| Median time to first dashboard | not measured | under 2 days | Marcus |

## O2. Customers stay because Atlas gets easier to start with
| Key result | Baseline | Target | Owner |
|---|---|---|---|
| Gross revenue retention | 89% | 92% | Theo and Morgan |
| Median time to first value for new accounts | 19 days | 10 days | Morgan |
| S1/S2 tickets meeting the first-response target | 91% | 97% | Theo |

## O3. Finish Portal v2
| Key result | Baseline | Target | Owner |
|---|---|---|---|
| Accounts on Portal v2 | beta tenants only | 100% | Priya |
| p95 page load on the shipments board | 2.4 s | under 1.5 s | Priya |
| Invoices mismatched in the Stripe dual-run | not started | under 0.5% | Daniel |

## Notes
- O1 is the first step toward the PRD goal of 25% attach within two quarters of launch.
- O2 targets the top churn theme: slow onboarding (4 of 6 churn interviews).
- No uptime KR on purpose: uptime is a standing SLA, not a quarterly bet.
- Not yet aligned with Sales targets; Ravi to review O1 before the leadership offsite.
`,
    }),

    item({
      id: KNOWLEDGE.slaPolicy,
      kind: 'doc',
      title: 'Support SLA policy',
      summary: 'Severity definitions (S1–S4), first-response targets by plan, escalation path and Enterprise service credits.',
      tags: ['support', 'sla', 'policy', 'severity'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.ops],
      source: { type: 'manual' },
      createdAt: back(50, 4),
      updatedAt: back(19, 2),
      content: `
# Support SLA policy

Applies to all Atlas plans. Times are first-response targets. Resolution times are goals, not contractual commitments.

## Severity definitions
| Severity | Definition | Examples |
|---|---|---|
| **S1, critical** | Production unusable or data at risk for many users, no workaround | Users cannot log in; shipments not updating for all users; checkout down |
| **S2, high** | Major feature degraded; the workaround is painful | Checkout slow; repeated SSO logouts for one tenant; wrong invoices for one account |
| **S3, normal** | Minor feature problem with a reasonable workaround | Report export fails intermittently |
| **S4, low** | Question, how-to or feature request | How do I add a carrier? |

## First-response targets
| Plan | S1 | S2 | S3 | S4 | Coverage |
|---|---|---|---|---|---|
| Enterprise | 1 hour, 24/7 | 4 business hours | 1 business day | 2 business days | 24/7 for S1, business hours otherwise |
| Growth | 2 business hours | 8 business hours | 2 business days | 3 business days | Business hours |
| Starter | 4 business hours | 1 business day | 3 business days | 5 business days | Business hours |

Business hours are 08:00 to 18:00 in the customer's primary region (North America or Europe), Monday to Friday.

## Resolution goals
- S1: workaround within 4 hours, fix within 1 business day.
- S2: fix or workaround within 3 business days.

## Escalation path
1. Support engineer (tier 1).
2. Tier 2 for integrations, SSO and billing, led by Lucía Fernández.
3. Engineering on-call, paged for S1 only.
4. For any S1 at an Enterprise account, Theo Brandt informs the account manager.

## Service credits (Enterprise)
If monthly uptime falls below 99.9%, the customer receives a 10% credit; below 99.5%, a 25% credit.

## Measurement
Attainment is reported monthly. Last quarter, 91% of S1 and S2 tickets met the first-response target.

## Under review
Enterprise renewals are asking for a 30-minute S1 response, 24/7. Severity definitions will be aligned with the triage rubric v2 once it is approved.
`,
    }),

    item({
      id: KNOWLEDGE.triageRubric,
      kind: 'doc',
      title: 'Support triage rubric v2',
      summary: 'How Sentinel and the support team categorize and prioritize tickets: seven categories, an impact × urgency severity matrix, capped account modifiers, a billing urgency rule and routing.',
      tags: ['support', 'triage', 'rubric', 'sentinel', 'automation'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.ops],
      source: { type: 'chat', ref: { kind: 'message', id: MSG.triageDoc } },
      createdAt: back(9, 5, 57),
      updatedAt: back(4, 3, 30),
      content: `
# Support triage rubric v2

Used by Sentinel, the autonomous triage agent, and by the support team to categorize and prioritize every inbound ticket. **Status: in review with Theo Brandt.** Replaces v1 once approved.

## What changed from v1
- Severity comes from impact × urgency, not from the category alone. (v1 filed an enterprise SSO lockout as "how-to".)
- Account modifiers can raise severity by at most one level.
- Below a confidence of 0.7, Sentinel routes the ticket to the human queue instead of guessing.
- New billing urgency rule, added after the shadow week.

## Step 1: category
| Category | Includes | Default owner |
|---|---|---|
| Access & SSO | login failures, SSO, sessions, permissions | Tier 2 |
| Billing | invoices, payments, plan changes, tax | Tier 2 (billing) |
| Tracking accuracy | missing or wrong shipment events | Tier 1, then Data |
| Integrations | TMS, EDI, API, webhooks | Tier 2 (integrations) |
| Performance | slowness, timeouts | Tier 1; engineering on-call for S1/S2 |
| How-to | questions about using Atlas or Lumen | Tier 1 |
| Feature request | ideas and missing capabilities | Product (weekly review) |

## Step 2: severity from impact × urgency
| Impact | Urgent (blocking work now) | Soon (today or this week) | Whenever |
|---|---|---|---|
| Many users or all tenants | S1 | S2 | S3 |
| One team or one tenant | S2 | S3 | S4 |
| One user | S3 | S4 | S4 |

## Step 3: modifiers (at most +1 level in total)
- Enterprise plan: +1
- Renewal within 90 days: +1
- Repeat issue (same account and category, 3 or more tickets in 30 days): +1

Modifiers never raise a ticket to S1 unless the impact is "many users", or the account is Enterprise and its users cannot log in at all.

## Billing urgency rule
Treat a ticket as urgent when it mentions a failed payment, an overdue notice or a duplicate charge. This matters most during the Stripe cutover window.

## Step 4: route
- **S1:** page engineering on-call and alert #support-urgent in Slack. Sentinel asks for approval before posting.
- **S2:** tier 2 queue plus a Slack alert.
- **S3 and S4:** normal queue.
- **Feature requests:** create a task in the product backlog.

## Worked examples
| Ticket | Category | Severity | Why |
|---|---|---|---|
| Dispatchers logged out 15 minutes after SSO sign-in (Halden, Enterprise) | Access & SSO | S2 | One tenant, urgent: S2. Users can sign back in, so the Enterprise modifier cannot lift it to S1. |
| Checkout timing out during the latency incident | Performance | S1 | Many tenants, urgent |
| Invoice shows the wrong VAT (Growth, renews in 40 days) | Billing | S2 | One account, soon: S3, plus the renewal modifier |
| How do I share a dashboard? | How-to | S4 | One user, whenever |

## Calibration
In the shadow week Sentinel agreed with Theo on 41 of 46 tickets (89%). Three of the five misses were billing tickets rated S3 that Theo rated S2, which led to the billing urgency rule. Re-check agreement weekly for the first month; Theo owns the label set.
`,
    }),

    item({
      id: KNOWLEDGE.csvAccounts,
      kind: 'dataset',
      title: 'Top accounts by ARR.csv',
      summary: 'Top 15 Atlas accounts with segment, plan, ARR, seats, monthly active shipments, Lumen beta flag, health and days to renewal.',
      tags: ['accounts', 'arr', 'customers', 'dataset'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.lumen, PROJECT.landscape],
      source: { type: 'upload' },
      file: { name: 'top-accounts-by-arr.csv', mime: 'text/csv', size: ACCOUNTS_CSV.length },
      createdAt: back(13, 4),
      content: ACCOUNTS_CSV,
    }),

    item({
      id: KNO.betaFeedback,
      kind: 'doc',
      title: 'Lumen beta feedback log',
      summary: 'Feedback from the eight Lumen design partners with status, plus feature usage by theme: scorecards used weekly by 6 of 8, alerts kept on by 5 of 8.',
      tags: ['beta', 'feedback', 'lumen', 'design-partners'],
      collectionId: COLLECTION.product,
      projectIds: [PROJECT.lumen],
      source: { type: 'integration', integrationId: 'notion' },
      author: agentActor(AGENT.archivist),
      createdAt: back(36, 2),
      updatedAt: back(10, 4),
      content: `
# Lumen beta feedback log

Compiled from design-partner calls, shared Slack channels and in-app feedback. Synced from Notion; duplicates merged by Archivist. Newest first.

| Partner | Feedback | Theme | Status |
|---|---|---|---|
| Meridian Freight | Needs a daily export into their own data warehouse | Data ownership | Planned: Enterprise warehouse sync |
| Tidewell Intermodal | Scorecards are now part of their carrier QBR deck | Scorecards | Positive |
| Brightwater Haulage | Alerts fire for shipments they already know are late | Alert noise | Fixed: baseline thresholds |
| Vantor Freight Systems | Wants lane costs in EUR and per pallet | Lane costs | Backlog |
| Rookwood Logistics | "The exception digest is the first email I open on Monday" | Digest | Positive |
| Pinecrest Forwarding | Unclear what dwell time includes | Definitions | Fixed: tooltip and glossary entry |
| Saltmarsh Shipping Co. | Dashboard slow with two years of history | Performance | Fixed: pre-aggregation |
| Ashgrove Cold Chain | Wants temperature excursions as exceptions | Cold chain | Not planned for v1 |

## Usage by theme
- **Scorecards:** the strongest pull, used weekly by 6 of 8 partners.
- **Alerts:** noisy at first; after the switch to baseline thresholds, 5 of 8 partners kept alerts on.
- **Exports:** only Meridian Freight and Tidewell Intermodal use API exports.
- **Lane costs:** used by 4 of 8 partners, mostly before carrier negotiations.
- **Habit:** 5 of 8 partners have at least 3 weekly active users.

## Requests we declined for v1
Custom SQL, predictive ETAs and temperature monitoring.
`,
    }),
  ]
}
