import { memo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Ellipsis } from 'lucide-react'
import { attachRun } from '@/app/shell/store'
import { useRun } from '@/core/runs'
import { useAgentStats, type AgentLiveStatus, type AgentStats } from '@/core/services'
import type { Agent, ID, Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { AgentMark, Button, IconButton, Menu, StepTape, formatCost, type MenuItem } from '@/ui'
import { summarizeAbilities, useAbilityRows } from './abilities'
import { agentMenuItems } from './agentActions'
import { openGiveWork } from './GiveWork'
import { count, formatRate } from './logic'
import { AgentStatusGlyph, AutonomyChip, useAgentActivity } from './shared'

export interface AgentCardViewProps {
  agent: Pick<Agent, 'name' | 'role' | 'hue' | 'sigil' | 'autonomy' | 'status'>
  status: AgentLiveStatus
  /** "Reading 4 sources" · "Idle · last run 2h ago". */
  line: string
  /** The run whose tape the card shows. */
  run?: Run
  stats?: Pick<AgentStats, 'runs30d' | 'successRate' | 'costUsd30d' | 'costIsEstimate'>
  /** Capability labels that ask first. */
  asks: string[]
  /** Link target of the name (omit in previews). */
  href?: string
  actions?: ReactNode
  menu?: ReactNode
  className?: string
}

/**
 * A roster card (§6.4): AgentMark 40, name, role, status line, tape, `30d · 23 runs · 96% · est. $1.84`,
 * autonomy chip, "asks: …", and the primary action. Presentational so the create flow can preview it.
 */
export function AgentCardView({ agent, status, line, run, stats, asks, href, actions, menu, className }: AgentCardViewProps) {
  const working = status === 'working'
  const waiting = status === 'waiting'
  const statsLine = stats
    ? stats.runs30d
      ? [count(stats.runs30d, 'run'), formatRate(stats.successRate), stats.costIsEstimate ? `est. ${formatCost(stats.costUsd30d)}` : formatCost(stats.costUsd30d)].join(' · ')
      : 'No runs in 30 days'
    : 'No runs yet'
  return (
    <article
      aria-label={`${agent.name}, ${agent.role}`}
      className={cn(
        'group/card relative flex min-w-0 flex-col rounded-md border bg-canvas transition-colors duration-(--dur-1)',
        'border-line hover:border-line-strong',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3 px-4 pt-4">
        <AgentMark seed={agent.sigil} hue={agent.hue} size={40} live={working} paused={agent.status === 'paused'} className="[--sig-surface:var(--surface-canvas)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          {href ? (
            <Link
              to={href}
              className="type-title-3 truncate rounded-xs text-ink outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-(--focus-ring)"
            >
              {agent.name}
            </Link>
          ) : (
            <span className="type-title-3 truncate text-ink">{agent.name}</span>
          )}
          <span className="type-body-sm truncate text-ink-2">{agent.role}</span>
        </div>
        {menu && <div className="relative z-10 -mt-1 -mr-1.5">{menu}</div>}
      </div>

      <div className="flex min-w-0 flex-col gap-2 px-4 pt-3">
        <p className={cn('type-body-sm flex min-w-0 items-center gap-1.5', working ? 'text-live-ink' : waiting ? 'text-attn-ink' : status === 'attention' ? 'text-fail-ink' : 'text-ink-3')}>
          <AgentStatusGlyph status={status} size={10} decorative className="shrink-0" />
          <span className="truncate">{line}</span>
        </p>
        <div className="flex h-5 items-center">{run ? <StepTape run={run} size="sm" max={22} /> : <span aria-hidden className="h-px w-full bg-line" />}</div>
      </div>

      <div className="flex min-w-0 flex-col gap-2 px-4 pt-2 pb-3">
        <p className="type-meta flex min-w-0 items-center gap-1.5 text-ink-3">
          <span className="type-meta-caps">30D</span>
          <span className="truncate tabular" title={stats?.costIsEstimate ? 'Estimated at reference pricing; no money was spent.' : undefined}>
            {statsLine}
          </span>
        </p>
        <p className="type-caption flex min-w-0 items-center gap-2 text-ink-3">
          <AutonomyChip autonomy={agent.autonomy} />
          <span className="truncate" title={asks.length ? `Asks you before: ${asks.join(', ')}` : undefined}>
            {asks.length ? `asks: ${asks.join(', ')}` : 'asks: nothing'}
          </span>
        </p>
      </div>

      {actions && <div className="relative z-10 mt-auto flex items-center gap-2 border-t border-line px-3 py-2">{actions}</div>}
    </article>
  )
}

/** A connected roster card: live status, current run, 30-day stats, abilities and actions. */
export const RosterCard = memo(function RosterCard({ agent, status }: { agent: Agent; status: AgentLiveStatus }) {
  const navigate = useNavigate()
  const activity = useAgentActivity(agent.id)
  const run = useRun(activity.runId)
  const stats = useAgentStats(agent.id)
  const summary = summarizeAbilities(useAbilityRows(agent))
  const menuItems: MenuItem[] = agentMenuItems(agent, navigate)
  const href = `/agents/${encodeURIComponent(agent.id)}`
  const waiting = status === 'waiting'
  const archived = agent.status === 'archived'
  return (
    <AgentCardView
      agent={agent}
      status={status}
      line={activity.line}
      run={run}
      stats={stats}
      asks={summary.asks}
      href={href}
      menu={<Menu items={menuItems} placement="bottom-end" aria-label={`Actions for ${agent.name}`} trigger={<IconButton icon={Ellipsis} label={`More actions for ${agent.name}`} size="sm" />} />}
      actions={
        <>
          {archived ? (
            <span className="type-caption px-1 text-ink-3">Archived · takes no work</span>
          ) : waiting && activity.runId ? (
            <Button size="sm" variant="outline" className="border-attn/70 text-attn-ink hover:border-attn" onClick={() => attachRun(activity.runId as ID, 'agents')}>
              Review request
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={agent.status !== 'active'} onClick={() => openGiveWork(agent.id)} title={agent.status === 'paused' ? `${agent.name} is paused` : undefined}>
              Assign
            </Button>
          )}
          <span className="flex-1" />
          {activity.active > 1 ? (
            <span className="type-meta text-ink-3">{activity.active} in flight</span>
          ) : stats.lastRunAt ? (
            <span className="type-meta text-ink-3">last run {timeAgo(stats.lastRunAt)}</span>
          ) : null}
        </>
      }
    />
  )
})
