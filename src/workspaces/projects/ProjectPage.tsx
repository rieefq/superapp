import { Suspense, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import {
  Activity as ActivityIcon,
  ArchiveRestore,
  Check,
  ChevronDown,
  Copy,
  Crosshair,
  FolderX,
  KanbanSquare,
  Link2,
  ListChecks,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import { switchScope } from '@/app/shell/scope'
import { openStartSheet } from '@/app/shell/store'
import { Stage, StageHeader, WorkspaceScreen, type StageMeasure } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { deleteProject, setProjectStatus, toggleStar, updateProject, useProject, useProjects } from '@/core/services'
import type { Command } from '@/app/types'
import type { Project, ProjectStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { Button, confirm, EmptyState, Menu, Skeleton, toast, type MenuItem } from '@/ui'
import { PROJECT_STATUS_WORD, readFilters } from './logic'
import { HueBand, ProjectMark } from './parts'
import { NewProjectDialog, ProjectDetailsDialog } from './ProjectForm'
import { archiveWithUndo, restoreProject } from './ProjectsIndex'
import { ProjectsListPane } from './ProjectsListPane'
import { useTaskSelectionSync } from './selection'
import Memory from './Memory'
import Overview from './Overview'
import ProjectActivity from './ProjectActivity'
import TasksView from './TasksView'
import Work from './Work'


export type ProjectTab = 'overview' | 'tasks' | 'work' | 'activity' | 'memory'
const TABS: { value: ProjectTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'work', label: 'Work' },
  { value: 'activity', label: 'Activity' },
  { value: 'memory', label: 'Memory' },
]

/** Reading caps per tab (§3.4): Overview like Home, documents for Activity and Memory, the board full width. */
const MEASURE: Record<ProjectTab, StageMeasure> = { overview: 'home', tasks: 'full', work: 960, activity: 'doc', memory: 'doc' }

/**
 * A project page (§6.9, Library template; the list pane lists projects): header with the square mark,
 * inline rename, status, **Work in this project**, tabs, New task and ⋯, then the tab's view.
 */
export default function ProjectPage() {
  const params = useParams()
  const projectId = params.projectId ?? ''
  const segment = (params['*'] ?? '').split('/')[0]
  const tab: ProjectTab = (TABS.some((t) => t.value === segment) ? segment : 'overview') as ProjectTab
  const project = useProject(projectId)
  const projects = useProjects()
  const [creatingProject, setCreatingProject] = useState(false)
  useTaskSelectionSync()

  const list = <ProjectsListPane currentId={projectId} onNew={() => setCreatingProject(true)} />

  if (!project) {
    return (
      <WorkspaceScreen list={list} phoneView="stage">
        <Stage header={<StageHeader title="Project not found" backTo="/projects" />}>
          <EmptyState
            icon={FolderX}
            title="This project doesn’t exist"
            description="It may have been deleted. Its conversations, research and knowledge were kept without a project."
            actions={<ButtonToIndex />}
            className="mt-10"
          />
        </Stage>
        <NewProjectDialog open={creatingProject} onOpenChange={setCreatingProject} projects={projects} />
      </WorkspaceScreen>
    )
  }

  return (
    <WorkspaceScreen list={list} phoneView="stage">
      <ProjectStage project={project} tab={tab} />
      <NewProjectDialog open={creatingProject} onOpenChange={setCreatingProject} projects={projects} />
    </WorkspaceScreen>
  )
}

function ButtonToIndex() {
  const navigate = useNavigate()
  return (
    <Button variant="secondary" onClick={() => navigate('/projects')}>
      All projects
    </Button>
  )
}

function ProjectStage({ project, tab }: { project: Project; tab: ProjectTab }) {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const scope = useScope()
  const inScope = scope === project.id
  const [editing, setEditing] = useState(false)
  const openTasks = useDB((s: Tables) => {
    let n = 0
    for (const t of Object.values(s.tasks)) if (t.projectId === project.id && t.status !== 'done' && t.status !== 'cancelled') n++
    return n
  })
  const taskParam = search.get('task')
  const base = `/projects/${encodeURIComponent(project.id)}`
  const keep = taskParam ? `?task=${encodeURIComponent(taskParam)}` : ''
  const archived = project.status === 'archived'

  const newTask = () => {
    const f = readFilters(search)
    openStartSheet('task', {
      prefill: {
        projectId: project.id,
        ...(f.milestone && f.milestone !== 'none' ? { milestoneId: f.milestone } : {}),
        ...(f.who === 'mine' ? { assignee: 'me' } : {}),
      },
    })
  }
  const toggleScope = () => {
    if (inScope) {
      switchScope(null)
      toast({ title: 'Showing all work', description: `${project.name} is no longer your scope.` })
    } else {
      switchScope(project.id)
      toast({ title: `Working in ${project.name}`, description: 'Lists filter to it, and new work is filed in it.' })
    }
  }
  const copy = (text: string, what: string) =>
    void navigator.clipboard
      .writeText(text)
      .then(() => toast({ title: `${what} copied` }))
      .catch(() => toast({ tone: 'error', title: `Couldn’t copy the ${what.toLowerCase()}` }))

  const remove = async () => {
    const tasks = useDB.getState().tasks
    let count = 0
    for (const t of Object.values(tasks)) if (t.projectId === project.id) count++
    const ok = await confirm({
      title: `Delete ${project.name}?`,
      description: `This deletes the project${count ? ` and its ${count} task${count === 1 ? '' : 's'}` : ''}. Conversations, research, coding sessions and knowledge are kept, without a project. This can’t be undone.`,
      confirmLabel: 'Delete project',
      tone: 'danger',
      requireText: project.name,
    })
    if (!ok) return
    deleteProject(project.id, { deleteTasks: true })
    navigate('/projects')
    toast({ title: `Deleted “${project.name}”` })
  }

  const menu: MenuItem[] = [
    { id: 'edit', label: 'Edit details…', icon: Pencil, onSelect: () => setEditing(true) },
    { id: 'star', label: project.starred ? 'Unstar' : 'Star', icon: Star, onSelect: () => toggleStar(project.id) },
    { type: 'separator' },
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => copy(`${window.location.origin}${base}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => copy(shortCode(project.id), 'Handle') },
    { type: 'separator' },
    archived
      ? { id: 'restore', label: 'Restore from archive', icon: ArchiveRestore, onSelect: () => restoreProject(project) }
      : { id: 'archive', label: 'Archive project', onSelect: () => archiveWithUndo(project) },
    { id: 'delete', label: 'Delete project…', icon: Trash2, danger: true, onSelect: () => void remove() },
  ]

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'project.scope',
        title: inScope ? 'Show all work' : `Work in ${project.name}`,
        subtitle: inScope ? 'Clear the project scope' : 'Set this project as your scope',
        icon: Crosshair,
        group: project.name,
        keywords: ['scope', 'work in', 'project'],
        run: (ctx) => (ctx.close(), toggleScope()),
      },
      { id: 'project.new-task', title: 'New task', subtitle: `In ${project.name}`, icon: Plus, group: project.name, shortcut: 'n', keywords: ['create', 'task', 'todo'], run: (ctx) => (ctx.close(), newTask()) },
      ...TABS.map((t) => ({
        id: `project.tab.${t.value}`,
        title: `Go to ${t.label}`,
        icon: t.value === 'tasks' ? KanbanSquare : t.value === 'activity' ? ActivityIcon : ListChecks,
        group: project.name,
        keywords: [t.label.toLowerCase(), 'tab'],
        run: (ctx: { close: () => void }) => (ctx.close(), navigate(`${base}/${t.value}${keep}`)),
      })),
      { id: 'project.edit', title: 'Edit project details…', icon: Pencil, group: project.name, keywords: ['rename', 'color', 'icon', 'settings'], run: (ctx) => (ctx.close(), setEditing(true)) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project.id, project.name, inScope, base, keep],
  )
  useRegisterCommands(`project.${project.id}`, commands)

  const header = (
    <>
      <HueBand hue={project.hue} />
      <StageHeader<ProjectTab>
        // The shared inline-rename button is max-w-full with -mx-1.5, so it truncates 12px early; give it its margins back.
        className="[&_h1>button]:max-w-[calc(100%+12px)]"
        leading={<ProjectMark project={project} size={20} className="mr-1" />}
        title={project.name}
        onRename={(name) => updateProject(project.id, { name })}
        status={<StatusChip project={project} />}
        backTo="/projects"
        tabs={{
          items: TABS.map((t) => ({ ...t, to: `${base}/${t.value}${keep}`, count: t.value === 'tasks' && openTasks ? openTasks : undefined })),
          value: tab,
          'aria-label': 'Project views',
        }}
        actions={
          <>
            {!archived && (
              <Button
                size="sm"
                variant={inScope ? 'secondary' : 'ghost'}
                leadingIcon={inScope ? Check : Crosshair}
                aria-pressed={inScope}
                onClick={toggleScope}
                title={inScope ? 'This project is your scope. Click to show all work.' : 'Set this project as your scope: lists filter to it and new work is filed in it.'}
              >
                {inScope ? 'In scope' : 'Work in this project'}
              </Button>
            )}
            <Button size="sm" variant="ghost" leadingIcon={Plus} kbd="n" onClick={newTask} className="max-sm:hidden">
              New task
            </Button>
          </>
        }
        menu={menu}
      />
    </>
  )

  const view: Record<ProjectTab, ReactNode> = {
    overview: <Overview project={project} />,
    tasks: <TasksView project={project} />,
    work: <Work project={project} />,
    activity: <ProjectActivity project={project} />,
    memory: <Memory project={project} />,
  }
  const board = tab === 'tasks'

  return (
    <>
      <Stage
        primary={{ kind: 'project', id: project.id }}
        header={header}
        measure={MEASURE[tab]}
        scroll={!board}
        padded={!board}
        bodyClassName={cn(tab === 'overview' && 'md:pt-7')}
      >
        {archived && <ArchivedNote project={project} />}
        <Suspense fallback={<TabSkeleton />}>{view[tab]}</Suspense>
      </Stage>
      <ProjectDetailsDialog project={project} open={editing} onOpenChange={setEditing} />
    </>
  )
}

// ------------------------------------------------------------------------------------------------ header parts

const STATUS_CHOICES: ProjectStatus[] = ['active', 'paused', 'completed']

/** The status chip (a capsule): Active · Paused · Completed. Archive lives in ⋯. */
function StatusChip({ project }: { project: Project }) {
  if (project.status === 'archived') {
    return <span className="type-caption inline-flex h-[22px] items-center rounded-full border border-line-strong px-2.5 font-medium text-ink-3">Archived</span>
  }
  return (
    <Menu
      aria-label="Project status"
      items={[
        { type: 'label', label: 'Status' },
        ...STATUS_CHOICES.map((s) => ({
          type: 'radio' as const,
          id: s,
          label: PROJECT_STATUS_WORD[s],
          checked: project.status === s,
          onSelect: () => setProjectStatus(project.id, s),
        })),
      ]}
      trigger={
        <button
          type="button"
          aria-label={`Status: ${PROJECT_STATUS_WORD[project.status]}. Change status`}
          className="type-caption inline-flex h-[22px] items-center gap-1 rounded-full border border-line-strong pr-1.5 pl-2.5 font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press"
        >
          {PROJECT_STATUS_WORD[project.status]}
          <ChevronDown aria-hidden className="size-3 text-ink-3" strokeWidth={2} />
        </button>
      }
    />
  )
}

function ArchivedNote({ project }: { project: Project }) {
  return (
    <div className="type-body-sm mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-raised px-4 py-2.5 text-ink-2">
      <span className="min-w-0 flex-1">This project is archived. Its tasks and history are kept; it stays out of lists and the project switcher.</span>
      <Button size="xs" variant="secondary" leadingIcon={ArchiveRestore} onClick={() => restoreProject(project)}>
        Restore
      </Button>
    </div>
  )
}

function TabSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex flex-col gap-3 p-4">
      <Skeleton height={14} width="30%" />
      {[64, 52, 58, 40].map((w, i) => (
        <div key={i} className="flex h-9 items-center gap-3">
          <Skeleton variant="circle" size={12} />
          <Skeleton height={10} width={`${w}%`} />
        </div>
      ))}
    </div>
  )
}
