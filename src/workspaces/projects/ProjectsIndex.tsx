import { memo, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArchiveRestore, ArrowUpRight, Check, Ellipsis, FolderPlus, Link2, Plus, Star } from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import { switchScope } from '@/app/shell/scope'
import { PageTemplate } from '@/app/templates'
import { useMinuteNow } from '@/core/analytics'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import {
  archiveProject,
  computeProjectMembers,
  computeProjectSignals,
  nextMilestone,
  setProjectStatus,
  toggleStar,
  useMyTasks,
  useProjectSignal,
  useProjects,
} from '@/core/services'
import type { Project, Task } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Button, Card, EmptyState, IconButton, Menu, SegmentedControl, TickMeter, toast, Tooltip, type MenuItem } from '@/ui'
import { milestoneTick, PROJECT_STATUS_WORD, sortProjects, urgentTasks } from './logic'
import { NewProjectDialog } from './ProjectForm'
import { ActorMark, DueText, HueBand, ProjectMark, QuietLine, SignalCounts, TaskStatusGlyph } from './parts'
import { completeWithUndo } from './taskActions'

/**
 * The Projects index (§6.9, Page template, max 1280): a header with New project, the My tasks card
 * (overdue and due today), then project cards. Archived projects sit behind the Active · Archived toggle.
 */
export default function ProjectsIndex() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const projects = useProjects()
  const showArchived = params.get('show') === 'archived'
  const creating = params.get('new') === '1'

  const visible = useMemo(() => sortProjects(projects.filter((p) => (showArchived ? p.status === 'archived' : p.status !== 'archived'))), [projects, showArchived])
  const archivedCount = projects.filter((p) => p.status === 'archived').length
  const activeCount = projects.length - archivedCount

  const setCreating = (open: boolean) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (open) next.set('new', '1')
        else next.delete('new')
        return next
      },
      { replace: !open },
    )
  const setShow = (value: 'active' | 'archived') =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (value === 'archived') next.set('show', 'archived')
        else next.delete('show')
        return next
      },
      { replace: true },
    )

  useRegisterCommands('projects.index', [
    { id: 'projects.index.new', title: 'New project', icon: FolderPlus, group: 'Projects', shortcut: 'n', keywords: ['create', 'project'], run: (ctx) => (ctx.close(), setCreating(true)) },
    {
      id: 'projects.index.archived',
      title: showArchived ? 'Show active projects' : 'Show archived projects',
      icon: ArchiveRestore,
      group: 'Projects',
      keywords: ['archive', 'archived', 'restore'],
      run: (ctx) => (ctx.close(), setShow(showArchived ? 'active' : 'archived')),
    },
  ])

  return (
    <PageTemplate width="insights" className="pb-16 md:pb-16">
      <IndexHeader
        activeCount={activeCount}
        archivedCount={archivedCount}
        show={showArchived ? 'archived' : 'active'}
        onShow={setShow}
        onNew={() => setCreating(true)}
      />
      {showArchived ? (
        visible.length === 0 ? (
          <EmptyState
            icon={ArchiveRestore}
            title="Nothing archived"
            description="Archived projects keep their tasks and history. Archive one from its ⋯ menu."
            actions={
              <Button variant="secondary" onClick={() => setShow('active')}>
                Show active projects
              </Button>
            }
            className="mt-10"
          />
        ) : (
          <ul aria-label="Archived projects" className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
            {visible.map((p) => (
              <li key={p.id} className="flex min-w-0">
                <ProjectCard project={p} />
              </li>
            ))}
          </ul>
        )
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="Start your first project"
          description="Projects hold a goal, tasks and milestones, and become a scope every AI action can work inside."
          actions={
            <Button variant="primary" leadingIcon={Plus} onClick={() => setCreating(true)}>
              New project
            </Button>
          }
          className="mt-10"
        />
      ) : (
        <ul aria-label="Projects" className="mt-6 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(320px,100%),1fr))]">
          <li className="flex min-w-0">
            <MyTasksCard onOpenAll={() => navigate('/projects/my-tasks')} />
          </li>
          {visible.map((p) => (
            <li key={p.id} className="flex min-w-0">
              <ProjectCard project={p} />
            </li>
          ))}
        </ul>
      )}
      <NewProjectDialog open={creating} onOpenChange={setCreating} projects={projects} />
    </PageTemplate>
  )
}

// ------------------------------------------------------------------------------------------------ header

function IndexHeader({
  activeCount,
  archivedCount,
  show,
  onShow,
  onNew,
}: {
  activeCount: number
  archivedCount: number
  show: 'active' | 'archived'
  onShow: (v: 'active' | 'archived') => void
  onNew: () => void
}) {
  const totals = useDB(
    useShallow((s: Tables) => {
      let running = 0
      let needsYou = 0
      for (const [id, sig] of computeProjectSignals(s)) {
        if (s.projects[id]?.status === 'archived') continue
        running += sig.running
        needsYou += sig.needsYou
      }
      return { running, waiting: needsYou }
    }),
  )
  const parts = [
    `${activeCount} ${activeCount === 1 ? 'project' : 'projects'}`,
    totals.running ? `${totals.running} running` : null,
    totals.waiting ? `${totals.waiting} need${totals.waiting === 1 ? 's' : ''} you` : null,
  ].filter(Boolean)
  return (
    <header className="flex flex-col gap-3">
      <p className="type-meta-caps text-ink-3" aria-label="Status">
        {parts.map((p, i) => (
          <span key={p}>
            {i > 0 && <span aria-hidden> · </span>}
            <span className={cn(p?.includes('need') && 'text-attn-ink')}>{p}</span>
          </span>
        ))}
      </p>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="type-title-1 text-ink">Projects</h1>
          <p className="type-body-sm text-ink-3">Goals, tasks and milestones for you and your agents.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            aria-label="Show"
            value={show}
            onValueChange={onShow}
            options={[
              { value: 'active', label: `Active ${activeCount}` },
              { value: 'archived', label: `Archived ${archivedCount}` },
            ]}
          />
          <Button variant="primary" size="sm" leadingIcon={Plus} kbd="n" onClick={onNew}>
            New project
          </Button>
        </div>
      </div>
    </header>
  )
}

// ------------------------------------------------------------------------------------------------ my tasks card

const MY_TASKS_SHOWN = 5

function MyTasksCard({ onOpenAll }: { onOpenAll: () => void }) {
  const mine = useMyTasks()
  const scope = useScope()
  const now = useMinuteNow()
  const scoped = useMemo(() => (scope ? mine.filter((t) => t.projectId === scope) : mine), [mine, scope])
  const { overdue, today } = useMemo(() => urgentTasks(scoped, now), [scoped, now])
  const rows = [...overdue, ...today].slice(0, MY_TASKS_SHOWN)
  const more = overdue.length + today.length - rows.length
  const scopeName = useDB((s: Tables) => (scope ? s.projects[scope]?.name : undefined))
  return (
    <section aria-labelledby="my-tasks-card" className="flex w-full min-w-0 flex-col rounded-md border border-line bg-raised">
      <div className="flex items-start gap-3 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id="my-tasks-card" className="type-title-3 text-ink">
            My tasks
          </h2>
          <p className="type-meta text-ink-3 tabular">
            {overdue.length} overdue · {today.length} due today{scopeName ? ` · in ${scopeName}` : ''}
          </p>
        </div>
        <Button size="xs" variant="ghost" trailingIcon={ArrowUpRight} onClick={onOpenAll}>
          All {scoped.length}
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col justify-center px-4 pt-2 pb-5">
          <QuietLine>Nothing overdue or due today.</QuietLine>
          {scoped.length > 0 && <p className="type-caption text-ink-3">{scoped.length} open tasks are yours, none due today.</p>}
        </div>
      ) : (
        <ul className="flex flex-col px-2 pb-2">
          {rows.map((t) => (
            <MyTaskRow key={t.id} task={t} />
          ))}
          {more > 0 && (
            <li>
              <button type="button" onClick={onOpenAll} className="type-caption h-8 w-full rounded-sm px-2 text-left font-medium text-ink-3 hover:bg-hover hover:text-ink">
                +{more} more due today or overdue
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

const MyTaskRow = memo(function MyTaskRow({ task }: { task: Task }) {
  const navigate = useNavigate()
  const project = useDB((s: Tables) => (task.projectId ? s.projects[task.projectId] : undefined))
  return (
    <li className="group/row relative flex h-11 items-center gap-2.5 rounded-sm px-2 transition-colors duration-(--dur-1) hover:bg-hover">
      <Tooltip content="Mark done">
        <button
          type="button"
          aria-label={`Mark “${task.title}” done`}
          onClick={() => completeWithUndo(task)}
          className="relative z-10 grid size-6 shrink-0 place-items-center rounded-xs hover:bg-press"
        >
          <TaskStatusGlyph task={task} decorative />
        </button>
      </Tooltip>
      <button
        type="button"
        onClick={() => navigate(task.projectId ? `/projects/${encodeURIComponent(task.projectId)}?task=${encodeURIComponent(task.id)}` : `/projects/my-tasks?task=${encodeURIComponent(task.id)}`)}
        className="absolute inset-0 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
        aria-label={`Open “${task.title}”${project ? ` in ${project.name}` : ''}`}
      />
      <span className="type-body-sm pointer-events-none min-w-0 flex-1 truncate text-ink-2 group-hover/row:text-ink">{task.title}</span>
      {project && (
        <span className="pointer-events-none flex shrink-0" title={project.name}>
          <ProjectMark project={project} size={16} label={project.name} />
        </span>
      )}
      <DueText dueAt={task.dueAt} className="pointer-events-none w-[84px] text-right" />
    </li>
  )
})

// ------------------------------------------------------------------------------------------------ project card

const ProjectCard = memo(function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate()
  const scope = useScope()
  const signal = useProjectSignal(project.id)
  const inScope = scope === project.id
  const stats = useDB(
    useShallow((s: Tables) => {
      let done = 0
      let total = 0
      let open = 0
      for (const t of Object.values(s.tasks)) {
        if (t.projectId !== project.id || t.status === 'cancelled') continue
        total++
        if (t.status === 'done') done++
        else open++
      }
      return { done, total, open }
    }),
  )
  const members = useDB(useShallow((s: Tables) => computeProjectMembers(s, project.id).map((m) => `${m.actor.type}:${m.actor.id}:${m.activeRuns > 0 ? 1 : 0}`)))
  const next = nextMilestone(project)
  const tick = useDB((s: Tables) => milestoneTick(Object.values(s.tasks), project))
  const archived = project.status === 'archived'
  const open = () => navigate(`/projects/${encodeURIComponent(project.id)}`)

  const menu: MenuItem[] = [
    { id: 'open', label: 'Open', icon: ArrowUpRight, onSelect: open },
    ...(!archived
      ? [
          {
            id: 'scope',
            label: inScope ? 'Show all work' : 'Work in this project',
            onSelect: () => switchScope(inScope ? null : project.id),
          },
        ]
      : []),
    { id: 'star', label: project.starred ? 'Unstar' : 'Star', icon: Star, onSelect: () => toggleStar(project.id) },
    {
      id: 'link',
      label: 'Copy link',
      icon: Link2,
      onSelect: () => {
        void navigator.clipboard
          .writeText(`${window.location.origin}/projects/${encodeURIComponent(project.id)}`)
          .then(() => toast({ title: 'Link copied' }))
          .catch(() => toast({ tone: 'error', title: 'Couldn’t copy the link' }))
      },
    },
    { type: 'separator' },
    archived
      ? { id: 'restore', label: 'Restore from archive', icon: ArchiveRestore, onSelect: () => restore(project) }
      : { id: 'archive', label: 'Archive', onSelect: () => archiveWithUndo(project) },
  ]

  return (
    <Card as="article" padding="none" onClick={open} label={`Open ${project.name}`} className="flex w-full min-w-0 flex-col overflow-hidden" data-project-card={project.id}>
      <HueBand hue={project.hue} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <ProjectMark project={project} size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="type-title-3 min-w-0 truncate text-ink">{project.name}</h3>
              {project.status !== 'active' && (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-full border border-line-strong px-2 text-[11px] font-medium text-ink-2">{PROJECT_STATUS_WORD[project.status]}</span>
              )}
            </div>
            <p className="type-caption flex min-w-0 items-center gap-1.5 text-ink-3">
              {inScope ? (
                <span className="inline-flex items-center gap-1 font-medium text-ink">
                  <Check aria-hidden className="size-3" strokeWidth={2.25} />
                  In scope
                </span>
              ) : (
                <span>{PROJECT_STATUS_WORD[project.status]}</span>
              )}
              <span aria-hidden>·</span>
              <span className="truncate">{project.milestones.length ? `${project.milestones.filter((m) => m.status === 'done').length} of ${project.milestones.length} milestones` : 'No milestones'}</span>
            </p>
          </div>
          <div className="-mt-1 -mr-1.5 flex shrink-0 items-center">
            <IconButton
              icon={Star}
              size="sm"
              label={project.starred ? `Unstar ${project.name}` : `Star ${project.name}`}
              active={!!project.starred}
              onClick={() => toggleStar(project.id)}
              className={cn(project.starred ? 'text-ink [&_svg]:fill-current' : 'text-ink-3')}
            />
            <Menu items={menu} aria-label={`${project.name} actions`} placement="bottom-end" trigger={<IconButton icon={Ellipsis} size="sm" label={`More actions for ${project.name}`} />} />
          </div>
        </div>
        <p className={cn('type-body-sm line-clamp-2 min-h-9 text-pretty', project.goal ? 'text-ink-2' : 'text-ink-3')}>{project.goal || project.description || 'No goal yet.'}</p>
        <div className="flex min-h-4 items-center">
          {signal.running || signal.needsYou ? <SignalCounts running={signal.running} needsYou={signal.needsYou} /> : <span className="type-meta text-ink-3">Nothing running</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <span className="relative min-w-0 flex-1">
              <TickMeter value={stats.done} max={Math.max(1, stats.total)} label={`${project.name} tasks`} valueText={`${stats.done} of ${stats.total} tasks done`} thresholds={{ attn: 2, fail: 3 }} />
              {tick !== null && next && (
                <span aria-hidden className="absolute -top-[3px] h-[10px] w-[2px] -translate-x-1/2 rounded-[1px] bg-ink" style={{ left: `${Math.min(100, Math.max(0, tick * 100))}%` }} />
              )}
            </span>
            <span className="type-meta shrink-0 text-ink-3 tabular">
              {stats.done}/{stats.total}
            </span>
          </div>
          <p className="type-meta flex min-w-0 items-center gap-1.5 text-ink-3">
            {next ? (
              <>
                <span className="shrink-0">Next</span>
                <span className="min-w-0 truncate text-ink-2">{next.title}</span>
                {next.dueAt !== undefined && <DueText dueAt={next.dueAt} done={next.status === 'done'} className="ml-auto pl-2" />}
              </>
            ) : (
              <span>{project.milestones.length ? 'Every milestone is done' : 'No milestones yet'}</span>
            )}
          </p>
        </div>
        <div className="mt-auto flex items-center gap-2 border-t border-line pt-3">
          <MemberMarks keys={members} />
          <span className="flex-1" />
          <span className="type-meta text-ink-3">{stats.open} open</span>
          <span aria-hidden className="type-meta text-ink-4">
            ·
          </span>
          <span className="type-meta text-ink-3">{timeAgo(project.updatedAt)}</span>
        </div>
      </div>
    </Card>
  )
})

/** You and the agents working in a project, as overlapping circles (actors are circles). */
function MemberMarks({ keys }: { keys: string[] }) {
  const shown = keys.slice(0, 5)
  const rest = keys.length - shown.length
  return (
    <span className="flex items-center" role="group" aria-label={`${keys.length} ${keys.length === 1 ? 'member' : 'members'}`}>
      {shown.map((k, i) => {
        const [type, id, live] = k.split(':')
        return (
          <span key={k} className={cn('rounded-full ring-2 ring-raised [--sig-surface:var(--surface-raised)]', i > 0 && '-ml-1')}>
            <ActorMark actor={type === 'agent' ? { type: 'agent', id } : { type: 'user', id }} size={20} live={live === '1'} />
          </span>
        )
      })}
      {rest > 0 && <span className="type-meta ml-1.5 text-ink-3">+{rest}</span>}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ archive with undo

function archiveWithUndo(project: Project) {
  const result = archiveProject(project.id)
  if (!result) return
  toast({
    title: `Archived “${project.name}”`,
    description: result.wasScope ? 'Your scope went back to All work.' : 'Its tasks and history are kept.',
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        setProjectStatus(project.id, result.previous)
        if (result.wasScope) switchScope(project.id)
      },
    },
  })
}

function restore(project: Project) {
  setProjectStatus(project.id, 'active')
  toast({ title: `Restored “${project.name}”` })
}

export { archiveWithUndo, restore as restoreProject }
