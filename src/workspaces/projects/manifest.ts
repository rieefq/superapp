import { FolderKanban, FolderPlus, LayoutGrid, ListChecks } from 'lucide-react'
import { openStartSheet } from '@/app/shell/store'
import type { Command, CommandContext, WorkspaceManifest } from '@/app/types'

/** The project a Projects path is about (`/projects/:id/…`), if any. */
function projectInPath(pathname: string): string | null {
  const m = /^\/projects\/([^/?#]+)/.exec(pathname)
  if (!m || m[1] === 'my-tasks') return null
  return decodeURIComponent(m[1])
}

const isIndex = (pathname: string) => pathname === '/projects' || pathname === '/projects/'

/**
 * `N`: on a project page a new task in that project; in My tasks a task for you; on the index a new
 * project. (The label follows the page, so ⌘K reads right too.)
 */
const newAction: NonNullable<WorkspaceManifest['newAction']> = {
  get label() {
    return typeof window !== 'undefined' && isIndex(window.location.pathname) ? 'New project' : 'New task'
  },
  run: (ctx: CommandContext) => {
    if (isIndex(ctx.pathname)) {
      ctx.navigate('/projects?new=1')
      return
    }
    const projectId = projectInPath(ctx.pathname) ?? ctx.scopeProjectId
    const mine = ctx.pathname.startsWith('/projects/my-tasks')
    openStartSheet('task', { prefill: { ...(projectId ? { projectId } : {}), ...(mine ? { assignee: 'me' } : {}) } })
  },
}

export const manifest: WorkspaceManifest = {
  id: 'projects',
  label: 'Projects',
  description: 'Goals, tasks and milestones for you and your agents.',
  icon: FolderKanban,
  group: 'organize',
  path: '/projects',
  chord: ['g', 'p'],
  newAction,
  defaultInspectorTab: 'item',
  commands: (): Command[] => [
    {
      id: 'projects.new-project',
      title: 'New project',
      subtitle: 'A goal, tasks, milestones and memory',
      icon: FolderPlus,
      group: 'Projects',
      keywords: ['create', 'project', 'add'],
      priority: 40,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/projects?new=1')
      },
    },
    {
      id: 'projects.my-tasks',
      title: 'My tasks',
      subtitle: 'Overdue, today, this week — across projects',
      icon: ListChecks,
      group: 'Projects',
      keywords: ['todo', 'tasks', 'mine', 'assigned', 'due', 'overdue'],
      priority: 30,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/projects/my-tasks')
      },
    },
    {
      id: 'projects.index',
      title: 'All projects',
      icon: LayoutGrid,
      group: 'Projects',
      keywords: ['projects', 'index', 'overview'],
      priority: 20,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/projects')
      },
    },
  ],
  shortcuts: [
    { keys: 'n', label: 'New task (New project on the index)' },
    { keys: 'space', label: 'Board: pick up the focused card; arrows move it; Space drops it; Esc cancels' },
    { keys: 'enter', label: 'Open the focused task in the Inspector' },
    { keys: 'e', label: 'Task drawer: edit the title and description' },
    { keys: 'escape', label: 'Clear the selected task' },
  ],
}
