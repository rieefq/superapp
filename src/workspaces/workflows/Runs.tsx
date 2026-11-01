import { memo, useMemo } from 'react'
import { ChevronUp } from 'lucide-react'
import type { Run, Workflow } from '@/core/types'
import { isRunActive } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDateTime, timeAgo } from '@/lib/format'
import { DataTable, EmptyState, formatClock, formatCost, IdCode, RUN_STATUS_META, RunStatusGlyph, SimBadge, StepTape, useRunElapsed, type DataColumn } from '@/ui'

/**
 * Runs of a workflow (docs/DESIGN.md §6.6 "Runs drawer"): a 36px bar while collapsed
 * (`Last run ✓ 2m ago · 6 steps` plus its tape) and a 280px table when open. Picking a run draws
 * its path on the canvas and attaches it to Inspector › Run.
 */

function triggerWord(run: Run): string {
  if (run.initiator.type === 'user') return 'By you'
  const t = run.steps[0]
  if (t?.title.startsWith('Scheduled')) return 'Schedule'
  if (t?.detail?.startsWith('Event:') || /^Event ·/.test(String((run.script?.params as Record<string, unknown> | undefined)?.trigger ?? ''))) return 'Event'
  return 'Automatic'
}

function durationOf(run: Run, now = Date.now()): number {
  const start = run.startedAt ?? run.createdAt
  return Math.max(0, (run.endedAt ?? (isRunActive(run.status) ? now : start)) - start)
}

function Elapsed({ run }: { run: Run }) {
  const ms = useRunElapsed(run)
  return <>{formatClock(ms)}</>
}

export function RunsTable({ runs, selectedRunId, onPick }: { runs: Run[]; selectedRunId: string | null; onPick: (run: Run) => void }) {
  const columns = useMemo<DataColumn<Run>[]>(
    () => [
      {
        key: 'status',
        header: 'Status',
        width: 120,
        cell: (r) => (
          <span className={cn('inline-flex items-center gap-1.5', r.status === 'failed' && 'text-fail-ink', r.status === 'waiting' && 'text-attn-ink', r.status === 'running' && 'text-live-ink')}>
            <RunStatusGlyph status={r.status} size={12} decorative />
            {RUN_STATUS_META[r.status].word}
          </span>
        ),
        sortable: true,
        sortValue: (r) => r.status,
      },
      { key: 'id', header: 'Run', width: 100, mono: true, cell: (r) => <IdCode id={r.id} /> },
      { key: 'started', header: 'Started', width: 120, mono: true, sortable: true, sortValue: (r) => r.createdAt, cell: (r) => <span title={formatDateTime(r.createdAt)}>{timeAgo(r.createdAt)}</span> },
      { key: 'trigger', header: 'Trigger', width: 110, hideBelow: 'md', cell: (r) => <span className="text-ink-2">{triggerWord(r)}</span> },
      { key: 'steps', header: 'Steps', cell: (r) => <StepTape run={r} size="xs" max={14} /> },
      { key: 'duration', header: 'Duration', width: 90, align: 'right', mono: true, sortable: true, sortValue: (r) => durationOf(r), cell: (r) => (isRunActive(r.status) ? <Elapsed run={r} /> : formatClock(durationOf(r))) },
      {
        key: 'cost',
        header: 'Cost',
        width: 110,
        align: 'right',
        mono: true,
        hideBelow: 'sm',
        cell: (r) => (
          <span className="inline-flex items-center gap-1.5" title={r.simulated ? 'Estimated at reference pricing; no money was spent.' : undefined}>
            {formatCost(r.usage.costUsd, { est: r.simulated })}
            {r.simulated && <SimBadge size="xs" noTooltip />}
          </span>
        ),
      },
    ],
    [],
  )
  return (
    <DataTable
      columns={columns}
      rows={runs}
      rowKey={(r) => r.id}
      onRowClick={onPick}
      selectedKey={selectedRunId}
      dense
      surface="canvas"
      caption="Runs of this workflow"
      empty={<EmptyState compact title="No runs yet" description="Test run starts one now; automatic triggers add more while Atrium is open." className="py-6" />}
    />
  )
}

/** The collapsed runs bar (36px): the latest run's glyph, word, age, steps and tape. */
export const RunsBar = memo(function RunsBar({ wf, runs, onOpen }: { wf: Workflow; runs: Run[]; onOpen: () => void }) {
  const latest = runs[0]
  const finished = runs.filter((r) => !isRunActive(r.status))
  const ok = finished.filter((r) => r.status === 'succeeded').length
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Runs of ${wf.name}: ${runs.length}. Show the runs`}
      data-testid="wf-runs-bar"
      className="flex h-9 w-full shrink-0 items-center gap-2.5 border-t border-line bg-canvas px-4 text-left transition-colors duration-(--dur-1) hover:bg-hover"
    >
      <span className="type-label text-ink-3">Runs</span>
      <span className="type-meta text-ink-3 tabular">{runs.length}</span>
      {latest ? (
        <>
          <span aria-hidden className="text-ink-4">·</span>
          <span className="type-meta flex min-w-0 items-center gap-1.5 text-ink-2">
            <span>{isRunActive(latest.status) ? 'Current run' : 'Last run'}</span>
            <RunStatusGlyph status={latest.status} size={12} decorative />
            <span className={cn(latest.status === 'waiting' && 'text-attn-ink', latest.status === 'running' && 'text-live-ink', latest.status === 'failed' && 'text-fail-ink')}>
              {RUN_STATUS_META[latest.status].word}
            </span>
            <span className="truncate text-ink-3">
              {timeAgo(latest.createdAt)} · {latest.steps.length} {latest.steps.length === 1 ? 'step' : 'steps'}
            </span>
          </span>
          <StepTape run={latest} size="xs" max={16} className="max-sm:hidden" />
        </>
      ) : (
        <span className="type-meta text-ink-3">· none yet</span>
      )}
      <span className="flex-1" />
      {finished.length > 0 && <span className="type-meta text-ink-3 max-sm:hidden">{Math.round((ok / finished.length) * 100)}% done</span>}
      <ChevronUp aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
    </button>
  )
})
