import type { KnowledgeItem } from '@/core/types'
import { COLLECTION, KNOWLEDGE, PROJECT } from '../../ids'
import { dayLabel, weekdayLabel, type SeedCtx } from '../helpers'
import { KNO, MSG } from '../keys'
import { item } from './build'

/** Sprint 14 retro board export, attached in the retro conversation and saved to knowledge. */
export const RETRO_CSV = `column,note,votes
went_well,Pairing on risky changes (SSO callback and billing adapter) caught bugs early,4
went_well,The PR review assistant's first pass catches the boring stuff,5
went_well,Lumen beta fixes shipped two days early,3
went_well,Dashboard bundle split nearly done: initial JS down 62% in review,3
went_well,New PR template makes reviews easier,2
didnt_go_well,A 1100-line PR sat for four days,6
didnt_go_well,Big PRs get rubber-stamped instead of reviewed,4
didnt_go_well,Reviews pile up on Thursdays before the demo,3
didnt_go_well,Checkout e2e test flaked 6 times this sprint,6
didnt_go_well,We re-run CI on red instead of filing the flake,5
didnt_go_well,Flaky tests block unrelated PRs,3
didnt_go_well,Billing scope changed twice mid-sprint,4
didnt_go_well,Invoice numbering question bounced between eng and finance,3
didnt_go_well,Too many meetings: no two-hour block for deep work,5
didnt_go_well,Staging data is too small to catch slow queries,3
ideas,Cap PRs at 600 changed lines,6
ideas,File a ticket for every flaky test the same day,6
ideas,One meeting-free morning a week,5
ideas,Freeze billing scope at sprint planning,3
ideas,Rotate a review captain each day,2
ideas,Anonymized production-sized staging snapshot,3
shoutouts,Daniel for untangling the legacy invoice API,3
shoutouts,Sofia for the token naming proposal,2
shoutouts,Theo for turning support escalations around fast,3`

export function engineeringKnowledge({ clock, dates, at }: SeedCtx): KnowledgeItem[] {
  const { wd, day } = clock
  return [
    item({
      id: KNOWLEDGE.adrSessions,
      kind: 'doc',
      title: 'ADR-012: Session tokens & refresh',
      summary: 'Accepted ADR: OIDC sign-in with PKCE, tokens held in memory, refresh 60 seconds before expiry, and every refresh scheduled from the expiry of the token currently held, never from a lifetime remembered at login.',
      tags: ['adr', 'auth', 'sessions', 'security', 'sso'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      pinned: true,
      createdAt: day(40, 15, 30),
      updatedAt: day(26, 10, 45),
      content: `
# ADR-012: Session tokens & refresh

- **Status:** Accepted
- **Deciders:** Priya Natarajan, Daniel Okafor, Morgan Lee
- **Supersedes:** ADR-004 (server-side sessions with 24-hour cookies)

## Context
Portal v2 signs everyone in through the Northwind identity provider (IdP). Enterprise customers connect their own SAML or OIDC provider to it, so their session policies apply to Atlas. The v1 model, an opaque session id in a 24-hour cookie that portal-api looked up on every request, had three problems:
1. **Revocation lag:** offboarding a user at the customer's identity provider did not end their Atlas session for up to a day.
2. **Load:** session lookups were about 18% of database reads on the shipments board.
3. **Inconsistency:** each sign-in path created sessions in its own way.

## Decision
1. **Sign-in:** OIDC authorization code with PKCE against the Northwind IdP. The browser never holds a secret.
2. **Storage:** tokens live in memory only, never in localStorage. A page reload runs a silent SSO round-trip.
3. **Lifetimes come from the IdP.** Each customer's session policy decides how long an access token lives, and the IdP applies that policy again on every refresh, so a refreshed token can live shorter than the one issued at sign-in.
4. **Refresh:** the client exchanges the refresh token 60 seconds before the access token expires (\`REFRESH_LEAD_MS\`). Always schedule the next refresh from the expiry of the token you currently hold, never from a lifetime remembered at login.
5. **Failure:** a 401 from portal-api ends the session and sends the user back through SSO. A rejected refresh token does the same.
6. **One session module:** every sign-in path goes through the same session module, which is the only code allowed to store tokens or schedule refreshes.

## Consequences
**Positive**
- Offboarding at the customer's identity provider takes effect at the next refresh.
- No session lookup on ordinary API requests.
- One code path to test and audit.

**Negative**
- The client-side refresh timer is now on the critical path. If it fires late, users are signed out mid-task.
- Customers with strict session policies refresh more often, which adds IdP traffic.

## Alternatives considered
| Option | Why not |
|---|---|
| Keep server-side sessions, shorten them to 1 hour | Still a database read per request, and revocation still lags |
| Long-lived access tokens (24 hours) | No practical revocation |
| Store tokens in localStorage | Exposed to any XSS bug |

## Follow-ups
- SCIM provisioning spike for enterprise tenants.
- Regression tests for refresh scheduling with shorter refreshed tokens.
- Any change to \`REFRESH_LEAD_MS\` or to how a 401 ends the session requires an amendment to this ADR.
`,
    }),

    item({
      id: KNOWLEDGE.stripePlan,
      kind: 'doc',
      title: 'Stripe Billing migration plan',
      summary: 'Plan to move invoicing from the legacy invoicing service to Stripe Billing behind VITE_FLAG_STRIPE_BILLING, cutting customers over once their totals reconcile for two consecutive billing cycles.',
      tags: ['billing', 'stripe', 'migration', 'plan'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      createdAt: day(30, 14, 0),
      updatedAt: wd(3, 15, 0),
      content: `
# Stripe Billing migration plan

**Owner:** Daniel Okafor (Engineering) · **Finance:** Owen Fitzgerald (RevOps) · **Product:** Morgan Lee
**First cutover cohort:** ${dayLabel(dates.cutover)} · **Current phase:** 1, adapter and backfill

## Why
The legacy invoicing service (\`/billing/v1\`) generates invoices from a nightly job, returns amounts as decimal strings and tracks payment status by polling the payment processor. It cannot do usage-based billing, which Lumen needs, and every pricing change becomes an engineering project.

## Goals
- All Atlas subscriptions and invoices on Stripe Billing, exposed by portal-api under \`/v2/billing\`, with Lumen usage reported as metered usage.
- No customer-visible change in billing dates, amounts, currency or invoice numbering unless we announce it first.
- Remove the legacy path within one billing cycle of the last customer moving.

## Phases
| Phase | What | Exit criteria |
|---|---|---|
| 0. Prep | Map plans to Stripe products and prices; map accounts to Stripe customers | Every active account mapped; price catalog reviewed by RevOps |
| 1. Adapter | \`src/billing/stripe.ts\` maps Stripe objects to the portal's Invoice type; \`src/api/invoices.ts\` picks the source with \`VITE_FLAG_STRIPE_BILLING\` (legacy stays the default) | Mapping and pagination tests pass; flag off in production |
| 2. Backfill | Import open invoices and the last 13 months of history | Totals match the legacy service to the cent for every account |
| 3. Reconcile | Compare both systems per customer, cycle by cycle | Two consecutive billing cycles reconcile for the account |
| 4. Cutover | Turn the flag on per customer; disable legacy dunning for them | First cohort on ${dayLabel(dates.cutover)}; the rest as they pass |
| 5. Decommission | Remove \`/billing/v1\`, its jobs and tables | One clean cycle with no legacy traffic |

Amounts are integer minor units everywhere. The adapter converts the legacy decimal strings once, and nothing else in the portal should ever parse them.

## Top risks
| Risk | What customers would see | Mitigation |
|---|---|---|
| Double billing during cutover | Two invoices for the same period | Per-customer flag, legacy dunning off at the same moment, duplicate check in reconciliation |
| Currency mismatches | Invoices in the wrong currency (EUR instead of GBP, for example) | Stripe prices created per contract currency; reconciliation compares currency, not just totals |
| Invoice numbering gaps | A new number format that accounts-payable systems reject | Decision pending with Owen and Daniel: continue the \`NW-\` sequence or start a fresh series |

Other risks: Stripe prorates by the second while the legacy service prorates by the day (accepted and documented), and EU VAT mapping for 31 accounts.

## Rollback
Turning the flag off moves a customer back to the legacy path, which stays warm until decommissioning. Stripe subscriptions are paused rather than cancelled, so a retry does not recreate customers.

## Database safety
The backfill and reconciliation read and write \`invoice_events\`, the table behind the checkout latency incident. Create the \`stripe_invoice_id\` index concurrently before the backfill, and run reconciliation against the read replica.

## Communication
A support macro and release note go out a week before each cohort. Account managers tell the 12 Enterprise accounts personally.
`,
    }),

    item({
      id: KNOWLEDGE.codeReview,
      kind: 'doc',
      title: 'Engineering handbook: code review',
      summary: 'How we review code: pull requests under ~600 changed lines (the review assistant asks for a split above that), comment prefixes, what reviewers look for, flaky-test tickets and how the Forge PR review assistant fits in.',
      tags: ['handbook', 'code-review', 'process', 'engineering'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'integration', integrationId: 'notion' },
      createdAt: day(59, 10, 0),
      updatedAt: wd(9, 14, 0),
      content: `
# Engineering handbook: code review

## Why we review
Reviews exist to share context and catch design problems early, not to police style. Linters and formatters own style.

## Before you open a pull request
- **Keep it under ~600 changed lines.** The PR review assistant asks for a split above that, and so will your reviewer (Sprint 14 retro).
- Split refactors from behaviour changes.
- Use a Conventional Commits title, for example \`fix(auth): schedule refresh from the held token's expiry\`.
- The description covers what changed, why, how to test it, screenshots for UI, and risk and rollback.
- Every bug fix ships with a regression test that fails without the fix.
- Changes to the public API link to an ADR. No exceptions.

## Review expectations
- First response within one business day; say so if you need longer.
- One approval for most pull requests; two for auth, billing and database migrations.
- Pair on risky changes instead of reviewing them cold. It worked well for the SSO callback and the billing adapter.

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

## Flaky tests
File a ticket for a flaky test the same day you see it, and link the failing run. Re-running CI to get past a flake without a ticket is how one flaky test becomes five.

## AI-assisted review
The PR review assistant workflow runs Forge on every pull request opened against \`main\`. Forge drafts a summary and inline comments, and nothing is posted until a person approves it. Treat its feedback like a careful junior reviewer's: often useful, sometimes wrong, never a substitute for a human approval.

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
      createdAt: day(57, 11, 0),
      updatedAt: day(8, 2, 14),
      content: `
# New engineer onboarding guide

Welcome to Northwind Labs. This guide gets you from a new laptop to your first merged pull request in week one.

## Day 1: access
- GitHub organization \`northwind\`, Slack, Notion, the staging admin console, and the on-call tool (read-only until week 4).
- Your onboarding buddy is named in your welcome email. Book 30 minutes with them every day this week.
- Read ADR-012 (sessions), \`docs/ARCHITECTURE.md\` in the repository and the code review handbook before your first pull request.

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
- **Auth:** OIDC sign-in, the in-memory session and its refresh timer (see ADR-012).
- **API client:** retries idempotent requests with backoff and honors \`Retry-After\`.
- **Shipments:** the shipments board and the tracking timeline.
- **Billing:** invoices and checkout, moving to Stripe Billing behind a feature flag.
- **Lumen:** the analytics add-on, also behind a feature flag.

## Week 1: first pull request
Pick an issue labelled \`good first issue\`, pair with your buddy, and follow the code review handbook. Small and merged beats ambitious and open.

## Rituals
- Stand-up at 09:45, 15 minutes.
- Sprint planning every other Monday; retro at the end of each sprint.
- Weekly product sync, optional for engineers but the notes are worth reading.
- One meeting-free morning a week (on trial since the Sprint 14 retro).

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
      summary: 'Per-plan limits for the Atlas REST API and the Lumen read API, response headers, 429 handling, incremental syncs, webhook retries and how limits change.',
      tags: ['api', 'rate-limits', 'reference', 'webhooks'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas],
      source: { type: 'manual' },
      createdAt: day(44, 13, 0),
      updatedAt: wd(4, 16, 0),
      content: `
# Public API rate limits

Applies to the Atlas REST API (\`/v1/*\` and \`/v2/*\`). Limits are per API key, per tenant, and both versions share the same bucket.

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
The API returns \`429 Too Many Requests\` with a body such as \`{"error":"rate_limited","retry_after":12}\`. Clients should wait at least \`Retry-After\` seconds and then back off exponentially with jitter. The portal's own API client already does this.

## Nightly syncs
Paging through every shipment each night burns the daily cap for large accounts. Sync incrementally with \`updated_since\`, and use \`/v2/shipments:batchGet\` (up to 100 ids, counted as one request) instead of single-shipment calls. Halden Logistics hit this paging about 40,000 shipments a night (SUP-417).

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
      summary: 'Blameless postmortem: an unindexed invoice query behind a new checkout banner pushed p95 latency to 9.4 s for 47 minutes; mitigated with a feature flag. Five follow-ups with owners.',
      tags: ['incident', 'postmortem', 'checkout', 'database'],
      collectionId: COLLECTION.engineering,
      projectIds: [PROJECT.atlas, PROJECT.ops],
      source: { type: 'manual' },
      createdAt: wd(8, 18, 30),
      updatedAt: at.chat.incident + 45 * 60_000,
      content: `
# Incident report: checkout latency spike

- **Date:** ${weekdayLabel(dates.incident)}, ${dayLabel(dates.incident)} · **Duration:** 47 minutes (14:02–14:49 UTC)
- **Severity:** S1 (checkout degraded for all tenants)
- **Incident lead:** Priya Natarajan · **Communications:** Theo Brandt · **Scribe:** Morgan Lee
- **Status:** resolved; postmortem reviewed; follow-ups tracked in Atlas Portal v2

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
- The query plan was never checked against production-sized data, a gap the Sprint 14 retro had already flagged.
- The database CPU alert did not page anyone.
- The release landed just before the daily traffic peak, when the European afternoon overlaps with the North American morning.

## What went well
- A feature flag allowed mitigation without a rollback.
- Support escalated within 5 minutes of the first customer report.
- Idempotency keys prevented duplicate payments when customers retried.

## What went poorly
- Detection came from a customer report, 8 minutes after the first alert and 17 minutes after latency started climbing.
- There was no checkout-specific latency alert.

## Follow-ups
| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Page on-call when checkout p95 is above 2 s for 5 minutes | Morgan Lee | Done |
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
      createdAt: at.chat.retro - 60_000,
      content: RETRO_CSV,
    }),
  ]
}
