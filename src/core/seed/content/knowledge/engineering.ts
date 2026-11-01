import type { KnowledgeItem } from '@/core/types'
import { COLLECTION, KNOWLEDGE, PROJECT } from '../../ids'
import { dayLabel, weekdayLabel, type SeedCtx } from '../helpers'
import { KNO, MSG } from '../keys'
import { item } from './build'

/** Sprint 14 retro board export, attached in the retro conversation and saved to knowledge. */
export const RETRO_CSV = `column,note,votes
went_well,Pairing on the SSO callback flow was great,4
went_well,Incident response on checkout was calm and fast once declared,5
went_well,Lumen beta fixes shipped two days early,3
went_well,New PR template makes reviews easier,2
went_well,Forge's draft PRs saved real time on chores,3
didnt_go_well,PRs waited 2+ days for a first review,7
didnt_go_well,Reviews pile up on Thursdays before the demo,4
didnt_go_well,Review requests arrive randomly so I context-switch all day,3
didnt_go_well,Checkout e2e test flaked 6 times this sprint,6
didnt_go_well,We re-ran CI so often we stopped trusting red builds,5
didnt_go_well,Flaky tests block unrelated PRs,3
didnt_go_well,Billing scope changed twice mid-sprint,4
didnt_go_well,Invoice numbering question bounced between eng and finance,3
didnt_go_well,Staging data is too small to catch slow queries,4
didnt_go_well,DB CPU alert didn't page anyone during the incident,3
ideas,Daily 30-minute review slot,5
ideas,Quarantine known flaky tests with an owner and an expiry date,6
ideas,Freeze billing scope at sprint planning,3
ideas,Anonymized production-sized staging snapshot,4
ideas,Rotate a review captain each day,2
ideas,EXPLAIN check in CI for new queries,3
shoutouts,Daniel for the index fix the morning after the incident,4
shoutouts,Sofia for the token naming proposal,2
shoutouts,Theo for escalating fast during the incident,3`

export function engineeringKnowledge({ clock, dates }: SeedCtx): KnowledgeItem[] {
  const { back } = clock
  return [
    item({
      id: KNOWLEDGE.adrSessions,
      kind: 'doc',
      title: 'ADR-012: Session tokens & refresh',
      summary: 'Accepted ADR: 15-minute JWT access tokens, 12-hour sliding refresh tokens with rotation and reuse detection, and one session-issuance path for every login method.',
      tags: ['adr', 'auth', 'sessions', 'security', 'sso'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      pinned: true,
      createdAt: back(40, 3),
      updatedAt: back(26, 5),
      content: `
# ADR-012: Session tokens & refresh

- **Status:** Accepted
- **Deciders:** Priya Natarajan, Daniel Okafor, Morgan Lee
- **Supersedes:** ADR-004 (server-side sessions with 24-hour cookies)

## Context
Portal v2 adds enterprise SSO (SAML 2.0 and OIDC) alongside password login. The v1 model, an opaque session id in a 24-hour cookie looked up in Postgres on every request, had three problems:
1. **Revocation lag:** offboarding a user at the identity provider did not end their Atlas session for up to a day.
2. **Load:** session lookups were about 18% of database reads on the shipments board.
3. **Inconsistency:** each login method created sessions in its own way.

## Decision
1. **Access token:** a signed JWT with a 15-minute lifetime, held in memory by the web app and never written to localStorage.
2. **Refresh token:** opaque and stored server-side, sent as the \`atlas_rt\` cookie (\`HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh\`). It has a 12-hour sliding lifetime with an absolute maximum of 7 days.
3. **Rotation:** every refresh issues a new refresh token. Reusing an old one revokes the whole token family and logs \`refresh_reuse_detected\`.
4. **Silent refresh:** the client refreshes at about 80% of the access-token lifetime (roughly 12 minutes) and on the first 401.
5. **One issuance path:** every login method (password, SAML, OIDC, and future magic links) creates sessions through the same server endpoint and the same client entry point. No login method may store tokens without scheduling the refresh.
6. **IdP sessions are not used for liveness:** Atlas sessions are independent of the identity provider's session. SCIM deprovisioning (planned) revokes refresh tokens directly.

## Consequences
**Positive**
- Offboarding takes effect within 15 minutes, or immediately once SCIM lands.
- No session lookup on ordinary API requests.
- One code path to test and audit.

**Negative**
- The client-side refresh scheduler is now on the critical path: if it does not run, users are logged out after 15 minutes.
- Multiple tabs can race to refresh. We serialize refreshes with a BroadcastChannel lock so reuse detection does not log users out.

## Alternatives considered
| Option | Why not |
|---|---|
| Keep server-side sessions, shorten to 1 hour | Still a database read per request, and revocation still lags |
| Long-lived JWTs (24 hours) | No practical revocation |
| Store tokens in localStorage | Exposed to any XSS bug |

## Follow-ups
- SCIM provisioning spike for enterprise tenants.
- Alert on \`refresh_reuse_detected\` spikes per tenant.
- Any change to token lifetimes or cookie attributes requires an amendment to this ADR.
`,
    }),

    item({
      id: KNOWLEDGE.stripePlan,
      kind: 'doc',
      title: 'Stripe Billing migration plan',
      summary: 'Phased plan to move invoicing from the in-house invoicer to Stripe Billing: data mapping, dual-run reconciliation, cutover, rollback trigger and known risks.',
      tags: ['billing', 'stripe', 'migration', 'plan'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      createdAt: back(30, 4),
      updatedAt: back(3, 1),
      content: `
# Stripe Billing migration plan

**Owner:** Daniel Okafor (Engineering) · **Finance:** Owen Fitzgerald (RevOps) · **Product:** Morgan Lee
**Cutover:** ${dayLabel(dates.cutover)} · **Current phase:** 2, backfill

## Why
Our in-house invoicer generates invoices from a nightly cron job, emails PDFs and tracks payment status by polling the payment processor. It cannot do usage-based billing, which Lumen needs; proration is hand-rolled; and every pricing change becomes an engineering project.

## Goals
- All Atlas subscriptions and invoices on Stripe Billing, with Lumen usage reported as metered usage.
- No customer-visible change in billing dates, amounts or invoice numbering unless we communicate it first.
- Decommission the invoicer and its cron jobs within one billing cycle of the cutover.

## Phases
| Phase | What | Exit criteria |
|---|---|---|
| 0. Prep | Map plans to Stripe products and prices; map accounts to Stripe customers | 100% of active accounts mapped; price catalog reviewed by RevOps |
| 1. Shadow | Idempotent webhook handlers; invoice sync into \`invoice_events\` | Handlers replay-safe; no duplicate events in staging |
| 2. Backfill | Import open invoices and the last 13 months of history | Totals match the invoicer to the cent for every account |
| 3. Dual-run | Both systems compute the next cycle; only the invoicer sends | Fewer than 0.5% of invoices mismatched, every mismatch explained |
| 4. Cutover | Freeze, switch sending to Stripe, disable invoicer dunning | First Stripe invoices sent; support macros live |
| 5. Decommission | Remove the invoicer, its cron jobs and tables | One full clean cycle on Stripe |

## Data mapping
| Invoicer | Stripe Billing | Notes |
|---|---|---|
| account | Customer | \`metadata.atlas_account_id\` |
| plan and seats | Subscription item with a per-seat price | quantity = billable seats |
| Lumen usage | Metered price | reported daily as active shipments |
| invoice | Invoice | numbering scheme still open, see risks |
| credit | Credit note | |

Customers keep their existing renewal dates; no billing anchors move.

## Rollback
If dual-run mismatches exceed 0.5%, or the first Stripe invoice batch shows a systemic error, we switch sending back to the invoicer, which stays warm for one cycle. Stripe subscriptions are paused rather than cancelled, so a retry does not recreate customers.

## Known risks
- **Proration:** Stripe prorates by the second; the invoicer prorated by day. Decision: accept per-second proration and document it in the release notes.
- **Invoice numbering:** continue the \`NW-\` sequence or start a fresh series. Decision pending with Owen and Daniel.
- **Tax:** EU VAT mapping for 31 accounts, reconciled during the dual-run.
- **Shared tables:** the backfill and the reconciliation jobs hit \`invoice_events\`, the table behind the checkout latency incident. Create the \`stripe_invoice_id\` index concurrently before the backfill, and run reconciliation against the read replica.

## Communication
A support macro and release note go out one week before the cutover. Account managers notify the 12 Enterprise accounts personally.
`,
    }),

    item({
      id: KNOWLEDGE.codeReview,
      kind: 'doc',
      title: 'Engineering handbook: code review',
      summary: 'How we review code: PR size and description, a one-business-day first-response trial, comment prefixes, reviewer checklist, and how the Forge PR review assistant fits in.',
      tags: ['handbook', 'code-review', 'process', 'engineering'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      createdAt: back(59, 6),
      updatedAt: back(5, 2),
      content: `
# Engineering handbook: code review

## Why we review
Reviews exist to share context and catch design problems early, not to police style. Linters and formatters own style.

## Before you open a pull request
- Keep it under roughly 400 changed lines. Split refactors from behaviour changes.
- Use a Conventional Commits title, for example \`fix(auth): schedule refresh after SSO login\`.
- The description covers what changed, why, how to test it, screenshots for UI, and risk and rollback.
- Bug fixes start with a failing test.
- Changes to the public API link to an ADR. No exceptions.

## Review expectations
- **First response within one business day.** This is a trial from the Sprint 14 retro; we keep it or drop it at the Sprint 16 retro.
- Everyone holds a daily 30-minute review slot before lunch.
- One approval for most pull requests; two for auth, billing and database migrations.

## Comment prefixes
| Prefix | Meaning |
|---|---|
| **blocking:** | Must change before merge |
| **question:** | I don't understand this yet; please explain |
| **suggestion:** | Take it or leave it |
| **nit:** | Trivial, never blocks |
| **praise:** | Good work worth calling out |

## What reviewers look for
1. Correctness and edge cases.
2. Tests that would fail without the change.
3. Security: authorization checks, secrets, personal data in logs.
4. Performance: N+1 queries and unindexed lookups. For new queries on tables over 1M rows, ask for EXPLAIN output against production-sized data (added after the checkout latency incident).
5. Operability: logs, metrics, feature flags and a rollback path.

## AI-assisted review
The PR review assistant workflow runs Forge on every pull request opened against \`main\`. Forge drafts a summary and inline suggestions, and nothing is posted until a human approves the comment. Treat its feedback like a careful junior reviewer's: often useful, sometimes wrong, never a substitute for a human approval.

## Merging
Squash merge; the pull request title becomes the commit message. Delete the branch afterwards.
`,
    }),

    item({
      id: KNOWLEDGE.onboarding,
      kind: 'doc',
      title: 'New engineer onboarding guide',
      summary: 'First-week plan for new engineers: access, local setup of atlas-portal, how the codebase is organized, rituals, on-call and who to ask.',
      tags: ['onboarding', 'engineering', 'setup', 'handbook'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      createdAt: back(57, 5),
      updatedAt: back(21, 3),
      content: `
# New engineer onboarding guide

Welcome to Northwind Labs. This guide gets you from a new laptop to your first merged pull request in week one.

## Day 1: access
- GitHub organization \`northwind\`, Slack, Notion, the staging admin console, and the on-call tool (read-only until week 4).
- Your onboarding buddy is named in your welcome email. Book 30 minutes with them every day this week.
- Read ADR-012 (sessions) and the code review handbook before your first pull request.

## Days 1–2: local setup
~~~bash
git clone git@github.com:northwind/atlas-portal.git
cd atlas-portal
npm install
cp .env.example .env.local   # points at the staging API by default
npm run dev                  # http://localhost:5173
npm test                     # vitest
~~~
If \`npm run dev\` cannot reach staging, ask in #eng-help; staging access is granted per person.

## How the portal is organized
- **Auth:** sessions, SSO callbacks and the refresh scheduler (see ADR-012).
- **Shipments:** the shipments board and the tracking timeline.
- **Billing:** invoices and checkout, moving to Stripe Billing.
- **Lumen:** the analytics add-on, behind a feature flag.
- **UI:** design system components and tokens.

## Week 1: first pull request
Pick an issue labelled \`good first issue\`, pair with your buddy, and follow the code review handbook. Small and merged beats ambitious and open.

## Rituals
- Stand-up at 09:45, 15 minutes.
- Sprint planning every other Monday; retro every other Friday.
- Weekly product sync, optional for engineers but the notes are worth reading.

## On-call
Shadow from week 4, primary from week 8. Incident reports live in the Engineering collection; read the most recent one before your first shadow shift.

## Who to ask
| Topic | Person |
|---|---|
| Auth and billing | Daniel Okafor |
| Frontend and design system | Sofia Marquez |
| Data and Lumen pipelines | Marcus Chen |
| Product questions | Morgan Lee |
| Priorities and everything else | Priya Natarajan |
`,
    }),

    item({
      id: KNOWLEDGE.rateLimits,
      kind: 'doc',
      title: 'Public API rate limits',
      summary: 'Per-plan limits for the Atlas REST API v2 and the Lumen read API, response headers, 429 handling, webhook retries and how limits change.',
      tags: ['api', 'rate-limits', 'reference', 'webhooks'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'manual' },
      createdAt: back(44, 2),
      updatedAt: back(13, 6),
      content: `
# Public API rate limits

Applies to the Atlas REST API v2 (\`/v2/*\`). Limits are per API key, per tenant.

| Plan | Sustained | Burst (10 seconds) | Daily cap |
|---|---|---|---|
| Starter | 60 requests/min | 20 | 50,000 |
| Growth | 300 requests/min | 100 | 250,000 |
| Enterprise | 1,200 requests/min | 400 | none (fair use) |
| Lumen read API (separate bucket) | 120 requests/min | 40 | 100,000 |

## Response headers
| Header | Meaning |
|---|---|
| \`X-RateLimit-Limit\` | Requests allowed in the current window |
| \`X-RateLimit-Remaining\` | Requests left in the current window |
| \`X-RateLimit-Reset\` | Unix time (seconds) when the window resets |
| \`Retry-After\` | Seconds to wait; sent only with a 429 |

## When a client hits the limit
The API returns \`429 Too Many Requests\` with a body such as \`{"error":"rate_limited","retry_after":12}\`. Clients should wait at least \`Retry-After\` seconds and then back off exponentially with jitter.

## Bulk reads
Use \`/v2/shipments:batchGet\` with up to 100 ids instead of looping over single-shipment requests. It counts as one request.

## Webhooks
Outbound webhooks retry with exponential backoff for up to 24 hours (8 attempts). Handlers must be idempotent: use the \`event_id\` field to ignore duplicates.

## Changing limits
- Enterprise customers can request higher limits through their account manager. Engineering (Priya Natarajan) approves, and the change is recorded per tenant.
- Changing the default limits of a plan is a public API change and needs an ADR.
`,
    }),

    item({
      id: KNOWLEDGE.incidentLatency,
      kind: 'report',
      title: `Incident report: checkout latency (${dayLabel(dates.incident)})`,
      summary: 'Blameless postmortem: an unindexed invoice query behind a new checkout banner pushed p95 latency to 9.4 s for 47 minutes; mitigated by a feature flag. Five action items with owners.',
      tags: ['incident', 'postmortem', 'checkout', 'database'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas, PROJECT.ops],
      source: { type: 'chat', ref: { kind: 'message', id: MSG.incidentSaved } },
      createdAt: back(9, 7, 57),
      updatedAt: back(8, 2),
      content: `
# Incident report: checkout latency spike

- **Date:** ${weekdayLabel(dates.incident)}, ${dayLabel(dates.incident)} · **Duration:** 47 minutes (14:02–14:49 UTC)
- **Severity:** S1 (checkout degraded for all tenants)
- **Incident lead:** Priya Natarajan · **Communications:** Theo Brandt · **Scribe:** Morgan Lee
- **Status:** resolved; action items tracked in Atlas Portal v2

## Summary
A release added an outstanding-balance banner to checkout. Its query against \`invoice_events\` had no supporting index, so under afternoon load the database fell back to sequential scans of a very large table. Database CPU saturated, the connection pool ran out, and checkout p95 latency rose from about 640 ms to 9.4 s. Turning off the \`checkout.balanceBanner\` flag restored service.

## Impact
- Checkout p95 latency peaked at 9.4 s (normally about 640 ms).
- About 3.1% of checkout attempts timed out during the window; retries afterwards succeeded.
- No data loss and no duplicate payments: idempotency keys held.
- 14 support tickets, including Coastal Cargo and two Enterprise accounts.

## Timeline (UTC)
| Time | Event |
|---|---|
| 13:20 | web 4.18.0 deployed, including PR #1482 (balance banner) |
| 14:02 | Checkout latency starts climbing with afternoon traffic |
| 14:11 | Database CPU alert fires above 90%, posted to a channel but not paged |
| 14:19 | Coastal Cargo reports a spinning checkout to support |
| 14:24 | Theo escalates to engineering; incident declared, Priya leads |
| 14:33 | Slow-query log points at \`getOpenInvoices()\` |
| 14:41 | \`checkout.balanceBanner\` flag turned off |
| 14:49 | p95 back under 1 s; incident resolved |
| Next day, 09:30 | Composite index created concurrently; flag re-enabled at 11:00 |

## Root cause
\`getOpenInvoices()\` filtered \`invoice_events\` by \`account_id\` and \`status\` and sorted by \`created_at\`. No index covered those columns, so every call scanned the table. In staging the table is small enough that the scan was fast, and nobody checked the plan against production-sized data. The fix was a composite index on \`(account_id, status, created_at)\`.

## Contributing factors
- The query plan was never checked against production-sized data.
- The database CPU alert did not page anyone.
- The release landed just before the daily traffic peak, when European afternoon overlaps with the North American morning.

## What went well
- A feature flag allowed mitigation without a rollback.
- Support escalated within 5 minutes of the first customer report.
- Idempotency keys prevented duplicate payments when customers retried.

## What went poorly
- Detection came from a customer report, 8 minutes after the first alert and 17 minutes after latency started climbing.
- There was no checkout-specific latency alert.

## Action items
| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Page on checkout p95 above 2 s for 5 minutes | Morgan Lee | Done |
| 2 | Query-plan regression check in CI for queries on tables over 1M rows | Priya Natarajan | Open |
| 3 | Migration review checklist: EXPLAIN against production-sized data | Daniel Okafor | Done (in the code review handbook) |
| 4 | Route the database CPU alert to on-call | Priya Natarajan | Done |
| 5 | Load test checkout with production-like volumes before the Stripe backfill | Daniel Okafor | Open |
`,
    }),

    item({
      id: KNO.retroCsv,
      kind: 'file',
      title: 'sprint-14-retro.csv',
      summary: 'Export of the Sprint 14 retro board: 24 stickies with votes across went well, didn’t go well, ideas and shout-outs.',
      tags: ['retro', 'sprint-14', 'process', 'engineering'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'upload', ref: { kind: 'message', id: MSG.retroUpload } },
      file: { name: 'sprint-14-retro.csv', mime: 'text/csv', size: RETRO_CSV.length },
      createdAt: back(6, 3),
      content: RETRO_CSV,
    }),
  ]
}
