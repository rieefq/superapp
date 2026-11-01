# Project status — paused

Paused on 2026-11-01 at the user's request (usage limit). Everything is committed and pushed on
`claude/compassionate-brahmagupta-mwtmy0`.

**Health at pause:** `npm run typecheck` is clean and all 1,325 unit tests pass (`npx vitest run`). The e2e suites were
not re-run after the agents were stopped. Run `npm run e2e` before trusting any workspace's e2e status.

## Done

- **Design.** `docs/DESIGN.md` is the final spec, chosen by a design panel that compared five directions. Tokens, type roles and the validated
  chart palette are applied in `src/styles/tokens.css` and `src/index.css`.
- **Core** (`src/core`):
  - domain model and normalized persisted DB
  - run engine with approvals and permissions (including always-allow grants)
  - real local search and retrieval
  - simulator, Anthropic (official SDK) and OpenAI-compatible providers
  - chat orchestration; the Context Line contract is enforced, so excluded chips are never sent
  - domain services for every workspace, live GitHub reads, simulations, analytics, assist heuristics
  - seed world, loaded lazily
- **UI kit** (`src/ui`): primitives, overlays, hooks, display, charts, procedural art and the signature components. The gallery is at `/dev/ui`.
- **App:**
  - global shell (`src/app/shell`), Inspector, ⌘K command center, keyboard map, responsive layout
  - the five workspace templates (`src/app/templates`)
  - shared action components (`src/app/components`): Composer, Context Line, Start sheet, run panel, pickers
  - Home
- **Workspaces** (`src/workspaces/*`):
  - **Builds finished:** chat, workflows, insights, settings, projects, integrations. Their adversarial review stage started but was
    interrupted.
  - **Builds interrupted, with substantial code in place:** research, code, agents, studio, knowledge.

## To resume (in order)

Agent briefs are saved in `docs/handoff/`. They were written for parallel agents and reference an old scratchpad path, so
point new agents at `docs/handoff/...` instead. CLAUDE.md has the conventions every agent follows.

1. **Finish the interrupted builds.** For each of research, code, agents, studio and knowledge, run
   `docs/handoff/workspace-briefs/<ws>-implement.txt`. Tell the agent the workspace is partly built, and that it should continue and
   complete it, not start over.
2. **Review every workspace.** Run `docs/handoff/workspace-briefs/<ws>-review.txt` for all 11. These are adversarial reviews: the
   agent exercises every control, then fixes what it finds.
3. **Shared-code fixes.** These come from `docs/handoff/briefs/integrator.txt`; check each one, since most are still open:
   - `src/app/App.tsx`: use `RouterProvider` from `react-router/dom`, so navigations aren't held back while runs stream.
   - `StageHeader`: renamable titles are clipped by 12px.
   - `Stage`: the text column is narrower than the composer.
   - Composer: its fallback context leaks into Inspector › Context.
   - `TurnIntoMenu`: needs a background option.
   - Inspector › Context: add/remove for attached items.
   - `boot.ts`: call `startWorkflowTriggers()` and `watchBudget()`.
   - Automate drafts: should be created in one call with `enabled:false`.
   - Assist: workflow drafts should split clauses on an em dash.
   - Toasts: should avoid the docked Inspector.
   - Charts: palette should accept an explicit series `color`; `BarChart` needs an `onSelect` drill-down; `DataTable` should hide
     columns by container width.
   - `ActivityFeed`: timestamps use `ink-4`; they should use `ink-3`.
   - Browser notifications for approvals.
   - Single-item deletes should respect `settings.safety.confirmDestructive`.
4. **App-wide QA.** Follow `docs/handoff/briefs/qa.md` with the six briefs in `docs/handoff/qa-briefs/`: journeys, dead controls,
   visual consistency, accessibility, honesty and performance. Reproduce each finding before fixing it. One known
   performance item: split markdown, diff and syntax highlighting out of the signature chunk (about 297 KB gzipped).
5. **Finish.** Write the README, run `npm run e2e` and `npm run build`, take a final screenshot pass, then commit and push.

## Operational notes

- The container has 4 cores and 15 GB of memory. Run at most about 6–8 concurrent agents. Each Vite dev server grows to about
  700 MB. `npm run typecheck` already limits itself to two concurrent single-threaded runs (`scripts/typecheck.sh`).
- Each agent should use its own dev port and `VITE_CACHE_DIR`, and stop its servers when it's done (see CLAUDE.md).
