# Workspace templates

Every workspace is one of five templates inside the shell frame (docs/DESIGN.md §6.0): **list pane | stage | Inspector**.
Import everything from `@/app/templates`. Never add chrome to the top bar, rail or Run Line from a workspace.

| Template | Use for | Composition |
|---|---|---|
| `PageTemplate` | Home (1120), Insights (1280), Projects index (1280) | centered column, no list pane |
| `SessionTemplate` | Chat, Research, Code, agent detail | list pane + stage (header, scrolling body, docked composer) |
| `BoardTemplate` | Agents › Runs, Agents › Roster | stage with a 40px filter row over a banded DataTable or card grid |
| `CanvasTemplate` | Workflows | list pane + full-bleed canvas, floating toolbar, bottom drawer |
| `LibraryTemplate` | Knowledge, Studio, Integrations, Settings, project pages | list pane + search/view row + list/grid, or a detail |

## The docking rule (implemented for you)

The shell measures the space and decides; templates follow (`useShellLayout().docking`):

1. Dock the Inspector if the stage stays ≥ 640px.
2. If not, auto-collapse the list pane first.
3. If it still doesn't fit, the Inspector floats over the stage (e2, no scrim).

Ranges (§3.12): laptops (1024–1279) always float the Inspector; tablets (768–1023) turn the list pane into an
overlay drawer (300px) and the Inspector into an overlay sheet (380px); phones (<768) use single-pane push
navigation (`phoneView`) and a bottom-sheet Inspector. List pane: 280px (300 at ≥1920), resizable 240–360 by its
edge (double-click resets), `[` toggles it. Inspector: 360px (420 at ≥1920), `]` / ⌘\ toggles it.

## Building blocks

- `WorkspaceScreen({ list?, phoneView?, children })` — list pane | stage. Registers the list with the shell.
- `ListPane({ title, count?, onNew?, newLabel?, search?, scopeToggle?, filters?, footer?, children })` — 48px header
  (title, mono count, "+ New" `N`), optional 32px search (`{ value, onChange, placeholder }` or a node), optional
  `This project · All` toggle (shown only while scoped).
- `ListGroup({ label, count? })`, `ListRow({ to? | onClick?, selected?, leading?, title, secondary?, meta?, trailing?, entity? })`
  — rows are 36px (56px with `secondary`; 28/48 in compact density). Selected rows use the accent tint.
- `ListRows({ label })` — wrap rows for the list keyboard: one tab stop, ↑↓ / J K, Home/End, type-ahead,
  ⏎ opens, Space inspects the row's `entity` (`?inspect=`).
- `ScopeFilterRow({ onShowAll? })` — `Filtered to Atlas Portal v2 · Show all` on every list filtered to the scope.
- `Stage({ primary?, header?, toolbar?, composer?, measure?, scroll?, padded? })` — declares the stage's primary object
  (Inspector › Item, tab title), caps reading width (`chat` 712 · `doc` min(68ch, 720) · `home` 1120 · `insights` 1280 ·
  `full` · px), docks the composer under the body with the same cap.
- `StageHeader({ title, onRename?, leading?, status?, tabs?, actions?, menu?, backTo? })` — 48px: list toggle (when the
  pane is hidden) · title (inline rename) · status chip · underline tabs (drop to a second 40px row when narrow) ·
  up to 3 actions + ⋯ · Inspector toggle. Phones get a back button to the list.
- `useStagePrimary(ref)` — declare the primary object without a `Stage`.
- `useInspectEntity()` — open any entity in Inspector › Item from code.

Mark the composer's input with `data-composer-input` so `/` focuses it (search fields get `data-search-input`;
the shared `Composer` already does). A live demo of every template inside the real shell runs at `/dev/templates`
in development (`?t=session|board|canvas|library`).

Selections: call `setSelection(ref)` (from `@/app/shell/store`) when a row/card/node is selected so Inspector › Item
follows it; a selection only applies in the workspace it was made in. `Stage` declares its `primary` for you.

## Examples

```tsx
// Chat — Session template
import { ListPane, ListRow, ListRows, ListGroup, ScopeFilterRow, SessionTemplate, StageHeader } from '@/app/templates'

export default function ChatWorkspace() {
  const { threadId } = useParams()
  const thread = useRow('threads', threadId)
  return (
    <SessionTemplate
      phoneView={threadId ? 'stage' : 'list'}
      primary={thread ? { kind: 'thread', id: thread.id } : null}
      list={
        <ListPane title="Conversations" count={threads.length} onNew={() => navigate('/chat')} search={{ value: q, onChange: setQ, placeholder: 'Search conversations' }}>
          <ScopeFilterRow />
          <ListRows label="Conversations">
            <ListGroup label="Today">
              {threads.map((t) => (
                <ListRow key={t.id} to={`/chat/${t.id}`} entity={{ kind: 'thread', id: t.id }} title={t.title} meta={timeAgo(t.updatedAt)} />
              ))}
            </ListGroup>
          </ListRows>
        </ListPane>
      }
      header={<StageHeader title={thread?.title ?? 'New conversation'} onRename={(t) => renameThread(thread!.id, t)} menu={menuItems} />}
      composer={<Composer placeholder="Ask anything" onSubmit={send} />}
    >
      <Transcript threadId={threadId} />
    </SessionTemplate>
  )
}
```

```tsx
// Home — Page template
<PageTemplate width="home">
  <StateSentence />
  <NeedsYouSection />
</PageTemplate>

// Agents › Runs — Board template
<BoardTemplate header={<StageHeader title="All runs" tabs={{ items, value, onChange }} />} filters={<RunFilters />} padded={false}>
  <DataTable … />
</BoardTemplate>

// Workflows — Canvas template
<CanvasTemplate
  list={<ListPane title="Workflows" …>…</ListPane>}
  header={<StageHeader title={wf.name} onRename={…} status={<EnabledChip />} />}
  toolbar={<CanvasTools />}
  drawer={{ open: !!runId, onOpenChange: closeRun, title: 'Run overlay', children: <RunTimeline run={run} compact /> }}
>
  <ReactFlow … />
</CanvasTemplate>

// Knowledge — Library template
<LibraryTemplate list={<CollectionsPane />} header={<StageHeader title="Library" />} toolbar={<SearchAndViewSwitch />}>
  <KnowledgeGrid />
</LibraryTemplate>
```

## Shell API workspaces may use

From `@/app/shell/store`: `openStartSheet(kind, { source?, prefill?, background? })`, `attachRun(runId, workspaceId?)`,
`openCommandCenter(seed?)`, `setSelection(ref | null)`, `setStagePrimary(ref | null)`, `setComposerContext(snapshot | null)`
(publish what the focused composer would send so Inspector › Context can show it; read `composerContext.off` /
`memoryOff` to honour toggles made there). From `@/app/commands/registry`: `useRegisterCommands(id, commands)` to add
contextual commands to ⌘K's "Actions for this view".
