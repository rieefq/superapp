import { useLocation, useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, PanelRight, Play } from 'lucide-react'
import type { LensModule, LensProps } from '@/app/lens/types'
import { workspaceForPath } from '@/app/registry'
import { attachRun } from '@/app/shell/store'
import { markRunOpened } from '@/app/shell/runTracker'
import { getModel } from '@/core/ai/models'
import { useDB, useRow, type Tables } from '@/core/db'
import { CAPABILITIES } from '@/core/permissions'
import { useRun } from '@/core/runs'
import { agentExecutorModel, entityRoute, useAgentLiveStatus, useAgentStats, useApprovalsForRun } from '@/core/services'
import type { ID, Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo, truncate } from '@/lib/format'
import { ApprovalCardConnected, Button, EntityChip, RISK_LABEL, RunMeta, StepTape, formatCost, runCurrentLine } from '@/ui'
import { summarizeAbilities, useAbilityRows } from './abilities'
import { GiveWorkHost, openGiveWork } from './GiveWork'
import { AUTONOMY_COPY, count, formatRate } from './logic'
import { AgentStatusChip, AgentStatusGlyph, useAgentActivity } from './shared'

/**
 * Lens renderers for the kinds Agents owns (§5.4.8): agent, run and approval. `panel` is the body of
 * Inspector › Item (the shell adds the header, Links and History); `card` is the hover card and the
 * ⌘K preview.
 */

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] items-baseline gap-x-3">
      <dt className="type-label text-ink-3">{label}</dt>
      <dd className="type-body-sm min-w-0 text-ink-2">{children}</dd>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ agent

function AgentPanel({ entity }: LensProps) {
  const navigate = useNavigate()
  const agent = useRow('agents', entity.id)
  const status = useAgentLiveStatus(entity.id)
  const activity = useAgentActivity(entity.id)
  const run = useRun(activity.runId)
  const stats = useAgentStats(entity.id)
  const abilities = summarizeAbilities(useAbilityRows(agent))
  if (!agent) return null
  const executor = getModel(agentExecutorModel(agent))
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AgentStatusChip status={status} />
          <span className="type-caption min-w-0 truncate text-ink-3">{activity.line}</span>
        </div>
        {run && <StepTape run={run} size="sm" max={26} />}
      </div>
      <p className="type-body-sm text-pretty text-ink-2">{agent.description || agent.role}</p>
      <dl className="flex flex-col gap-1.5">
        <Fact label="Role">{agent.role}</Fact>
        <Fact label="Autonomy">{AUTONOMY_COPY[agent.autonomy].label}</Fact>
        <Fact label="Model">
          {executor?.label ?? 'Simulator'} <span className="text-ink-3">· simulated, no model is called</span>
        </Fact>
        <Fact label="Can">{abilities.allowed.length ? abilities.allowed.join(', ') : 'Nothing on its own'}</Fact>
        {abilities.asks.length > 0 && <Fact label="Asks first">{abilities.asks.join(', ')}</Fact>}
        {abilities.blocked.length > 0 && <Fact label="Blocked">{abilities.blocked.join(', ')}</Fact>}
        <Fact label="Schedule">{agent.schedule ? `${agent.schedule.label}${agent.schedule.enabled ? '' : ' · off'}` : 'None'}</Fact>
        <Fact label="30 days">
          <span className="type-meta tabular">
            {count(stats.runs30d, 'run')} · {formatRate(stats.successRate)} · {stats.costIsEstimate ? 'est. ' : ''}
            {formatCost(stats.costUsd30d)}
          </span>
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="secondary" leadingIcon={Play} disabled={agent.status !== 'active'} onClick={() => openGiveWork(agent.id)}>
          Run now
        </Button>
        <Button size="sm" variant="ghost" leadingIcon={ArrowUpRight} onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}>
          Open agent
        </Button>
      </div>
      <GiveWorkHost />
    </div>
  )
}

function AgentCard({ entity }: LensProps) {
  const agent = useRow('agents', entity.id)
  const status = useAgentLiveStatus(entity.id)
  const activity = useAgentActivity(entity.id)
  const run = useRun(activity.runId)
  const stats = useAgentStats(entity.id)
  if (!agent) return null
  return (
    <div className="flex flex-col gap-1.5">
      <p className={cn('type-caption flex min-w-0 items-center gap-1.5', status === 'working' ? 'text-live-ink' : status === 'waiting' ? 'text-attn-ink' : 'text-ink-2')}>
        <AgentStatusGlyph status={status} size={10} decorative />
        <span className="truncate">{activity.line}</span>
      </p>
      {run && <StepTape run={run} size="sm" max={20} />}
      <p className="type-meta text-ink-3 tabular">
        30d · {count(stats.runs30d, 'run')} · {formatRate(stats.successRate)} · {AUTONOMY_COPY[agent.autonomy].label}
      </p>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ run

function RunLine({ run }: { run: Run }) {
  const line = runCurrentLine(run)
  return <p className={cn('type-body-sm text-pretty', run.status === 'failed' ? 'text-fail-ink' : run.status === 'running' ? 'text-live-ink' : 'text-ink-2')}>{truncate(line, 220)}</p>
}

function RunPanel({ entity }: LensProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const run = useRun(entity.id)
  const pending = useApprovalsForRun(entity.id).filter((a) => a.status === 'pending')
  const owner = useDB(useShallow((s: Tables) => (run?.agentId && s.agents[run.agentId] ? { id: run.agentId } : null)))
  if (!run) return null
  return (
    <div className="flex flex-col gap-3.5 px-4 py-3.5">
      <RunMeta run={run} showModel />
      <StepTape run={run} size="md" />
      <RunLine run={run} />
      {pending.map((a) => (
        <ApprovalCardConnected key={a.id} approvalId={a.id} variant="compact" showRun={false} />
      ))}
      <dl className="flex flex-col gap-1.5">
        {owner && (
          <Fact label="Owner">
            <EntityChip entity={{ kind: 'agent', id: owner.id }} size="sm" />
          </Fact>
        )}
        {run.origin && (
          <Fact label="Came from">
            <EntityChip entity={run.origin} size="sm" />
          </Fact>
        )}
        {run.outputs.length > 0 && (
          <Fact label="Made">
            <span className="flex flex-wrap gap-1">
              {run.outputs.map((o) => (
                <EntityChip key={`${o.kind}:${o.id}`} entity={o} size="sm" />
              ))}
            </span>
          </Fact>
        )}
        <Fact label="Started">{timeAgo(run.startedAt ?? run.createdAt)}</Fact>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={PanelRight}
          onClick={() => {
            markRunOpened(run.id)
            attachRun(run.id, workspaceForPath(pathname).id)
          }}
        >
          Show steps
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={ArrowUpRight}
          onClick={() => {
            markRunOpened(run.id)
            navigate(entityRoute({ kind: 'run', id: run.id }))
          }}
        >
          Open run
        </Button>
      </div>
    </div>
  )
}

function RunCard({ entity }: LensProps) {
  const run = useRun(entity.id)
  if (!run) return null
  return (
    <div className="flex flex-col gap-1.5">
      <StepTape run={run} size="sm" max={22} />
      <p className={cn('type-caption line-clamp-2', run.status === 'failed' ? 'text-fail-ink' : 'text-ink-2')}>{runCurrentLine(run)}</p>
      <RunMeta run={run} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ approval

function ApprovalPanel({ entity }: LensProps) {
  const runId = useDB((s: Tables) => s.approvals[entity.id]?.runId as ID | undefined)
  return (
    <div className="flex flex-col gap-3 px-4 py-3.5">
      <ApprovalCardConnected approvalId={entity.id} variant="full" />
      {runId && (
        <p className="type-caption flex items-center gap-1.5 text-ink-3">
          Asked by the run <EntityChip entity={{ kind: 'run', id: runId }} size="sm" />
        </p>
      )}
    </div>
  )
}

function ApprovalCard({ entity }: LensProps) {
  const approval = useRow('approvals', entity.id)
  if (!approval) return null
  const preview = approval.preview?.content ? truncate(approval.preview.content.replace(/\s+/g, ' '), 160) : approval.description
  return (
    <div className="flex flex-col gap-1.5">
      <p className="type-meta-caps flex items-center gap-2 text-ink-3">
        <span className={approval.risk === 'high' ? 'text-fail-ink' : undefined}>{RISK_LABEL[approval.risk]}</span>
        <span>{CAPABILITIES[approval.capability]?.label ?? approval.capability}</span>
      </p>
      {preview && <p className="type-caption line-clamp-3 text-ink-2">{preview}</p>}
      {approval.reason && <p className="type-caption text-ink-3">Why asked: {approval.reason}</p>}
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  agent: { panel: AgentPanel, card: AgentCard },
  run: { panel: RunPanel, card: RunCard },
  approval: { panel: ApprovalPanel, card: ApprovalCard },
}
