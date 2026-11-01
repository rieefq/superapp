import { memo, type ReactNode } from 'react'
import type { Finding, Investigation, ResearchDepth, Run, Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { KindTile, LiveBadge, RunStatusGlyph, SimBadge, StepStatusGlyph, TaskGlyph, Tooltip } from '@/ui'
import { CONFIDENCE_CELLS, DEPTH_LABEL, DEPTH_LETTER, SOURCE_STATUS_WORD, STATUS_WORD, meterCells, sourceOrigin } from './logic'

/*
 * Small research parts: status glyphs and chips, the depth chip, segmented meters (5-tick credibility,
 * 3-tick confidence), source origin tags and section labels. Color only carries state.
 */

// ------------------------------------------------------------------------------------------------ status

/** The investigation's glyph: the run's glyph while it runs, squares for lasting states. */
export function InvestigationGlyph({ inv, run, size = 12, className }: { inv: Pick<Investigation, 'status'>; run?: Pick<Run, 'status'>; size?: number; className?: string }) {
  const word = statusWord(inv, run)
  switch (inv.status) {
    case 'running':
      return <RunStatusGlyph status={run && run.status !== 'succeeded' && run.status !== 'failed' && run.status !== 'cancelled' ? run.status : 'running'} size={size} label={word} className={className} />
    case 'review':
      return <TaskGlyph status="review" size={size} label={word} className={className} />
    case 'complete':
      return <TaskGlyph status="done" size={size} label={word} className={className} />
    case 'failed':
      return <RunStatusGlyph status="failed" size={size} label={word} className={className} />
    case 'draft':
      return <TaskGlyph status="backlog" size={size} label={word} className={className} />
  }
}

/** "Running", "Needs you", "Paused", "Ready for review"… */
export function statusWord(inv: Pick<Investigation, 'status'>, run?: Pick<Run, 'status'>): string {
  if (inv.status === 'running' && run) {
    if (run.status === 'waiting') return 'Needs you'
    if (run.status === 'paused') return 'Paused'
    if (run.status === 'queued') return 'Queued'
  }
  return STATUS_WORD[inv.status]
}

const CHIP_TONE: Record<Investigation['status'], string> = {
  running: 'bg-live-tint text-live-ink',
  review: 'bg-hover text-ink-2',
  complete: 'bg-hover text-ink-2',
  failed: 'bg-fail-tint text-fail-ink',
  draft: 'bg-hover text-ink-3',
}

/** The status capsule in the stage header (glyph + word). */
export function InvestigationStatusChip({ inv, run, className }: { inv: Pick<Investigation, 'status'>; run?: Pick<Run, 'status'>; className?: string }) {
  const waiting = inv.status === 'running' && run?.status === 'waiting'
  return (
    <span
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full pr-2 pl-1 text-2xs leading-none font-medium whitespace-nowrap select-none',
        waiting ? 'bg-attn-tint text-attn-ink' : inv.status === 'running' && run?.status === 'paused' ? 'bg-hover text-ink-2' : CHIP_TONE[inv.status],
        className,
      )}
    >
      <InvestigationGlyph inv={inv} run={run} size={12} className="pointer-events-none" />
      {statusWord(inv, run)}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ depth

/** `Q` · `S` · `D` — the depth chip of list rows. */
export function DepthChip({ depth, className }: { depth: ResearchDepth; className?: string }) {
  return (
    <Tooltip content={`${DEPTH_LABEL[depth]} depth`}>
      <span
        role="img"
        aria-label={`${DEPTH_LABEL[depth]} depth`}
        className={cn('type-meta-caps inline-grid h-4 min-w-4 shrink-0 place-items-center rounded-xs border border-line-strong px-0.5 text-[10px] leading-none text-ink-2', className)}
      >
        <span aria-hidden>{DEPTH_LETTER[depth]}</span>
      </span>
    </Tooltip>
  )
}

// ------------------------------------------------------------------------------------------------ meters

export interface SegmentMeterProps {
  /** Filled cells. */
  filled: number
  cells: number
  label: string
  valueText: string
  /** Cell width in px. */
  cellWidth?: number
  className?: string
}

/** A small segmented meter (ink-2 cells on --line-strong): credibility (5) and confidence (3). */
export function SegmentMeter({ filled, cells, label, valueText, cellWidth = 6, className }: SegmentMeterProps) {
  return (
    <span role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={cells} aria-valuenow={filled} aria-valuetext={valueText} className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} aria-hidden className={cn('h-1 rounded-cell', i < filled ? 'bg-ink-2' : 'bg-line-strong')} style={{ width: cellWidth }} />
      ))}
    </span>
  )
}

/** The 5-tick credibility meter. Simulated sources get a heuristic score, said so in the label. */
export function CredibilityMeter({ source, withValue, className }: { source: Pick<Source, 'credibility' | 'simulated' | 'status' | 'kind'>; withValue?: boolean; className?: string }) {
  const pct = Math.round(source.credibility * 100)
  const unread = source.status === 'queued' && source.kind !== 'knowledge'
  const text = unread ? 'Credibility not assessed yet' : `Credibility ${pct}%${source.simulated ? ', estimated for a simulated source' : ''}`
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <SegmentMeter filled={unread ? 0 : meterCells(source.credibility, 5)} cells={5} label="Credibility" valueText={text} />
      {withValue && <span className="type-meta tabular text-ink-3">{unread ? '—' : `${pct}%`}</span>}
    </span>
  )
}

const CONFIDENCE_WORD: Record<Finding['confidence'], string> = { low: 'Low', medium: 'Medium', high: 'High' }

/** The 3-tick confidence meter with its word. */
export function ConfidenceMeter({ confidence, withWord = true, className }: { confidence: Finding['confidence']; withWord?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <SegmentMeter filled={CONFIDENCE_CELLS[confidence]} cells={3} cellWidth={8} label="Confidence" valueText={`${CONFIDENCE_WORD[confidence]} confidence`} />
      {withWord && <span className="type-meta-caps text-[10px] text-ink-3">{CONFIDENCE_WORD[confidence]}</span>}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ sources

const SOURCE_ICON: Record<Source['kind'], string> = {
  web: 'Globe',
  paper: 'FileText',
  doc: 'FileText',
  dataset: 'Sheet',
  video: 'Clapperboard',
  knowledge: 'BookOpen',
}

export const SOURCE_KIND_WORD: Record<Source['kind'], string> = {
  web: 'Web page',
  paper: 'Paper',
  doc: 'Document',
  dataset: 'Dataset',
  video: 'Video',
  knowledge: 'Knowledge',
}

/** Rounded-square kind tile (dashed when simulated). */
export function SourceKindTile({ source, size = 20 }: { source: Pick<Source, 'kind' | 'simulated'>; size?: number }) {
  return <KindTile kind="source" icon={SOURCE_ICON[source.kind]} size={size} simulated={source.simulated} />
}

/** Origin tag: `SIM` for simulated web results, `LIVE` + "Your knowledge" for retrieved items, "Added by you". */
export function SourceOriginTag({ source, compact, className }: { source: Pick<Source, 'kind' | 'simulated'>; compact?: boolean; className?: string }) {
  const origin = sourceOrigin(source)
  if (origin === 'web') {
    return (
      <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)}>
        <SimBadge explanation="Simulated web result: a fictional publication generated locally. No web page was fetched." />
        {!compact && <span className="type-caption text-ink-3">Simulated web</span>}
      </span>
    )
  }
  if (origin === 'knowledge') {
    return (
      <span className={cn('inline-flex shrink-0 items-center gap-1.5', className)}>
        <LiveBadge explanation="Live: retrieved from your knowledge base by Atrium's local search." />
        {!compact && <span className="type-caption text-ink-2">Your knowledge</span>}
      </span>
    )
  }
  return <span className={cn('type-caption shrink-0 text-ink-3', className)}>Added by you</span>
}

/** Status of a source with its glyph: ○ queued · ● reading · read · cited · ⊘ discarded. */
export const SourceStatus = memo(function SourceStatus({ status, reading, className }: { status: Source['status']; reading?: boolean; className?: string }) {
  const s = reading && status === 'queued' ? 'reading' : status
  return (
    <span className={cn('type-caption inline-flex shrink-0 items-center gap-1', s === 'reading' ? 'text-live-ink' : s === 'cited' ? 'text-ink-2' : 'text-ink-3', className)}>
      {s === 'queued' && <StepStatusGlyph status="pending" size={10} decorative />}
      {s === 'reading' && <StepStatusGlyph status="running" size={10} decorative />}
      {s === 'discarded' && <RunStatusGlyph status="cancelled" size={10} decorative />}
      {SOURCE_STATUS_WORD[s]}
    </span>
  )
})

// ------------------------------------------------------------------------------------------------ sections

/** A section kicker: `label` text, an optional mono count and a right-aligned action. */
export function SectionLabel({ id, children, count, action, className }: { id?: string; children: ReactNode; count?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-7 min-w-0 items-center gap-2', className)}>
      <h2 id={id} className="type-label text-ink-3">
        {children}
      </h2>
      {count !== undefined && <span className="type-meta tabular text-ink-3">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

export function QuietLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('type-body-sm py-1 text-ink-3', className)}>{children}</p>
}

/** Small inline text button (header links, "Show all"). */
export function TextButton({ children, onClick, className, ...rest }: { children: ReactNode; onClick: () => void; className?: string; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'type-caption relative inline-flex h-7 items-center gap-1.5 rounded-sm px-1.5 font-medium text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink',
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
