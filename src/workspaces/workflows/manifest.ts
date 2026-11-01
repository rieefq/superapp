import { CirclePlus, FileText, ListChecks, Play, Workflow } from 'lucide-react'
import { openStartSheet } from '@/app/shell/store'
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
  commands: (): Command[] => [
    {
      id: 'workflows.new',
      title: 'New workflow',
      subtitle: 'Describe it, start from a template, or a blank canvas',
      icon: CirclePlus,
      group: 'Workflows',
      keywords: ['automate', 'automation', 'create', 'workflow', 'describe'],
      priority: 40,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/workflows/new')
      },
    },
    ...TEMPLATE_COMMANDS.map(
      (t, i): Command => ({
        id: `workflows.template.${t.id}`,
        title: t.title,
        subtitle: 'Creates it from the template, off until you turn it on',
        icon: FileText,
        group: 'Workflows',
        keywords: ['template', 'automation', 'workflow'],
        priority: 30 - i,
        run: (ctx) => {
          ctx.close()
          ctx.navigate(`/workflows/new?template=${t.id}`)
        },
      }),
    ),
    {
      id: 'workflows.run',
      title: 'Run a workflow',
      subtitle: 'Opens the Start sheet',
      icon: Play,
      group: 'Workflows',
      keywords: ['run', 'start', 'automation', 'trigger'],
      priority: 35,
      run: (ctx) => {
        ctx.close()
        openStartSheet('workflow')
      },
    },
    {
      id: 'workflows.all',
      title: 'All workflows',
      icon: ListChecks,
      group: 'Workflows',
      keywords: ['list', 'automations'],
      shortcut: 'G W',
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/workflows')
      },
    },
  ],
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
