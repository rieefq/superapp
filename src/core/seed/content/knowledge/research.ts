import type { KnowledgeItem } from '@/core/types'
import { AGENT, COLLECTION, INVESTIGATION, KNOWLEDGE, PROJECT } from '../../ids'
import { agentActor, dayLabel, type SeedCtx } from '../helpers'
import { KNO } from '../keys'
import { TIDEWELL_REPORT, TIDEWELL_SOURCES_APPENDIX } from '../reports'
import { item } from './build'

const MIN = 60_000

export function researchKnowledge({ clock, at }: SeedCtx): KnowledgeItem[] {
  const { day } = clock
  const radarUpdates = `
## Updates from the competitor radar
- **${dayLabel(at.radarM2)}:** Tidewell introduced a usage-based Insights tier priced per tracked shipment (tidewell.example/pricing). This changes recommendation 3: compare Lumen with Insights on depth (lane-level cost, scorecards, alerts), not on the pricing model.
- **${dayLabel(at.radarM1)}:** Tidewell raised list prices on its Pro plan by about 8% (tidewell.example/pricing).`

  return [
    item({
      id: KNOWLEDGE.tidewellTeardown,
      kind: 'report',
      title: 'Competitor teardown: Tidewell',
      summary: 'Tidewell sells annual, per-site contracts to enterprise shippers; strongest on customs workflows, weakest on invoicing and self-serve onboarding. Since then it added a usage-based Insights tier and raised Pro prices.',
      tags: ['competitor', 'tidewell', 'positioning', 'pricing'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape],
      source: { type: 'research', ref: { kind: 'investigation', id: INVESTIGATION.tidewell } },
      author: agentActor(AGENT.scout),
      pinned: true,
      createdAt: at.tidewell2 + 20 * MIN,
      updatedAt: at.radarM1 + 25 * MIN,
      content: `${TIDEWELL_REPORT.trim()}\n${radarUpdates}\n\n${TIDEWELL_SOURCES_APPENDIX.trim()}\n\n*Saved from the Research investigation "Tidewell positioning & pricing" by Scout and kept current by the competitor radar. Web sources were simulated.*`,
    }),

    item({
      id: KNOWLEDGE.freightlyNotes,
      kind: 'note',
      title: 'Freightly product notes',
      summary: 'Freightly targets small and mid-sized brokers with fast self-serve setup and per-load pricing in three public tiers; analytics and enterprise features are thin, but it is hiring enterprise sellers in Europe.',
      tags: ['competitor', 'freightly', 'usage-pricing', 'notes'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape],
      source: { type: 'manual' },
      createdAt: day(34, 16, 30),
      updatedAt: at.radarM2 + 25 * MIN,
      content: `
# Freightly product notes

From Freightly's public webinar recording, their changelog, and two prospects who evaluated them. Kept current by the competitor radar and Scout's pricing-page check.

## Who they are
Freightly is a freight visibility and customer-portal tool for small and mid-sized brokers. Strong self-serve motion: a free tier, card checkout and setup in an afternoon.

## Pricing
- Per-load pricing in three public tiers (Free, Standard, Scale); Enterprise is "contact sales".
- The fee per load falls as volume grows.
- A few weeks after the switch, the changelog added monthly spend caps and usage notifications. My read is that some customers were surprised by their bills. That is an inference, not something they have said.
- Scout's daily check of the pricing page has found no change since these notes.

## Strengths
- Fast setup; integrations with common carriers mostly just work.
- A clean tracking page that brokers can white-label.
- A pricing story that is simple to explain: pay per load.

## Weaknesses
- Analytics are basic: a handful of fixed charts and a CSV export.
- Enterprise readiness: SSO only on the top plan and no audit log.
- Limited API: webhooks for status changes only.

## How they show up in our deals
- Rarely head-to-head in the mid-market. More often an incumbent we replace when a broker grows into enterprise needs (Kestrelway Air Freight in Q3).
- When a broker starts serving enterprise shippers, the incumbent we meet is usually Tidewell, not Freightly.
- One prospect called Freightly's pricing "easy to forecast", which is interesting given the spend caps.

## Radar updates
- **${dayLabel(at.radarM4)}:** hiring six enterprise account executives in Rotterdam and Hamburg. A sign they want bigger European accounts.
- **${dayLabel(at.radarM2)}:** shipped carbon reporting for ocean freight.

## Implications for Lumen
- Per-load pricing supports a shipment-based value metric in our market.
- Their spend caps are a warning: ship bill-shock guardrails on day one.
- Analytics depth is not their focus yet; the European enterprise hiring is the thing to watch.
`,
    }),

    item({
      id: KNOWLEDGE.marketSizing,
      kind: 'doc',
      title: 'Market sizing: mid-market freight portals',
      summary: 'Bottom-up and top-down ranges, refreshed by Scout: roughly $42M–$100M serviceable market for Atlas core and $2.5M–$9.6M for Lumen. Directories were de-duplicated before comparing methods.',
      tags: ['market-sizing', 'strategy', 'tam', 'lumen'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape, PROJECT.lumen],
      source: { type: 'manual' },
      createdAt: day(47, 14, 0),
      updatedAt: at.scoutSizing + 15 * MIN,
      content: `
# Market sizing: mid-market freight portals

**Status:** working model, last refreshed by Scout. We report ranges, not points. Use it for prioritization; do not put it in the board deck without the caveats below.

## Definition
Mid-market means freight forwarders, shippers and asset-light carriers with 50 to 500 employees in North America and the EU that give their customers a portal for tracking, documents and invoices. Large enterprise shippers, where Tidewell sells most of its contracts, are outside this definition.

## Method
**Bottom-up:** accounts in the segment × share that already offer a portal × annual contract value.
- Accounts: 1,900 to 2,600, from two trade-association member directories and a customs-broker census, cross-checked against the roughly 2,300 matching companies in our CRM.
- Portal adoption: 55% to 70%, from directory profiles and sales notes.
- Atlas core ACV: $40,000 to $55,000. The nine Growth and Enterprise accounts in our top 15 average about $87,000, so the lower bound leans on smaller accounts.

**Top-down:** a cross-check against two analyst summaries of the freight software market. One vendor report is kept only as weak evidence. All three are simulated web sources in this workspace.

| Layer | Low | High |
|---|---|---|
| Serviceable market, Atlas core | about $42M | about $100M |
| Lumen add-on (20% to 35% attach, $12,000 to $15,000 ACV) | about $2.5M | about $9.6M |
| Obtainable in 3 years (4% to 6% of core) | about $1.7M ARR | about $6.0M ARR |

## Reconciling the two methods
Before de-duplication, the bottom-up range sat 45% above the top-down one. Most of the gap came from 3PL subsidiaries listed separately in both directories. After removing the duplicates, the methods differ by under 20%, which we accept for a working model.

## Confidence
- Medium for the account count, low for portal adoption.
- The ACV range comes from our own customer base and may not hold for European accounts.

## What would change our mind
- Evidence that companies under 100 employees rarely buy portals, which would shrink the account count.
- Faster portal adoption among enterprise shippers moving down-market.

## Validation plan
- Interview five European non-customers about how they provide portals today.
- Revisit after Lumen's first quarter with real attach data.
`,
    }),

    item({
      id: KNOWLEDGE.churnInterviews,
      kind: 'doc',
      title: 'Churn interview synthesis (6 customers)',
      summary: 'Six interviews (four churned, two at risk): slow time to first value, export-and-rebuild reporting, slow integration support, per-seat pricing, and SSO sign-outs at Halden.',
      tags: ['churn', 'interviews', 'customers', 'retention'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape, PROJECT.ops],
      source: { type: 'manual' },
      createdAt: day(21, 17, 0),
      updatedAt: day(15, 10, 30),
      content: `
# Churn interview synthesis (6 customers)

**Interviewer:** Morgan Lee, with Theo Brandt on three calls · **Method:** 45-minute semi-structured calls, notes coded by theme.

## Participants
| Account | Status | Plan | Tenure | Moved to |
|---|---|---|---|---|
| Larkmoor Transport | Churned | Growth | 2.5 years | ShipLoom |
| Granitefold Trucking | Churned | Starter | 1 year | Email and spreadsheets |
| Bluefen Maritime | Churned | Growth | 3 years | Tidewell |
| Orchard Row Distribution | Churned | Growth | 1.5 years | In-house portal |
| Coastal Cargo | At risk | Starter | 2 years | Evaluating options |
| Halden Logistics | At risk | Growth | 4 years | Not decided |

## Themes
### 1. Slow time to first value (4 of 6)
Onboarding took about three weeks or more before the first customer saw a live shipment. TMS integration mapping was the long pole every time.
> "By the time it worked, our customers had stopped asking for it." Operations director, Granitefold Trucking

### 2. Export-and-rebuild reporting (4 of 6)
Teams exported shipments every week to build carrier and lane reports in spreadsheets; two bought a separate BI tool for it.
> "Atlas has all the data. We still spend Monday morning in a spreadsheet." Operations manager, Coastal Cargo

### 3. Slow support on integration issues (3 of 6)
EDI and TMS mapping problems waited days for tier-2 help. In each case the escalation came shortly before a difficult renewal conversation.

### 4. Per-seat pricing penalizes occasional users (2 of 6)
Warehouse leads and customers' own staff needed occasional access. Seats made that expensive, so people shared logins and the audit trail suffered.

### 5. Session reliability with SSO (1 of 6)
Halden's dispatchers keep getting signed out partway through the day after signing in with SSO.
> "It makes the whole product feel fragile." IT lead, Halden Logistics

## Who they compared us with
- Bluefen moved to Tidewell to get customs filings in the same tool as tracking. Its former CSM later heard that the implementation took months.
- Larkmoor moved to ShipLoom on price.

## Recommendations
1. **Onboarding:** target 10 days to first value with integration templates for the five most common TMSs and a named onboarding engineer for Growth and Enterprise.
2. **Lumen:** position it as the end of the Monday spreadsheet; prioritize scorecards and lane trends.
3. **Support:** add an integration specialist to the tier-2 rotation.
4. **Pricing:** do not price Lumen per seat.
5. **Halden:** fix the SSO sign-outs before their renewal conversation.

## Caveats
Six interviews: four churned and two at risk. Self-reported reasons tend to over-represent product and support and under-represent budget or acquisitions.
`,
    }),

    item({
      id: KNO.winloss,
      kind: 'note',
      title: 'Win/loss notes: Q3 competitive deals',
      summary: 'Nine competitive Q3 deals: five wins, four losses. We beat Tidewell on invoicing and time to go-live and lost when customs or day-one analytics decided the deal.',
      tags: ['win-loss', 'competitive', 'sales', 'tidewell'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape],
      source: { type: 'manual' },
      createdAt: day(34, 11, 0),
      updatedAt: day(29, 15, 20),
      content: `
# Win/loss notes: Q3 competitive deals

Nine competitive deals closed last quarter. Notes from deal reviews with Ravi Menon's team; buyer quotes are paraphrased from call notes.

| Deal | Segment | Outcome | Competitor | Deciding factor, in the buyer's words |
|---|---|---|---|---|
| Brightwater Haulage (expansion) | Growth | Won | Tidewell | Invoices and payments in the portal |
| Kestrelway Air Freight | Growth | Won | Freightly | SSO and an audit log |
| Tidewell Intermodal (upsell) | Enterprise | Won | Tidewell | Live in two weeks, not a quarter |
| Ferncliff Couriers | Starter | Won | ShipLoom | Support answered in hours, not days |
| Quarrystone Haulage | Starter | Won | none | Referral |
| Selwyn Freight Partners | Growth | Lost | Tidewell | Customs filings in the same tool |
| Hartcliff Global Forwarding | Growth | Lost | Tidewell | Their analytics module was ready on day one |
| Larchfield Logistics | Starter | Lost | ShipLoom | Price |
| Merriton Shipping | Growth | Lost | No decision | Budget frozen |

## Patterns
- **We beat Tidewell** on invoicing in the portal and on time to go-live. Their per-site implementation projects are slow.
- **We lose to Tidewell** when customs is part of the scope, or when analytics is a day-one requirement. Lumen should close the second gap.
- **ShipLoom** wins at the low end on price.

## Requests from sales
1. A Tidewell battlecard.
2. A demo path that opens with lane cost by carrier (Lumen) instead of the tracking page.
3. Faster sandbox setup for trials.
`,
    }),
  ]
}
