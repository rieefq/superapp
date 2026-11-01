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

/**
 * What the focused composer is about to send (published by the ContextLine), shown in
 * Inspector › Context. Every list holds refs; `off` lists refs switched off for this action.
 */
export interface ComposerContextSnapshot {
  /** Where the composer lives, e.g. "Chat · Stripe migration risks". */
  label?: string
  projectId?: ID | null
  held?: EntityRef[]
  attached?: EntityRef[]
  likely?: EntityRef[]
  /** Refs switched off for this action (struck through). */
  off?: EntityRef[]
  /** Model the composer will use. */
  modelId?: string
}

/** Default pane widths (docs/DESIGN.md §3.4/§3.5); the wide range (≥1920) uses the larger default. */
export const LIST_PANE_DEFAULT = 280
export const LIST_PANE_WIDE_DEFAULT = 300
export const LIST_PANE_MIN = 240
export const LIST_PANE_MAX = 360
export const INSPECTOR_DEFAULT = 360
export const INSPECTOR_WIDE_DEFAULT = 420
export const INSPECTOR_MIN = 320
export const INSPECTOR_MAX = 520

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

  // ---- additions (not persisted) ------------------------------------------------------------
  /** Text the command center opens with (e.g. '?' for quick ask, '#' to switch project). */
  commandSeed: string
  /** Which tab the Needs-you popover opens on. */
  needsYouTab: 'needs' | 'updates'
  projectSwitcherOpen: boolean
  holdingOpen: boolean
  shortcutsOpen: boolean
  whatsRealOpen: boolean
  /** Phone: the More sheet (every workspace). */
  moreOpen: boolean
  /** Tablet: the list pane overlay drawer. */
  listDrawerOpen: boolean
  /** The stage's primary object (the open thread, report, session…), set by the workspace. */
  stagePrimary: EntityRef | null
  /** The current selection inside the workspace (a list row, a node, a card). */
  selection: EntityRef | null
  /** What the focused composer would send (Inspector › Context). */
  composerContext: ComposerContextSnapshot | null

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

  /** Open the command center with an initial query (prefix) — '' for a blank search. */
  openCommand: (seed?: string) => void
  setNeedsYouTab: (tab: 'needs' | 'updates') => void
  setProjectSwitcherOpen: (open: boolean) => void
  setHoldingOpen: (open: boolean) => void
  setShortcutsOpen: (open: boolean) => void
  setWhatsRealOpen: (open: boolean) => void
  setMoreOpen: (open: boolean) => void
  setListDrawerOpen: (open: boolean) => void
  setStagePrimary: (ref: EntityRef | null) => void
  setSelection: (ref: EntityRef | null) => void
  setComposerContext: (ctx: ComposerContextSnapshot | null) => void
  /** Close every Inspector (used when the viewport starts below the docking range). */
  closeAllInspectors: () => void
}

const sameRef = (a: EntityRef, b: EntityRef) => a.kind === b.kind && a.id === b.id
const sameNullableRef = (a: EntityRef | null, b: EntityRef | null) => (a && b ? sameRef(a, b) : a === b)

export const useShellStore = create<ShellState>()(
  persist(
    (set, get) => ({
      inspector: {},
      inspectorWidth: INSPECTOR_DEFAULT,
      listPane: {},
      listPaneWidth: LIST_PANE_DEFAULT,
      attachedRunId: null,
      inspectStack: [],
      recents: [],
      startSheet: { open: false, kind: 'task' },
      commandOpen: false,
      needsYouOpen: false,

      commandSeed: '',
      needsYouTab: 'needs',
      projectSwitcherOpen: false,
      holdingOpen: false,
      shortcutsOpen: false,
      whatsRealOpen: false,
      moreOpen: false,
      listDrawerOpen: false,
      stagePrimary: null,
      selection: null,
      composerContext: null,

      setInspector: (ws, patch) =>
        set((s) => {
          const cur = s.inspector[ws] ?? { open: false, tab: 'item' as InspectorTab }
          const next = { ...cur, ...patch }
          if (next.open === cur.open && next.tab === cur.tab) return s
          return { inspector: { ...s.inspector, [ws]: next } }
        }),
      toggleInspector: (ws) => {
        const cur = get().inspector[ws]
        get().setInspector(ws, { open: !cur?.open })
      },
      setInspectorWidth: (w) => set({ inspectorWidth: Math.round(Math.min(INSPECTOR_MAX, Math.max(INSPECTOR_MIN, w))) }),
      setListPane: (ws, open) => set((s) => ({ listPane: { ...s.listPane, [ws]: { open } } })),
      toggleListPane: (ws) => {
        const cur = get().listPane[ws]
        get().setListPane(ws, !(cur?.open ?? true))
      },
      setListPaneWidth: (w) => set({ listPaneWidth: Math.round(Math.min(LIST_PANE_MAX, Math.max(LIST_PANE_MIN, w))) }),
      attachRun: (runId) => set({ attachedRunId: runId }),
      pushInspect: (ref) =>
        set((s) => {
          const last = s.inspectStack[s.inspectStack.length - 1]
          if (last && sameRef(last, ref)) return s
          return { inspectStack: [...s.inspectStack, ref].slice(-20) }
        }),
      popInspect: () => set((s) => ({ inspectStack: s.inspectStack.slice(0, -1) })),
      clearInspect: () => set((s) => (s.inspectStack.length ? { inspectStack: [] } : s)),
      touchRecent: (ref) =>
        set((s) => {
          if (s.recents[0] && sameRef(s.recents[0], ref)) return s
          return { recents: [ref, ...s.recents.filter((r) => !sameRef(r, ref))].slice(0, 20) }
        }),
      openStart: (kind, opts) =>
        set({ startSheet: { open: true, kind, source: opts?.source, prefill: opts?.prefill, background: opts?.background } }),
      closeStart: () => set((s) => ({ startSheet: { ...s.startSheet, open: false } })),
      setCommandOpen: (open) => set(open ? { commandOpen: true } : { commandOpen: false, commandSeed: '' }),
      setNeedsYouOpen: (open) => set({ needsYouOpen: open }),

      openCommand: (seed = '') => set({ commandOpen: true, commandSeed: seed }),
      setNeedsYouTab: (tab) => set({ needsYouTab: tab }),
      setProjectSwitcherOpen: (open) => set({ projectSwitcherOpen: open }),
      setHoldingOpen: (open) => set({ holdingOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setWhatsRealOpen: (open) => set({ whatsRealOpen: open }),
      setMoreOpen: (open) => set({ moreOpen: open }),
      setListDrawerOpen: (open) => set({ listDrawerOpen: open }),
      setStagePrimary: (ref) => set((s) => (sameNullableRef(s.stagePrimary, ref) ? s : { stagePrimary: ref })),
      setSelection: (ref) => set((s) => (sameNullableRef(s.selection, ref) ? s : { selection: ref })),
      setComposerContext: (ctx) => set({ composerContext: ctx }),
      closeAllInspectors: () =>
        set((s) => {
          const entries = Object.entries(s.inspector) as [WorkspaceId, { open: boolean; tab: InspectorTab }][]
          if (!entries.some(([, v]) => v.open)) return s
          return { inspector: Object.fromEntries(entries.map(([k, v]) => [k, { ...v, open: false }])) }
        }),
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

/** Open the command center, optionally seeded with a prefix ('?' quick ask, '>' commands, '#' projects, '@' items). */
export function openCommandCenter(seed = ''): void {
  useShellStore.getState().openCommand(seed)
}

/**
 * Declare the stage's primary object (the open thread, report, session…). The Inspector's Item tab
 * shows it when nothing is selected, and the tab title uses its name. Pass null when the stage
 * shows no single object. Workspaces usually do this through `<Stage primary={ref}>`.
 */
export function setStagePrimary(ref: EntityRef | null): void {
  useShellStore.getState().setStagePrimary(ref)
}

/** Declare the current selection (Inspector › Item follows it while open). */
export function setSelection(ref: EntityRef | null): void {
  useShellStore.getState().setSelection(ref)
}

/** Publish what the focused composer would send, for Inspector › Context (null when it unmounts). */
export function setComposerContext(ctx: ComposerContextSnapshot | null): void {
  useShellStore.getState().setComposerContext(ctx)
}
