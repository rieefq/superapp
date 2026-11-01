## CHAT  (/chat, /chat/:threadId)
Purpose: the primary conversational surface — think, ask, draft, analyze — where conversations turn into action.
Must have:
- Thread list: search (titles + content via the search service), New chat (button + `⌘⇧O`/command), groups Pinned / Today / Yesterday / Previous 7 days / Older; respects project scope (scoped by default, "All work" toggle); per-thread menu: rename (inline), pin, move to project, archive, delete (confirm). Collapsible; on mobile it is its own screen.
- Conversation header: inline-editable title, project chip (change project), model picker (availability-aware; unavailable live models show why + link to /integrations/anthropic), context button (count of items in context), menu: fork from here, export as Markdown (real file download), delete.
- Messages: user turns and AI turns rendered with the design spec's conversation pattern (NOT generic left/right chat bubbles unless the spec says so). AI turns: Markdown (headings, lists, tables, code blocks with copy), inline [n] citation markers that open the cited knowledge item, a Sources row of entity chips, collapsible tool traces ("Searched knowledge · 3 results"), collapsible reasoning, and a provenance footer (model · Simulated/Live · tokens · cost · duration). Streaming: live text, stop control. Errors: inline error with Retry and an actionable link (e.g. add API key).
- Per-message actions: copy, regenerate (AI), edit & resend (user), branch/fork, feedback up/down, and a "Turn into…" handoff menu: Task, Research, Agent run, Code session, Knowledge note, Studio asset (each uses core handoff services, shows a toast with a link, and records the derived item on the message so it renders a "→ Task created" backlink chip).
- Composer: autosize, Enter sends / Shift+Enter newline, attachments (picker, drag-drop, paste images; text files read for real and included), context chips (thread context + pinned context; removable), `@` mention picker to add knowledge/project/investigation/etc. to context (uses search), `/` slash commands (/research <q>, /task <title>, /agent <name> <instruction>, /code <instruction>, /image <prompt>, /note), model picker.
- Empty state (new chat): serif prompt + 4 suggestion cards derived from the user's actual workspace data (e.g. "Summarize the Atlas Lumen PRD", "Compare Portbase and Freightly") + recently used context.
- Context panel (toggleable side panel): items in context for this thread (thread refs + pinned + project memory) with remove/add, and the sources retrieved for the latest answer.
- Text selection inside an AI message shows a small floating action: Ask follow-up / Make task / Save to knowledge.
E2E (e2e/chat.spec.ts): new chat → send → streamed answer completes with Simulated label; citations appear for a knowledge-related question; regenerate; "Turn into → Task" creates a task visible in its project; "Turn into → Research" navigates to the new investigation; rename + delete thread; attach a .txt file and see it acknowledged.

## CODE  (/code, /code/:sessionId, /code/repos/:repoId)
Purpose: agentic software development — delegate tasks to coding agents, watch them work transparently, review and approve changes. Not an IDE.
Must have:
- Code home: connected repositories (cards with LIVE/SIM badge, language, last sync; menu: refresh, disconnect), "Connect repository" dialog (GitHub owner/name or URL → real GitHub API fetch with loading/error states incl. rate-limit and not-found; or "Use demo repository"), sessions grouped Needs review / Working / Recent (status, repo, branch, agent, changes +/−, checks), "New session" (repo picker + instruction composer + optional task link + agent picker) → createSession → navigate.
- Session view: header (title, repo + branch → base, status, agent identity, actions: Open pull request (approval-gated, simulated PR clearly labeled), Merge (simulated), Archive, Delete). Panels: Activity (turn-by-turn: the user instruction then the live RunTimeline — plan, search, file reads with paths, edits with inline mini-diffs, terminal commands with streaming output, tests; approvals inline with approve/reject + note; final summary), Changes (file list with +/− and review state; DiffView unified/split; accept/reject per file; accept all; "Request changes…" sends a follow-up instruction via continueSession), Checks (typecheck/lint/unit/e2e status with output), and a follow-up composer to iterate. Live updates while the run is active.
- Repository explorer: file tree (filter by name) + file viewer with line numbers and syntax highlighting; LIVE GitHub reads with loading/error/rate-limit states; "Start a session about this file" (prefills the instruction with the path).
- Honesty: the terminal/test output is simulated (label it in the panel header); GitHub reads are live for GitHub repos.
E2E (e2e/code.spec.ts): open seeded session "Fix session expiry after SSO login" → Changes → accept both files → Apply; start a new session on the demo repo → steps stream → approval for a command appears → approve → session reaches Needs review with changes; repo explorer opens src/auth/session.ts.

## AGENTS  (/agents, /agents/:agentId, /agents/runs/:runId)
Purpose: the command center for autonomous agents and every run — what is happening, what is done, where it is stuck, where a human is needed.
Must have:
- Fleet overview: status counts (working / waiting on you / idle / paused / needs attention), live "now" strip of active runs across all agents (agent identity, current step title, progress, elapsed) — multiple agents visibly working at once.
- Roster: every agent with identity mark, name, role, live status, current activity, success rate, last run, 30-day cost; filters (status), "New agent".
- Runs: a filterable, live-updating list of ALL runs (status, kind, agent, project, date) — the execution history; selecting one opens the run detail.
- Agent detail: identity header (mark, name, role, status; actions: Run now (instruction dialog), Pause/Resume, Assign task (pick existing task or create one → assignTask), duplicate, archive, delete (confirm)). Tabs: Overview (stats + sparkline + current run live + recent runs), Runs, Configuration (instructions editor, model picker, autonomy segmented control with plain-language explanation, capability grants table — capability, providing integration + its connection status, allow/ask/deny — with links to connect missing integrations, knowledge scope (all / collections / projects), schedule presets + enabled, monthly budget), Activity (audit log).
- Run detail (shared component used by other workspaces too): header (title, status, agent, origin chip, RUN code, tokens, cost (estimate label when simulated), duration), live RunTimeline with expandable step details (input/output, refs, file changes), approvals inline, outputs as entity chips, controls (pause/resume/cancel/retry), "Send result to…" (task, knowledge).
- Create agent: template gallery → identity (name, role, hue) → instructions → capabilities + autonomy → knowledge scope → review & create; then "Run now".
E2E (e2e/agents.spec.ts): create an agent from a template and run it → run appears live and completes; approve the pending Herald Slack approval → run continues to success; pause an agent and see Run now disabled; change a capability grant to "deny".

## RESEARCH  (/research, /research/:investigationId)
Purpose: deep research — investigate, collect and assess sources, synthesize findings into reports that flow into knowledge, projects and code.
Must have:
- Research home: "New investigation" composer (question, depth quick/standard/deep with time/cost expectations, editable angles, project), investigations grouped Running / Ready for review / Complete / Drafts with progress and source counts.
- Investigation view: serif question title, status, depth, research agent identity, live run progress (current step), actions: Save to knowledge (idempotent; shows link after), Mark complete, Ask follow-up, Export Markdown (real download), Delete (confirm). Sections: Report (Markdown with [n] markers that reveal the cited source on hover/click), Sources (cards/list: kind, domain, credibility meter, status, SIMULATED badge for simulated web sources vs "Your knowledge" for retrieved items; filters; discard/restore; add manual source; source drawer showing content summary and honest notes), Findings (confidence, source chips, pin, add, "Create task from finding"), Activity (run timeline). Live: sources and findings appear as the run progresses.
- Handoffs: Discuss in chat (new thread with the report in context), Pin report to context, Create tasks from open questions, Use in code session.
E2E (e2e/research.spec.ts): start an investigation → sources stream in → report appears → Save to knowledge → the knowledge item shows a backlink to the investigation; open seeded complete investigation and click a citation.

## WORKFLOWS  (/workflows, /workflows/:workflowId)
Purpose: visual automation — triggers, agents, conditions, actions across integrations — understandable at a glance, observable in real time.
Must have:
- Index: workflow cards (name, trigger summary, enabled toggle, last run status, run count sparkline, project), New workflow (blank, templates, or "Describe it" → a heuristic draft graph built from the description via intent parsing — labeled as a template-based draft).
- Editor (@xyflow/react): custom node components per type (trigger, agent, action, condition with true/false outputs, transform, approval, delay, output) using the design tokens; add nodes from a palette; connect/disconnect edges; delete; inspector panel to edit the selected node (label; agent picker; integration + capability picker showing connection status; prompt/channel/expression/delay/output-kind fields); trigger configuration (manual / schedule presets / event list / webhook with a simulated URL); validation issues list (validateWorkflow) with node highlighting; autosave; Run now; enabled toggle; fit view/zoom/minimap.
- Live execution: while a run is active, nodes reflect step status by nodeId (running pulse, done, failed, skipped, waiting for approval) and the active edge animates; approvals inline in the run panel. Run history panel: past runs with status/duration; selecting one highlights the executed path and shows its RunTimeline.
E2E (e2e/workflows.spec.ts): open "Weekly project digest" → Run now → nodes light up → approval → approve → success; create from template, add a node, connect it, see validation update.

## KNOWLEDGE  (/knowledge, /knowledge/:itemId)
Purpose: the shared intelligence layer — everything the AI can draw on, searchable and interconnected.
Must have:
- Index: search (real local search with highlighted snippets), collections sidebar with counts, tags, filters (kind, source, project), sort, list/grid views, New note, Upload files (picker + drag-drop anywhere in the workspace; real text extraction; image previews; honest note for PDFs), Add link (URL + title; content not fetched — say so), bulk select → move/tag/delete.
- Item view: reader (Markdown) with edit mode (editor + preview, autosave), metadata (kind, source with a chip linking to its origin entity, collection, projects, tags editable, author, dates, word count), Connections: where it is used (threads that cited it, runs that retrieved it, investigations it sourced, tasks derived) via the link graph + citations, actions: Pin to context, Ask in chat (new thread with it in context), Research from this, Make task, Duplicate, Delete (confirm).
- Retrieval lab: a "What would the AI retrieve?" box that runs the real retrieval for a question and shows the passages + scores — makes the shared memory tangible.
E2E (e2e/knowledge.spec.ts): upload a markdown file → it appears → search finds it with highlight → open → pin to context → a new chat question cites it; edit a note and see it persist after reload.

## STUDIO  (/studio, /studio/:assetId)
Purpose: a creative studio for images, video, decks, copy and audio — generation, iteration, organization.
Must have:
- Studio home: generation bar (kind tabs Image/Video/Deck/Copy/Audio; prompt; kind-specific params: aspect, style, duration, slide count, format, voice; board picker) → asset appears immediately in a generating state with live progress, then its result. Boards sidebar (create/rename/delete), kind filter, favorites, masonry/grid of assets with procedural previews.
- Asset view: large preview by kind — image: procedural art render; video: storyboard player cycling through shot frames with subtle motion + shot list; deck: slide editor (edit title/body/layout/notes) + Present mode (fullscreen, arrow keys, Esc); copy: Markdown editor with variants; audio: narration script + waveform + "Preview with browser voice" using the real Web Speech API (labeled "browser voice preview"). Versions strip (select current, compare), actions: Variation, Edit with instruction, Favorite, Rename, Move to board, Download (image: real SVG/PNG export of the procedural render; deck/copy: .md/.html), Save to knowledge (copy/deck/script), Delete (confirm).
- Honesty: a persistent "Simulated generator" label on generated media; explain what a real generator connection would change.
E2E (e2e/studio.spec.ts): generate an image → appears → open → create a variation → 2 versions; open the deck → Present → arrow through slides → Esc.

## PROJECTS  (/projects, /projects/my-tasks, /projects/:projectId)
Purpose: organize goals, tasks, milestones and every piece of related work — for the user and for agents.
Must have:
- Projects index: project cards (hue/icon, goal, progress, active runs, next milestone, starred), New project dialog, archived toggle; "My tasks" entry.
- Project view: header (name, goal, status, star, "Make this my scope" — sets the global scope), tabs: Overview (goal, milestones timeline, progress, active work (live runs), pinned project memory editable (add/remove refs via search), linked work counts with links: conversations, investigations, sessions, workflows, assets, knowledge; recent activity), Tasks (Kanban with drag-and-drop across columns and reorder within a column, keyboard-accessible alternative (move via menu), list view toggle, filters (assignee incl. agents, priority, label), quick add per column), Timeline (milestones and dated tasks on a time axis), Activity (project feed), Settings (name, description, goal, AI instructions, hue/icon, linked repos, archive/delete with confirm).
- Task drawer (?task=): title, Markdown description, status, priority, assignee (user or agent — assigning an agent starts its run; show it live in the drawer), due date, milestone, labels, subtasks, origin chip, runs for this task, activity, delete.
- My tasks: tasks for the user across projects grouped Overdue / Today / This week / Later / No date, with quick complete.
E2E (e2e/projects.spec.ts): create a project → add a task → drag it to In progress → assign it to an agent → run starts and the task reaches Review; set a project as scope and see other workspaces filter.

## INSIGHTS  (/insights)
Purpose: meaningful visibility into activity, reliability and spend — not a wall of charts.
Must have:
- Controls: range 7/30/90 days, project filter, kind filter. Honesty banner when simulated activity is included ("Costs for simulated runs are estimates at Claude Sonnet 5.5 rates"); live usage (real API calls) reported separately when present.
- Headline tiles: runs + success rate, estimated spend vs monthly budget (meter), tokens, median run duration, approvals (pending, median time to decision), tasks completed.
- Charts (following the dataviz rules): runs per day by kind (stacked area or bars) with hover crosshair; spend per day; spend by model and by agent (bars); activity heatmap (weekday × hour); agent performance table (runs, success, avg duration, cost, sparkline); workflow reliability (runs, failure rate, avg duration); top failure reasons.
- Execution history table: searchable, sortable, paginated runs; row → run route. Every chart has a table/text alternative.
E2E (e2e/insights.spec.ts): page renders tiles and charts without errors; changing range updates the run count; clicking a history row navigates to the run.

## INTEGRATIONS  (/integrations, /integrations/:integrationId)
Purpose: connect services, govern what agents may do with them, see how they are used.
Must have:
- Catalog: Connected section first, then categories; search; cards with monogram, name, description, status (Connected / Error / Available), LIVE or SIMULATED support badge, usage count.
- Detail: header (status, mode badge, Connect / Reconnect / Disconnect (confirm) / Test connection), the honest support note, connect form (fields from the catalog; secrets masked; "stored only in this browser" explanation; validation e.g. Anthropic keys start with sk-ant-), permissions (per-capability allow/ask/deny with risk badges and explanations), usage (agents and workflows using it; recent run steps that used it with links), activity.
- Model providers: connecting Anthropic or an OpenAI-compatible endpoint immediately enables those models in every model picker; Test connection performs a real minimal request (live) and reports the result.
E2E (e2e/integrations.spec.ts): connect Slack (simulated) → Connected; set "Send messages" to deny; disconnect with confirm; Anthropic form rejects a malformed key (no network call in tests).

## SETTINGS  (/settings, /settings/:section)
Sections: Profile (name, email, identity hue), Appearance (theme dark/light/system, density, motion), AI & models (default model, effort, show reasoning, auto-retrieve knowledge), Safety & permissions (default autonomy with explanation, always-ask capabilities, confirm destructive actions, monthly budget), Notifications (toggles), Simulation (speed, plain explanation of what is simulated vs live), Data (storage usage by table, Export JSON (real download, excludes secrets), Import JSON (real file upload with validation and confirm), Reset demo world (confirm), Clear everything), Keyboard shortcuts (reference generated from the shortcut registry), About (version, honesty statement).
E2E (e2e/settings.spec.ts): switch to light theme and see it persist after reload; export downloads a JSON file; reset demo world restores seeded data.
