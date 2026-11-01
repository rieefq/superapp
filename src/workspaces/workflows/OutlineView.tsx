import { memo, useMemo } from 'react'
import { CornerDownRight, Ellipsis, Plus, Trash2 } from 'lucide-react'
import { getIntegration } from '@/core/integrations/catalog'
import { isInternalEvent, type WorkflowIssue } from '@/core/services/workflows'
import type { Agent, Workflow, WorkflowNode, WorkflowNodeType } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, IconButton, LiveBadge, Menu, SimBadge, StatusGlyph, StepStatusGlyph, type MenuItem } from '@/ui'
import { addStep, deleteStep } from './actions'
import { NODE_TYPES, NODE_TYPE_ORDER, nodeSummary, TRIGGER_ICON, usesSimulatedIntegration } from './nodeMeta'
import { buildOutline, type OutlineItem } from './outline'
import { NODE_STATE_WORD, type RunOverlay } from './overlay'

/**
 * Outline (docs/DESIGN.md §6.6): numbered sentences with indented branches. Each row opens the same
 * settings as the canvas (Inspector › Item), adds a step after itself, or deletes itself. Problems
 * appear inline. It is the default on phones and the accessible editor everywhere.
 */

export interface OutlineViewProps {
  wf: Workflow
  agents: Record<string, Pick<Agent, 'name' | 'sigil' | 'hue'>>
  overlay: RunOverlay | null
  issuesByNode: Record<string, WorkflowIssue[]>
  selectedNodeId: string | null
  onSelect: (nodeId: string) => void
}

export function OutlineView({ wf, agents, overlay, issuesByNode, selectedNodeId, onSelect }: OutlineViewProps) {
  const outline = useMemo(() => buildOutline(wf.nodes, wf.edges), [wf.nodes, wf.edges])
  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-canvas">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-1 px-3 py-4 md:px-6 md:py-6">
        <ol aria-label={`Steps of ${wf.name}`} className="flex flex-col gap-1">
          {outline.items.map((item) => (
            <OutlineRow
              key={item.node.id}
              wf={wf}
              item={item}
              agent={item.node.agentId ? agents[item.node.agentId] : undefined}
              state={overlay?.nodes[item.node.id]}
              issues={issuesByNode[item.node.id] ?? []}
              selected={item.node.id === selectedNodeId}
              onSelect={onSelect}
            />
          ))}
        </ol>
        {outline.orphans.length > 0 && (
          <section aria-label="Not connected" className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
            <h3 className="type-label px-2 pb-1 text-ink-3">Not connected — never runs</h3>
            <ol className="flex flex-col gap-1">
              {outline.orphans.map((node) => (
                <OutlineRow
                  key={node.id}
                  wf={wf}
                  item={{ node, number: '–', depth: 0 }}
                  agent={node.agentId ? agents[node.agentId] : undefined}
                  state={overlay?.nodes[node.id]}
                  issues={issuesByNode[node.id] ?? []}
                  selected={node.id === selectedNodeId}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          </section>
        )}
        <div className="pt-2 pl-2">
          <AddAfter wf={wf} afterId={null} label="Add a step at the end" onAdded={onSelect} />
        </div>
      </div>
    </div>
  )
}

function sentence(node: WorkflowNode, wf: Workflow): string {
  if (node.type === 'trigger') return wf.trigger.label
  if (node.type === 'condition') return `Check “${node.label}”`
  return node.label
}

function honesty(node: WorkflowNode, wf: Workflow): 'live' | 'sim' | null {
  if (node.type === 'trigger') {
    if (wf.trigger.type === 'webhook') return 'sim'
    if (wf.trigger.type === 'event') return isInternalEvent(wf.trigger.event) ? 'live' : 'sim'
    return null
  }
  if (usesSimulatedIntegration(node)) return 'sim'
  return getIntegration(node.integrationId)?.support === 'live' ? 'live' : null
}

const OutlineRow = memo(function OutlineRow({ wf, item, agent, state, issues, selected, onSelect }: {
  wf: Workflow
  item: OutlineItem
  agent?: Pick<Agent, 'name' | 'sigil' | 'hue'>
  state?: string
  issues: WorkflowIssue[]
  selected: boolean
  onSelect: (nodeId: string) => void
}) {
  const { node } = item
  const meta = NODE_TYPES[node.type]
  const Icon = node.type === 'trigger' ? TRIGGER_ICON[wf.trigger.type] : meta.icon
  const tag = honesty(node, wf)
  const runState = state && state !== 'idle' ? (state as 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'skipped') : null
  const summary = nodeSummary(node, { agent, trigger: wf.trigger })
  const more: MenuItem[] = [
    ...NODE_TYPE_ORDER.filter((t) => t !== 'trigger').map((t): MenuItem => ({ id: `add-${t}`, label: `Add ${NODE_TYPES[t].label.toLowerCase()} after`, icon: NODE_TYPES[t].icon, onSelect: () => onSelect(addStep(wf.id, t, node.id) ?? node.id) })),
    { type: 'separator' },
    { id: 'delete', label: 'Delete step', icon: Trash2, danger: true, onSelect: () => deleteStep(wf.id, node.id, { onUndo: onSelect }) },
  ]
  return (
    <li className="flex flex-col" data-outline-step={node.id}>
      <div
        className={cn('group flex min-h-12 items-start gap-2 rounded-sm pr-1 transition-colors duration-(--dur-1)', selected ? 'bg-accent-tint' : 'hover:bg-hover')}
        style={{ paddingLeft: 8 + item.depth * 28 }}
      >
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          aria-pressed={selected}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-sm py-2 text-left outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
        >
          <span className="type-meta w-9 shrink-0 pt-0.5 text-right text-ink-3 tabular">{item.number}.</span>
          {item.branch && (
            <span className="type-body-sm flex shrink-0 items-center gap-1 pt-px font-medium text-ink-2">
              <CornerDownRight aria-hidden className="size-3.5 text-ink-3" strokeWidth={1.75} />
              {item.branch === 'true' ? 'Yes' : 'No'} →
            </span>
          )}
          <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center">
            {node.type === 'agent' && agent ? <AgentMark seed={agent.sigil} hue={agent.hue} size={18} /> : <Icon className="size-3.5 text-ink-3" strokeWidth={1.75} />}
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="type-body-sm text-pretty text-ink">{sentence(node, wf)}</span>
            <span className="type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
              <span>{meta.label.toLowerCase()}</span>
              {summary && <span className="min-w-0 truncate">· {summary}</span>}
              {tag === 'live' && <LiveBadge size="xs" noTooltip />}
              {tag === 'sim' && <SimBadge size="xs" noTooltip />}
              {runState && (
                <span className={cn('inline-flex items-center gap-1', runState === 'failed' && 'text-fail-ink', runState === 'waiting' && 'text-attn-ink', runState === 'running' && 'text-live-ink')}>
                  · <StepStatusGlyph status={runState} size={12} decorative /> {NODE_STATE_WORD[runState]}
                </span>
              )}
            </span>
            {issues.length > 0 && (
              <span className="flex flex-col gap-0.5 pt-0.5">
                {issues.map((i, k) => (
                  <span key={k} className={cn('type-caption flex items-start gap-1.5', i.severity === 'error' ? 'text-fail-ink' : 'text-ink-2')}>
                    <span className="mt-0.5 shrink-0">{i.severity === 'error' ? <StatusGlyph shape="cross" tone="fail" size={11} label="Error" /> : <span aria-label="Warning" className="font-semibold">!</span>}</span>
                    {i.message}
                  </span>
                ))}
              </span>
            )}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-0.5 pt-1.5 opacity-0 transition-opacity duration-(--dur-1) group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
          {node.type !== 'condition' && <AddAfter wf={wf} afterId={node.id} iconOnly onAdded={onSelect} />}
          <Menu items={more} aria-label={`More for ${node.label}`} placement="bottom-end" trigger={<IconButton icon={Ellipsis} label={`More for ${node.label}`} size="sm" />} />
        </span>
      </div>
    </li>
  )
})

function AddAfter({ wf, afterId, label = 'Add step after', iconOnly, onAdded }: { wf: Workflow; afterId: string | null; label?: string; iconOnly?: boolean; onAdded: (id: string) => void }) {
  const items: MenuItem[] = NODE_TYPE_ORDER.filter((t) => t !== 'trigger' || !wf.nodes.some((n) => n.type === 'trigger')).map((t: WorkflowNodeType) => ({
    id: t,
    label: NODE_TYPES[t].label,
    description: NODE_TYPES[t].description,
    icon: NODE_TYPES[t].icon,
    onSelect: () => {
      const id = addStep(wf.id, t, afterId)
      if (id) onAdded(id)
    },
  }))
  return (
    <Menu
      items={items}
      aria-label={label}
      placement="bottom-start"
      className="w-[300px]"
      trigger={
        iconOnly ? (
          <IconButton icon={Plus} label={label} size="sm" />
        ) : (
          <button type="button" className="type-body-sm inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink">
            <Plus aria-hidden className="size-3.5" strokeWidth={2} /> {label}
          </button>
        )
      }
    />
  )
}
