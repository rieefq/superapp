# QA PHASE PLAN (after all workspaces land)

Stage 1 — FIND (parallel, read-mostly; each writes findings as structured output, no edits):
1. journeys: write/run e2e/journeys.spec.ts for DESIGN §7.3 journeys + every handoff in §7.2 matrix
   (Chat → Turn into Research → report → Save to Knowledge → backlinks; Projects task → assign Forge → session →
   approval → approve → review → apply; upload → Knowledge → @-mention in chat → cited; Home Ask/Research/Build/
   Delegate/Create/Automate; ⌘K intents; workflow run with approval; studio generate → save to knowledge).
   Findings = failing steps with repro.
2. dead-controls: Playwright crawler visiting every route (all list items' first entity routes too), clicking every
   enabled button/menuitem/link/tab once (in a fresh page per control, skip destructive confirm flows by cancelling),
   recording controls that produce no observable effect (no URL change, no DOM mutation, no dialog/toast/focus change)
   or throw console errors. Findings = control + route + selector.
3. visual-consistency: screenshot every route + key states (desktop dark/light, 390, 768, 2560); compare against
   DESIGN §3-§6 and each other: header patterns, spacing, type roles, color-only-for-state, honesty labels,
   empty states, alignment, overflow. Findings = route + screenshot + issue + proposed fix.
4. a11y: keyboard-only traversal per route (tab order, focus visible, Esc closes, skip to content/F6),
   roles/names via accessibility snapshot, contrast spot checks, reduced motion. Findings.
5. honesty: every place simulated output appears is labeled (SIM/hatch/"No model was called"/est.), no live claims
   without a live path; settings "What's real" dialog accurate.
6. perf: vite build chunk sizes, route-level lazy loading, long-list rendering under streaming (React profiler via
   Playwright trace), memory after 5 min of runs; Findings.

Stage 2 — VERIFY: each finding gets an adversarial verifier (reproduce; default to refuted when it cannot reproduce).

Stage 3 — FIX: group confirmed findings by owning area (workspace dir / shell / ui / core) and run fixers per area
(sequential per area, parallel across areas), each re-running relevant e2e + typecheck + unit tests.

Stage 4 — FINAL: full e2e suite, vite build, screenshots, README/docs.
