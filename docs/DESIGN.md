# Atrium: Final Design Specification

> This document is the source of truth for `docs/DESIGN.md`. Where the candidate directions disagreed, it picks one answer. Anything not marked otherwise is **P1**. Items marked **[P2]** are built only after every P1 item in the same area works end to end.

**Where the decisions came from.** The base is candidate A, "instruments, not dashboards". Its model:
- Every AI execution is a **Run**.
- The shell makes runs visible (the Run Line).
- Decisions that interrupt you ("Needs you") are kept separate from quiet updates.
- Any run can be attached to an **Inspector**.
- Anything can be converted through one **Start sheet**, and the result comes back to where it was requested.

Grafted from other candidates:
- From D: the Context Line on every composer, the shape grammar, the "Why asked" line, and peek-in-place.
- From C: the Step Tape, the banded run board, read-backs and run receipts.
- From B: the Colophon, the workflow Outline view, "Available to AI", and the highlighter wipe when an approval resolves.

Dropped:
- From A: the shell-prompt vocabulary, Clips, scope in the URL, green as the "working" color, replay and branch-compare, steering a running run, and flight animations.
- From B: serif headlines for prompts.
- From C: the universal bottom command line and the overloaded single-letter keys.
- From D: the sheet stack, the Map view, and carrying context by default without showing it.
- From E: the omnibar fused with a run "island".

Names, groups and chords follow the registry that already ships in `src/app/registry.ts` and the manifests.

---

## 1. Product, positioning, principles

### 1.1 Name
**Atrium.** An atrium is the open hall that every room of a building opens onto: one environment, many workspaces, one shared context. The wordmark is lowercase `atrium` in Instrument Sans 600, `font-stretch: 90%`, tracking −0.01em. It appears only next to the mark, on the boot screen and in About.

### 1.2 Positioning (one line)
**One environment for thinking, delegating and reviewing. Every AI action is a visible, stoppable Run that shares your project's context.**

### 1.3 Design principles

1. **Every AI action is a Run you can see, stop and audit.** Any execution (chat turn, coding turn, agent task, investigation, workflow run, generation) is drawn with the shared run components: StatusGlyph, StepTape, RunTimeline and Colophon. It appears in the Run Line and in Agents › Runs, and it ends with a receipt. Never show a bare spinner for AI work.
2. **Color signals state; it never decorates.** The chrome is neutral graphite (dark) or paper (light). Only four signals carry color: **live** blue (working now), **attention** amber (needs you), **done** green (succeeded), **fail** red (failed or destructive). Identity hues appear only inside entity marks and chart series. No gradients, glows, glass or blur.
3. **Honest by construction.** Every simulated output carries a visible `SIM` tag plus a hatch or dashed edge. Every estimate says `est.`. A label is never shown only on hover. Nothing implies that a model, web fetch, command or integration ran when it did not.
4. **Context is visible and belongs to the user.** Every composer shows exactly what the AI will receive (the Context Line plus a token meter). Nothing reaches a model without being listed. Every run records what it saw, and every knowledge item shows which runs used it.
5. **Interrupt only for decisions.** Amber, persistent toasts, tab badges and the "Needs you" count are reserved for approvals and reviews. Completions and failures are quiet updates. The same ApprovalCard is used everywhere.
6. **Fixed frame, adaptive content.** The shell's geometry never rearranges itself: top bar, rail, Run Line, Inspector. Changing scope or selection changes content, not layout.
7. **One pattern, many places.** Every workspace is a configuration of the five templates (§6.0) and the shared kit (§5). If you are about to build a one-off, extend a shared component instead.

---

## 2. Information architecture

### 2.1 Navigation tree (rail order, top to bottom)

| Group | Workspace | Chord | Route | Rail icon (lucide) | Purpose (manifest `description`) |
|---|---|---|---|---|---|
| — | **Home** | `G H` | `/` | `House` | What needs you, what is moving, and where to pick up. |
| Think | **Chat** | `G C` | `/chat` | `MessagesSquare` | Think out loud with AI and turn conversations into action. |
| Think | **Research** | `G R` | `/research` | `Telescope` | Investigate questions, gather sources, synthesize reports. |
| Make | **Code** | `G X` | `/code` | `SquareCode` | Delegate software work to coding agents and review their changes. |
| Make | **Studio** | `G S` | `/studio` | `Palette` | Create images, video, decks and copy with generative tools. |
| Delegate | **Agents** | `G A` | `/agents` | `Orbit` | Command center for autonomous agents and every run. |
| Delegate | **Workflows** | `G W` | `/workflows` | `Workflow` | Design and monitor automations across your tools. |
| Organize | **Projects** | `G P` | `/projects` | `FolderKanban` | Goals, tasks and milestones for you and your agents. |
| Organize | **Knowledge** | `G K` | `/knowledge` | `Library` | The shared memory every AI action can draw from. |
| System | **Insights** | `G I` | `/insights` | `ChartNoAxesCombined` | Runs, spend, model usage and reliability at a glance. |
| System | **Integrations** | `G N` | `/integrations` | `Plug` | Connect services and control what agents may do with them. |
| System | **Settings** | `G ,` | `/settings` | `Settings2` | Profile, appearance, models, safety and data. |

The groups run from the most interactive to the most autonomous: Think → Make → Delegate → Organize. The rail shows them only as separators. Group names appear in four places: the workspace menu in the breadcrumb, the Doorway flyout eyebrow, ⌘K section headings, and the phone "More" sheet.

### 2.2 Prominence tiers (where build depth goes)

- **Tier 1 (daily core, deepest polish):** the shell, Home, Chat, Code, Agents, Projects, and Knowledge as a *service* (retrieval, Hold, Save, @-mentions).
- **Tier 2 (complete, built from the same parts):** Research, the Knowledge library, Workflows, Studio.
- **Tier 3 (visibility and configuration):** Insights, Integrations, Settings. These are smaller in the rail and usually reached in context:
  - Run Line totals → Agents › Runs
  - spend → Insights
  - provider chip → Integrations
  - avatar → Settings

The three journeys optimized first:
1. **Ask → act:** Chat → Turn into → result lands back in the thread.
2. **Delegate → approve → review:** Projects or Agents → Needs you → Code review.
3. **Capture → reuse:** Research or upload → Knowledge → Context Line in any composer.

### 2.3 What lives where

| Global shell (always present, never moves) | Inside a workspace (owned by its manifest) | Contextual (appears with a selection or intent, then goes) |
|---|---|---|
| Top bar: mark (activity LED), project crumb, workspace crumb, command field, Holding chip, Needs-you button, provider chip, avatar | List pane (the workspace's objects) | Inspector tabs and content (Run · Item · Context) |
| Rail with live/attention badges | Stage header: item title, tabs, actions | Hover cards on entity chips |
| Run Line (all runs in flight, totals) | Stage body (the work surface) | Selection toolbar on selected text |
| Inspector frame (open/closed, width) | Docked composer (placeholder, slash commands) | Turn into… menu, ⋯ action menus |
| Command center (⌘K) | Empty, loading and error states | Inline ApprovalCards inside run timelines |
| Needs you & Updates popover, toasts, tab title and favicon | Workspace-specific shortcuts (listed in `?`) | Start sheet, ReadBack, DerivedRows and LandedCards |
| Start sheet, confirm dialogs | | Context Line chips and the context breakdown |

A workspace plugs into the shell **only through its manifest** (§2.7). Workspaces never add their own chrome to the top bar, the rail or the Run Line.

### 2.4 Project scope (the "working directory")

- **State:** `useContextStore.scopeProjectId`, persisted. Scope is **not** part of the URL. `null` means "All work".
- **Always visible:**
  - In the top bar, the project crumb shows the project's square hue mark and name. While scoped, the top bar's bottom edge becomes a 2px rule in the project hue.
  - In every composer, the first chip of the Context Line is the project.
  - Every filtered list shows a filter row, e.g. `Filtered to Atlas Portal v2 · Show all`.
- **What scope changes:**
  - Every workspace list, Home, and the default filter of Agents › Runs are filtered to the project.
  - New entities are filed into the project.
  - The project's memory is included in new runs.
- **What scope never changes:**
  - Opening an item from another project does not switch scope. The stage header shows `From Lumen Launch · Switch project`.
  - The Run Line still shows runs from other projects, dimmed to 60% with their project mark.
  - ⌘K search stays global, with results from the current project ranked first.
- **Runs keep the project they started in** (`Run.projectId`). A run started *from an item* uses that item's project (the existing `projectFor` rule in `handoff.ts`). The composer's project chip always shows which project a run will use.
- **Switching scope while holding items from another project** shows an 8-second toast: `3 held items are from Atlas Portal v2 and still ride along. [Release them] [Keep]`.

### 2.5 Context & memory model

| Layer | Source | Sent to the model? | Where it is visible | Verb |
|---|---|---|---|---|
| **Project memory** | `Project.goal`, `instructions`, `pinnedRefs` | Yes, in every run in that project | Context Line (first chip), Projects › Memory, Inspector › Context | **Add to project memory** (⋯ menu only) |
| **Holding** | `useContextStore.pinned` (`source: 'user'`) | Yes, in every new AI action, unless switched off for that action | Top-bar Holding chip, Context Line "Held" group | **Hold** (`H`) / Release |
| **Attached** | `Thread.contextRefs`, message attachments, @-mentions, the source of a Turn into | Yes, for that thread or action | Context Line "Attached" group | Attach (+, @, drop) |
| **Retrieved** | Auto-retrieved knowledge passages (`settings.ai.autoRetrieve`) | Yes, when auto-retrieve is on | While typing: dimmed "Likely" chips (debounced local search). After the run: the exact set in its **Saw** list | Toggle auto-retrieve; × a likely chip to exclude it |
| **Knowledge** | `KnowledgeItem`s (durable, indexed locally) | Only through the four layers above | Knowledge workspace; "Used by N runs" on every item | **Save to Knowledge** (`S`) |

Rules:
- The Context Line shows the layers in this order: **Project → Held → Attached → Likely**.
- Every chip can be switched off for the current action. Every chip contributes to the context meter.
- Retrieval never reads items set to `Available to AI: Never`. It reads items set to `When cited` only when they are explicitly attached or mentioned.
- No context reaches a model unless it appears in the Context Line before the run and in the run's Saw list after it.

### 2.6 Route map

These routes match the existing `routeIn()` / `entityRoute()` in `src/core/services/entities.ts`. Workspaces own `<path>/*`. Sub-views are path segments. Selections are query parameters.

| Route | View |
|---|---|
| `/` | Home |
| `/chat` | Thread list. The stage shows a new conversation. |
| `/chat/:threadId` | Thread. `?m=` scrolls to and highlights a message. |
| `/research` | Investigation list. The stage shows a new investigation brief and recent reports. |
| `/research/new` | Brief form. `?q=` prefills the question. |
| `/research/:investigationId` | Investigation. Running: the board. Done: `/report` (default), `/findings`, `/sources`, `/activity`. `?source=` selects a source. |
| `/code` | Repos and sessions. The stage shows "Start a session". |
| `/code/new` | New session form. `?repo=`, `?task=` |
| `/code/repos/:repoId` | Repo: file tree, read-only viewer, and the repo's sessions |
| `/code/:sessionId` | Session: `/activity` (default), `/changes`, `/files`, `/checks`. `?run=` scrolls to a turn. |
| `/studio` | Contact sheet. `?board=`, `?kind=` |
| `/studio/:assetId` | Asset view (image, video, deck or doc) |
| `/agents` | **All runs** board (default). `?status=`, `?kind=`, `?agent=`, `?provider=`, `?since=`, `?view=lanes` [P2] |
| `/agents/roster` | Agent cards |
| `/agents/new` | New agent: template picker, then form |
| `/agents/runs/:runId` | Run page, for runs with no other home |
| `/agents/:agentId` | Agent: `/now` (default), `/runs`, `/configure`, `/memory`. `?run=` |
| `/workflows` | Workflow list. The stage shows templates. |
| `/workflows/new` | New workflow. `?from=run:<id>` for Make repeatable [P2] |
| `/workflows/:workflowId` | Editor. `?view=outline`, `?run=` overlays a past run |
| `/projects` | Projects index |
| `/projects/my-tasks` | Tasks assigned to you across projects. `?task=` |
| `/projects/:projectId` | Project: `/overview` (default), `/tasks`, `/work`, `/activity`, `/memory`. `?task=` opens the task in the Inspector. |
| `/knowledge` | Library. `?collection=`, `?q=`, `?filter=` |
| `/knowledge/:knowledgeId` | Reader and editor |
| `/insights` | Overview. `?range=24h|7d|30d` |
| `/insights/journal` | Activity journal |
| `/integrations` | Catalog. `?category=` |
| `/integrations/:integrationId` | Integration detail |
| `/settings/:section` | `profile` (default), `appearance`, `models`, `permissions`, `budgets`, `notifications`, `keyboard`, `simulator`, `data`, `about` |
| `/dev/ui` | Component gallery (development only) |

The following path segments are reserved and are never ids: `new`, `runs`, `roster`, `repos`, `my-tasks`.

The shell recognizes one global parameter on every route: `?inspect=<kind>:<id>`. It opens the entity in Inspector › Item. Browser Back closes it.

### 2.7 Shell state, manifest contract, model additions

**Shell UI store** (`useShellStore`, zustand, persisted unless noted):

| Field | Purpose |
|---|---|
| `inspector[workspaceId]` | `{ open, tab: 'run' \| 'item' \| 'context' }` |
| `inspectorWidth` | Inspector width |
| `listPane[workspaceId]` | `{ open }` |
| `listPaneWidth` | List pane width |
| `attachedRunId` | Global attached run (not persisted) |
| `inspectStack: EntityRef[]` | Peek history inside the Inspector (not persisted) |
| `recents: EntityRef[]` | Max 20; updated whenever an entity route is opened |
| `startSheet` | `{ open, kind, source?, prefill }` (not persisted) |
| `commandOpen`, `needsYouOpen` | Open state of the command center and Needs-you popover (not persisted) |

**`WorkspaceManifest` additions** (all optional, all eager-safe):

| Field | Purpose |
|---|---|
| `newAction` | What `N` does |
| `composer` | `{ placeholder, slashCommands }` |
| `shortcuts: { keys, label }[]` | Listed in the `?` sheet |
| `defaultInspectorTab` | Inspector tab used when the workspace opens |
| `inspectorDefaultOpen` | Whether the Inspector starts open |

**Lens registry** (`src/app/lens/registry.ts`): maps each `EntityKind` to a *lazy* panel renderer imported from `@/workspaces/<owner>/lens.tsx`, where the owner comes from `KIND_META`. The chip and card densities are generic, built on `resolveEntity`.

**Model and settings additions:**
- `Run.plannedSteps?: number`. The engine sets it from the plan length; the Step Tape uses it.
- `KnowledgeItem.aiAvailability?: 'always' | 'cited' | 'never'`. Defaults to `always`. Retrieval respects it.
- `CodeSession.autonomy?: Autonomy`. This is the session's approval policy. Runs evaluate permissions with the session agent's autonomy overridden by this value.
- `Settings.safety.countSimulatedSpend: boolean`. Defaults to `false`.
- `Settings.notifications.focusMode: boolean`. Defaults to `false`.
- `Settings.notifications.browser: boolean`. Defaults to `false`. [P2]
- `Settings.appearance.singleKeyShortcuts: boolean`. Defaults to `true`.

**Handles:** derived at render time with the existing `shortCode(id)`, e.g. `RUN-K3J9`, `TSK-8QPA`. They are never stored. Typing a handle in ⌘K jumps straight to the entity.

**Icon change:** `Sparkles` is banned. Replace it with `Palette` for the asset kind and the studio run kind, and with `ImagePlus` for `media.generate`.

---

## 3. Global shell anatomy

### 3.1 Frame (desktop, ≥1280px)

```
┌──────┬──────────────────────────────────────────────────────────────────────────────────┐
│ mark │ ■ Atlas Portal v2 ▾ › Code ▾      [ ⌕ Search or start…        ⌘K ]   ◫ 3  ◆ 2  SIM  ◯ │ top bar 48
├──────┼──6px─────────────────────────────────────────────────────────────────────────────┤
│ rail │ ╭ workspace screen ─────────────────────────────────╮6px╭ Inspector ─────────╮ │
│  72  │ │ list pane 280 │ stage (min 640)                   │   │ Run · Item · Context│ │
│      │ │               │ ┌ stage header 48 ──────────────┐ │   │ 360                 │ │
│      │ │               │ │ body                           │ │   │                     │ │
│      │ │               │ │ docked composer                │ │   │                     │ │
│      │ ╰───────────────┴──────────────────────────────────╯   ╰─────────────────────╯ │
├──────┴──────────────────────────────────────────────────────────────────────────────────┤
│        (● Research · EU suppliers 3/7 ▮▮▮▯▯)  (◆ Forge · wants approval)  +2   3 running · 1 needs you · $0.42 today │ Run Line 28
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Chrome:** the top bar, rail and Run Line form the bezel, on `--surface-chrome`.
- **Screens:** the workspace screen and the Inspector are inset screens on `--surface-canvas`, with a 1px `--line` border and `--radius-md` (10px).
- **Inset:** `--bezel` is 6px from the chrome and 6px between screens at ≥1024. Below 1024 the inset is 0: screens sit flush, separated by 1px lines, with no radius.
- Only overlays and dragged items cast shadows. Docked screens never do.

### 3.2 Top bar (48px, chrome, 1px `--line` bottom border; a 2px project-hue rule while scoped)

| Element | Placement & size | States & behavior |
|---|---|---|
| **Atrium mark** (activity LED, §5.4.1) | A 72px cell at the far left, above the rail; glyph 42×16 | The capsule is the LED: idle (ink-3), working (live, breathing), waiting (attn, steady). Click → Home. Tooltip: `Circles act · Capsules happen · Squares last · Dashed = simulated`. |
| **Project crumb** | Starts 12px after the mark cell. Button 32px tall, radius 6. Contents: 16px square hue mark, name (`type-body-sm` 500, max 200px, truncated), ChevronDown 14 | Click or `P` → Project switcher (§3.9). Unscoped: a neutral 16px square outline with "All work". |
| **Workspace crumb** | After a 14px `ChevronRight` (ink-4). Contents: workspace icon 14 + label | Click → workspace menu: all workspaces under group labels, each with its chord. |
| **Command field** | Horizontally centered in the bar. Width `clamp(320px, 32vw, 560px)`, 32px tall, `--surface-raised`, 1px `--line-strong`, radius 6. Contents: `Search` 16 (ink-3), "Search or start…" (ink-3), `Kbd ⌘K` | Click or ⌘K → command center. At <1024 it collapses to a 32px icon button. |
| **Holding chip** | Right cluster (4px gap, 32px targets). Contents: `Layers` 16 + count; the label "Holding" appears at ≥1440 | Click → Holding popover (§3.9). The count is muted at 0. Drop target for entity chips. |
| **Needs-you button** | Right cluster. Contents: `Inbox` 16 + amber ◆ + count when needs-you > 0; a 6px ink-2 dot when there are only unread updates | Click or `!` → Needs you & Updates popover (§3.8). |
| **Provider chip** | Right cluster, 28px tall. The Simulator shows a hatched `SIM` tag + "Simulator" (label at ≥1440). A live default shows the model name (e.g. "Claude Sonnet 5.5") with a 6px ink-2 dot. A key error shows a fail dot + "Key error". | Click → model menu (§3.9). |
| **Avatar** | Far right, 28px circle with initials in the profile hue | Click → user menu (§3.9). |

### 3.3 Rail

- **Labeled form (≥1280, 72px wide).**
  - Item: a 64×52 button containing a 20px icon (stroke 1.5) above an 11px label (`type-micro`).
  - States:
    - idle: icon and label in ink-3
    - hover: `--surface-hover`, ink-2
    - active: `--surface-raised`, ink, with a 3×20px ink notch on the rail's left edge
    - focus-visible: inset 2px focus ring
  - Groups are separated by 12px of space plus a 24px-wide `--line` hairline.
- **Compact form (768–1279, 56px wide).** 40×40 items, icon only. Tooltips appear after 400ms and show the name and chord.
- **System items** (Insights, Integrations, Settings) sit at the bottom: 40×40, 18px icon, ink-3, icon-only in both forms. When the viewport is under 700px tall they fold into one `Settings2` "System" menu.
- **Badges** sit at the icon's top-right:
  - a 6px **live** dot when a run of that workspace's kind is running in scope
  - a 7px **attn** ◆ when something there needs you
  - Mapping: `chat`→Chat, `research`→Research, `code`→Code (plus sessions needing review), `studio`→Studio, `agent`→Agents, `workflow`→Workflows, tasks in Review → Projects.
- **Doorway flyout [P2].** Opens after 400ms hover, or on focus + →. It is a 296px popover at the rail's edge containing:
  - group eyebrow (`type-label`), name, the one-line description
  - `New … N`
  - the 5 most recent items in scope (from `recents`), each with a status glyph
  - ← or Esc closes it. There are no flyouts on touch devices.
- No expanded rail mode. The `[` key toggles the list pane, not the rail.

### 3.4 Workspace screen: list pane, stage, stage header

**List pane:**
- Width 280px (300px at ≥1920), resizable 240–360 by dragging its edge (4px hit area; double-click resets).
- `[` toggles it.
- Anatomy:
  - 48px header: title, mono count, "+ New" (`N`)
  - optional 32px search or filter field
  - optional `This project · All` segmented toggle
  - groups headed by `type-label`
  - rows 36px (one line) or 56px (two lines); 28 and 48px in compact density
- Selected row: `--accent-tint` background, ink text.

**Stage:**
- Fluid width, minimum 640px whenever the Inspector is docked.
- Reading columns are capped: chat 712px, documents `min(68ch, 720px)`, Home 1120px, Insights 1280px.

**Stage header (48px):**
- Contents, in order:
  - list-pane toggle (`PanelLeft`; shown when the pane is hidden or below 1024)
  - item title (`type-title-3`, editable inline where the item is renamable)
  - status chip
  - tabs (underline variant)
  - up to 3 actions plus ⋯ (rename, copy link, copy handle, archive/delete, export)
  - Inspector toggle (`PanelRight`)
- The top bar shows **Project › Workspace** only. The **item title lives in the stage header**, so the breadcrumb never repeats it.
- When width is short, tabs drop to a second 40px row.

**Docking rule** (implement it; it is not optional):
1. Dock the Inspector if the stage stays ≥640px.
2. If not, auto-collapse the list pane first.
3. If it still does not fit, the Inspector floats over the stage: `--shadow-e2`, no scrim at ≥1024.

### 3.5 Inspector

- Width 360px (420px at ≥1920), resizable 320–520. `]` or ⌘\ toggles it.
- 40px header: Tabs (underline, sm) **Run · Item · Context**, always present and always in this order, plus a close button.
- It opens **only** when you attach a run, select or inspect an item, open a context breakdown, or follow `?inspect=`. It never opens by itself for a background event.
- The selected tab and open state are remembered per workspace. The attached run is global.

| Tab | Content |
|---|---|
| **Run** | The attached run (or "No run attached" plus the 5 most recent runs). Header: glyph, title, handle, kind, project mark, owner. Meta row: elapsed · steps n/m · tokens · cost (`est.`) · `LIVE`/`SIM`. Step Tape scrubber. Compact RunTimeline. Outputs. **Receipt** (expanded Colophon, §5.4.6) with "Copy receipt (Markdown)" and a "Raw JSON" disclosure. Actions: Pause/Resume, Stop, Retry, Open in workspace, Open origin. |
| **Item** | The Lens panel for the selection, or for the stage's primary object when nothing is selected. Header: mark, kind label, title, handle, project, status. Kind-specific body. **Links** (Came from · Led to · Used by · Cited by, one hop, entity chips). **History** (activity events as sentences). Actions: Open (⌘⏎), Hold, Save to Knowledge, Turn into…, ⋯. **Peek:** clicking a chip inside the panel pushes onto `inspectStack`; `‹ Back` pops it. Browser Back pops `?inspect=`. |
| **Context** | The context chain for the current composer or selection. Project memory (goal, instructions, pinned items) with include toggles, Held, Attached, Likely and Retrieved items, each with a token estimate. The project's month-to-date spend against budget. The default autonomy. Edit links go to Projects › Memory. |

### 3.6 Run Line (28px, chrome, full width, `role="region"` `aria-label="Runs"`)

- **Pills start aligned with the workspace screen** (left padding = rail width + bezel). The totals sit at the right.
- **Run pill** (§5.4.3): 20px capsule. Visible count: 5 pills at ≥1440, 4 at 1280–1439, 3 at 768–1279. After that comes a `+N` pill → `/agents`.
- **Order:**
  1. waiting (needs you)
  2. failed and not yet opened
  3. running, current project first
  4. queued
  5. paused
- Interactions:
  - Hover for 300ms → **peek card** (320px, e1): current step and detail, last 3 steps, tape, and Attach · Open · Pause · Stop.
  - Click → attaches the run in Inspector › Run.
  - ⌘/Ctrl-click → opens the run in its workspace.
- **Finished:** the pill shows ✓ for 8s, then collapses (240ms) and moves to Home › Landed.
- **Failed:** the pill stays red with ✕ until its run is opened. Opening it marks the `run.failed` notification read.
- **Totals button** (right, `type-meta`, ink-3): `3 running · 1 needs you · $0.42 today` → `/agents`.
  - Spend shows **live** spend today.
  - With no live usage today it shows `est. $1.84 today` with a `SIM` tag.
  - Color comes from month-to-date live spend against `monthlyBudgetUsd`: ink-3 normally, `attn-ink` at ≥80%, `fail-ink` at ≥100%.
  - Simulated estimates count only when `countSimulatedSpend` is on.
- **Focus mode** shows a `Focus` tag at the far right.
- **Idle** shows `No runs in flight` (ink-4) and the totals.

### 3.7 Command center (⌘K)

- **Shape:**
  - Modal, 680px wide. At ≥1280 with a highlighted item it is 960px, with a 280px preview pane.
  - Top offset 12vh, max height 70vh, `--surface-overlay`, radius 14, `--shadow-e2`, `--scrim`.
  - Opens with `dialogMotion` at `--dur-3`.
- **Input row** (52px): a project prompt chip `Atlas Portal v2 ›` (mono 12, ink-3), then the input (16px sans).
  - The input switches to JetBrains Mono when the text starts with a prefix: `>` commands, `#` switch project, `@` find an item, `?` quick ask.
- **Empty query sections:**
  - Needs you (top 3)
  - Resume (5 recents)
  - Actions for this view (manifest commands)
  - Go to (workspaces with chords)
- **With a query:**
  - **Intent row first**, when the text reads like a request (≥3 words, or `detectIntent` confidence ≥0.5): `Run as Research ▾ · in Atlas Portal v2 · mentions competitors, sources`.
    - `⇥` cycles the verbs **Ask · Research · Build · Delegate · Create · Automate · Organize** (the `Intent` type in `intent.ts`).
    - `⏎` starts it attached: Ask sends into a new thread; Research, Build and Delegate open the Start sheet; Create creates a Studio draft; Automate opens a workflow draft; Organize opens the Start sheet as a Task.
    - `⌘⏎` does the same in the background (§8.1).
  - Then grouped results (36px rows: kind mark, title, path such as `Atlas Portal v2 › Code`, mono handle):
    - Actions
    - Workspaces
    - Items (entities)
    - Knowledge (full-text snippet with highlights)
    - Settings (e.g. `> theme light`)
  - A typed handle (`RUN-K3J9`) ranks first.
- **`?` quick ask:** the answer streams inline below the input with its Colophon. A second `⏎` → "Continue in Chat" (a new thread containing the Q&A).
- **Footer** (32px, `type-meta`): `⏎ open/run · ⌘⏎ background · ⇥ verb · # project · > command · @ item · ? ask · esc`.

### 3.8 Needs you & Updates, toasts, tab presence

**Needs-you popover:**
- 420px, max height 70vh, anchored to the button.
- Tabs: **Needs you (n)** and **Updates (m)**.
- **Needs you** contains:
  1. pending approvals, sorted by risk (high → low) then oldest first, as compact ApprovalCards
  2. code sessions with `needs_review`
  3. tasks in `review` whose last run was by an agent, except tasks already represented by a session in (2)
  - Footer: `Approve all low-risk (3)`, which opens a confirm listing every item.
  - Empty: "Nothing needs you."
- **Updates** contains notifications other than `approval.requested`:
  - Rows: tone glyph, a sentence with entity chips, mono time, unread dot.
  - Footer: "Mark all read".
  - Empty: "You're up to date."
- On phones it is a full-screen sheet.
- The badge count is (1) + (2) + (3).

**Toasts:**
- Bottom-right, 16px above the Run Line and 16px from the right edge. 360px wide, at most 3, newest at the bottom.
- **Approvals:** 2px attn left edge, ◆, sentence, `[Review]`. They persist until handled or dismissed, and they never toast in Focus mode (the badge still updates).
- **Updates:** dismiss after 6s. **Undo toasts:** 8s. Toasts pause on hover or focus. Esc dismisses the focused toast.
- `aria-live="polite"`.

**Tab presence:**
- `document.title` = `(n) {Item} — {Workspace} · Atrium`, where `(n)` is the needs-you count and is shown only when it is > 0.
- The favicon swaps between idle, working and waiting SVGs (§5.4.1).
- [P2] Browser notifications for approvals while the tab is hidden, when `notifications.browser` is on.

### 3.9 Project switcher, Holding popover, provider menu, user menu

- **Project switcher** (420px popover):
  - Search field (autofocused, "Switch project…")
  - "All work"
  - Starred projects, then active ones. 40px rows: hue mark, name, `● 2` running, `◆ 1` waiting, mono last activity.
  - "New project"
  - Footer: `⏎ switch · ⌘⏎ switch and open`
- **Holding popover** (360px):
  - Held items as chip rows, each with its token estimate and ×
  - Total `~2.4k tok`, "Release all"
  - Help line: "Held items ride along in every new AI action. Switch them off per action in the composer."
- **Provider menu** (320px):
  - Default model radio list, grouped:
    - Simulator: `Simulator · Swift`, `Simulator · Deep`, each tagged `SIM`
    - Anthropic models: disabled with "Add key" when no key is set
    - OpenAI-compatible: configured models
  - "Connect a model…" → `/integrations/anthropic`
  - Note: "Simulator answers are generated locally. No model is called."
- **User menu** (240px):
  - Header: name, "Stored on this device"
  - Theme ▸ Dark · Light · System
  - Density ▸ Comfortable · Compact
  - Motion ▸ System · Reduce · Full
  - Focus mode (switch)
  - Keyboard shortcuts `?`
  - What's real in this build
  - Settings `G ,`
  - Export data

### 3.10 Start sheet and confirm dialogs

- **Start sheet:** a 480px right sheet with a `--scrim` (full screen <768). It is the one surface for starting delegated work and for every Turn into. Anatomy is in §5.4.11.
- **Confirm dialog** (`confirm()`): 440px, centered, radius 14, `--shadow-e2`.
  - Title (`type-title-3`), one-paragraph body (ink-2), optional typed-confirmation input.
  - Buttons on the right: **Cancel** (secondary, default focus for destructive actions), then the action (`danger-solid` for destructive).
  - ⏎ confirms only when the typed text matches. Esc cancels.
  - Typed confirmation is required for: reset demo data (`reset`), erase everything (`erase`), deleting a project with its contents (the project name).
  - Single-item deletes use a plain confirm (when `confirmDestructive` is on). Archive, remove and release use Undo toasts instead.

### 3.11 Keyboard map

⌘ means Ctrl on Windows and Linux. Shortcuts match on `event.key`.

**Global (work inside text fields too):**

| Keys | Action |
|---|---|
| ⌘K | Open or close the command center |
| ⌘. | Stop the current run: the streaming reply in view, otherwise the attached run |
| ⌘⏎ | In navigating composers and sheets (Home, ⌘K, Start sheet, agent assign): **start in the background**. In in-place composers: send. |
| ⌘\ | Toggle the Inspector |
| ⌘/ | Shortcut sheet |
| Esc | Close the top layer → leave the field → clear the selection |
| F6 / ⇧F6 | Next / previous region: top bar → rail → list pane → stage → Inspector → Run Line |

**Single keys** (outside editable fields only; can be turned off in Settings › Keyboard; on by default):

| Keys | Action |
|---|---|
| `G` then `H C R X S A W P K I N ,` | Go to Home, Chat, Research, Code, Studio, Agents, Workflows, Projects, Knowledge, Insights, Integrations, Settings |
| `/` | Focus the composer (or the search field where there is no composer) |
| `N` | New item in this workspace (`manifest.newAction`) |
| `P` | Project switcher |
| `!` | Needs you |
| `[` / `]` | Toggle the list pane / Inspector |
| `J` `K` or `↓` `↑` | Move through lists. `⏎` opens, `Space` inspects (Inspector › Item), `X` selects |
| `T` | Turn into… |
| `H` | Hold / release |
| `S` | Save to Knowledge |
| `F` | Fork from here (messages) |
| `E` | Edit |
| `.` | More actions menu |
| `?` | Shortcut sheet |

**Contextual keys:**
- **Focused ApprovalCard:** `Y` approves once (HIGH risk: `Y` again within 3s), `D` denies (focuses the reason field), `E` edits the payload.
- **Code › Changes:** `J`/`K` next/previous file, `A` accept file, `R` reject file, `U` clear decision, `V` unified/split.
- **Workflows canvas:** `N` add node, `Delete`/`Backspace` removes the selected node (Undo toast), arrows nudge 8px (32px with ⇧), `⇧1` fits the view.
- **Studio asset:** `←`/`→` switches versions, `1`–`4` picks a take.
- **Command center:** `↑↓`, `⏎`, `⌘⏎`, `⇥`, Esc.

**Never bind:**
- ⌘T, ⌘W, ⌘N, ⌘R, ⌘L, ⌘D, ⌘O, ⌘S, ⌘J, ⌘F
- ⌘1–9, Alt+1–9
- ⌘⇧ with C, I, J, N, P, T or B
- F5, F11, F12

A single key never performs an irreversible action.

### 3.12 Responsive behavior

| Range | Shell |
|---|---|
| **Phone, <768** | Top bar 48 + live strip 32 (only while something is running or waiting) + single-pane push navigation + bottom tab bar 56 plus safe area. No rail, no Run Line. The Inspector is a bottom sheet snapping at 50% and 92%. Every popover becomes a full-screen sheet. |
| **Tablet, 768–1023** | Top bar 48 (command field becomes an icon). Rail 56 icon-only. No bezel. The list pane is an overlay drawer (300px, 16% scrim). The Inspector is an overlay sheet (380px, 16% scrim). Run Line 28 with 3 pills. |
| **Laptop, 1024–1279** | Rail 56. Bezel 6. List pane docked at 280. The Inspector floats without a scrim. 3 pills. |
| **Desktop, 1280–1439** | Rail 72 labeled. Docking rule (§3.4). 4 pills. |
| **Large, 1440–1919** | As desktop. The Inspector docks with the list pane. 5 pills. |
| **Wide, ≥1920** | List pane 300, Inspector 420. Split stages in Code and Research. Reading columns stay capped. Extra width goes to panes, never to longer lines. |

**Phone details:**
- **Top bar**, left to right:
  - mark (LED)
  - project chip: square mark + name up to 14 characters; mark only under 400px
  - workspace title ▾ (opens the workspace sheet)
  - spacer, ◆ needs-you count, avatar
- **Live strip:** shows the single most urgent item: `◆ Forge needs approval · Review` takes precedence over `● Researching EU suppliers · 3/7`, plus `+2`.
  - Tapping opens the approval sheet when waiting, otherwise `/agents`.
  - It hides on scroll down and returns on scroll up. It never hides while something is waiting.
- **Bottom bar:** Home · Chat · **Start** (48×40 ink-inverted rounded rectangle, opens a full-screen command center) · Runs (`/agents`; live count, amber ◆ when needs-you > 0) · More (a sheet with every workspace under its group label, live badges, then System).
- **Composer:** docked above the keyboard using `visualViewport`; the bottom bar hides while typing. The Context Line collapses to one chip, `Context · 4`, which opens a sheet with toggles. Send is a split button `Run | ▾`.
- **ApprovalCards:** full-screen sheet with the preview first and a sticky footer of 48px buttons: Deny | Approve (HIGH risk: Approve → Confirm).
- **Touch:**
  - Targets are ≥44px (`pointer: coarse`).
  - Hover actions become a ⋯ button and a long-press menu.
  - Every drag has a menu equivalent.
  - Keyboard hints are hidden.
  - Provenance labels are always visible.

---

## 4. Design tokens

Values are themed. The **names are the contract**. Only the values listed below change from the current `src/styles/tokens.css`. Components use only these tokens, through the Tailwind theme in `src/index.css`.

### 4.1 Color: dark (default)

```css
:root, :root[data-theme='dark'] {
  color-scheme: dark;
  /* Surfaces (back → front) */
  --surface-chrome: #0c0c0b;   --surface-canvas: #121211;  --surface-sunken: #0e0e0d;
  --surface-raised: #181817;   --surface-overlay: #1e1e1c; --surface-hover: #1f1f1d;
  --surface-press: #282825;
  /* Lines */
  --line: #262624;             /* hairlines, dividers (decorative) */
  --line-strong: #363632;      /* card/chip borders */
  --line-input: #6f6c64;       /* NEW: input/control boundaries, SIM dashes (≥3:1) */
  /* Ink */
  --ink: #edebe5;  --ink-2: #b4b1a7;  --ink-3: #959289; /* CHANGED from #8b887f */  --ink-4: #5b5953;
  --inverse: #edebe5;  --inverse-ink: #121211;
  /* Accent = ink (interactive emphasis: selected tabs, checkboxes, links). No hue. */
  --accent: #edebe5;  --accent-ink: #edebe5;  --accent-tint: #282825;   /* CHANGED */
  /* Signals */
  --live: #8fb1e6;  --live-ink: #a8c3ee;  --live-tint: #18222f;  --live-glow: rgb(143 177 230 / 0.35);  --live-on: #0c0c0b;
  --attn: #e2ad45;  --attn-ink: #ebbd5e;  --attn-tint: #2d2410;
  --done: #73c4a3;  --done-ink: #8cd2b5;  --done-tint: #13261e;
  --fail: #f07a60;  --fail-ink: #f59580;  --fail-tint: #351812;  --fail-on: #121211;
  --info: #b4b1a7;  --info-tint: #1f1f1d;            /* NEW: info is neutral by design */
  --sim-hatch: #5b5953; /* CHANGED */  --sim-tint: #1b1b19;  --sim-ink: #b4b1a7;
  /* Identity hues (unchanged) */
  --hue-volt: #c8dc6e; --hue-sky: #8dbaf2; --hue-violet: #b3a2f0; --hue-coral: #efa08c;
  --hue-amber: #d9b77a; --hue-mint: #86d9b9; --hue-rose: #eba2c0; --hue-cyan: #7fcbdb;
  /* Diff (unchanged) */
  --diff-add-bg: #13261a; --diff-add-ink: #9fe8b2; --diff-add-mark: #2c6b3f;
  --diff-del-bg: #2b1715; --diff-del-ink: #ff9e94; --diff-del-mark: #7a2e26;
  /* Misc */
  --selection: rgb(237 235 229 / 0.16);  /* CHANGED: neutral */
  --scrim: rgb(4 4 3 / 0.5);             /* CHANGED */
  --focus-ring: #edebe5;                 /* CHANGED: ink, never the live color */
  --highlight: rgb(237 235 229 / 0.18);  /* CHANGED: neutral search-match wash */
  /* shadows and syntax colors: unchanged */
}
```

### 4.2 Color: light

```css
:root[data-theme='light'] {
  color-scheme: light;
  --surface-chrome: #ecebe6;   --surface-canvas: #f7f6f2;  --surface-sunken: #efede7;
  --surface-raised: #fdfdfb;   --surface-overlay: #ffffff; --surface-hover: #efeee9;
  --surface-press: #e5e3dc;
  --line: #e2e0d8;  --line-strong: #cfccc2;  --line-input: #857f74;      /* NEW */
  --ink: #1c1b18;  --ink-2: #55524a;  --ink-3: #65615a; /* CHANGED from #6e6a60 */  --ink-4: #a39f94;
  --inverse: #1c1b18;  --inverse-ink: #f7f6f2;
  --accent: #1c1b18;  --accent-ink: #1c1b18;  --accent-tint: #e5e3dc;    /* CHANGED */
  --live: #2d5b9a;  --live-ink: #2d5b9a;  --live-tint: #e3eaf4;  --live-glow: rgb(45 91 154 / 0.25);  --live-on: #ffffff;
  --attn: #a56d00; /* CHANGED from #c98a10 (was 2.7:1) */  --attn-ink: #8c5e00;  --attn-tint: #f7ebc6;
  --done: #2a7259;  --done-ink: #2a7259;  --done-tint: #e2efe8;
  --fail: #c23b22;  --fail-ink: #b8361e;  --fail-tint: #f8e4de;  --fail-on: #ffffff;
  --info: #55524a;  --info-tint: #efeee9;
  --sim-hatch: #aaa496; /* CHANGED */  --sim-tint: #f0ede6;  --sim-ink: #55524a;
  --hue-volt: #56620f; --hue-sky: #275a9c; --hue-violet: #5844a8; --hue-coral: #a3412b;
  --hue-amber: #76561a; --hue-mint: #1c6e52; --hue-rose: #973a62; --hue-cyan: #1a6a7c;
  --diff-add-bg: #e3f4e8; --diff-add-ink: #1b6b3a; --diff-add-mark: #b5dfc2;
  --diff-del-bg: #fbe6e2; --diff-del-ink: #a3291a; --diff-del-mark: #f0bdb4;
  --selection: rgb(28 27 24 / 0.12);  --scrim: rgb(28 27 24 / 0.24);
  --focus-ring: #1c1b18;  --highlight: rgb(28 27 24 / 0.10);
}
```

### 4.3 Color roles and contrast verification

**Roles:**

| Role | Token | Meaning |
|---|---|---|
| **live** (signal) | `--live*` | AI is working right now. Running glyphs and tape cells, the progress bead, active workflow nodes and edges, the working state of the mark. |
| **attention** | `--attn*` | Waiting on a human. ◆ glyphs, the needs-you badge, approval edges and tint, waiting tape cells, budget and context ≥80%, the approval-wait histogram. |
| **success** | `--done*` | Succeeded. ✓ glyphs, passed checks, done task squares, the approval stamp glyph. |
| **danger** | `--fail*` | Failed or destructive. ✕ glyphs, failed cells and pills, error text, destructive buttons, budget ≥100%. |
| **info** | `--info*` | Neutral by design. Informational messages carry no hue. |
| **accent** | `--accent*` | = ink. Selection, checked controls and links. Primary buttons are ink-inverted (`--inverse`). |
| **focus** | `--focus-ring` | 2px ink outline, 2px offset (inset −2px inside dense lists). Never the live color. |
| **sim** | `--sim-*` | Simulated. The hatch (`.sim-hatch`) plus a `SIM` tag. Dashed outlines use `--line-input`. |

Mapping from the existing `Tone` type: `success→done`, `warning→attn`, `danger→fail`, `info→neutral`, `accent→ink`.

Rules:
- **No text on solid `--attn`** (white on light attn measures 4.39:1). Attention badges use `--attn-tint` with `--attn-ink`.
- Solid fills behind text are allowed only for: the primary button (`--inverse`), the danger-solid button (`--fail` + `--fail-on`), and `--live-on` on live fills.

**Computed WCAG 2.x ratios** (text needs ≥4.5:1, non-text marks ≥3:1):

| Pair | Dark | Light |
|---|---|---|
| ink on canvas / raised / overlay / press | 15.72 / 14.90 / 14.01 / 12.40 | 15.93 / 16.91 / 17.22 / 13.41 |
| ink-2 on canvas / press | 8.74 / 6.89 | 7.21 / 6.07 |
| **ink-3** on canvas / chrome / overlay / hover / press (lowest of all surfaces) | 6.03 / 6.29 / 5.37 / 5.31 / **4.75** | 5.69 / 5.16 / 6.16 / 5.30 / **4.79** |
| live-ink / attn-ink / done-ink / fail-ink on canvas | 10.45 / 10.69 / 10.71 / 8.47 | 6.32 / 5.23 / 5.32 / 5.42 |
| same, on chrome (lowest surface) | ≥8.85 | 5.72 / 4.73 / 4.82 / 4.91 |
| signal-ink on its own tint (live / attn / done / fail) | 8.94 / 8.73 / 9.07 / 7.35 | 5.64 / 4.75 / 4.86 / 4.78 |
| ink-3 on live / attn / done / fail tints | 5.16 / 4.92 / 5.10 / 5.23 | 5.08 / 5.18 / 5.20 / 5.03 |
| signal marks on canvas (live / attn / done / fail) | 8.57 / 9.19 / 9.06 / 6.84 | 6.32 / 4.06 / 5.32 / 4.93 |
| attn mark on press (lowest) | 7.0+ | 3.42 |
| `--line-input` on canvas / raised / overlay | 3.57 / 3.39 / 3.18 | 3.67 / 3.90 / 3.97 |
| inverse-ink on inverse (primary button) | 15.72 | 15.93 |
| fail-on on fail (danger-solid) | 6.84 | 5.33 |
| live-on on live | 8.95 | 6.83 |
| sim-ink on sim-tint | 8.04 | 6.67 |
| focus ring (ink) on overlay / chrome | 14.0 | 14.4 |

`--ink-4` is used only for disabled text, ruler marks and the hatch. It is never used for readable content.

### 4.4 Identity hues (agents, projects, collections, workflows, integrations, chart series)

| Hue | Dark | Light | As text, worst surface (dark / light) | On own 15% tint (dark / light) |
|---|---|---|---|---|
| volt | `#c8dc6e` | `#56620f` | 11.07 / 5.59 | 8.96 / 4.99 |
| sky | `#8dbaf2` | `#275a9c` | 8.30 / 5.81 | 7.11 / 5.15 |
| violet | `#b3a2f0` | `#5844a8` | 7.43 / 6.27 | 6.45 / 5.49 |
| coral | `#efa08c` | `#a3412b` | 8.01 / 5.25 | 6.92 / 4.65 |
| amber | `#d9b77a` | `#76561a` | 8.75 / 5.65 | 7.37 / 5.03 |
| mint | `#86d9b9` | `#1c6e52` | 10.05 / 5.17 | 8.27 / 4.63 |
| rose | `#eba2c0` | `#973a62` | 8.32 / 5.68 | 7.07 / 5.01 |
| cyan | `#7fcbdb` | `#1a6a7c` | 9.12 / 5.18 | 7.65 / 4.62 |

Rules:
- Identity is drawn **only** as an entity mark (§5.2) or as a 2–3px hue rule or band. State is drawn **only** as a glyph (§5.3). This is mandatory because sky ≈ live, mint and volt ≈ done, amber ≈ attn, and coral ≈ fail.
- Tints are 15% alpha (the existing `HUE_SUBTLE`).
- New projects and agents are offered every hue except `volt`, which defaults to the user's profile.

### 4.5 Data-visualization colors

- **Categorical series:** `SERIES_HUES` in `src/ui/charts/palette.ts`, in its validated order (rose, volt, sky, coral, cyan, amber, violet, mint), with at most 8 series. A 9th series folds into "Other" (`--ink-4`). Series never cycle.
- **Single series:** `--ink-2`, `--ink` on hover.
- **Outcomes:** succeeded `--ink-3`, failed `--fail`, cancelled `--ink-4`. The legend always shows the glyphs. Never mix categorical hues with state colors in one chart.
- **Simulated data:** the `.sim-hatch` fill and a `SIM` entry in the legend.
- **Budget limit line:** 1px `--attn`.
- **Sequential ramp:** `rampColor()` mixes `--accent` (= ink) with the surface, giving a monochrome ramp.
- The only amber chart is the approval-wait histogram.
- Every chart has direct labels, mono tooltips and "View as table". Donut charts are allowed only for a single part-to-whole with 2–4 parts, with direct labels.

### 4.6 Typography

**Fonts** (self-hosted with @fontsource, already installed):
- **Instrument Sans Variable:** interface. Change the import in `index.css` from `instrument-sans/index.css` to **`@fontsource-variable/instrument-sans/wdth.css`**. This gives weight 400–700 and width 75–100%.
- **JetBrains Mono Variable:** system voice. Used for ids and handles, numbers that change, costs and tokens, time, code, diffs, terminal, read-backs, receipts and keycaps.
- **Newsreader Variable** (`opsz.css` + `opsz-italic.css`): document voice. Used for the Home state sentence, reports, knowledge documents, Studio docs and slides.
- **Instrument Serif is not used.** Do not import it.
- Fonts load on first use (`font-display: swap`).

**Type roles** (define each as a Tailwind v4 `@utility type-<role>`):

| Role | Family | Size / line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| `display` | doc | 36/44 (≥768); 24/32 (<768) | 400, opsz auto | −0.01em | Home state sentence, boot headline |
| `title-1` | ui | 24/32 | 600 | −0.01em | Page titles (project, agent, settings section) |
| `title-2` | ui | 20/28 | 600 | −0.005em | Dialog and empty-state titles, empty-thread prompt |
| `title-3` | ui | 17/26 | 600 | 0 | Stage header titles, card titles |
| `body-lg` | ui | 15/24 | 400 | 0 | Chat transcript, composer input |
| `body` | ui | 14/20 | 400 | 0 | Default (13/18 in compact density) |
| `body-sm` | ui | 13/18 | 450 | 0 | List rows, breadcrumb, table cells |
| `caption` | ui | 12/16 | 400 (500 in chips) | 0 | Secondary text, chips |
| `micro` | ui | 11/14 | 500 | 0 | Rail labels |
| `label` | ui | 11/14 | 600, `font-stretch: 87.5%` | +0.08em, UPPERCASE | Kickers, band headers, section labels |
| `meta` | mono | 11/14 | 400 | +0.02em | Handles, timestamps, counts, costs, Colophon |
| `meta-caps` | mono | 11/14 | 500 | +0.06em, UPPERCASE | `SIM`/`LIVE` tags, Home status line, band totals |
| `mono-sm` | mono | 12/18 | 400 | 0 | Read-backs, receipts, numeric table cells |
| `mono` | mono | 13/20 | 400 | 0 | Code, diffs, terminal, markdown source |
| `figure` | mono | 28/32 | 500 | −0.02em | KPI numbers |
| `doc-h1` | doc | 30/36 | 500 | −0.01em | Report and document titles |
| `doc-h2` | doc | 24/32 | 500 | 0 | |
| `doc-h3` | doc | 20/28 | 600 | 0 | |
| `doc` | doc | 18/30 (≥768); 17/28 (<768) | 400 | 0 | Document body; measure `min(68ch, 720px)`; old-style figures; true quotes and dashes |

Additional rules:
- UI numbers use `.tabular`.
- Sentence case everywhere except `label` and `meta-caps`.

### 4.7 Spacing, sizing, density

- **Spacing:** Tailwind's 4px multiplier. Allowed steps: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96 px. Gutters: 24px desktop, 16px phone.
- **Controls:** buttons and inputs follow the existing `Button`/`IconButton` sizes: xs 24, sm 28, **md 32 (default)**, lg 40. Touch targets are ≥44 through the existing `pointer-coarse:after` inset.
- **Density** is set by `html[data-density]`:

| Density | `--row-h` | `--row-h-2` | `--control-h` | Base text |
|---|---|---|---|---|
| comfortable (default) | 36px | 56px | 32px | 14px |
| compact | 28px | 48px | 28px | 13px |

- **Chips:** EntityChip 22 (md) / 18 (sm). Tags and Kbd 18. `SIM`/`LIVE` tags 16.
- **Marks:** 16 · 20 · 24 · 32 · 48 · 64.
- **Shell tokens:**
  - `--topbar-h: 48px`, `--runline-h: 28px`
  - `--rail-w: 72px`, `--rail-w-compact: 56px` (remove `--rail-w-expanded`)
  - `--bezel: 6px`, `--list-w: 280px`, `--panel-w: 360px` (Inspector), `--stage-min: 640px`
  - `--composer-max: 40vh`

### 4.8 Radii

| Token | px | Use |
|---|---|---|
| `--radius-cell` (new) | 1 | Step Tape cells |
| `--radius-xs` | 3 | Tags, Kbd, `SIM`/`LIVE`, marks ≤20px |
| `--radius-sm` | 6 | Buttons, inputs, list rows, entity chips, menu items, marks 24–48px |
| `--radius-md` | 10 | Cards, panels, screens, the composer, workflow nodes, toasts |
| `--radius-lg` | 14 | Popovers ≥360px, the command center, the Start sheet, dialogs |
| `--radius-xl` | 20 | Top corners of phone bottom sheets |
| `rounded-full` | — | Reserved for **capsules** (run pills, needs-you and status chips), **actor circles** and status dots. Never on buttons, inputs or cards. The Switch track uses `--radius-sm`. |

### 4.9 Elevation and shadows

| Level | Surface | Shadow | Use |
|---|---|---|---|
| e0 | canvas, chrome | none | Screens, docked panels |
| e1 | overlay | `--shadow-e1` | Menus, popovers, hover cards, run peek cards, toasts, tooltips |
| e2 | overlay | `--shadow-e2` + `--scrim` when modal | Command center, Start sheet, dialogs, floating Inspector (no scrim at ≥1024), phone sheets |
| e3 | raised | `--shadow-e3` | Drag ghosts only |

Hover raises a surface by one step (canvas→hover). Press uses `--surface-press`. No blur or glass anywhere.

### 4.10 Z-index layers

`--z-sticky: 10` (new; sticky headers and review bars inside the stage) · `--z-rail: 30` · `--z-topbar: 40` (top bar, Run Line, phone bars) · `--z-panel: 50` (floating Inspector, list drawer) · `--z-overlay: 60` (modal scrim + command center, Start sheet, dialogs, phone sheets) · `--z-popover: 70` · `--z-toast: 80` · `--z-tooltip: 90`.

### 4.11 Motion

| Token | Value | Use |
|---|---|---|
| `--dur-1` | 120ms | Hover, press, color, toggles |
| `--dur-2` | 180ms | Popovers, menus, hover cards, row actions |
| `--dur-3` | 240ms | Panels, the Inspector, sheets, route content, the command center, highlighter wipe, pill enter and exit |
| `--dur-4` | 360ms | Dialogs |
| `--dur-breathe` (new) | 1600ms | Live glyph halo, mark capsule, running tape cell (opacity 0.55↔1, ease-in-out, infinite) |
| `--dur-develop` (new) | 600ms | Studio preview "develop" fade |
| `--ease-settle` | `cubic-bezier(0.22,1,0.36,1)` | Entrances |
| `--ease-standard` | `cubic-bezier(0.2,0,0,1)` | Moves and resizes |
| `--ease-exit` (new) | `cubic-bezier(0.4,0,1,1)` | Exits, at `--dur-1` or `--dur-2` |

The motion presets in `src/ui/primitives/motion.ts` remain the implementation. Reduced-motion behavior is in §8.2.

### 4.12 Breakpoints (override in `@theme`)

`--breakpoint-xs: 30rem` (480) · `--breakpoint-sm: 40rem` (640) · `--breakpoint-md: 48rem` (768) · `--breakpoint-lg: 64rem` (1024) · `--breakpoint-xl: 80rem` (1280) · `--breakpoint-2xl: 90rem` (1440, changed from 1536) · `--breakpoint-3xl: 120rem` (1920, new).

The layout ranges in §3.12 map to them: phone `<md`, tablet `md`, laptop `lg`, desktop `xl`, large `2xl`, wide `3xl`. Validate at 360 and 2560.

### 4.13 Tailwind `@theme` additions

```css
@theme {
  --breakpoint-2xl: 90rem;  --breakpoint-3xl: 120rem;
  --text-figure: 28px;  --text-figure--line-height: 32px;
  --text-doc: 18px;     --text-doc--line-height: 30px;
  --text-doc-sm: 17px;  --text-doc-sm--line-height: 28px;
  --radius-cell: 1px;
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}
@theme inline {
  --color-line-input: var(--line-input);
  --color-live-on: var(--live-on);  --color-fail-on: var(--fail-on);
  --color-info: var(--info);  --color-info-tint: var(--info-tint);
}
```

Add a `.sim-band` utility: a 4px-wide vertical strip of `.sim-hatch`.

---

## 5. Signature components and motifs

### 5.1 Motifs (the entire decoration budget)

1. **The mark's capsule:** the activity LED (idle, working, waiting), mirrored in the favicon and tab title.
2. **The thread:** a 1px spine joining the steps of every RunTimeline. A 4px live bead travels the active segment (1800ms). For simulated runs the spine becomes a 4px `.sim-band`.
3. **The Step Tape:** one cell per step, everywhere a run is referenced.
4. **Hatch and dash mean simulated.** Nothing else is hatched or dashed. Drop zones use a solid 1px ink outline with `--accent-tint`.
5. **Tick scales** on every meter: context, budget, task progress, milestones, credibility.
6. **Mono metadata:** handles, times and costs in `type-meta`, plus `label` kickers.
7. **The project-hue rule:** 2px under the top bar while scoped, and a 3px band on project cards and headers.

Never used: gradients, glows, glass or blur, robot or brain illustrations, sparkle or wand icons for AI, rivets, registration crosses, emoji.

### 5.2 Shape grammar (entity marks only)

| Shape | Means | Where |
|---|---|---|
| **Circle** | Actors | You (Avatar), agents (AgentMark with sigil), integrations (MonogramMark ring) |
| **Capsule** (`rounded-full`) | Happenings with a start and an end | Run pills, needs-you and running status chips, Lanes bars |
| **Rounded square** | Things that last | Projects, collections, workflows (MonogramMark square); threads, docs, tasks, sessions, assets, sources and repos (kind tile with icon) |
| **Dashed edge** | Simulated | Any of the above, plus nodes, chips and frames |

The grammar governs *entity marks*. Buttons, inputs and step markers are chrome and follow §4.8.

### 5.3 Status glyph alphabet

Glyphs are drawn in an 8px glyph inside a 12px box (SVG or CSS). The shape carries meaning without color.

**Runs** (`RunStatus` → glyph → user-facing word):

| Status | Glyph | Word |
|---|---|---|
| `queued` | ○ 1.5px ring, ink-3 | Queued |
| `running` | ● live, with a `--dur-breathe` halo in `--live-glow` | Running |
| `waiting` | ◆ attn | Needs you |
| `paused` | ‖ ink-2 | Paused |
| `succeeded` | ✓ done | Done |
| `failed` | ✕ fail | Failed |
| `cancelled` | ⊘ ink-3 | Stopped |

**Steps** (`StepStatus`): pending ○ · running ● · waiting ◆ · done ✓ (ink-3 inside timelines, so it recedes) · failed ✕ · skipped – (ink-4).

**Tasks** (squares, 10px):
- backlog: hollow square, ink-4
- to do: hollow square, ink-3, 1.5px
- in progress: lower half filled ink-2; live fill while a run for the task is running
- review: hollow square with a center dot; attn when agent work awaits you, otherwise ink-2
- done: filled square, done color
- cancelled: hollow square with a diagonal slash, ink-4

**Priority:** three ascending bars, filled 0–3 for none/low/medium/high. Urgent is 3 bars in ink at weight 700 plus `!`. Priority is never colored.

The legend appears in the `?` sheet and in Insights.

### 5.4 Signature components

Contract stubs already exist in `src/ui/signature/stubs.tsx`. Keep every prop, extend where noted, and add the new components.

**5.4.1 AtriumMark (new).**
- SVG with viewBox `0 0 42 16`:
  - circle `cx=5 cy=8 r=5` (ink-2)
  - capsule `x=13 y=3 w=16 h=10 rx=5`
  - square `x=32 y=3 w=10 h=10 rx=2.5` (ink-2)
- Capsule states:
  - idle: ink-3
  - working (any run `running`): `--live`, breathing
  - waiting (any pending approval): `--attn`, steady. Waiting takes precedence over working.
- Sizes: 42×16 (top bar), 63×24 (boot, About).
- **Favicon** (32×32): a radius-7 rounded square in `#121211` with a centered 18×10 capsule in `#959289` (idle), `#8fb1e6` (working) or `#e2ad45` (waiting). Three static SVG data URLs, swapped on change.

**5.4.2 StepTape (new).**
- Cells:
  - 6×12px (inline and pills), 8×16px (Inspector scrubber), 4×10px (inside run pills)
  - 2px gaps (1.5px inside pills), `--radius-cell`
- Cell states:
  - pending: 1px `--line-input` outline
  - running: `--live` fill, breathing
  - done: `--ink-3` fill
  - waiting: `--attn` fill, 4px taller
  - failed: `--fail` fill
  - skipped: `--line-strong` outline with a diagonal slash
  - a step with `fileChanges` or `refs` output: double width
- An end cap follows terminal runs, 4px after the last cell: ✓, ✕ or ⊘.
- Simulated runs get a 1px dashed `--line-input` baseline under the cells.
- Cell count is `max(steps.length, run.plannedSteps ?? 0)`. If the total is unknown while running, one pending "next" cell is added.
- Overflow: finished cells compress into a leading mono `+n`.
- Accessibility: `role="img"`, label `Step 4 of 7: Reading sources, running`. In the Inspector it becomes `role="slider"`; ←/→ moves focus through the timeline steps.
- Used in: run pills, RunRows, Home In flight, task rows and cards, agent cards, Agents › Runs, workflow list strips (outcome cells only), the Inspector, Studio generating tiles.

**5.4.3 RunPill and RunRow (new).**
- **RunPill** (Run Line):
  - 20px tall capsule, 1px `--line-strong`, padding 0 8px, gap 6px.
  - Contents: StatusGlyph · AgentMark 14 (if agent-owned) · title (12px 500, max 160px) · mini tape (≤12 cells) · `meta` text "3/7 · 01:24".
  - Waiting: 1px `--attn` outline and "wants approval".
  - Failed: ✕ until opened.
  - Other project: 60% opacity plus a 12px project mark.
  - Enter: 240ms scale 0.96→1 and fade. Exit: 240ms collapse.
- **RunRow** (lists):
  - Height `--row-h`.
  - Contents: glyph · title (500) and handle (`meta`) · kind (icon + word) · owner mark · project mark · tape · current step (ink-3, truncated) for active runs or the summary for finished ones · elapsed · tokens · cost (`est.` when estimated) · `LIVE`/`SIM`.
  - Hover actions: Attach · Pause/Resume · Stop · Retry · Open.
  - Columns hide right to left as width shrinks.

**5.4.4 RunTimeline (stub; final).**
- Left spine: 1px `--line-strong`; a 4px `.sim-band` when `run.simulated`; the live bead on the active segment.
- Step marker: a 20px rounded square (radius 6) with a 12px step-kind icon. Its border follows the step status color (pending `--line`, running `--live`, waiting `--attn`, failed `--fail`, done `--line-strong`).
- Step icons: plan `Route` · think `Lightbulb` · search `Search` · read `BookOpen` · browse `Globe` · write `PenLine` · edit `FileDiff` · command `SquareTerminal` · test `FlaskConical` · tool `Wrench` · message `Send` · approval `Hand` · artifact `Package` · handoff `ArrowRightLeft` · wait `Hourglass` · generate `Palette`.
- Step row:
  - Title in 13/18, weight 500. Running titles use present participles in `--live-ink` ("Reading 4 sources"); done titles use the past tense ("Read 4 sources").
  - Right side: tool chip with `LIVE`/`SIM`, duration, tokens.
  - Detail (ink-2).
  - Expandable input/output using `CodeBlock`/`Terminal`. Simulated tools render in a `.sim-hatch` frame headed **"Simulated terminal — nothing was executed"** (or "Simulated web result").
  - `refs` as entity chips, `fileChanges` as a DiffStat, approval steps as an inline full ApprovalCard.
- Consecutive read or search steps collapse into one group ("Read 6 files").
- Variants: `full` (stage) and `compact` (Inspector: outputs collapsed, 6px tighter padding).

**5.4.5 Honesty kit.**
- **SimBadge:**
  - `xs`: 16px tag reading `SIM`, `meta-caps`, `.sim-hatch` background, 1px dashed `--line-input`.
  - `sm`: 20px "Simulated".
  - Tooltip and accessible name: "Simulated: produced by Atrium's local simulator. No model, web service or integration was called."
- **LiveBadge:** a `LIVE` tag with a 1px solid `--line-input` border and ink-2 text. Shown only where live and simulated work mix: tool chips, integration cards, source origin tags, repo chips.
- Simulated outlines: 1px dashed `--line-input`. Simulated media and terminal frames: `.sim-hatch`. Simulated transcript spine: `.sim-band`.

**5.4.6 Colophon (`ProvenanceLine`) and Receipt.**
- One line in `type-meta`, ink-3, under every AI output (chat turns, run summaries, LandedCards, reports, Studio versions):
  - **Live:** `Claude Sonnet 5.5 · 1,204 tok · $0.004 · 3.1 s · View run`
  - **Simulated:** `[SIM] Simulator · Deep · No model was called · ~980 tok est. · $0.00 · 1.8 s · View run`
  - **Mixed tools** append: `· tools: GitHub read LIVE, Web search SIM`
  - **Stopped:** the line ends with `· Stopped by you`
- **Receipt** (Inspector › Run, expanded): model and provider (`LIVE`/`SIM`); tools used, each `LIVE`/`SIM`; capabilities used with their decisions ("Run commands · approved by you 10:42"); tokens in and out; cost (actual, or `est.` at reference pricing); duration; **Saw** (every entity read, with token share); outputs; "Copy receipt (Markdown)"; "Raw JSON".

**5.4.7 Identity marks.**
- **AgentMark:** always a circle (the `shape` prop stays for compatibility; `square` is unused).
  - Fill: 15% hue tint. Ring: 1px hue at 45%.
  - A deterministic sigil from `Agent.sigil`: 3–5 radial strokes, arcs and dots, 1.5px, in the hue.
  - `live` adds a 6px running-glyph badge at the bottom-right with a 2px surface ring. Paused adds ‖.
- **MonogramMark:**
  - *Square* variant (projects, collections, workflows): radius 25% of size, 15% hue fill, letters at 600 weight in the hue, at 55% of the size.
  - *Ring* variant (integrations): a circle with a 1px hue ring (dashed when `support: 'simulated'`), monogram in the hue, transparent fill. No third-party logos.
- **Avatar** (user): circle with initials on the profile hue tint.

**5.4.8 EntityChip, HoverCard, Lens.**
- **EntityChip:**
  - 22px (md) or 18px (sm), radius 6, 1px `--line-strong`.
  - Leading 14px mark (12px in sm): AgentMark, square monogram, kind tile, or a run's capsule glyph.
  - Title 12/16 500, max 220px, truncated. Optional trailing `SIM` tag. Optional ×.
  - Interactions:
    - hover 400ms → HoverCard
    - click, ⏎ or Space → Inspector › Item (`?inspect=`)
    - ⌘-click → navigate to the entity
    - drag (desktop) → drop targets
- **HoverCard** (320px, e1): mark, kind label, title, handle, project, status, updated, a 3-line excerpt; Open · Hold · Inspect.
- **Lens:** one renderer per kind at three densities: *chip* (EntityChip), *card* (HoverCard and ⌘K preview), *panel* (Inspector › Item). The panel adds Links and History automatically. Kinds without a renderer use the generic panel from `resolveEntity`.

**5.4.9 ApprovalCard (stub; final).**
- Anatomy, top to bottom:
  1. Top row: risk chip `LOW`/`MED`/`HIGH` (`meta-caps`; HIGH uses `--fail-ink`), capability label ("Run commands"), `LIVE`/`SIM`, age ("waiting 4m").
  2. **Headline:** the engine-written sentence `Approval.title`, e.g. "Forge wants to run the test suite in atlas-portal".
  3. **Why asked:** `Approval.reason` in ink-2, e.g. "Forge works in balanced mode and asks before medium-risk actions".
  4. **Exact preview:**
     - command: a mono block `$ npm test`
     - diff: a mini DiffView of the first 12 lines with "Show all"
     - message: a quote with its destination label `#launch · Slack (simulated)`
     - text: a quote
  5. Requester row: AgentMark, name, run handle, run title link.
  6. Actions:
     - **Approve ▾** (primary). The menu has *Approve once* (default) and *Always allow {agent} to {capability}*, which writes a `CapabilityGrant` with mode `allow`. That option is hidden, with a note, when the capability is in Settings › always-ask.
     - **Deny** reveals a one-line optional reason, which is sent back to the run.
     - **Edit** (message, command and text previews only) edits the payload, then approves.
     - **Later** (or Esc in a popover) leaves the request pending.
- Styling: 2px `--attn` left edge on `--attn-tint` while pending.
- **HIGH risk:** Approve turns into "Confirm approve" for 3s (or press `Y` again).
- Resolution: a 240ms left-to-right **highlighter wipe** removes the tint, then a stamp appears: "✓ Approved by you · 10:42" or "✕ Denied · {reason}" in ink-2.
- Variants:
  - `compact` (Home, popover, Run Line peek, board rows): headline, 3-line preview, inline actions
  - `full` (timelines, Inspector, phone sheet)

**5.4.10 Composer, ContextLine, ContextMeter (new).**
- **Composer:**
  - `--surface-raised`, 1px `--line-input`, radius 10, padding 12px.
  - The Context Line row (28px) appears above the input whenever there is a project, held, attached or likely context.
  - Input: auto-growing, `type-body-lg`, min height 44px (64px for `size="hero"`), max `--composer-max`.
  - Toolbar (36px):
    - left: `+` attach (`Paperclip`), `@` mention, model chip (hatched `SIM` chip for the Simulator), effort (reasoning models only)
    - right: ContextMeter, then the submit control: **Send** (in-place composers) or a split **Run ▾ / Run in background ⌘⏎** (navigating composers)
  - While streaming, the submit control becomes **Stop ⌘.**.
  - Props: `placeholder`, `size: 'hero'|'default'|'compact'`, `submitLabel`, `backgroundable`, `slashCommands`, `readBack` (a ReadBack line node), `onSubmit(text, { background })`, `streaming`, `onStop`.
  - Typing while a chat reply streams **queues** the message ("Queued — sends when this answer finishes" chip with [Send now] (stops the current answer and sends) and [Cancel]).
  - `↑` in an empty Chat composer edits your last message.
  - @-menu order: Held, project memory, Knowledge (search), files, runs, agents, tasks.
  - Dropping files anywhere on the stage attaches them.
- **ContextLine:** chips in the order Project (`Atlas Portal v2 · memory 3`) → Held → Attached → Likely.
  - Likely chips are dimmed, carry a `+` and a tooltip "Matches: webhook, retry". Clicking one makes it Attached.
  - Each chip toggles for this action: off is struck through in ink-4. × removes it.
  - It overflows into `+3 more`, which opens Inspector › Context.
- **ContextMeter:**
  - 72×6 track, 10 ticks, `--ink-2` fill, with `~3.2k / 200k` in `type-meta`.
  - At ≥80% the fill and text turn attn. Above 100% they turn fail, Send is disabled, and an inline reason appears: "Over this model's context window. Remove items or switch model."
  - Click → Inspector › Context.

**5.4.11 StartSheet and ReadBack (new).**
- **StartSheet:** a 480px right sheet, or `variant="inline"` inside a stage (new Code session, new investigation brief).
- Sections, top to bottom:
  1. **Kind** segmented control: Task · Research · Coding session · Agent · Workflow run · Note · Studio.
  2. Title (prefilled).
  3. Brief or goal textarea, prefilled from `describeSource()`.
  4. Project select (source's project › scope).
  5. ContextLine (the source is attached).
  6. Kind fields:
     - Research: depth `Quick · Standard · Deep`, angles chips, sources toggles (Knowledge `LIVE`, Uploads `LIVE`, GitHub `LIVE`, Web `SIM` with a hatched toggle)
     - Coding session: repository, base branch, branch name (auto `forge/<slug>`), linked task, agent (default Forge), **Approval policy** `Supervised · Balanced · Autonomous`, each with a one-line effect (writes `CodeSession.autonomy`)
     - Agent: agent picker, instruction
     - Workflow run: workflow picker
     - Task: assignee (you or an agent), priority, due, milestone
     - Note: collection, tags
     - Studio: kind `Doc · Deck · Image · Video`, board
  7. Model select and an optional budget cap for this run.
  8. **ReadBack** (run-producing kinds).
  9. Footer: `Create without running` (task, investigation draft, idle session) · split **Start ⏎ / Start in background ⌘⏎**. Non-run kinds show **Create ⏎**.
- **ReadBack, full form** (`type-mono-sm`, labels in `type-label`):

```
WILL RUN   Research · “Stripe webhook retry failure modes”     in Atlas Portal v2
MODEL      Simulator · Deep                                      SIM · no model is called
CONTEXT    Project memory 3 · Held 2 · Message “Stripe migration risks”   ~4.1k tok
CAN        Read knowledge ............ allowed                    LIVE
           Search the web ............ allowed                    SIM
           Write knowledge ........... asks you  ◆                LIVE
COST       est. $0.06 · $37.60 left of $50 this month
```

- Capability decisions come from `evaluatePermission`. Each row expands to show its reason. A blocked capability reads `blocked ⊘` with the reason.
- **ReadBack, line form** (above Send in workspace composers that start delegated runs):
  `Simulator · Deep SIM · asks before: Write knowledge · est. $0.06 · Details`
- At ≥100% of budget, the submit control shows a confirm: "Monthly budget reached ($50.12 of $50). Run anyway?" with [Run anyway] [Open budgets].

**5.4.12 DerivedRow and LandedCard (new).**
- **DerivedRow:** sits under the source (a message, finding or task). `↳ Research · Stripe webhook retries · ● 2/7` with a mini tape. Click → attach the run.
- **LandedCard:** replaces the DerivedRow when the child run ends.
  - Radius 10, 1px `--line`, padding 12px. A 4px `.sim-band` on the left when simulated.
  - Header: kind icon, title, ✓/✕, time.
  - Summary (2 lines), output chips, Colophon.
  - Actions: Open · Save to Knowledge · Hold.
  - Failed cards show the error line and [Retry].
- Data: `Message.derived`, `useRunsForOrigin`.

**5.4.13 Small parts.**
- **MetaLabel:** a `label` kicker.
- **IdCode:** a handle via `shortCode`. Click copies it and shows a "Copied" tooltip.
- **TickMeter:** 4px track (`--line`), 1px ticks every 10%, fill ink-2; threshold colors as in §4.3.
- **Kbd:** 18px tall, 1px `--line-strong` border with a 2px bottom edge.

**5.4.14 States.**
- **EmptyState:** a 40px rounded-square tile with a 20px icon (ink-3), a `title-2` title, one sentence (ink-2), one primary action, an optional secondary link.
- **Skeleton:** drawn in the grammar shapes (circle, capsule, row rectangle), static, with a 0.6↔1 opacity pulse at `--dur-breathe`. Static under reduced motion.
- **ErrorState:** a ✕ tile, "Couldn't {verb} {thing}", a mono detail disclosure, [Retry]. Provider errors add [Open Integrations] and [Use Simulator for this turn].

**5.4.15 Selection toolbar.**
- Appears 150ms after a text selection in a transcript, report or document.
- 32px tall, radius 6, e1.
- Actions: Ask about this · Research · Make task · Save snippet · Copy.

### 5.5 Core component inventory

These already exist in `@/ui`. Use them; do not rebuild them.

| Component | Variants | Sizes / notes |
|---|---|---|
| Button / ButtonLink | primary (ink-inverted), secondary, outline, ghost, danger, danger-solid (confirm steps only), link (ink, underlined) | xs 24 · sm 28 · md 32 · lg 40; `kbd` hint, `loading` |
| IconButton | ghost (default), secondary, primary | xs 24 · sm 28 · md 32 · lg 40; `aria-label` required |
| Input / Textarea / SearchField | default; invalid uses `--fail` border + message | sm 28 · md 32 · lg 40; border `--line-input` |
| Select, Checkbox, RadioGroup, Switch (square track), Slider, SegmentedControl | — | `--control-h` |
| Tabs | underline (stage headers, Inspector), pill (dense filters) | sm 32 · md 40 |
| Breadcrumbs | top bar only | |
| Menu / DropdownMenu / ContextMenu | items, checkbox, radio, separators, labels, shortcut hints | 192–320px wide, rows 32 |
| Popover / HoverCard / Tooltip | | Tooltip delay 400ms; HoverCard 400ms open, 120ms close |
| Dialog / Sheet / `confirm()` / `toast()` | Sheet sides: right (Start sheet, tablet Inspector), left (list drawer), bottom (phone) | see §3 |
| Badge / Tag / Chip | tones: neutral, live, attn, done, fail, sim, `hue:*` | 18 / 22 |
| Kbd / KbdCombo, Avatar / AvatarGroup, Divider, VisuallyHidden, DynamicIcon | | |
| Spinner | **only inside buttons and for local, non-AI loading** | never for run status |
| Skeleton, ProgressBar | ProgressBar **only for file uploads and imports** | runs use the Step Tape |
| Surface / Card / Panel, SectionHeader / PageHeader / Kicker, Toolbar, ListItem / NavItem, SplitPane, ScrollArea, EmptyState / ErrorState | | |
| Display: Markdown + CitationMarker, CodeBlock / InlineCode, DiffView / DiffStat (unified, split), Terminal / LogView, Tree, FileIcon, DataTable / Pagination, ActivityFeed, Stat / Meter | | DataTable is the base of every run list |
| Charts: TimeSeriesChart, BarChart, Sparkline, Heatmap, DonutChart (restricted, §4.5) | | "View as table" required |
| Signature: AtriumMark, StatusGlyph (`RunStatusBadge`/`StatusDot`/`LiveIndicator`), TaskGlyph, StepIcon, StepTape, RunPill, RunRow, RunTimeline, RunMeta, ProvenanceLine (Colophon), Receipt, SimBadge, LiveBadge, AgentMark, MonogramMark, EntityChip, EntityIcon, Lens, ApprovalCard, Composer, ContextLine, ContextMeter, StartSheet, ReadBack, DerivedRow, LandedCard, MetaLabel, IdCode, TickMeter, SelectionToolbar | | §5.4 |

---

## 6. Workspace specs

### 6.0 The five templates

All five templates live inside the shell frame (list pane | stage | Inspector).

| Template | Composition | Used by |
|---|---|---|
| **Page** | Centered column, no list pane | Home (1120), Insights (1280), Projects index (1280) |
| **Session** | List pane + stage (header, scrolling body, docked Composer) | Chat, Research, Code, agent detail |
| **Board** | Stage with a 40px filter row and a banded DataTable or card grid | Agents › Runs, Agents › Roster |
| **Canvas** | List pane + full-bleed @xyflow canvas, floating toolbar, bottom drawer | Workflows |
| **Library** | List pane (collections, filters or sections) + search and list/grid, or detail | Knowledge, Studio, Integrations, Settings, project pages |

### 6.1 Home

**Purpose.** Start anything. Clear what needs you. See what is moving. Pick up where you left off. It is not a dashboard: no charts and no KPI tiles.

**Layout** (Page, max 1120, 32px top padding):
1. **Status line** (`meta-caps`, ink-3): `SUN 1 NOV · 3 RUNNING · 2 NEED YOU · $0.42 TODAY · SIMULATOR`.
   - The last token is the default provider; it is a hatched `SIM` chip for the Simulator.
   - When scoped, the line starts with the project name.
2. **State sentence** (`display`, Newsreader, derived from data, never generated). The first matching rule wins:
   - "Two things are waiting on you." (or "Forge is waiting on you.")
   - "Three runs in flight. Nothing needs you."
   - "Four results landed while you were away."
   - "All quiet. What's next?"
3. **Hero Composer** (`size="hero"`, max 760px, left-aligned):
   - Verb chips above the input: **Auto · Ask · Research · Build · Delegate · Create · Automate**.
   - Auto shows the router's reason under the input: `Looks like code work → Build in Atlas Portal v2 · ⇥ to change`.
   - `⏎`:
     - Ask → new thread with the message sent
     - Research, Build, Delegate, Organize → Start sheet prefilled
     - Create → Studio draft
     - Automate → workflow draft
   - `⌘⏎` → the same, but you stay on Home. The run appears in In flight, and a toast reads "Started in background · RUN-K3J9 · Open".
4. **Two columns** (2fr / 1fr, 32px gap; one column below 1024):
   - **Left column:**
     - **Needs you:** up to 5 compact ApprovalCards and review rows; link "All requests ·  !".
     - **In flight:** RunRows grouped by project under `label` headers. Click → attach.
     - **Landed:** unread `run.completed`/`run.failed` notifications, failures first. Each shows kind icon, title, one-line summary, output chips, and Open · Save to Knowledge · Hold. "Mark all seen" marks them read.
   - **Right column:**
     - **Projects:** 72px rows with hue square, name, goal line, `● 2 ◆ 1`, task TickMeter with the next milestone tick, due date in mono. "New project".
     - **Resume:** the 6 latest `recents`, set as a table of contents with dotted leaders: `Rate limiter fix ······ Code · Atlas Portal v2 · 2h`.
5. **Phone order:** status line, sentence, composer, Needs you, In flight, Landed, Projects, Resume.

**States:**
- **First run** (`settings.onboarded = false`):
  - A three-line mono boot log types out over 600ms (static under reduced motion):
    - `knowledge · 42 items indexed ✓` (the real count)
    - `simulator ready — answers are simulated until you connect a model`
    - `no model key — Integrations › Anthropic to connect`
  - Three primer cards follow: **Projects scope** (`P`), **Run in background** (`⌘⏎`), **Needs you** (`!`).
  - Actions: [Connect a model] and [Try a guided run] [P2]. The guided run is a scripted research run in Q4 Competitive Landscape that pauses for one approval.
- **Quiet:** Needs you and In flight collapse to a single line each ("Nothing needs you.").
- **Busy:** Needs you shows 5 cards, and the sentence names the oldest request.
- **Loading:** skeleton rows.
- **Error:** an ErrorState for the section that failed.

**Connections:** Home starts work in every workspace. Needs you leads to runs and reviews, Landed leads to outputs, Projects leads to project pages, and Resume leads to items.

### 6.2 Chat

**Purpose.** Think with AI, and turn conversations into tasks, research, code, agent work and documents.

**Layout** (Session):
- **List pane:**
  - Search, `This project · All`.
  - Groups: Pinned · Today · Previous 7 days · Earlier.
  - Two-line rows: title, last line in ink-3, a ● while streaming, the project mark when viewing All.
- **Stage header:**
  - Title (editable), model chip, "Forked from {thread}" link when `forkedFrom` is set.
  - Turn into… (thread level: Tasks from action items via a review sheet · Knowledge note (summary) · Research brief).
  - ⋯: Pin, Archive, Export Markdown, Delete.
- **Transcript** (centered, max 712px = a 72px gutter + 640px text; at <1024 the gutter folds into a header line above each turn):
  - **Gutter:** the speaker label in `meta-caps` (`YOU`; `CLAUDE SONNET 5.5`; `SIMULATOR` plus a `SIM` tag), the time and the run handle, joined by the thread spine. Simulated replies get a `.sim-band` spine.
  - **User turns:** `body-lg`, ink. Attachments appear as chips.
  - **AI turns:**
    - tool traces as collapsible step rows ("Retrieved 3 items from Knowledge · LIVE local")
    - "Thought for 12s" disclosure when reasoning is shown
    - Markdown in `body-lg`
    - citations as mono superscript `[n]` with hover previews, then a Sources row of chips
    - the **Colophon**, always visible
  - **Streaming:** the gutter glyph breathes and reads "writing…". The block being written renders in ink-2 and settles to ink over 200ms when the next block starts or the stream ends. No caret.
  - **Turn actions** (hover or focus; ⋯ on touch): Copy · Retry ▾ (same model / another model) · Fork from here (`F`) · Hold (`H`) · Save to Knowledge (`S`) · Turn into… (`T`) · `ThumbsUp`/`ThumbsDown`.
- **Composer** (docked, 712px): Context Line, placeholder "Ask anything — @ to add context, / for actions", slash commands `/research /task /note /code`, model chip, effort, ContextMeter, Send.

**Primary interactions:**
- **Retry** (last assistant message only) calls `regenerate()` in place. If the message has derived items, Retry is replaced by "Fork and retry" (`forkThread` up to the prompt, then regenerate in the fork).
- **Edit:** your last message uses `editAndResend()`. Editing an earlier message forks from it. History is never overwritten silently.
- **@agent:** when a message starts with an agent mention (`@Scout compare…`), sending it opens the Start sheet as an Agent assignment instead of a chat turn. The result lands in the thread.
- **Selection toolbar** on any text.
- **Files:** dropping a file reads it locally. Text-like files are saved as Knowledge uploads (`attachment.knowledgeId`).

**States:**
- **Empty thread:** `title-2` "What are we working on?", 3 starter prompts drawn from the project, and the line `Simulator — answers are simulated · Connect a model` (when no key is set).
- **Loading:** transcript skeleton.
- **Streaming:** as above.
- **Error:** an inline fail note under the turn with the provider's message and fix, e.g. "Anthropic rejected the key (401)…", with [Retry] [Open Integrations] [Use Simulator for this turn].
- **Stopped:** the Colophon reads "Stopped by you".

**Connections:**
- Research, Task, Coding session, Agent, Workflow run, Note and Studio through Turn into, with DerivedRows and LandedCards in the thread.
- Knowledge through Save, retrieval and attachments.
- The context chain through Inspector › Context.

### 6.3 Code

**Purpose.** Delegate software work to coding agents, watch them work, and review, approve or reject their changes.

**Layout** (Session; Inspector closed by default):
- **List pane:**
  - **Repositories:**
    - Each row: `owner/name` in mono, `LIVE` (GitHub) or dashed `SIM` (demo repo), branch.
    - "Connect repository" popover: field "owner/repo or GitHub URL" → [Connect] (real GitHub REST); or "Use the demo repository (simulated)".
    - Shows the rate limit as `52/60 requests left this hour`.
  - **Sessions,** grouped: Needs review · Working · Idle · Done. Two-line rows: glyph, title, repo, DiffStat `+42 −7`, mini tape.
- **Stage header:**
  - Title, `repo · forge/fix-session-refresh → main` in mono, status chip, linked task chip, AgentMark, elapsed, cost.
  - Actions: Pause/Stop (while running).
  - ⋯: Export .patch, Copy diff, Archive, Delete.
- **Body:**
  - When the stage is ≥1040px: a split of **Activity** (44%, min 420) and **Review** (56%), with Review tabs **Changes (n) · Files · Checks**.
  - When narrower: header tabs Activity · Changes · Files · Checks.
- **Activity:**
  - Turns, each headed `v1`, `v2`… Every turn is your instruction block followed by its RunTimeline: plan checklist, reads, searches, edits (+/−), commands (hatched frame **"Simulated terminal — nothing was executed"**), tests, inline approvals, summary.
  - Composer: "Instruct Forge…", `/plan /test /review`. A message sent while a turn runs is queued as the next turn.
- **Changes:**
  - File list: path, M/A/D/R, +/−, decision.
  - DiffView in `mono` 13/20: unified by default; split when the pane is ≥720 (`V`).
  - Clicking a line number inserts `path:line` into the composer.
  - **Sticky review bar** (`--z-sticky`), always reading as one sentence:
    `12 files · +340 −85 · 9 accepted · 1 rejected · Checks 18/18 SIM · [Request changes] [Reject all] [Approve & open PR (simulated) ▾]`
    - The ▾ menu: Apply to branch only · Export .patch · Copy diff.
- **Files:** the live GitHub tree and a read-only viewer with line numbers. Actions: "Hold file", "Ask about this file" (prefills the composer).
- **Checks:** CheckResult rows, each tagged `SIM`.

**Primary interactions:**
- **New session** (`N` / `/code/new`) uses the inline StartSheet (§5.4.11).
- **Review:** decisions are per file (`A`/`R`) and call `reviewChange()`. "Request changes" sends your instruction as the next turn (`continueSession`). Iterations are linear versions; there is no branch tree.
- **Single human decision:** **Approve & open PR** is high risk, so the button becomes "Confirm: open PR (simulated)". It calls `openPullRequest()`, and the UI **immediately resolves that run's approval as approved by you** with the note "Confirmed in review". You never see a second card.
- File edits by the agent go to the session branch and are reviewed in Changes. They raise separate `repo.write` approvals only when the session policy is Supervised.
- **Parallel sessions** run independently and report through the Run Line and Needs you.

**States:**
- No repos: EmptyState "Connect a repository to start" with both connect paths.
- Connecting: skeleton tree.
- GitHub errors, inline with fixes: 404, rate limited ("Cached files still work"), `treeTruncated`.
- Working (live).
- Needs review (amber rail badge, Needs-you item).
- Approved, Merged (simulated).
- Failed: ErrorState with Retry.
- Archived (read-only).

**Connections:**
- Projects: the session links to a task, and the task's status follows the session.
- Research: findings arrive as context through Turn into.
- Knowledge: hold ADRs and docs.
- Agents: runs appear in Agents › Runs.
- Integrations: GitHub.

### 6.4 Agents

**Purpose.** The command center for every run and every agent: what is running, what finished, where it is stuck, and where you are needed.

**Layout:**
- **All runs** (`/agents`, Board; the default):
  - Filter row:
    - kind chips: All · Chat · Code · Research · Agent · Workflow · Studio
    - owner: Anyone · You · agent picker
    - provider: All · Live · Simulated
    - project (follows scope)
    - search (title or handle)
    - `Board | Lanes` [P2]
  - Sticky collapsible bands (32px headers in `label` style, with totals in `meta`):
    - **NEEDS YOU** (with "Approve all low-risk")
    - **RUNNING** (`5 · $0.31/h est.`)
    - **QUEUED**
    - **PAUSED**
    - **RECENT** (24h, unopened failures first)
  - Empty bands are hidden. Rows are RunRows. A waiting row expands in place into a compact ApprovalCard. Selecting a row docks Inspector › Run. `X` multi-selects for Stop, Retry and Approve low-risk.
- **Lanes [P2]:**
  - One 36px lane per actor (You, each agent, Workflows) with a 200px lane head.
  - Axis 1h/6h/24h in mono ticks, and an ink "now" line.
  - Run capsules: running uses live tint plus a live border; done is neutral; failed gets a fail end cap; time spent waiting appears as a solid `--attn-tint` segment with an attn top border (never hatched); simulated runs have a dashed outline.
- **Roster** (`/agents/roster`): a card grid (min 280).
  - Card: AgentMark 40, name (`title-3`), role, status line ("Reading 4 sources…" / "Idle · last run 2h ago"), tape, `7d · 23 runs · 96% · $1.84 est.` in `meta`, autonomy chip, "asks: Send messages, Open PRs".
  - The primary action is **Review request** (attn outline) when waiting, otherwise **Assign**.
  - ⋯: Pause, Duplicate, Archive.
  - Sort order: needs you → running → idle → paused.
- **Agent detail** (Session; the list pane lists agents):
  - Header: AgentMark 48, name, role, Active/Paused switch, autonomy segmented control (changing it shows a ReadBack of the effect), budget TickMeter (month-to-date against `monthlyBudgetUsd`), schedule chip.
  - Tabs:
    - **Now:** the live RunTimeline, or the last run's summary, plus the assign Composer "What should Scout do?" with a ReadBack line.
    - **Runs:** this agent's runs.
    - **Configure:** instructions, model, Abilities matrix (rows grouped by risk; Allow/Ask/Deny; providing integration with `LIVE`/`SIM`; rows forced by Settings › always-ask shown locked with the reason), knowledge scope, schedule (cron with a human label and next run; "Runs only while Atrium is open"), monthly budget.
    - **Memory:** knowledge items authored by the agent.
- **New agent** (`/agents/new`):
  - Templates: Research analyst, Coding agent, Support triage, Content writer, Data analyst, Meeting summarizer, QA tester, Personal assistant, plus Blank.
  - Three steps (Identity → Abilities → Brief) with a live card preview.
  - Save shows a ReadBack of the effective policy.

**States:**
- No runs: "Nothing has run yet" plus a starter command.
- No agents: the template gallery.
- Loading: skeleton rows.
- Failures appear as fail sentences with fixes, e.g. "Stopped: GitHub rate limit, resets 14:20", plus Retry.

**Connections:**
- Projects: assign tasks.
- Workflows: agent nodes and schedules.
- Integrations: abilities.
- Insights: drill-downs land here.
- Every workspace's runs.

### 6.5 Research

**Purpose.** Investigate a question, collect and judge sources, and turn findings into reports, tasks, code context and knowledge.

**Layout** (Session):
- **List pane:** investigations with glyph, title, depth chip (`Q`/`S`/`D`) and source count.
- **New brief** (`/research`, `/research/new`):
  - Question input (20px), angles chips.
  - Depth `Quick · Standard · Deep`.
  - Sources: Knowledge `LIVE` · Uploads `LIVE` · GitHub `LIVE` (when connected) · Web `SIM` (hatched toggle, with the note **"Web results are simulated in this build"**).
  - Project, model, ReadBack line, **[Start research ⏎]**, [Save draft].
- **Running:**
  - A frontier strip: Step Tape plus `Searching → Reading 7/12 → Synthesizing`.
  - When the stage is ≥1100px, a three-column board: **Plan** (260; angles with checks) · **Sources** (flexible, min 360; streaming source cards with origin tag `LIVE`/`SIM`, a 5-tick credibility meter and status) · **Findings** (360; claims with a 3-tick confidence meter and `[n]` source references). Narrower: tabs.
  - A follow-up composer queues a follow-up sweep (`askFollowUp`).
- **Done:** tabs **Report · Findings · Sources · Activity**.
  - **Report:** `doc` styles at the 720 measure; citations as mono superscripts with hover previews.
  - **Banner** when any cited source is simulated: "Cites 4 simulated sources — not fetched from the web."
  - Header actions: Save to Knowledge · Make tasks · Make a deck · Export Markdown. ⋯: Send findings to Code, Edit report, Delete.
  - **Sources:** a DataTable (title, kind, domain, credibility, status, `LIVE`/`SIM`, include toggle). Selecting 2 sources gives **Compare** [P2], a side-by-side reading view.
  - **Findings:** pin, Save snippet, Make task, Send to Code.

**Primary interactions:**
- **Make tasks:** a review sheet of recommendations with checkboxes, project and assignee; creates tasks with `origin` = the investigation.
- **Send to Code:** StartSheet (Coding session) with the selected findings quoted in the prompt.
- **Save to Knowledge:** `saveReportToKnowledge`.
- **Export:** carries the simulated header.

**States:**
- Empty: "Ask a question worth a report." plus 3 examples.
- Loading.
- Running (live).
- Review.
- Failed: ErrorState with Retry.
- No sources found: "No sources matched. Widen the sources or rephrase."

**Connections:** Chat (origin and landing), Knowledge (report, snippets, sources), Code (findings), Projects (tasks), Studio (deck), Agents (Scout runs).

### 6.6 Workflows

**Purpose.** Design, test and monitor automations that connect agents, integrations and app events.

**Layout** (Canvas):
- **List pane:** workflow square mark, name, trigger summary in `meta` (`Mon 09:00` / `on knowledge.created`), enabled switch, last-10 outcome cells, success %.
- **Stage header:**
  - Name, trigger chip (click → trigger config in the Inspector).
  - **Enabled** switch: enabling shows a ReadBack confirm.
  - **Test run ⏎:** ReadBack confirm, then the run starts.
  - Version `v4`, `Canvas | Outline`.
  - ⋯: Duplicate, Export JSON, Delete.
- **Capability summary** line under the header (ink-3): `Can: Read knowledge (allowed) · Post to Slack (asks · SIM)`.
- **Canvas** (`@xyflow/react`):
  - Background: `--surface-sunken` with a 16px dot grid in `--line`. Flow runs **top to bottom**.
  - Nodes: 240×72, radius 10, `--surface-raised`, 1px `--line-strong` (dashed `--line-input` when the node uses a simulated integration).
    - 24px header: type icon, `label` type name, state glyph.
    - Label: 13/18 600.
    - One-line config summary (ink-3).
    - Agent nodes show an AgentMark 20. Condition nodes have two bottom handles labeled **Yes / No**. Approval nodes show `Hand` and stay neutral until a run waits there (then attn).
  - Ports: 8px squares. Edges: 1.5px smoothstep in `--ink-4`.
- **Floating toolbar** (bottom center, 40px): Add node (`N`), Auto-layout, Fit (`⇧1`), Zoom −/+.
- **Runs drawer:** 36px collapsed (`Last run ✓ 2m ago · 6 steps` plus tape), 280px open (runs table).
- The Inspector shows node configuration (Item) or a run (Run).

**Primary interactions:**
- Add node picks from 8 types (Trigger, Agent, Action, Condition, Transform, Approval, Delay, Output). The node is inserted after the selection and connected automatically.
- **Test run:** the active node gets a 2px live border, traversed edges turn ink-2, and the active edge carries a moving dash in the live color (static under reduced motion). Approval nodes raise ordinary ApprovalCards.
- **Past run:** selecting one overlays each node's final state (static) and attaches the run.
- **Outline view:** numbered sentences with indented branches, e.g. "1. When a doc is added to Knowledge — event · LIVE" and "3a. If priority is urgent → …". Each row opens the same config form. Rows support "+ Add step after" and Delete. Validation issues (`validateWorkflow`) appear inline as fail glyph and text. **Outline is the default on phones and the accessible editor everywhere.**
- **Triggers:**
  - Manual: real.
  - Schedule: a real in-app timer, labeled "Runs only while Atrium is open".
  - Event: real internal events (`knowledge.created`, `task.completed`, `run.failed`, `approval.resolved`).
  - Webhook: `SIM`, with a "Send test event" button.
- [P2] "Describe it" drafts a workflow from text; Make repeatable from a run.

**States:**
- Empty: templates (Weekly digest, Triage new tickets, Research when a doc is added) and Blank.
- Invalid: node badges plus an issue list.
- Running (live).
- Failed at a node: fail border plus the error in the Inspector.

**Connections:** Agents (agent nodes, child runs with `parentRunId`), Integrations (action nodes), Knowledge, Projects and Chat (outputs), every app event (triggers).

### 6.7 Knowledge

**Purpose.** The shared memory layer: everything you keep, searchable locally, retrievable by every AI action, with provenance.

**Layout** (Library):
- **List pane:**
  - All knowledge.
  - **Collections:** the current project's first, then global; each with a hue square and count.
  - **Smart filters:** Recent · Held · Project memory · From research · Uploads · From chat · From agents · Simulated.
  - Tags.
- **Library stage:**
  - Search field (`/`; real local full-text, live results, highlighted matches).
  - `List | Grid`, sort (Updated · Title · Most used), [Upload], [New note `N`].
  - Rows (`--row-h-2`):
    - kind tile, title (600), excerpt with highlights
    - `meta`: origin chip ("from Research · Competitor teardown"), `used by 6 runs`, updated, `SIM` when simulated, `Not indexed` for non-text files
- **Reader** (`/knowledge/:id`, 720 measure, `doc` styles):
  - Meta line: kind · source · words · updated · `Available to AI: Always`.
  - Header actions: Edit · Hold · Ask about this (opens a thread with the item attached) · Turn into… · ⋯ (Move to collection, Add to project memory, Duplicate, Delete).
  - Edit mode: a markdown textarea (`mono`) with a Preview toggle; side by side at ≥1440.
- **Inspector › Item** (open by default at ≥1440 in reader view):
  - Summary, **Available to AI** (`Always · When cited · Never`), collection, projects, tags.
  - **Came from**, **Used by** (runs that read it, newest first, with times), **Cited by**, History.

**Primary interactions:**
- **Drop files anywhere:** a full-stage overlay with a solid 1px ink outline reads "Drop to add to Knowledge — read locally, never uploaded". Progress shows per file.
- **Ask this collection:** a composer at the foot of a collection view creates a thread scoped to the collection and opens Chat.
- **Bulk** (`X`): move, tag, add to project, delete (confirm).
- No graph view. Links in the Inspector are the one-hop view.

**States:**
- Empty library: drop zone plus "Knowledge fills itself as you save things from other workspaces."
- No matches: "No matches for “x”."
- Indexing: "Indexing 42 items…" with skeleton rows.
- File read error: inline on the file's row.

**Connections:** every composer (Hold, @, retrieval), Chat, Research, Projects (memory), Agents (knowledge scope, memory), Studio (references).

### 6.8 Studio

**Purpose.** A creative light table for generating and iterating on docs, decks, images and video.

**Layout** (Library):
- **List pane:** Boards (+ New board), kinds (Images · Video · Decks · Docs), Favorites.
- **Board stage:**
  - Sticky prompt bar: prompt input, kind select, aspect (image and video), style chips, takes 1–4, generator chip (`LIVE` text model, or `SIM` procedural), **Generate ⏎**.
  - **Contact sheet** on `--surface-sunken`: tiles 200px (min 160, max 240) with 8px gaps. This is the only gapped grid in the product.
  - Tile: preview (procedural art; simulated tiles get a hatched frame and a `SIM` corner tag), title (13, 600), `meta` (kind icon · `v3` · generator).
- **Asset view** (`/studio/:assetId`):
  - Preview at fit size:
    - Image: framed.
    - Video: a storyboard strip of shots with durations.
    - Deck: outline 240 | 16:9 slide | notes, with **Present** (full screen, arrow keys, Esc exits).
    - Doc: a Newsreader editor with "Rewrite selection".
  - A 64px version filmstrip with `←`/`→`.
  - A/B compare toggle.
  - An **Iterate** composer ("Make the sky warmer…") that creates a new version and never overwrites.
  - Inspector › Item: prompt, params, generator `LIVE`/`SIM`, seed, versions, lineage, where used.

**Primary interactions:**
- Generate creates takes. Generating tiles show a tape, then *develop* (a 600ms fade from the procedural preview).
- `1`–`4` picks the current version.
- Text for docs and decks comes from the live model when a key is set; otherwise it is simulated and labeled.
- **Images and video are always procedural**, with the label **"Simulated preview — no image model was called"** (or video model).
- Exports: PNG (the procedural render), Markdown (docs and deck outlines), JSON (decks).

**States:**
- Empty board: "Describe something to make." plus examples.
- Generating (live).
- Failed tile: ✕ plus Retry.

**Connections:** Research ("Make a deck" from a report), Knowledge (hold reference docs; save copy), Projects (assets appear in Work › Deliverables), Chat (@-mention assets).

### 6.9 Projects

**Purpose.** Goals, tasks and milestones for you and your agents. Every project is also a scope with memory and a full history.

**Layout:**
- **Index** (`/projects`, Page, max 1280):
  - Header with [New project].
  - A **My tasks** card (overdue and due today).
  - Project cards (grid, min 320):
    - 3px hue band, square mark, name (`title-3`), goal (2 lines, ink-2), status chip
    - `● 2 running ◆ 1 needs you`
    - task TickMeter with milestone ticks, next milestone and due date in mono
    - members (Avatar plus AgentMarks), a star toggle, and "In scope" when active
- **Project page** (Library; the list pane lists projects):
  - Header:
    - square mark, name (editable), status
    - **Work in this project** button: sets the scope, then reads "In scope ✓"
    - tabs, [New task `N`], ⋯
  - **Overview:**
    - goal (`body-lg`)
    - **milestone ruler**: a tick scale with square milestone markers at their due dates and an ink "today" hairline; clicking a milestone filters Tasks
    - left: Needs you · In flight · Next up (the 5 tasks due soonest)
    - right: Members (drop targets) · Numbers (open tasks, live runs, live spend month-to-date plus a simulated estimate) · Recent activity (5 sentences)
  - **Tasks:**
    - `List | Board`, `Mine · Delegated · All`, milestone filter.
    - List, grouped by milestone: task glyph, title, priority, assignee mark, origin chip, live tape, due date in mono, subtasks `2/5`.
    - Board columns at 280: Backlog · To do · In progress · Review · Done. Drag, or keyboard (Space to pick up, arrows, Space to drop), or "Move to…".
  - **Work:** **Deliverables** first (reports, PRs (simulated), assets, docs), each with its provenance chain of chips, e.g. Message → Investigation → Session → PR. Then Conversations · Coding sessions · Investigations · Workflows · Knowledge.
  - **Activity:** ActivityFeed grouped by day, filtered by actor and kind.
  - **Memory:**
    - Goal; Instructions (labeled "Prepended to every AI request in this project")
    - pinned items (add through search, remove)
    - repositories
    - "What the AI sees" token estimate
- **Task in the Inspector:**
  - Fields (status, assignee, priority, due, milestone, labels), description, subtasks, origin lineage, runs with tapes.
  - Actions:
    - **Start:** for your own task, opens a Code session when the project has a repo, otherwise a Chat with the task attached.
    - **Assign to agent:** ReadBack confirm, then `assignTask`.
    - Research · Discuss · Turn into…

**Primary interactions:**
- An agent-assigned task moves to In progress (live glyph) while its run works, then to **Review** when the run succeeds. It never moves straight to Done; you approve the review to complete it.
- [P2] "Draft tasks from goal".

**States:**
- No tasks: "Break the goal into tasks" with [New task].
- Loading.
- Error.

**Connections:** everything, through scope; tasks ↔ runs, sessions, agents and origins.

### 6.10 Insights

**Purpose.** Platform-wide visibility into runs, reliability, model usage, tokens and spend. Every number leads back to the work.

**Layout** (Page, max 1280):
- Filters: range `24h · 7d · 30d`, project (current or all), provider `All · Live · Simulated`.
- Tabs: **Overview · Journal**.
- **Overview:**
  - Four KPI tiles (`figure`): **Runs** (Δ vs. previous period) · **Success rate** · **Waited on you** (median approval wait) · **Spend** (live, month-to-date, with a budget TickMeter; a second line `est. $4.10 simulated`).
  - At most four charts:
    1. Runs per day by outcome (stacked bars with a glyph legend)
    2. Spend by model (horizontal bars; Simulator estimates hatched and labeled `est.`)
    3. Tokens by run kind (sorted single-series bars)
    4. Approval wait time (histogram in attn)
  - Two tables:
    - **Agents** (mark, runs, success, average duration, approvals asked, spend, last failure)
    - **Workflows** (runs, success, failing node, last run)
- **Journal:** an ActivityFeed with filters (actor, verb, project, kind) and Export JSON.

**Primary interactions:**
- Every number, bar and row drills into `/agents` with a matching filter (`?agent=scout&status=failed&since=7d`). A run row offers Open origin and Retry.
- Hover shows exact values in mono. Every chart has "View as table".
- Crossing 80% of the monthly budget posts one Update.

**States:**
- Fewer than 5 runs: an explanation of what will appear, plus a starter command.
- Simulated-only data: a banner "Costs shown are estimates; simulated runs spend nothing."

**Connections:** Agents › Runs, run origins, Settings › Budgets.

### 6.11 Integrations

**Purpose.** Connect models and services, see honestly what is live and what is simulated, and control what agents may do with each service.

**Layout** (Library):
- **List pane:** categories (AI models, Code, Communication, Productivity, Storage, Data, Search, Design, Media, Cloud) and a Connected filter.
- **Stage:**
  - **AI models** first:
    - Simulator: always on, hatched card.
    - Anthropic (`LIVE`).
    - OpenAI-compatible (`LIVE`).
  - Then Connected, then the Catalog: cards in a grid (min 280).
  - Card: a ring monogram (dashed when simulated), name, category, `LIVE` or `SIMULATED` badge, capability chips, status, last used.
- **Detail** (`/integrations/:id`, max 880):
  - "What's real" note (`supportNote`).
  - Connect form, with the key warning: "Your key is stored only in this browser and sent directly to {provider}. Anyone with access to this browser profile can use it. Use a key with a spending limit."
  - **Test connection:**
    - Anthropic: a real tiny request
    - OpenAI-compatible: `/models`
    - GitHub: the rate-limit endpoint
    - Everything else: a simulated handshake, labeled as simulated
  - **Permissions** matrix: capability × `Allow · Ask · Deny` (`IntegrationConnection.scopes`).
  - **Used by:** agents and workflows as chips.
  - Usage log. **Forget key.** **Disconnect** (a ReadBack listing affected agents and workflows, then confirm).

**Primary interactions:**
- Errors show the provider's own message and the exact fix: 401, CORS ("Allow this origin in your server settings: …"), rate limit.
- Simulated services connect instantly with "Simulated — nothing leaves your browser".
- Pasting a GitHub URL anywhere offers "Connect repository".

**States:** connecting, connected, error (fail dot on the rail item plus an Update), disconnected.

**Connections:** model pickers everywhere, Agents › Abilities, Workflows › action nodes, Code › repositories.

### 6.12 Settings

**Purpose.** Preferences, safety and data. Every setting is also reachable from ⌘K (`> theme light`).

**Layout** (Library; list pane = sections; form max 720; no Inspector):

| Section | Contents |
|---|---|
| **Profile** | Name, hue, initials preview |
| **Appearance** | Theme (Dark · Light · System), density, motion (System · Reduce · Full) |
| **Models** | Default model per run kind (Chat, Research, Code, Agents, Studio text), effort, show reasoning, auto-retrieve knowledge, link "Manage keys in Integrations →" |
| **Permissions & safety** | Default autonomy, always-ask capabilities (chip multi-select), confirm destructive actions, list of every "always allow" grant by agent with Revoke |
| **Budgets** | Monthly budget, count simulated estimates |
| **Notifications** | Toasts, Focus mode, browser notifications for approvals [P2] |
| **Keyboard** | Single-key shortcuts on/off, the full shortcut sheet |
| **Simulator** | Speed 1×–4×, link to the "What's real" table |
| **Data** | Storage usage, Export JSON (keys excluded), Import, Reset demo data (type `reset`), Erase everything (type `erase`) |
| **About** | Version; **What's real in this build**, a matrix of live vs. simulated capabilities |

**Behavior:**
- Changes save instantly, with an inline "Saved" ✓ in `meta`.
- Theme changes crossfade (`html.theme-transition`).
- No setting can hide simulated labels.

---

## 7. Cross-workspace flows

### 7.1 Shared mechanisms (the only ways context moves)

1. **Turn into… (`T`)** opens the **Start sheet** prefilled from the source (`describeSource`). It calls the matching `handoff.ts` function (`toTask`, `toInvestigation`, `toCodeSession`, `toAgent`, `toWorkflowRun`, `toKnowledge`, `toStudio`). Each conversion records the origin, a `derived_from` link and an activity event.
2. **Landing:** the source shows a **DerivedRow** while the child run works, and a **LandedCard** when it ends. Home › Landed and Updates list it until it is seen.
3. **Hold (`H`)** carries objects into every composer's Context Line. **Save to Knowledge (`S`)** makes them durable and retrievable. **Add to project memory** makes them part of every run in the project.
4. **@-mentions and chips**: any composer can reference any entity. Hovering previews it; clicking inspects it in place.
5. **Runs remember:** every run's **Saw** list and outputs produce `references` and `produced` links. Every entity therefore shows Came from, Led to, Used by and Cited by.
6. **One approval model:** ApprovalCard + Needs you + Run Line, everywhere.

### 7.2 Handoff matrix

| From | Gesture | Becomes | Shows at the source | Comes back as |
|---|---|---|---|---|
| Chat message or selection | `T` → Research, or selection toolbar "Research" | Investigation + run | DerivedRow under the message | LandedCard in the thread, Home › Landed, Update |
| Chat message | `T` → Task (or "Tasks from action items" at thread level) | Task(s) with `origin` = message | Task chip(s) under the message | Task status in the chip |
| Chat message starting with `@Agent` | Send | Agent run (Start sheet) | DerivedRow | LandedCard |
| Research findings | Send to Code | Coding session (findings quoted) | Led-to link | Session listed in the investigation's Links |
| Report | Save to Knowledge · Make tasks · Make a deck | Knowledge item · tasks · Studio deck | Links | "Used by" and "Cited by" on the report |
| Task | Assign to agent (ReadBack) | Agent or code run linked to the task | Live tape on the task | Task → Review |
| Task (yours) | Start | Code session (project has a repo) or Chat | Origin chip | Task status follows the session |
| Any item | `H` | Held context | Holding count | Saw lists in later runs |
| Any item | `S` | Knowledge item with provenance | Led-to link | Retrieval, "Used by" |
| Succeeded run [P2] | ⋯ → Make repeatable | Workflow draft | Led-to link | Workflow runs in the run board |

### 7.3 Journeys (seed world: Morgan Lee, Northwind Labs)

1. **Chat → Research → Chat → Knowledge.**
   1. In *Stripe migration risks* (Atlas Portal v2), Morgan selects the paragraph about webhook retries and chooses **Research** from the selection toolbar.
   2. The Start sheet opens with:
      - question "What are the failure modes of Stripe webhook retries during migration?"
      - depth Standard; sources Knowledge `LIVE` + Web `SIM`
      - the message attached
      - ReadBack: `Simulator · Deep SIM`; Read knowledge allowed; Search the web allowed `SIM`; Write knowledge asks; `est. $0.06`
   3. `⌘⏎` starts it in the background. A toast reads "Research started in background · RUN-K3J9 · Open". The thread shows `↳ Research · Stripe webhook retries · ● 2/7`, and Morgan keeps chatting.
   4. When it ends, the row becomes a LandedCard: summary, `9 sources · 4 simulated`, Open report, Save to Knowledge.
   5. Save creates *Webhook retry risks* (lineage → the investigation → the message).
   6. The next chat turn shows it as a Likely chip. The run's Saw list includes it, and the item reads "Used by 1 run".
2. **Research → Code.**
   1. In the report's Findings, Morgan selects findings 2 and 4 → **Send to Code**.
   2. The StartSheet (Coding session) has the prompt with quoted findings, repo `atlas-portal` (the demo repo is `SIM`), agent Forge, policy Balanced.
   3. `⏎` opens the session. The plan step cites the investigation chip, and the investigation's Links read "Led to: session".
3. **Code → review → Project.**
   1. The session is linked to the task *Add idempotency keys to webhook handler*, which moves to In progress.
   2. Forge asks to run tests (`shell.execute`, MED): an inline ApprovalCard, an amber Run Line pill, a toast. Morgan presses `Y`.
   3. The session reaches Needs review and the task moves to Review. Needs you shows "Review changes: Add idempotency keys · 12 files · +340 −85".
   4. Morgan reviews (`J`/`K`, `A`, rejects one file with `R`) and sends **Request changes**: "keep the legacy retry header". Turn `v2` runs and returns for review.
   5. **Approve & open PR (simulated)** → confirm. The PR #48 (simulated) is created with no second card, and the task moves to Done.
   6. Project › Work › Deliverables shows `Message → Investigation → Session → PR #48 (simulated)`.
4. **Chat → tasks → agent → approval → done.**
   1. In *Session expiry after SSO login*, the answer lists three fixes. Thread-level Turn into → **Tasks from action items** opens a review sheet with three checked items. Three tasks are created with origin chips.
   2. In Projects › Tasks, Morgan assigns *Fix session refresh* to Forge. The ReadBack shows `repo.read allowed · repo.write allowed · shell.execute asks · est. $0.12`.
   3. The run progresses. The task reaches Review. Morgan approves the review and the task is Done.
5. **Project → Agent → Workflow → Integrations.**
   1. In Lumen Launch, Herald's *Weekly digest* workflow: Schedule (Mon 09:00, runs only while Atrium is open) → Agent Herald (summarize room activity) → Approval → Post to #launch (Slack `SIM`, dashed) → Output: save the digest to Knowledge.
   2. Enabling it shows a ReadBack confirm.
   3. On the first run, the approval card shows the message preview with "Send messages is always-ask in your safety settings". "Always allow" is hidden, and Morgan approves once.
   4. The run appears in the workflow's drawer, in Herald's Runs and in Insights. Slack › Used by lists the workflow.
6. **Knowledge as shared memory.**
   1. Morgan drops `pricing.csv` into a Lumen chat. It is read locally and saved as an upload.
   2. A later Research run in Lumen lists it in its Saw list. The item's "Used by" shows both runs.
   3. Morgan sets it to `Available to AI: When cited`. Retrieval stops picking it automatically.
7. **Report → Studio deck → deliverable.** On the *Q4 Competitive Landscape* report, Morgan uses Turn into → **Studio → Deck**. The slides are drafted (live when a key is set, otherwise `SIM`) and cite the report. The deck appears in Q4 Competitive Landscape › Work › Deliverables.
8. **Insights → back to work.** A spike in Spend by model → click the bar → `/agents?since=…&provider=live` → attach the costly run → **Open origin** (the chat thread) → **Retry ▾ → Claude Haiku 5.5**. Both Colophons show the cost difference.
9. **Interrupt while elsewhere.**
   1. Morgan is reading in Knowledge. Forge requests `shell.execute`.
   2. The Run Line pill turns amber ("Forge · wants approval"). The mark capsule and favicon turn amber, the tab title becomes `(1) …`, and a toast appears with [Review].
   3. `!` → the popover → the focused card → `Y`. Morgan never left Knowledge.

---

## 8. Interaction, motion, voice, accessibility

### 8.1 Interaction rules

- **Two ways to start.**
  - `⏎` runs attached: you go to the work.
  - `⌘⏎` runs in the background: you stay where you are, and a pill enters the Run Line.
  - This applies only to navigating composers and sheets (Home, ⌘K, Start sheet, agent assign). In in-place composers, `⌘⏎` simply sends.
  - On touch, the split button reads `Run | ▾ Run in background`.
- **Start sheet:** shown for new Research, Coding session, Agent assignment, Workflow run and Studio-from-source, and for every Turn into. *Not* shown for chat turns, follow-ups inside an existing session or investigation, Studio generations from the prompt bar, or agent-page assignments. Those use the inline ReadBack line.
- **No steering mid-run.** Messages typed during a run queue as the next turn, sweep or iteration. `⌘.` stops a run; Pause and Resume hold it.
- **Approval keys:** `Y` / `D` / `E`, never `⌘⏎`. HIGH risk needs a second `Y` or a Confirm click. Previews are always inline.
- **Destructive actions:** delete uses a confirm dialog (typed for irreversible bulk data). Archive, remove and release use Undo toasts.
- **Optimistic UI** for local writes. Every service error produces a toast with the error and, where it makes sense, [Retry].
- **No layout shift while streaming:** the transcript grows downward only. Auto-scroll pauses when the user scrolls up, and a "Jump to latest" chip appears.
- **Hover actions** always have a focusable ⋯ equivalent and are revealed on `:focus-within`.
- **Drag and drop** (attach, hold, assign, move) is an enhancement only. Each drag has a menu action.

### 8.2 Motion rules

| What | Motion |
|---|---|
| Hover, press, toggles | Color and background at `--dur-1`; press uses `--surface-press` (no scale) |
| Menus, popovers, hover cards | `floatingMotion`: 4px travel, scale 0.98, `--dur-2` settle |
| Inspector dock/undock, list pane | Width at `--dur-3` with `--ease-standard`; floating mode uses `sheetMotion` |
| Workspace switch | Stage content fades out over 120ms, then in over 180ms with a 6px rise; the rail and top bar never animate |
| Command center, Start sheet | `dialogMotion` / `sheetMotion` at `--dur-3` |
| Run pill enter and exit | 240ms scale 0.96→1 and fade; finished pills collapse after 8s |
| Live state | Breathing opacity at `--dur-breathe` (glyph halo, mark capsule, running tape cell); timeline bead at 1800ms |
| Streaming text | Last block in ink-2 → ink over 200ms; no caret, no typewriter effect |
| Approval resolved | Highlighter wipe at `--dur-3`, then the stamp |
| Studio develop | `--dur-develop` fade |
| List stagger | 24ms per item, first 8 items only, only on first load; **lists you are reading never animate on update** |

**Reduced motion** (OS setting, or `html[data-motion='reduce']` from Settings):
- No translation or scaling. Fades are 120ms or less.
- Breathing becomes a static live glyph with a 1px ring.
- No bead, no moving edge dashes, no stagger, no develop (instant).
- The boot log is static. The highlighter wipe becomes instant.

### 8.3 Content and voice

- **Plain verbs, consistently:** Run · Run in background · Stop · Pause · Resume · Retry · Approve · Deny · Hold · Release · Save to Knowledge · Turn into… · Fork from here · Open · Inspect.
- **Sentence case.** UPPERCASE only in `label` and `meta-caps`. No exclamation marks, no emoji, no "magic", no first-person system chatter ("I'd be happy to"). Agents speak only inside their own outputs.
- **Step titles:** present participle while running ("Reading 4 sources"), past tense when done ("Read 4 sources").
- **Approval headlines:** `{Agent} wants to {verb phrase} {target}`. Why-asked lines come verbatim from `PermissionDecision.reason`.
- **Run status words:** Queued · Running · Needs you · Paused · Done · Failed · Stopped.
- **Numbers:**
  - tokens `12.4k tok`
  - costs `$0.08`, with 3 decimals below a cent (`$0.004`)
  - estimates prefixed `est.`
  - durations `3.1 s`, `01:24`
  - relative times `4m ago`
  - all set in mono or tabular figures
- **Empty states:** one sentence plus one action. **Errors:** say what happened, why, and the next step, in one or two sentences.

### 8.4 Honest labeling (exact rules and strings)

| Situation | Required treatment |
|---|---|
| Any simulated AI output | `SIM` tag in the speaker label or header, plus `.sim-band`/hatch, plus a Colophon with "No model was called" |
| Simulated tool step in a live run | Per-step `SIM` tag on the tool chip; the run is labeled per step |
| Simulated terminal or tests | Hatched frame headed **"Simulated terminal — nothing was executed"**; checks tagged `SIM` |
| Web sources | Dashed source cards, `SIM` origin tag, "Web results are simulated in this build" |
| Report citing simulated sources | Banner "Cites {n} simulated sources — not fetched from the web." |
| Media | Hatched frame and `SIM` corner tag; "Simulated preview — no image model was called" |
| Pull requests, pushes, Slack and Gmail sends | "(simulated)" after the noun everywhere ("Pull request #48 (simulated)") |
| Simulated integrations | Dashed ring, `SIMULATED` badge, "Simulated — nothing leaves your browser" |
| Schedules | "Runs only while Atrium is open" |
| Webhook triggers | `SIM` plus "Send test event" |
| Costs of simulated runs | `est.` plus the tooltip "Estimated at reference pricing; no money was spent." Excluded from budgets unless `countSimulatedSpend` |
| Markdown exports containing simulated content | First line: `> **Simulated content.** Generated by Atrium's local simulator on {date}. No AI model, web search or external service was used.` |
| Real paths | Show the model or service name (e.g. "Claude Sonnet 5.5", "GitHub"). Show `LIVE` only where live and simulated mix. |

`SIM` tags are always visible, including on desktop, in screenshots and in exports. Nothing is labeled simulated only on hover.

### 8.5 Accessibility

- **Target:** WCAG 2.2 AA. Contrast is verified in §4.3. Information is never carried by color alone: glyph shapes and words always accompany it.
- **Landmarks and navigation:**
  - Landmarks: `header` (top bar), `nav` (rail), `main` (workspace screen), `aside` (Inspector), `region "Runs"` (Run Line).
  - A "Skip to main content" link comes first.
  - F6 cycles regions. Lists use roving tabindex with arrows, Home/End and type-ahead.
- **Focus:** a visible 2px ink ring everywhere (inset inside dense lists).
  - Modal layers (command center, Start sheet, dialogs, phone sheets) trap focus and return it on close.
  - Popovers return focus to their trigger. Esc closes only the top layer (the existing layer stack).
- **Live announcements:** one polite live region.
  - Approvals: "Needs you: Forge wants to run the test suite in atlas-portal".
  - Completions: "Research ‘…’ finished".
  - Assertive only when the user's own foreground action fails.
  - Streaming messages set `aria-busy` and announce "Answer complete" at the end. The token stream itself is never live-announced.
- **Shortcuts:** single-key shortcuts can be switched off (WCAG 2.1.4). Every action is also a visible control and a ⌘K command.
- **Targets:** at least 24×24 with spacing on fine pointers; at least 44×44 on coarse pointers.
- **Inputs:** labeled. Errors use `aria-invalid` and `aria-describedby`. Placeholders are never the only label.
- **Canvas and charts:** the workflow canvas has the Outline as its accessible editor. Charts have direct labels and "View as table". The Step Tape has a full text label.
- **Reflow:** text resizes to 200% and reflows at 320 CSS px without horizontal page scroll. Horizontal scroll is allowed only inside code, diffs and Lanes.
- **Motion:** reduced motion is honored per §8.2.

---

## 9. Do / Don't for implementers

**Do**
- Build in this order:
  1. tokens, glyphs, fonts
  2. the shell (top bar, rail, Run Line, Inspector, command center, Needs you, toasts)
  3. the shared kit (Composer and ContextLine, StepTape, RunTimeline, Colophon, ApprovalCard, StartSheet and ReadBack, EntityChip and Lens, DerivedRow and LandedCard)
  4. Home, Chat
  5. Code, Agents, Projects
  6. Research, Knowledge, Workflows
  7. Insights, Integrations, Settings
  8. Studio
  9. everything marked [P2]
- Write through the domain services (`@/core/services/*`, `runEngine`, `approve`/`reject`, `handoff.ts`). Log activity and create links for every derived entity.
- Render every AI execution with the shared run components, and end it with a Colophon.
- Use tokens via Tailwind utilities only (`bg-canvas`, `text-ink-3`, `border-line-input`, `rounded-sm`…).
- Show the Context Line in every composer that calls a model, and record the Saw list on every run.
- Implement the stage ≥640px docking rule, the 712/720px reading caps, and the phone push-navigation stack.
- Keep scope in `useContextStore`. Keep the item title in the stage header. Keep Run · Item · Context in that order.
- Give every data view loading, empty and error states. Test every surface at 360px and 2560px, in both themes, with reduced motion on.
- Use `shortCode()` handles as secondary, copyable metadata, and make ⌘K resolve them.
- Use squares for lasting objects, circles for actors, capsules for runs and approvals, and glyphs for state.

**Don't**
- Don't use color for decoration. No hue on buttons, headers, borders or icons except signals and identity marks. No gradients, glows, blur, glass, sparkles, wands or robot art.
- Don't show a spinner or a progress bar for AI work. Use the Step Tape and status glyphs.
- Don't hide `SIM` labels behind hover, settings or truncation. Don't style anything else with hatching or dashed borders. Don't present estimates as real costs.
- Don't send anything to a model that the Context Line doesn't show. Don't auto-carry held items across a project switch without the toast.
- Don't raise a second approval for a decision the user just made (Approve & open PR, review approval).
- Don't bind approve to `⌘⏎`. Don't bind irreversible actions to single keys. Don't use Alt+digits or browser-reserved combinations.
- Don't put scope in the URL, rename workspaces, change chords, or add chrome to the top bar, rail or Run Line from inside a workspace.
- Don't build: the Clips ring, branch trees inside threads, replay scrubbers that redraw history, steering mid-run, flight animations, LED flicker, the Map, sheet stacks, a global knowledge graph, serif prompt headlines, or a universal bottom command line.
- Don't use `--accent`/`--live` for focus. Focus is always the ink ring.
- Don't use amber for anything except waiting on a human, or green for anything except success and diff additions.
- Don't animate lists the user is reading, and don't shift layout while text streams.
- Don't import Instrument Serif, add font families, or add dependencies.
- Don't put text on solid amber, and don't show third-party logos.