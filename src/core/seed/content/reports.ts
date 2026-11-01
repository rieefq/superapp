/**
 * Research report texts shared by investigations and the knowledge items they were saved to.
 * Bracketed numbers cite the investigation's sources in order (src_<key>_1 … src_<key>_n).
 */

export const PORTBASE_REPORT = `
# Portbase positioning & pricing

*Investigation report · standard depth · 10 sources: 2 from workspace knowledge, 8 simulated web sources*

## Executive summary
Portbase sells itself as the all-in-one customer experience platform for logistics and wins on onboarding speed and polish rather than analytics depth [3][4][6]. It prices per user, includes its new Insights analytics only from the Business plan upward, and offers no usage-based option [3]. That leaves three openings for Atlas: lane-level cost analytics, predictable usage-based pricing for Lumen, and support responsiveness, which is the most consistent complaint about Portbase in public reviews and in our own interviews [2][6]. The main threat is that Portbase is moving into our core mid-market segment [5].

## Positioning
- The pricing page and launch posts lead with "launch your customer portal in days" and a gallery of templates [3][4].
- Analytics (Portbase Insights) is presented as a feature of the platform, not as a separate product line [4].
- In two of our Q3 losses, prospects named Portbase's ready-made portal as the deciding factor [1].

## Pricing and packaging
- Three plans (Starter, Business and Enterprise), priced per user per month on annual terms; Insights is included from Business upward [3].
- We found no metered or per-shipment option on the pricing page or in the documentation [3][10].
- Implication: customers who share dashboards with many occasional users pay more the more they share, which is the opposite of the behaviour we want to encourage with Lumen.

## Product: Insights compared with Lumen
| Area | Portbase Insights | Atlas Lumen |
|---|---|---|
| Standard shipment KPIs | Yes [4][8] | Yes |
| Carrier scorecards | Basic on-time ranking [8] | On-time, damage and invoice accuracy |
| Lane-level cost analysis | Limited; reviewers describe exporting to spreadsheets [6][8] | Cost per shipment and per kg by lane |
| Custom reports | Fixed templates [6][8] | Filters and saved views; no custom SQL in v1 |
| Alerts | Email digests [4] | Thresholds on the account's own baseline (Pro) |
| API access | Documented, with lower default limits than Atlas Growth [10] | Lumen read API |

## Customer sentiment
- Public reviews praise setup speed and design; recurring complaints concern rigid reporting and slow support responses [6].
- Two customers in our churn interviews had evaluated Portbase. One, Bluefen Maritime, switched for the look of the customer-facing portal and later told its former CSM about slow support responses [2].

## Market moves
- Portbase announced new funding aimed at mid-market forwarders [5]. Trend coverage describes customer portals as becoming table stakes for 3PLs [7].
- A survey-style piece suggests operations buyers increasingly ask for exception management rather than more dashboards [9]. Credibility is low; treat it as directional.

## Where we are exposed
1. **First impressions.** Our onboarding takes about three weeks today [2], and onboarding speed is Portbase's strongest claim.
2. **Demo polish.** Prospects led by customer experience or sales teams respond to Portbase's customer-facing design [1].
3. **Segment overlap.** Portbase's move upmarket puts it in more of our mid-market deals [5].

## Recommendations
1. Lead Lumen messaging with lane-level cost and carrier scorecards, where Insights is thinnest.
2. Keep Lumen usage-based: "share with everyone, pay for shipments" contrasts cleanly with per-user pricing.
3. Make support responsiveness a proof point by publishing first-response targets by plan.
4. Give sales a battlecard and a demo that opens on lane cost by carrier rather than on the tracking page.
5. Revisit next quarter: Portbase could add a usage-based option quickly.

## Confidence and gaps
- Web sources in this workspace are simulated; findings that rest only on them are rated medium or low confidence.
- We could not verify Portbase's actual price points beyond its plan structure.
- Internal evidence is a small sample: four Q3 losses and six churn interviews.
`

export const PORTBASE_SOURCES_APPENDIX = `
## Sources
1. Win/loss notes: Q3 competitive deals (workspace knowledge)
2. Churn interview synthesis (6 customers) (workspace knowledge)
3. Pricing, Portbase. portbase.example (simulated source)
4. Introducing Portbase Insights. portbase.example (simulated source)
5. Portbase raises new funding to court mid-market forwarders. freighttechweekly.example (simulated source)
6. Portbase reviews: customer portal software. stackrank-reviews.example (simulated source)
7. Customer portals are becoming table stakes for 3PLs. supplychainsignal.example (simulated source)
8. Hands-on with Portbase Insights. loadboardreview.example (simulated source)
9. What operations leaders want from visibility tools. opsleaderquarterly.example (simulated source)
10. Portbase API reference: limits and webhooks. portbase.example (simulated source)
`

export const CHURN_REPORT_DRAFT = `
# Why do logistics customers churn? (draft)

*Draft for review · 7 sources: 3 from workspace knowledge, 4 simulated web sources*

## Summary
Our churn clusters around three moments: a slow start, a reporting gap that sends teams back to spreadsheets, and slow help when an integration breaks [1][2]. Account data shows where the remaining risk sits: every red or yellow account in the top 15 renews within 120 days [3]. Outside sources point the same way, describing logistics buyers who value support responsiveness and still run analytics in spreadsheets [6][7], although those sources are simulated and qualitative. Pricing is a secondary factor for us, raised in two of six interviews [1].

## Findings
1. **Slow time to first value (4 of 6 interviews).** Customers described about three weeks before their first live shipment; TMS mapping was the long pole [1]. General B2B commentary also treats the first months as the riskiest period [4].
2. **Export-and-rebuild reporting (4 of 6).** Teams exported shipments every week to build carrier and lane reports by hand; two bought a separate BI tool [1]. Meridian Freight, a healthy account, described the same loop before Lumen [2], and trade coverage describes spreadsheets as the default analytics tool in freight [7].
3. **Slow help on integration problems (3 of 6).** EDI and TMS issues waited days for tier-2 help, and escalations preceded difficult renewal conversations [1][6].
4. **Per-seat pricing penalizes occasional users (2 of 6).** Warehouse leads and customers' own staff needed occasional access, so teams shared logins [1].
5. **Risk is concentrated before renewal.** In the top 15 accounts, all six red or yellow accounts renew within 120 days, including Coastal Cargo (47 days) and Halden Logistics (112 days) [3]. Health scores may be re-rated ahead of renewals, so this could partly reflect how CSMs score health.

## What this suggests
- **Onboarding:** aim for 10 days to first value with integration templates for the most common TMSs and a named onboarding engineer for Growth and Enterprise.
- **Lumen:** position it as the end of the Monday spreadsheet; it addresses finding 2 directly.
- **Support:** put an integration specialist on the tier-2 rotation and publish first-response targets.
- **At-risk accounts:** fix Halden's SSO logouts before its renewal conversation.

## Open questions for review
- Are four churned mid-market accounts representative? We had no Enterprise churn last year.
- Does time to first value actually correlate with churn in our account data? This needs a query against onboarding dates.
- One source we read argues that most published time-to-value benchmarks rest on small samples, so the 10-day target should come from our own onboarding data rather than from benchmarks.
`
