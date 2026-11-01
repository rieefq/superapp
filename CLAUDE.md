# Atrium — engineering conventions

Atrium is a browser-only "AI operating system": one environment where conversations, research,
coding agents, autonomous agents, workflows, knowledge, creative work and projects share context.
React 19 + Vite 8 + TypeScript 7 (native `tsc`) + Tailwind v4 + zustand + motion + lucide-react.

The design spec lives in `docs/DESIGN.md`. Read the sections relevant to your task before building UI.

## Architecture map

```
src/
  lib/                 pure utilities (id, cn, rng, format, emitter) — no React, no app state
  core/                shared foundation — every workspace builds on this
    types/             domain model (the contract). One import surface: `@/core/types`
    db/                normalized table store (zustand) + per-table localStorage persistence
                       `db.get/all/filter/insert/update/remove`, hooks `useRow/useRows/useRowsByIds/useCount`
    services/          domain services: the ONLY place that writes cross-cutting entities.
                       They keep activity log, link graph and notifications consistent.
    runs/              run engine: every AI execution is a Run (steps, approvals, usage)
      factories/       simulation scripts per run kind (registered by name)
    ai/                model providers (simulator | anthropic | openai-compatible), chat orchestration,
                       intent detection
    search/            local full-text index + knowledge retrieval (real, not simulated)
    permissions/       capability catalog + approval policy evaluation
    integrations/      integration catalog (honest live/simulated support flags)
    settings.ts        user settings store      context.ts  scope (active project) + pinned context
    secrets.ts         local API-key vault (never in DB exports)
    analytics/         run/spend/reliability aggregation for Insights and Home
    assist/            rule-based heuristics (next actions, agent/repo picking, workflow drafts) — not AI
    github/            GitHub REST client (live reads)      sim/  simulation corpora/generators
    seed/              realistic first-run data
  ui/                  design system (import from `@/ui`): primitives, hooks, display, charts, art, signature
  app/                 entry, router, boot, registry, shell (src/app/shell/**, useShellStore), command center,
                       lens registry (src/app/lens), shared connected components (src/app/components/**:
                       Composer, ContextLine, StartSheet, pickers, HandoffMenu, DerivedRow, LandedCard…)
  workspaces/<id>/     one directory per workspace: manifest.ts (eager), index.tsx (lazy route), lens.tsx (lazy)
```

## Data rules

- Read with hooks from `@/core/db` (`useRow`, `useRows`, …). Never subscribe to the whole DB.
- `useRows(table, filter, sort)` is shallow-compared — fine to pass inline closures.
- Write through domain services in `@/core/services/*` when they exist for the entity. Raw `db.*` writes are
  acceptable only for workspace-private fields of entities your workspace owns.
- Every user- or agent-initiated change that matters gets an activity event (`logActivity`).
- When one entity is created from another (task from message, report from investigation…), create a link
  (`link(from, to, 'derived_from' | 'produced' | …)`) so backlinks work everywhere.
- IDs: `newId(ID_PREFIX.<table>)`. Timestamps: epoch ms. Never use `Date` objects in stored data.
- Stored data must be JSON-serializable. No functions, Maps, Sets or class instances in tables.

## Honesty rules (non-negotiable)

- Anything produced by the local simulator (AI text, agent steps, terminal output, web sources, generated media,
  integration activity) is marked `simulated: true` and the UI shows it with the `SimBadge`/"Simulated" label.
- Never imply a real model, real web search, real code execution or a real third-party connection happened when it
  did not. Live paths that exist: Anthropic API and OpenAI-compatible endpoints (with user key), GitHub REST API
  reads, local file reading, local search/retrieval.
- Costs computed for simulated runs are labeled as estimates.

## Product vocabulary (docs/DESIGN.md is the source of truth — read the sections you need)

- **Run**: every AI execution. Drawn only with the shared run components (StatusGlyph, StepTape, RunPill/RunRow,
  RunTimeline, Colophon/Receipt). Never a bare spinner for AI work.
- **Scope**: the active project (`useScope()`), a working directory — not in the URL. Lists filter to it with a
  `Filtered to <Project> · Show all` row.
- **Hold** (not "pin"): `useContextStore.pinned` — held items ride along in every new AI action.
- **Context Line**: above every composer — Project → Held → Attached → Likely, each toggleable; ContextMeter shows tokens.
- **Start sheet**: the one surface for starting delegated work and every "Turn into…" (`openStartSheet(kind, {source})`).
- **Inspector**: right panel with tabs Run · Item · Context (`useShellStore`, `?inspect=<kind>:<id>`).
- **Run Line**: bottom strip of run pills. **Needs you**: approvals + reviews (interrupts). **Updates**: quiet notifications.
- **Colophon**: the provenance line under every AI output (`ProvenanceLine`). **Receipt**: the expanded version.
- **Lens**: per-kind renderers in `src/workspaces/<owner>/lens.tsx` (`lenses[kind] = { panel, card }`), loaded lazily.
- **Templates** (§6.0): Page, Session, Board, Canvas, Library — every workspace is one of these inside the shell frame.

## UI rules

- Use `@/ui` components and design tokens. Do not hard-code colors, font families, shadows or radii;
  use the Tailwind theme tokens defined in `src/styles/tokens.css` (see docs/DESIGN.md §4).
- Typography through the type-role utilities: `type-display`, `type-title-1/2/3`, `type-body-lg/body/body-sm`,
  `type-caption`, `type-micro`, `type-label`, `type-meta`, `type-meta-caps`, `type-mono-sm`, `type-mono`,
  `type-figure`, `type-doc-h1/h2/h3`, `type-doc`.
- Color means state only: live (working), attn (needs you), done, fail. Identity hues only inside entity marks and chart
  series. Accent = ink. No gradients, glows, glass, blur, emoji, sparkle/wand icons (`Sparkles` is banned).
- Shape grammar for entity marks: circle = actors, capsule = runs/happenings, rounded square = things that last,
  dashed edge = simulated.
- Simulated = `SIM` tag + hatch (`.sim-hatch`) or dashed `--line-input` edge, always visible (never hover-only).
  Exact strings: "Simulated terminal — nothing was executed", "Simulated web result", "No model was called".
  Estimates always say `est.`.
- Every interactive control must work. If a capability is simulated, it still behaves realistically and is labeled.
- Every data view needs loading, empty and error states where they can occur.
- Keyboard accessible: real `<button>`/`<a>`, visible focus ring, Escape closes overlays, labels on icon buttons.
- Respect `prefers-reduced-motion` (motion components already do via the `useReducedMotion` setting).
- Must work from 360px to 2560px wide.

## Working in parallel with other agents (important)

Several agents work in this tree at the same time.
- Do NOT run any `git` command (no stash, checkout, reset, commit). The orchestrator handles git.
- Only create/edit files inside the paths you were assigned. If you need a change in a shared file you do not own,
  describe it in your final report instead of making it (unless your brief explicitly allows it).
- Do not run `npm install`/add dependencies unless your brief says so.
- Do not run `vite build` into `dist/` (other agents may be using it). Typecheck with `npm run typecheck`.
- Typecheck ONLY via `npm run typecheck` (slot-limited: at most two run at once; each tsc needs ~1GB — never run
  raw `npx tsc` in parallel). Output may include other agents' in-progress errors; filter to your paths:
  `npm run typecheck 2>&1 | grep -E 'src/(your|paths)' || echo clean`.
- Memory is shared by ~12 agents: run at most ONE dev server of your own, reuse it, and kill it (and any e2e server
  you started) before you finish. Stale dev servers may be recycled automatically — just restart yours if it vanished.
- Dev server: pick your assigned port and a private cache dir:
  `PORT=52xx VITE_CACHE_DIR=node_modules/.vite-52xx npx vite --port 52xx --strictPort` (run in background).
- Screenshots: `node scripts/shot.mjs --port 52xx --out /tmp/shots-<you> /route1 /route2`
  (`--width 390 --height 844` for mobile, `--theme light`). Then view the PNG with the Read tool.
- E2E: `E2E_PORT=53xx npx playwright test e2e/<file>.spec.ts`.
- Unit tests: `npx vitest run src/<path>`.

## Commands

- `npm run dev` — dev server · `npm run typecheck` · `npm test` (vitest) · `npm run e2e` (playwright) · `npm run build`
