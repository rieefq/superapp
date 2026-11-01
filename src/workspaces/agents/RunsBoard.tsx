import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Check, ChevronDown, ChevronRight, Orbit, Plus, RotateCw, Square, X } from 'lucide-react'
import { BoardTemplate, ScopeFilterRow, StageHeader, useShellLayout } from '@/app/templates'
import { useRegisterCommands } from '@/app/commands/registry'
import { attachRun, openStartSheet, useShellStore } from '@/app/shell/store'
import { markRunOpened, useFailedUnopenedIds } from '@/app/shell/runTracker'
import { switchScope } from '@/app/shell/scope'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { runEngine, useRun } from '@/core/runs'
import { approve, entityRoute, useApprovalsForRun } from '@/core/services'
import type { Approval, ID, Run } from '@/core/types'
import { cn } from '@/lib/cn'
import {
  ApprovalCardConnected,
  Button,
  Checkbox,
  EmptyState,
  IconButton,
  Menu,
  RunRow,
  SearchField,
  Tabs,
  confirm,
  formatCost,
  toast,
  useLocalStorageState,
  type MenuItem,
} from '@/ui'
import { AgentsList } from './AgentsList'
import { BoardBoundary } from './boundary'
import {
  BAND_LABEL,
  BAND_ORDER,
  DEFAULT_FILTERS,
  KIND_CHIP_LABEL,
  PROVIDER_LABEL,
  RUN_KINDS,
  SINCE_LABEL,
  STATUS_FILTER_LABEL,
  activeFilterCount,
  applyBoardFilters,
  bandRuns,
  count,
  hourlyBurn,
  parseBoardFilters,
  runMatches,
  type BandId,
  type BoardFilters,
  type ProviderFilter,
  type SinceFilter,
  type StatusFilter,
} from './logic'
import { useRunOwner, useRunProject } from './shared'

/**
 * Agents › All runs (§6.4, Board): every run in Atrium — chat turns, research, coding, agents,
 * workflows, Studio — banded by what it needs: Needs you · Running · Queued · Paused · Recent (24h)
 * · Earlier. Filters live in the URL (`?status= ?kind= ?agent= ?provider= ?since= ?q=`), the project
 * follows scope. Rows update live; selecting one docks Inspector › Run.
 */
export function RunsBoardView() {
  const { formFactor } = useShellLayout()
  const phone = formFactor === 'phone'
  return (
    <BoardTemplate
      list={phone ? undefined : <AgentsList />}
      phoneView="stage"
      header={<BoardHeader title="All runs" current="runs" />}
      filters={<RunFilters />}
      padded={false}
    >
      <BoardBoundary name="runs">
        <Board />
      </BoardBoundary>
    </BoardTemplate>
  )
}

/** Stage header for the two board views; phones get link tabs since the list pane is not shown. */
export function BoardHeader({ title, current, actions, menu }: { title: string; current: 'runs' | 'roster'; actions?: ReactNode; menu?: MenuItem[] }) {
  const { formFactor } = useShellLayout()
  return (
    <StageHeader
      title={title}
      actions={actions}
      menu={menu}
      tabs={
        formFactor === 'phone'
          ? {
              'aria-label': 'Agents views',
              value: current,
              items: [
                { value: 'runs', label: 'All runs', to: '/agents', end: true },
                { value: 'roster', label: 'Roster', to: '/agents/roster' },
              ],
            }
          : undefined
      }
    />
  )
}

// ------------------------------------------------------------------------------------------------ filters

function useBoardFilters(): [BoardFilters, (next: Partial<BoardFilters>) => void] {
  const [params, setParams] = useSearchParams()
  const agentsTable = useDB((s: Tables) => s.agents)
  const agents = useMemo(() => Object.values(agentsTable).map((a) => ({ id: a.id, name: a.name })), [agentsTable])
  const filters = useMemo(() => parseBoardFilters(params, agents), [params, agents])
  const set = useCallback(
    (next: Partial<BoardFilters>) => setParams((p) => applyBoardFilters(p, { ...parseBoardFilters(p, agents), ...next }), { replace: true }),
    [setParams, agents],
  )
  return [filters, set]
}

function FilterMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  isDefault,
}: {
  label: string
  value: T
  options: { value: T; label: string; description?: string }[]
  onChange: (v: T) => void
  isDefault: boolean
}) {
  const current = options.find((o) => o.value === value)?.label ?? label
  return (
    <Menu
      aria-label={label}
      items={options.map((o) => ({ type: 'radio' as const, id: o.value, label: o.label, description: o.description, checked: o.value === value, onSelect: () => onChange(o.value) }))}
      trigger={
        <button
          type="button"
          aria-label={`${label}: ${current}`}
          className={cn(
            'type-caption inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 font-medium whitespace-nowrap transition-colors duration-(--dur-1)',
            isDefault ? 'text-ink-3 hover:bg-hover hover:text-ink' : 'bg-press text-ink hover:bg-hover',
          )}
        >
          {current}
          <ChevronDown aria-hidden className="size-3 opacity-70" strokeWidth={2} />
        </button>
      }
    />
  )
}

function RunFilters() {
  const [filters, set] = useBoardFilters()
  const { formFactor } = useShellLayout()
  const agentsTable = useDB((s: Tables) => s.agents)
  const agents = useMemo(
    () => Object.values(agentsTable).filter((a) => a.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name)),
    [agentsTable],
  )
  const [q, setQ] = useState(filters.q)
  const pushed = useRef(filters.q)
  // Follow the URL when it changes elsewhere (Clear filters, links), never echoing our own update over newer typing.
  useEffect(() => {
    if (filters.q !== pushed.current) {
      pushed.current = filters.q
      setQ(filters.q)
    }
  }, [filters.q])
  useEffect(() => {
    if (q.trim() === filters.q) return
    const t = setTimeout(() => {
      pushed.current = q.trim()
      set({ q: q.trim() })
    }, 200)
    return () => clearTimeout(t)
  }, [q, filters.q, set])

  const ownerOptions = [
    { value: 'anyone', label: 'Anyone' },
    { value: 'you', label: 'You', description: 'Runs you did yourself (chat turns)' },
    ...agents.map((a) => ({ value: a.id, label: a.name })),
  ]
  const kindItems = [{ value: 'all' as const, label: 'All' }, ...RUN_KINDS.map((k) => ({ value: k, label: KIND_CHIP_LABEL[k] }))]
  return (
    <div className="@container/filters flex min-w-0 flex-1 items-center gap-2">
      <div className="no-scrollbar -my-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1" role="group" aria-label="Filters">
        {/* Kind chips when there is room (§6.4); a menu when the row is narrow, so no filter hides off-screen. */}
        <Tabs
          variant="pill"
          size="sm"
          aria-label="Kind"
          value={filters.kind}
          onValueChange={(v) => set({ kind: v as BoardFilters['kind'] })}
          items={kindItems}
          className="hidden shrink-0 @min-[1000px]/filters:flex"
        />
        <span className="@min-[1000px]/filters:hidden">
          <FilterMenu<BoardFilters['kind']>
            label="Kind"
            value={filters.kind}
            isDefault={filters.kind === 'all'}
            options={kindItems.map((k) => ({ value: k.value, label: k.value === 'all' ? 'Any kind' : k.label }))}
            onChange={(v) => set({ kind: v })}
          />
        </span>
        <span aria-hidden className="mx-1 hidden h-4 w-px shrink-0 bg-line @min-[1000px]/filters:block" />
        <FilterMenu
          label="Owner"
          value={filters.owner ?? 'anyone'}
          isDefault={!filters.owner}
          options={ownerOptions}
          onChange={(v) => set({ owner: v === 'anyone' ? null : v })}
        />
        <FilterMenu<StatusFilter>
          label="Status"
          value={filters.status}
          isDefault={filters.status === 'any'}
          options={(['any', 'waiting', 'running', 'queued', 'paused', 'succeeded', 'failed', 'cancelled'] as StatusFilter[]).map((v) => ({ value: v, label: STATUS_FILTER_LABEL[v] }))}
          onChange={(v) => set({ status: v })}
        />
        <FilterMenu<ProviderFilter>
          label="Provider"
          value={filters.provider}
          isDefault={filters.provider === 'all'}
          options={(['all', 'live', 'sim'] as ProviderFilter[]).map((v) => ({ value: v, label: PROVIDER_LABEL[v] }))}
          onChange={(v) => set({ provider: v })}
        />
        <FilterMenu<SinceFilter>
          label="Time"
          value={filters.since}
          isDefault={filters.since === 'any'}
          options={(['any', '24h', '7d', '30d'] as SinceFilter[]).map((v) => ({ value: v, label: SINCE_LABEL[v] }))}
          onChange={(v) => set({ since: v })}
        />
        {activeFilterCount(filters) > 0 && (
          <button
            type="button"
            onClick={() => {
              setQ('')
              set({ ...DEFAULT_FILTERS })
            }}
            className="type-caption inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 font-medium text-ink-3 hover:bg-hover hover:text-ink"
          >
            <X aria-hidden className="size-3" strokeWidth={2} />
            Clear
          </button>
        )}
      </div>
      <SearchField
        size="sm"
        value={q}
        onValueChange={setQ}
        placeholder={formFactor === 'phone' ? 'Search' : 'Title or RUN-…'}
        aria-label="Search runs by title or handle"
        kbd="/"
        data-search-input
        wrapperClassName="w-28 shrink-0 sm:w-44 lg:w-52"
      />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ board

const EARLIER_PAGE = 25

interface BandModel {
  id: BandId
  ids: ID[]
}

/** Band membership and order (re-renders only when a run changes band, order or filter result). */
function useBands(filters: BoardFilters): { bands: BandModel[]; total: number; matching: number } {
  const scope = useScope()
  const unopened = useFailedUnopenedIds()
  const unopenedKey = unopened.join(',')
  const result = useDB(
    useShallow((s: Tables) => {
      const now = Date.now()
      const all = Object.values(s.runs)
      const runs = all.filter((r) => runMatches(r, filters, scope, now))
      const pending = new Map<ID, { risk: Approval['risk']; at: number }>()
      for (const a of Object.values(s.approvals)) {
        if (a.status !== 'pending') continue
        const cur = pending.get(a.runId)
        if (!cur || a.createdAt < cur.at) pending.set(a.runId, { risk: a.risk, at: a.createdAt })
      }
      const bands = bandRuns(runs, { now, unopenedFailed: new Set(unopenedKey ? unopenedKey.split(',') : []), pending })
      // Flatten to primitives so the shallow compare is cheap and exact.
      return { key: BAND_ORDER.map((b) => `${b}=${bands[b].join(',')}`).join('|'), total: all.length, matching: runs.length }
    }),
  )
  const bands = useMemo(
    () =>
      result.key
        .split('|')
        .map((part) => {
          const [id, list] = part.split('=') as [BandId, string]
          return { id, ids: list ? list.split(',') : [] }
        })
        .filter((b) => b.ids.length > 0),
    [result.key],
  )
  return { bands, total: result.total, matching: result.matching }
}

function Board() {
  const navigate = useNavigate()
  const [filters, set] = useBoardFilters()
  const scope = useScope()
  const { bands, total, matching } = useBands(filters)
  const [selected, setSelected] = useState<ReadonlySet<ID>>(() => new Set())
  const [collapsed, setCollapsed] = useLocalStorageState<Partial<Record<BandId, boolean>>>('atrium.agents.bands', { earlier: false })
  const listRef = useRef<HTMLDivElement>(null)
  const visibleIds = useMemo(() => bands.flatMap((b) => b.ids), [bands])

  // Drop selections that left the board (finished filters, deleted runs).
  useEffect(() => {
    setSelected((cur) => {
      if (!cur.size) return cur
      const next = new Set([...cur].filter((id) => visibleIds.includes(id)))
      return next.size === cur.size ? cur : next
    })
  }, [visibleIds])

  const toggle = useCallback((id: ID) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const needsIds = bands.find((b) => b.id === 'needs')?.ids ?? []
  useRegisterCommands('agents.board', [
    {
      id: 'agents.board.approve-low',
      title: 'Approve all low-risk requests',
      subtitle: 'Lists every request before approving',
      group: 'Agents',
      icon: Check,
      run: (ctx) => {
        ctx.close()
        void approveLowRisk(needsIds)
      },
    },
    ...(activeFilterCount(filters) > 0
      ? [{ id: 'agents.board.clear', title: 'Clear run filters', group: 'Agents', icon: X, run: (ctx: { close: () => void }) => {
          ctx.close()
          set({ ...DEFAULT_FILTERS })
        } }]
      : []),
  ])

  // Keyboard (§3.11): ↑↓ / J K move, ⏎ attaches, ⌘⏎ opens, Space inspects, X selects, Esc clears the selection.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const row = target.closest<HTMLElement>('[data-run-row]')
    if (!row || target.closest('[data-approval-card]') || target.matches('input, textarea')) return
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-run-row]') ?? [])
    const index = rows.indexOf(row)
    const focusRow = (el: HTMLElement | undefined) => {
      const button = el?.querySelector<HTMLElement>('[data-row-main] button')
      button?.focus()
      button?.scrollIntoView({ block: 'nearest' })
    }
    const id = row.dataset.runRow as ID
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.key === 'Enter') {
        e.preventDefault()
        markRunOpened(id)
        navigate(entityRoute({ kind: 'run', id }))
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault()
      focusRow(rows[Math.min(rows.length - 1, index + 1)])
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault()
      focusRow(rows[Math.max(0, index - 1)])
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusRow(rows[0])
    } else if (e.key === 'End') {
      e.preventDefault()
      focusRow(rows[rows.length - 1])
    } else if (e.key === 'x' || e.key === 'X') {
      e.preventDefault()
      toggle(id)
    } else if (e.key === ' ') {
      e.preventDefault()
      setInspect(id)
    } else if (e.key === 'Escape' && selected.size) {
      e.preventDefault()
      e.stopPropagation()
      clearSelection()
    }
  }
  const [, setParams] = useSearchParams()
  const setInspect = (id: ID) =>
    setParams((p) => {
      const next = new URLSearchParams(p)
      next.set('inspect', `run:${id}`)
      return next
    })

  if (total === 0) {
    return (
      <EmptyState
        icon={Orbit}
        title="Nothing has run yet"
        description="Every AI action lands here as a run: chat turns, research, coding sessions, agents, workflows and Studio."
        actions={
          <>
            <Button variant="primary" onClick={() => openStartSheet('agent')}>
              Give an agent work
            </Button>
            <Button variant="ghost" leadingIcon={Plus} onClick={() => navigate('/agents/new')}>
              New agent
            </Button>
          </>
        }
        className="mx-auto max-w-lg py-16"
      />
    )
  }

  return (
    <div className="relative flex min-h-full flex-col">
      <ScopeFilterRow className="px-4 md:px-6" />
      {matching === 0 ? (
        <EmptyState
          compact
          title="No runs match these filters"
          description={scope ? 'Only runs in the current project are shown. Clear the filters or show every project.' : 'Clear a filter to see more runs.'}
          actions={
            <>
              {activeFilterCount(filters) > 0 && (
                <Button size="sm" variant="secondary" onClick={() => set({ ...DEFAULT_FILTERS })}>
                  Clear filters
                </Button>
              )}
              {scope && (
                <Button size="sm" variant="ghost" onClick={() => switchScope(null)}>
                  Show all projects
                </Button>
              )}
            </>
          }
          className="px-4 py-8 md:px-6"
        />
      ) : (
        <div ref={listRef} onKeyDown={onKeyDown} className="flex flex-col pb-6">
          {bands.map((band) => (
            <Band
              key={band.id}
              band={band}
              collapsed={!!collapsed[band.id]}
              onToggle={() => setCollapsed((c) => ({ ...c, [band.id]: !c[band.id] }))}
              selected={selected}
              onToggleSelect={toggle}
              showProject={!scope}
            />
          ))}
        </div>
      )}
      {selected.size > 0 && <SelectionBar ids={[...selected]} onClear={clearSelection} />}
    </div>
  )
}

async function approveLowRisk(runIds: readonly ID[]) {
  const list = db.filter('approvals', (a) => a.status === 'pending' && a.risk === 'low' && runIds.includes(a.runId))
  if (!list.length) {
    toast({ title: 'No low-risk requests are waiting' })
    return
  }
  const ok = await confirm({
    title: `Approve ${count(list.length, 'low-risk request')}?`,
    description: (
      <ul className="type-body-sm mt-1 flex list-disc flex-col gap-1 pl-5 text-ink-2">
        {list.map((a) => (
          <li key={a.id}>{a.title}</li>
        ))}
      </ul>
    ),
    confirmLabel: `Approve ${list.length}`,
  })
  if (!ok) return
  for (const a of list) approve(a.id, 'Approved with “Approve all low-risk”')
  toast.success(`Approved ${count(list.length, 'request')}`)
}

// ------------------------------------------------------------------------------------------------ bands

function BandTotals({ band }: { band: BandModel }) {
  const text = useDB((s: Tables) => {
    const runs = band.ids.map((id) => s.runs[id]).filter(Boolean) as Run[]
    if (band.id === 'running') {
      const burn = hourlyBurn(runs, Date.now())
      return burn.usd > 0 ? `${formatCost(burn.usd, { est: burn.estimate })}/h` : ''
    }
    if (band.id === 'recent' || band.id === 'earlier') {
      const failed = runs.filter((r) => r.status === 'failed').length
      return failed ? `${failed} failed` : ''
    }
    return ''
  })
  if (!text) return null
  return (
    <span className="type-meta text-ink-3" title={band.id === 'running' && text.startsWith('est.') ? 'Estimated at reference pricing; no money was spent.' : undefined}>
      · {text}
    </span>
  )
}

function Band({
  band,
  collapsed,
  onToggle,
  selected,
  onToggleSelect,
  showProject,
}: {
  band: BandModel
  collapsed: boolean
  onToggle: () => void
  selected: ReadonlySet<ID>
  onToggleSelect: (id: ID) => void
  showProject: boolean
}) {
  const [limit, setLimit] = useState(EARLIER_PAGE)
  const shown = band.id === 'earlier' ? band.ids.slice(0, limit) : band.ids
  const headingId = `band-${band.id}`
  const selecting = selected.size > 0
  return (
    <section aria-labelledby={headingId} data-band={band.id} className="flex flex-col">
      <div className="sticky top-0 z-(--z-sticky) flex h-8 shrink-0 items-center gap-2 border-b border-line bg-canvas pr-3 pl-2 md:pr-5 md:pl-4">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="-ml-1 flex h-7 min-w-0 items-center gap-1.5 rounded-sm px-1 text-left transition-colors duration-(--dur-1) hover:bg-hover"
        >
          <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-1)', !collapsed && 'rotate-90')} strokeWidth={2} />
          <h2 id={headingId} className={cn('type-label', band.id === 'needs' ? 'text-attn-ink' : 'text-ink-3')}>
            {BAND_LABEL[band.id]}
            {band.id === 'recent' && <span className="sr-only"> (last 24 hours)</span>}
          </h2>
          {band.id === 'recent' && (
            <span aria-hidden className="type-meta-caps text-ink-3">
              24H
            </span>
          )}
          <span className="type-meta text-ink-3 tabular">{band.ids.length}</span>
        </button>
        <BandTotals band={band} />
        <span className="flex-1" />
        {band.id === 'needs' && <ApproveLowRiskButton runIds={band.ids} />}
      </div>
      {!collapsed && (
        <div role="list" aria-labelledby={headingId} className="flex flex-col gap-px px-1 py-1 md:px-2">
          {shown.map((id) => (
            <BoardRow key={id} runId={id} checked={selected.has(id)} selecting={selecting} onToggleSelect={onToggleSelect} showProject={showProject} />
          ))}
          {band.id === 'earlier' && band.ids.length > shown.length && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + EARLIER_PAGE)}
              className="type-caption mx-2 mt-1 self-start rounded-sm px-2 py-1.5 font-medium text-ink-3 hover:bg-hover hover:text-ink"
            >
              Show {Math.min(EARLIER_PAGE, band.ids.length - shown.length)} more · {band.ids.length - shown.length} left
            </button>
          )}
        </div>
      )}
    </section>
  )
}

function ApproveLowRiskButton({ runIds }: { runIds: readonly ID[] }) {
  const n = useDB((s: Tables) => Object.values(s.approvals).filter((a) => a.status === 'pending' && a.risk === 'low' && runIds.includes(a.runId)).length)
  if (!n) return null
  return (
    <Button size="xs" variant="ghost" leadingIcon={Check} onClick={() => void approveLowRisk(runIds)}>
      Approve all low-risk ({n})
    </Button>
  )
}

// ------------------------------------------------------------------------------------------------ rows

const BoardRow = memo(function BoardRow({
  runId,
  checked,
  selecting,
  onToggleSelect,
  showProject,
}: {
  runId: ID
  checked: boolean
  selecting: boolean
  onToggleSelect: (id: ID) => void
  showProject: boolean
}) {
  const navigate = useNavigate()
  const run = useRun(runId)
  const owner = useRunOwner(run?.agentId)
  const project = useRunProject(showProject ? run?.projectId : null)
  const attached = useShellStore((s) => s.attachedRunId === runId)
  if (!run) return null
  const attach = () => {
    if (run.status === 'failed') markRunOpened(run.id)
    attachRun(run.id, 'agents')
  }
  const retry = () => {
    const next = runEngine.retry(run.id)
    if (next) {
      attachRun(next.id, 'agents')
      toast({ title: `Retrying “${run.title}”`, description: 'The new run starts from the first step.' })
    } else toast.error('This run can’t be retried', { description: 'Only scripted runs that failed or were stopped can run again.' })
  }
  return (
    <div role="listitem" data-run-row={run.id} className="group/brow flex flex-col">
      <div className="flex min-w-0 items-center">
        <span className={cn('flex w-7 shrink-0 justify-center pointer-coarse:hidden', !selecting && !checked && 'opacity-0 group-hover/brow:opacity-100 group-focus-within/brow:opacity-100')}>
          <Checkbox size="sm" checked={checked} onCheckedChange={() => onToggleSelect(run.id)} aria-label={`Select “${run.title}”`} tabIndex={-1} />
        </span>
        <div data-row-main className="min-w-0 flex-1">
          <RunRow
            run={run}
            agent={owner}
            project={project}
            selected={attached || checked}
            onSelect={attach}
            onAttach={attach}
            onPause={() => runEngine.pause(run.id)}
            onResume={() => runEngine.resume(run.id)}
            onStop={() => runEngine.cancel(run.id, 'Stopped by you')}
            onRetry={retry}
            onOpen={() => {
              markRunOpened(run.id)
              navigate(entityRoute({ kind: 'run', id: run.id }))
            }}
          />
        </div>
      </div>
      {run.status === 'waiting' && <PendingApprovals runId={run.id} />}
    </div>
  )
})

/** A waiting row expands in place into its compact ApprovalCard (§6.4). */
function PendingApprovals({ runId }: { runId: ID }) {
  const approvals = useApprovalsForRun(runId)
  const pending = approvals.filter((a) => a.status === 'pending')
  if (!pending.length) return null
  return (
    <div className="flex flex-col gap-2 pt-1 pr-2 pb-2.5 pl-2 sm:pl-9 md:pr-3">
      {pending.map((a) => (
        <div key={a.id} data-approval-card className="max-w-[720px]">
          <ApprovalCardConnected approvalId={a.id} variant="compact" showRun={false} />
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ bulk actions

function SelectionBar({ ids, onClear }: { ids: ID[]; onClear: () => void }) {
  const summary = useDB(
    useShallow((s: Tables) => {
      let stoppable = 0
      let retryable = 0
      for (const id of ids) {
        const r = s.runs[id]
        if (!r) continue
        if (r.status === 'running' || r.status === 'queued' || r.status === 'waiting' || r.status === 'paused') stoppable++
        if ((r.status === 'failed' || r.status === 'cancelled') && r.script) retryable++
      }
      const lowRisk = Object.values(s.approvals).filter((a) => a.status === 'pending' && a.risk === 'low' && ids.includes(a.runId)).length
      return { stoppable, retryable, lowRisk }
    }),
  )
  const stopAll = async () => {
    const runs = ids.map((id) => db.get('runs', id)).filter((r): r is Run => !!r && ['running', 'queued', 'waiting', 'paused'].includes(r.status))
    const ok = await confirm({
      title: `Stop ${count(runs.length, 'run')}?`,
      description: 'Stopped runs keep what they did so far. You can retry them later.',
      confirmLabel: `Stop ${runs.length}`,
      tone: 'danger',
    })
    if (!ok) return
    for (const r of runs) runEngine.cancel(r.id, 'Stopped by you')
    toast({ title: `Stopped ${count(runs.length, 'run')}` })
    onClear()
  }
  const retryAll = () => {
    let n = 0
    for (const id of ids) {
      const r = db.get('runs', id)
      if (r && (r.status === 'failed' || r.status === 'cancelled') && runEngine.retry(r.id)) n++
    }
    toast({ title: n ? `Retrying ${count(n, 'run')}` : 'Nothing to retry' })
    onClear()
  }
  return (
    <div
      role="region"
      aria-label="Selected runs"
      className="sticky bottom-0 z-(--z-sticky) mt-auto flex flex-wrap items-center gap-2 border-t border-line bg-raised px-4 py-2 md:px-6"
    >
      <span className="type-body-sm font-medium text-ink">{count(ids.length, 'run')} selected</span>
      <span className="flex-1" />
      <Button size="sm" variant="ghost" leadingIcon={Square} disabled={!summary.stoppable} onClick={() => void stopAll()}>
        Stop{summary.stoppable ? ` ${summary.stoppable}` : ''}
      </Button>
      <Button size="sm" variant="ghost" leadingIcon={RotateCw} disabled={!summary.retryable} onClick={retryAll}>
        Retry{summary.retryable ? ` ${summary.retryable}` : ''}
      </Button>
      <Button size="sm" variant="secondary" leadingIcon={Check} disabled={!summary.lowRisk} onClick={() => void approveLowRisk(ids).then(onClear)}>
        Approve low-risk{summary.lowRisk ? ` (${summary.lowRisk})` : ''}
      </Button>
      <IconButton icon={X} label="Clear the selection" shortcut="Escape" size="sm" onClick={onClear} />
    </div>
  )
}
