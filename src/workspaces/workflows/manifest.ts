import { FileText, Workflow } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'

const TEMPLATE_COMMANDS: { id: string; title: string }[] = [
  { id: 'weekly-digest', title: 'New workflow: Weekly digest' },
  { id: 'triage-tickets', title: 'New workflow: Triage new tickets' },
  { id: 'research-on-doc', title: 'New workflow: Research when a doc is added' },
]

export const manifest: WorkspaceManifest = {
  id: 'workflows',
  label: 'Workflows',
  description: 'Design and monitor automations across your tools.',
  icon: Workflow,
  group: 'delegate',
  path: '/workflows',
  chord: ['g', 'w'],
  newAction: { label: 'New workflow', run: (ctx) => ctx.navigate('/workflows/new') },
  defaultInspectorTab: 'item',
  // "New workflow" (N) comes from newAction; Run a workflow lives on Home and the Start sheet.
  commands: (): Command[] =>
    TEMPLATE_COMMANDS.map(
      (t, i): Command => ({
        id: `workflows.template.${t.id}`,
        title: t.title,
        subtitle: 'Creates it from the template, off until you turn it on',
        icon: FileText,
        group: 'Workflows',
        keywords: ['template', 'automation', 'automate', 'workflow'],
        priority: 30 - i,
        run: (ctx) => {
          ctx.close()
          ctx.navigate(`/workflows/new?template=${t.id}`)
        },
      }),
    ),
  shortcuts: [
    { keys: 'n', label: 'Canvas: add a step after the selection (elsewhere: new workflow)' },
    { keys: 'delete', label: 'Canvas: remove the selected step or connection (Undo toast)' },
    { keys: 'arrowup', label: 'Canvas: nudge the selected step 8px (32px with ⇧)' },
    { keys: 'shift+1', label: 'Canvas: fit the view' },
    { keys: 'escape', label: 'Canvas: clear the selection' },
  ],
}

// The in-app trigger runtime (schedules and Atrium's own events) runs while Atrium is open — started
// once after boot, lazily, so this eager module stays light. Not in tests.
if (typeof window !== 'undefined' && import.meta.env.MODE !== 'test') {
  setTimeout(() => {
    void import('@/core/services/workflows').then((m) => m.startWorkflowTriggers()).catch(() => {})
  }, 0)
}
