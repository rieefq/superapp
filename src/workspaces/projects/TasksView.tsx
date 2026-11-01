import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { CalendarRange, KanbanSquare, List, ListFilter, Plus, X } from 'lucide-react'
import { useShellLayout } from '@/app/templates'
import { openStartSheet } from '@/app/shell/store'
import { useDB, type Tables } from '@/core/db'
import { PRIORITY_LABEL, useTasks } from '@/core/services'
import { ME, type ID, type Priority, type Project } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, EmptyState, Menu, Popover, SegmentedControl, Select, useLocalStorageState, type MenuItem } from '@/ui'
import { AssignDialog } from './AssignDialog'
import { Board } from './Board'
import { activeFilterCount, labelsIn, matchesFilters, NO_FILTERS, readFilters, writeFilters, type TaskFilters, type WhoFilter } from './logic'
import { useOpenTask, useSelectedTaskId } from './parts'
import { TaskList } from './TaskList'
import { Timeline } from './Timeline'

type View = 'board' | 'list' | 'timeline'
const VIEWS: View[] = ['board', 'list', 'timeline']

/**
 * Tasks (§6.9): `Board | List | Timeline`, `Mine · Delegated · All`, and filters for milestone,
 * assignee (you or an agent), priority and label. The view and filters live in the URL.
 */
export default function TasksView({ project }: { project: Project }) {
  const [params, setParams] = useSearchParams()
  const layout = useShellLayout()
  const phone = layout.formFactor === 'phone'
  const [storedView, setStoredView] = useLocalStorageState<View>('atrium.projects.view', 'board')
  const urlView = params.get('view') as View | null
  const view: View = urlView && VIEWS.includes(urlView) ? urlView : phone && storedView === 'board' ? 'list' : storedView
  const filters = readFilters(params)
  const selectedId = useSelectedTaskId()
  const openTask = useOpenTask()
  const [assign, setAssign] = useState<{ taskId: ID | null; open: boolean }>({ taskId: null, open: false })

  const all = useTasks({ projectId: project.id })
  const visible = useMemo(() => all.filter((t) => t.status !== 'cancelled' || view === 'list').filter((t) => matchesFilters(t, filters)), [all, filters, view])
  const total = all.filter((t) => t.status !== 'cancelled').length

  const setView = (v: View) => {
    setStoredView(v)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set('view', v)
        return next
      },
      { replace: true },
    )
  }
  const setFilters = useCallback(
    (f: TaskFilters) => setParams((p) => writeFilters(p, f), { replace: true }),
    [setParams],
  )
  const onOpen = useCallback((id: ID) => openTask(id), [openTask])
  const onAssignAgent = useCallback((taskId: ID) => setAssign({ taskId, open: true }), [])
  const quickAdd = useMemo(
    () => ({ milestoneId: filters.milestone && filters.milestone !== 'none' ? filters.milestone : undefined, assignee: filters.who === 'mine' || filters.assignee === 'me' ? ME : null }),
    [filters.milestone, filters.who, filters.assignee],
  )
  const filtered = filters.who !== 'all' || activeFilterCount(filters) > 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar project={project} view={view} onView={setView} filters={filters} onFilters={setFilters} shown={visible.filter((t) => t.status !== 'cancelled').length} total={total} />
      {total === 0 && !all.length ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 pt-12">
          <EmptyState
            icon={KanbanSquare}
            title="Break the goal into tasks"
            description="Tasks can be yours or an agent’s. Assign one to an agent and it starts working right away."
            actions={
              <Button variant="primary" leadingIcon={Plus} onClick={() => openStartSheet('task', { prefill: { projectId: project.id } })}>
                New task
              </Button>
            }
          />
        </div>
      ) : filtered && visible.length === 0 && view !== 'board' ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto px-4 pt-12">
          <EmptyState
            icon={ListFilter}
            title="No tasks match these filters"
            description="Clear a filter to see more of the project."
            actions={
              <Button variant="secondary" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          />
        </div>
      ) : view === 'board' ? (
        <Board tasks={visible} projectId={project.id} selectedId={selectedId} onOpen={onOpen} onAssignAgent={onAssignAgent} quickAdd={quickAdd} phone={phone} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {view === 'list' ? (
            <TaskList project={project} tasks={visible} selectedId={selectedId} onOpen={onOpen} />
          ) : (
            <Timeline project={project} tasks={visible} selectedId={selectedId} onOpen={onOpen} />
          )}
        </div>
      )}
      <AssignDialog taskId={assign.taskId} open={assign.open} onOpenChange={(open) => setAssign((a) => ({ ...a, open }))} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ toolbar

const WHO: { value: WhoFilter; label: string }[] = [
  { value: 'mine', label: 'Mine' },
  { value: 'delegated', label: 'Delegated' },
  { value: 'all', label: 'All' },
]

const PRIORITIES: Priority[] = ['urgent', 'high', 'medium', 'low', 'none']

function useFilterOptions(project: Project) {
  const projectTasks = useDB(useShallow((s: Tables) => Object.values(s.tasks).filter((t) => t.projectId === project.id)))
  const agents = useDB(useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))))
  const labels = useMemo(() => labelsIn(projectTasks), [projectTasks])
  const milestones = useMemo(() => [...project.milestones].sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity)), [project.milestones])
  return { labels, agents, milestones }
}

function Toolbar({
  project,
  view,
  onView,
  filters,
  onFilters,
  shown,
  total,
}: {
  project: Project
  view: View
  onView: (v: View) => void
  filters: TaskFilters
  onFilters: (f: TaskFilters) => void
  shown: number
  total: number
}) {
  const { labels, agents, milestones } = useFilterOptions(project)
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => onFilters({ ...filters, [key]: value })
  const count = activeFilterCount(filters)
  const milestoneName = filters.milestone === 'none' ? 'No milestone' : milestones.find((m) => m.id === filters.milestone)?.title
  const assigneeName = filters.assignee === 'me' ? 'You' : filters.assignee === 'unassigned' ? 'Unassigned' : agents.find((a) => a.id === filters.assignee)?.name

  const menus: { key: keyof TaskFilters; label: string; value?: string; items: MenuItem[] }[] = [
    {
      key: 'milestone',
      label: 'Milestone',
      value: milestoneName,
      items: [
        { type: 'radio', id: 'any', label: 'Any milestone', checked: filters.milestone === null, onSelect: () => set('milestone', null) },
        { type: 'radio', id: 'none', label: 'No milestone', checked: filters.milestone === 'none', onSelect: () => set('milestone', 'none') },
        ...(milestones.length ? [{ type: 'separator' as const }] : []),
        ...milestones.map((m) => ({ type: 'radio' as const, id: m.id, label: m.title, checked: filters.milestone === m.id, onSelect: () => set('milestone', m.id) })),
      ],
    },
    {
      key: 'assignee',
      label: 'Assignee',
      value: assigneeName,
      items: [
        { type: 'radio', id: 'any', label: 'Anyone', checked: filters.assignee === null, onSelect: () => set('assignee', null) },
        { type: 'radio', id: 'me', label: 'You', checked: filters.assignee === 'me', onSelect: () => set('assignee', 'me') },
        { type: 'radio', id: 'unassigned', label: 'Unassigned', checked: filters.assignee === 'unassigned', onSelect: () => set('assignee', 'unassigned') },
        ...(agents.length ? [{ type: 'label' as const, label: 'Agents' }] : []),
        ...agents.map((a) => ({ type: 'radio' as const, id: a.id, label: a.name, checked: filters.assignee === a.id, onSelect: () => set('assignee', a.id) })),
      ],
    },
    {
      key: 'priority',
      label: 'Priority',
      value: filters.priority ? PRIORITY_LABEL[filters.priority] : undefined,
      items: [
        { type: 'radio', id: 'any', label: 'Any priority', checked: filters.priority === null, onSelect: () => set('priority', null) },
        ...PRIORITIES.map((p) => ({ type: 'radio' as const, id: p, label: PRIORITY_LABEL[p], checked: filters.priority === p, onSelect: () => set('priority', p) })),
      ],
    },
    {
      key: 'label',
      label: 'Label',
      value: filters.label ? `#${filters.label}` : undefined,
      items: [
        { type: 'radio', id: 'any', label: 'Any label', checked: filters.label === null, onSelect: () => set('label', null) },
        ...labels.slice(0, 30).map((l) => ({ type: 'radio' as const, id: l, label: `#${l}`, checked: filters.label === l, onSelect: () => set('label', l) })),
      ],
    },
  ]

  return (
    <div className="@container shrink-0 border-b border-line">
      <div className="flex h-10 min-w-0 items-center gap-2 px-4 md:px-6" role="toolbar" aria-label="Task view and filters">
        <SegmentedControl<View>
          size="sm"
          aria-label="View"
          value={view}
          onValueChange={onView}
          options={[
            { value: 'board', label: 'Board', icon: KanbanSquare, iconOnly: true },
            { value: 'list', label: 'List', icon: List, iconOnly: true },
            { value: 'timeline', label: 'Timeline', icon: CalendarRange, iconOnly: true },
          ]}
        />
        <span className="hidden @min-[560px]:contents">
          <SegmentedControl<WhoFilter> size="sm" aria-label="Whose tasks" value={filters.who} onValueChange={(v) => set('who', v)} options={WHO} />
        </span>
        <span className="hidden items-center gap-0.5 @min-[860px]:flex">
          {menus.map((m) => (
            <span key={m.key} className="flex items-center">
              <Menu
                items={m.items}
                aria-label={m.label}
                trigger={
                  <button
                    type="button"
                    className={cn(
                      'type-caption inline-flex h-7 items-center gap-1 rounded-sm px-2 font-medium transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press',
                      m.value ? 'bg-accent-tint text-ink' : 'text-ink-3',
                    )}
                  >
                    {m.value ? (
                      <>
                        <span className="text-ink-3">{m.label}:</span>
                        <span className="max-w-32 truncate">{m.value}</span>
                      </>
                    ) : (
                      m.label
                    )}
                  </button>
                }
              />
              {m.value && (
                <button
                  type="button"
                  aria-label={`Clear the ${m.label.toLowerCase()} filter`}
                  onClick={() => set(m.key, null as never)}
                  className="-ml-0.5 grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
                >
                  <X aria-hidden className="size-3" strokeWidth={2} />
                </button>
              )}
            </span>
          ))}
        </span>
        <span className="@min-[860px]:hidden">
          <FilterPopover filters={filters} onFilters={onFilters} labels={labels} agents={agents} milestones={milestones} count={count + (filters.who !== 'all' ? 1 : 0)} />
        </span>
        {(count > 0 || filters.who !== 'all') && (
          <Button size="xs" variant="ghost" onClick={() => onFilters(NO_FILTERS)} className="hidden @min-[860px]:inline-flex">
            Clear
          </Button>
        )}
        <span className="flex-1" />
        <span className="type-meta shrink-0 text-ink-3 tabular" aria-live="polite">
          {shown === total ? `${total} ${total === 1 ? 'task' : 'tasks'}` : `${shown} of ${total}`}
        </span>
      </div>
    </div>
  )
}

/** Narrow stages: every filter in one popover. */
function FilterPopover({
  filters,
  onFilters,
  labels,
  agents,
  milestones,
  count,
}: {
  filters: TaskFilters
  onFilters: (f: TaskFilters) => void
  labels: string[]
  agents: { id: ID; name: string }[]
  milestones: { id: ID; title: string }[]
  count: number
}) {
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) => onFilters({ ...filters, [key]: value })
  const any = '__any__'
  return (
    <Popover
      placement="bottom-start"
      aria-label="Filters"
      className="w-[min(320px,calc(100vw-16px))] p-4"
      trigger={
        <Button size="sm" variant={count ? 'secondary' : 'ghost'} leadingIcon={ListFilter}>
          Filter{count ? ` · ${count}` : ''}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <SegmentedControl<WhoFilter> size="sm" fullWidth aria-label="Whose tasks" value={filters.who} onValueChange={(v) => set('who', v)} options={WHO} />
        <Select
          size="sm"
          aria-label="Milestone"
          value={filters.milestone ?? any}
          onValueChange={(v) => set('milestone', v === any ? null : v)}
          options={[{ value: any, label: 'Any milestone' }, { value: 'none', label: 'No milestone' }, ...milestones.map((m) => ({ value: m.id, label: m.title }))]}
        />
        <Select
          size="sm"
          aria-label="Assignee"
          value={filters.assignee ?? any}
          onValueChange={(v) => set('assignee', v === any ? null : v)}
          options={[
            { value: any, label: 'Anyone' },
            { value: 'me', label: 'You' },
            { value: 'unassigned', label: 'Unassigned' },
            ...agents.map((a) => ({ value: a.id, label: a.name, group: 'Agents' })),
          ]}
        />
        <Select
          size="sm"
          aria-label="Priority"
          value={filters.priority ?? any}
          onValueChange={(v) => set('priority', v === any ? null : (v as Priority))}
          options={[{ value: any, label: 'Any priority' }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))]}
        />
        <Select
          size="sm"
          aria-label="Label"
          value={filters.label ?? any}
          onValueChange={(v) => set('label', v === any ? null : v)}
          options={[{ value: any, label: 'Any label' }, ...labels.map((l) => ({ value: l, label: `#${l}` }))]}
        />
        {count > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onFilters(NO_FILTERS)} className="self-start">
            Clear filters
          </Button>
        )}
      </div>
    </Popover>
  )
}
