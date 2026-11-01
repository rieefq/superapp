import type { KnowledgeItem } from '@/core/types'
import { AGENT, COLLECTION, INVESTIGATION, KNOWLEDGE, PROJECT } from '../../ids'
import { agentActor, type SeedCtx } from '../helpers'
import { KNO } from '../keys'
import { PORTBASE_REPORT, PORTBASE_SOURCES_APPENDIX } from '../reports'
import { item } from './build'

export function researchKnowledge({ clock }: SeedCtx): KnowledgeItem[] {
  const { back } = clock
  return [
    item({
      id: KNOWLEDGE.portbaseTeardown,
      kind: 'report',
      title: 'Competitor teardown: Portbase',
      summary: 'Portbase wins on onboarding speed and polish, prices per user with analytics only from its Business plan, and has gaps in lane-level cost analysis and support responsiveness.',
      tags: ['competitor', 'portbase', 'positioning', 'pricing'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape],
      source: { type: 'research', ref: { kind: 'investigation', id: INVESTIGATION.portbase } },
      author: agentActor(AGENT.scout),
      createdAt: back(11, 2),
      content: `${PORTBASE_REPORT.trim()}\n\n${PORTBASE_SOURCES_APPENDIX.trim()}\n\n*Saved from the Research investigation "Portbase positioning & pricing" by Scout. Web sources were simulated.*`,
    }),

    item({
      id: KNOWLEDGE.freightlyNotes,
      kind: 'note',
      title: 'Freightly product notes',
      summary: 'Freightly targets small and mid-sized brokers with fast self-serve setup and per-load pricing (with spend caps added later); analytics and enterprise features are thin.',
      tags: ['competitor', 'freightly', 'usage-pricing', 'notes'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape],
      source: { type: 'manual' },
      createdAt: back(26, 4),
      updatedAt: back(12, 5),
      content: `
# Freightly product notes

From Freightly's public webinar recording, their changelog, and two prospects who evaluated them. Updated after their pricing change.

## Who they are
Freightly is a freight visibility and customer-portal tool for small and mid-sized brokers. Strong self-serve motion: a free tier, card checkout and setup in an afternoon.

## Pricing (from their latest changelog)
- Moved from per-seat to per-load pricing: a free tier for low volume, then a per-load fee that falls with volume.
- A few weeks later the changelog added monthly spend caps and usage notifications. My read is that some customers were surprised by their bills. That is an inference, not something they have said.
- No published discount for annual commitments.

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
- One prospect called Freightly's pricing "easy to forecast", which is interesting given the spend caps.

## Implications for Lumen
- Per-load pricing supports a shipment-based value metric in our market.
- Their spend caps are a warning: ship bill-shock guardrails on day one.
- Analytics depth is not their focus, so they are unlikely to compete with Lumen directly soon.

## Follow-ups
- [ ] Review the new per-load pricing page in detail
- [x] Ask the competitor radar workflow to watch their changelog
`,
    }),

    item({
      id: KNOWLEDGE.marketSizing,
      kind: 'doc',
      title: 'Market sizing: mid-market freight portals',
      summary: 'Bottom-up working model from our CRM: about $110M serviceable market for Atlas core and roughly $9M for Lumen at 30% attach. Assumptions are not yet validated externally.',
      tags: ['market-sizing', 'strategy', 'tam', 'lumen'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape, PROJECT.lumen],
      source: { type: 'manual' },
      createdAt: back(47, 6),
      updatedAt: back(33, 2),
      content: `
# Market sizing: mid-market freight portals

**Status:** working model. The assumptions have not been validated externally; use it for prioritization, and do not put it in the board deck without caveats.

## Definition
Mid-market means freight forwarders, 3PLs and asset-light carriers with 50 to 1,000 employees in North America and Europe that give their customers a portal for tracking, documents and invoices.

## Approach: bottom-up from our CRM
1. **Accounts that fit our ideal customer profile:** the CRM lists about 2,300 companies matching the definition, from sales lists, events and inbound leads. Coverage is unknown and probably weakest in Europe.
2. **Atlas core ACV:** the average across all current Growth and Enterprise accounts is about $48,000. The top 10 accounts average about $93,000, so the mean is sensitive to the mix.
3. **Lumen ACV:** a blended $13,500 a year, assuming a 60/40 mix of Core and Pro plus typical overage, with Enterprise deals counted separately.

| Layer | Accounts | ACV | Annual value |
|---|---|---|---|
| Serviceable market, Atlas core | 2,300 | $48,000 | about $110M |
| Lumen add-on at 30% attach | 690 | $13,500 | about $9.3M |
| Obtainable in 3 years (5% of core) | 115 | $48,000 | about $5.5M ARR |

## Sensitivities
- If the CRM covers only 60% of the market, the serviceable market is about $184M.
- An attach rate between 15% and 35% moves Lumen between about $4.7M and $10.9M.
- A 10% change in core ACV moves the serviceable market by about $11M.

## What would change our mind
- Evidence that companies under 200 employees rarely buy portals at all, which would shrink the account count.
- Faster portal adoption among larger enterprises, which would make the upper bound of 1,000 employees too conservative.

## Validation plan
- Cross-check the account count against two industry directories (Scout).
- Interview five European non-customers about how they provide portals today.
- Revisit after Lumen's first quarter with real attach data.
`,
    }),

    item({
      id: KNOWLEDGE.churnInterviews,
      kind: 'doc',
      title: 'Churn interview synthesis (6 customers)',
      summary: 'Six interviews (four churned, two at risk): slow time to first value, export-and-rebuild reporting, slow integration support, per-seat pricing, and SSO logouts at Halden.',
      tags: ['churn', 'interviews', 'customers', 'retention'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape, PROJECT.ops],
      source: { type: 'manual' },
      createdAt: back(21, 5),
      updatedAt: back(15, 3),
      content: `
# Churn interview synthesis (6 customers)

**Interviewer:** Morgan Lee, with Theo Brandt on three calls · **Method:** 45-minute semi-structured calls, notes coded by theme.

## Participants
| Account | Status | Segment | Tenure | Moved to |
|---|---|---|---|---|
| Larkmoor Transport | Churned | Growth | 2.5 years | ShipLoom |
| Granitefold Trucking | Churned | Starter | 1 year | Email and spreadsheets |
| Bluefen Maritime | Churned | Growth | 3 years | Portbase |
| Orchard Row Distribution | Churned | Growth | 1.5 years | In-house portal |
| Coastal Cargo | At risk | Growth | 2 years | Evaluating options |
| Halden Logistics | At risk | Enterprise | 4 years | Not decided |

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
Halden's dispatchers keep getting logged out after signing in with SSO.
> "It makes the whole product feel fragile." IT lead, Halden Logistics

## Who they compared us with
- Two had evaluated Portbase. Bluefen switched, citing the look of the customer-facing portal; its former CSM later heard about slow support responses there.
- Larkmoor moved to ShipLoom on price.

## Recommendations
1. **Onboarding:** target 10 days to first value with integration templates for the five most common TMSs and a named onboarding engineer for Growth and Enterprise.
2. **Lumen:** position it as the end of the Monday spreadsheet; prioritize scorecards and lane trends.
3. **Support:** add an integration specialist to the tier-2 rotation; offer Enterprise a faster S1 response.
4. **Pricing:** do not price Lumen per seat.
5. **Halden:** fix the SSO session expiry before their renewal conversation.

## Caveats
Six interviews: four churned and two at risk. Self-reported reasons tend to over-represent product and support and under-represent budget or acquisitions.
`,
    }),

    item({
      id: KNO.winloss,
      kind: 'note',
      title: 'Win/loss notes: Q3 competitive deals',
      summary: 'Nine competitive Q3 deals: five wins, four losses (two to Portbase on ready-made portal design, one to ShipLoom on price, one no decision).',
      tags: ['win-loss', 'competitive', 'sales', 'portbase'],
      collectionId: COLLECTION.research,
      projectIds: [PROJECT.landscape],
      source: { type: 'manual' },
      createdAt: back(34, 3),
      updatedAt: back(29, 5),
      content: `
# Win/loss notes: Q3 competitive deals

Nine competitive deals closed last quarter. Notes from deal reviews with Ravi Menon's team; buyer quotes are paraphrased from call notes.

| Deal | Segment | Outcome | Competitor | Deciding factor, in the buyer's words |
|---|---|---|---|---|
| Brightwater Haulage (expansion) | Growth | Won | Portbase | Lane-level reporting and the API |
| Kestrelway Air Freight | Growth | Won | Freightly | SSO and an audit log |
| Tidewell Intermodal (upsell) | Enterprise | Won | Portbase | Your team understood EDI |
| Ferncliff Couriers | Starter | Won | ShipLoom | Support answered in hours, not days |
| Quarrystone Haulage | Starter | Won | none | Referral |
| Selwyn Freight Partners | Growth | Lost | Portbase | Their portal was ready out of the box |
| Hartcliff Global Forwarding | Growth | Lost | Portbase | Customer-facing design and a faster go-live |
| Larchfield Logistics | Starter | Lost | ShipLoom | Price |
| Merriton Shipping | Growth | Lost | No decision | Budget frozen |

## Patterns
- **We win** when the buyer has an operations or IT evaluator who cares about data: API, EDI, SSO and lane-level reporting.
- **We lose to Portbase** when the evaluation is led by customer experience or sales and the demo centres on the customer-facing portal.
- **ShipLoom** wins at the low end on price.

## Requests from sales
1. A Portbase battlecard.
2. A demo path that opens with lane cost by carrier (Lumen) instead of the tracking page.
3. Faster sandbox setup for trials.
`,
    }),
  ]
}
