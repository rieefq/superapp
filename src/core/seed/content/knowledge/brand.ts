import type { KnowledgeItem } from '@/core/types'
import { COLLECTION, KNOWLEDGE, PROJECT } from '../../ids'
import { dayLabel, type SeedCtx } from '../helpers'
import { KNO } from '../keys'
import { item } from './build'

export function brandKnowledge({ clock, dates }: SeedCtx): KnowledgeItem[] {
  const { back } = clock
  return [
    item({
      id: KNOWLEDGE.brandVoice,
      kind: 'doc',
      title: 'Brand voice guide',
      summary: 'How Northwind sounds: clear over clever, calm confidence, operator empathy and specifics. Vocabulary, style rules and before/after rewrites.',
      tags: ['brand', 'voice', 'writing', 'style'],
      collectionId: COLLECTION.brand,
      projectIds: [PROJECT.lumen],
      source: { type: 'integration', integrationId: 'notion' },
      pinned: true,
      createdAt: back(59, 2),
      updatedAt: back(24, 4),
      content: `
# Brand voice guide

How Northwind Labs sounds in the product, on the website, in email and in support replies.

## Who we are talking to
Operations people who are busy, skeptical of hype and very good at their jobs. Every vendor they have met has promised them "visibility".

## Voice pillars
| Pillar | We are | We are not |
|---|---|---|
| **Clear over clever** | Plain words, short sentences, one idea at a time | Puns, jargon, vague promises |
| **Calm confidence** | Specific claims we can back up | Superlatives such as "revolutionary" or "best-in-class" |
| **Operator empathy** | Grounded in the work: Monday reviews, late trucks, unhappy customers | Talking about "users" and "stakeholders" |
| **Specific** | Numbers, examples and named outcomes | "Unlock insights", "drive value" |

## Vocabulary
| Say | Don't say |
|---|---|
| shipments, loads | packages, items |
| exceptions | issues, problems (in product copy) |
| carriers | vendors |
| customers, and their customers | end users |
| set up, turn on | onboard, activate (in UI copy) |
| see, spot, catch | leverage, unlock, empower |

## Style rules
- Sentence case for headings and buttons.
- Numerals for numbers: "3 carriers", "15 minutes".
- Use the Oxford comma.
- No exclamation marks in product UI, and at most one per email.
- Avoid "finally", "simply" and "just": they imply the reader was slow.

## Before and after
| Before | After |
|---|---|
| Unlock powerful insights into your supply chain! | See which lanes are running late, and why. |
| Leverage AI to optimize carrier performance. | Compare carriers on on-time rate, damage and invoice accuracy. |
| Simply activate Lumen to get started. | Turn on Lumen in Settings. Dashboards fill in from the shipments you already track. |

## Support replies
Lead with the answer, then the reason, then the next step. Name the person who will follow up. Never blame the customer's setup, even when it is the cause; describe what to change instead.
`,
    }),

    item({
      id: KNOWLEDGE.messagingHouse,
      kind: 'doc',
      title: 'Lumen messaging house',
      summary: 'Lumen’s core message, three pillars with proof points, audience angles, tagline shortlist and words to avoid.',
      tags: ['messaging', 'positioning', 'launch', 'lumen'],
      collectionId: COLLECTION.brand,
      projectIds: [PROJECT.lumen],
      source: { type: 'manual' },
      createdAt: back(23, 5),
      updatedAt: back(7, 3),
      content: `
# Lumen messaging house

## Roof: the one thing to remember
**See every shipment's story, and catch exceptions before your customers do.**

## Foundation
Lumen is built on the shipment, tracking and invoice data customers already keep in Atlas. There is no new integration and no new data pipeline to maintain.

## Pillar 1: end the Monday spreadsheet
- **Message:** carrier reviews and lane reports that build themselves.
- **Proof:** in the beta, Meridian Freight cut its weekly carrier review from about three hours to about twenty minutes (customer-reported; quote pending approval).
- **Features:** performance dashboard, carrier scorecards, scheduled reports.

## Pillar 2: catch exceptions early
- **Message:** know about late, stuck and at-risk shipments before your customer calls.
- **Proof:** alerts are tuned to each account's own 30-day baseline, which cut noise after early beta feedback.
- **Features:** weekly exception digest (Core), real-time alerts (Pro).

## Pillar 3: know what every lane really costs
- **Message:** cost per shipment and per kg by lane and carrier, with outliers flagged.
- **Proof:** design partners used lane cost trends before carrier negotiations (qualitative; collect a named example).
- **Features:** lane cost trends, CSV and API export.

## Audience angles
| Audience | What they care about | Lead with |
|---|---|---|
| Operations managers (Olivia) | Fewer surprises, less manual reporting | Pillars 1 and 2 |
| Heads of operations | Service levels, cost, carrier leverage | Pillar 3 |
| IT and data teams | Security and data ownership | Foundation, plus warehouse sync (Enterprise) |

## Tagline shortlist
- See every shipment's story.
- Exceptions, caught early.
- From spreadsheet Mondays to answers in minutes.

## Words to avoid
- "Visibility" on its own: every competitor says it.
- "AI-powered": we do not lead with it.
- "Real-time" for dashboards, which refresh every 15 minutes; say "live". Alerts evaluate every 5 minutes and can be called real-time.
`,
    }),

    item({
      id: KNOWLEDGE.launchChecklist,
      kind: 'doc',
      title: 'Lumen launch checklist',
      summary: 'Launch readiness checklist for Lumen across product, website and content, customers, enablement, launch day and the two weeks after.',
      tags: ['launch', 'checklist', 'lumen', 'planning'],
      collectionId: COLLECTION.brand,
      projectIds: [PROJECT.lumen],
      source: { type: 'manual' },
      createdAt: back(25, 3),
      updatedAt: back(0, 2, 20),
      content: `
# Lumen launch checklist

Launch: **${dayLabel(dates.launch)}** · Owner: Morgan Lee · Marketing: Aisha Bello

## Product readiness
- [x] Private beta complete with 8 design partners
- [x] Beta feedback fixes shipped (alert thresholds)
- [ ] Pricing and packaging locked (due ${dayLabel(dates.pricingLock)})
- [ ] Lumen usage reported to Stripe as metered usage (depends on the Stripe cutover, ${dayLabel(dates.cutover)})
- [ ] Customer preview flag plan: available to existing customers two weeks before launch

## Website and content
- [x] Messaging house approved
- [ ] Hero copy final (variant 3b selected; Aisha reviewing)
- [ ] Landing page build
- [ ] Hero video (storyboard in progress with Muse)
- [ ] Keynote deck v2 review
- [ ] Six social posts for launch week

## Customers
- [ ] Launch email to existing customers (draft in review)
- [ ] Customer webinar scheduled
- [ ] Meridian Freight quote approved by their legal team
- [x] Design-partner offer drafted (50% off year one)

## Sales and support enablement
- [ ] Sales brief on pricing (after the pricing lock)
- [ ] Portbase battlecard
- [ ] Internal FAQ (draft ready)
- [ ] Five help-center articles
- [ ] Support macros for Lumen billing questions

## Launch day
- [ ] Lumen available in Settings → Add-ons for all plans
- [ ] Publish the landing page and launch post
- [ ] Herald posts the launch summary to #product-updates (approval required)

## After launch (first two weeks)
- [ ] Review attach rate and weekly active users
- [ ] Office hours for new Lumen accounts
- [ ] Collect a named lane-cost example for pillar 3
`,
    }),

    item({
      id: KNO.lumenFaq,
      kind: 'doc',
      title: 'Lumen launch FAQ (internal)',
      summary: 'Internal answers for sales and support: what Lumen is, draft pricing and what not to quote yet, active shipments, data freshness, exports, SSO scoping and the preview.',
      tags: ['faq', 'sales-enablement', 'support', 'lumen'],
      collectionId: COLLECTION.brand,
      projectIds: [PROJECT.lumen],
      source: { type: 'manual' },
      createdAt: back(6, 5),
      updatedAt: back(2, 3),
      content: `
# Lumen launch FAQ (internal)

For sales, support and customer success. Do not forward externally.

**What is Lumen?**
An analytics add-on for Atlas: a live performance dashboard, carrier scorecards, lane cost trends and exception alerts, built from the shipments customers already track in Atlas.

**Who is it for?**
Operations managers and heads of operations at Growth and Enterprise accounts. Starter accounts can buy Core.

**How is it priced?**
Draft: Core at $500 per month with 2,000 active shipments included, Pro at $1,500 per month with 10,000 included, and Enterprise from $40,000 per year. Pricing locks on ${dayLabel(dates.pricingLock)}. Do not quote overage rates to customers until then.

**What counts as an active shipment?**
A shipment with at least one tracking event in the calendar month. Shipments with no events that month are free.

**Does the customer need a new integration?**
No. Lumen reads data that is already in Atlas.

**How fresh is the data?**
Dashboards refresh every 15 minutes; alerts evaluate every 5 minutes.

**Can customers export data?**
CSV and API export are included in Pro and Enterprise. Enterprise adds a daily sync to the customer's own data warehouse.

**Can access be restricted by region or team?**
Yes, on Enterprise: dashboards can be scoped using the customer's SSO groups.

**What happens if a customer's volume spikes?**
Admins get usage alerts at 80% and 100% of included volume. For the first three months, overage is capped at 25% of the plan fee.

**Is there a trial?**
Existing customers can turn on Lumen two weeks before launch and use it free until launch day. Design partners get 50% off their first year.

**How does it compare with Portbase Insights?**
Insights covers standard KPIs but is thin on lane-level cost analysis and custom reporting. A full battlecard is in progress; see the Portbase teardown in the meantime.

**Who do I ask?**
Product: Morgan Lee. Messaging: Aisha Bello. Deals and pricing exceptions: Ravi Menon.
`,
    }),
  ]
}
