import { memo, useMemo, useRef, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Plus } from 'lucide-react'
import { BoardTemplate, ScopeFilterRow, useShellLayout } from '@/app/templates'
import { attachRun, useShellStore } from '@/app/shell/store'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useRun } from '@/core/runs'
import { runsByAgent, useAgentLiveStatuses, type AgentLiveStatus } from '@/core/services'
import { isRunActive, type ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, Button, EmptyState, StepTape, formatClock, runCurrentLine, useRunElapsed } from '@/ui'
import { RosterCard } from './AgentCard'
import { AgentsList } from './AgentsList'
import { BoardBoundary } from './boundary'
import { GiveWorkHost } from './GiveWork'
import { AGENT_STATUS_META, FLEET_ORDER, count, fleetCounts, parseFleetStatus, sortFleet } from './logic'
import { BoardHeader } from './RunsBoard'
import { AgentStatusGlyph, useAgentIdsInScope } from './shared'
import { TemplateGallery } from './TemplateGallery'

/**
 * Agents › Roster (§6.4): the fleet. Status counts that double as filters, a live "Now" strip of every
 * agent run in flight, and a card per agent sorted needs you → working → failed recently → idle → paused.
 */
export default function RosterView() {
  const navigate = useNavigate()
  const { formFactor } = useShellLayout()
  return (
    <BoardTemplate
      list={formFactor === 'phone' ? undefined : <AgentsList />}
      phoneView="stage"
      header={
        <BoardHeader
          title="Roster"
          current="roster"
          actions={
            <Button size="sm" variant="secondary" leadingIcon={Plus} onClick={() => navigate('/agents/new')}>
              New agent
            </Button>
          }
        />
      }
    >
      <BoardBoundary name="the roster">
        <Fleet />
      </BoardBoundary>
      <GiveWorkHost />
    </BoardTemplate>
  )
}

type FleetFilter = AgentLiveStatus | 'all' | 'archived'

function Fleet() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const scope = useScope()
  const filter: FleetFilter = parseFleetStatus(params.get('status')) ?? 'all'
  const ids = useAgentIdsInScope()
  const archivedIds = useDB(useShallow((s: Tables) => Object.values(s.agents).filter((a) => a.status === 'archived').map((a) => a.id)))
  const statuses = useAgentLiveStatuses()
  const agentsTable = useDB((s: Tables) => s.agents)
  const counts = fleetCounts(ids, statuses)

  const shown = useMemo(() => {
    const pool = (filter === 'archived' ? archivedIds : ids).map((id) => agentsTable[id]).filter(Boolean)
    const filtered = filter === 'all' || filter === 'archived' ? pool : pool.filter((a) => statuses[a.id] === filter)
    return sortFleet(filtered, statuses)
  }, [filter, ids, archivedIds, agentsTable, statuses])

  const setFilter = (next: FleetFilter) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (next === 'all') n.delete('status')
        else n.set('status', next === 'archived' ? 'archived' : AGENT_STATUS_META[next].param)
        return n
      },
      { replace: true },
    )

  if (!Object.keys(agentsTable).length) {
    return (
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="type-title-2 text-ink">No agents yet</h2>
          <p className="type-body text-ink-2">Start from a template. Everything can be changed after it is created.</p>
        </div>
        <TemplateGallery onPick={(id) => navigate(`/agents/new?template=${encodeURIComponent(id)}`)} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <ScopeFilterRow className="-mx-4 -mt-2 md:-mx-6" />
      <FleetFilters value={filter} counts={counts} total={ids.length} archived={archivedIds.length} onChange={setFilter} />
      {filter !== 'archived' && <NowStrip />}
      <section aria-labelledby="roster-agents" className="flex flex-col gap-3">
        <h2 id="roster-agents" className="sr-only">
          Agents
        </h2>
        {shown.length === 0 ? (
          <EmptyState
            compact
            title={filter === 'archived' ? 'No archived agents' : `No agents are ${filter === 'all' ? 'here' : AGENT_STATUS_META[filter].word.toLowerCase()}`}
            description={scope && filter === 'all' ? 'No agent has worked in this project yet. Agents that run here, hold its tasks or read its knowledge show up.' : 'Choose another status to see the rest of the fleet.'}
            actions={
              filter !== 'all' ? (
                <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                  Show every agent
                </Button>
              ) : (
                <Button size="sm" variant="secondary" leadingIcon={Plus} onClick={() => navigate('/agents/new')}>
                  New agent
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-3">
            {shown.map((a) => (
              <RosterCard key={a.id} agent={a} status={statuses[a.id] ?? 'idle'} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ fleet filters

function FleetFilters({
  value,
  counts,
  total,
  archived,
  onChange,
}: {
  value: FleetFilter
  counts: Record<AgentLiveStatus, number>
  total: number
  archived: number
  onChange: (v: FleetFilter) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const options: { value: FleetFilter; word: string; n: number }[] = [
    { value: 'all', word: 'All agents', n: total },
    ...FLEET_ORDER.map((s) => ({ value: s as FleetFilter, word: AGENT_STATUS_META[s].word, n: counts[s] })),
    ...(archived ? [{ value: 'archived' as FleetFilter, word: 'Archived', n: archived }] : []),
  ]
  // A radio group: one tab stop, arrows move and select.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.findIndex((o) => o.value === value)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = options[(i + step + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)?.focus())
  }
  return (
    <div ref={ref} role="radiogroup" aria-label="Fleet status" onKeyDown={onKeyDown} className="no-scrollbar -mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 py-0.5">
      {options.map((o) => {
        const checked = o.value === value
        const status = o.value !== 'all' && o.value !== 'archived' ? (o.value as AgentLiveStatus) : null
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-2 rounded-sm px-2.5 transition-colors duration-(--dur-1) pointer-coarse:h-11',
              checked ? 'bg-press text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
              o.n === 0 && !checked && 'text-ink-3',
            )}
          >
            {status && <AgentStatusGlyph status={status} size={11} decorative className={cn(o.n === 0 && 'opacity-50')} />}
            <span className="type-body-sm font-medium">{o.word}</span>
            <span className="type-meta text-ink-3 tabular">{o.n}</span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ now strip

/** Every agent run in flight across the fleet, needs-you first: who, what step, how far, how long. */
function NowStrip() {
  const scope = useScope()
  const ids = useDB(
    useShallow((s: Tables) => {
      const out: { id: ID; rank: number; at: number }[] = []
      for (const [agentId, runs] of runsByAgent(s.runs)) {
        if (!s.agents[agentId]) continue
        for (const r of runs) {
          if (!isRunActive(r.status) || (scope && r.projectId !== scope)) continue
          out.push({ id: r.id, rank: r.status === 'waiting' ? 0 : r.status === 'running' ? 1 : r.status === 'queued' ? 2 : 3, at: r.startedAt ?? r.createdAt })
        }
      }
      return out.sort((a, b) => a.rank - b.rank || b.at - a.at).map((x) => x.id)
    }),
  )
  if (!ids.length) {
    return (
      <section aria-labelledby="fleet-now" className="flex flex-col">
        <h2 id="fleet-now" className="type-label mb-2 text-ink-3">
          Now
        </h2>
        <p className="type-body-sm text-ink-3">No agent is working right now.</p>
      </section>
    )
  }
  return (
    <section aria-labelledby="fleet-now" className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="fleet-now" className="type-label text-ink-3">
          Now
        </h2>
        <span className="type-meta text-ink-3 tabular">{count(ids.length, 'run')} in flight</span>
      </div>
      <ul className="no-scrollbar -mx-1 flex min-w-0 snap-x gap-2 overflow-x-auto px-1 pb-1">
        {ids.map((id) => (
          <NowCard key={id} runId={id} />
        ))}
      </ul>
    </section>
  )
}

const NowCard = memo(function NowCard({ runId }: { runId: ID }) {
  const run = useRun(runId)
  const agent = useDB(useShallow((s: Tables) => {
    const a = run?.agentId ? s.agents[run.agentId] : undefined
    return a ? { name: a.name, hue: a.hue, sigil: a.sigil } : null
  }))
  const attached = useShellStore((s) => s.attachedRunId === runId)
  const elapsed = useRunElapsed(run ?? { status: 'queued', createdAt: 0 })
  if (!run || !agent) return null
  const waiting = run.status === 'waiting'
  const running = run.status === 'running'
  const done = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const line = runCurrentLine(run)
  return (
    <li className="w-[272px] shrink-0 snap-start">
      <button
        type="button"
        onClick={() => attachRun(run.id, 'agents')}
        aria-label={`${agent.name}: ${run.title}. ${waiting ? 'Needs you' : line}. Attach`}
        aria-current={attached || undefined}
        className={cn(
          'flex h-full w-full flex-col gap-2 rounded-md border px-3 py-2.5 text-left transition-colors duration-(--dur-1)',
          attached ? 'border-line-strong bg-press' : waiting ? 'border-attn/60 hover:bg-hover' : 'border-line hover:border-line-strong hover:bg-hover',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <AgentMark seed={agent.sigil} hue={agent.hue} size={20} live={running} />
          <span className="type-body-sm min-w-0 truncate font-medium text-ink">{agent.name}</span>
          <span className="type-meta ml-auto shrink-0 text-ink-3 tabular">{run.startedAt ? formatClock(elapsed) : '—'}</span>
        </span>
        <span className="type-caption truncate text-ink-2">{run.title}</span>
        <span className={cn('type-caption flex min-w-0 items-center gap-1.5', waiting ? 'text-attn-ink' : running ? 'text-live-ink' : 'text-ink-3')}>
          <AgentStatusGlyph status={waiting ? 'waiting' : running ? 'working' : 'paused'} size={10} decorative className="shrink-0" />
          <span className="truncate">{waiting ? `Needs you · ${line}` : line}</span>
        </span>
        <span className="flex items-center gap-2">
          <StepTape run={run} size="sm" max={18} />
          <span className="type-meta ml-auto shrink-0 text-ink-3 tabular">
            {done}/{total || '…'}
          </span>
        </span>
      </button>
    </li>
  )
})
