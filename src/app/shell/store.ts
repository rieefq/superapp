import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { EntityRef, ID } from '@/core/types'
import type { InspectorTab, WorkspaceId } from '../types'

/** Kinds the Start sheet can create (docs/DESIGN.md §5.4.11). */
export type StartKind = 'task' | 'research' | 'session' | 'agent' | 'workflow' | 'note' | 'studio'

export interface StartSheetState {
  open: boolean
  kind: StartKind
  /** The entity this work is derived from (attached as context; result links back to it). */
  source?: EntityRef
  /** Prefilled fields (title, brief, projectId, agentId, repoId, workflowId, …). */
  prefill?: Record<string, unknown>
  /** Start in the background (⌘⏎) by default. */
  background?: boolean
}

interface ShellState {
  /** Per-workspace Inspector state (persisted). */
  inspector: Partial<Record<WorkspaceId, { open: boolean; tab: InspectorTab }>>
  inspectorWidth: number
  /** Per-workspace list pane state (persisted). */
  listPane: Partial<Record<WorkspaceId, { open: boolean }>>
  listPaneWidth: number
  /** Globally attached run shown in Inspector › Run (not persisted). */
  attachedRunId: ID | null
  /** Peek history inside Inspector › Item (not persisted). */
  inspectStack: EntityRef[]
  /** Recently opened entities, newest first (max 20, persisted). */
  recents: EntityRef[]
  startSheet: StartSheetState
  commandOpen: boolean
  needsYouOpen: boolean

  setInspector: (ws: WorkspaceId, patch: Partial<{ open: boolean; tab: InspectorTab }>) => void
  toggleInspector: (ws: WorkspaceId) => void
  setInspectorWidth: (w: number) => void
  setListPane: (ws: WorkspaceId, open: boolean) => void
  toggleListPane: (ws: WorkspaceId) => void
  setListPaneWidth: (w: number) => void
  attachRun: (runId: ID | null) => void
  pushInspect: (ref: EntityRef) => void
  popInspect: () => void
  clearInspect: () => void
  touchRecent: (ref: EntityRef) => void
  openStart: (kind: StartKind, opts?: { source?: EntityRef; prefill?: Record<string, unknown>; background?: boolean }) => void
  closeStart: () => void
  setCommandOpen: (open: boolean) => void
  setNeedsYouOpen: (open: boolean) => void
}

const sameRef = (a: EntityRef, b: EntityRef) => a.kind === b.kind && a.id === b.id

export const useShellStore = create<ShellState>()(
  persist(
    (set, get) => ({
      inspector: {},
      inspectorWidth: 360,
      listPane: {},
      listPaneWidth: 280,
      attachedRunId: null,
      inspectStack: [],
      recents: [],
      startSheet: { open: false, kind: 'task' },
      commandOpen: false,
      needsYouOpen: false,

      setInspector: (ws, patch) =>
        set((s) => {
          const cur = s.inspector[ws] ?? { open: false, tab: 'item' as InspectorTab }
          return { inspector: { ...s.inspector, [ws]: { ...cur, ...patch } } }
        }),
      toggleInspector: (ws) => {
        const cur = get().inspector[ws]
        get().setInspector(ws, { open: !cur?.open })
      },
      setInspectorWidth: (w) => set({ inspectorWidth: Math.round(Math.min(520, Math.max(320, w))) }),
      setListPane: (ws, open) => set((s) => ({ listPane: { ...s.listPane, [ws]: { open } } })),
      toggleListPane: (ws) => {
        const cur = get().listPane[ws]
        get().setListPane(ws, !(cur?.open ?? true))
      },
      setListPaneWidth: (w) => set({ listPaneWidth: Math.round(Math.min(360, Math.max(240, w))) }),
      attachRun: (runId) => set({ attachedRunId: runId }),
      pushInspect: (ref) =>
        set((s) => {
          const last = s.inspectStack[s.inspectStack.length - 1]
          if (last && sameRef(last, ref)) return s
          return { inspectStack: [...s.inspectStack, ref].slice(-20) }
        }),
      popInspect: () => set((s) => ({ inspectStack: s.inspectStack.slice(0, -1) })),
      clearInspect: () => set({ inspectStack: [] }),
      touchRecent: (ref) =>
        set((s) => ({ recents: [ref, ...s.recents.filter((r) => !sameRef(r, ref))].slice(0, 20) })),
      openStart: (kind, opts) =>
        set({ startSheet: { open: true, kind, source: opts?.source, prefill: opts?.prefill, background: opts?.background } }),
      closeStart: () => set((s) => ({ startSheet: { ...s.startSheet, open: false } })),
      setCommandOpen: (open) => set({ commandOpen: open }),
      setNeedsYouOpen: (open) => set({ needsYouOpen: open }),
    }),
    {
      name: 'atrium.shell',
      version: 1,
      partialize: (s) => ({
        inspector: s.inspector,
        inspectorWidth: s.inspectorWidth,
        listPane: s.listPane,
        listPaneWidth: s.listPaneWidth,
        recents: s.recents,
      }),
    },
  ),
)

/** Open the Start sheet from anywhere (Turn into…, Home, ⌘K, workspace "New" actions). */
export function openStartSheet(kind: StartKind, opts?: { source?: EntityRef; prefill?: Record<string, unknown>; background?: boolean }): void {
  useShellStore.getState().openStart(kind, opts)
}

/** Attach a run to Inspector › Run (and open the Inspector for the given workspace). */
export function attachRun(runId: ID, ws?: WorkspaceId): void {
  const st = useShellStore.getState()
  st.attachRun(runId)
  if (ws) st.setInspector(ws, { open: true, tab: 'run' })
}
