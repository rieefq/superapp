import { memo, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Archive, LayoutGrid, Rows3 } from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows, ScopeFilterRow } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useAgentLiveStatuses, type AgentLiveStatus } from '@/core/services'
import type { ID } from '@/core/types'
import { AgentMark, StatusGlyph } from '@/ui'
import { sortFleet } from './logic'
import { AgentStatusGlyph, useAgentActivity, useAgentIdsInScope, useArchivedCount } from './shared'

/**
 * The Agents list pane (§3.4, §6.4): views of the run board (All runs, Needs you, Failed) and the
 * Roster, then every agent with its live status — the fleet at a glance on every Agents route.
 */
export function AgentsList() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const { agentId: routeAgentId } = useParams()
  const [query, setQuery] = useState('')
  const scope = useScope()
  const ids = useAgentIdsInScope()
  const statuses = useAgentLiveStatuses()
  const archived = useArchivedCount()
  const agentsTable = useDB((s: Tables) => s.agents)
  const agents = useMemo(() => ids.map((id) => agentsTable[id]).filter(Boolean), [ids, agentsTable])
  const counts = useViewCounts(scope)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? agents.filter((a) => a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q)) : agents
    return sortFleet(list, statuses)
  }, [agents, statuses, query])

  // Which view row is current (NavLink matching ignores the query string, so decide here).
  const onBoard = pathname === '/agents' || pathname === '/agents/'
  const status = params.get('status')
  const view = onBoard ? (status === 'waiting' ? 'needs' : status === 'failed' ? 'failed' : 'all') : pathname.startsWith('/agents/roster') ? 'roster' : null
  const selectedAgent = view === null ? routeAgentId : undefined

  return (
    <ListPane
      title="Agents"
      count={ids.length}
      onNew={() => navigate('/agents/new')}
      newLabel="New agent"
      search={{ value: query, onChange: setQuery, placeholder: 'Find an agent' }}
      footer={
        archived > 0 ? (
          <button
            type="button"
            onClick={() => navigate('/agents/roster?status=archived')}
            className="type-caption flex h-9 w-full items-center gap-2 px-4 text-left text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
          >
            <Archive aria-hidden className="size-3.5" strokeWidth={1.75} />
            Archived
            <span className="type-meta ml-auto">{archived}</span>
          </button>
        ) : undefined
      }
    >
      <ListRows label="Views" className="pt-0">
        <ListRow
          to="/agents"
          selected={view === 'all'}
          leading={<Rows3 aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
          title="All runs"
          meta={counts.running > 0 ? <span aria-label={`${counts.running} running`}>{counts.running} running</span> : undefined}
        />
        <ListRow
          to="/agents?status=waiting"
          selected={view === 'needs'}
          leading={<StatusGlyph shape="diamond" tone={counts.waiting ? 'attn' : 'ink-3'} decorative className="mx-0.5" />}
          title="Needs you"
          meta={counts.waiting ? String(counts.waiting) : undefined}
        />
        <ListRow
          to="/agents?status=failed&since=7d"
          selected={view === 'failed'}
          leading={<StatusGlyph shape="cross" tone={counts.failed ? 'fail' : 'ink-3'} decorative className="mx-0.5" />}
          title="Failed"
          meta={counts.failed ? <span aria-label={`${counts.failed} failed in the last 7 days`}>{counts.failed} · 7d</span> : undefined}
        />
        <ListRow
          to="/agents/roster"
          selected={view === 'roster'}
          leading={<LayoutGrid aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
          title="Roster"
          meta={String(ids.length)}
        />
      </ListRows>
      <ListGroup label="Agents" count={shown.length}>
        <ScopeFilterRow className="-mt-1" />
        {shown.length === 0 ? (
          <p className="type-caption px-4 py-2 text-ink-3">
            {query ? `No agents match “${query}”.` : scope ? 'No agent has worked in this project yet.' : 'No agents yet.'}
          </p>
        ) : (
          <ListRows label="Agents">
            {shown.map((a) => (
              <AgentRow key={a.id} agentId={a.id} status={statuses[a.id] ?? 'idle'} selected={a.id === selectedAgent} />
            ))}
          </ListRows>
        )}
      </ListGroup>
    </ListPane>
  )
}

/** Live counts for the view rows, in scope. */
function useViewCounts(scope: ID | null): { running: number; waiting: number; failed: number } {
  return useDB(
    useShallow((s: Tables) => {
      const since = Date.now() - 7 * 86_400_000
      let running = 0
      let waiting = 0
      let failed = 0
      for (const r of Object.values(s.runs)) {
        if (scope && r.projectId !== scope) continue
        if (r.status === 'running' || r.status === 'queued') running++
        else if (r.status === 'waiting') waiting++
        else if (r.status === 'failed' && (r.endedAt ?? r.createdAt) >= since) failed++
      }
      return { running, waiting, failed }
    }),
  )
}

const AgentRow = memo(function AgentRow({ agentId, status, selected }: { agentId: ID; status: AgentLiveStatus; selected: boolean }) {
  const agent = useDB(useShallow((s: Tables) => {
    const a = s.agents[agentId]
    return a ? { name: a.name, hue: a.hue, sigil: a.sigil, role: a.role } : null
  }))
  const activity = useAgentActivity(agentId)
  if (!agent) return null
  return (
    <ListRow
      to={`/agents/${encodeURIComponent(agentId)}`}
      selected={selected}
      entity={{ kind: 'agent', id: agentId }}
      aria-label={`${agent.name}, ${agent.role}. ${activity.line}`}
      leading={<AgentMark seed={agent.sigil} hue={agent.hue} size={24} live={status === 'working'} paused={status === 'paused'} />}
      title={agent.name}
      secondary={
        <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
          {status !== 'idle' && <AgentStatusGlyph status={status} size={10} decorative className="shrink-0" />}
          <span className="truncate">{activity.line}</span>
        </span>
      }
    />
  )
})
