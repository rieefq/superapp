import { useMemo, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Pause, Play, RotateCw, Square } from 'lucide-react'
import { workspaceForPath } from '@/app/registry'
import { attachRun } from '@/app/shell/store'
import { useRow } from '@/core/db'
import { runEngine, useRun } from '@/core/runs'
import { approve, reject, RUN_KIND_LABEL, useApprovalsForRun } from '@/core/services'
import { isRunActive, type Approval, type EntityRef, type ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, ErrorState, Skeleton, toast } from '@/ui'
import { AgentMark, EntityChip, IdCode, ProvenanceLine, RunStatusBadge, RunTimeline, StepTape } from '../sig'

export interface RunPanelProps {
  runId: ID | null | undefined
  /** 'full' in a stage; 'compact' in narrow panes (outputs collapsed, tighter). */
  variant?: 'full' | 'compact'
  /** Show the header (title, handle, status, owner) and controls. Default true. */
  header?: boolean
  /** Extra actions in the header (e.g. "Open in workspace"). */
  actions?: ReactNode
  /** Render refs inside the timeline (default: EntityChip). */
  renderRef?: (ref: EntityRef) => ReactNode
  className?: string
}

/**
 * RunPanel (connected): a run's full timeline with approvals wired to the approval service, the
 * Pause/Resume/Stop/Retry controls and the Colophon. Used by Agents, Code, Research, Workflows, Studio.
 */
export function RunPanel({ runId, variant = 'full', header = true, actions, renderRef, className }: RunPanelProps) {
  const run = useRun(runId)
  const approvalsList = useApprovalsForRun(runId)
  const approvals = useMemo(() => Object.fromEntries(approvalsList.map((a) => [a.id, a])) as Record<ID, Approval>, [approvalsList])
  const agent = useRow('agents', run?.agentId)
  const { pathname } = useLocation()

  if (runId && !run) {
    return <ErrorState compact title="Couldn’t find this run" message="It may have been deleted with the item that started it." className={className} />
  }
  if (!run) {
    return (
      <div className={cn('flex flex-col gap-3', className)} aria-busy>
        <Skeleton height={20} width="50%" />
        <Skeleton height={12} width="30%" />
        <Skeleton variant="text" lines={4} />
      </div>
    )
  }

  const active = isRunActive(run.status)
  const done = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)

  const onRetry = () => {
    const next = runEngine.retry(run.id)
    if (next) {
      attachRun(next.id, workspaceForPath(pathname).id)
      toast({ title: `Retrying “${run.title}”` })
    } else toast({ tone: 'error', title: 'Couldn’t retry this run', description: 'Its script is no longer available.' })
  }
  const onStop = () => {
    runEngine.cancel(run.id, 'Stopped by you')
  }

  return (
    <section aria-label={`Run: ${run.title}`} className={cn('flex min-w-0 flex-col', variant === 'compact' ? 'gap-3' : 'gap-4', className)}>
      {header && (
        <header className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className={cn('min-w-0 truncate text-ink', variant === 'compact' ? 'type-body-sm font-semibold' : 'type-title-3')}>{run.title}</h2>
                <RunStatusBadge status={run.status} />
              </div>
              <div className="type-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
                <IdCode id={run.id} />
                <span aria-hidden>·</span>
                <span>{RUN_KIND_LABEL[run.kind]}</span>
                {agent && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1.5">
                      <AgentMark seed={agent.sigil} hue={agent.hue} size={14} live={run.status === 'running'} label={agent.name} />
                      {agent.name}
                    </span>
                  </>
                )}
                <span aria-hidden>·</span>
                <span className="tabular">
                  steps {done}/{total || '…'}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {actions}
              {(run.status === 'running' || run.status === 'queued') && (
                <Button size="sm" variant="ghost" leadingIcon={Pause} onClick={() => runEngine.pause(run.id)}>
                  Pause
                </Button>
              )}
              {run.status === 'paused' && (
                <Button size="sm" variant="secondary" leadingIcon={Play} onClick={() => runEngine.resume(run.id)}>
                  Resume
                </Button>
              )}
              {active && (
                <Button size="sm" variant="ghost" leadingIcon={Square} kbd="mod+." onClick={onStop}>
                  Stop
                </Button>
              )}
              {(run.status === 'failed' || run.status === 'cancelled') && (
                <Button size="sm" variant="secondary" leadingIcon={RotateCw} onClick={onRetry}>
                  Retry
                </Button>
              )}
            </div>
          </div>
          <StepTape run={run} size={variant === 'compact' ? 'sm' : 'md'} />
        </header>
      )}
      <RunTimeline
        run={run}
        approvals={approvals}
        onApprove={(id, note) => approve(id, note)}
        onReject={(id, note) => reject(id, note)}
        renderRef={renderRef ?? ((ref) => <EntityChip entity={ref} size="sm" />)}
        compact={variant === 'compact'}
        defaultExpanded={active ? 'active' : 'none'}
      />
      {run.status === 'failed' && run.error && (
        <p role="alert" className="type-body-sm rounded-sm border border-fail/30 bg-fail-tint/40 px-3 py-2 text-fail-ink">
          {run.error}
        </p>
      )}
      {!active && (
        <ProvenanceLine run={run} className="border-t border-line pt-2" />
      )}
    </section>
  )
}
