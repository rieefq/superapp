import { memo } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight } from 'lucide-react'
import { LandedCard } from '@/app/components'
import { attachRun, useShellStore } from '@/app/shell/store'
import { markRunOpened } from '@/app/shell/runTracker'
import { useDB, type Tables } from '@/core/db'
import { runEngine, useRun } from '@/core/runs'
import { runsByAgent, useAgentDailyRuns, useAgentStats } from '@/core/services'
import { isRunActive, type Agent, type ID, type Run } from '@/core/types'
import { formatDuration, timeAgo } from '@/lib/format'
import { Button, RunRow, Sparkline, formatCost } from '@/ui'
import { count, formatRate } from '../logic'
import { LiveRun } from '../RunDetail'
import { HeaderLink, SectionLabel, useRunProject } from '../shared'

const URGENCY: Record<Run['status'], number> = { waiting: 0, running: 1, queued: 2, paused: 3, failed: 4, succeeded: 5, cancelled: 6 }

/** Now (§6.4): 30-day numbers, the live run (or the last run's result) and recent runs. */
export function NowTab({ agent }: { agent: Agent }) {
  const navigate = useNavigate()
  const base = `/agents/${encodeURIComponent(agent.id)}`
  const ids = useDB(
    useShallow((s: Tables) => {
      const runs = runsByAgent(s.runs).get(agent.id) ?? []
      const active = runs.filter((r) => isRunActive(r.status)).sort((a, b) => URGENCY[a.status] - URGENCY[b.status] || b.createdAt - a.createdAt)
      const finished = runs.filter((r) => !isRunActive(r.status)).sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt))
      return { active: active.map((r) => r.id).join(','), recent: finished.slice(0, 6).map((r) => r.id).join(','), total: runs.length }
    }),
  )
  const active = ids.active ? ids.active.split(',') : []
  const finished = ids.recent ? ids.recent.split(',') : []
  const [primary, ...others] = active
  const last = finished[0]

  return (
    <div className="flex flex-col gap-8">
      <Numbers agent={agent} />

      <section aria-labelledby="agent-now" className="flex flex-col">
        <SectionLabel id="agent-now" title="Now" count={active.length} />
        {primary ? (
          <div className="flex flex-col gap-3">
            <LiveRun
              runId={primary}
              actions={
                <Button size="xs" variant="ghost" leadingIcon={ArrowUpRight} onClick={() => navigate(`${base}?run=${encodeURIComponent(primary)}`)}>
                  Open
                </Button>
              }
            />
            {others.length > 0 && (
              <div className="flex flex-col gap-px">
                <p className="type-caption px-2 pt-1 text-ink-3">Also in flight</p>
                {others.map((id) => (
                  <AgentRunRow key={id} runId={id} agentId={agent.id} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="type-body-sm text-ink-3">
              {agent.status === 'paused' ? `${agent.name} is paused.` : agent.status === 'archived' ? `${agent.name} is archived.` : `Nothing running.`}{' '}
              {last ? 'Its last run:' : ids.total === 0 ? `${agent.name} hasn’t run yet. Give it an instruction below.` : ''}
            </p>
            {last && <LastRun runId={last} />}
          </div>
        )}
      </section>

      {finished.length > (primary ? 0 : 1) && (
        <section aria-labelledby="agent-recent" className="flex flex-col">
          <SectionLabel id="agent-recent" title="Recent runs" action={<HeaderLink onClick={() => navigate(`${base}/runs`)}>All runs</HeaderLink>} />
          <div role="list" aria-labelledby="agent-recent" className="-mx-2 flex flex-col gap-px">
            {(primary ? finished : finished.slice(1)).slice(0, 5).map((id) => (
              <div role="listitem" key={id}>
                <AgentRunRow runId={id} agentId={agent.id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Numbers({ agent }: { agent: Agent }) {
  const stats = useAgentStats(agent.id)
  const daily = useAgentDailyRuns(agent.id, 30)
  const items: { label: string; value: string; title?: string }[] = [
    { label: 'Runs · 30d', value: String(stats.runs30d) },
    { label: 'Success', value: formatRate(stats.successRate) },
    { label: 'Avg run', value: stats.avgDurationMs === null ? '—' : formatDuration(stats.avgDurationMs) },
    {
      label: 'Spend · 30d',
      value: stats.costIsEstimate ? `est. ${formatCost(stats.costUsd30d)}` : formatCost(stats.costUsd30d),
      title: stats.costIsEstimate ? 'Estimated at reference pricing; no money was spent.' : undefined,
    },
    { label: 'Last run', value: stats.lastRunAt ? timeAgo(stats.lastRunAt) : 'never' },
  ]
  return (
    <section aria-label="Last 30 days" className="flex min-w-0 flex-wrap items-end gap-x-8 gap-y-4 border-y border-line py-3.5">
      <dl className="flex min-w-0 flex-wrap gap-x-8 gap-y-3">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col gap-1">
            <dt className="type-label text-ink-3">{it.label}</dt>
            <dd className="type-mono text-ink tabular" title={it.title}>
              {it.value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex w-[180px] max-w-full flex-col gap-1 sm:ml-auto">
        <span className="type-label text-ink-3">Runs per day</span>
        <Sparkline values={daily} variant="bars" height={28} label={`${agent.name}: runs per day, last 30 days`} format={(v) => count(v, 'run')} />
      </div>
    </section>
  )
}

function LastRun({ runId }: { runId: ID }) {
  const run = useRun(runId)
  if (!run) return null
  return <LandedCard run={run} />
}

/** A run row on the agent page: select opens it in place (`?run=`), hover actions attach/pause/stop/retry. */
export const AgentRunRow = memo(function AgentRunRow({ runId, agentId }: { runId: ID; agentId: ID }) {
  const navigate = useNavigate()
  const run = useRun(runId)
  const project = useRunProject(run?.projectId)
  const attached = useShellStore((s) => s.attachedRunId === runId)
  if (!run) return null
  const open = () => {
    markRunOpened(run.id)
    navigate(`/agents/${encodeURIComponent(agentId)}?run=${encodeURIComponent(run.id)}`)
  }
  return (
    <RunRow
      run={run}
      project={project}
      selected={attached}
      onSelect={open}
      onAttach={() => attachRun(run.id, 'agents')}
      onPause={() => runEngine.pause(run.id)}
      onResume={() => runEngine.resume(run.id)}
      onStop={() => runEngine.cancel(run.id, 'Stopped by you')}
      onRetry={() => {
        const next = runEngine.retry(run.id)
        if (next) navigate(`/agents/${encodeURIComponent(agentId)}?run=${encodeURIComponent(next.id)}`)
      }}
      onOpen={open}
    />
  )
})

