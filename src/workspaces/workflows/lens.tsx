import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import type { LensModule, LensProps } from '@/app/lens/types'
import { ProjectPicker } from '@/app/components'
import { attachRun } from '@/app/shell/store'
import { getIntegration } from '@/core/integrations/catalog'
import { nextScheduledRun, triggerLabel, updateWorkflow, useWorkflow, useWorkflowRuns } from '@/core/services/workflows'
import { isRunActive, type Workflow } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDateTime, timeAgo } from '@/lib/format'
import { Button, OutcomeTape, RUN_STATUS_META, RunStatusGlyph, SimBadge, Switch, Textarea } from '@/ui'
import { workflowCapabilities } from './capabilities'
import { EnableDialog, toggleEnabled } from './dialogs'
import { selectStep, useSelectedNodeId } from './editorStore'
import { useIssues, useOverlayRun, useWorkflowSummaries } from './hooks'
import { NODE_TYPES } from './nodeMeta'
import { buildOutline } from './outline'
import { computeOverlay } from './overlay'
import { IssueLines, Section, StepForm } from './StepForm'

/**
 * Workflow lens (docs/DESIGN.md §5.4.8). Panel (Inspector › Item): in the editor, the selected step's
 * settings; otherwise the workflow — trigger, on/off, project, what it can do, its steps, problems and
 * recent runs. Card (hover card and ⌘K preview): trigger, the step path, outcomes and the last run.
 */

function useInEditor(id: string): boolean {
  const { pathname } = useLocation()
  return pathname === `/workflows/${encodeURIComponent(id)}` || pathname === `/workflows/${id}`
}

function WorkflowPanel({ entity }: LensProps) {
  const wf = useWorkflow(entity.id)
  const inEditor = useInEditor(entity.id)
  const selected = useSelectedNodeId(entity.id)
  const runs = useWorkflowRuns(entity.id)
  const overlayRun = useOverlayRun(inEditor ? wf : undefined, runs)
  const { issues, byNode } = useIssues(wf)
  if (!wf) return null
  const node = inEditor && selected ? wf.nodes.find((n) => n.id === selected) : undefined
  if (node) {
    const overlay = overlayRun ? computeOverlay(overlayRun, wf) : null
    return <StepForm key={node.id} wf={wf} node={node} issues={byNode[node.id] ?? []} runSteps={overlay?.steps[node.id] ?? []} />
  }
  return <WorkflowOverview wf={wf} inEditor={inEditor} issues={issues} />
}

function WorkflowOverview({ wf, inEditor, issues }: { wf: Workflow; inEditor: boolean; issues: ReturnType<typeof useIssues>['issues'] }) {
  const navigate = useNavigate()
  // Outside Workflows (which hosts its own), the "Turn on" read-back needs a host here.
  const hostsDialog = !useLocation().pathname.startsWith('/workflows')
  const runs = useWorkflowRuns(wf.id)
  const capabilities = useMemo(() => workflowCapabilities(wf), [wf])
  const outline = useMemo(() => buildOutline(wf.nodes, wf.edges), [wf.nodes, wf.edges])
  const next = nextScheduledRun(wf.trigger)
  const recent = runs.slice(0, 5)
  return (
    <div className="flex flex-col" data-testid="workflow-overview">
      {hostsDialog && <EnableDialog />}
      <Section>
        {inEditor ? (
          <Textarea
            aria-label="Description"
            value={wf.description}
            onValueChange={(description) => updateWorkflow(wf.id, { description }, { coalesce: true })}
            placeholder="What this workflow is for"
            autosize
            minRows={2}
            maxRows={6}
          />
        ) : (
          wf.description && <p className="type-body-sm text-pretty text-ink-2">{wf.description}</p>
        )}
        <dl className="type-body-sm grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
          <dt className="type-caption text-ink-3">Trigger</dt>
          <dd className="min-w-0 text-ink-2">
            {triggerLabel(wf.trigger)}
            {wf.trigger.type === 'schedule' && <span className="type-caption block text-ink-3">Runs only while Atrium is open{next && wf.enabled ? ` · next ${formatDateTime(next)}` : ''}</span>}
          </dd>
          <dt className="type-caption text-ink-3">Automatic</dt>
          <dd>
            <Switch size="sm" checked={wf.enabled} onCheckedChange={(on) => toggleEnabled(wf, on)} label={wf.enabled ? 'On' : 'Off'} />
          </dd>
          <dt className="type-caption text-ink-3">Project</dt>
          <dd className="min-w-0">
            <ProjectPicker value={wf.projectId} onChange={(projectId) => updateWorkflow(wf.id, { projectId })} variant="chip" />
          </dd>
          <dt className="type-caption text-ink-3">Version</dt>
          <dd className="type-meta text-ink-2">
            v{wf.version} · {wf.nodes.length} steps
          </dd>
        </dl>
        {!inEditor && (
          <Button size="sm" variant="secondary" leadingIcon={ArrowUpRight} onClick={() => navigate(`/workflows/${encodeURIComponent(wf.id)}`)} className="self-start">
            Open in the editor
          </Button>
        )}
      </Section>

      {issues.length > 0 && (
        <Section title={`Problems · ${issues.length}`}>
          <IssueLines issues={issues} />
        </Section>
      )}

      <Section title="Can">
        {capabilities.length === 0 ? (
          <p className="type-caption text-ink-3">Nothing outside Atrium yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {capabilities.map((c) => (
              <li key={`${c.capability}:${c.nodeIds.join(',')}`} className="type-body-sm flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-ink-2">{c.short}</span>
                <span className={cn('type-meta shrink-0', c.word === 'asks you' ? 'text-attn-ink' : 'text-ink-3')}>
                  {c.word}
                  {c.word === 'asks you' ? ' ◆' : c.word === 'blocked' ? ' ⊘' : ''}
                </span>
                {c.simulated && <SimBadge size="xs" noTooltip />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Steps">
        <ol className="flex flex-col gap-0.5">
          {outline.items.map((item) => {
            const Icon = NODE_TYPES[item.node.type].icon
            const label = item.node.type === 'trigger' ? wf.trigger.label : item.node.label
            const content = (
              <>
                <span className="type-meta w-8 shrink-0 text-right text-ink-3 tabular">{item.number}.</span>
                <Icon aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                {item.branch && <span className="type-meta shrink-0 text-ink-3">{item.branch === 'true' ? 'Yes →' : 'No →'}</span>}
                <span className="min-w-0 flex-1 truncate">{label}</span>
                {getIntegration(item.node.integrationId)?.support === 'simulated' && <SimBadge size="xs" noTooltip />}
              </>
            )
            return (
              <li key={item.node.id} style={{ paddingLeft: item.depth * 16 }}>
                {inEditor ? (
                  <button type="button" onClick={() => selectStep(wf.id, item.node.id)} className="type-body-sm flex min-h-7 w-full items-center gap-2 rounded-sm px-1 text-left text-ink-2 hover:bg-hover hover:text-ink">
                    {content}
                  </button>
                ) : (
                  <span className="type-body-sm flex min-h-7 items-center gap-2 px-1 text-ink-2">{content}</span>
                )}
              </li>
            )
          })}
        </ol>
        {inEditor && <p className="type-caption text-ink-3">Select a step to change its settings.</p>}
      </Section>

      <Section title="Recent runs">
        {recent.length === 0 ? (
          <p className="type-caption text-ink-3">No runs yet. Test run starts one.</p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => attachRun(r.id, 'workflows')} className="flex h-8 w-full items-center gap-2 rounded-sm px-1 text-left hover:bg-hover">
                  <RunStatusGlyph status={r.status} size={12} decorative />
                  <span className={cn('type-body-sm', r.status === 'failed' ? 'text-fail-ink' : r.status === 'waiting' ? 'text-attn-ink' : r.status === 'running' ? 'text-live-ink' : 'text-ink-2')}>
                    {RUN_STATUS_META[r.status].word}
                  </span>
                  <span className="type-meta min-w-0 flex-1 truncate text-ink-3">{r.summary ?? r.error ?? (isRunActive(r.status) ? `${r.steps.length} steps so far` : '')}</span>
                  <span className="type-meta shrink-0 text-ink-3">{timeAgo(r.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function WorkflowCard({ entity }: LensProps) {
  const wf = useWorkflow(entity.id)
  const summaries = useWorkflowSummaries()
  const sim = !!wf?.nodes.some((n) => getIntegration(n.integrationId)?.support === 'simulated')
  if (!wf) return null
  const summary = summaries[wf.id]
  const path = buildOutline(wf.nodes, wf.edges)
    .items.filter((i) => i.depth === 0)
    .map((i) => (i.node.type === 'trigger' ? NODE_TYPES.trigger.label : i.node.label))
  return (
    <div className="flex flex-col gap-2" data-testid="workflow-card">
      <p className="type-caption text-ink-2">{triggerLabel(wf.trigger)}{wf.trigger.type === 'schedule' ? ' · while Atrium is open' : ''}</p>
      <p className="type-meta line-clamp-2 text-ink-3">{path.join(' → ')}</p>
      <div className="flex items-center gap-2">
        <OutcomeTape outcomes={summary?.outcomes ?? []} size="xs" max={10} />
        {summary?.successRate != null && <span className="type-meta text-ink-3">{Math.round(summary.successRate * 100)}% done</span>}
        <span className="flex-1" />
        {sim && <SimBadge size="xs" noTooltip />}
      </div>
      {summary?.lastAt && summary.lastStatus && (
        <p className="type-meta flex items-center gap-1.5 text-ink-3">
          <RunStatusGlyph status={summary.active ?? summary.lastStatus} size={12} decorative />
          {RUN_STATUS_META[summary.active ?? summary.lastStatus].word} · {timeAgo(summary.lastAt)}
        </p>
      )}
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  workflow: { panel: WorkflowPanel, card: WorkflowCard },
}
