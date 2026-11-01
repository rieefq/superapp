import { KNOWLEDGE, PROJECT, REPO, THREAD } from '../../ids'
import { ai, kref, MINUTE, ref, textAttachment, user, type SeedCtx, type ThreadSpec } from '../helpers'
import { KNO } from '../keys'
import { RETRO_CSV } from '../knowledge/engineering'

const SEC = 1_000

export function atlasThreads({ clock, at }: SeedCtx): ThreadSpec[] {
  const { back } = clock
  const sso = at.chat.ssoBug
  const stripe = at.chat.stripeRisks
  const tokens = at.chat.tokens
  const retro = at.chat.retro
  return [
    // ------------------------------------------------------------------ SSO bug
    {
      id: THREAD.ssoBug,
      title: 'Session expiry after SSO login',
      projectId: PROJECT.atlas,
      contextRefs: [kref(KNOWLEDGE.adrSessions), ref('repo', REPO.atlas)],
      turns: [
        user('msg_sso_01', sso - MINUTE, `Meridian Freight escalated this morning: several dispatchers get sent back to the SSO login about an hour after signing in, sometimes mid-booking. Their IdP sessions last 12 hours, and it started last week. Halden has complained about random sign-outs for weeks too. Password users seem fine. Given ADR-012, what's the most likely cause?`),
        ai('msg_sso_02', sso + 40 * SEC, 'sim-deep', `
## Most likely cause: the next refresh is scheduled from the wrong lifetime

ADR-012 says the IdP applies each customer's session policy again on every refresh, so a refreshed token can live shorter than the one issued at sign-in, and that the client must schedule each refresh from the expiry of the token it currently holds. If the code remembers the lifetime from sign-in instead, the timing works out exactly like Meridian's report:

| Time after sign-in | What happens |
|---|---|
| 0 min | Sign-in token issued with a 60-minute lifetime |
| 59 min | First refresh, 60 s early. The IdP applies the stricter policy and returns a 15-minute token |
| ~74 min | That token expires, but the next refresh is still scheduled 59 minutes out |
| ~75 min | The next API call gets a 401, the session ends and the user is back at SSO |

"About an hour after signing in" and "started last week" both fit a customer that recently tightened its session policy. Halden would see the same thing if its policy has always issued short tokens on refresh.

### Other candidates
| # | Hypothesis | How to check |
|---|---|---|
| 2 | The IdP rejects the refresh token (a sign-in frequency policy) | IdP logs show failed refreshes for Meridian users |
| 3 | Clock skew makes tokens look expired early | Compare the token's expiry with server time in a failing session |

### What I'd do
Ask Meridian's IT whether they changed token lifetimes last week, then hand it to Forge with a reproduction: fake timers, a 1-hour sign-in token and 15-minute refreshed tokens. If the session dies at about 75 minutes, it's the first hypothesis.`, {
          searched: [KNOWLEDGE.adrSessions, KNOWLEDGE.glossary, KNOWLEDGE.churnInterviews],
          cites: [
            [KNOWLEDGE.adrSessions, 'the IdP applies that policy again on every refresh, so a refreshed token can live shorter than the one issued at sign-in'],
            [KNOWLEDGE.adrSessions, 'Always schedule the next refresh from the expiry of the token you currently hold, never from a lifetime remembered at login.'],
            [KNOWLEDGE.glossary, 'Stricter policies issue shorter tokens on refresh.'],
          ],
          reasoning: 'The sign-out happens about an hour after sign-in rather than at random, so it is tied to token lifetimes. ADR-012 says refreshed tokens can be shorter than the sign-in token and that refreshes must be scheduled from the held token’s expiry. If the client reuses the sign-in lifetime, the first refresh works and the second comes too late: with a 60-minute sign-in token and 15-minute refreshed tokens, the session dies at about 75 minutes. “Started last week” suggests Meridian changed its policy. Revoked refresh tokens and clock skew are possible but fit the timing less well.',
          feedback: 'up',
        }),
        user('msg_sso_03', sso + 14 * MINUTE, `Meridian's IT confirmed it: last week they set refreshed tokens to 15 minutes, and Halden has always used 15. I don't want Daniel pulled off the Stripe work. Can Forge take this?`),
        ai('msg_sso_04', sso + 15 * MINUTE, 'sim-deep', `
Yes. It's a contained change with a clear reproduction, which is what Forge handles well. Give it a tight brief:

### Brief for Forge
- **Goal:** schedule every refresh from the expiry of the token currently held (\`expiresAt − REFRESH_LEAD_MS\`), and remove any lifetime remembered at sign-in.
- **Reproduce first:** fake timers, a 1-hour sign-in token and 15-minute refreshed tokens. The session must survive several hours.
- **Regression tests,** both failing on \`main\`:
  1. after a refresh, the next refresh follows the refreshed token's lifetime;
  2. six hours of 15-minute tokens never let the session outlive its token.
- **Scope guard:** the smallest possible change. No change to \`REFRESH_LEAD_MS\`, to how a 401 ends the session, or to the public API. ADR-012 already requires this behaviour, so no new ADR.
- **Approvals:** opening the pull request asks you first, and auth changes need two human reviewers.

~~~ts
// The shape of the fix
function scheduleRefresh(session: Session, now = Date.now()): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  const delay = Math.max(0, session.expiresAt - REFRESH_LEAD_MS - now)
  refreshTimer = setTimeout(() => void refreshNow(), delay)
}
~~~`, {
          searched: [KNOWLEDGE.adrSessions, KNOWLEDGE.codeReview],
          cites: [[KNOWLEDGE.codeReview, 'Every bug fix ships with a regression test that fails without the fix.']],
        }),
        user('msg_sso_05', sso + 21 * MINUTE, `Write it up as a task for Forge, with acceptance criteria. Meridian is our largest account and Halden renews in under four months, so it's high priority.`),
        ai('msg_sso_06', sso + 22 * MINUTE, 'sim-swift', `
**Fix session expiry after SSO login** · Atlas Portal v2 · Priority: high · Milestone: Portal v2 GA

**Problem.** Users whose identity provider issues shorter tokens on refresh are signed out about an hour after SSO sign-in. The refresh timer reuses the lifetime of the sign-in token, so after the first refresh the next one is scheduled too late (ADR-012). Reported by Meridian Freight this week; Halden Logistics has seen it for weeks.

**Acceptance criteria**
- [ ] Every refresh is scheduled from the expiry of the token currently held; no lifetime is remembered from sign-in
- [ ] Regression test: after a refresh, the next one follows the refreshed token's lifetime
- [ ] Regression test: six hours of 15-minute tokens never let the session outlive its token
- [ ] Both tests fail on \`main\` and pass with the fix
- [ ] No change to \`REFRESH_LEAD_MS\`, to 401 handling or to the public API
- [ ] Verified on staging with Meridian's and Halden's session policies

Created in **Atlas Portal v2** and assigned to **Forge**. Start a coding session from the task when you're ready.`),
        user('msg_sso_07', back(0, 1, 5), `Forge's session is ready for review. It found the timer reusing the login token's lifetime, exactly your first hypothesis, and added two regression tests. All checks are green. What should I look at before I approve?`),
        ai('msg_sso_08', back(0, 1, 4), 'sim-swift', `
## Review checklist for the SSO fix

**Correctness**
- The remembered lifetime (\`tokenLifetimeMs\`) is gone. The delay comes from \`expiresAt − REFRESH_LEAD_MS − now\` and is clamped at zero.
- The old timer is cleared before a new one is set, and \`endSession()\` clears it too.
- A rejected refresh still ends the session once, with no redirect loop.

**Tests**
- Both regression tests fail on \`main\` and pass on the branch. The session's test step shows the run against \`main\`: 2 failed, 3 passed.
- Fake timers are restored after each test.

**Safety**
- No change to \`REFRESH_LEAD_MS\` or to how a 401 ends the session; either would need an amendment to ADR-012.
- No token values written to logs.

**Rollout**
- Ask Meridian's and Halden's admins to try it on staging with their own session policies, then reply on Meridian's ticket.

If all of that holds, approve the pull request. The task can move to done after the staging check.`, {
          searched: [KNOWLEDGE.adrSessions, KNOWLEDGE.codeReview],
          cites: [
            [KNOWLEDGE.adrSessions, 'or to how a 401 ends the session requires an amendment to this ADR.'],
            [KNOWLEDGE.codeReview, 'auth, billing and database migrations'],
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
        user('msg_stripe_01', stripe - MINUTE, `We're moving invoicing from the legacy invoicing service to Stripe Billing. Read the migration plan and rank the risks that would actually hurt customers. Not a generic list.`),
        ai('msg_stripe_02', stripe + 40 * SEC, 'sim-deep', `
## The three risks that would reach customers

| # | Risk | What the customer would see | Mitigation |
|---|---|---|---|
| 1 | **Double billing during cutover** | Two invoices for the same period, one from each system | Cut over per customer with \`VITE_FLAG_STRIPE_BILLING\`; turn legacy dunning off at the same moment; add a duplicate check to reconciliation |
| 2 | **Currency mismatches** | An invoice in EUR for a contract in GBP, because a Stripe price was created in the wrong currency | Create Stripe prices per contract currency; make reconciliation compare currency, not just totals |
| 3 | **Invoice numbering gaps** | A new number format their accounts-payable system rejects or flags | Decide before the first cohort: continue the \`NW-\` sequence or start a fresh series |

### Also worth a line
- **Proration:** Stripe prorates by the second and the legacy service by the day. The differences are small, but put them in the release notes.
- **Amounts:** the legacy API returns decimal strings. Convert them to integer minor units once, in the adapter, and nowhere else.

### What the plan already does well
- Customers move one at a time, and only after two consecutive billing cycles reconcile.
- The legacy path stays warm, so rolling a customer back is a flag flip.`, {
          searched: [KNOWLEDGE.stripePlan, KNOWLEDGE.csvAccounts],
          cites: [
            [KNOWLEDGE.stripePlan, 'Two consecutive billing cycles reconcile for the account'],
            [KNOWLEDGE.stripePlan, 'Turning the flag off moves a customer back to the legacy path, which stays warm until decommissioning.'],
          ],
          feedback: 'up',
        }),
        user('msg_stripe_03', stripe + 15 * MINUTE, `Proration: we'll accept per-second and document it. Numbering is the open one. Owen wants a fresh series for audit clarity, Daniel wants continuity. What's the actual trade-off?`),
        ai('msg_stripe_04', stripe + 16 * MINUTE, 'sim-swift', `
## Fresh series or continuous numbering?

| | Continue the \`NW-\` sequence | Fresh series (for example \`NWS-\`) |
|---|---|---|
| Customers' accounts-payable matching | No change for them | Some AP tools flag a format change |
| Audit trail | Needs a record of which system issued which range | Clean boundary between systems |
| Credit notes for old invoices | Same series as the original | Different series from the original invoice |
| Effort | Set Stripe's invoice prefix and next number | Default behaviour |

### A middle path
Continue the sequence **and** record the boundary. The last legacy number and the first Stripe number for each cohort go into the cutover memo, and each invoice keeps its source-system ID in metadata. Auditors get a clean boundary; customers see nothing change.

**Suggested decision owner:** Owen, with Daniel consulted. It's mainly a finance-process call, and it's close to a one-way door for customers' AP systems, so decide it before the first cohort rather than during it.`),
        user('msg_stripe_05', stripe + 24 * MINUTE, `Agreed on Owen owning it. Make it a task for me to drive, due before the first cohort, and add one for the cutover runbook.`),
        ai('msg_stripe_06', stripe + 25 * MINUTE, 'sim-swift', `
Created two tasks in **Atlas Portal v2** under the *Stripe Billing cutover* milestone:

1. **Decide invoice numbering scheme after cutover**: assigned to you, due before the first cohort. It includes the trade-off table and the middle-path proposal for Owen and Daniel.
2. **Write migration runbook for Stripe cutover**: assigned to you. Proposed sections:
   - the per-customer flag flip, with a freeze window and comms owner for each cohort
   - reconciliation checks: totals, currency and duplicates
   - rollback: the flag off for that customer, with legacy dunning back on
   - support macros for the first Stripe invoices

Both link back to this conversation.`),
        user('msg_stripe_07', stripe + 40 * MINUTE, `After the checkout latency incident: does anything in the migration touch the same invoice tables?`),
        ai('msg_stripe_08', stripe + 41 * MINUTE, 'sim-deep', `
Yes, in two places.

1. **Backfill (phase 2)** writes open invoices and 13 months of history into \`invoice_events\`, the table behind the incident. The incident fix added an index on \`(account_id, status, created_at)\`, but the backfill looks rows up by \`stripe_invoice_id\`, which isn't indexed. Create that index **concurrently, before the backfill**.
2. **Reconciliation (phase 3)** compares invoices per customer every cycle, which is close to the query that hurt checkout. Point it at the **read replica**.

### Add to the runbook
- [ ] EXPLAIN every new query against production-sized data (incident follow-up 3)
- [ ] \`stripe_invoice_id\` index created concurrently before the backfill
- [ ] Reconciliation jobs pinned to the read replica
- [ ] Load test checkout during a backfill rehearsal (incident follow-up 5)

Worth raising at the weekly product sync, since it touches the cutover plan.`, {
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
        user('msg_tokens_01', tokens - MINUTE, `Sofia and Hana disagree on design token names. Sofia wants \`blue-500\`-style names everywhere; Hana wants semantic names like \`surface-raised\`. Dark mode for the portal is coming. Who's right?`),
        ai('msg_tokens_02', tokens + 40 * SEC, 'sim-swift', `
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
        user('msg_tokens_03', tokens + 15 * MINUTE, `What about component tokens like \`button-primary-bg\`? Do we need a third tier?`),
        ai('msg_tokens_04', tokens + 16 * MINUTE, 'sim-swift', `
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
        user('msg_tokens_05', tokens + 30 * MINUTE, `Good. Turn the migration into a task for the Atlas board.`),
        ai('msg_tokens_06', tokens + 31 * MINUTE, 'sim-swift', `
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
      contextRefs: [kref(KNO.retroCsv), kref(KNOWLEDGE.codeReview)],
      turns: [
        user('msg_retro_01', retro - MINUTE, `Here's the export from our Sprint 14 retro board (24 stickies). Cluster it into themes and tell me what to keep, change and try. Keep it short; it goes to #eng.`, [
          textAttachment('att_retro_01', 'sprint-14-retro.csv', 'text/csv', RETRO_CSV, KNO.retroCsv),
        ]),
        ai('msg_retro_02', retro + 40 * SEC, 'sim-swift', `
## Sprint 14 retro: themes

| Theme | Stickies | Votes | Signal |
|---|---:|---:|---|
| **PR size and review quality** | 5 | 21 | A 1,100-line PR sat for four days; big PRs get rubber-stamped |
| **Flaky tests** | 4 | 20 | The checkout e2e test flaked 6 times; people re-run CI instead of filing the flake |
| **Focus time** | 2 | 10 | No two-hour block for deep work |
| **Billing scope churn** | 3 | 10 | Scope changed twice mid-sprint; invoice numbering bounced between teams |
| **Slow queries in staging** | 2 | 6 | Staging data is too small to catch slow queries |

**Went well:** pairing on risky changes (the SSO callback and the billing adapter), the PR review assistant's first pass, Lumen beta fixes two days early, the bundle split, and the new PR template.

## Keep, change, try
- **Keep:** pairing on risky changes, and the PR review assistant's first pass.
- **Change:** no PRs over 600 changed lines (the top idea, 6 votes); flaky tests get a ticket the same day (6 votes).
- **Try:** one meeting-free morning a week for deep work (5 votes).

Billing scope churn is a planning problem rather than an engineering practice, so it sits with you. The staging-data sticky is worth watching: that gap is exactly how a slow query reaches production.`, {
          searched: [KNOWLEDGE.codeReview],
          cites: [
            [KNO.retroCsv, 'Checkout e2e test flaked 6 times this sprint'],
            [KNO.retroCsv, 'Cap PRs at 600 changed lines'],
          ],
          feedback: 'up',
        }),
        user('msg_retro_03', retro + 12 * MINUTE, `Agreed on all three. Billing scope is on me. Make tasks for the two changes and the trial.`),
        ai('msg_retro_04', retro + 13 * MINUTE, 'sim-swift', `
Created three tasks in **Atlas Portal v2**:

1. **Make the PR review assistant ask for a split above 600 lines**: update the workflow prompt and the code review handbook.
2. **Ticket every flaky test the same day**: an issue template plus a CI hint that links to it. The checkout e2e test is the first entry.
3. **Trial one meeting-free morning a week**: two sprints, reviewed at the Sprint 16 retro.`),
        user('msg_retro_05', retro + 20 * MINUTE, `Draft the post for #eng and have Herald send it on the next working morning.`),
        ai('msg_retro_06', retro + 21 * MINUTE, 'sim-swift', `
Here's the draft. Herald will post it to #eng on the next working morning, and it asks for your approval before posting:

> *Sprint 14 retro: what we’re changing*
> • Keep: pairing on risky changes, and the PR review assistant’s first pass.
> • Change: no PRs over 600 changed lines; flaky tests get a ticket the same day.
> • Try: one meeting-free morning a week for deep work.
> Owners are on the tasks. Thanks, everyone.`),
      ],
    },
  ]
}
