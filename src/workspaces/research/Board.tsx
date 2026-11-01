import { memo, useMemo } from 'react'
import { useRow } from '@/core/db'
import type { ID, Investigation, Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { Skeleton, StepStatusGlyph } from '@/ui'
import { FindingItem } from './FindingsView'
import { planChecklist, sourceOrigin, sourceStats, type CheckState, type PlanItem } from './logic'
import { QuietLine, SectionLabel } from './parts'
import { SourceList } from './SourcesView'

/*
 * The running board (§6.5): Plan (angles with checks) · Sources (streaming, with origin tags,
 * credibility and status) · Findings (claims with confidence and `[n]` sources). Three columns when the
 * stage is ≥1100px; stacked otherwise.
 */

export interface BoardProps {
  inv: Investigation
  runId?: ID
  sources: readonly Source[]
  selectedId: ID | null
  readingIds: ReadonlySet<ID>
  onSelectSource: (id: ID) => void
  columns: boolean
}

export function Board({ inv, runId, sources, selectedId, readingIds, onSelectSource, columns }: BoardProps) {
  const run = useRow('runs', runId)
  const stats = useMemo(() => sourceStats(sources), [sources])
  const web = useMemo(() => sources.filter((s) => sourceOrigin(s) === 'web'), [sources])
  const plan = planChecklist(inv, run, {
    knowledge: stats.knowledge,
    webFound: web.length,
    webRead: web.filter((s) => s.status === 'read' || s.status === 'cited').length,
  })
  const numberOf = useMemo(() => new Map(inv.sourceIds.map((id, i) => [id, i + 1])), [inv.sourceIds])
  const byId = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources])
  const synthesizing = !!run?.steps.some((s) => s.status === 'running' && (s.kind === 'think' || s.kind === 'write'))

  return (
    <div className={cn(columns ? 'grid grid-cols-[minmax(200px,240px)_minmax(340px,1fr)_minmax(280px,340px)] items-start gap-6' : 'flex flex-col gap-10')}>
      <section aria-labelledby="board-plan" className="flex min-w-0 flex-col">
        <SectionLabel id="board-plan">Plan</SectionLabel>
        <PlanList items={plan} />
      </section>

      <section aria-labelledby="board-sources" className="flex min-w-0 flex-col">
        <SectionLabel id="board-sources" count={stats.active}>
          Sources
        </SectionLabel>
        {sources.length === 0 ? (
          <QuietLine>Sources appear here as Scout finds them.</QuietLine>
        ) : (
          <SourceList sources={sources} numberOf={numberOf} selectedId={selectedId} readingIds={readingIds} onSelect={onSelectSource} compact animateNew />
        )}
      </section>

      <section aria-labelledby="board-findings" className="flex min-w-0 flex-col">
        <SectionLabel id="board-findings" count={inv.findings.length || undefined}>
          Findings
        </SectionLabel>
        {inv.findings.length === 0 ? (
          synthesizing ? (
            <div className="flex flex-col gap-3 pt-1" aria-busy="true" aria-label="Synthesizing findings">
              <Skeleton variant="text" lines={2} />
              <Skeleton variant="text" lines={2} />
            </div>
          ) : (
            <QuietLine>Findings appear once Scout has read the sources.</QuietLine>
          )
        ) : (
          <ol className="flex flex-col divide-y divide-line" aria-label="Findings">
            {inv.findings.map((f, i) => (
              <FindingItem key={f.id} inv={inv} finding={f} index={i} byId={byId} numberOf={numberOf} onSelectSource={onSelectSource} compact />
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

const GLYPH: Record<CheckState, 'pending' | 'running' | 'done' | 'failed' | 'skipped'> = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

const PlanList = memo(function PlanList({ items }: { items: readonly PlanItem[] }) {
  return (
    <ol className="flex flex-col gap-0.5 pt-1" aria-label="Plan">
      {items.map((item) => (
        <li key={item.key} className="flex min-w-0 items-start gap-2.5 py-1.5">
          <span className="flex h-[18px] shrink-0 items-center">
            <StepStatusGlyph status={GLYPH[item.state]} context="timeline" size={12} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className={cn('type-body-sm text-pretty', item.state === 'running' ? 'text-live-ink' : item.state === 'done' ? 'text-ink-2' : 'text-ink-3')}>{item.label}</span>
            {item.note && <span className="type-caption text-ink-3">{item.note}</span>}
          </span>
          {item.count !== undefined && <span className="type-meta shrink-0 pt-px text-ink-3 tabular">{item.count}</span>}
        </li>
      ))}
    </ol>
  )
})
