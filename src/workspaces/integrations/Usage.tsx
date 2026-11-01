import { memo, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, Check } from 'lucide-react'
import { attachRun } from '@/app/shell/store'
import { ScopeFilterRow } from '@/app/templates'
import { getModelInfo, OAI_PLACEHOLDER_ID, useModels, type ProviderId } from '@/core/ai'
import { useScope } from '@/core/context'
import { useDB, useRow, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import { actorName, entityRoute, useActivityFor, useIntegrationUsage, type IntegrationStepUse } from '@/core/services'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { updateSettings, useSettings } from '@/core/settings'
import type { ActivityEvent, ID, IntegrationDef } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatCompact, timeAgo } from '@/lib/format'
import { shortCode } from '@/lib/id'
import { Button, EntityChip, IconButton, LiveBadge, RunRow, SimBadge, StepStatusGlyph } from '@/ui'

const STEPS_VISIBLE = 6
const EVENTS_VISIBLE = 6

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="type-body-sm py-1 text-ink-3">{children}</p>
}

function MoreButton({ shown, total, onToggle, noun }: { shown: boolean; total: number; onToggle: () => void; noun: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="type-caption mt-1 self-start rounded-sm px-1.5 py-1 font-medium text-ink-3 hover:bg-hover hover:text-ink pointer-coarse:min-h-11"
    >
      {shown ? 'Show fewer' : `Show all ${total} ${noun}`}
    </button>
  )
}

// ------------------------------------------------------------------------------------------------ used by

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-3 py-1.5">
      <dt className="type-caption pt-0.5 text-ink-3">{label}</dt>
      <dd className="flex min-w-0 flex-wrap gap-1.5">{children}</dd>
    </div>
  )
}

/** Agents, workflows (and GitHub repositories) that use this integration, as chips that lead to their homes. */
export function UsedBy({ def, workflowsInScope }: { def: IntegrationDef; workflowsInScope?: ID | null }) {
  const usage = useIntegrationUsage(def.id)
  const repoIds = useDB(useShallow((s: Tables) => (def.id === 'github' ? Object.values(s.repos).filter((r) => r.provider === 'github').map((r) => r.id) : [])))
  const workflows = workflowsInScope ? usage.workflows.filter((w) => w.projectId === workflowsInScope) : usage.workflows
  if (!usage.agents.length && !workflows.length && !repoIds.length) {
    return <Quiet>No agents or workflows use {def.name} yet. Give an agent an ability that needs it, or add it to a workflow step.</Quiet>
  }
  return (
    <dl className="flex flex-col">
      {usage.agents.length > 0 && (
        <ChipRow label="Agents">
          {usage.agents.map((a) => (
            <EntityChip key={a.id} entity={{ kind: 'agent', id: a.id }} />
          ))}
        </ChipRow>
      )}
      {workflows.length > 0 && (
        <ChipRow label="Workflows">
          {workflows.map((w) => (
            <EntityChip key={w.id} entity={{ kind: 'workflow', id: w.id }} />
          ))}
        </ChipRow>
      )}
      {repoIds.length > 0 && (
        <ChipRow label="Repositories">
          {repoIds.map((id) => (
            <EntityChip key={id} entity={{ kind: 'repo', id }} />
          ))}
        </ChipRow>
      )}
    </dl>
  )
}

// ------------------------------------------------------------------------------------------------ recent steps

const StepUseRow = memo(function StepUseRow({ use }: { use: IntegrationStepUse }) {
  const navigate = useNavigate()
  const { step, run } = use
  const capability = step.capability ? CAPABILITIES[step.capability]?.label : undefined
  const open = () => navigate(entityRoute(run))
  return (
    <li className="group/step flex min-h-11 min-w-0 items-center gap-3 rounded-sm px-2 py-1.5 transition-colors duration-(--dur-1) hover:bg-hover">
      <StepStatusGlyph status={step.status} context="timeline" />
      <button
        type="button"
        onClick={() => attachRun(run.id, 'integrations')}
        aria-label={`${step.title}, in ${use.runTitle}. Show the run in the Inspector`}
        className="flex min-w-0 flex-1 flex-col rounded-xs text-left"
      >
        <span className="type-body-sm truncate text-ink">{step.title}</span>
        <span className="type-caption truncate text-ink-3">{use.runTitle}</span>
      </button>
      <span className="type-meta hidden shrink-0 text-ink-3 sm:inline">
        {[shortCode(run.id), capability, timeAgo(use.at)].filter(Boolean).join(' · ')}
      </span>
      <span className="type-meta shrink-0 text-ink-3 sm:hidden">{timeAgo(use.at)}</span>
      {use.simulated ? <SimBadge size="xs" /> : <LiveBadge size="xs" />}
      <IconButton icon={ArrowUpRight} label={`Open “${use.runTitle}” where it lives`} size="xs" onClick={open} />
    </li>
  )
})

/** Recent run steps that used this integration (live: steps appear and update while runs work). */
export function RecentSteps({ def, scope }: { def: IntegrationDef; scope: ID | null }) {
  const usage = useIntegrationUsage(def.id)
  const [expanded, setExpanded] = useState(false)
  const steps = scope ? usage.recentSteps.filter((s) => s.projectId === scope) : usage.recentSteps
  if (!steps.length) {
    return <Quiet>{scope ? `No runs in this project have used ${def.name} yet.` : `No runs have used ${def.name} yet.`}</Quiet>
  }
  const shown = expanded ? steps : steps.slice(0, STEPS_VISIBLE)
  return (
    <div className="flex flex-col">
      <ol aria-label={`Recent steps that used ${def.name}`} className="-mx-2 flex flex-col">
        {shown.map((u) => (
          <StepUseRow key={`${u.run.id}:${u.step.id}`} use={u} />
        ))}
      </ol>
      {steps.length > STEPS_VISIBLE && <MoreButton shown={expanded} total={steps.length} noun="steps" onToggle={() => setExpanded((e) => !e)} />}
    </div>
  )
}

/** "Filtered to Atlas Portal v2 · Show all" for this page's usage lists, with a local way back. */
export function UsageScope({ showAll, onShowAll, onFilter }: { showAll: boolean; onShowAll: () => void; onFilter: () => void }) {
  const scope = useScope()
  const name = useDB((s: Tables) => (scope ? s.projects[scope]?.name : undefined))
  if (!scope || !name) return null
  if (!showAll) return <ScopeFilterRow onShowAll={onShowAll} className="-mx-4 mb-1" />
  return (
    <div className="type-caption -mx-4 mb-1 flex h-8 items-center gap-1.5 px-4 text-ink-3">
      Showing every project
      <span aria-hidden>·</span>
      <button type="button" onClick={onFilter} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
        Filter to {name}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ models (providers)

function priceText(input: number, output: number): string {
  if (!input && !output) return 'Free'
  const f = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n}`)
  return `${f(input)} / ${f(output)} per M tok`
}

/** Why a model is unavailable, phrased for its own provider page (we're already in Integrations). */
function unavailableWord(providerId: ProviderId, reason: string | undefined): string {
  if (providerId === 'anthropic') return 'Needs your API key'
  if (providerId === 'openai-compatible') return reason?.includes('now serves') ? 'Not the configured model' : 'Needs a base URL and model'
  return reason ?? 'Unavailable'
}

/** The models a provider enables, with availability (from the live registry) and Make default. */
export function ModelsList({ providerId }: { providerId: ProviderId }) {
  const models = useModels().filter((m) => m.model.providerId === providerId && m.model.id !== OAI_PLACEHOLDER_ID)
  const defaultModelId = useSettings((s) => s.ai.defaultModelId)
  if (!models.length) {
    return <Quiet>Save the endpoint’s base URL and model name to add its model to every model picker.</Quiet>
  }
  return (
    <ul aria-label="Models" className="flex flex-col">
      {models.map(({ model, available, reason }) => {
        const isDefault = model.id === defaultModelId
        return (
          <li key={model.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-3 last:border-b-0">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="type-body-sm flex items-center gap-2 font-medium text-ink">
                <span className="truncate">{model.label}</span>
                {model.simulated && <SimBadge size="xs" />}
              </span>
              <span className="type-caption text-pretty text-ink-3">{model.description}</span>
              <span className="type-meta text-ink-3">
                {formatCompact(model.contextWindow)} context · {priceText(model.pricing.input, model.pricing.output)}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {available ? (
                <span className="type-caption inline-flex items-center gap-1 text-ink-2">
                  <Check aria-hidden className="size-3.5 text-done" strokeWidth={2} />
                  In every model picker
                </span>
              ) : (
                <span className="type-caption text-ink-3">{unavailableWord(providerId, reason)}</span>
              )}
              {isDefault ? (
                <span className="type-meta-caps inline-flex h-6 items-center rounded-xs border border-line-strong px-1.5 text-ink-2">Default</span>
              ) : (
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={!available}
                  onClick={() => updateSettings('ai', { defaultModelId: model.id })}
                  aria-label={`Make ${model.label} the default model`}
                >
                  Make default
                </Button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const RunUseRow = memo(function RunUseRow({ runId }: { runId: ID }) {
  const navigate = useNavigate()
  const run = useRow('runs', runId)
  const agent = useRow('agents', run?.agentId)
  if (!run) return null
  const attach = () => attachRun(run.id, 'integrations')
  return (
    <RunRow
      run={run}
      agent={agent ? { name: agent.name, hue: agent.hue, sigil: agent.sigil } : undefined}
      onSelect={attach}
      onAttach={attach}
      onPause={() => runEngine.pause(run.id)}
      onResume={() => runEngine.resume(run.id)}
      onStop={() => runEngine.cancel(run.id, 'Stopped by you')}
      onOpen={() => navigate(entityRoute({ kind: 'run', id: run.id }))}
    />
  )
})

function providerOfModel(modelId: string | undefined): ProviderId | undefined {
  if (!modelId) return undefined
  if (modelId.startsWith('oai:')) return 'openai-compatible'
  return getModelInfo(modelId)?.providerId
}

/** Recent runs on a provider's models (scoped), newest first — the usage of a model connection. */
export function ModelRuns({ providerId, scope, label }: { providerId: ProviderId; scope: ID | null; label: string }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const ids = useDB(
    useShallow((s: Tables) =>
      Object.values(s.runs)
        .filter((r) => providerOfModel(r.modelId) === providerId && (!scope || r.projectId === scope))
        .sort((a, b) => (b.startedAt ?? b.createdAt) - (a.startedAt ?? a.createdAt))
        .map((r) => r.id),
    ),
  )
  if (!ids.length) {
    return <Quiet>{scope ? `No runs in this project have used ${label} yet.` : `No runs have used ${label} yet.`}</Quiet>
  }
  const shown = expanded ? ids.slice(0, 40) : ids.slice(0, STEPS_VISIBLE)
  return (
    <div className="flex flex-col">
      <div role="list" aria-label={`Recent runs on ${label}`} className="-mx-2 flex flex-col">
        {shown.map((id) => (
          <div role="listitem" key={id}>
            <RunUseRow runId={id} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {ids.length > STEPS_VISIBLE && <MoreButton shown={expanded} total={Math.min(ids.length, 40)} noun="runs" onToggle={() => setExpanded((e) => !e)} />}
        <button
          type="button"
          onClick={() => navigate(providerId === 'simulator' ? '/agents' : '/agents?provider=live')}
          className="type-caption mt-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 font-medium text-ink-3 hover:bg-hover hover:text-ink"
        >
          {providerId === 'simulator' ? 'All runs' : 'All live runs'} in Agents
          <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ activity

function EventRow({ event }: { event: ActivityEvent }) {
  return (
    <li className="relative flex gap-3 pl-4">
      <span aria-hidden className={cn('absolute top-1.5 left-0 size-[7px] rounded-full border bg-canvas', event.verb === 'failed' ? 'border-fail' : 'border-line-input')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-sm text-pretty break-words text-ink-2">{event.summary}</span>
        <span className="type-meta text-ink-3">
          {actorName(event.actor)} · {timeAgo(event.at)}
        </span>
      </div>
    </li>
  )
}

/** The integration's activity: connects, permission changes, tests, failures (newest first). */
export function ActivityList({ id }: { id: string }) {
  const ref = useMemo(() => ({ kind: 'integration' as const, id }), [id])
  const events = useActivityFor(ref, 40)
  const [expanded, setExpanded] = useState(false)
  if (!events.length) return <Quiet>No activity yet. Connecting, tests and permission changes are recorded here.</Quiet>
  const shown = expanded ? events : events.slice(0, EVENTS_VISIBLE)
  return (
    <div className="flex flex-col">
      <ol aria-label="Activity" className="relative flex flex-col gap-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line">
        {shown.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </ol>
      {events.length > EVENTS_VISIBLE && <MoreButton shown={expanded} total={events.length} noun="events" onToggle={() => setExpanded((x) => !x)} />}
    </div>
  )
}
