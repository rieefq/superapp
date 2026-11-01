import { KNOWLEDGE, PROJECT, THREAD } from '../../ids'
import { ai, dayLabel, kref, MINUTE, textAttachment, user, type SeedCtx, type ThreadSpec } from '../helpers'
import { KNO } from '../keys'

const SEC = 1_000

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

/** The six lines Muse wrote (mirrors the Muse run in the operations part). */
const MUSE_LINES: Array<[string, string]> = [
  ['See where every shipment’s time goes.', 'Lumen turns your Atlas data into lane-by-lane answers.'],
  ['Your operation, measured.', 'On-time rates, dwell times and costs by lane, carrier and customer.'],
  ['From tracking to knowing.', 'Atlas shows where shipments are. Lumen shows why they’re late.'],
  ['Fewer surprises at the dock.', 'Spot slipping lanes a week before your customers do.'],
  ['Every lane. Every carrier. One answer.', 'Benchmarks your team can act on Monday morning.'],
  ['Analytics your ops team will actually open.', 'Built into Atlas. No exports, no spreadsheets.'],
]

export function lumenThreads({ clock, dates, at }: SeedCtx): ThreadSpec[] {
  const { back, wd } = clock
  const pricing = at.chat.pricing
  const launch = at.chat.launchPlan
  const hero = at.chat.heroCopy
  const verdicts = [
    'Clear, but long, and "answers" is vague.',
    'Generic: any analytics product could say it.',
    'Closest to the roof: tracking (Atlas) versus knowing (Lumen) in four words.',
    'Pillar 2 in plain words, with a concrete outcome.',
    'Punchy, but "one answer" promises more than v1 does.',
    '"Actually" sounds defensive, and "no spreadsheets" overclaims.',
  ]
  const museTable = MUSE_LINES.map(([h, s], i) => `| ${i + 1} | ${h} | ${s} | ${verdicts[i]} |`).join('\n')

  return [
    // ------------------------------------------------------------------ Pricing tiers
    {
      id: THREAD.pricing,
      title: 'Pricing tiers for Atlas Lumen',
      projectId: PROJECT.lumen,
      pinned: true,
      contextRefs: [kref(KNOWLEDGE.pricingMemo), kref(KNOWLEDGE.lumenPrd), kref(KNOWLEDGE.csvAccounts)],
      turns: [
        user('msg_pricing_01', pricing - MINUTE, `Lay out seat-based, usage-based and hybrid pricing for Lumen, with the trade-offs for our top accounts. The draft memo leans hybrid: Core is $500 a month with 2,000 active shipments and $0.12 overage; Pro is $1,500 with 10,000 included and $0.08 overage. Use the beta partners' real volumes.`),
        ai('msg_pricing_02', pricing + 50 * SEC, 'sim-deep', `
## Three ways to price Lumen

| Model | How it works | Trade-off for our top accounts |
|---|---|---|
| Per seat | A fee per Lumen user | Meridian wants every coordinator and carrier contact in it; seats would make them ration access. Two of six churn interviews named per-seat pricing as a reason to leave |
| Pure usage | A price per active shipment | Fair, but Meridian sets its budget once a year, and peak season would surprise them |
| Hybrid | A platform fee with included shipments, plus overage | Predictable for most accounts; the draft tiers follow this model |

Market context: Portbase recently moved its Insights tier to per-tracked-shipment pricing (competitor radar), so buyers will compare unit prices whatever we choose.

## The draft hybrid tiers against real volumes
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
          searched: [KNOWLEDGE.pricingMemo, KNOWLEDGE.lumenPrd, KNOWLEDGE.csvAccounts],
          cites: [
            [KNOWLEDGE.pricingMemo, 'a monthly platform fee per tier that includes a block of active shipments, plus a per-shipment overage'],
            [KNOWLEDGE.csvAccounts, 'Tidewell Intermodal,Enterprise,EU,Enterprise,142000,96,9800'],
            [KNOWLEDGE.pricingMemo, 'Dana Whitfield said predictability matters more than the unit price because their budget is set once a year.'],
          ],
          reasoning: 'Three models to compare, judged against the accounts that matter most. Seats conflict with how Meridian wants to share Lumen and with two churn interviews; pure usage conflicts with annual budgets. For the hybrid draft, Core costs 500 + 0.12 × (volume − 2,000) and Pro costs 1,500 + 0.08 × (volume − 10,000). Setting 500 + 0.12x = 1,500 gives x ≈ 8,333 shipments of overage, so Core stays cheaper until roughly 10,333 shipments and volume alone never drives an upgrade.',
          feedback: 'up',
        }),
        user('msg_pricing_03', pricing + 25 * MINUTE, `Owen will push for fewer moving parts. Model option B: cap Core at 6,000 active shipments and raise Core overage to $0.15. Who moves, and what happens to revenue?`),
        ai('msg_pricing_04', pricing + 26 * MINUTE, 'sim-deep', `
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
- **Two partners move to Pro:** Brightwater and Tidewell. Both already use scorecards and alerts every week, so the upgrade comes with features they value.
- **Brightwater's +$412 a month (+38%) is the bill-shock risk.** The memo's guardrail doesn't help here, because this is a tier change rather than overage. Consider a grandfathered Core period for design partners above the cap.
- **Meridian is better served by Enterprise.** Dana asked for an annual commitment with a buffer and a yearly true-up, which is the Enterprise shape.

### Caveat
Eight design partners use Lumen for free. These are price points, not demand curves. A model across all Growth and Enterprise accounts will tell you more than this table can; that's a good job for Ledger.`, {
          searched: [KNOWLEDGE.pricingMemo, KNOWLEDGE.meridianCall, KNOWLEDGE.csvAccounts],
          cites: [
            [KNOWLEDGE.meridianCall, 'Predictability does. Our budget is set once a year.'],
            [KNOWLEDGE.pricingMemo, 'For the first three months, overage is capped at 25% of the plan fee.'],
          ],
        }),
        user('msg_pricing_05', wd(5, 15, 0), `Here's feature usage for the eight design partners. Which features actually justify Pro?`, [
          textAttachment('att_pricing_05', 'lumen-beta-feature-usage.csv', 'text/csv', FEATURE_USAGE_CSV),
        ]),
        ai('msg_pricing_06', wd(5, 15, 1), 'sim-deep', `
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
        user('msg_pricing_07', back(0, 0, 40), `Before we lock this, I want outside evidence on how usage-based and hybrid pricing is playing out in B2B SaaS, especially value metrics and how buyers react to variable bills. Run a deep research.`),
        ai('msg_pricing_08', back(0, 0, 38), 'sim-swift', `
Started a **deep** investigation in Research: **Usage-based pricing trends in B2B SaaS**. Scout is running it in *Q4 Competitive Landscape*.

**Angles**
1. How widely B2B SaaS has adopted usage-based pricing
2. Which value metrics work, and which create friction
3. How buyers react: predictability, caps, commits
4. What it means for an analytics add-on like Lumen

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
        user('msg_launch_01', launch - MINUTE, `Outline the Lumen launch plan against the launch checklist. Launch is ${dayLabel(dates.launch)}. We have one marketer (Aisha), me, and the agents. Existing customers first, then the public.`),
        ai('msg_launch_02', launch + 40 * SEC, 'sim-swift', `
## Lumen launch plan: four phases

**Principle:** existing customers first, so the public launch has proof behind it.

### 1. Beta wrap-up (now to T–14)
- Close out open-beta feedback and ship anything that blocks launch
- Lock pricing and packaging, including the design-partner offer
- Turn the customer preview flag plan into dates

### 2. Announce (T–14 to launch day)
- T–14: launch email to admins and ops leads at Growth and Enterprise accounts. The customer preview opens, free until launch day
- T–7: customer webinar, reusing the keynote
- ${dayLabel(dates.launch)}: landing page, keynote video and social posts

### 3. Enable sales (T–14 to launch day)
- Sales brief on pricing and what not to quote yet
- Portbase talk tracks, the internal FAQ and five help-center articles

### 4. Measure (first 30 days)
- Attach rate and weekly active users at T+14 and T+30
- Office hours twice a week; onboarding emails tied to the first dashboard

### Owners
| Workstream | Owner | Help from |
|---|---|---|
| Pricing, sales brief | Morgan | Ledger (revenue model) |
| Messaging, copy, email | Aisha | Morgan |
| Visuals, hero video, keynote | Aisha | Muse |
| Internal updates | Morgan | Herald (weekly digest) |
| Competitive proof | Morgan | Scout |

Each phase maps to a section of the launch checklist, so progress shows up there. **Biggest risk:** if pricing slips, everything customer-facing slips with it. Protect the pricing date.`, {
          searched: [KNOWLEDGE.launchChecklist, KNOWLEDGE.messagingHouse],
          cites: [
            [KNOWLEDGE.launchChecklist, 'Customer preview flag plan: available to existing customers two weeks before launch'],
            [KNOWLEDGE.messagingHouse, "See every shipment's story, and catch exceptions before your customers do."],
          ],
        }),
        user('msg_launch_03', launch + 20 * MINUTE, `That's too much for one marketer. What do we cut?`),
        ai('msg_launch_04', launch + 21 * MINUTE, 'sim-swift', `
## Cut list

| Item | Decision | Why |
|---|---|---|
| Press outreach | **Cut** | Low return for an add-on; customers hear about it from us directly |
| Separate webinar deck | **Cut** | Reuse the keynote |
| Social posts | **Keep, with Muse** | Muse recomposes the key art per format; Aisha approves captions |
| Help-center articles | **Keep 5** | Support load is the hidden cost of a launch |
| Hero video | **Keep, with Muse** | Muse drafts the beats and storyboard; Aisha reviews |
| Launch email | **Keep** | The highest-intent channel we have |
| Sales brief | **Keep** | No pricing brief, no pipeline |

Aisha's time then goes to three things only: the email, the landing page copy, and reviewing Muse's visuals. Everything else is cut, reused, or drafted by an agent with a person approving.`),
        user('msg_launch_05', launch + 30 * MINUTE, `Good. Create tasks for the sales brief and the webinar. I already have one for the email.`),
        ai('msg_launch_06', launch + 31 * MINUTE, 'sim-swift', `
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
        user('msg_hero_01', at.museHeroCopy - 6 * MINUTE, `Ask Muse for six hero headline and subline pairs for the Lumen landing page, in brand voice. The audience is ops managers like Olivia.`),
        ai('msg_hero_02', at.museHeroCopy - 5 * MINUTE, 'sim-swift', `
Handed to **Muse** with the messaging house and the brand voice guide as context. It will check every line against the voice guide before handing them back. The six pairs will show up on Muse's run; ask me to compare them against the messaging house once they're in.`),
        user('msg_hero_03', hero - MINUTE, `Muse's six are in. Compare them against the messaging house and pick two to test.`),
        ai('msg_hero_04', hero + 40 * SEC, 'sim-swift', `
## Muse's six, against the messaging house

| # | Headline | Subline | Verdict |
|---|---|---|---|
${museTable}

### Test these two
- **#3 "From tracking to knowing."** It carries the whole positioning (Atlas shows where, Lumen shows why) in four words, and the subline does the explaining.
- **#4 "Fewer surprises at the dock."** It speaks to Olivia's day directly, and "a week before your customers do" is a concrete promise.

Muse reached the same two. Both follow the voice guide: no "finally", no "unlock", and "real-time" is never used for dashboards. A five-second test with beta users would separate them quickly.`, {
          searched: [KNOWLEDGE.brandVoice, KNOWLEDGE.messagingHouse],
          cites: [
            [KNOWLEDGE.messagingHouse, "See every shipment's story, and catch exceptions before your customers do."],
            [KNOWLEDGE.brandVoice, 'Avoid "finally", "simply" and "just": they imply the reader was slow.'],
          ],
        }),
        user('msg_hero_05', at.heroCopyPick, `The five-second test with 12 beta users is in: #3 won clearly, and people repeated "tracking to knowing" back to us. Save the set to Studio for Aisha, with #3 as the pick.`),
        ai('msg_hero_06', at.heroCopyPick + MINUTE, 'sim-swift', `
Saved **Landing page hero copy — variants** to Studio on the *Lumen launch visuals* board:

- **#3 "From tracking to knowing."** at the top, marked as the pick
- #4 as the runner-up, with the other four below as alternates
- Notes for Aisha: the test result, and the voice-guide words to avoid

It sits next to the key art, so she can review copy and visuals together. I'd also update the messaging house so the tagline is on record.`, { feedback: 'up' }),
      ],
    },
  ]
}
