import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { useDB, type Tables } from '@/core/db'
import { useScope } from '@/core/context'
import { createProject, useProjects } from '@/core/services'
import type { ID, Project } from '@/core/types'
import { Kbd, KbdCombo, VisuallyHidden } from '@/ui'
import { MonogramMark } from '@/ui/signature'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { useShellStore } from './store'
import { ShellPopover, useFormFactor, useViewportWidth } from './overlays'
import { switchScope } from './scope'

interface ProjectSignal {
  running: number
  waiting: number
  lastAt: number
}

/** Per-project running runs, waiting approvals and last activity — encoded so the list re-renders only on change. */
function useProjectSignals(enabled: boolean): Map<ID, ProjectSignal> {
  const key = useDB((s: Tables) => {
    if (!enabled) return ''
    const map = new Map<ID, ProjectSignal>()
    const get = (id: ID) => {
      let v = map.get(id)
      if (!v) map.set(id, (v = { running: 0, waiting: 0, lastAt: 0 }))
      return v
    }
    for (const r of Object.values(s.runs)) {
      if (!r.projectId) continue
      const v = get(r.projectId)
      if (r.status === 'running') v.running++
      const at = r.endedAt ?? r.startedAt ?? r.createdAt
      if (at > v.lastAt) v.lastAt = at
    }
    for (const a of Object.values(s.approvals)) {
      if (a.status !== 'pending') continue
      const pid = s.runs[a.runId]?.projectId
      if (pid) get(pid).waiting++
    }
    for (const e of Object.values(s.activity)) {
      if (!e.projectId) continue
      const v = get(e.projectId)
      if (e.at > v.lastAt) v.lastAt = e.at
    }
    return [...map.entries()].map(([id, v]) => `${id}|${v.running}|${v.waiting}|${Math.floor(v.lastAt / 60_000)}`).join(';')
  })
  return useMemo(() => {
    const out = new Map<ID, ProjectSignal>()
    if (!key) return out
    for (const part of key.split(';')) {
      const [id, running, waiting, minute] = part.split('|')
      out.set(id, { running: Number(running), waiting: Number(waiting), lastAt: Number(minute) * 60_000 })
    }
    return out
  }, [key])
}

/** Square hue mark for a project, or a neutral outline for "All work". */
export function ProjectMark({ project, size = 16 }: { project?: Pick<Project, 'name' | 'hue'> | null; size?: number }) {
  if (!project) {
    return <span aria-hidden className="inline-block shrink-0 rounded-xs border border-line-input" style={{ width: size, height: size }} />
  }
  return <MonogramMark text={project.name.slice(0, 1).toUpperCase()} hue={project.hue} size={size} className="shrink-0" />
}

type Row = { type: 'all' } | { type: 'project'; project: Project } | { type: 'new'; name: string }

/** Project crumb + switcher popover (§3.2, §3.9). `P` opens it. */
export function ProjectSwitcher({ compact = false }: { compact?: boolean }) {
  const open = useShellStore((s) => s.projectSwitcherOpen)
  const setOpen = useShellStore((s) => s.setProjectSwitcherOpen)
  const scope = useScope()
  const projects = useProjects({ status: ['active', 'paused'] })
  const current = useDB((s) => (scope ? s.projects[scope] : undefined))
  const ff = useFormFactor()
  const vw = useViewportWidth()
  const narrow = ff === 'phone' && vw < 400
  const label = current ? current.name : 'All work'
  const shortLabel = compact && label.length > 14 ? `${label.slice(0, 13)}…` : label

  return (
    <ShellPopover
      open={open}
      onOpenChange={setOpen}
      title="Switch project"
      width={420}
      placement="bottom-start"
      initialFocus={false}
      trigger={(props, state) => (
        <button
          type="button"
          {...(props as object)}
          aria-label={`Project: ${label}. Switch project`}
          aria-keyshortcuts="P"
          className={cn(
            'group flex h-8 min-w-0 shrink items-center gap-2 rounded-sm px-2 text-ink-2 transition-colors duration-(--dur-1) ease-standard',
            'hover:bg-hover hover:text-ink active:bg-press',
            state.open && 'bg-hover text-ink',
          )}
        >
          <ProjectMark project={current} size={16} />
          {!narrow && <span className="type-body-sm truncate font-medium text-ink lg:max-w-[200px]" style={{ maxWidth: compact ? 120 : 200 }}>{shortLabel}</span>}
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
        </button>
      )}
    >
      {({ close, phone }) => <SwitcherPanel projects={projects} scope={scope} close={close} phone={phone} />}
    </ShellPopover>
  )
}

function SwitcherPanel({ projects, scope, close, phone }: { projects: Project[]; scope: ID | null; close: () => void; phone: boolean }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const signals = useProjectSignals(true)
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase()
    const match = (p: Project) => !q || p.name.toLowerCase().includes(q)
    const starred = projects.filter((p) => p.starred && match(p))
    const rest = projects.filter((p) => !p.starred && match(p))
    const out: Row[] = []
    if (!q || 'all work'.includes(q)) out.push({ type: 'all' })
    for (const p of [...starred, ...rest]) out.push({ type: 'project', project: p })
    out.push({ type: 'new', name: query.trim() })
    return out
  }, [projects, query])

  const initial = Math.max(0, rows.findIndex((r) => (r.type === 'all' ? scope === null : r.type === 'project' && r.project.id === scope)))
  const [active, setActive] = useState(initial)
  const activeIndex = Math.min(active, rows.length - 1)

  const choose = (row: Row, open: boolean) => {
    if (row.type === 'new') {
      const project = createProject({ name: row.name || 'Untitled project' })
      switchScope(project.id)
      close()
      navigate(`/projects/${encodeURIComponent(project.id)}`)
      return
    }
    const id = row.type === 'all' ? null : row.project.id
    switchScope(id)
    close()
    if (open) navigate(id ? `/projects/${encodeURIComponent(id)}` : '/projects')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + rows.length) % rows.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(rows.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[activeIndex]
      if (row) choose(row, e.metaKey || e.ctrlKey)
    }
  }

  const optionId = (i: number) => `${listId}-opt-${i}`
  const starredCount = projects.filter((p) => p.starred).length

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
        <Search aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <input
          ref={inputRef}
          data-autofocus
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows[activeIndex] ? optionId(activeIndex) : undefined}
          aria-autocomplete="list"
          aria-label="Switch project"
          placeholder="Switch project…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="type-body min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Projects" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {rows.map((row, i) => {
          const selected = i === activeIndex
          const isCurrent = row.type === 'all' ? scope === null : row.type === 'project' && row.project.id === scope
          const showStarredLabel = row.type === 'project' && row.project.starred && i === rows.findIndex((r) => r.type === 'project')
          const showActiveLabel =
            row.type === 'project' && !row.project.starred && starredCount > 0 && i === rows.findIndex((r) => r.type === 'project' && !r.project.starred)
          return (
            <li key={row.type === 'project' ? row.project.id : row.type} role="presentation">
              {showStarredLabel && <div className="type-label px-2.5 pt-2.5 pb-1.5 text-ink-3">Starred</div>}
              {showActiveLabel && <div className="type-label px-2.5 pt-2.5 pb-1.5 text-ink-3">Active</div>}
              {row.type === 'new' && <div className="mx-1 my-1.5 h-px bg-line" />}
              <div
                id={optionId(i)}
                role="option"
                aria-selected={selected}
                aria-current={isCurrent || undefined}
                onPointerMove={() => setActive(i)}
                onClick={(e) => choose(row, e.metaKey || e.ctrlKey)}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-sm px-2.5 text-ink-2 transition-colors duration-(--dur-1)',
                  phone ? 'h-12' : 'h-10',
                  selected && 'bg-hover text-ink',
                )}
              >
                {row.type === 'all' && (
                  <>
                    <ProjectMark project={null} size={20} />
                    <span className="type-body-sm min-w-0 flex-1 truncate font-medium text-ink">All work</span>
                    {isCurrent && <CurrentTag />}
                  </>
                )}
                {row.type === 'project' && (
                  <>
                    <ProjectMark project={row.project} size={20} />
                    <span className="type-body-sm min-w-0 flex-1 truncate font-medium text-ink">{row.project.name}</span>
                    {isCurrent && <CurrentTag />}
                    <ProjectSignals signal={signals.get(row.project.id)} />
                  </>
                )}
                {row.type === 'new' && (
                  <>
                    <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-xs border border-line-strong text-ink-3">
                      <Plus className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span className="type-body-sm min-w-0 flex-1 truncate">
                      {row.name ? (
                        <>
                          New project <span className="text-ink">“{row.name}”</span>
                        </>
                      ) : (
                        'New project'
                      )}
                    </span>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {!phone && (
        <div className="type-meta flex h-8 shrink-0 items-center gap-3 border-t border-line px-3.5 text-ink-3">
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> switch
          </span>
          <span className="flex items-center gap-1.5">
            <KbdCombo combo="mod+enter" /> switch and open
          </span>
        </div>
      )}
    </div>
  )
}

function CurrentTag() {
  return <span className="type-meta-caps shrink-0 text-ink-3">Current</span>
}

function ProjectSignals({ signal }: { signal?: ProjectSignal }) {
  if (!signal) return null
  return (
    <span className="type-meta flex shrink-0 items-center gap-2.5 text-ink-3">
      {signal.running > 0 && (
        <span className="flex items-center gap-1 text-live-ink">
          <span aria-hidden className="size-1.5 rounded-full bg-live" />
          {signal.running}
          <VisuallyHidden> running</VisuallyHidden>
        </span>
      )}
      {signal.waiting > 0 && (
        <span className="flex items-center gap-1 text-attn-ink">
          <span aria-hidden className="size-[6px] rotate-45 rounded-[1px] bg-attn" />
          {signal.waiting}
          <VisuallyHidden> waiting on you</VisuallyHidden>
        </span>
      )}
      {signal.lastAt > 0 && <span className="w-14 text-right tabular-nums">{timeAgo(signal.lastAt)}</span>}
    </span>
  )
}
