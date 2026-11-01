import { Fragment, memo, useMemo } from 'react'
import { Pause, Play, Square } from 'lucide-react'
import { attachRun } from '@/app/shell/store'
import { runEngine } from '@/core/runs'
import { useApprovalsForRun } from '@/core/services'
import { useRow } from '@/core/db'
import type { ID, Investigation, Run, Source } from '@/core/types'
import { cn } from '@/lib/cn'
import {
  ApprovalCardConnected, Button, RunStatusGlyph, SimBadge, StepStatusGlyph, StepTape, formatClock, formatTok, runCurrentLine, useRunElapsed,
} from '@/ui'
import { researchPhases, sourceOrigin, type Phase } from './logic'

/**
 * The frontier strip (§6.5 Running): what Scout is doing now, the Step Tape, and the phases with
 * their counts — `Searching 3/4 → Reading 7/12 → Synthesizing` — plus Pause/Resume, Stop and View run.
 */
export const Frontier = memo(function Frontier({ inv, runId, sources, className }: { inv: Investigation; runId: ID; sources: readonly Source[]; className?: string }) {
  const run = useRow('runs', runId)
  if (!run) return null
  return <FrontierStrip inv={inv} run={run} sources={sources} className={className} />
})

function FrontierStrip({ inv, run, sources, className }: { inv: Investigation; run: Run; sources: readonly Source[]; className?: string }) {
  // Count this run's own web sources (a follow-up reads new pages, not the earlier ones).
  const since = run.createdAt
  const web = useMemo(() => {
    const w = sources.filter((s) => sourceOrigin(s) === 'web' && s.addedAt >= since)
    return { found: w.length, read: w.filter((s) => s.status === 'read' || s.status === 'cited' || (s.status === 'discarded' && !!s.content)).length }
  }, [sources, since])
  const phases = researchPhases({ inv, run, web })
  const elapsed = useRunElapsed(run)
  const approvals = useApprovalsForRun(run.id)
  const pending = approvals.find((a) => a.status === 'pending')
  const done = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const tokens = run.usage.inputTokens + run.usage.outputTokens
  const followUp = run.script?.factory === 'research.follow_up'
  const line = runCurrentLine(run)

  return (
    <section
      aria-label={`${followUp ? 'Follow-up' : 'Research'} in progress`}
      className={cn('flex flex-col gap-2.5 rounded-md border border-line bg-raised px-3.5 py-3', run.status === 'waiting' && 'border-attn/50', className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-0 grow basis-[240px] items-center gap-2">
          <RunStatusGlyph status={run.status} size={12} />
          <span aria-live="off" className={cn('type-body-sm min-w-0 truncate font-medium', run.status === 'running' ? 'text-live-ink' : run.status === 'waiting' ? 'text-attn-ink' : 'text-ink-2')}>
            {followUp && <span className="text-ink-3">Follow-up · </span>}
            {run.status === 'paused' ? `Paused · ${line}` : run.status === 'waiting' ? 'Scout needs you' : line}
          </span>
        </span>
        <span className="type-meta flex shrink-0 items-center gap-1.5 text-ink-3 tabular">
          <span>
            step {Math.min(done + (run.status === 'running' ? 1 : 0), total || 1)}/{total || '…'}
          </span>
          <span aria-hidden>·</span>
          <span>{formatClock(elapsed)}</span>
          <span aria-hidden>·</span>
          <span>{formatTok(tokens, { est: true })}</span>
          {run.simulated && <SimBadge />}
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <StepTape run={run} size="sm" max={18} />
        <Phases phases={phases} />
      </div>

      {pending && <ApprovalCardConnected approvalId={pending.id} variant="compact" />}

      <div className="-mb-1 flex flex-wrap items-center gap-1">
        {(run.status === 'running' || run.status === 'queued') && (
          <Button size="xs" variant="ghost" leadingIcon={Pause} onClick={() => runEngine.pause(run.id)} className="-ml-1.5">
            Pause
          </Button>
        )}
        {run.status === 'paused' && (
          <Button size="xs" variant="secondary" leadingIcon={Play} onClick={() => runEngine.resume(run.id)}>
            Resume
          </Button>
        )}
        <Button size="xs" variant="ghost" leadingIcon={Square} kbd="mod+." onClick={() => runEngine.cancel(run.id, 'Stopped by you')}>
          Stop
        </Button>
        <span className="flex-1" />
        <Button size="xs" variant="ghost" onClick={() => attachRun(run.id, 'research')}>
          View run
        </Button>
      </div>
    </section>
  )
}

/** `Planning ✓ → Searching 3/4 → Reading → Synthesizing → Drafting`, the current phase in live ink. */
function Phases({ phases }: { phases: readonly Phase[] }) {
  const current = phases.find((p) => p.state === 'current')
  return (
    <ol
      className="type-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1"
      aria-label={current ? `Phase: ${current.label}${current.count ? ` ${current.count.done} of ${current.count.total}` : ''}` : 'Phases'}
    >
      {phases.map((p, i) => (
        <Fragment key={p.key}>
          {i > 0 && (
            <li aria-hidden className="text-ink-4">
              →
            </li>
          )}
          <li
            aria-current={p.state === 'current' ? 'step' : undefined}
            className={cn(
              'inline-flex items-center gap-1 whitespace-nowrap',
              p.state === 'current' ? 'font-medium text-live-ink' : 'text-ink-3',
            )}
          >
            {p.state === 'done' && <StepStatusGlyph status="done" context="timeline" size={10} decorative />}
            {p.label}
            {p.count && <span className="type-meta tabular">{` ${p.count.done}/${p.count.total}`}</span>}
          </li>
        </Fragment>
      ))}
    </ol>
  )
}
