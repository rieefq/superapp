import { memo, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  ArrowUpRight, Copy, CornerLeftUp, Ellipsis, Layers, PanelRight, Pause, Play, RotateCw, ScanSearch, Square, X,
} from 'lucide-react'
import { useInspectEntity } from '@/app/templates'
import { attachRun, openCommandCenter } from '@/app/shell/store'
import { ESTIMATE_TOOLTIP } from '@/app/components'
import {
  HISTORY_STATUSES, minuteCeil, queryRuns, rangeToken, recordDurationMs, sortRunRecords, statusGroup, useMinuteNow, useRunRecords,
  type HistorySortKey, type HistoryStatus, type RunQuery, type RunRecord,
} from '@/core/analytics'
import { getModelInfo } from '@/core/ai'
import { getContext, useIsPinned } from '@/core/context'
import { useTable } from '@/core/db'
import { runEngine } from '@/core/runs'
import { entityRoute } from '@/core/services'
import { isRunActive, type EntityRef, type RunKind } from '@/core/types'
import { shortCode } from '@/lib/id'
import { formatDateTime, timeAgo } from '@/lib/format'
import {
  AgentMark, Button, DataTable, formatCost, formatSeconds, formatTokenCount, IconButton, IdCode, Menu, MonogramMark, OriginBadge,
  Pagination, RUN_KIND_ICON, RunStatusGlyph, SearchField, SegmentedControl, toast, Tooltip, useDebouncedCallback, useNow,
  type DataColumn, type MenuItem,
} from '@/ui'
import { cn } from '@/lib/cn'
import { bucketTitle, KIND_LABEL } from './logic'
import { useInsightsFilters } from './state'
import { fitColumns, useWidth } from './useWidth'

/**
 * Execution history: every run behind the Overview's numbers — searchable, sortable, paginated, in
 * the same range, project, kind and provider, plus the drill-down that led here. A row opens the
 * run where it lives; ⋯ attaches it, opens its origin, retries it.
 */

export const PAGE_SIZE = 25
const DAY = 86_400_000
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const STATUS_LABEL: Record<HistoryStatus, string> = { all: 'All', succeeded: 'Done', failed: 'Failed', cancelled: 'Stopped', active: 'In flight' }
const SORT_KEYS: readonly HistorySortKey[] = ['started', 'title', 'status', 'kind', 'duration', 'tokens', 'cost']

export function parseStatus(v: string | null): HistoryStatus {
  return HISTORY_STATUSES.includes(v as HistoryStatus) ? (v as HistoryStatus) : 'all'
}

export function parseSort(v: string | null): { key: HistorySortKey; direction: 'asc' | 'desc' } {
  const [key, dir] = (v ?? '').split(':')
  return SORT_KEYS.includes(key as HistorySortKey) ? { key: key as HistorySortKey, direction: dir === 'asc' ? 'asc' : 'desc' } : { key: 'started', direction: 'desc' }
}

/** `start-end` (epoch ms) → a slot; anything else → undefined. */
export function parseSlot(v: string | null): { start: number; end: number } | undefined {
  const m = /^(\d+)-(\d+)$/.exec(v ?? '')
  if (!m) return undefined
  const start = Number(m[1])
  const end = Number(m[2])
  return end > start ? { start, end } : undefined
}

/** `weekday-hour` → a heatmap cell. */
export function parseCell(v: string | null): { weekday: number; hour: number } | undefined {
  const m = /^([0-6])-(\d{1,2})$/.exec(v ?? '')
  if (!m || Number(m[2]) > 23) return undefined
  return { weekday: Number(m[1]), hour: Number(m[2]) }
}

export function History() {
  const navigate = useNavigate()
  const { params, filters, patch } = useInsightsFilters()
  const minute = useMinuteNow()
  const now = minuteCeil(minute)
  const records = useRunRecords()
  const agents = useTable('agents')
  const workflows = useTable('workflows')

  const status = parseStatus(params.get('status'))
  const sort = parseSort(params.get('sort'))
  const agentId = params.get('agent') || undefined
  const workflowId = params.get('workflow') || undefined
  const modelKey = params.get('model') || undefined
  const failureKey = params.get('reason') || undefined
  const slotParam = params.get('slot')
  const cellParam = params.get('cell')
  const text = params.get('q') ?? ''

  // The search field types freely; the URL follows a beat later.
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  const commitSearch = useDebouncedCallback((q: string) => patch({ q: q.trim() || null }), 250)

  const from = now - filters.rangeDays * DAY
  const kindsKey = filters.kind ?? ''
  const matching = useMemo(() => {
    const slot = parseSlot(slotParam)
    const cell = parseCell(cellParam)
    const q: RunQuery = {
      from: slot ? undefined : from,
      to: now,
      projectId: filters.projectId,
      kinds: kindsKey ? [kindsKey as RunKind] : undefined,
      provider: filters.provider,
      agentId,
      workflowId,
      modelKey,
      failureKey,
      slot,
      weekday: cell?.weekday,
      hour: cell?.hour,
      text,
    }
    return queryRuns(records, q, {
      agent: (id) => agents[id]?.name,
      workflow: (id) => workflows[id]?.name,
      model: (id) => getModelInfo(id)?.label,
    })
  }, [records, from, now, filters.projectId, kindsKey, filters.provider, agentId, workflowId, modelKey, failureKey, slotParam, cellParam, text, agents, workflows])

  const counts = useMemo(() => {
    const c: Record<HistoryStatus, number> = { all: matching.length, succeeded: 0, failed: 0, cancelled: 0, active: 0 }
    for (const r of matching) c[statusGroup(r.status)]++
    return c
  }, [matching])
  const rows = useMemo(() => (status === 'all' ? matching : matching.filter((r) => statusGroup(r.status) === status)), [matching, status])
  const sorted = useMemo(() => sortRunRecords(rows, sort.key, sort.direction, Date.now()), [rows, sort.key, sort.direction])
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const page = Math.min(pageCount, Math.max(1, Number(params.get('page')) || 1))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const [tableRef, tableWidth] = useWidth<HTMLDivElement>()
  // Columns drop by the room the table has (narrow viewports, or the Inspector docked beside it);
  // below COMPACT_BELOW each run is one two-line row: title, then kind · started · cost · SIM.
  const compact = tableWidth < COMPACT_BELOW
  const allColumns = useHistoryColumns(compact)
  const columns = useMemo(() => fitColumns(allColumns, tableWidth, HISTORY_COLUMN_MIN), [allColumns, tableWidth])
  const drills = useDrillChips()
  const agentsLink = agentsBoardLink(params, filters.rangeDays, status, agentId, filters.kind)

  return (
    <div className="flex flex-col gap-4" data-testid="insights-history">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchField
            size="sm"
            value={draft}
            onValueChange={(v) => {
              setDraft(v)
              commitSearch(v)
            }}
            onClear={() => {
              commitSearch.cancel()
              patch({ q: null })
            }}
            placeholder="Search runs, handles, failures"
            aria-label="Search runs"
            kbd="/"
            data-search-input
            className="w-full sm:w-72"
          />
          <SegmentedControl<HistoryStatus>
            size="sm"
            aria-label="Status"
            value={status}
            onValueChange={(v) => patch({ status: v === 'all' ? null : v })}
            options={HISTORY_STATUSES.map((s) => ({ value: s, label: `${STATUS_LABEL[s]} ${counts[s]}` }))}
          />
          <span className="flex-1" />
          <Link
            to={agentsLink}
            className="type-caption inline-flex h-7 items-center gap-1 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
          >
            Open in Agents
            <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.75} />
          </Link>
        </div>
        {drills.length > 0 && (
          <ul aria-label="Drill-down" className="flex flex-wrap items-center gap-1.5">
            {drills.map((d) => (
              <li key={d.param}>
                <span className="type-caption inline-flex h-7 items-center gap-1 rounded-sm border border-line-strong pr-0.5 pl-2 text-ink-2">
                  <span className="text-ink-3">{d.label}</span>
                  <span className="max-w-[260px] truncate text-ink">{d.value}</span>
                  <IconButton icon={X} size="xs" label={`Remove ${d.label.toLowerCase()} filter`} onClick={() => patch({ [d.param]: null })} />
                </span>
              </li>
            ))}
            <li>
              <Button size="xs" variant="ghost" onClick={() => patch(Object.fromEntries(drills.map((d) => [d.param, null])))}>
                Clear
              </Button>
            </li>
          </ul>
        )}
      </div>

      <div ref={tableRef} className="min-w-0 rounded-md border border-line">
        <DataTable
          caption={`Runs, ${rangeToken(filters.rangeDays)}`}
          columns={columns}
          rows={pageRows}
          rowKey={(r) => r.id}
          sort={{ key: sort.key, direction: sort.direction }}
          manualSort
          onSortChange={(s) => patch({ sort: s.key === 'started' && s.direction === 'desc' ? null : `${s.key}:${s.direction}` })}
          onRowClick={(r) => navigate(entityRoute({ kind: 'run', id: r.id }))}
          empty={
            <span className="flex flex-col items-center gap-2">
              <span>{records.length > 0 ? 'No runs match these filters.' : 'No runs yet. Every AI action you start shows up here.'}</span>
              {records.length === 0 && (
                <Button size="xs" variant="secondary" kbd="mod+k" onClick={() => openCommandCenter('')}>
                  Start something
                </Button>
              )}
              {records.length > 0 && (drills.length > 0 || text || status !== 'all') && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                    setDraft('')
                    patch({ ...Object.fromEntries(drills.map((d) => [d.param, null])), q: null, status: null })
                  }}
                >
                  Clear filters
                </Button>
              )}
            </span>
          }
          className="px-1 md:px-2"
        />
        {sorted.length > 0 && (
          <div className="border-t border-line px-3 py-1.5 md:px-4">
            <Pagination page={page} pageCount={pageCount} total={sorted.length} pageSize={PAGE_SIZE} onPageChange={(p) => patch({ page: p > 1 ? String(p) : null }, { replace: false })} />
          </div>
        )}
      </div>
    </div>
  )
}

/** `/agents` with the filters it understands (§2.6): status, kind, agent, provider, since. */
function agentsBoardLink(params: URLSearchParams, rangeDays: number, status: HistoryStatus, agentId: string | undefined, kind: string | null): string {
  const q = new URLSearchParams()
  q.set('since', rangeToken(rangeDays))
  if (status !== 'all') q.set('status', status === 'active' ? 'running' : status)
  if (kind) q.set('kind', kind)
  if (agentId) q.set('agent', agentId)
  const provider = params.get('provider')
  if (provider) q.set('provider', provider)
  return `/agents?${q.toString()}`
}

interface DrillChip {
  param: string
  label: string
  value: string
}

function useDrillChips(): DrillChip[] {
  const { params } = useInsightsFilters()
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const chips: DrillChip[] = []
  const agent = params.get('agent')
  if (agent) chips.push({ param: 'agent', label: 'Agent', value: agents[agent]?.name ?? 'Deleted agent' })
  const workflow = params.get('workflow')
  if (workflow) chips.push({ param: 'workflow', label: 'Workflow', value: workflows[workflow]?.name ?? 'Deleted workflow' })
  const model = params.get('model')
  if (model) {
    const [id, exec] = model.split('|')
    chips.push({ param: 'model', label: 'Model', value: `${getModelInfo(id)?.label ?? id}${exec === 'simulated' ? ' (simulated)' : ''}` })
  }
  if (params.get('reason')) chips.push({ param: 'reason', label: 'Failure', value: params.get('reason')!.replace(/<[a-z]+>/g, '…') })
  const slot = parseSlot(params.get('slot'))
  if (slot) chips.push({ param: 'slot', label: slot.end - slot.start <= 3_600_000 ? 'Hour' : 'Day', value: bucketTitle({ ...slot, unit: slot.end - slot.start <= 3_600_000 ? 'hour' : 'day', partial: false }) })
  const cell = parseCell(params.get('cell'))
  if (cell) chips.push({ param: 'cell', label: 'When', value: `${DAYS[cell.weekday]} ${String(cell.hour).padStart(2, '0')}:00` })
  return chips
}

// ------------------------------------------------------------------------------------------------ columns

/** Minimum table width (px) at which each optional column is shown. */
const HISTORY_COLUMN_MIN: Partial<Record<string, number>> = { duration: 680, kind: 760, tokens: 880, owner: 1040 }
/** Narrower than this, a run is one two-line cell (phones). */
const COMPACT_BELOW = 600

/** Keep clicks and keys inside a cell from also opening the row. */
const stop = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  },
}

function useHistoryColumns(compact: boolean): DataColumn<RunRecord>[] {
  return useMemo<DataColumn<RunRecord>[]>(() => {
    if (compact) {
      return [
        { key: 'title', header: 'Run', sortable: true, cell: (r) => <TitleCell record={r} compact /> },
        { key: 'actions', header: <span className="sr-only">Actions</span>, width: 48, cell: (r) => <RowActions record={r} /> },
      ]
    }
    return [
      { key: 'title', header: 'Run', sortable: true, cell: (r) => <TitleCell record={r} /> },
      {
        key: 'kind',
        header: 'Kind',
        sortable: true,
        width: 112,
        cell: (r) => {
          const Icon = RUN_KIND_ICON[r.kind]
          return (
            <span className="type-caption inline-flex items-center gap-1.5 text-ink-3">
              <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
              {KIND_LABEL[r.kind]}
            </span>
          )
        },
      },
      { key: 'owner', header: 'Owner', width: 160, cell: (r) => <OwnerCell record={r} /> },
      {
        key: 'started',
        header: 'Started',
        sortable: true,
        align: 'right',
        width: 112,
        cell: (r) => {
          const at = r.startedAt ?? r.createdAt
          return (
            <time dateTime={new Date(at).toISOString()} title={formatDateTime(at)} className="type-meta text-ink-3">
              {Date.now() - at < DAY ? timeAgo(at) : formatDateTime(at)}
            </time>
          )
        },
      },
      { key: 'duration', header: 'Time', sortable: true, align: 'right', width: 80, cell: (r) => <DurationCell record={r} /> },
      {
        key: 'tokens',
        header: 'Tokens',
        sortable: true,
        align: 'right',
        width: 80,
        cell: (r) => <span className="type-meta text-ink-3">{formatTokenCount(r.usage.inputTokens + r.usage.outputTokens)}</span>,
      },
      {
        key: 'cost',
        header: 'Cost',
        sortable: true,
        align: 'right',
        width: 88,
        cell: (r) =>
          r.simulated ? (
            <Tooltip content={ESTIMATE_TOOLTIP}>
              <span className="type-meta text-ink-2">{formatCost(r.usage.costUsd, { est: true })}</span>
            </Tooltip>
          ) : (
            <span className="type-meta text-ink-2">{formatCost(r.usage.costUsd)}</span>
          ),
      },
      {
        key: 'origin',
        header: <span className="sr-only">Execution</span>,
        width: 52,
        cell: (r) => (
          <span {...stop}>
            <OriginBadge simulated={r.simulated} />
          </span>
        ),
      },
      { key: 'actions', header: <span className="sr-only">Actions</span>, width: 44, cell: (r) => <RowActions record={r} /> },
    ]
  }, [compact])
}

const TitleCell = memo(function TitleCell({ record: r, compact }: { record: RunRecord; compact?: boolean }) {
  const route = entityRoute({ kind: 'run', id: r.id })
  const at = r.startedAt ?? r.createdAt
  const KindIcon = RUN_KIND_ICON[r.kind]
  // `w-0 min-w-full`: the cell contributes no min-content width, so long titles truncate instead of
  // widening the table past the stage.
  return (
    <span className={cn('flex w-0 min-w-full gap-2.5 py-1', compact ? 'items-start py-2' : 'items-center')}>
      <span className={cn('flex shrink-0', compact && 'pt-[3px]')}>
        <RunStatusGlyph status={r.status} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-2">
          <Link
            {...stop}
            to={route}
            data-run-link={r.id}
            className="type-body-sm min-w-0 truncate font-medium text-ink underline decoration-transparent underline-offset-2 hover:decoration-line-input"
          >
            {r.title}
          </Link>
          <span {...stop} className="hidden shrink-0 sm:inline-flex">
            <IdCode id={r.id} />
          </span>
        </span>
        {r.status === 'failed' && r.error && (
          <span className="type-caption truncate text-fail-ink" title={r.error}>
            {r.error}
          </span>
        )}
        {compact && (
          <span className="type-meta mt-0.5 flex min-w-0 items-center gap-1.5 text-ink-3">
            <time dateTime={new Date(at).toISOString()} className="shrink-0">
              {Date.now() - at < DAY ? timeAgo(at) : formatDateTime(at)}
            </time>
            <span aria-hidden>·</span>
            <span className="shrink-0 text-ink-2">{formatCost(r.usage.costUsd, { est: r.simulated })}</span>
            <span {...stop} className="flex shrink-0">
              <OriginBadge simulated={r.simulated} />
            </span>
            <span aria-hidden>·</span>
            <KindIcon aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 truncate">{KIND_LABEL[r.kind]}</span>
          </span>
        )}
      </span>
    </span>
  )
})

function OwnerCell({ record: r }: { record: RunRecord }) {
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const agent = r.agentId ? agents[r.agentId] : undefined
  const workflow = r.workflowId ? workflows[r.workflowId] : undefined
  if (agent) {
    return (
      <span className="type-caption flex w-0 min-w-full items-center gap-1.5 text-ink-2" title={workflow ? `${agent.name} · ${workflow.name}` : agent.name}>
        <AgentMark seed={agent.sigil} hue={agent.hue} size={16} />
        <span className="shrink-0">{agent.name}</span>
        {workflow && <span className="min-w-0 truncate text-ink-3">· {workflow.name}</span>}
      </span>
    )
  }
  if (workflow) {
    return (
      <span className="type-caption flex w-0 min-w-full items-center gap-1.5 text-ink-2">
        <MonogramMark text={workflow.name} hue={workflow.hue} size={16} />
        <span className="truncate">{workflow.name}</span>
      </span>
    )
  }
  return <span className="type-caption text-ink-3">{r.agentId ? 'Deleted agent' : 'You'}</span>
}

/** Finished: how long it took. Active: the elapsed time, ticking. */
function DurationCell({ record: r }: { record: RunRecord }) {
  const active = isRunActive(r.status) && r.startedAt !== undefined
  const now = useNow(active)
  const ms = recordDurationMs(r, now)
  return <span className={cn('type-meta', r.status === 'running' ? 'text-live-ink' : active ? 'text-ink-2' : 'text-ink-3')}>{ms === null ? '—' : formatSeconds(ms)}</span>
}

function RowActions({ record: r }: { record: RunRecord }) {
  const navigate = useNavigate()
  const inspect = useInspectEntity()
  const ref: EntityRef = { kind: 'run', id: r.id }
  const held = useIsPinned(ref)
  const origin = r.origin
  const canRetry = r.retryable && (r.status === 'failed' || r.status === 'cancelled')
  const items: MenuItem[] = [
    { id: 'open', label: 'Open run', icon: ArrowUpRight, onSelect: () => navigate(entityRoute(ref)) },
    { id: 'attach', label: 'Attach in Inspector', icon: PanelRight, onSelect: () => attachRun(r.id, 'insights') },
    { id: 'inspect', label: 'Inspect', icon: ScanSearch, onSelect: () => inspect(ref) },
    ...(origin ? [{ id: 'origin', label: 'Open origin', icon: CornerLeftUp, onSelect: () => navigate(entityRoute(origin)) }] : []),
    { type: 'separator' as const },
    ...(r.status === 'running' || r.status === 'queued' ? [{ id: 'pause', label: 'Pause', icon: Pause, onSelect: () => runEngine.pause(r.id) }] : []),
    ...(r.status === 'paused' ? [{ id: 'resume', label: 'Resume', icon: Play, onSelect: () => runEngine.resume(r.id) }] : []),
    ...(isRunActive(r.status) ? [{ id: 'stop', label: 'Stop', icon: Square, danger: true, onSelect: () => runEngine.cancel(r.id, 'Stopped by you') }] : []),
    ...(canRetry
      ? [
          {
            id: 'retry',
            label: 'Retry',
            icon: RotateCw,
            onSelect: () => {
              // Retry replays the run's simulation script; seeded history has none.
              const next = runEngine.retry(r.id)
              if (!next) {
                toast({ title: 'Couldn’t retry this run', description: 'Its simulation script is not available in this build.', tone: 'error' })
                return
              }
              toast({
                title: `Retrying · ${shortCode(next.id)}`,
                description: next.title,
                action: { label: 'Open', onClick: () => navigate(entityRoute({ kind: 'run', id: next.id })) },
              })
            },
          },
        ]
      : []),
    { id: 'hold', label: held ? 'Release' : 'Hold', icon: Layers, shortcut: 'h', onSelect: () => getContext().toggle(ref) },
    {
      id: 'copy',
      label: 'Copy handle',
      icon: Copy,
      onSelect: () => {
        void navigator.clipboard?.writeText(shortCode(r.id)).catch(() => undefined)
        toast({ title: `Copied ${shortCode(r.id)}` })
      },
    },
  ]
  return (
    <span {...stop} className="flex justify-end">
      <Menu
        items={items}
        placement="bottom-end"
        aria-label={`Actions for ${r.title}`}
        trigger={<IconButton icon={Ellipsis} label="Run actions" size="sm" tooltip={false} />}
      />
    </span>
  )
}

