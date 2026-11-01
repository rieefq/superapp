# Shared connected components

The building blocks every workspace uses to **start work**, **show context** and **land results**
(docs/DESIGN.md §5.4.10–§5.4.15, §7). They are *connected*: they read the database and call the core
services, so a workspace only wires them to its own state. Import everything from `@/app/components`.
Home (`src/workspaces/home`) is the reference implementation.

| Component | Use it for |
|---|---|
| `Composer` | Every composer that talks to a model or starts work (§5.4.10) |
| `useComposerContext()` | The exact context an action will send — pass `refs` to your service |
| `ContextLine`, `ContextMeter` | Already inside the Composer; use alone in custom forms |
| `StartSheet` / `StartPanel` | The Start sheet (mounted by the shell) / the inline form (new Code session, new brief) |
| `ReadBack`, `ReadBackLine`, `useReadBack()` | Read a run's plan back before it starts (§5.4.11) |
| `DerivedList`, `DerivedRow`, `LandedCard`, `useDerived()` | What was made from a source, while it works and when it lands (§5.4.12) |
| `TurnIntoMenu` (`T`), `HoldButton` (`H`), `SaveToKnowledgeButton` (`S`) | Entity actions (§7.1) |
| `SelectionActions` | The selection toolbar wired to Ask · Research · Make task · Save snippet · Copy (§5.4.15) |
| `RunPanel` | A run's timeline with approvals, Pause/Resume/Stop/Retry and the Colophon |
| `ProjectPicker`, `AgentPicker`, `RepoPicker`, `CollectionPicker`, `WorkflowPicker`, `ModelPicker`, `EntityPicker`, `Picker` | Keyboard-friendly popover comboboxes |

## Composer

```tsx
// In place (Chat): Send; ⌘⏎ also sends; typing while a reply streams queues the message.
const ctx = useComposerContext({ attached: thread.contextRefs, onAttachedChange: setThreadContext, label: `Chat · ${thread.title}` })
<Composer
  context={ctx}
  placeholder="Ask anything — @ to add context, / for actions"
  slashCommands={manifest.composer?.slashCommands}
  onSlashCommand={(cmd, args, meta) => runSlash(cmd, args, meta)}   // return false to send as text
  modelId={thread.modelId}
  onModelChange={(id) => setThreadModel(thread.id, id)}
  streaming={isGenerating}
  onStop={() => stopGeneration(lastAssistantId)}
  onEditLast={editLastMessage}                                      // ↑ in an empty composer
  dropTarget={stageRef}                                             // files dropped on the stage attach
  onSubmit={(text, { attachments, context, modelId }) =>
    sendMessage({ threadId: thread.id, text, attachments, contextRefs: context.attached, modelId })}
/>

// Navigating (Agents › assign, Research brief): split "Run ▾ / Run in background ⌘⏎" and a ReadBack line.
<Composer backgroundable submitLabel="Assign" readBack={<ReadBackLine data={useReadBack({ kind: 'agent', agentId })} />}
  onSubmit={(text, { background }) => …} />
```

- `size`: `hero` (64px input, Home) · `default` (44px) · `compact` (36px, the Context Line collapses to `Context · n`).
- `onSubmit(text, meta)`: `meta = { background, attachments, context, modelId, effort }`. Throwing (or rejecting)
  gives the draft back and shows the error in a toast.
- `context.refs` is **exactly** what the Context Line shows as included: `projectId`, `projectMemory` /
  `memoryParts` / `memoryRefs`, `held`, `attached`, `likely`, `attachments`, `all`, `excluded`, `tokens`.
  “No context reaches a model unless it appears in the Context Line.”
- Toolbar: attach (real local file reading: text extracted, image thumbnails), `@` mention menu
  (Held · Project memory · Knowledge · Files · Runs · Agents · Tasks → Attached chips; agents also insert
  `@Name `), the model chip (SIM chip for the Simulator; unavailable live models say why), effort (reasoning
  models; writes `settings.ai.effort`), the ContextMeter and the submit control.
- The input is marked `data-composer-input`, so the shell's `/` focuses it. The focused composer publishes
  its context to Inspector › Context and honours toggles made there.
- Other slots: `above` (inside, at the top — Home's verb chips), `below` (under the input), `projectSlot`,
  `agentSlot`, `reason` (+ `disabled`), `value`/`onValueChange` (controlled draft), `onKeyDown` (runs first;
  `preventDefault()` to take a key over).

## Start sheet

The shell mounts `StartSheetHost` once. Open it from anywhere:

```ts
openStartSheet('research', { source: { kind: 'message', id }, prefill: { brief: selection } })
openStartSheet('session', { prefill: { brief, repoId, taskId, autonomy: 'supervised' }, background: true })
```

Kinds: `task · research · session · agent · workflow · note · studio`. Prefill keys: `title`, `brief` (or
`question` / `instruction` / `prompt`), `projectId`, `agentId`, `repoId`, `taskId`, `workflowId`, `depth`,
`angles`, `assignee` (`'me'` or an agent id), `priority`, `due` (yyyy-mm-dd), `milestoneId`, `collectionId`,
`tags`, `studioKind` (`document | presentation | image | video`), `boardId`, `autonomy`, `attached` (refs).
With a `source`, work starts through the handoff functions (`toTask`, `toInvestigation`, …) so origins,
`derived_from` links and message backlinks are recorded. `⏎` starts and navigates; `⌘⏎` starts in the background
with a toast `Started in background · RUN-XXXX · Open`. `startEvents.on('started', …)` fires after each start.

`<StartPanel variant="inline" kind="session" prefill={…} onClose={…} />` renders the same form inside a stage.

## Landing

```tsx
<DerivedList source={{ kind: 'message', id: message.id }} />   // rows while working, cards when landed
<LandedCard run={run} subject={{ kind: 'investigation', id }} compact onSeen={() => markRead(n.id)} />
```

## Entity actions

```tsx
const rowRef = useRef<HTMLDivElement>(null)   // T / H / S fire while focus is inside this element
<TurnIntoMenu entity={ref} hotkeyScope={rowRef} />
<HoldButton entity={ref} iconOnly hotkeyScope={rowRef} />
<SaveToKnowledgeButton entity={ref} hotkeyScope={rowRef} />
<SelectionActions containerRef={transcriptRef} source={{ kind: 'message', id }} onAsk={quoteIntoComposer} />
```

## Pickers

```tsx
<Field label="Project"><ProjectPicker value={projectId} onChange={setProjectId} /></Field>
<AgentPicker value={agentId} onChange={setAgentId} variant="chip" />
<EntityPicker kinds={['task']} value={taskRef} onChange={setTaskRef} placeholder="No linked task" />
```

Every picker takes `variant` (`field` | `chip`) or a custom `trigger` render function, and is fully keyboard
operable (↑↓ Home End, ⏎ picks, Esc closes and returns focus, type to filter).

## Honesty

Delegated runs are simulated in this build: the ReadBack says `Simulator · Deep SIM · no model is called`, every
capability row is tagged `LIVE` (Atrium's own knowledge and tasks, GitHub reads for live repositories) or `SIM`,
and costs are `est.` at reference pricing. Budget caps stop a run when its *estimated* cost reaches the cap, while
Atrium is open.
