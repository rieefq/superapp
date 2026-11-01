import { memo, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ChevronDown, ChevronRight, ListChecks, Plus } from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useMyTasks, useProjectSignal, useProjects } from '@/core/services'
import type { ID, Project } from '@/core/types'
import { cn } from '@/lib/cn'
import { useMinuteNow } from '@/core/analytics'
import { dueBucket, PROJECT_STATUS_WORD, sortProjects } from './logic'
import { ProjectMark, SignalCounts } from './parts'

/**
 * The Projects list pane (Library template): My tasks, then projects — starred, active, then paused
 * and completed — with live counts. Archived projects fold into a footer toggle.
 */
export function ProjectsListPane({ currentId, myTasksActive, onNew }: { currentId?: ID; myTasksActive?: boolean; onNew: () => void }) {
  const projects = useProjects()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(() => projects.find((p) => p.id === currentId)?.status === 'archived')
  const scope = useScope()

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (p: Project) => !q || p.name.toLowerCase().includes(q) || (p.goal ?? '').toLowerCase().includes(q)
    const live = sortProjects(projects.filter((p) => p.status !== 'archived' && match(p)))
    return {
      starred: live.filter((p) => p.starred && p.status === 'active'),
      active: live.filter((p) => !p.starred && p.status === 'active'),
      other: live.filter((p) => p.status === 'paused' || p.status === 'completed'),
      archived: sortProjects(projects.filter((p) => p.status === 'archived' && match(p))),
    }
  }, [projects, query])
  const archivedCount = projects.filter((p) => p.status === 'archived').length
  const total = projects.length - archivedCount
  const empty = !groups.starred.length && !groups.active.length && !groups.other.length && !(showArchived && groups.archived.length)

  return (
    <ListPane
      title="Projects"
      count={total}
      search={{ value: query, onChange: setQuery, placeholder: 'Find a project' }}
      footer={
        <div className="flex items-center gap-1 px-1.5 py-1.5">
          <button
            type="button"
            onClick={onNew}
            className="type-caption flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-sm px-2.5 text-left font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
          >
            <Plus aria-hidden className="size-3.5" strokeWidth={2} />
            New project
          </button>
          {archivedCount > 0 && (
            <button
              type="button"
              aria-pressed={showArchived}
              onClick={() => setShowArchived((v) => !v)}
              className="type-caption flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink aria-pressed:text-ink pointer-coarse:h-11"
            >
              {showArchived ? <ChevronDown aria-hidden className="size-3.5" strokeWidth={1.75} /> : <ChevronRight aria-hidden className="size-3.5" strokeWidth={1.75} />}
              Archived
              <span className="type-meta">{archivedCount}</span>
            </button>
          )}
        </div>
      }
    >
      <ListRows label="Projects">
        {!query && <MyTasksRow active={!!myTasksActive} />}
        {groups.starred.length > 0 && (
          <ListGroup label="Starred">
            {groups.starred.map((p) => (
              <ProjectRow key={p.id} project={p} selected={p.id === currentId} inScope={p.id === scope} />
            ))}
          </ListGroup>
        )}
        {groups.active.length > 0 && (
          <ListGroup label={groups.starred.length ? 'Active' : 'Projects'}>
            {groups.active.map((p) => (
              <ProjectRow key={p.id} project={p} selected={p.id === currentId} inScope={p.id === scope} />
            ))}
          </ListGroup>
        )}
        {groups.other.length > 0 && (
          <ListGroup label="Paused and completed">
            {groups.other.map((p) => (
              <ProjectRow key={p.id} project={p} selected={p.id === currentId} inScope={p.id === scope} />
            ))}
          </ListGroup>
        )}
        {showArchived && groups.archived.length > 0 && (
          <ListGroup label="Archived">
            {groups.archived.map((p) => (
              <ProjectRow key={p.id} project={p} selected={p.id === currentId} inScope={false} />
            ))}
          </ListGroup>
        )}
      </ListRows>
      {empty && query && <p className="type-body-sm px-4 py-3 text-ink-3">No project matches “{query}”.</p>}
      {empty && !query && <p className="type-body-sm px-4 py-3 text-ink-3">No projects yet.</p>}
    </ListPane>
  )
}

function MyTasksRow({ active }: { active: boolean }) {
  const mine = useMyTasks()
  const scope = useScope()
  const now = useMinuteNow()
  const scoped = scope ? mine.filter((t) => t.projectId === scope) : mine
  const overdue = scoped.filter((t) => dueBucket(t.dueAt, now) === 'overdue').length
  return (
    <ListRow
      to="/projects/my-tasks"
      selected={active}
      leading={<ListChecks aria-hidden className="size-4 text-ink-2" strokeWidth={1.75} />}
      title="My tasks"
      meta={
        <span className="flex items-center gap-2">
          {overdue > 0 && <span className="text-ink-2">{overdue} overdue</span>}
          <span>{scoped.length}</span>
        </span>
      }
      aria-label={`My tasks, ${scoped.length} open${overdue ? `, ${overdue} overdue` : ''}`}
      className="mt-1 mb-1"
    />
  )
}

const ProjectRow = memo(function ProjectRow({ project, selected, inScope }: { project: Project; selected: boolean; inScope: boolean }) {
  const navigate = useNavigate()
  const signal = useProjectSignal(project.id)
  const open = useDB((s: Tables) => {
    let n = 0
    for (const t of Object.values(s.tasks)) if (t.projectId === project.id && t.status !== 'done' && t.status !== 'cancelled') n++
    return n
  })
  const status = project.status !== 'active' ? PROJECT_STATUS_WORD[project.status] : undefined
  return (
    <ListRow
      to={`/projects/${encodeURIComponent(project.id)}`}
      selected={selected}
      entity={{ kind: 'project', id: project.id }}
      leading={<ProjectMark project={project} size={18} />}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{project.name}</span>
          {inScope && <span className="type-meta shrink-0 text-ink-3">· in scope</span>}
        </span>
      }
      meta={
        signal.running || signal.needsYou ? (
          <SignalCounts running={signal.running} needsYou={signal.needsYou} compact />
        ) : (
          <span className={cn(status && 'text-ink-3')}>{status ?? (open || '')}</span>
        )
      }
      aria-label={[project.name, inScope ? 'in scope' : '', status ?? `${open} open tasks`, signal.running ? `${signal.running} running` : '', signal.needsYou ? `${signal.needsYou} need you` : '']
        .filter(Boolean)
        .join(', ')}
      onClick={(e) => {
        // Keep the selected tab when moving between projects.
        if (e.metaKey || e.ctrlKey || e.shiftKey) return
        const tab = window.location.pathname.split('/')[3]
        if (tab && tab !== 'overview' && ['tasks', 'work', 'activity', 'memory'].includes(tab)) {
          e.preventDefault()
          navigate(`/projects/${encodeURIComponent(project.id)}/${tab}`)
        }
      }}
    />
  )
})
