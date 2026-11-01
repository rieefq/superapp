import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { CalendarClock, ListChecks, Pause, Play, Settings2 } from 'lucide-react'
import { Composer, ReadBackLine } from '@/app/components'
import { useRegisterCommands } from '@/app/commands/registry'
import { SessionTemplate, StageHeader, useShellLayout } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { getAgentTemplate, nextCronRun, runAgent, updateAgent, useAgent, useAgentLiveStatus, useAgentSpend } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { Agent, Autonomy } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { AgentMark, Button, EmptyState, IconButton, SegmentedControl, Switch, TickMeter, Tooltip, formatCost, toast, type MenuItem } from '@/ui'
import { abilityRows, decisionWord } from './abilities'
import { agentMenuItems, pauseWithFeedback, restoreWithFeedback, resumeWithFeedback } from './agentActions'
import { AgentsList } from './AgentsList'
import { BoardBoundary } from './boundary'
import { GiveWorkHost, openGiveWork, useAgentReadBack } from './GiveWork'
import { AUTONOMY_COPY, AUTONOMY_ORDER, formatWhen } from './logic'
import { RunDetail } from './RunDetail'
import { AgentStatusChip, useAgentMemoryIds } from './shared'
import { RowsSkeleton } from './skeleton'
import { NowTab } from './agent/NowTab'

const RunsTab = lazy(() => import('./agent/RunsTab'))
const ConfigureTab = lazy(() => import('./agent/ConfigureTab'))
const MemoryTab = lazy(() => import('./agent/MemoryTab'))
const ActivityTab = lazy(() => import('./agent/ActivityTab'))

export type AgentTab = 'now' | 'runs' | 'configure' | 'memory' | 'activity'
const TABS: readonly AgentTab[] = ['now', 'runs', 'configure', 'memory', 'activity']

/**
 * Agent detail (§6.4, Session; the list pane lists agents): header with the live status, Run now and
 * Assign task; the identity band (Active switch, autonomy with a read-back of its effect, budget,
 * schedule); tabs Now · Runs · Configure · Memory · Activity; `?run=` shows one run in place.
 */
export default function AgentView() {
  const params = useParams()
  const agentId = params.agentId ?? ''
  const segment = (params['*'] ?? '').split('/')[0] as AgentTab
  const tab: AgentTab = TABS.includes(segment) ? segment : 'now'
  const [search] = useSearchParams()
  const runParam = search.get('run')
  const agent = useAgent(agentId)

  if (!agent) {
    return (
      <SessionTemplate list={<AgentsList />} phoneView="stage" header={<StageHeader title="Agent" backTo="/agents/roster" />}>
        <EmptyState
          title="This agent no longer exists"
          description="It may have been deleted. Its runs stay in All runs."
          actions={
            <Link to="/agents/roster" className="type-body-sm text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
              Back to the roster
            </Link>
          }
          className="py-16"
        />
      </SessionTemplate>
    )
  }
  return <AgentScreen key={agent.id} agent={agent} tab={tab} runParam={runParam} />
}

function AgentScreen({ agent, tab, runParam }: { agent: Agent; tab: AgentTab; runParam: string | null }) {
  const navigate = useNavigate()
  const phone = useShellLayout().formFactor === 'phone'
  const status = useAgentLiveStatus(agent.id)
  const bodyRef = useRef<HTMLDivElement>(null)
  const base = `/agents/${encodeURIComponent(agent.id)}`
  const memoryCount = useAgentMemoryIds(agent.id).length
  const unavailable = agent.status !== 'active'
  const menu: MenuItem[] = agentMenuItems(agent, navigate, { onPage: true })
  const showComposer = tab === 'now' && !runParam && agent.status !== 'archived'

  useRegisterCommands(`agents.agent.${agent.id}`, [
    {
      id: `agents.run.${agent.id}`,
      title: `Run ${agent.name} now…`,
      subtitle: unavailable ? `${agent.name} is ${agent.status}` : 'Give it an instruction',
      icon: Play,
      group: agent.name,
      run: (ctx) => {
        ctx.close()
        if (!unavailable) openGiveWork(agent.id, 'instruction')
      },
    },
    {
      id: `agents.assign.${agent.id}`,
      title: `Assign a task to ${agent.name}…`,
      icon: ListChecks,
      group: agent.name,
      run: (ctx) => {
        ctx.close()
        if (!unavailable) openGiveWork(agent.id, 'task')
      },
    },
    agent.status === 'paused'
      ? { id: `agents.resume.${agent.id}`, title: `Resume ${agent.name}`, icon: Play, group: agent.name, run: (ctx) => (ctx.close(), resumeWithFeedback(agent)) }
      : { id: `agents.pause.${agent.id}`, title: `Pause ${agent.name}`, icon: Pause, group: agent.name, run: (ctx) => (ctx.close(), pauseWithFeedback(agent)) },
    { id: `agents.configure.${agent.id}`, title: `Configure ${agent.name}`, icon: Settings2, group: agent.name, run: (ctx) => (ctx.close(), navigate(`${base}/configure`)) },
  ])

  return (
    <SessionTemplate
      list={<AgentsList />}
      phoneView="stage"
      measure={880}
      primary={{ kind: 'agent', id: agent.id }}
      bodyRef={bodyRef}
      header={
        <StageHeader
          title={agent.name}
          leading={<AgentMark seed={agent.sigil} hue={agent.hue} size={24} live={status === 'working'} paused={agent.status === 'paused'} label={agent.name} />}
          status={agent.status === 'archived' ? <span className="type-caption rounded-full bg-hover px-2 py-0.5 text-ink-2">Archived</span> : <AgentStatusChip status={status} compact={phone} />}
          backTo="/agents/roster"
          tabs={{
            'aria-label': `${agent.name} views`,
            value: runParam ? 'runs' : tab,
            items: [
              { value: 'now', label: 'Now', to: base, end: true },
              { value: 'runs', label: 'Runs', to: `${base}/runs` },
              { value: 'configure', label: 'Configure', to: `${base}/configure` },
              { value: 'memory', label: 'Memory', to: `${base}/memory`, count: memoryCount || undefined },
              { value: 'activity', label: 'Activity', to: `${base}/activity` },
            ],
          }}
          actions={
            <>
              <Tooltip content={unavailable ? `${agent.name} is ${agent.status}. ${agent.status === 'paused' ? 'Resume' : 'Restore'} it to run it.` : `Give ${agent.name} an instruction`}>
                <span className="inline-flex">
                  {phone ? (
                    <IconButton icon={Play} label="Run now" size="sm" variant="primary" disabled={unavailable} onClick={() => openGiveWork(agent.id, 'instruction')} tooltip={false} />
                  ) : (
                    <Button size="sm" variant="primary" leadingIcon={Play} disabled={unavailable} onClick={() => openGiveWork(agent.id, 'instruction')}>
                      Run now
                    </Button>
                  )}
                </span>
              </Tooltip>
            </>
          }
          menu={menu}
        />
      }
      composer={showComposer ? <AssignComposer agent={agent} bodyRef={bodyRef} /> : undefined}
    >
      <BoardBoundary name={`${agent.name}`}>
        {runParam ? (
          <RunDetail runId={runParam} back={{ label: `${agent.name}’s runs`, to: `${base}/runs` }} />
        ) : (
          <div className="flex flex-col gap-8">
            <IdentityBand agent={agent} compact={tab === 'configure'} />
            <Suspense fallback={<RowsSkeleton rows={6} className="px-0" />}>
              {tab === 'now' && <NowTab agent={agent} />}
              {tab === 'runs' && <RunsTab agent={agent} />}
              {tab === 'configure' && <ConfigureTab agent={agent} />}
              {tab === 'memory' && <MemoryTab agent={agent} />}
              {tab === 'activity' && <ActivityTab agent={agent} />}
            </Suspense>
          </div>
        )}
      </BoardBoundary>
      <GiveWorkHost />
    </SessionTemplate>
  )
}

// ------------------------------------------------------------------------------------------------ identity band

function IdentityBand({ agent, compact }: { agent: Agent; compact?: boolean }) {
  const navigate = useNavigate()
  const status = useAgentLiveStatus(agent.id)
  const [pending, setPending] = useState<Autonomy | null>(null)
  const archived = agent.status === 'archived'
  return (
    <section aria-label={`${agent.name} at a glance`} className="flex min-w-0 flex-col gap-4">
      <div className={cn('flex min-w-0 items-start gap-4', compact && 'hidden')}>
        <AgentMark seed={agent.sigil} hue={agent.hue} size={48} live={status === 'working'} paused={agent.status === 'paused'} className="[--sig-surface:var(--surface-canvas)]" />
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
          <p className="type-body-lg font-medium text-ink">{agent.role}</p>
          {agent.description ? (
            <p className="type-body-sm line-clamp-2 text-pretty text-ink-2">{agent.description}</p>
          ) : (
            <button type="button" onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/configure`)} className="type-body-sm w-fit text-ink-3 underline decoration-line-input underline-offset-2 hover:text-ink">
              Add a description
            </button>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-3">
        {archived ? (
          <span className="type-body-sm flex items-center gap-2 text-ink-2">
            Archived · takes no work
            <Button size="xs" variant="secondary" onClick={() => restoreWithFeedback(agent)}>
              Restore
            </Button>
          </span>
        ) : (
          <Switch
            checked={agent.status === 'active'}
            onCheckedChange={(on) => (on ? resumeWithFeedback(agent) : pauseWithFeedback(agent))}
            label={agent.status === 'active' ? 'Active' : 'Paused'}
            aria-label={agent.status === 'active' ? `${agent.name} is active. Pause` : `${agent.name} is paused. Resume`}
          />
        )}
        <div className="flex items-center gap-2">
          <span aria-hidden className="type-label text-ink-3">
            Autonomy
          </span>
          <SegmentedControl
            size="sm"
            aria-label="Autonomy"
            value={pending ?? agent.autonomy}
            onValueChange={(v) => setPending(v === agent.autonomy ? null : (v as Autonomy))}
            options={AUTONOMY_ORDER.map((a) => ({ value: a, label: AUTONOMY_COPY[a].label }))}
            disabled={archived}
          />
        </div>
        <BudgetMeter agent={agent} />
        <ScheduleChip agent={agent} />
      </div>
      {pending && <AutonomyEffect agent={agent} next={pending} onDone={() => setPending(null)} />}
    </section>
  )
}

/** "Changing it shows a ReadBack of the effect" (§6.4): what each ability will do under the new autonomy. */
function AutonomyEffect({ agent, next, onDone }: { agent: Agent; next: Autonomy; onDone: () => void }) {
  const connections = useDB((s: Tables) => s.connections)
  const safety = useSettings((s) => s.safety)
  const rows = useMemo(() => {
    const before = abilityRows(agent, connections, safety)
    const after = abilityRows({ ...agent, autonomy: next }, connections, safety)
    return after.filter((r) => r.grant.mode !== 'deny').map((r, i) => ({ label: r.info.label, before: before[i]?.decision, after: r.decision }))
  }, [agent, next, connections, safety])
  const changed = rows.filter((r) => r.before?.outcome !== r.after.outcome)
  const apply = () => {
    updateAgent(agent.id, { autonomy: next })
    toast({ title: `${agent.name} is now ${AUTONOMY_COPY[next].label.toLowerCase()}`, description: AUTONOMY_COPY[next].effect })
    onDone()
  }
  return (
    <div role="region" aria-label="Effect of the new autonomy" className="flex flex-col gap-3 rounded-md border border-line-strong bg-raised px-4 py-3">
      <p className="type-body-sm text-ink">
        <span className="font-medium">
          Switch {agent.name} to {AUTONOMY_COPY[next].label.toLowerCase()}?
        </span>{' '}
        <span className="text-ink-2">{AUTONOMY_COPY[next].effect}</span>
      </p>
      {rows.length > 0 && (
        <dl aria-label="Read back" className="type-mono-sm flex flex-col gap-1 text-ink-2">
          {rows.map((r) => {
            const moved = r.before?.outcome !== r.after.outcome
            return (
              <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3">
                <dt className={cn('min-w-0 truncate', moved ? 'text-ink' : 'text-ink-3')}>{r.label}</dt>
                <dd className={cn('shrink-0', moved ? 'text-ink' : 'text-ink-3')}>
                  {moved && r.before ? (
                    <>
                      <span className="text-ink-3 line-through decoration-ink-4">{decisionWord(r.before).toLowerCase()}</span> → {decisionWord(r.after).toLowerCase()}
                    </>
                  ) : (
                    decisionWord(r.after).toLowerCase()
                  )}
                  {r.after.outcome === 'ask' && <span className="text-attn-ink"> ◆</span>}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
      <p className="type-caption text-ink-3">
        {changed.length ? `${changed.length} of ${rows.length} abilities change.` : 'Nothing changes for the abilities it has.'} Settings › Permissions still asks before{' '}
        {safety.alwaysAsk.length ? 'its always-ask actions' : 'nothing extra'}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={apply}>
          Switch to {AUTONOMY_COPY[next].label}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Keep {AUTONOMY_COPY[agent.autonomy].label.toLowerCase()}
        </Button>
      </div>
    </div>
  )
}

function BudgetMeter({ agent }: { agent: Agent }) {
  const navigate = useNavigate()
  const spend = useAgentSpend(agent.id)
  const budget = agent.monthlyBudgetUsd
  const configure = () => navigate(`/agents/${encodeURIComponent(agent.id)}/configure#budget`)
  if (!budget) {
    return (
      <button type="button" onClick={configure} className="type-caption flex items-center gap-2 rounded-sm text-ink-3 hover:text-ink">
        <span className="type-label">Budget</span> none · Set one
      </button>
    )
  }
  return (
    <button type="button" onClick={configure} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm text-left" aria-label={`Monthly budget: ${formatCost(spend.countedUsd)} of ${formatCost(budget)} counted this month. Configure`}>
      <span className="type-label text-ink-3">Budget</span>
      <TickMeter value={spend.countedUsd} max={budget} width={88} label="Monthly budget" valueText={`${formatCost(spend.countedUsd)} of ${formatCost(budget)}`} />
      <span className="type-meta whitespace-nowrap text-ink-2 tabular">
        {formatCost(spend.countedUsd)} of {formatCost(budget)}
      </span>
      {spend.estimatedUsd > 0 && !spend.countsEstimates && (
        <Tooltip content="Simulated runs are estimated at reference pricing; no money was spent, so they don’t count toward the budget.">
          <span className="type-meta whitespace-nowrap text-ink-3 tabular">· est. {formatCost(spend.estimatedUsd)} sim</span>
        </Tooltip>
      )}
    </button>
  )
}

function ScheduleChip({ agent }: { agent: Agent }) {
  const navigate = useNavigate()
  const schedule = agent.schedule
  const next = schedule?.enabled && agent.status === 'active' ? nextCronRun(schedule.cron, Date.now()) : undefined
  return (
    <Tooltip content={schedule ? 'Runs only while Atrium is open' : 'Add a schedule in Configure'}>
      <button
        type="button"
        onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}/configure#schedule`)}
        className="type-caption inline-flex h-6 items-center gap-1.5 rounded-sm border border-line-strong px-2 text-ink-2 transition-colors duration-(--dur-1) hover:border-line-input hover:text-ink"
      >
        <CalendarClock aria-hidden className="size-3.5 text-ink-3" strokeWidth={1.75} />
        {schedule ? (
          <>
            {schedule.label}
            <span className="text-ink-3">· {schedule.enabled ? (next ? `next ${formatWhen(next, Date.now())}` : agent.status === 'active' ? 'on' : 'held while paused') : 'off'}</span>
          </>
        ) : (
          'No schedule'
        )}
      </button>
    </Tooltip>
  )
}

// ------------------------------------------------------------------------------------------------ assign composer

/** The Now tab's composer: "What should Scout do?" with a ReadBack line (§6.4). */
function AssignComposer({ agent, bodyRef }: { agent: Agent; bodyRef: React.RefObject<HTMLDivElement | null> }) {
  const scope = useScope()
  const navigate = useNavigate()
  const { state } = useLocation() as { state: { draft?: string } | null }
  const readBack = useAgentReadBack(agent, scope)
  const paused = agent.status === 'paused'
  const example = getAgentTemplate(agent.template)?.exampleInstruction
  const [draft, setDraft] = useState(state?.draft ?? '')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { formFactor } = useShellLayout()
  // A newly created agent arrives with its first instruction ready (and focused).
  useEffect(() => {
    if (state?.draft) requestAnimationFrame(() => inputRef.current?.focus())
  }, [state?.draft])
  return (
    <Composer
      textareaRef={inputRef}
      value={draft}
      onValueChange={setDraft}
      placeholder={`What should ${agent.name} do?${example && formFactor !== 'phone' ? ` e.g. ${example}` : ''}`}
      backgroundable
      submitLabel="Run"
      showModel={false}
      disabled={paused}
      reason={
        paused ? (
          <span className="flex items-center gap-2">
            {agent.name} is paused and takes no new work.
            <Button size="xs" variant="secondary" onClick={() => resumeWithFeedback(agent)}>
              Resume
            </Button>
          </span>
        ) : undefined
      }
      readBack={<ReadBackLine data={readBack} />}
      contextOptions={{ label: `Agents · ${agent.name}` }}
      aria-label={`Instruction for ${agent.name}`}
      onSubmit={(text, meta) => {
        const run = runAgent(agent.id, { instruction: text, projectId: meta.context.projectId, context: meta.context.all })
        setDraft('')
        if (meta.background) {
          toast({ title: `Started in background · ${shortCode(run.id)}`, description: `${agent.name} · ${run.title}`, action: { label: 'Open', onClick: () => navigate(`/agents/${encodeURIComponent(agent.id)}?run=${encodeURIComponent(run.id)}`) } })
        } else {
          // Attached: the work is right here, in Now. Bring it into view.
          bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }}
    />
  )
}

