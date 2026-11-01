import { create } from 'zustand'
import { useShellStore } from '@/app/shell/store'
import type { ID } from '@/core/types'

/**
 * Editor selection, shared by the canvas, the outline and the workflow lens (Inspector › Item shows
 * the selected step's settings, or the workflow when no step is selected). Not persisted.
 */
interface EditorState {
  workflowId: ID | null
  /** Selected step (node id) in `workflowId`. */
  nodeId: string | null
  /** Selected connection (edge id) in `workflowId`. */
  edgeId: string | null
  /** The run drawn over the canvas (live while it runs; a past run when picked from the runs list). */
  overlayRunId: ID | null
  /** The runs drawer is open (280px table) instead of the 36px bar. */
  drawerOpen: boolean
  /** The problems panel on the canvas is expanded. */
  issuesOpen: boolean
  setDrawerOpen: (open: boolean) => void
  setIssuesOpen: (open: boolean) => void
  select: (workflowId: ID | null, nodeId: string | null) => void
  selectEdge: (workflowId: ID | null, edgeId: string | null) => void
  setOverlayRun: (runId: ID | null) => void
}

export const useEditorStore = create<EditorState>()((set) => ({
  workflowId: null,
  nodeId: null,
  edgeId: null,
  overlayRunId: null,
  drawerOpen: false,
  issuesOpen: true,
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setIssuesOpen: (issuesOpen) => set({ issuesOpen }),
  select: (workflowId, nodeId) => set((s) => (s.workflowId === workflowId && s.nodeId === nodeId && !s.edgeId ? s : { workflowId, nodeId, edgeId: null })),
  selectEdge: (workflowId, edgeId) => set((s) => (s.workflowId === workflowId && s.edgeId === edgeId && !s.nodeId ? s : { workflowId, edgeId, nodeId: null })),
  setOverlayRun: (overlayRunId) => set((s) => (s.overlayRunId === overlayRunId ? s : { overlayRunId })),
}))

/** The selected step of a workflow (null when the selection belongs to another workflow). */
export function useSelectedNodeId(workflowId: ID | null | undefined): string | null {
  return useEditorStore((s) => (workflowId && s.workflowId === workflowId ? s.nodeId : null))
}

/** Select a step; `inspect` also opens Inspector › Item, where its settings live. */
export function selectStep(workflowId: ID, nodeId: string | null, opts: { inspect?: boolean } = {}): void {
  useEditorStore.getState().select(workflowId, nodeId)
  if (nodeId && opts.inspect) useShellStore.getState().setInspector('workflows', { open: true, tab: 'item' })
}
