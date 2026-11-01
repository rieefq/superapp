import { useId, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { ChevronLeft, ChevronRight, CornerUpLeft, ListChecks, PanelRight, Pause, Play, RotateCw, Square } from 'lucide-react'
import { HoldButton, SaveToKnowledgeButton, TurnIntoMenu } from '@/app/components'
import { attachRun, openStartSheet } from '@/app/shell/store'
import { markRunOpened } from '@/app/shell/runTracker'
import { getModel } from '@/core/ai/models'
import { normalizeFailureReason, runFailureMessage } from '@/core/analytics'
import { useRow } from '@/core/db'
import { runEngine, useRun } from '@/core/runs'
import { RUN_KIND_LABEL, entityRoute } from '@/core/services'
import type { ID, Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format'
import {
  AgentMark,
  Button,
  EmptyState,
  EntityChip,
  IdCode,
  MonogramMark,
  ProvenanceLine,
  RUN_KIND_ICON,
  Receipt,
  RunMeta,
  RunStatusBadge,
  RunStatusGlyph,
  RunTimeline,
  StepTape,
  toast,
} from '@/ui'
import { SectionLabel } from './shared'

/**
 * Run detail (§6.4, §5.4.4): who ran it and where it came from, the live Step Tape and RunTimeline
 * (expandable input/output, references, file changes, approvals inline), controls, the result with
 * its outputs and handoffs ("Send result to…"), the Colophon and the Receipt. Used by the run page
 * (`/agents/runs/:runId`) and the agent page (`?run=`).
 */
export function RunDetail({ runId, showTitle = true, back }: { runId: ID; showTitle?: boolean; back?: { label: string; to: string } }) {
  const run = useRun(runId)
  const scopeRef = useRef<HTMLElement>(null)
  if (!run) {
    return (
      <EmptyState
        title="This run no longer exists"
        description="It may have been deleted with the item that started it."
        actions={
          <Link to={back?.to ?? '/agents'} className="type-body-sm text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
            {back?.label ?? 'All runs'}
          </Link>
        }
        className="py-12"
      />
    )
  }
  const finished = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled'
  return (
    <article ref={scopeRef} aria-label={`Run: ${run.title}`} className="flex min-w-0 flex-col gap-6" data-run-detail={run.id}>
      {back && (
        <Link
          to={back.to}
          className="type-caption -mb-3 inline-flex w-fit items-center gap-1 rounded-xs text-ink-3 transition-colors duration-(--dur-1) hover:text-ink"
        >
          <ChevronLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
          {back.label}
        </Link>
      )}
      <RunHeader run={run} showTitle={showTitle} />
      {run.status === 'failed' && <FailureNote run={run} />}
      {finished && run.status !== 'failed' && <ResultBlock run={run} scopeRef={scopeRef} />}
      {run.status === 'failed' && <Handoffs run={run} scopeRef={scopeRef} />}
      <section aria-labelledby={`steps-${run.id}`} className="flex flex-col">
        <SectionLabel id={`steps-${run.id}`} title="Steps" count={run.steps.length} />
        <RunTimeline run={run} defaultExpanded={finished ? 'none' : 'active'} className="[--sig-surface:var(--surface-canvas)]" />
      </section>
      {finished && <ProvenanceLine run={run} className="border-t border-line pt-3" />}
      <ReceiptDisclosure run={run} />
    </article>
  )
}

// ------------------------------------------------------------------------------------------------ header

function Owner({ run }: { run: Run }) {
  const agent = useRow('agents', run.agentId)
  const workflow = useRow('workflows', run.workflowId)
  if (agent) {
    return (
      <Link to={`/agents/${encodeURIComponent(agent.id)}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-xs text-ink-2 hover:text-ink">
        <AgentMark seed={agent.sigil} hue={agent.hue} size={16} live={run.status === 'running'} />
        <span className="truncate">{agent.name}</span>
      </Link>
    )
  }
  if (workflow) return <EntityChip entity={{ kind: 'workflow', id: workflow.id }} size="sm" />
  return <span className="text-ink-2">{run.initiator.type === 'user' ? 'You' : 'Atrium'}</span>
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-4">
      ·
    </span>
  )
}

function RunHeader({ run, showTitle }: { run: Run; showTitle: boolean }) {
  const navigate = useNavigate()
  const project = useRow('projects', run.projectId)
  const KindIcon = RUN_KIND_ICON[run.kind]
  const trigger = typeof run.script?.params.trigger === 'string' ? run.script.params.trigger : undefined
  const configured = typeof run.script?.params.configuredModelId === 'string' ? getModel(run.script.params.configuredModelId) : undefined
  const active = run.status === 'queued' || run.status === 'running' || run.status === 'waiting' || run.status === 'paused'
  const originRoute = run.origin ? entityRoute(run.origin) : undefined

  const retry = () => {
    const next = runEngine.retry(run.id)
    if (next) {
      toast({ title: `Retrying “${run.title}”`, description: 'The new run starts from the first step.', action: { label: 'Open', onClick: () => navigate(entityRoute({ kind: 'run', id: next.id })) } })
      navigate(entityRoute({ kind: 'run', id: next.id }))
    } else toast.error('This run can’t be retried', { description: 'Only scripted runs that failed or were stopped can run again.' })
  }

  return (
    <header className="flex min-w-0 flex-col gap-3">
      {showTitle && (
        <div className="flex min-w-0 items-start gap-2.5">
          <RunStatusGlyph status={run.status} size={14} className="mt-[7px]" />
          <h2 className="type-title-2 min-w-0 flex-1 text-pretty text-ink">{run.title}</h2>
        </div>
      )}
      <div className="type-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-ink-3">
        <RunStatusBadge status={run.status} />
        <IdCode id={run.id} />
        <Dot />
        <span className="inline-flex items-center gap-1.5">
          <KindIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
          {RUN_KIND_LABEL[run.kind]}
        </span>
        <Dot />
        <Owner run={run} />
        {project && (
          <>
            <Dot />
            <Link to={`/projects/${encodeURIComponent(project.id)}`} className="inline-flex items-center gap-1.5 rounded-xs text-ink-2 hover:text-ink">
              <MonogramMark text={project.name} hue={project.hue} size={14} />
              {project.name}
            </Link>
          </>
        )}
        <Dot />
        <span>{formatDateTime(run.startedAt ?? run.createdAt)}</span>
      </div>
      {(run.origin || trigger) && (
        <div className="type-caption flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
          <span>Started from</span>
          {run.origin ? <EntityChip entity={run.origin} size="sm" showKind /> : null}
          {trigger && <span className="text-ink-2">{trigger}</span>}
        </div>
      )}
      <RunMeta run={run} showModel />
      {configured && !configured.simulated && (
        <p className="type-caption -mt-1.5 text-ink-3">
          Set to {configured.label}. Agent runs are simulated in this build, so this one ran on the simulator and no model was called.
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {(run.status === 'running' || run.status === 'queued') && (
          <Button size="sm" variant="secondary" leadingIcon={Pause} onClick={() => runEngine.pause(run.id)} disabled={!run.script}>
            Pause
          </Button>
        )}
        {run.status === 'paused' && (
          <Button size="sm" variant="secondary" leadingIcon={Play} onClick={() => runEngine.resume(run.id)}>
            Resume
          </Button>
        )}
        {active && (
          <Button size="sm" variant="danger" leadingIcon={Square} kbd="mod+." onClick={() => runEngine.cancel(run.id, 'Stopped by you')}>
            Stop
          </Button>
        )}
        {(run.status === 'failed' || run.status === 'cancelled') && (
          <Button size="sm" variant="secondary" leadingIcon={RotateCw} onClick={retry} disabled={!run.script}>
            Retry
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={PanelRight}
          onClick={() => {
            markRunOpened(run.id)
            attachRun(run.id, 'agents')
          }}
        >
          Attach
        </Button>
        {originRoute && originRoute !== '/' && (
          <Button size="sm" variant="ghost" leadingIcon={CornerUpLeft} onClick={() => navigate(originRoute)}>
            Open origin
          </Button>
        )}
      </div>
      <StepTape run={run} size="md" className="mt-1" />
      {run.status === 'waiting' && (
        <p role="status" className="type-body-sm flex items-center gap-2 text-attn-ink">
          <RunStatusGlyph status="waiting" decorative />
          Waiting for your approval. The request is in the steps below.
        </p>
      )}
    </header>
  )
}

// ------------------------------------------------------------------------------------------------ failure

function failureFix(run: Run): { text: string; to?: string; action?: string } {
  const message = runFailureMessage(run).toLowerCase()
  const integration = /^(.+?) is not connected/i.exec(runFailureMessage(run))?.[1]
  if (integration) return { text: `Connect ${integration} in Integrations, then retry.`, to: '/integrations', action: 'Open Integrations' }
  if (message.includes('paused')) return { text: 'Resume the agent, then retry.' }
  if (message.includes('budget')) return { text: 'Raise the agent’s monthly budget in Configure, then retry.' }
  if (message.includes('no longer exists')) return { text: 'The agent was deleted; start the work with another agent.' }
  return { text: 'Retry starts the run again from the first step.' }
}

function FailureNote({ run }: { run: Run }) {
  const navigate = useNavigate()
  const reason = normalizeFailureReason(runFailureMessage(run))
  const fix = failureFix(run)
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-md border border-fail/40 bg-fail-tint/50 px-4 py-3">
      <p className="type-body-sm flex items-start gap-2 text-fail-ink">
        <RunStatusGlyph status="failed" decorative className="mt-[3px]" />
        <span>
          <span className="font-medium">Failed: {reason}.</span> <span className="text-ink-2">{fix.text}</span>
        </span>
      </p>
      {fix.to && (
        <Button size="xs" variant="ghost" className="self-start" onClick={() => navigate(fix.to!)}>
          {fix.action}
        </Button>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ result

function ResultBlock({ run, scopeRef }: { run: Run; scopeRef: React.RefObject<HTMLElement | null> }) {
  const stopped = run.status === 'cancelled'
  const summary = run.summary ?? (stopped ? 'Stopped before it finished.' : 'Finished.')
  return (
    <section aria-labelledby={`result-${run.id}`} className="relative flex flex-col gap-3 overflow-hidden rounded-md border border-line py-3.5 pr-4 pl-5">
      {run.simulated && <span aria-hidden className="sim-band absolute inset-y-0 left-0" />}
      <h3 id={`result-${run.id}`} className="type-label text-ink-3">
        {stopped ? 'Stopped' : 'Result'}
      </h3>
      <p className="type-body text-pretty text-ink">{summary}</p>
      {run.outputs.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="type-caption mr-1 text-ink-3">Made</span>
          {run.outputs.map((ref) => (
            <EntityChip key={`${ref.kind}:${ref.id}`} entity={ref} />
          ))}
        </div>
      )}
      <Handoffs run={run} scopeRef={scopeRef} inline />
    </section>
  )
}

/** "Send result to…": a task, Knowledge, or anything else through Turn into (§7.1); Hold. */
function Handoffs({ run, scopeRef, inline }: { run: Run; scopeRef: React.RefObject<HTMLElement | null>; inline?: boolean }) {
  const source = { kind: 'run' as const, id: run.id }
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5', !inline && 'rounded-md border border-line px-3 py-2')}>
      <span className="type-caption mr-1 text-ink-3">Send result to</span>
      <Button
        size="sm"
        variant="secondary"
        leadingIcon={ListChecks}
        onClick={() => openStartSheet('task', { source, prefill: { title: `Follow up: ${run.title}`, brief: run.summary ?? run.error ?? '' } })}
      >
        Task…
      </Button>
      <SaveToKnowledgeButton entity={source} variant="secondary" hotkeyScope={scopeRef} />
      <TurnIntoMenu entity={source} hotkeyScope={scopeRef} />
      <span className="flex-1" />
      <HoldButton entity={source} hotkeyScope={scopeRef} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ receipt

function ReceiptDisclosure({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <section className="flex flex-col border-t border-line pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="type-label -mx-1 flex w-fit items-center gap-1.5 rounded-sm px-1 py-1 text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
      >
        <ChevronRight aria-hidden className={cn('size-3.5 transition-transform duration-(--dur-1)', open && 'rotate-90')} strokeWidth={2} />
        Receipt
      </button>
      {open && (
        <div id={id} className="pt-2">
          <Receipt run={run} />
        </div>
      )}
    </section>
  )
}

/** A compact live "now" block for the agent page: header line, tape and the live timeline. */
export function LiveRun({ runId, actions }: { runId: ID; actions?: ReactNode }) {
  const run = useRun(runId)
  if (!run) return null
  return (
    <article aria-label={`Run: ${run.title}`} className="flex min-w-0 flex-col gap-3 rounded-md border border-line px-4 py-3.5">
      <header className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <RunStatusGlyph status={run.status} className="mt-[5px]" />
          <Link
            to={`${entityRoute({ kind: 'run', id: run.id })}`}
            className="type-body min-w-0 flex-1 truncate rounded-xs font-semibold text-ink hover:underline hover:decoration-line-input hover:underline-offset-2"
          >
            {run.title}
          </Link>
          {actions}
        </div>
        <RunMeta run={run} />
        <StepTape run={run} size="md" />
      </header>
      <RunTimeline run={run} defaultExpanded="active" className="[--sig-surface:var(--surface-canvas)]" />
    </article>
  )
}
