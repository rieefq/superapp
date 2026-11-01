import { FLOW_GRID, reachableFrom } from '@/core/sim/workflow'
import type { WorkflowEdge, WorkflowNode, WorkflowNodeType } from '@/core/types'
import { newId } from '@/lib/id'
import { NODE_TYPES } from './nodeMeta'

/**
 * Pure graph edits for the editor (canvas and outline share them). Every function returns a new
 * { nodes, edges } and never mutates its input.
 */

export interface Graph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export type Handle = 'true' | 'false'

const BRANCH_LABEL: Record<Handle, string> = { true: 'Yes', false: 'No' }

/** An edge leaving `source` (with the Yes/No label for condition branches). */
export function makeEdge(source: string, target: string, handle?: string | null): WorkflowEdge {
  const h = handle === 'true' || handle === 'false' ? handle : undefined
  return { id: newId('edg'), source, target, ...(h ? { sourceHandle: h, label: BRANCH_LABEL[h] } : {}) }
}

/** Handles of a condition node that have no edge yet ("true" first). */
export function freeBranches(graph: Graph, nodeId: string): Handle[] {
  const used = new Set(graph.edges.filter((e) => e.source === nodeId).map((e) => e.sourceHandle ?? 'true'))
  return (['true', 'false'] as const).filter((h) => !used.has(h))
}

/** Would connecting source → target create a loop, a duplicate, a self-edge or an edge into a trigger? */
export function connectionProblem(graph: Graph, source: string, target: string, handle?: string | null): string | null {
  if (source === target) return 'A step can’t connect to itself.'
  const to = graph.nodes.find((n) => n.id === target)
  const from = graph.nodes.find((n) => n.id === source)
  if (!to || !from) return 'That step no longer exists.'
  if (to.type === 'trigger') return 'Nothing runs before the trigger.'
  if (graph.edges.some((e) => e.source === source && e.target === target && (e.sourceHandle ?? null) === (handle ?? null))) return 'These steps are already connected.'
  if (reachableFrom(target, graph.edges).has(source)) return 'That would make a loop; workflows must not loop.'
  return null
}

/** Connect two steps (no-op when the connection would be invalid). */
export function connect(graph: Graph, source: string, target: string, handle?: string | null): Graph {
  if (connectionProblem(graph, source, target, handle)) return graph
  const from = graph.nodes.find((n) => n.id === source)!
  // A condition's branch leads to one place: reconnecting a branch replaces it.
  const h = from.type === 'condition' ? (handle === 'false' ? 'false' : 'true') : undefined
  const edges = h ? graph.edges.filter((e) => !(e.source === source && (e.sourceHandle ?? 'true') === h)) : graph.edges
  return { nodes: graph.nodes, edges: [...edges, makeEdge(source, target, h)] }
}

export function removeEdge(graph: Graph, edgeId: string): Graph {
  return { nodes: graph.nodes, edges: graph.edges.filter((e) => e.id !== edgeId) }
}

/** Remove a step and its connections. A step between two others is bridged (a → x → b becomes a → b). */
export function removeNode(graph: Graph, nodeId: string): Graph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return graph
  const incoming = graph.edges.filter((e) => e.target === nodeId)
  const outgoing = graph.edges.filter((e) => e.source === nodeId)
  let edges = graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
  const nodes = graph.nodes.filter((n) => n.id !== nodeId)
  // Bridge only the simple case: one way in, one way out, and the step wasn't a branch point.
  if (incoming.length === 1 && outgoing.length === 1 && node.type !== 'condition') {
    const bridged: Graph = { nodes, edges }
    const inc = incoming[0]
    if (!connectionProblem(bridged, inc.source, outgoing[0].target, inc.sourceHandle)) {
      edges = [...edges, { ...makeEdge(inc.source, outgoing[0].target, inc.sourceHandle), ...(inc.label && !inc.sourceHandle ? { label: inc.label } : {}) }]
    }
  }
  return { nodes, edges }
}

/** Below the lowest step, centered on `x` (a free spot for a new, unconnected step). */
function belowEverything(graph: Graph, x = 0): { x: number; y: number } {
  const maxY = graph.nodes.reduce((m, n) => Math.max(m, n.position.y), -FLOW_GRID.row)
  return { x, y: maxY + FLOW_GRID.row }
}

export interface InsertResult extends Graph {
  /** The new step's id. */
  nodeId: string
}

/**
 * Insert a new step of `type` after `afterId` (docs/DESIGN.md §6.6: "inserted after the selection and
 * connected automatically"): it takes over the selection's outgoing connections (a condition gives it
 * its first free branch) and everything below moves down one row. Without a selection it goes after
 * the last step of the main path.
 */
export function insertAfter(graph: Graph, type: WorkflowNodeType, afterId?: string | null, overrides: Partial<WorkflowNode> = {}): InsertResult {
  const meta = NODE_TYPES[type].create()
  const id = newId('nod')
  const after = afterId ? graph.nodes.find((n) => n.id === afterId) : lastOnMainPath(graph)
  const base: WorkflowNode = { id, position: { x: 0, y: 0 }, ...meta, ...overrides } as WorkflowNode
  if (!after) {
    return { nodeId: id, nodes: [...graph.nodes, { ...base, position: belowEverything(graph) }], edges: graph.edges }
  }
  if (after.type === 'condition') {
    // A new branch: the first free handle (Yes, then No), placed under the condition on that side.
    const free = freeBranches(graph, after.id)
    const handle: Handle = free[0] ?? 'true'
    const dx = handle === 'true' ? -FLOW_GRID.column / 2 : FLOW_GRID.column / 2
    const position = { x: after.position.x + (free.length === 2 ? 0 : dx), y: after.position.y + FLOW_GRID.row }
    const shifted = shiftDown(graph, after.id, position)
    const next = connect({ nodes: [...shifted.nodes, { ...base, position }], edges: shifted.edges }, after.id, id, handle)
    return { nodeId: id, ...next }
  }
  // Take over the outgoing connections: after → new → (previous targets).
  const outgoing = graph.edges.filter((e) => e.source === after.id)
  const position = { x: after.position.x, y: after.position.y + FLOW_GRID.row }
  const shifted = shiftDown(graph, after.id, position)
  const edges = [
    ...shifted.edges.filter((e) => e.source !== after.id),
    makeEdge(after.id, id),
    ...outgoing.map((e) => ({ ...e, source: id, ...(type === 'condition' ? { sourceHandle: 'true', label: 'Yes' } : { sourceHandle: undefined, label: undefined }) })),
  ].map((e) => {
    // Drop undefined keys so stored edges stay clean JSON.
    const clean = { ...e }
    if (clean.sourceHandle === undefined) delete clean.sourceHandle
    if (clean.label === undefined) delete clean.label
    return clean
  })
  return { nodeId: id, nodes: [...shifted.nodes, { ...base, position }], edges }
}

/** Move every step below `fromId` (at or under `at.y`, reachable from it) down one row to make room. */
function shiftDown(graph: Graph, fromId: string, at: { x: number; y: number }): Graph {
  const below = reachableFrom(fromId, graph.edges)
  below.delete(fromId)
  const blocks = (n: WorkflowNode) => Math.abs(n.position.x - at.x) < FLOW_GRID.nodeWidth && n.position.y >= at.y - FLOW_GRID.nodeHeight / 2
  const moved = new Set([...below].filter((id) => {
    const n = graph.nodes.find((x) => x.id === id)
    return !!n && n.position.y >= at.y - FLOW_GRID.nodeHeight / 2
  }))
  // Also make room when an unrelated step sits exactly where the new one goes.
  for (const n of graph.nodes) if (n.id !== fromId && blocks(n)) moved.add(n.id)
  if (!moved.size) return graph
  return { nodes: graph.nodes.map((n) => (moved.has(n.id) ? { ...n, position: { x: n.position.x, y: n.position.y + FLOW_GRID.row } } : n)), edges: graph.edges }
}

/** The last step on the trigger's main path (following the first connection, Yes before No). */
export function lastOnMainPath(graph: Graph): WorkflowNode | undefined {
  const trigger = graph.nodes.find((n) => n.type === 'trigger')
  let cur = trigger ?? graph.nodes[0]
  const seen = new Set<string>()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    const outs = graph.edges.filter((e) => e.source === cur!.id).sort((a, b) => (a.sourceHandle === 'false' ? 1 : 0) - (b.sourceHandle === 'false' ? 1 : 0))
    const next = outs.map((e) => graph.nodes.find((n) => n.id === e.target)).find(Boolean)
    if (!next) return cur
    cur = next
  }
  return cur
}

/** Patch one node (label, config, agent, integration…). */
export function patchNode(graph: Graph, nodeId: string, patch: Partial<WorkflowNode>): Graph {
  return {
    nodes: graph.nodes.map((n) => {
      if (n.id !== nodeId) return n
      const next = { ...n, ...patch } as WorkflowNode
      for (const k of ['integrationId', 'agentId', 'capability'] as const) if (k in patch && patch[k] === undefined) delete next[k]
      return next
    }),
    edges: graph.edges,
  }
}

/** Move a node by a delta (keyboard nudge). */
export function nudge(graph: Graph, nodeId: string, dx: number, dy: number): Graph {
  return { nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)), edges: graph.edges }
}
