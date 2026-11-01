import { useMemo, useState } from 'react'
import { ListChecks, Plus } from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import { openStartSheet } from '@/app/shell/store'
import { ListRows, ScopeFilterRow, Stage, StageHeader, WorkspaceScreen } from '@/app/templates'
import { useMinuteNow } from '@/core/analytics'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useMyTasks, useProjects } from '@/core/services'
import type { Task } from '@/core/types'
import { Button, EmptyState } from '@/ui'
import { groupByDue } from './logic'
import { ProjectMark, useOpenTask, useSelectedTaskId } from './parts'
import { NewProjectDialog } from './ProjectForm'
import { ProjectsListPane } from './ProjectsListPane'
import { useTaskSelectionSync } from './selection'
import { TaskListRow } from './TaskList'

/**
 * My tasks (§6.9, `/projects/my-tasks`): your open tasks across projects — assigned to you or to
 * nobody — grouped Overdue · Today · This week · Later · No date, with quick complete.
 * Filtered to the scope like every list (`Filtered to … · Show all`).
 */
export default function MyTasks() {
  useTaskSelectionSync()
  const scope = useScope()
  const projects = useProjects()
  const [showAll, setShowAll] = useState(false)
  const [creatingProject, setCreatingProject] = useState(false)
  const mine = useMyTasks()
  const now = useMinuteNow()
  const scoped = scope && !showAll
  const visible = useMemo(() => (scoped ? mine.filter((t) => t.projectId === scope) : mine), [mine, scope, scoped])
  const groups = useMemo(() => groupByDue(visible, now), [visible, now])
  const selectedId = useSelectedTaskId()
  const openTask = useOpenTask()
  const newTask = () => openStartSheet('task', { prefill: { assignee: 'me', ...(scope ? { projectId: scope } : {}) } })

  useRegisterCommands('projects.my-tasks', [
    { id: 'projects.my-tasks.new', title: 'New task for me', icon: Plus, group: 'My tasks', shortcut: 'n', keywords: ['create', 'todo', 'task'], run: (ctx) => (ctx.close(), newTask()) },
  ])

  return (
    <WorkspaceScreen list={<ProjectsListPane myTasksActive onNew={() => setCreatingProject(true)} />} phoneView="stage">
      <Stage
        header={
          <StageHeader
            leading={<ListChecks aria-hidden className="mr-1 size-5 text-ink-2" strokeWidth={1.75} />}
            title="My tasks"
            status={<span className="type-meta text-ink-3 tabular">{visible.length} open</span>}
            backTo="/projects"
            actions={
              <Button size="sm" variant="ghost" leadingIcon={Plus} kbd="n" onClick={newTask}>
                New task
              </Button>
            }
          />
        }
        measure={960}
      >
        {scope && (scoped ? (
          <ScopeFilterRow onShowAll={() => setShowAll(true)} className="-mt-2 mb-3 px-0" />
        ) : (
          <ShowingAll onFilter={() => setShowAll(false)} />
        ))}
        {visible.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title={scoped ? 'Nothing of yours here' : 'Nothing on your plate'}
            description={scoped ? 'No open task in this project is yours. Show all to see the rest.' : 'Tasks assigned to you, or to nobody, collect here across every project.'}
            actions={
              <Button variant="primary" leadingIcon={Plus} onClick={newTask}>
                New task
              </Button>
            }
            className="mt-10"
          />
        ) : (
          <ListRows label="My tasks" className="gap-7 py-0">
            {groups.map((g) => (
              <section key={g.id} aria-labelledby={`my-${g.id}`}>
                <h2 id={`my-${g.id}`} className="type-label flex h-8 items-center gap-2 border-b border-line px-1.5 text-ink-3">
                  {g.label}
                  <span className="type-meta font-normal tracking-normal normal-case tabular">{g.tasks.length}</span>
                </h2>
                <ul className="@container flex flex-col pt-1">
                  {g.tasks.map((t) => (
                    <MyTaskRow key={t.id} task={t} selected={t.id === selectedId} onOpen={openTask} showProject={!scoped} />
                  ))}
                </ul>
              </section>
            ))}
          </ListRows>
        )}
      </Stage>
      <NewProjectDialog open={creatingProject} onOpenChange={setCreatingProject} projects={projects} />
    </WorkspaceScreen>
  )
}

function MyTaskRow({ task, selected, onOpen, showProject }: { task: Task; selected: boolean; onOpen: (id: string) => void; showProject: boolean }) {
  const project = useDB((s: Tables) => (task.projectId ? s.projects[task.projectId] : undefined))
  const info = useMemo(
    () => (showProject ? { name: project?.name ?? 'No project', mark: project ? <ProjectMark project={project} size={14} /> : <span aria-hidden className="size-3.5 rounded-[3px] border border-line-input" /> } : undefined),
    [showProject, project],
  )
  return <TaskListRow task={task} selected={selected} onOpen={onOpen} showProject={info} />
}

function ShowingAll({ onFilter }: { onFilter: () => void }) {
  const scope = useScope()
  const name = useDB((s: Tables) => (scope ? s.projects[scope]?.name : undefined))
  return (
    <div className="type-caption -mt-2 mb-3 flex h-8 items-center gap-1.5 text-ink-3">
      <span>Showing every project</span>
      <span aria-hidden>·</span>
      <button type="button" onClick={onFilter} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
        Filter to {name}
      </button>
    </div>
  )
}
