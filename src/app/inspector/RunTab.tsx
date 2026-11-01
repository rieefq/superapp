import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpRight, Pause, Play, RotateCcw, Square, Undo2 } from 'lucide-react'
import { useRow } from '@/core/db'
import { useRun, useRuns, runEngine } from '@/core/runs'
import { approve, entityRoute, reject, RUN_KIND_LABEL, useApprovalsForRun } from '@/core/services'
import type { Approval, EntityRef, ID, Run } from '@/core/types'
import {
  AgentMark,
  Button,
  EmptyState,
  EntityChip,
  IdCode,
  LiveBadge,
  MonogramMark,
  Receipt,
  RunTimeline,
  SimBadge,
  formatClock,
  formatCost,
  formatTok,
  toast,
  useRunElapsed,
} from '@/ui'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/cn'
import { attachRun, useShellStore } from '../shell/store'
import { useShellLayout } from '../shell/context'
import { RunGlyph, Tape, runStatusWord } from '../shell/sig'
import { markRunOpened } from '../shell/runTracker'

/** Inspector › Run (§3.5): the attached run, or "No run attached" plus the five most recent runs. */
export function RunTab() {
  const attachedId = useShellStore((s) => s.attachedRunId)
  const run = useRun(attachedId)
  if (!run) return <NoRunAttached />
  return <AttachedRun key={run.id} run={run} />
}

function NoRunAttached() {
  const recent = useRuns({ limit: 5 })
  const { workspace } = useShellLayout()
  return (
    <div className="flex flex-col">
      <EmptyState compact title="No run attached" description="Click a run pill, a run row or View run to attach it here." className="px-4 pt-5 pb-3" />
      {recent.length > 0 && (
        <section aria-label="Recent runs" className="px-2 pb-3">
          <h3 className="type-label px-2 pb-1.5 text-ink-3">Recent runs</h3>
          <ul className="flex flex-col">
            {recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => attachRun(r.id, workspace.id)}
                  className="flex h-9 w-full items-center gap-2.5 rounded-sm px-2 text-left transition-colors duration-(--dur-1) hover:bg-hover"
                >
                  <RunGlyph status={r.status} />
                  <span className="type-body-sm min-w-0 flex-1 truncate text-ink">{r.title}</span>
                  {r.simulated && <SimBadge size="xs" noTooltip />}
                  <span className="type-meta shrink-0 text-ink-3">{timeAgo(r.endedAt ?? r.startedAt ?? r.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Owner({ run }: { run: Run }) {
  const agent = useRow('agents', run.agentId)
  const workflow = useRow('workflows', run.workflowId)
  if (agent) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <AgentMark seed={agent.sigil} hue={agent.hue} size={16} />
        <span className="truncate">{agent.name}</span>
      </span>
    )
  }
  if (workflow) return <span className="truncate">{workflow.name}</span>
  return <span>{run.initiator.type === 'user' ? 'You' : 'Atrium'}</span>
}

const ACTIVE = new Set(['queued', 'running', 'waiting', 'paused'])

function AttachedRun({ run }: { run: Run }) {
  const navigate = useNavigate()
  const active = ACTIVE.has(run.status)
  const elapsed = useRunElapsed(run)
  const project = useRow('projects', run.projectId)
  const approvalsList = useApprovalsForRun(run.id)
  const approvals = useMemo(() => Object.fromEntries(approvalsList.map((a) => [a.id, a])) as Record<ID, Approval>, [approvalsList])
  const [selectedStep, setSelectedStep] = useState<string | undefined>(undefined)
  const done = run.steps.filter((s) => s.status === 'done').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const tokens = run.usage.inputTokens + run.usage.outputTokens
  const originRoute = run.origin ? entityRoute(run.origin) : undefined

  const retry = () => {
    const next = runEngine.retry(run.id)
    if (next) {
      attachRun(next.id)
      toast.success('Retrying', { description: next.title })
    } else toast.error('This run can’t be retried', { description: 'Only scripted runs that failed or were stopped can run again.' })
  }

  // Scrubbing the tape brings the step into view in the timeline below.
  const selectStep = (stepId: string) => {
    setSelectedStep(stepId)
    const el = document.querySelector(`[data-step-id="${CSS.escape(stepId)}"]`) ?? document.getElementById(`step-${stepId}`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <div className="flex flex-col">
      {/* Header: glyph, title, handle, kind, project mark, owner */}
      <header className="flex flex-col gap-2 border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-2.5">
          <RunGlyph status={run.status} className="mt-[7px]" />
          <h2 className="type-title-3 min-w-0 flex-1 text-pretty">{run.title}</h2>
        </div>
        <div className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-ink-3">
          <IdCode id={run.id} />
          <span aria-hidden>·</span>
          <span>{RUN_KIND_LABEL[run.kind]}</span>
          {project && (
            <>
              <span aria-hidden>·</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <MonogramMark text={project.name} hue={project.hue} size={12} />
                <span className="truncate">{project.name}</span>
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <Owner run={run} />
        </div>
        {/* Meta row: status · elapsed · steps n/m · tokens · cost (est.) · LIVE/SIM */}
        <div className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-ink-2">
          <span className={cn(run.status === 'failed' && 'text-fail-ink', run.status === 'waiting' && 'text-attn-ink', run.status === 'running' && 'text-live-ink')}>
            {runStatusWord(run.status)}
          </span>
          <Dot />
          <span className="tabular-nums">{formatClock(elapsed)}</span>
          {total > 0 && (
            <>
              <Dot />
              <span>
                steps {done}/{total}
              </span>
            </>
          )}
          <Dot />
          <span>{formatTok(tokens, { est: run.simulated })}</span>
          <Dot />
          <span title={run.simulated ? 'Estimated at reference pricing; no money was spent.' : undefined}>{formatCost(run.usage.costUsd, { est: run.simulated })}</span>
          {run.simulated ? <SimBadge size="xs" /> : <LiveBadge size="xs" />}
        </div>
      </header>

      {/* Step Tape scrubber: ←/→ move through the steps */}
      {run.steps.length > 0 && (
        <div className="flex items-center gap-3 px-4 pt-3">
          <Tape run={run} size="scrubber" maxCells={28} interactive selectedStepId={selectedStep} onSelectStep={(id) => selectStep(id)} />
        </div>
      )}

      {run.error && run.status === 'failed' && (
        <p role="alert" className="type-body-sm mx-4 mt-3 rounded-sm border border-fail/30 bg-fail-tint/40 px-3 py-2 text-fail-ink">
          {run.error}
        </p>
      )}

      {/* Actions: Pause/Resume, Stop, Retry, Open in workspace, Open origin */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
        {run.status === 'paused' ? (
          <Button size="sm" variant="secondary" leadingIcon={Play} onClick={() => runEngine.resume(run.id)} disabled={!run.script}>
            Resume
          </Button>
        ) : (
          (run.status === 'running' || run.status === 'queued') && (
            <Button size="sm" variant="secondary" leadingIcon={Pause} onClick={() => runEngine.pause(run.id)} disabled={!run.script} title={run.script ? undefined : 'Only scripted runs can pause'}>
              Pause
            </Button>
          )
        )}
        {active && (
          <Button size="sm" variant="danger" leadingIcon={Square} kbd="mod+." onClick={() => runEngine.cancel(run.id, 'Stopped by you')}>
            Stop
          </Button>
        )}
        {(run.status === 'failed' || run.status === 'cancelled') && (
          <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={retry}>
            Retry
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={ArrowUpRight}
          onClick={() => {
            markRunOpened(run.id)
            navigate(entityRoute({ kind: 'run', id: run.id }))
          }}
        >
          Open in workspace
        </Button>
        {originRoute && originRoute !== '/' && (
          <Button size="sm" variant="ghost" leadingIcon={Undo2} onClick={() => navigate(originRoute)}>
            Open origin
          </Button>
        )}
      </div>

      {/* Compact timeline */}
      <section aria-label="Timeline" className="border-t border-line px-3 py-3">
        <RunTimeline
          run={run}
          compact
          defaultExpanded="active"
          approvals={approvals}
          onApprove={(id, note) => approve(id, note)}
          onReject={(id, note) => reject(id, note)}
          renderRef={(ref: EntityRef) => <EntityChip entity={ref} size="sm" />}
        />
      </section>

      {/* Outputs */}
      {run.outputs.length > 0 && (
        <section aria-label="Outputs" className="border-t border-line px-4 py-3">
          <h3 className="type-label pb-2 text-ink-3">Outputs</h3>
          <div className="flex flex-wrap gap-1.5">
            {run.outputs.map((ref) => (
              <EntityChip key={`${ref.kind}:${ref.id}`} entity={ref} size="md" />
            ))}
          </div>
        </section>
      )}

      {/* Receipt (expanded Colophon) */}
      <section aria-label="Receipt" className="border-t border-line px-4 py-3">
        <Receipt run={run} approvals={approvalsList} />
      </section>
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden className="text-ink-4">
      ·
    </span>
  )
}
