import { isRunActive, type Run, type RunStep, type StepStatus, type Workflow } from '@/core/types'

/**
 * Run overlay (docs/DESIGN.md §6.6): each node's state for one run, by the steps that carry its
 * nodeId. While the run is active, the node being worked on is "running" (or "waiting" at an
 * approval) and its incoming edge is "active"; edges the run already crossed are "traversed".
 * When the run has ended, nodes it never reached read as "skipped" (not on the taken path).
 */

export type NodeRunState = 'idle' | 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'
export type EdgeRunState = 'idle' | 'traversed' | 'active'

export interface RunOverlay {
  runId: string
  live: boolean
  nodes: Record<string, NodeRunState>
  edges: Record<string, EdgeRunState>
  /** The node the run is at (running or waiting), if any. */
  currentNodeId?: string
  /** Steps per node (newest last), for the Inspector and tooltips. */
  steps: Record<string, RunStep[]>
}

const RANK: Record<StepStatus, number> = { failed: 6, waiting: 5, running: 4, pending: 3, done: 2, skipped: 1 }

function stateOf(steps: RunStep[]): NodeRunState {
  let best: StepStatus = steps[0].status
  for (const s of steps) if (RANK[s.status] > RANK[best]) best = s.status
  // A node whose steps are all done reads done; one with a pending next step while others finished is still running.
  if (best === 'pending' && steps.some((s) => s.status === 'done')) return 'running'
  return best
}

export function computeOverlay(run: Run, wf: Pick<Workflow, 'nodes' | 'edges'>): RunOverlay {
  const live = isRunActive(run.status)
  const steps: Record<string, RunStep[]> = {}
  for (const s of run.steps) if (s.nodeId) (steps[s.nodeId] ??= []).push(s)
  const nodes: Record<string, NodeRunState> = {}
  let currentNodeId: string | undefined
  for (const n of wf.nodes) {
    const own = steps[n.id]
    if (own?.length) {
      let st = stateOf(own)
      // A paused or queued run leaves its in-flight step pending: show where it is.
      if (st === 'pending' && live) st = 'running'
      if (!live && (st === 'running' || st === 'pending')) st = run.status === 'failed' ? 'failed' : 'skipped'
      nodes[n.id] = st
      if (live && (st === 'running' || st === 'waiting')) currentNodeId = n.id
    } else {
      nodes[n.id] = live ? 'pending' : 'skipped'
    }
  }
  const executed = (id: string) => !!steps[id]?.length
  const edges: Record<string, EdgeRunState> = {}
  for (const e of wf.edges) {
    if (!executed(e.source) || !executed(e.target)) {
      edges[e.id] = 'idle'
      continue
    }
    edges[e.id] = live && e.target === currentNodeId ? 'active' : 'traversed'
  }
  return { runId: run.id, live, nodes, edges, currentNodeId, steps }
}

/** Human words for a node's run state (screen readers, tooltips). */
export const NODE_STATE_WORD: Record<NodeRunState, string> = {
  idle: '',
  pending: 'Not reached yet',
  running: 'Running',
  waiting: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Not on the taken path',
}
