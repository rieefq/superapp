/**
 * Research report texts shared by investigations and the knowledge items they were saved to.
 * Bracketed numbers cite the investigation's sources in order (src_<key>_1 … src_<key>_n).
 */

export const TIDEWELL_REPORT = `
# Tidewell positioning & pricing

*Investigation report · standard depth · 10 sources: 2 from workspace knowledge, 8 simulated web sources*

## Executive summary
Tidewell sells annual, per-site contracts to enterprise shippers, with a one-time implementation fee [3][9]. Its clear strength is customs: filings, document checks and broker hand-offs run inside the portal, and that is what its case studies and reviewers praise [4][5][6]. It is weakest on invoicing and on self-serve onboarding: invoices leave as exports to the customer's ERP, and every new site goes live through an implementation project [7][8][9]. For Atlas, that means we can win mid-market forwarders on invoicing and time to go-live, while we stay exposed on analytics until Lumen ships [1][2][8].

## Who they sell to
- Enterprise shippers with many sites. Forwarders appear in the case studies mostly as partners of those shippers [4][5].
- The pitch is "one portal for customs, documents and tracking" [3].
- Our market sizing puts most of Tidewell's customers outside our mid-market segment; the overlap grows when a forwarder works for an enterprise shipper [2].

## Pricing and packaging
- Annual contracts priced per site, plus a one-time implementation fee. Plans are Starter, Pro and Enterprise [3].
- Two sources disagreed on the Enterprise floor price. The lower figure predates the per-site model, so the newer source wins; confidence is medium [3][10].
- At the time of this report there was no usage-based option [3].

## Product compared with Atlas
| Area | Tidewell | Atlas |
|---|---|---|
| Customs workflows | Strong: filings, document checks, broker hand-offs [4][6] | Document storage only |
| Invoicing | Weak: invoices exported to the customer's ERP [7] | Invoices and payments in the portal, moving to Stripe Billing |
| Onboarding | An implementation project per site [8][9] | Self-serve setup, about three weeks to first value today |
| Tracking | Comparable for ocean and road [6] | Comparable |
| Analytics | Insights module: standard KPIs; lane-level cost needs exports [8] | Lumen (launching): scorecards, lane cost trends, alerts |

## Customer sentiment
- Reviewers praise customs coverage and reliability; recurring complaints concern invoicing workarounds and long implementations [6][7][8].
- In our own notes, Tidewell is the incumbent we meet when a broker starts serving enterprise shippers [1].

## Where we are exposed
1. **Customs.** Enterprise shippers that want customs in the same tool will choose Tidewell.
2. **Analytics until Lumen ships.** Insights gives Tidewell a ready answer to "show me the numbers" [8].
3. **Onboarding.** We are faster than Tidewell's implementation projects, but three weeks is still slow for smaller customers.

## Recommendations
1. Lead mid-market deals with invoicing in the portal and time to go-live.
2. Do not compete on customs; integrate with customs brokers instead.
3. Position Lumen's lane-level cost analysis against Insights' standard KPIs.
4. Make the per-site cost visible for forwarders with many small sites.
5. Ask the competitor radar to watch Tidewell's pricing page.

## Confidence and gaps
- Web sources in this workspace are simulated; findings that rest only on them are rated medium or low confidence.
- We could not verify price points beyond the plan structure and the floor-price conflict.
- No customer interviews about Tidewell in this round.
`

export const TIDEWELL_SOURCES_APPENDIX = `
## Sources
1. Freightly product notes (workspace knowledge)
2. Market sizing: mid-market freight portals (workspace knowledge)
3. Pricing, Tidewell. tidewell.example (simulated source)
4. Case study: customs and tracking in one portal for a consumer-goods shipper. tidewell.example (simulated source)
5. Case study: how a forwarder network shares customs documents. tidewell.example (simulated source)
6. Tidewell reviews: customer portal software. stackrank-reviews.example (simulated source)
7. Tidewell reviews: billing and invoicing. freightsoftwarereviews.example (simulated source)
8. Tidewell in practice: a reviewer roundup. loadboardreview.example (simulated source)
9. Tidewell changelog, last six months. tidewell.example (simulated source)
10. Analyst note: customer portals in freight. logisticsanalyst.example (simulated source)
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
