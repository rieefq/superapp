import { KNOWLEDGE, PROJECT, REPO, THREAD } from '../../ids'
import { ai, kref, ref, textAttachment, user, type SeedCtx, type ThreadSpec } from '../helpers'
import { KNO } from '../keys'
import { RETRO_CSV } from '../knowledge/engineering'

export function atlasThreads({ clock }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  return [
    // ------------------------------------------------------------------ SSO bug
    {
      id: THREAD.ssoBug,
      title: 'Session expiry after SSO login',
      projectId: PROJECT.atlas,
      contextRefs: [kref(KNOWLEDGE.adrSessions), ref('repo', REPO.atlas)],
      turns: [
        user('msg_sso_01', back(2, 4, 10), `Halden Logistics escalated again (ticket #4821). Their dispatchers get bounced to the login screen about 15 minutes after signing in with SSO, even while they're actively using the shipments board. Password users at Halden are fine, and Meridian, who are also on SSO, haven't reported anything. Given how we designed sessions, what's the most likely cause?`),
        ai('msg_sso_02', back(2, 4, 9), 'sim-deep', `
## Most likely cause: the refresh never runs on Halden's sign-in path

The 15-minute mark is the tell. Under ADR-012 the access token lives for **15 minutes** and is renewed by a silent refresh at about 12 minutes. Being logged out at ~15 minutes *while active* means the token expires and **no refresh succeeds**. Password users at Halden and SSO users at Meridian are both fine, so the difference is probably in *how Halden signs in*, not in the refresh endpoint.

### Ranked hypotheses
| # | Hypothesis | Why it fits | How to check |
|---|---|---|---|
| 1 | Halden uses **IdP-initiated** SSO (launching Atlas from their identity provider's dashboard), and that callback stores tokens without scheduling the refresh | Meridian starts at our login page (SP-initiated) and is unaffected | Ask Halden's admin how dispatchers open Atlas; reproduce both flows on staging |
| 2 | The \`atlas_rt\` refresh cookie isn't set after the IdP's cross-site POST | Would also affect only one entry path | Inspect cookies right after sign-in: is \`atlas_rt\` present with \`Path=/auth/refresh\`? |
| 3 | Refresh-token reuse detection revokes the session when several tabs refresh at once | Dispatchers keep many tabs open | Search auth logs for \`refresh_reuse_detected\` on Halden's tenant |

Hypothesis 3 would also hit password users with many tabs, so I'd start with 1 and 2.

### A 10-minute reproduction
1. On Halden's staging tenant, sign in from the IdP dashboard and, separately, from our login page.
2. Open DevTools → Network and filter on \`refresh\`.
3. Keep using the shipments board between minutes 11 and 16.
4. If the IdP-initiated session never calls \`/auth/refresh\`, it's hypothesis 1.`, {
          searched: [KNOWLEDGE.adrSessions, KNOWLEDGE.churnInterviews, KNOWLEDGE.glossary],
          cites: [
            [KNOWLEDGE.adrSessions, 'a signed JWT with a 15-minute lifetime, held in memory by the web app and never written to localStorage.'],
            [KNOWLEDGE.adrSessions, 'the client refreshes at about 80% of the access-token lifetime (roughly 12 minutes) and on the first 401.'],
            [KNOWLEDGE.glossary, "Sign-in that starts at the Atlas login page (SP) or at the customer's identity provider dashboard (IdP)."],
          ],
          reasoning: 'A logout at almost exactly 15 minutes matches the access-token lifetime in ADR-012, so the silent refresh is either not running or failing. The problem is tenant-specific: password users at Halden and SSO users at Meridian are fine. The glossary distinguishes SP-initiated from IdP-initiated SSO, which land on different callback paths, and that would explain why one SSO customer is affected and another is not. Cookie scoping after the cross-site POST is a second candidate. Reuse detection would also affect password users with several tabs, so it ranks last.',
          feedback: 'up',
        }),
        user('msg_sso_03', back(2, 3, 20), `Daniel reproduced it on staging. Halden's dispatchers launch Atlas from their IdP dashboard. That lands on the SAML callback page, which calls \`session.set()\` and redirects, and no refresh is ever scheduled. SP-initiated logins go through \`login()\`, which schedules it. So it's #1. Do we patch the callback or restructure?`),
        ai('msg_sso_04', back(2, 3, 19), 'sim-deep', `
## Restructure, a little: make the session own its refresh

Patching the callback fixes Halden today but leaves the same trap for the next sign-in path; magic links and SCIM-provisioned invites are both on the roadmap. ADR-012 already says no login method may store tokens without scheduling the refresh. The code just doesn't enforce it.

### Recommended shape
~~~ts
// session.ts: the only way to establish a session
export function establishSession(tokens: TokenSet): void {
  store.set(tokens)
  scheduleRefresh(tokens.accessExpiresAt) // every login method, always
}
~~~

- \`login()\` and both SSO callbacks call \`establishSession()\`.
- \`session.set()\` becomes module-private, so nothing outside the session module can store tokens without a refresh.
- \`scheduleRefresh()\` fires at 80% of the access-token lifetime and is idempotent: calling it twice must not create two timers.

### Tests that would have caught this
1. **IdP-initiated callback schedules a refresh.** Render the callback route with a token fixture, advance fake timers 12 minutes, and assert exactly one \`/auth/refresh\` request.
2. **Every sign-in path is equivalent.** A table-driven test over password, SP-initiated and IdP-initiated sign-in asserting the same session state.
3. **Idempotent scheduling.** Calling \`establishSession()\` twice leaves one pending timer.

### Scope guard
No change to token lifetimes, cookie attributes or the public API. This stays inside ADR-012, so it doesn't need a new ADR.`, {
          searched: [KNOWLEDGE.adrSessions, KNOWLEDGE.codeReview],
          cites: [[KNOWLEDGE.adrSessions, 'No login method may store tokens without scheduling the refresh.']],
          feedback: 'up',
        }),
        user('msg_sso_05', back(2, 3, 5), `Agreed. Write it up as a task I can hand to Forge, with acceptance criteria. Halden renews in under four months, so make it high priority.`),
        ai('msg_sso_06', back(2, 3, 4), 'sim-swift', `
Here's the task, ready to hand off:

**Fix session expiry after SSO login** · Atlas Portal v2 · Priority: high · Milestone: v2 GA

**Problem.** Users who sign in through IdP-initiated SSO are logged out about 15 minutes later, even while active. The SAML callback stores tokens but never schedules the silent refresh, so the 15-minute access token expires (ADR-012). Reported by Halden Logistics, ticket #4821.

**Acceptance criteria**
- [ ] Password, SP-initiated and IdP-initiated sign-in all go through one \`establishSession()\` that always schedules the refresh
- [ ] Tokens can't be stored from outside the session module without scheduling a refresh
- [ ] Regression test: the IdP-initiated callback triggers exactly one \`/auth/refresh\` after ~12 minutes (fake timers)
- [ ] A table-driven test covers all three sign-in paths
- [ ] No change to token lifetimes, cookie attributes or the public API
- [ ] Verified on Halden's staging tenant

**Out of scope:** refresh-token reuse detection, SCIM.

I've created it in **Atlas Portal v2** and assigned it to **Forge**. It links back to this conversation.`),
        user('msg_sso_07', back(0, 1, 5), `Forge moved the task to review: its session has the change and the checks are green. What should I look at before I approve?`),
        ai('msg_sso_08', back(0, 1, 4), 'sim-swift', `
## Review checklist for the SSO fix

**Correctness**
- \`establishSession()\` is the only writer of tokens. Search the diff, and the codebase, for any remaining \`session.set(\` call outside the session module.
- The refresh fires at about 80% of the token lifetime and reschedules itself after every successful refresh, not just the first.
- A failed refresh (401) sends the user to sign in exactly once, with no redirect loop across tabs.

**Tests**
- The IdP-initiated regression test should fail on \`main\` and pass on the branch. Ask Forge to show both runs if the session only shows the branch.
- Fake timers are restored after each test, so the suite doesn't leak timers.

**Safety**
- No cookie attribute changes (\`HttpOnly\`, \`Secure\`, \`SameSite=Lax\`, \`Path=/auth/refresh\`). Any diff there needs an amendment to ADR-012.
- No token values written to logs.

**Rollout**
- It's a bug fix, so no feature flag. Ask Halden's admin to verify on staging before the release goes out, and close the loop on ticket #4821.

If all of that holds, approve the pull request and move the task to done after the staging check.`, {
          searched: [KNOWLEDGE.adrSessions, KNOWLEDGE.codeReview],
          cites: [
            [KNOWLEDGE.adrSessions, 'Any change to token lifetimes or cookie attributes requires an amendment to this ADR.'],
            [KNOWLEDGE.codeReview, 'Bug fixes start with a failing test.'],
          ],
        }),
      ],
    },

    // ------------------------------------------------------------------ Stripe risks
    {
      id: THREAD.stripeRisks,
      title: 'Stripe migration risks',
      projectId: PROJECT.atlas,
      contextRefs: [kref(KNOWLEDGE.stripePlan)],
      turns: [
        user('msg_stripe_01', back(9, 5), `We're moving invoicing from our in-house invoicer to Stripe Billing. Read the migration plan and tell me the risks that would actually hurt customers. Not a generic list.`),
        ai('msg_stripe_02', back(9, 4, 58), 'sim-deep', `
## Risks that would reach customers

Ranked by customer impact × likelihood, based on the Stripe Billing migration plan.

| Risk | What the customer would see | Likelihood | Covered by the plan? |
|---|---|---|---|
| **Double billing at cutover** | Two invoices for the same period | Medium | Partly: there's a freeze, but no automated duplicate check |
| **Proration drift** | Mid-cycle seat changes billed slightly differently | High | No: Stripe prorates by the second, the invoicer by day |
| **Invoice numbering change** | A new number format their accounts-payable system may reject | Medium | No |
| **EU VAT differences** | Different tax on the same line item | Medium | Partly: the mapping exists, but no reconciliation step |
| **Duplicate dunning emails** | Overdue reminders from both systems | Medium | Yes: invoicer dunning is disabled at cutover |
| **Webhook replays** | A payment shown twice, or late, in the portal | Low | Yes: handlers are idempotent |

### The two I'd settle before cutover
1. **Proration.** Decide whether to accept per-second proration (simpler; amounts differ by cents) or emulate daily proration. Either is fine. Surprising customers isn't, so whatever you pick goes in the release notes.
2. **Invoice numbering.** Enterprise accounts-payable systems often match on the invoice-number format. Continuing the existing \`NW-\` sequence is the safer default.

### What the plan already does well
- **A dual-run for one cycle** catches amount drift before customers do.
- **Billing dates don't move**, so nobody gets an invoice on an unexpected day.

### Gaps worth a line in the plan
- A named **rollback trigger**, for example more than 0.5% of invoices mismatched in the dual-run.
- A **comms owner** for cutover week. Support needs a macro ready before the first Stripe invoice lands.
- **EU VAT reconciliation** as an explicit dual-run check, not just a mapping.`, {
          searched: [KNOWLEDGE.stripePlan, KNOWLEDGE.csvAccounts],
          cites: [
            [KNOWLEDGE.stripePlan, 'Both systems compute the next cycle; only the invoicer sends'],
            [KNOWLEDGE.stripePlan, 'Customers keep their existing renewal dates; no billing anchors move.'],
          ],
          feedback: 'up',
        }),
        user('msg_stripe_03', back(9, 4, 30), `Proration: we'll accept per-second and document it. Numbering is the open one. Owen wants a fresh series for audit clarity, Daniel wants continuity. What's the actual trade-off?`),
        ai('msg_stripe_04', back(9, 4, 29), 'sim-swift', `
## Fresh series or continuous numbering?

| | Continue the \`NW-\` sequence | Fresh series (for example \`NWS-\`) |
|---|---|---|
| Customers' accounts-payable matching | No change for them | Some AP tools flag a format change |
| Audit trail | Needs a record of which system issued which range | Clean boundary between systems |
| Credit notes for old invoices | Same series as the original | Different series from the original invoice |
| Effort | Set Stripe's invoice prefix and next number | Default behaviour |

### A middle path
Continue the sequence **and** record the boundary. The last invoicer number and the first Stripe number go into the cutover memo, and each invoice keeps its source-system ID in metadata. Auditors get a clean boundary; customers see nothing change.

**Suggested decision owner:** Owen, with Daniel consulted. It's mainly a finance-process call, and it's close to a one-way door for customers' AP systems, so it's worth deciding before the freeze rather than during it.`),
        user('msg_stripe_05', back(9, 4, 10), `Agreed on Owen owning it. Make it a task for me to drive, due before the freeze, and add one for the cutover runbook.`),
        ai('msg_stripe_06', back(9, 4, 9), 'sim-swift', `
Created two tasks in **Atlas Portal v2** under the *Stripe Billing cutover* milestone:

1. **Decide invoice numbering scheme after cutover**: assigned to you, due before the freeze. It includes the trade-off table and the middle-path proposal for Owen and Daniel.
2. **Write migration runbook for Stripe cutover**: assigned to you. Proposed sections:
   - freeze window and comms owner
   - dual-run reconciliation checks, including EU VAT
   - rollback trigger: more than 0.5% of invoices mismatched
   - support macros for the first Stripe invoices

Both link back to this conversation.`),
        user('msg_stripe_07', back(5, 3), `After the checkout latency incident: does anything in the migration touch the same invoice tables?`),
        ai('msg_stripe_08', back(5, 2, 58), 'sim-deep', `
Yes, in two places.

1. **Backfill (phase 2)** writes open invoices and 13 months of history into \`invoice_events\`, the table behind the incident. The incident fix added an index on \`(account_id, status, created_at)\`, but the backfill looks rows up by \`stripe_invoice_id\`, which isn't indexed. Create that index **concurrently, before the backfill**.
2. **Dual-run reconciliation (phase 3)** compares open invoices per account every hour, which is essentially the query that hurt checkout. Point it at the **read replica**.

### Add to the runbook
- [ ] EXPLAIN every new query against production-sized data (incident action item 3)
- [ ] \`stripe_invoice_id\` index created concurrently before the backfill
- [ ] Reconciliation jobs pinned to the read replica
- [ ] Load test checkout during a backfill rehearsal (incident action item 5)

Worth raising at this week's product sync, since it touches the cutover plan.`, {
          searched: [KNOWLEDGE.incidentLatency, KNOWLEDGE.stripePlan, KNOWLEDGE.codeReview],
          cites: [
            [KNOWLEDGE.incidentLatency, 'In staging the table is small enough that the scan was fast, and nobody checked the plan against production-sized data.'],
            [KNOWLEDGE.stripePlan, 'Import open invoices and the last 13 months of history'],
          ],
        }),
      ],
    },

    // ------------------------------------------------------------------ Design tokens
    {
      id: THREAD.tokens,
      title: 'Naming our design tokens',
      projectId: PROJECT.atlas,
      contextRefs: [kref(KNOWLEDGE.designSystems)],
      turns: [
        user('msg_tokens_01', back(15, 6), `Sofia and Hana disagree on design token names. Sofia wants \`blue-500\`-style names everywhere; Hana wants semantic names like \`surface-raised\`. Dark mode for the portal is coming. Who's right?`),
        ai('msg_tokens_02', back(15, 5, 59), 'sim-swift', `
Both of them, at different layers. Use two tiers:

| Tier | Example | Who uses it | Changes with theme? |
|---|---|---|---|
| **Primitive** | \`blue-500\`, \`gray-900\` | Only the semantic layer | No: a primitive is a fixed value |
| **Semantic** | \`color.bg.surface-raised\`, \`color.text.muted\`, \`color.action.primary\` | Components | Yes: each theme maps roles to different primitives |

Sofia is right that you need a fixed palette with predictable steps. Hana is right that components should never reference it directly. If a button uses \`blue-500\`, dark mode means editing every component; if it uses \`color.action.primary\`, dark mode is a mapping change.

~~~css
:root {
  --blue-400: #5b8ef0;
  --blue-500: #2f6fed;                       /* primitive */
  --color-action-primary: var(--blue-500);   /* semantic */
}
[data-theme='dark'] {
  --color-action-primary: var(--blue-400);   /* same role, new mapping */
}
~~~

### Naming grammar
\`{category}.{role}.{variant}.{state}\`, for example \`color.border.focus\` or \`color.action.primary.hover\`. Roles describe intent (surface, text, border, action, status), never appearance.`, {
          searched: [KNOWLEDGE.designSystems],
          cites: [
            [KNOWLEDGE.designSystems, 'Components consume only semantic tokens.'],
            [KNOWLEDGE.designSystems, 'Dark mode re-points semantic tokens at different primitives; components do not change at all.'],
          ],
        }),
        user('msg_tokens_03', back(15, 5, 40), `What about component tokens like \`button-primary-bg\`? Do we need a third tier?`),
        ai('msg_tokens_04', back(15, 5, 39), 'sim-swift', `
Not yet. Component tokens earn their keep when a component has to differ across brands or themes in a way the semantic layer can't express. With one brand and two themes, Atlas doesn't have that problem. White-label portals for Enterprise customers would be the trigger, so revisit then.

### Migration plan
1. **Inventory.** Sofia's audit found about 140 hard-coded hex values. Map each one to a semantic role, or flag it as a one-off to delete.
2. **Alias.** Introduce semantic tokens that point at today's primitives, so nothing changes visually.
3. **Codemod.** Replace primitives in components with semantic tokens, one area at a time (shipments, billing, Lumen).
4. **Lint.** Add a rule that fails CI when a component references a primitive.
5. **Dark theme.** Only now add the dark mapping. Components don't change.

Steps 1–4 make no visual change, so screenshot tests should stay green the whole way. That's your safety net.`, {
          searched: [KNOWLEDGE.designSystems],
          cites: [[KNOWLEDGE.designSystems, "Sofia's audit found about 140 hard-coded hex values in the portal."]],
        }),
        user('msg_tokens_05', back(15, 5, 20), `Good. Turn the migration into a task for the Atlas board.`),
        ai('msg_tokens_06', back(15, 5, 19), 'sim-swift', `
Created **Rename color tokens to the semantic scheme** in **Atlas Portal v2**.

**Acceptance criteria**
- [ ] Semantic tokens defined for surface, text, border, action and status roles
- [ ] All ~140 hard-coded hex values mapped to a role or removed
- [ ] Components reference only semantic tokens; the lint rule fails CI otherwise
- [ ] No visual change in the light theme (screenshot tests green)
- [ ] Dark mapping drafted but not shipped

**Labels:** design-system, frontend, dark-mode. It links back to this conversation so Sofia and Hana can see the reasoning.`),
      ],
    },

    // ------------------------------------------------------------------ Sprint 14 retro
    {
      id: THREAD.retro,
      title: 'Sprint 14 retro synthesis',
      projectId: PROJECT.atlas,
      contextRefs: [kref(KNO.retroCsv)],
      turns: [
        user('msg_retro_01', back(6, 3), `Here's the export from our Sprint 14 retro board (24 stickies). Cluster it into themes and tell me what to actually change. Three actions at most.`, [
          textAttachment('att_retro_01', 'sprint-14-retro.csv', 'text/csv', RETRO_CSV, KNO.retroCsv),
        ]),
        ai('msg_retro_02', back(6, 2, 58), 'sim-deep', `
## Sprint 14 retro: themes

| Theme | Stickies | Votes | Signal |
|---|---:|---:|---|
| **Review latency** | 5 | 21 | PRs wait 2+ days; reviews pile up before the Thursday demo |
| **Flaky tests and trust in CI** | 4 | 20 | The checkout e2e test flaked 6 times; people re-run red builds by reflex |
| **Slow queries slip through** | 4 | 14 | Staging data is too small; the CPU alert didn't page |
| **Billing scope churn** | 3 | 10 | Scope changed twice mid-sprint; numbering bounced between teams |

**Went well:** pairing on the SSO callback, a calm incident response once it was declared, Lumen beta fixes two days early, the new PR template, and Forge's draft PRs for chores.

## Three changes worth making
1. **A one-business-day review target, as a two-sprint trial.** Add a daily 30-minute review slot (5 votes on its own) and compare the median time to first review before and after.
2. **A quarantine lane for flaky tests.** Known flaky tests move to a non-blocking job, each with an owner and an expiry date (6 votes). Start with the checkout e2e test.
3. **Production-sized data in staging.** An anonymized snapshot catches the slow-query class of bug before customers do.

Billing scope churn is real, but it's a planning problem rather than an engineering practice, so it probably sits with you rather than the team.`, {
          searched: [KNO.retroCsv, KNOWLEDGE.incidentLatency],
          cites: [
            [KNO.retroCsv, 'Checkout e2e test flaked 6 times this sprint'],
            [KNO.retroCsv, 'Quarantine known flaky tests with an owner and an expiry date'],
          ],
          feedback: 'up',
        }),
        user('msg_retro_03', back(6, 2, 40), `Reviews and flaky tests, yes. The staging snapshot is already covered by the incident action items, and scope churn is on me. Make the first two into tasks.`),
        ai('msg_retro_04', back(6, 2, 39), 'sim-swift', `
Created two tasks in **Atlas Portal v2**:

1. **Timebox PR reviews to one business day (trial)**
   - Daily 30-minute review slot for everyone
   - Track the median time to first review in Sprints 15 and 16
   - Keep or drop the rule at the Sprint 16 retro
2. **Quarantine lane for flaky tests in CI**
   - Non-blocking CI job for tests tagged \`@flaky\`
   - Each quarantined test needs an owner and a 7-day expiry
   - First candidate: the checkout e2e test, already tracked as *Fix flaky checkout e2e test*

I'd also add the review expectation to the code review handbook so new joiners see it.`),
        user('msg_retro_05', back(6, 2, 30), `Draft the short summary I'll post in #eng.`),
        ai('msg_retro_06', back(6, 2, 29), 'sim-swift', `
Here's a version you can paste:

> **Sprint 14 retro: what we're changing**
> Thanks, everyone. Two themes dominated the board: reviews are too slow (21 votes), and flaky tests have stopped us trusting CI (20 votes).
> **1. Reviews.** For the next two sprints we're trying a one-business-day first-response target, with a daily 30-minute review slot. We'll look at the numbers at the Sprint 16 retro and keep it or drop it.
> **2. Flaky tests.** Known flaky tests move to a non-blocking quarantine job with an owner and a 7-day expiry. The checkout e2e test goes first.
> Slow queries are covered by the incident action items, and I'm taking billing scope churn to planning myself. Shout-outs to Daniel, Sofia and Theo.`),
      ],
    },
  ]
}
