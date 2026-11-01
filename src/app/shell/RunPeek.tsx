import { useNavigate } from 'react-router'
import { useDB } from '@/core/db'
import { entityRoute, RUN_KIND_LABEL } from '@/core/services'
import { runEngine } from '@/core/runs'
import type { Run } from '@/core/types'
import { Button } from '@/ui'
import { IdCode } from '@/ui/signature'
import { shortCode } from '@/lib/id'
import { cn } from '@/lib/cn'
import { ConnectedApproval, RunGlyph, StepGlyph, Tape, runStatusWord } from './sig'
import { formatElapsed } from './runline'

/** The Run Line peek card (§3.6): current step and detail, last 3 steps, tape, and Attach · Open · Pause · Stop. */
export function RunPeek({ run, now, onAttach, onOpen }: { run: Run; now: number; onAttach: () => void; onOpen: () => void }) {
  const navigate = useNavigate()
  const pending = useDB((s) => Object.values(s.approvals).find((a) => a.runId === run.id && a.status === 'pending')?.id)
  const project = useDB((s) => (run.projectId ? s.projects[run.projectId]?.name : undefined))
  const current = [...run.steps].reverse().find((s) => s.status === 'running' || s.status === 'waiting') ?? run.steps[run.steps.length - 1]
  const recent = run.steps.filter((s) => s !== current).slice(-3)
  const done = run.steps.filter((s) => s.status === 'done').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const elapsed = formatElapsed((run.endedAt ?? now) - (run.startedAt ?? run.createdAt))
  const active = run.status === 'running' || run.status === 'queued' || run.status === 'waiting' || run.status === 'paused'

  return (
    <div className="flex flex-col">
      <div className="flex items-start gap-2 px-3 pt-3">
        <RunGlyph status={run.status} className="mt-1" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="type-body-sm line-clamp-2 font-medium text-ink">{run.title}</span>
          <span className="type-meta flex flex-wrap items-center gap-x-1.5 text-ink-3">
            <IdCode id={run.id} label={shortCode(run.id)} />
            <span aria-hidden>·</span>
            <span>{RUN_KIND_LABEL[run.kind]}</span>
            {project && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{project}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{runStatusWord(run.status)}</span>
          </span>
        </div>
      </div>

      {current && (
        <div className="mx-3 mt-3 flex flex-col gap-1 rounded-sm border border-line bg-raised px-2.5 py-2">
          <span className="type-label text-ink-3">{active ? 'Now' : 'Last step'}</span>
          <span className={cn('type-body-sm font-medium', current.status === 'running' ? 'text-live-ink' : 'text-ink')}>{current.title}</span>
          {current.detail && <span className="type-caption line-clamp-2 text-ink-2">{current.detail}</span>}
        </div>
      )}

      {recent.length > 0 && (
        <ol className="mt-2 flex flex-col gap-1 px-3" aria-label="Recent steps">
          {recent.map((s) => (
            <li key={s.id} className="type-caption flex items-center gap-2 text-ink-2">
              <StepGlyph status={s.status} />
              <span className="truncate">{s.title}</span>
            </li>
          ))}
        </ol>
      )}

      {pending && (
        <div className="mt-3 px-3">
          <ConnectedApproval approvalId={pending} variant="compact" />
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 px-3">
        <Tape run={run} size="inline" maxCells={20} />
        <span className="type-meta ml-auto shrink-0 text-ink-3">
          {total ? `${done}/${total} · ` : ''}
          {elapsed}
        </span>
      </div>

      {run.error && run.status === 'failed' && <p className="type-caption mx-3 mt-2 line-clamp-2 text-fail-ink">{run.error}</p>}

      <div className="mt-3 flex items-center gap-1 border-t border-line px-2 py-2">
        <Button size="xs" variant="ghost" onClick={onAttach}>
          Attach
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => {
            onOpen()
            navigate(entityRoute({ kind: 'run', id: run.id }))
          }}
        >
          Open
        </Button>
        <span className="flex-1" />
        {run.status === 'paused' ? (
          <Button size="xs" variant="ghost" onClick={() => runEngine.resume(run.id)} disabled={!run.script}>
            Resume
          </Button>
        ) : (
          (run.status === 'running' || run.status === 'queued') && (
            <Button size="xs" variant="ghost" onClick={() => runEngine.pause(run.id)} disabled={!run.script}>
              Pause
            </Button>
          )
        )}
        {active && (
          <Button size="xs" variant="danger" onClick={() => runEngine.cancel(run.id, 'Stopped by you')}>
            Stop
          </Button>
        )}
      </div>
    </div>
  )
}
