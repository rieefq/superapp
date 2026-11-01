import type { KnowledgeItem } from '@/core/types'
import { COLLECTION, KNOWLEDGE, PROJECT } from '../../ids'
import { dayLabel, weekdayLabel, type SeedCtx } from '../helpers'
import { item } from './build'

export function meetingKnowledge({ dates }: SeedCtx): KnowledgeItem[] {
  return [
    item({
      id: KNOWLEDGE.syncOct28,
      kind: 'note',
      title: 'Weekly product sync — notes',
      summary: 'Launch date holds and the tagline is picked; pricing waits for the Option A/B model and outside research; first Stripe cohort on track; triage v2 needs a billing rule; Meridian escalated SSO sign-outs.',
      tags: ['meeting-notes', 'product-sync', 'decisions', 'lumen'],
      collectionId: COLLECTION.meetings,
      projectIds: [PROJECT.atlas, PROJECT.lumen, PROJECT.ops],
      source: { type: 'integration', integrationId: 'meetings' },
      createdAt: dates.sync + 65 * 60_000,
      content: `
# Weekly product sync: ${weekdayLabel(dates.sync)}, ${dayLabel(dates.sync)}

Notes drafted by the meeting recorder, edited by Morgan.

**Attendees:** Morgan Lee, Priya Natarajan, Hana Kim, Aisha Bello, Theo Brandt, Marcus Chen, Owen Fitzgerald
**Absent:** Ravi Menon (customer visit)

## Agenda
1. Lumen launch status
2. Pricing decision path
3. Stripe cutover readiness
4. Triage rubric v2
5. Portal v2: performance and the SSO escalation

## Notes
### 1. Lumen launch status
- The launch date holds: ${dayLabel(dates.launch)}. The open beta is at 23 accounts.
- "From tracking to knowing." won the hero copy test. Muse's beat sheet for the hero video is done; storyboard frames are next.
- Meridian quote: Dana Whitfield is happy with it; Meridian's legal team needs to approve the wording.

### 2. Pricing
- The draft tiers stand, but Core plus overage undercuts Pro below roughly 10,000 active shipments a month.
- Owen prefers fewer moving parts: cap Core volume rather than raise the overage rate.
- Tidewell now prices its Insights tier per tracked shipment (competitor radar), so buyers will compare unit prices.
- Agreed: Ledger models Option A against Option B, and Morgan gets outside evidence on usage-based pricing before the lock.

### 3. Stripe cutover
- First cohort on ${dayLabel(dates.cutover)}; everyone else moves once two consecutive billing cycles reconcile.
- Invoice numbering is still undecided; Owen and Daniel to settle it this week.
- Create the \`stripe_invoice_id\` index before the backfill, and check contract currency for UK and EU accounts.

### 4. Triage rubric v2
- Comparison week: Sentinel agreed with Theo on 41 of 46 tickets. Most misses were billing tickets rated too low.
- Theo wants a billing rule before approving v2. The workflow already classifies with Sentinel's draft.

### 5. Portal v2
- The bundle split merged: dashboard initial JS is down from 912 kB to 348 kB. Shipments board p95 is still around 2.1 s; the carrier map is the next suspect.
- Meridian escalated this morning: dispatchers are signed out about an hour after SSO login. Morgan triages it today and hands it to Forge.
- Archivist is paused after the nightly Notion sync hit rate limits, so Notion pages are not syncing until it is back.

## Decisions
1. Launch date and tagline confirmed.
2. Pricing decision on ${dayLabel(dates.pricingLock)}, after the Option A/B model and the outside research.
3. Accept Stripe's per-second proration and document it in the release notes.

## Action items
- [ ] Morgan: assign the Option A/B revenue model to Ledger
- [ ] Morgan: commission outside research on usage-based pricing
- [ ] Morgan: triage the Meridian SSO escalation and hand it to Forge
- [ ] Owen and Daniel: decide the invoice numbering scheme
- [ ] Theo and Morgan: finalize triage rubric v2 with a billing rule
- [ ] Priya: profile the carrier map on the shipments board
`,
    }),

    item({
      id: KNOWLEDGE.meridianCall,
      kind: 'transcript',
      title: 'Customer call: Meridian Freight',
      summary: 'Beta review with Meridian Freight: scorecards cut their Monday carrier review to about 20 minutes; they want predictable annual pricing (no seats), a daily warehouse sync and SSO-scoped data.',
      tags: ['customer-call', 'meridian-freight', 'lumen', 'beta', 'pricing'],
      collectionId: COLLECTION.meetings,
      projectIds: [PROJECT.lumen],
      source: { type: 'integration', integrationId: 'meetings' },
      createdAt: dates.meridianCall + 50 * 60_000,
      content: `
# Customer call: Meridian Freight

**Recorded:** ${weekdayLabel(dates.meridianCall)}, ${dayLabel(dates.meridianCall)} · 42 minutes · imported by the meeting recorder (excerpt; the dashboard walkthrough is omitted)
**Northwind Labs:** Morgan Lee (Product), Ravi Menon (Sales)
**Meridian Freight:** Dana Whitfield (VP Operations), Kofi Mensah (Operations Analytics Lead)

---

**[00:00] Morgan Lee:** Thanks for making the time, both of you. We're about five weeks from launching Lumen publicly, and you've been in the beta the longest. I'd like to hear what's working, what isn't, and how you'd think about paying for it.

**[00:21] Dana Whitfield:** Happy to. Short version: the carrier scorecards changed how we run our Monday carrier review. That used to be a three-hour spreadsheet exercise, with Kofi pulling exports and me arguing with the numbers. Now it's a twenty-minute conversation, because everyone is looking at the same screen.

**[00:48] Kofi Mensah:** And I'm not rebuilding the same pivot table every week. That alone gave me back most of a Monday.

**[01:30] Morgan Lee:** What is the scorecard actually changing in those conversations?

**[01:38] Dana Whitfield:** Leverage. One carrier's on-time rate on two of our lanes had been sliding for six weeks. Before, that would have been an argument about whose spreadsheet was right. This time we just moved volume.

**[03:10] Morgan Lee:** What isn't working?

**[03:14] Kofi Mensah:** Alerts, at first. The first version alerted on everything that was late, including shipments we'd already flagged with the customer. We turned them off after a week. Since you switched to thresholds based on our own baseline, they're useful. Two or three alerts a day that actually matter.

**[04:02] Kofi Mensah:** The other gap is data ownership. We have our own warehouse. Right now I export through the API every night, which works, but I'd rather you pushed a daily sync.

**[04:30] Morgan Lee:** That's planned for the Enterprise tier as warehouse sync, daily. Would daily be enough?

**[04:41] Kofi Mensah:** Daily is fine. Hourly would be nice, but we wouldn't pay extra for it.

**[06:15] Ravi Menon:** Let's talk about pricing. We're looking at pricing Lumen on active shipments rather than seats. How does that land?

**[06:27] Dana Whitfield:** Honestly, the unit doesn't matter much. Predictability does. Our budget is set once a year. If you tell me it's this number unless our volume jumps by more than some agreed amount, I can work with that. What I can't do is go back to finance mid-year because peak season blew through an overage.

**[07:05] Morgan Lee:** So an annual commitment with a buffer, and a true-up once a year rather than monthly overage?

**[07:12] Dana Whitfield:** Exactly. A true-up at renewal is fine.

**[07:30] Ravi Menon:** And seats?

**[07:33] Dana Whitfield:** Please don't do seats. We want every coordinator, and half of our carriers' account managers, looking at this. Seats would make me ration it.

**[09:50] Morgan Lee:** Did you look at anything else before Lumen?

**[09:56] Dana Whitfield:** We trialed Tidewell's analytics module in the spring. It looked fine in the demo, but we couldn't get cost by lane and carrier without exporting, and they price per site, which doesn't work across our terminals. That's when we went back to spreadsheets.

**[12:40] Morgan Lee:** On access: you sign in to Atlas with SSO. Anything there?

**[12:46] Kofi Mensah:** It's been solid for us. What we'd want for Lumen is scoping by region. Our EU team shouldn't see North American cost data by default. If we can map that to SSO groups, perfect.

**[13:20] Morgan Lee:** That's planned as SSO-scoped data in Enterprise. I'll share the design with you.

**[38:05] Morgan Lee:** Last thing. Would you be comfortable with us quoting you at launch?

**[38:12] Dana Whitfield:** Yes, in principle. Something like: "Lumen turned our Monday carrier review from a three-hour spreadsheet exercise into a twenty-minute conversation." Our legal team has to approve the final wording.

**[38:40] Ravi Menon:** We'll send it over in writing this week.

---

## Action items (extracted by the recorder, reviewed by Morgan)
- [ ] Ravi: send the quote wording to Dana for legal approval
- [ ] Morgan: confirm a daily warehouse sync in the Enterprise tier
- [ ] Morgan: bring "annual commitment with a buffer, yearly true-up" into the pricing memo
- [ ] Morgan: share the SSO-scoped data design with Kofi
`,
    }),
  ]
}
