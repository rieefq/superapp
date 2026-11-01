import { db } from '@/core/db'
import { layoutWorkflowGraph, saveWorkflowLayout, updateWorkflow } from '@/core/services/workflows'
import type { ID, WorkflowEdge, WorkflowNode, WorkflowNodeType } from '@/core/types'
import { toast } from '@/ui'
import { connect, connectionProblem, insertAfter, patchNode, removeEdge, removeNode, type Graph } from './graph'

/**
 * Editor writes. Every structural edit autosaves through `updateWorkflow` (coalesced: one version and
 * one activity event per editing session); positions save through `saveWorkflowLayout`. Each function
 * reads the current workflow from the database, so callers never act on a stale copy.
 */

function graphOf(wfId: ID): Graph | null {
  const wf = db.get('workflows', wfId)
  return wf ? { nodes: wf.nodes, edges: wf.edges } : null
}

export function applyGraph(wfId: ID, graph: Graph): void {
  updateWorkflow(wfId, { nodes: graph.nodes, edges: graph.edges }, { coalesce: true })
}

/** Add a step after `afterId` (or at the end of the main path). Returns the new step's id. */
export function addStep(wfId: ID, type: WorkflowNodeType, afterId?: string | null, overrides: Partial<WorkflowNode> = {}): string | null {
  const g = graphOf(wfId)
  if (!g) return null
  const result = insertAfter(g, type, afterId, overrides)
  applyGraph(wfId, result)
  return result.nodeId
}

/** Delete a step (bridging a simple chain) with an Undo toast that puts it back. */
export function deleteStep(wfId: ID, nodeId: string, opts: { onUndo?: (nodeId: string) => void } = {}): void {
  const g = graphOf(wfId)
  const node = g?.nodes.find((n) => n.id === nodeId)
  if (!g || !node) return
  const removedEdges = g.edges.filter((e) => e.source === nodeId || e.target === nodeId)
  const next = removeNode(g, nodeId)
  const bridges = next.edges.filter((e) => !g.edges.some((x) => x.id === e.id)).map((e) => e.id)
  applyGraph(wfId, next)
  toast(`Deleted “${node.label}”`, {
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        restoreStep(wfId, node, removedEdges, bridges)
        opts.onUndo?.(node.id)
      },
    },
  })
}

/** Put a deleted step back with the connections it had (whose other end still exists). */
export function restoreStep(wfId: ID, node: WorkflowNode, edges: WorkflowEdge[], bridgeIds: string[] = []): void {
  const g = graphOf(wfId)
  if (!g || g.nodes.some((n) => n.id === node.id)) return
  const ids = new Set([...g.nodes.map((n) => n.id), node.id])
  const kept = g.edges.filter((e) => !bridgeIds.includes(e.id))
  const back = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && !kept.some((k) => k.id === e.id))
  applyGraph(wfId, { nodes: [...g.nodes, node], edges: [...kept, ...back] })
}

/** Connect two steps. Returns the reason when the connection isn't allowed (and changes nothing). */
export function connectSteps(wfId: ID, source: string, target: string, handle?: string | null): string | null {
  const g = graphOf(wfId)
  if (!g) return 'This workflow no longer exists.'
  const problem = connectionProblem(g, source, target, handle)
  if (problem) return problem
  applyGraph(wfId, connect(g, source, target, handle))
  return null
}

/** Remove a connection, with Undo. */
export function disconnect(wfId: ID, edgeId: string): void {
  const g = graphOf(wfId)
  const edge = g?.edges.find((e) => e.id === edgeId)
  if (!g || !edge) return
  applyGraph(wfId, removeEdge(g, edgeId))
  const from = g.nodes.find((n) => n.id === edge.source)?.label
  const to = g.nodes.find((n) => n.id === edge.target)?.label
  toast('Connection removed', {
    description: from && to ? `${from} → ${to}` : undefined,
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        const cur = graphOf(wfId)
        if (!cur || cur.edges.some((e) => e.id === edge.id)) return
        if (!cur.nodes.some((n) => n.id === edge.source) || !cur.nodes.some((n) => n.id === edge.target)) return
        applyGraph(wfId, { nodes: cur.nodes, edges: [...cur.edges, edge] })
      },
    },
  })
}

/** Patch one step's settings (label, config, agent, integration, capability). */
export function updateStep(wfId: ID, nodeId: string, patch: Partial<WorkflowNode>): void {
  const g = graphOf(wfId)
  if (!g) return
  applyGraph(wfId, patchNode(g, nodeId, patch))
}

/** Patch one step's config keys (undefined removes a key). */
export function updateStepConfig(wfId: ID, nodeId: string, config: Record<string, unknown>): void {
  const g = graphOf(wfId)
  const node = g?.nodes.find((n) => n.id === nodeId)
  if (!g || !node) return
  const next: Record<string, unknown> = { ...node.config }
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined || v === '') delete next[k]
    else next[k] = v
  }
  applyGraph(wfId, patchNode(g, nodeId, { config: next }))
}

/** Lay the graph out top to bottom (positions only — no new version). */
export function autoLayout(wfId: ID): void {
  const g = graphOf(wfId)
  if (!g) return
  const laid = layoutWorkflowGraph(g.nodes, g.edges)
  saveWorkflowLayout(wfId, Object.fromEntries(laid.map((n) => [n.id, n.position])))
}

/** Save positions after a drag or nudge. */
export function savePositions(wfId: ID, positions: Record<string, { x: number; y: number }>): void {
  saveWorkflowLayout(wfId, positions)
}
