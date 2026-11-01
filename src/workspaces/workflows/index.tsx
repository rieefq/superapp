import { useEffect, useMemo } from 'react'
import { Route, Routes, useMatch, useNavigate, useSearchParams } from 'react-router'
import { Plus } from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import { CanvasTemplate, StageHeader } from '@/app/templates'
import type { Command } from '@/app/types'
import { startWorkflowTriggers, useWorkflow } from '@/core/services/workflows'
import { Button, EmptyState } from '@/ui'
import { toggleEnabled, EnableDialog, TestRunDialog, useWorkflowDialogs } from './dialogs'
import { EditorHeader, EditorStage, useEditorView, useRunsDrawer } from './Editor'
import { selectStep, useEditorStore } from './editorStore'
import { IndexStage } from './IndexStage'
import { WorkflowListPane } from './ListPane'
import { NewWorkflowStage } from './Start'
import { autoLayout } from './actions'

/**
 * Workflows (docs/DESIGN.md §6.6) — the Canvas template: the list pane stays mounted while the stage
 * switches between the overview (/workflows), New workflow (/workflows/new) and the editor
 * (/workflows/:workflowId, `?view=outline`, `?run=`).
 */
export default function WorkflowsWorkspace() {
  const match = useMatch('/workflows/:segment/*')
  const segment = match?.params.segment
  const workflowId = segment && segment !== 'new' ? segment : null
  const view: 'index' | 'new' | 'editor' = !segment ? 'index' : segment === 'new' ? 'new' : 'editor'
  const [params] = useSearchParams()
  const drawer = useRunsDrawer(workflowId)

  // The in-app trigger runtime (schedules and Atrium events) — idempotent; the manifest starts it at boot too.
  useEffect(() => {
    startWorkflowTriggers()
  }, [])

  const onSelectNode = (nodeId: string | null, opts?: { inspect?: boolean }) => {
    if (workflowId) selectStep(workflowId, nodeId, opts)
  }

  return (
    <>
      <CanvasTemplate
        list={<WorkflowListPane activeId={workflowId} />}
        phoneView={view === 'index' ? 'list' : 'stage'}
        primary={workflowId ? { kind: 'workflow', id: workflowId } : null}
        header={
          view === 'editor' && workflowId ? (
            <EditorHeader workflowId={workflowId} onSelectNode={onSelectNode} />
          ) : view === 'new' ? (
            <StageHeader title="New workflow" backTo="/workflows" />
          ) : (
            <IndexHeader />
          )
        }
        drawer={view === 'editor' ? drawer : undefined}
      >
        <Routes>
          <Route index element={<IndexStage />} />
          <Route path="new" element={<NewWorkflowStage describe={params.get('describe') ?? undefined} template={params.get('template') ?? undefined} />} />
          <Route path=":workflowId" element={workflowId ? <EditorWithCommands workflowId={workflowId} /> : null} />
          <Route
            path="*"
            element={
              <div className="grid h-full place-items-center p-6">
                <EmptyState title="Nothing here" description="This address doesn’t match a workflow view." />
              </div>
            }
          />
        </Routes>
      </CanvasTemplate>
      <EnableDialog />
      <TestRunDialog />
    </>
  )
}

function IndexHeader() {
  const navigate = useNavigate()
  return (
    <StageHeader
      title="Workflows"
      actions={
        <Button size="sm" variant="secondary" leadingIcon={Plus} onClick={() => navigate('/workflows/new')}>
          New workflow
        </Button>
      }
    />
  )
}

/** The editor plus its ⌘K "Actions for this view". */
function EditorWithCommands({ workflowId }: { workflowId: string }) {
  const wf = useWorkflow(workflowId)
  const [view, setView] = useEditorView()
  const commands = useMemo<Command[]>(() => {
    if (!wf) return []
    return [
      { id: 'wf.test-run', title: `Test run “${wf.name}”`, subtitle: 'Read back, then run now', group: 'Workflow', keywords: ['run', 'start', 'test'], run: (ctx) => { ctx.close(); useWorkflowDialogs.getState().requestTestRun(wf.id) } },
      { id: 'wf.enable', title: wf.enabled ? `Turn off “${wf.name}”` : `Turn on “${wf.name}”`, group: 'Workflow', keywords: ['enable', 'disable', 'on', 'off'], run: (ctx) => { ctx.close(); toggleEnabled(wf, !wf.enabled) } },
      { id: 'wf.view', title: view === 'canvas' ? 'Show as outline' : 'Show the canvas', group: 'Workflow', keywords: ['outline', 'canvas', 'view'], run: (ctx) => { ctx.close(); setView(view === 'canvas' ? 'outline' : 'canvas') } },
      { id: 'wf.layout', title: 'Auto-layout the canvas', group: 'Workflow', keywords: ['tidy', 'arrange', 'layout'], run: (ctx) => { ctx.close(); autoLayout(wf.id) } },
      { id: 'wf.runs', title: 'Show runs of this workflow', group: 'Workflow', keywords: ['history', 'runs'], run: (ctx) => { ctx.close(); useEditorStore.getState().setDrawerOpen(true) } },
    ]
  }, [wf, view, setView])
  useRegisterCommands(`workflows.editor.${workflowId}`, commands)
  return <EditorStage workflowId={workflowId} />
}
