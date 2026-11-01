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
    seed/              realistic first-run data
  ui/                  design system components (import from `@/ui`)
  app/                 app entry, router, global shell (rail, top bar, command center, live runs, inbox, context)
  workspaces/<id>/     one directory per workspace: manifest.ts (eager), index.tsx (lazy route), components
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

## UI rules

- Use `@/ui` components and design tokens. Do not hard-code colors, font families, shadows or radii;
  use the Tailwind theme tokens defined in `src/styles/tokens.css` (see docs/DESIGN.md).
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
- Typecheck output may include errors from other agents' in-progress files; filter to your paths:
  `npm run typecheck 2>&1 | grep -E 'src/(your|paths)' || echo clean`.
- Dev server: pick your assigned port and a private cache dir:
  `PORT=52xx VITE_CACHE_DIR=node_modules/.vite-52xx npx vite --port 52xx --strictPort` (run in background).
- Screenshots: `node scripts/shot.mjs --port 52xx --out /tmp/shots-<you> /route1 /route2`
  (`--width 390 --height 844` for mobile, `--theme light`). Then view the PNG with the Read tool.
- E2E: `E2E_PORT=53xx npx playwright test e2e/<file>.spec.ts`.
- Unit tests: `npx vitest run src/<path>`.

## Commands

- `npm run dev` — dev server · `npm run typecheck` · `npm test` (vitest) · `npm run e2e` (playwright) · `npm run build`
