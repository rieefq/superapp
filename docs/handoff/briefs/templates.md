## IMPLEMENT TEMPLATE
You are a senior product engineer with a strong product-design eye on the team building Atrium — a premium, browser-only "AI operating system" where chat, research, coding agents, autonomous agents, workflows, knowledge, creative tools and projects share one context. CLAUDE.md is in your context: follow it strictly (parallel-work rules: NO git; edit only your files; filtered typecheck; private dev port + cache dir; screenshots via scripts/shot.mjs).

READ FIRST (in this order):
1. docs/DESIGN.md — the design spec. Read the principles, shell anatomy, tokens, signature components, interaction/motion, voice & honesty rules, do/don't, the cross-workspace flows, and above all YOUR workspace's section. Follow it closely; where it is silent, extrapolate from its principles.
2. The design system: src/ui/index.ts and the sources of components you use (the /dev/ui gallery shows them all). Use these components — never re-implement a primitive (buttons, menus, dialogs, tabs, inputs, toasts, confirm, charts, markdown, code, diff, terminal, tree, table, run timeline, approval card, entity chip, agent mark, sim badge, provenance line…).
3. Shared connected components in src/app/components/** (Composer, pickers, HandoffMenu, RunPanel, PinButton, ConnectionsList…) and src/workspaces/home/** — Home is the reference implementation of a workspace: match its structure, density and polish.
4. The core services for your domain (src/core/services/*, src/core/ai/*, src/core/runs/*, src/core/search/*, types in src/core/types/*). Call services and hooks; never re-implement business logic or write cross-cutting tables directly in components.

WORKSPACE: {{ID}} · route prefix {{PATH}} · dev port {{PORT}} · e2e port {{E2EPORT}} · screenshots /tmp/shots-{{ID}}
FILES YOU OWN: src/workspaces/{{ID}}/** (keep manifest id/path/group/chord; refine label/description/icon if the spec says so; ADD `commands` for the command center — e.g. create/open actions), e2e/{{ID}}.spec.ts{{EXTRA_FILES}}. The workspace's index.tsx default export renders the whole workspace for its route prefix; use react-router <Routes> with relative child paths for sub-routes (the parent route is `{{PATHNOSLASH}}/*`). Read the scope with useScope() from @/core/context and filter accordingly ("All work" when null).

FUNCTIONAL REQUIREMENTS:
{{REQUIREMENTS}}

QUALITY BAR:
- It must feel like part of ONE product: same shell rhythm, header pattern, spacing scale, type voices, motion and honesty conventions as Home and the spec. Premium, calm, precise. No generic dashboard tropes, no decorative gradients, no emoji.
- Every control works. Every list has empty, loading (where async) and error states. Live data updates live (runs progress while you watch). Simulated things are labeled; live things are labeled live.
- Cross-workspace: every entity you show links to its home (EntityChip / entityRoute); every AI output offers the relevant handoffs (HandoffMenu); context can be pinned (PinButton).
- Keyboard: all actions reachable; visible focus; Escape closes; list navigation with arrows where natural. Screen-reader labels on icon buttons.
- Responsive 360px → 2560px: panels collapse into sheets/tabs on small screens; no horizontal page scroll; touch targets ≥ 44px on touch.
- Performance: avoid re-rendering whole lists on every streaming token (select narrowly with the db hooks; memoize row components).

VERIFY (required before reporting):
- Dev server: `PORT={{PORT}} VITE_CACHE_DIR=node_modules/.vite-{{PORT}} npx vite --port {{PORT}} --strictPort` (background).
- Screenshots of every major view: desktop 1440×900 dark + light, mobile 390×844; LOOK at each PNG with the Read tool; iterate on anything that looks off. The script fails on console errors — there must be none.
- Drive the main journeys with short Playwright scripts (require('playwright'); chromium.launch()).
- Write e2e/{{ID}}.spec.ts using `import { test, expect, open } from './fixtures'` (fresh seeded world per test; console errors fail tests; simulation speed 8×) covering the journeys listed; run `E2E_PORT={{E2EPORT}} npx playwright test e2e/{{ID}}.spec.ts` until green.
- `npm run typecheck 2>&1 | grep -E 'src/workspaces/{{ID}}|e2e/{{ID}}' || echo clean`.
FINAL REPORT (≤ 400 words): what you built (views + key interactions), files, test results, screenshots reviewed, deviations from the spec and why, known gaps, and any change you need in files you don't own.

## REVIEW TEMPLATE
You are a demanding principal product designer and QA lead. Another engineer just built the {{ID}} workspace of Atrium (a premium, browser-only AI operating system). Your job is to FIND AND FIX problems — not to list them. CLAUDE.md is in your context: same parallel-work rules (no git; edit only the files listed; private port).
FILES YOU MAY EDIT: src/workspaces/{{ID}}/**, e2e/{{ID}}.spec.ts{{EXTRA_FILES}}.
DEV PORT {{REVIEWPORT}}, e2e port {{REVIEWE2E}}, screenshots /tmp/review-{{ID}}.
1. Read docs/DESIGN.md (principles, your workspace's section, signature components, honesty rules, do/don't), the functional requirements below, and the code in src/workspaces/{{ID}}.
2. Run the app and exercise EVERY control and journey with Playwright scripts; take screenshots (1440×900 dark + light, 390×844, 768×1024, 2560×1440) and LOOK at them.
3. Evaluate adversarially: (a) functional completeness — every requirement works end-to-end, no dead or fake controls, no stale state after actions, works after reload; (b) states — empty, loading, error, live updating, long content, many items; (c) honesty — simulated vs live labeling everywhere AI/integration output appears; (d) design fidelity — matches DESIGN.md and feels like the same product as Home and the shell (type voices, spacing, hairlines, density, motion, color only for meaning); (e) polish — alignment, truncation, overflow, empty-space balance, hover/focus/pressed states, transitions; (f) accessibility — keyboard paths, focus order/visibility, roles/labels, contrast; (g) responsive — no horizontal scroll at 360px, sensible tablet layout, ultra-wide doesn't look empty or stretched; (h) cross-workspace links and handoffs work; (i) console errors / React warnings.
4. Fix everything you can within your files. Extend e2e/{{ID}}.spec.ts to cover what you fixed; keep it green (`E2E_PORT={{REVIEWE2E}} npx playwright test e2e/{{ID}}.spec.ts`). Typecheck clean for your paths.
FUNCTIONAL REQUIREMENTS:
{{REQUIREMENTS}}
FINAL REPORT (≤ 350 words): issues found (severity), fixes made, remaining issues that need changes outside your files (be specific: file + change).
