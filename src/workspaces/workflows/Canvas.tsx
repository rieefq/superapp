import '@xyflow/react/dist/base.css'
import './canvas.css'
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, MiniMap, Panel, Position, ReactFlow, useReactFlow, useStore,
  type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import { LayoutGrid, Maximize, Minus, Plus, X } from 'lucide-react'
import type { Agent, WorkflowNode, WorkflowNodeType, WorkflowTrigger } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, Button, IconButton, Kbd, Menu, StatusGlyph, StepStatusGlyph, toast, useReducedMotion, type MenuItem } from '@/ui'
import { autoLayout, connectSteps, deleteStep, disconnect, savePositions } from './actions'
import { connectionProblem } from './graph'
import { NODE_TYPES, NODE_TYPE_ORDER, nodeSummary, TRIGGER_ICON, usesSimulatedIntegration } from './nodeMeta'
import { NODE_STATE_WORD, type NodeRunState, type RunOverlay } from './overlay'

/**
 * The workflow canvas (docs/DESIGN.md §6.6): @xyflow/react on a sunken dot grid, flow top to bottom,
 * 240×72 step nodes, 8px square ports, smoothstep edges, a floating toolbar (bottom center) and a
 * minimap. Keys while the canvas has focus: N add step · Delete/Backspace remove the selection (Undo
 * toast) · arrows nudge 8px (32px with ⇧) · ⇧1 fit the view · Esc clear the selection.
 */

export interface CanvasIssue {
  severity: 'error' | 'warning'
  message: string
}

interface StepData extends Record<string, unknown> {
  node: WorkflowNode
  trigger: WorkflowTrigger
  agent?: Pick<Agent, 'name' | 'sigil' | 'hue'>
  state: NodeRunState
  issues: CanvasIssue[]
  selected: boolean
  index: number
}

type StepFlowNode = Node<StepData, 'step'>

interface FlowEdgeData extends Record<string, unknown> {
  label?: string
  handle?: string
  state: 'idle' | 'traversed' | 'active'
}

type FlowEdge = Edge<FlowEdgeData, 'flow'>

interface CanvasActions {
  workflowId: string
  readOnly: boolean
  onSelectNode: (nodeId: string | null, opts?: { inspect?: boolean }) => void
  onRemoveEdge: (edgeId: string) => void
}

const CanvasContext = createContext<CanvasActions | null>(null)

const NODE_W = 240
const NODE_H = 72
/** Fit with room for the run chip (top) and the floating toolbar (bottom). */
const FIT = { padding: { top: '64px', bottom: '76px', left: '40px', right: '40px' }, maxZoom: 1 } as const
const STEP_STATUS: Partial<Record<NodeRunState, 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped'>> = {
  pending: 'pending',
  running: 'running',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

// ------------------------------------------------------------------------------------------------ node

const StepNode = memo(function StepNode({ data }: NodeProps<StepFlowNode>) {
  const ctx = useContext(CanvasContext)
  const { node, state, issues, agent, trigger } = data
  const meta = NODE_TYPES[node.type]
  const Icon = node.type === 'trigger' ? TRIGGER_ICON[trigger.type] : meta.icon
  const summary = nodeSummary(node, { agent, trigger })
  const errors = issues.filter((i) => i.severity === 'error')
  const sim = usesSimulatedIntegration(node)
  const stepStatus = STEP_STATUS[state]
  const name = `${meta.label} step ${data.index}: ${node.label}. ${summary}.${stepStatus ? ` ${NODE_STATE_WORD[state]}.` : ''}${issues.length ? ` ${issues.length} problem${issues.length === 1 ? '' : 's'}: ${issues[0].message}` : ''}${sim ? ' Uses a simulated integration.' : ''}`

  return (
    <div
      className="wf-node"
      data-state={state}
      data-type={node.type}
      data-sim={sim ? 'true' : undefined}
      data-selected={data.selected ? 'true' : undefined}
      data-testid={`wf-node-${node.id}`}
      data-node-label={node.label}
    >
      <div
        role="button"
        tabIndex={0}
        aria-label={name}
        aria-pressed={data.selected}
        className="wf-node__focus"
        onFocus={() => ctx?.onSelectNode(node.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            ctx?.onSelectNode(node.id, { inspect: true })
          }
        }}
      />
      <div className="pointer-events-none relative flex h-6 shrink-0 items-center gap-1.5 px-3 pt-1">
        <Icon aria-hidden className={cn('size-3.5 shrink-0', state === 'waiting' ? 'text-attn-ink' : 'text-ink-3')} strokeWidth={1.75} />
        <span className="type-label text-ink-3">{meta.label}</span>
        <span className="flex-1" />
        {sim && <span className="type-meta-caps text-[10px] leading-3 text-ink-3">SIM</span>}
        {issues.length > 0 && (
          <span className={cn('type-meta inline-flex items-center gap-0.5', errors.length ? 'text-fail-ink' : 'text-ink-2')} aria-hidden>
            {errors.length ? <StatusGlyph shape="cross" tone="fail" size={12} decorative /> : <span className="font-semibold">!</span>}
            {issues.length > 1 ? issues.length : null}
          </span>
        )}
        {stepStatus && <StepStatusGlyph status={stepStatus} size={12} decorative />}
        {state === 'waiting' && <span className="type-meta text-attn-ink">Needs you</span>}
      </div>
      <div className="pointer-events-none relative flex min-h-0 flex-1 items-center gap-2 px-3 pb-2">
        {node.type === 'agent' && agent && <AgentMark seed={agent.sigil} hue={agent.hue} size={20} live={state === 'running'} className="shrink-0" />}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-[18px] font-semibold text-ink">{node.label}</span>
          <span className="type-caption truncate text-ink-3">{summary}</span>
        </div>
      </div>
      {node.type !== 'trigger' && <Handle type="target" position={Position.Top} isConnectable={!ctx?.readOnly} />}
      {node.type === 'condition' ? (
        <>
          <Handle type="source" id="true" position={Position.Bottom} style={{ left: '30%' }} isConnectable={!ctx?.readOnly} />
          <Handle type="source" id="false" position={Position.Bottom} style={{ left: '70%' }} isConnectable={!ctx?.readOnly} />
          <span aria-hidden className="type-meta pointer-events-none absolute top-full left-[30%] mt-1.5 -translate-x-1/2 text-ink-2">Yes</span>
          <span aria-hidden className="type-meta pointer-events-none absolute top-full left-[70%] mt-1.5 -translate-x-1/2 text-ink-2">No</span>
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} isConnectable={!ctx?.readOnly} />
      )}
    </div>
  )
})

// ------------------------------------------------------------------------------------------------ edge

function FlowEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps<FlowEdge>) {
  const ctx = useContext(CanvasContext)
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 10, offset: 18 })
  const custom = data?.label && !/^(yes|no)$/i.test(data.label) ? data.label : undefined
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={18} />
      {(custom || (selected && !ctx?.readOnly)) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {custom && (
              <span className="type-meta rounded-xs border border-line bg-canvas px-1.5 py-px text-ink-2">
                {data?.handle === 'false' ? 'No' : data?.handle === 'true' ? 'Yes' : ''}
                {data?.handle ? ' · ' : ''}
                {custom}
              </span>
            )}
            {selected && !ctx?.readOnly && (
              <IconButton icon={X} label="Remove this connection" size="xs" variant="secondary" onClick={() => ctx?.onRemoveEdge(id)} tooltip={false} />
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const nodeTypes = { step: StepNode }
const edgeTypes = { flow: FlowEdgeView }

// ------------------------------------------------------------------------------------------------ toolbar

function AddStepMenu({ open, onOpenChange, onAdd, disabled }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (type: WorkflowNodeType) => void; disabled?: boolean }) {
  const items: MenuItem[] = [
    { type: 'label', label: 'Add a step after the selection' },
    ...NODE_TYPE_ORDER.map((t) => ({ id: t, label: NODE_TYPES[t].label, description: NODE_TYPES[t].description, icon: NODE_TYPES[t].icon, onSelect: () => onAdd(t) })),
  ]
  return (
    <Menu
      items={items}
      open={open}
      onOpenChange={onOpenChange}
      placement="top"
      aria-label="Add step"
      className="w-[300px]"
      trigger={
        <Button size="sm" variant="ghost" leadingIcon={Plus} disabled={disabled} kbd="n" aria-label="Add step (N)">
          Add step
        </Button>
      }
    />
  )
}

function ZoomReadout() {
  const zoom = useStore((s) => s.transform[2])
  return <span className="type-meta w-10 text-center text-ink-3 tabular">{Math.round(zoom * 100)}%</span>
}

function Toolbar({ readOnly, addOpen, setAddOpen, onAdd, workflowId }: { readOnly: boolean; addOpen: boolean; setAddOpen: (o: boolean) => void; onAdd: (t: WorkflowNodeType) => void; workflowId: string }) {
  const rf = useReactFlow()
  const reduced = useReducedMotion()
  const duration = reduced ? 0 : 240
  return (
    <Panel position="bottom-center" className="!mb-3">
      <div role="toolbar" aria-label="Canvas" className="flex h-10 items-center gap-0.5 rounded-md border border-line bg-overlay px-1 shadow-e1">
        <AddStepMenu open={addOpen} onOpenChange={setAddOpen} onAdd={onAdd} disabled={readOnly} />
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <IconButton
          icon={LayoutGrid}
          label="Auto-layout"
          size="sm"
          disabled={readOnly}
          onClick={() => {
            autoLayout(workflowId)
            requestAnimationFrame(() => void rf.fitView({ ...FIT, duration }))
          }}
        />
        <IconButton icon={Maximize} label="Fit the view" shortcut="shift+1" size="sm" onClick={() => void rf.fitView({ ...FIT, duration })} />
        <span aria-hidden className="mx-1 h-5 w-px bg-line" />
        <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => void rf.zoomOut({ duration })} />
        <ZoomReadout />
        <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => void rf.zoomIn({ duration })} />
      </div>
    </Panel>
  )
}

// ------------------------------------------------------------------------------------------------ canvas

export interface WorkflowCanvasProps {
  workflowId: string
  nodes: readonly WorkflowNode[]
  edges: readonly { id: string; source: string; target: string; sourceHandle?: string; label?: string }[]
  trigger: WorkflowTrigger
  agents: Record<string, Pick<Agent, 'name' | 'sigil' | 'hue'>>
  overlay: RunOverlay | null
  issues: Record<string, CanvasIssue[]>
  selectedNodeId: string | null
  selectedEdgeId: string | null
  onSelectNode: (nodeId: string | null, opts?: { inspect?: boolean }) => void
  onSelectEdge: (edgeId: string | null) => void
  onAddStep: (type: WorkflowNodeType, afterId: string | null) => void
  readOnly?: boolean
  /** Panels drawn over the canvas (run chip, approval, issues). */
  children?: ReactNode
  /** Show the minimap (hidden on narrow stages). */
  minimap?: boolean
  /** Bumped by the parent to ask for a fit (new workflow, layout). */
  fitKey?: string
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  const { workflowId, nodes, edges, trigger, agents, overlay, issues, selectedNodeId, selectedEdgeId, onSelectNode, onSelectEdge, onAddStep, readOnly = false, children, minimap = true, fitKey } = props
  const [drag, setDrag] = useState<Record<string, { x: number; y: number }>>({})
  const [addOpen, setAddOpen] = useState(false)
  const rfRef = useRef<ReactFlowInstance<StepFlowNode, FlowEdge> | null>(null)
  const reduced = useReducedMotion()

  const flowNodes = useMemo<StepFlowNode[]>(
    () =>
      nodes.map((n, i) => ({
        id: n.id,
        type: 'step' as const,
        position: drag[n.id] ?? n.position,
        width: NODE_W,
        height: NODE_H,
        selected: n.id === selectedNodeId,
        draggable: !readOnly,
        connectable: !readOnly,
        data: {
          node: n,
          trigger,
          agent: n.agentId ? agents[n.agentId] : undefined,
          state: overlay?.nodes[n.id] ?? 'idle',
          issues: issues[n.id] ?? [],
          selected: n.id === selectedNodeId,
          index: i + 1,
        },
      })),
    [nodes, drag, selectedNodeId, readOnly, trigger, agents, overlay, issues],
  )

  const flowEdges = useMemo<FlowEdge[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    return edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => {
        const isCondition = byId.get(e.source)?.type === 'condition'
        const handle = isCondition ? (e.sourceHandle === 'false' ? 'false' : 'true') : undefined
        const state = overlay?.edges[e.id] ?? 'idle'
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          ...(handle ? { sourceHandle: handle } : {}),
          type: 'flow' as const,
          selected: e.id === selectedEdgeId,
          className: state === 'traversed' ? 'wf-edge--traversed' : state === 'active' ? 'wf-edge--active' : undefined,
          data: { label: e.label, handle, state },
        }
      })
  }, [edges, nodes, overlay, selectedEdgeId])

  const onNodesChange = useCallback((changes: NodeChange<StepFlowNode>[]) => {
    const moved: Record<string, { x: number; y: number }> = {}
    for (const c of changes) if (c.type === 'position' && c.position && c.dragging) moved[c.id] = c.position
    if (Object.keys(moved).length) setDrag((d) => ({ ...d, ...moved }))
  }, [])

  const onNodeDragStop = useCallback(
    (_e: unknown, _node: StepFlowNode, dragged: StepFlowNode[]) => {
      const positions = Object.fromEntries(dragged.map((n) => [n.id, { x: Math.round(n.position.x / 8) * 8, y: Math.round(n.position.y / 8) * 8 }]))
      savePositions(workflowId, positions)
      setDrag({})
    },
    [workflowId],
  )

  const isValidConnection = useCallback(
    (c: Connection | Edge) => !readOnly && !connectionProblem({ nodes: [...nodes], edges: [...edges] }, c.source, c.target, c.sourceHandle ?? null),
    [nodes, edges, readOnly],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      const problem = connectSteps(workflowId, c.source, c.target, c.sourceHandle)
      if (problem) toast.error('Couldn’t connect these steps', { description: problem })
    },
    [workflowId],
  )

  // Fit when the workflow (or the parent's fit key) changes; keep the viewport while editing.
  useEffect(() => {
    const id = requestAnimationFrame(() => void rfRef.current?.fitView({ ...FIT, duration: 0 }))
    return () => cancelAnimationFrame(id)
  }, [workflowId, fitKey])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)
  const addStep = (type: WorkflowNodeType) => {
    setAddOpen(false)
    onAddStep(type, selectedNodeId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]')) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.shiftKey && e.code === 'Digit1') {
      e.preventDefault()
      void rfRef.current?.fitView({ ...FIT, duration: reduced ? 0 : 240 })
      return
    }
    if (readOnly) return
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      setAddOpen(true)
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedNodeId || selectedEdgeId)) {
      e.preventDefault()
      if (selectedNodeId) {
        deleteStep(workflowId, selectedNodeId, { onUndo: (id) => onSelectNode(id) })
        onSelectNode(null)
      } else if (selectedEdgeId) {
        disconnect(workflowId, selectedEdgeId)
        onSelectEdge(null)
      }
      return
    }
    if (selectedNode && e.key.startsWith('Arrow')) {
      e.preventDefault()
      const step = e.shiftKey ? 32 : 8
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      savePositions(workflowId, { [selectedNode.id]: { x: selectedNode.position.x + dx, y: selectedNode.position.y + dy } })
      return
    }
    if (e.key === 'Escape' && (selectedNodeId || selectedEdgeId)) {
      e.preventDefault()
      e.stopPropagation()
      onSelectNode(null)
      onSelectEdge(null)
    }
  }

  const actions = useMemo<CanvasActions>(
    () => ({ workflowId, readOnly, onSelectNode, onRemoveEdge: (id) => { disconnect(workflowId, id); onSelectEdge(null) } }),
    [workflowId, readOnly, onSelectNode, onSelectEdge],
  )

  return (
    <CanvasContext.Provider value={actions}>
      <div className="wf-canvas relative h-full w-full outline-none" onKeyDown={onKeyDown} role="application" aria-label="Workflow canvas. N adds a step, Delete removes the selection, arrows move it, Shift 1 fits the view." aria-roledescription="canvas">
        <ReactFlow<StepFlowNode, FlowEdge>
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => {
            rfRef.current = instance
            void instance.fitView({ ...FIT, duration: 0 })
          }}
          onNodesChange={onNodesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={(_e, n) => onSelectNode(n.id, { inspect: true })}
          onEdgeClick={(_e, edge) => onSelectEdge(edge.id)}
          onPaneClick={() => {
            onSelectNode(null)
            onSelectEdge(null)
          }}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          nodesFocusable={false}
          edgesFocusable={false}
          disableKeyboardA11y
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          selectionOnDrag={false}
          zoomOnDoubleClick={false}
          elevateNodesOnSelect={false}
          minZoom={0.3}
          maxZoom={1.75}
          connectionRadius={28}
          attributionPosition="bottom-left"
          fitView
          fitViewOptions={FIT}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          {minimap && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              ariaLabel="Overview of the canvas"
              nodeBorderRadius={6}
              nodeClassName={(n) => `wf-mm wf-mm--${(n.data as StepData).state}`}
              className="!m-3 max-lg:!hidden"
              style={{ width: 160, height: 104 }}
            />
          )}
          <Toolbar readOnly={readOnly} addOpen={addOpen} setAddOpen={setAddOpen} onAdd={addStep} workflowId={workflowId} />
          {children}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  )
}

/** Keyboard hint shown under the toolbar on desktop. */
export function CanvasKeysHint() {
  return (
    <span className="type-caption hidden items-center gap-1.5 text-ink-3 xl:flex pointer-coarse:hidden">
      <Kbd>N</Kbd> add step <span aria-hidden>·</span> <Kbd>⇧1</Kbd> fit
    </span>
  )
}
