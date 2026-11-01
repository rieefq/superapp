import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { Panel } from '@xyflow/react'
import { ChevronDown, ChevronUp, Copy, FileJson, Files, Link2, Play, Trash2, Workflow as WorkflowIcon, X } from 'lucide-react'
import { CanvasTemplate, StageHeader, useShellLayout, type CanvasDrawer } from '@/app/templates'
import { attachRun } from '@/app/shell/store'
import { useApprovalsForRun } from '@/core/services/approvals'
import {
  deleteWorkflow, duplicateWorkflow, exportWorkflowJson, restoreWorkflow, saveWorkflowLayout, triggerShort, updateWorkflow, useWorkflow, useWorkflowRuns,
  type WorkflowIssue,
} from '@/core/services/workflows'
import { isSidewaysLayout, layoutGraph } from '@/core/sim/workflow'
import { getSettings } from '@/core/settings'
import { isRunActive, type Run, type Workflow, type WorkflowNodeType } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import {
  ApprovalCardConnected, Button, confirm, EmptyState, IdCode, MonogramMark, Popover, RUN_STATUS_META, RunStatusGlyph, SimBadge, StatusGlyph, StepTape, Switch, toast,
  type MenuItem,
} from '@/ui'
import { ReadBack, useReadBack } from '@/app/components'
import { addStep } from './actions'
import { WorkflowCanvas, type CanvasIssue } from './Canvas'
import { workflowCapabilities } from './capabilities'
import { toggleEnabled, useWorkflowDialogs } from './dialogs'
import { selectStep, useEditorStore, useSelectedNodeId } from './editorStore'
import { useAgentsById, useIssues, useOverlayRun } from './hooks'
import { TRIGGER_ICON } from './nodeMeta'
import { OutlineView } from './OutlineView'
import { computeOverlay, type RunOverlay } from './overlay'
import { RunsBar, RunsTable } from './Runs'
import type { DraftState } from './Start'

/**
 * The editor (docs/DESIGN.md §6.6): header (name, trigger chip, Enabled, Test run, version,
 * Canvas | Outline, ⋯), the capability line, the canvas or outline, and the runs drawer. A run in
 * flight is drawn live on the canvas; picking a past run (?run=) overlays its final state.
 */

// ------------------------------------------------------------------------------------------------ model

export type EditorView = 'canvas' | 'outline'

export function useEditorView(): [EditorView, (v: EditorView) => void] {
  const [params, setParams] = useSearchParams()
  const { formFactor } = useShellLayout()
  const raw = params.get('view')
  const view: EditorView = raw === 'outline' || raw === 'canvas' ? raw : formFactor === 'phone' ? 'outline' : 'canvas'
  const set = useCallback(
    (v: EditorView) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.set('view', v)
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  return [view, set]
}

// ------------------------------------------------------------------------------------------------ header

function TriggerChip({ wf, onClick }: { wf: Workflow; onClick: () => void }) {
  const Icon = TRIGGER_ICON[wf.trigger.type]
  return (
    <button
      type="button"
      onClick={onClick}
      title="Trigger settings"
      aria-label={`Trigger: ${wf.trigger.label}. Open its settings`}
      className="type-meta inline-flex h-6 max-w-[180px] items-center gap-1.5 rounded-sm border border-line-strong px-2 text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
    >
      <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{triggerShort(wf.trigger)}</span>
    </button>
  )
}

function downloadJson(wf: Workflow) {
  const blob = new Blob([exportWorkflowJson(wf)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${wf.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function EditorHeader({ workflowId, onSelectNode }: { workflowId: string; onSelectNode: (nodeId: string | null, opts?: { inspect?: boolean }) => void }) {
  const wf = useWorkflow(workflowId)
  const navigate = useNavigate()
  const [view, setView] = useEditorView()
  const requestTestRun = useWorkflowDialogs((s) => s.requestTestRun)
  if (!wf) return <StageHeader title="Workflow" />
  const trigger = wf.nodes.find((n) => n.type === 'trigger')
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error(`Couldn’t copy the ${what.toLowerCase()}`)
    }
  }
  const remove = async () => {
    const ok = !getSettings().safety.confirmDestructive
      ? true
      : await confirm({ title: `Delete “${wf.name}”?`, description: 'The workflow and its steps are deleted. Past runs stay in Agents › Runs.', confirmLabel: 'Delete', tone: 'danger' })
    if (!ok) return
    const snapshot = structuredClone(wf)
    deleteWorkflow(wf.id)
    navigate('/workflows')
    toast(`Deleted “${snapshot.name}”`, { duration: 8000, action: { label: 'Undo', onClick: () => { restoreWorkflow(snapshot); navigate(`/workflows/${encodeURIComponent(snapshot.id)}`) } } })
  }
  const menu: MenuItem[] = [
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Files,
      onSelect: () => {
        const copy = duplicateWorkflow(wf.id)
        if (copy) {
          navigate(`/workflows/${encodeURIComponent(copy.id)}`)
          toast.success('Duplicated', { description: `“${copy.name}” starts off.` })
        }
      },
    },
    { id: 'export', label: 'Export JSON', icon: FileJson, onSelect: () => downloadJson(wf) },
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copy(`${window.location.origin}/workflows/${encodeURIComponent(wf.id)}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => void copy(shortCode(wf.id), 'Handle') },
    { type: 'separator' },
    { id: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => void remove() },
  ]
  return (
    <StageHeader
      leading={<MonogramMark text={wf.name} hue={wf.hue} size={20} />}
      title={wf.name}
      onRename={(name) => updateWorkflow(wf.id, { name })}
      status={<TriggerChip wf={wf} onClick={() => trigger && onSelectNode(trigger.id, { inspect: true })} />}
      tabs={{ items: [{ value: 'canvas', label: 'Canvas' }, { value: 'outline', label: 'Outline' }], value: view, onChange: (v) => setView(v as EditorView), 'aria-label': 'View' }}
      actions={
        <>
          <span className="type-meta hidden text-ink-3 sm:inline" title={`Version ${wf.version}: every editing session saves a new version`}>
            v{wf.version}
          </span>
          <Switch size="sm" label={<span className="max-sm:sr-only">Enabled</span>} checked={wf.enabled} onCheckedChange={(on) => toggleEnabled(wf, on)} aria-label={wf.enabled ? 'Enabled. Turn off' : 'Off. Turn on'} />
          <Button size="sm" variant="primary" leadingIcon={Play} onClick={() => requestTestRun(wf.id)}>
            Test run
          </Button>
        </>
      }
      menu={menu}
    />
  )
}

// ------------------------------------------------------------------------------------------------ capability line

function CapabilityLine({ wf, issues }: { wf: Workflow; issues: WorkflowIssue[] }) {
  const rows = useMemo(() => workflowCapabilities(wf), [wf])
  const base = useReadBack({ kind: 'workflow', title: wf.name, projectId: wf.projectId, workflowId: wf.id })
  const issuesOpen = useEditorStore((s) => s.issuesOpen)
  const setIssuesOpen = useEditorStore((s) => s.setIssuesOpen)
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-line bg-canvas px-4 md:px-5">
      <p className="type-caption flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-ink-3" aria-label="What this workflow can do">
        <span className="shrink-0 text-ink-2">Can:</span>
        {rows.length === 0 ? (
          <span>nothing outside Atrium yet</span>
        ) : (
          <span className="truncate">
            {rows.map((r, i) => (
              <span key={`${r.capability}:${r.nodeIds.join(',')}`}>
                {i > 0 && <span aria-hidden> · </span>}
                <span className="text-ink-2">{r.short}</span> (
                <span className={r.word === 'asks you' ? 'text-attn-ink' : undefined}>{r.word === 'asks you' ? 'asks' : r.word}</span>
                {r.simulated ? ' · SIM' : ''})
              </span>
            ))}
          </span>
        )}
      </p>
      <Popover
        placement="bottom-end"
        aria-label="Read back"
        className="w-[min(480px,calc(100vw-16px))] p-4"
        trigger={
          <button type="button" className="type-caption shrink-0 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
            Details
          </button>
        }
      >
        <ReadBack data={{ ...base, capabilities: rows }} />
      </Popover>
      {issues.length > 0 && (
        <button
          type="button"
          onClick={() => setIssuesOpen(!issuesOpen)}
          aria-expanded={issuesOpen}
          className={cn('type-caption inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm px-1.5 font-medium hover:bg-hover', errors ? 'text-fail-ink' : 'text-ink-2')}
          data-testid="wf-issue-count"
        >
          {errors ? <StatusGlyph shape="cross" tone="fail" size={12} decorative /> : <span aria-hidden className="font-semibold">!</span>}
          {errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : ''}
          {errors && warnings ? ' · ' : ''}
          {warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : ''}
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ canvas panels

function IssuesPanel({ issues, onPick, onClose }: { issues: WorkflowIssue[]; onPick: (nodeId: string) => void; onClose: () => void }) {
  return (
    <section aria-label="Problems" data-testid="wf-issues" className="w-[min(320px,calc(100vw-48px))] rounded-md border border-line bg-overlay shadow-e1">
      <header className="flex h-9 items-center gap-2 border-b border-line pr-1 pl-3">
        <h3 className="type-label flex-1 text-ink-3">Problems · {issues.length}</h3>
        <button type="button" onClick={onClose} aria-label="Hide problems" className="grid size-7 place-items-center rounded-sm text-ink-3 hover:bg-hover hover:text-ink">
          <ChevronUp aria-hidden className="size-4" strokeWidth={1.75} />
        </button>
      </header>
      <ul className="max-h-[220px] overflow-y-auto py-1">
        {issues.map((i, k) => (
          <li key={k}>
            <button
              type="button"
              disabled={!i.nodeId}
              onClick={() => i.nodeId && onPick(i.nodeId)}
              className={cn('flex w-full items-start gap-2 px-3 py-1.5 text-left disabled:cursor-default', i.nodeId && 'hover:bg-hover')}
            >
              <span className="mt-[3px] shrink-0">{i.severity === 'error' ? <StatusGlyph shape="cross" tone="fail" size={12} label="Error" /> : <span aria-label="Warning" className="type-caption inline-grid size-3 place-items-center font-semibold text-ink-2">!</span>}</span>
              <span className={cn('type-caption text-pretty', i.severity === 'error' ? 'text-fail-ink' : 'text-ink-2')}>{i.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function OverlayPanel({ run, overlay, onClear }: { run: Run; overlay: RunOverlay; onClear: () => void }) {
  const approvals = useApprovalsForRun(run.id)
  const pending = approvals.find((a) => a.status === 'pending')
  const done = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  return (
    <div className="flex w-[min(360px,calc(100vw-48px))] flex-col gap-2">
      <div className="flex items-center gap-2 rounded-md border border-line bg-overlay py-1.5 pr-1 pl-2.5 shadow-e1" data-testid="wf-overlay" data-run-status={run.status}>
        <RunStatusGlyph status={run.status} size={12} decorative />
        <span className={cn('type-body-sm font-medium', run.status === 'waiting' ? 'text-attn-ink' : run.status === 'running' ? 'text-live-ink' : run.status === 'failed' ? 'text-fail-ink' : 'text-ink')}>
          {RUN_STATUS_META[run.status].word}
        </span>
        <IdCode id={run.id} />
        <span className="type-meta text-ink-3 tabular">
          {done}/{total || '…'}
        </span>
        <StepTape run={run} size="xs" max={12} className="min-w-0" />
        <span className="flex-1" />
        {run.simulated && <SimBadge size="xs" />}
        <button
          type="button"
          onClick={() => attachRun(run.id, 'workflows')}
          className="type-caption shrink-0 rounded-xs px-1 text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink"
        >
          Details
        </button>
        {!overlay.live && (
          <button type="button" onClick={onClear} aria-label="Stop showing this run" className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-hover hover:text-ink">
            <X aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        )}
      </div>
      {pending && <ApprovalCardConnected approvalId={pending.id} variant="compact" showRun={false} className="shadow-e1" />}
      {run.status === 'failed' && run.error && (
        <p role="alert" className="type-body-sm rounded-md border border-fail/30 bg-overlay px-3 py-2 text-fail-ink shadow-e1">
          {run.error}
        </p>
      )}
    </div>
  )
}

function DraftNotes({ notes, from, onClose }: { notes: string[]; from?: string; onClose: () => void }) {
  return (
    <section aria-label="How this draft was made" data-testid="wf-draft-notes" className="w-[min(360px,calc(100vw-48px))] rounded-md border border-line bg-overlay shadow-e1">
      <header className="flex items-start gap-2 border-b border-line py-2 pr-1 pl-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="type-body-sm font-semibold text-ink">Template-based draft</h3>
          <p className="type-caption text-ink-3">Built by rules from your words — not AI. Check each step before you turn it on.</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" className="grid size-7 shrink-0 place-items-center rounded-sm text-ink-3 hover:bg-hover hover:text-ink">
          <X aria-hidden className="size-3.5" strokeWidth={2} />
        </button>
      </header>
      {from && <p className="type-caption border-b border-line px-3 py-2 text-ink-2">“{from}”</p>}
      {notes.length > 0 && (
        <ul className="flex max-h-[180px] flex-col gap-1.5 overflow-y-auto px-3 py-2">
          {notes.map((n, i) => (
            <li key={i} className="type-caption text-pretty text-ink-2">
              {n}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ stage

export function EditorStage({ workflowId }: { workflowId: string }) {
  const wf = useWorkflow(workflowId)
  const runs = useWorkflowRuns(workflowId)
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const [view] = useEditorView()
  const layout = useShellLayout()
  const agents = useAgentsById()
  const { issues, byNode } = useIssues(wf)
  const selectedNodeId = useSelectedNodeId(workflowId)
  const selectedEdgeId = useEditorStore((s) => (s.workflowId === workflowId ? s.edgeId : null))
  const selectEdge = useEditorStore((s) => s.selectEdge)
  const setOverlayRun = useEditorStore((s) => s.setOverlayRun)
  const issuesOpen = useEditorStore((s) => s.issuesOpen)
  const setIssuesOpen = useEditorStore((s) => s.setIssuesOpen)
  const drawerOpen = useEditorStore((s) => s.drawerOpen)
  const setDrawerOpen = useEditorStore((s) => s.setDrawerOpen)
  const overlayRun = useOverlayRun(wf, runs)
  const overlay = useMemo(() => (overlayRun && wf ? computeOverlay(overlayRun, wf) : null), [overlayRun, wf])
  const draft = (location.state ?? null) as DraftState | null
  const migrated = useRef<string | null>(null)

  // Graphs drawn sideways (older drafts, the demo data) are laid out top to bottom once.
  useEffect(() => {
    if (!wf || migrated.current === wf.id) return
    migrated.current = wf.id
    if (isSidewaysLayout(wf.nodes, wf.edges)) saveWorkflowLayout(wf.id, layoutGraph(wf.nodes, wf.edges))
  }, [wf])

  // A selection belongs to one workflow.
  useEffect(() => {
    const st = useEditorStore.getState()
    if (st.workflowId !== workflowId) st.select(workflowId, null)
  }, [workflowId])

  // Follow the run you started until you pick another; forget it when the workflow changes.
  useEffect(() => () => setOverlayRun(null), [workflowId, setOverlayRun])

  const onSelectNode = useCallback((nodeId: string | null, opts?: { inspect?: boolean }) => selectStep(workflowId, nodeId, opts), [workflowId])
  const onSelectEdge = useCallback((edgeId: string | null) => selectEdge(workflowId, edgeId), [selectEdge, workflowId])
  const onAddStep = useCallback(
    (type: WorkflowNodeType, afterId: string | null) => {
      const id = addStep(workflowId, type, afterId)
      if (id) onSelectNode(id, { inspect: true })
    },
    [workflowId, onSelectNode],
  )
  const clearOverlay = () => {
    setOverlayRun(null)
    if (params.has('run')) {
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('run')
          return next
        },
        { replace: true },
      )
    }
  }
  const dismissDraft = () => navigate(`${location.pathname}${location.search}`, { replace: true, state: null })

  if (!wf) {
    return (
      <div className="grid h-full place-items-center p-6">
        <EmptyState
          icon={WorkflowIcon}
          title="This workflow doesn’t exist"
          description="It may have been deleted. Past runs stay in Agents › Runs."
          actions={
            <Button variant="primary" onClick={() => navigate('/workflows')}>
              All workflows
            </Button>
          }
        />
      </div>
    )
  }

  const canvasIssues: Record<string, CanvasIssue[]> = byNode
  const showIssues = issues.length > 0 && issuesOpen

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="wf-editor" data-workflow-id={wf.id}>
      <CapabilityLine wf={wf} issues={issues} />
      <div className="relative min-h-0 flex-1">
        {view === 'canvas' ? (
          <WorkflowCanvas
            workflowId={wf.id}
            nodes={wf.nodes}
            edges={wf.edges}
            trigger={wf.trigger}
            agents={agents}
            overlay={overlay}
            issues={canvasIssues}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            onSelectNode={onSelectNode}
            onSelectEdge={onSelectEdge}
            onAddStep={onAddStep}
            minimap={layout.docking.stageWidth >= 720}
          >
            <Panel position="top-left">
              <div className="flex flex-col gap-2">
                {overlayRun && overlay && <OverlayPanel run={overlayRun} overlay={overlay} onClear={clearOverlay} />}
                {draft?.draftNotes && <DraftNotes notes={draft.draftNotes} from={draft.draftFrom} onClose={dismissDraft} />}
              </div>
            </Panel>
            {issues.length > 0 && (
              <Panel position="top-right">
                {showIssues ? (
                  <IssuesPanel issues={issues} onPick={(id) => onSelectNode(id, { inspect: true })} onClose={() => setIssuesOpen(false)} />
                ) : (
                  <Button size="sm" variant="secondary" trailingIcon={ChevronDown} onClick={() => setIssuesOpen(true)} className="shadow-e1">
                    Problems · {issues.length}
                  </Button>
                )}
              </Panel>
            )}
          </WorkflowCanvas>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {(overlayRun && overlay) || draft?.draftNotes ? (
              <div className="flex shrink-0 flex-col gap-2 border-b border-line bg-sunken px-3 py-3 md:px-6">
                {overlayRun && overlay && <OverlayPanel run={overlayRun} overlay={overlay} onClear={clearOverlay} />}
                {draft?.draftNotes && <DraftNotes notes={draft.draftNotes} from={draft.draftFrom} onClose={dismissDraft} />}
              </div>
            ) : null}
            <div className="min-h-0 flex-1">
              <OutlineView wf={wf} agents={agents} overlay={overlay} issuesByNode={byNode} selectedNodeId={selectedNodeId} onSelect={(id) => onSelectNode(id, { inspect: true })} />
            </div>
          </div>
        )}
      </div>
      {!drawerOpen && <RunsBar wf={wf} runs={runs} onOpen={() => setDrawerOpen(true)} />}
    </div>
  )
}

/** The runs drawer for the CanvasTemplate (280px table). */
export function useRunsDrawer(workflowId: string | null): CanvasDrawer | undefined {
  const wf = useWorkflow(workflowId)
  const runs = useWorkflowRuns(workflowId)
  const drawerOpen = useEditorStore((s) => s.drawerOpen)
  const setDrawerOpen = useEditorStore((s) => s.setDrawerOpen)
  const [params, setParams] = useSearchParams()
  const overlayRun = useOverlayRun(wf, runs)
  if (!wf) return undefined
  const finished = runs.filter((r) => !isRunActive(r.status))
  const ok = finished.filter((r) => r.status === 'succeeded').length
  return {
    open: drawerOpen,
    onOpenChange: setDrawerOpen,
    height: 280,
    title: (
      <span className="flex items-center gap-2">
        Runs <span className="type-meta font-normal text-ink-3">{runs.length}{finished.length ? ` · ${Math.round((ok / finished.length) * 100)}% done` : ''}</span>
        {params.get('run') && <span className="type-meta font-normal text-ink-3">· showing {shortCode(params.get('run')!)}</span>}
      </span>
    ),
    children: (
      <RunsTable
        runs={runs}
        selectedRunId={overlayRun?.id ?? null}
        onPick={(run) => {
          setParams(
            (p) => {
              const next = new URLSearchParams(p)
              next.set('run', run.id)
              return next
            },
            { replace: true },
          )
          attachRun(run.id, 'workflows')
        }}
      />
    ),
  }
}

/** A link to a workflow (used by other views). */
export function WorkflowLink({ wf, className }: { wf: Pick<Workflow, 'id' | 'name'>; className?: string }) {
  return (
    <Link to={`/workflows/${encodeURIComponent(wf.id)}`} className={className}>
      {wf.name}
    </Link>
  )
}

export { CanvasTemplate }
