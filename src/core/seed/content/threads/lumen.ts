import { KNOWLEDGE, PROJECT, THREAD } from '../../ids'
import { ai, dayLabel, kref, textAttachment, user, type SeedCtx, type ThreadSpec } from '../helpers'
import { KNO } from '../keys'

/** Beta feature usage export attached in the pricing conversation. Consistent with the beta feedback log. */
export const FEATURE_USAGE_CSV = `partner,active_shipments_mo,weekly_active_users,dashboards_viewed_wk,scorecards_weekly,alerts_on,lane_costs_used,api_exports_mo
Meridian Freight,18400,14,61,yes,yes,yes,42
Tidewell Intermodal,9800,9,37,yes,yes,yes,18
Brightwater Haulage,6900,6,22,yes,yes,yes,0
Vantor Freight Systems,5000,4,15,yes,yes,no,0
Rookwood Logistics,4200,5,17,yes,yes,yes,0
Pinecrest Forwarding,3100,2,6,yes,no,no,0
Saltmarsh Shipping Co.,2600,2,5,no,no,no,0
Ashgrove Cold Chain,1450,1,3,no,no,no,0`

export function lumenThreads({ clock, dates }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  return [
    // ------------------------------------------------------------------ Pricing tiers
    {
      id: THREAD.pricing,
      title: 'Pricing tiers for Atlas Lumen',
      projectId: PROJECT.lumen,
      pinned: true,
      contextRefs: [kref(KNOWLEDGE.pricingMemo), kref(KNOWLEDGE.lumenPrd), kref(KNOWLEDGE.csvAccounts)],
      turns: [
        user('msg_pricing_01', back(5, 6), `Pressure-test the draft Lumen tiers in the pricing memo. Core is $500 a month with 2,000 active shipments and $0.12 overage; Pro is $1,500 with 10,000 included and $0.08 overage. Use the beta partners' real volumes.`),
        ai('msg_pricing_02', back(5, 5, 58), 'sim-deep', `
## What each design partner would pay

Monthly active shipments from *Top accounts by ARR.csv*, priced at list (before the 50% design-partner discount):

| Partner | Active shipments | Core | Pro | Cheapest |
|---|---:|---:|---:|---|
| Ashgrove Cold Chain | 1,450 | $500 | $1,500 | Core |
| Saltmarsh Shipping Co. | 2,600 | $572 | $1,500 | Core |
| Pinecrest Forwarding | 3,100 | $632 | $1,500 | Core |
| Rookwood Logistics | 4,200 | $764 | $1,500 | Core |
| Vantor Freight Systems | 5,000 | $860 | $1,500 | Core |
| Brightwater Haulage | 6,900 | $1,088 | $1,500 | Core |
| Tidewell Intermodal | 9,800 | $1,436 | $1,500 | Core |
| Meridian Freight | 18,400 | $2,468 | $2,172 | Pro |

At the cheapest tier for each, that's about **$8,000 a month** across the eight partners.

### The structural problem
Core plus overage stays cheaper than Pro until **about 10,300 active shipments** ($500 + $0.12 × 8,333 ≈ $1,500). So **volume never pushes anyone to Pro**; only features do. Seven of eight partners would sit on Core, including Tidewell at 9,800 shipments a month.

### Options
1. **Lean on feature gating.** Keep the prices and make Pro's features (scorecards, alerts, API) the reason to upgrade.
2. **Raise Core overage.** At $0.15 the break-even drops to about 8,700 shipments; at $0.18, to about 7,600.
3. **Cap Core volume.** Above a ceiling, say 6,000 active shipments, Core isn't available.

Option 3 is the easiest for customers to understand ("Core is for teams up to 6,000 shipments a month"). Option 1 is worth doing whichever you pick.`, {
          searched: [KNOWLEDGE.pricingMemo, KNOWLEDGE.csvAccounts, KNOWLEDGE.lumenPrd],
          cites: [
            [KNOWLEDGE.pricingMemo, 'a monthly platform fee per tier that includes a block of active shipments, plus a per-shipment overage'],
            [KNOWLEDGE.csvAccounts, 'Tidewell Intermodal,Enterprise,EU,Enterprise,142000,96,9800'],
          ],
          reasoning: 'The memo’s tiers can be tested against each design partner’s monthly active shipments from the accounts CSV. Core costs 500 + 0.12 × (volume − 2,000) and Pro costs 1,500 + 0.08 × (volume − 10,000). Setting 500 + 0.12x = 1,500 gives x ≈ 8,333 shipments of overage, so Core stays cheaper until roughly 10,333 shipments. The volume component therefore never drives an upgrade on its own; the levers are feature gating, a higher Core overage, or a Core volume cap.',
          feedback: 'up',
        }),
        user('msg_pricing_03', back(5, 5, 30), `Owen will push for fewer moving parts. Model option B: cap Core at 6,000 active shipments and raise Core overage to $0.15. Who moves, and what happens to revenue?`),
        ai('msg_pricing_04', back(5, 5, 28), 'sim-deep', `
## Option B: Core capped at 6,000, overage $0.15

| Partner | Shipments | Option A | Option B | Change |
|---|---:|---:|---:|---:|
| Ashgrove Cold Chain | 1,450 | $500 (Core) | $500 (Core) | none |
| Saltmarsh Shipping Co. | 2,600 | $572 (Core) | $590 (Core) | +$18 |
| Pinecrest Forwarding | 3,100 | $632 (Core) | $665 (Core) | +$33 |
| Rookwood Logistics | 4,200 | $764 (Core) | $830 (Core) | +$66 |
| Vantor Freight Systems | 5,000 | $860 (Core) | $950 (Core) | +$90 |
| Brightwater Haulage | 6,900 | $1,088 (Core) | $1,500 (Pro) | +$412 |
| Tidewell Intermodal | 9,800 | $1,436 (Core) | $1,500 (Pro) | +$64 |
| Meridian Freight | 18,400 | $2,172 (Pro) | $2,172 (Pro) | none |
| **Total** | | **$8,024** | **$8,707** | **+$683 (+8.5%)** |

### Read-out
- **Two partners move to Pro:** Brightwater and Tidewell. Both already use scorecards and alerts weekly, so the upgrade comes with features they value.
- **Brightwater's +$412 a month (+38%) is the bill-shock risk.** The memo's guardrail doesn't help here, because this is a tier change rather than overage. Consider a grandfathered Core period for design partners above the cap.
- **Meridian is better served by Enterprise.** Dana asked for an annual commitment with a buffer and a yearly true-up, which is the Enterprise shape.

### Caveat
Eight design partners used Lumen for free. These are price points, not demand curves. A model across all Growth and Enterprise accounts will tell you more than this table can; that's a good job for Ledger.`, {
          searched: [KNOWLEDGE.pricingMemo, KNOWLEDGE.meridianCall, KNOWLEDGE.csvAccounts],
          cites: [
            [KNOWLEDGE.meridianCall, 'Predictability does. Our budget is set once a year.'],
            [KNOWLEDGE.pricingMemo, 'For the first three months, overage is capped at 25% of the plan fee.'],
          ],
        }),
        user('msg_pricing_05', back(4, 7), `Here's feature usage from the beta. Which features actually justify Pro?`, [
          textAttachment('att_pricing_05', 'lumen-beta-feature-usage.csv', 'text/csv', FEATURE_USAGE_CSV),
        ]),
        ai('msg_pricing_06', back(4, 6, 58), 'sim-deep', `
## Which features earn the upgrade

| Feature | Partners using it | Who | Signal |
|---|---:|---|---|
| Carrier scorecards (weekly) | 6 of 8 | everyone above 3,000 shipments | The strongest pull: the natural Pro anchor |
| Alerts kept on | 5 of 8 | everyone above 4,000 shipments | Valued once tuned to the baseline |
| Lane cost trends | 4 of 8 | Meridian, Tidewell, Brightwater, Rookwood | Used before carrier negotiations |
| API exports | 2 of 8 | Meridian, Tidewell | Enterprise-shaped (warehouse, BI) |

### Recommendation
- **Core:** the performance dashboard and the weekly exception digest. Enough for smaller teams to build the habit.
- **Pro:** scorecards, real-time alerts and lane cost trends. That's where usage concentrates, and it lines up with the volume cap in option B.
- **Enterprise:** API and warehouse sync, SSO-scoped data and annual true-ups.

Gating scorecards out of Core is the biggest call. Pinecrest uses them weekly at 3,100 shipments, so it would choose between Core without its favourite feature and Pro at 2.4× the price. One way out: a read-only monthly scorecard in Core, with weekly scorecards and exports in Pro.

### Caveat
Usage during a free beta tells you what people value, not what they'll pay for. Treat this as a hypothesis to check in the first 30 days of sales.`, {
          searched: [KNO.betaFeedback, KNOWLEDGE.pricingMemo],
          cites: [[KNO.betaFeedback, 'the strongest pull, used weekly by 6 of 8 partners.']],
        }),
        user('msg_pricing_07', back(0, 0, 40), `Before we lock this, I want outside evidence on how hybrid and usage-based pricing is playing out in B2B SaaS, especially bill shock and choosing a value metric. Run a deep research.`),
        ai('msg_pricing_08', back(0, 0, 38), 'sim-swift', `
Started a **deep** investigation in Research: **Usage-based pricing trends in B2B SaaS**.

**Angles**
1. Hybrid models: platform fee plus usage
2. Choosing a value metric customers can predict
3. Bill-shock guardrails: alerts, caps and true-ups
4. Moving existing customers from seats to usage
5. Competitor moves: Freightly, Portbase, ShipLoom

You can follow it live in Research; sources appear as they're read. Web sources here come from the simulated search corpus and are labeled that way. When it finishes, I'll map the findings onto the memo's open questions: the Core/Pro break-even, scorecard gating and the Enterprise floor. The pricing lock is ${dayLabel(dates.pricingLock)}, so there's time to review before the decision.`, {
          searched: [KNOWLEDGE.pricingMemo],
          cites: [[KNOWLEDGE.pricingMemo, 'We need a view on how hybrid and usage-based pricing is working elsewhere before the decision.']],
        }),
      ],
    },

    // ------------------------------------------------------------------ Launch plan
    {
      id: THREAD.launchPlan,
      title: 'Launch plan outline',
      projectId: PROJECT.lumen,
      pinned: true,
      contextRefs: [kref(KNOWLEDGE.launchChecklist), kref(KNOWLEDGE.messagingHouse)],
      turns: [
        user('msg_launch_01', back(8, 6), `Outline the Lumen launch plan. Launch is ${dayLabel(dates.launch)}. We have one marketer (Aisha), me, and the agents. Existing customers first, then the public.`),
        ai('msg_launch_02', back(8, 5, 58), 'sim-deep', `
## Lumen launch plan

**Principle:** existing customers first, so the public launch has proof behind it.

### Phase 0 · Readiness (now to T–14)
- Lock pricing and packaging
- Finalize the messaging house; hero copy and the keynote follow from it
- Five help-center articles, plus an internal FAQ for sales and support

### Phase 1 · Customer preview (T–14 to T–1)
- Existing customers can turn on Lumen free until launch day
- Launch email to admins and ops leads at Growth and Enterprise accounts
- Customer webinar: a 30-minute walkthrough plus Q&A
- Sales brief on pricing and the Portbase comparison

### Phase 2 · Public launch (T–0, ${dayLabel(dates.launch)})
- Landing page with hero copy, video and a Meridian quote (if approved)
- Keynote video of about 12 minutes, reused as the webinar recording
- Social posts across launch week

### Phase 3 · Adoption (T+1 to T+14)
- Onboarding emails tied to first-dashboard milestones
- Office hours twice a week
- Review attach rate and weekly active users at T+14

### Owners
| Workstream | Owner | Help from |
|---|---|---|
| Pricing, sales brief | Morgan | Ledger (revenue model) |
| Messaging, copy, email | Aisha | Morgan |
| Visuals, hero video, keynote | Aisha | Muse |
| Internal updates | Morgan | Herald (weekly digest) |
| Competitive proof | Morgan | Scout |

### Biggest risk
If pricing slips, everything customer-facing slips with it. Protect the pricing date.`, {
          searched: [KNOWLEDGE.lumenPrd, KNOWLEDGE.launchChecklist, KNOWLEDGE.messagingHouse],
          cites: [
            [KNOWLEDGE.lumenPrd, 'existing customers can turn on Lumen two weeks before launch, free until launch day.'],
            [KNOWLEDGE.messagingHouse, "See every shipment's story, and catch exceptions before your customers do."],
          ],
        }),
        user('msg_launch_03', back(8, 5, 30), `That's too much for one marketer. What do we cut?`),
        ai('msg_launch_04', back(8, 5, 29), 'sim-deep', `
## Cut list

| Item | Decision | Why |
|---|---|---|
| Press outreach | **Cut** | Low return for an add-on; customers hear about it from us directly |
| Separate webinar deck | **Cut** | Reuse the keynote |
| Social posts | **Reduce to 6** | Two features, one quote, one behind-the-build post, plus launch day |
| Help-center articles | **Keep 5** | Support load is the hidden cost of a launch |
| Hero video | **Keep, with Muse** | Muse drafts the storyboard and cutdowns; Aisha reviews |
| Launch email | **Keep** | The highest-intent channel we have |
| Sales brief | **Keep** | No pricing brief, no pipeline |

Aisha's time then goes to three things only: the email, the landing page copy, and reviewing Muse's visuals. Everything else is cut, reused, or drafted by an agent with a person approving.`),
        user('msg_launch_05', back(8, 5, 10), `Good. Create tasks for the sales brief and the webinar. I already have one for the email.`),
        ai('msg_launch_06', back(8, 5, 9), 'sim-swift', `
Created two tasks in **Lumen Launch**:

1. **Brief sales team on Lumen pricing**: blocked by the pricing lock. Covers the tiers, what not to quote yet, the design-partner offer and the Portbase talk tracks.
2. **Schedule launch webinar**: 30 minutes plus Q&A during the customer preview, reusing the keynote.

Both link back to this plan.`),
      ],
    },

    // ------------------------------------------------------------------ Hero copy
    {
      id: THREAD.heroCopy,
      title: 'Hero copy variations',
      projectId: PROJECT.lumen,
      contextRefs: [kref(KNOWLEDGE.messagingHouse), kref(KNOWLEDGE.brandVoice), kref(KNOWLEDGE.personaOlivia)],
      turns: [
        user('msg_hero_01', back(2, 7), `Write five hero headline and subhead options for the Lumen landing page. Follow the messaging house and the voice guide. The audience is ops managers like Olivia.`),
        ai('msg_hero_02', back(2, 6, 59), 'sim-swift', `
Five directions, each anchored to a part of the messaging house:

| # | Headline | Subhead | Anchor |
|---|---|---|---|
| 1 | See every shipment's story. | Lumen turns your Atlas data into live dashboards, carrier scorecards and exception alerts, so you can fix problems before your customers notice. | Roof |
| 2 | Know which lanes are slipping before Monday's review. | Carrier scorecards and lane trends, built from the shipments you already track in Atlas. | Pillar 1 |
| 3 | From spreadsheet Mondays to answers in minutes. | Your carrier review, ready when you are. | Pillar 1 |
| 4 | Exceptions, caught early. | Live alerts for late, stuck and at-risk shipments, tuned to your own baseline. | Pillar 2 |
| 5 | What does each lane really cost? | Cost per shipment and per kg by lane and carrier, with outliers flagged. | Pillar 3 |

### Notes
- **1** is the safest and the most generic. It works better as a tagline than a headline.
- **2** and **3** speak most directly to Olivia's Monday; her persona quote is literally about knowing what to worry about.
- **4** is strong for Pro but undersells the dashboards.
- **5** speaks to heads of operations more than to Olivia.
- I avoided "finally", "real-time" for dashboards, and "visibility" on its own.`, {
          searched: [KNOWLEDGE.messagingHouse, KNOWLEDGE.brandVoice, KNOWLEDGE.personaOlivia],
          cites: [
            [KNOWLEDGE.messagingHouse, 'carrier reviews and lane reports that build themselves.'],
            [KNOWLEDGE.brandVoice, 'Avoid "finally", "simply" and "just": they imply the reader was slow.'],
            [KNOWLEDGE.personaOlivia, "I don't need more data. I need to know which five shipments I should worry about today."],
          ],
        }),
        user('msg_hero_03', back(2, 6, 30), `2 and 3 are closest. 3 echoes Meridian's quote, which I like, but "spreadsheet Mondays" might not land outside the beta group. Tighten both.`),
        ai('msg_hero_04', back(2, 6, 29), 'sim-swift', `
Tightened versions:

**2a.** Know which lanes are slipping before Monday's review.
*Carrier scorecards and lane trends, built from the shipments you already track in Atlas.*

**2b.** Spot the slipping lane before it costs you a customer.
*Scorecards, lane costs and exception alerts from the shipments already in Atlas.*

**3a.** Your Monday carrier review, done before Monday.
*Lumen builds the report from your Atlas shipments. You bring the decisions.*

**3b.** From spreadsheet Mondays to answers in minutes.
*Lumen builds carrier scorecards, lane trends and exception alerts from the shipments you already track in Atlas.*

### My pick: 3b
The headline is concrete for anyone who has rebuilt a report by hand, which is most of the audience, not just the beta group. The subhead removes any ambiguity by saying exactly what Lumen builds. If "spreadsheet Mondays" tests poorly, fall back to 2a; its subhead works under either headline.`, { feedback: 'up' }),
        user('msg_hero_05', back(0, 3, 10), `Going with 3b. Save the full set to Studio so Aisha can review it next to the visuals.`),
        ai('msg_hero_06', back(0, 3, 9), 'sim-swift', `
Saved **Landing page hero copy — variants** to Studio on the *Lumen launch visuals* board:

- **3b** at the top, marked as the pick
- 2a, 3a, 1 and 4 below as alternates
- Notes for Aisha: 3b echoes Meridian's quote but doesn't depend on it, plus the voice-guide words to avoid

It sits next to the hero image and the storyboard, so she can review copy and visuals together.`),
      ],
    },
  ]
}
