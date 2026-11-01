import { useMemo, type KeyboardEvent } from 'react'
import {
  ArrowRightLeft, BookOpen, FileDiff, FlaskConical, Globe, Hand, Hourglass, Lightbulb, Package, Palette, PenLine, Route, Search,
  Send, SquareTerminal, Wrench, type LucideIcon,
} from 'lucide-react'
import type { ID, RunStatus, StepKind, StepStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { RunStatusGlyph } from './glyphs'
import { computeTape, type TapeCell, type TapeRun } from './tape'
import './signature.css'

// ------------------------------------------------------------------ StepIcon

/** Step-kind icons (docs/DESIGN.md §5.4.4). */
export const STEP_KIND_ICON: Record<StepKind, LucideIcon> = {
  plan: Route,
  think: Lightbulb,
  search: Search,
  read: BookOpen,
  browse: Globe,
  write: PenLine,
  edit: FileDiff,
  command: SquareTerminal,
  test: FlaskConical,
  tool: Wrench,
  message: Send,
  approval: Hand,
  artifact: Package,
  handoff: ArrowRightLeft,
  wait: Hourglass,
  generate: Palette,
}

const ICON_TONE: Record<StepStatus, string> = {
  pending: 'text-ink-4',
  running: 'text-live-ink',
  waiting: 'text-attn-ink',
  done: 'text-ink-3',
  failed: 'text-fail-ink',
  skipped: 'text-ink-4',
}

const MARKER_BORDER: Record<StepStatus, string> = {
  pending: 'border-line',
  running: 'border-live',
  waiting: 'border-attn',
  done: 'border-line-strong',
  failed: 'border-fail',
  skipped: 'border-line',
}

export interface StepIconProps {
  kind: StepKind
  status: StepStatus
  /** Draw the 20px timeline marker (rounded square, status-colored border). */
  marker?: boolean
  /** Icon size in px (default 12). */
  size?: number
  className?: string
}

/** The step-kind icon tinted by status; with `marker`, the 20px timeline marker around it. */
export function StepIcon({ kind, status, marker, size = 12, className }: StepIconProps) {
  const Icon = STEP_KIND_ICON[kind] ?? Wrench
  const icon = <Icon aria-hidden className={cn('shrink-0', ICON_TONE[status], !marker && className)} style={{ width: size, height: size }} strokeWidth={1.75} />
  if (!marker) return icon
  return (
    <span
      aria-hidden
      className={cn(
        'relative grid size-5 shrink-0 place-items-center rounded-sm border bg-[var(--sig-surface,var(--surface-canvas))] transition-colors duration-(--dur-2) ease-standard',
        MARKER_BORDER[status],
        className,
      )}
    >
      {icon}
    </span>
  )
}

// ------------------------------------------------------------------ StepTape

const SIZES = {
  /** Inside run pills. */
  xs: { w: 4, h: 10, gap: 1.5, cap: 10, text: 'text-[10px] leading-[10px]' },
  /** Inline (rows, cards). */
  sm: { w: 6, h: 12, gap: 2, cap: 12, text: 'type-meta' },
  /** Inspector scrubber. */
  md: { w: 8, h: 16, gap: 2, cap: 14, text: 'type-meta' },
} as const

export type StepTapeSize = keyof typeof SIZES

const CELL: Record<StepStatus, string> = {
  pending: 'border border-line-input',
  running: 'bg-live sig-cell-live',
  done: 'bg-ink-3',
  waiting: 'bg-attn',
  failed: 'bg-fail',
  skipped: 'border border-line-strong sig-cell-skipped',
}

export interface StepTapeProps {
  run: TapeRun
  /** xs 4×10 (run pills) · sm 6×12 (inline, default) · md 8×16 (Inspector scrubber). */
  size?: StepTapeSize
  /** Maximum width in cell units (double cells count 2). Finished cells fold into a leading `+n`. */
  max?: number
  /** Inspector scrubber: role="slider"; ←/→ move through the steps. */
  interactive?: boolean
  selectedStepId?: ID
  onSelectStep?: (stepId: ID, index: number) => void
  /** Override the accessible label. */
  label?: string
  className?: string
}

/**
 * One cell per step: pending outline, running live (breathing), done ink-3, waiting attn (4px taller),
 * failed fail, skipped slashed. Double cells for steps with file changes or references, an end cap
 * after terminal runs, and a dashed baseline when simulated.
 */
export function StepTape({ run, size = 'sm', max, interactive, selectedStepId, onSelectStep, label, className }: StepTapeProps) {
  const s = SIZES[size]
  const model = useMemo(() => computeTape(run, { max: max ?? (size === 'xs' ? 12 : size === 'md' ? 30 : 24) }), [run, max, size])
  const steps = run.steps
  const selectedIndex = interactive ? Math.max(0, selectedStepId ? steps.findIndex((st) => st.id === selectedStepId) : model.current) : -1

  const select = (index: number) => {
    const step = steps[Math.max(0, Math.min(steps.length - 1, index))]
    if (step) onSelectStep?.(step.id, steps.indexOf(step))
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!steps.length) return
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }
    if (e.key in moves) {
      e.preventDefault()
      select(selectedIndex + moves[e.key])
    } else if (e.key === 'Home') {
      e.preventDefault()
      select(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      select(steps.length - 1)
    }
  }

  const cellWidth = (c: TapeCell) => (c.wide ? s.w * 2 + s.gap : s.w)
  const selected = interactive ? steps[selectedIndex] : undefined
  const ariaValueText = selected
    ? `Step ${selectedIndex + 1} of ${model.totalKnown ? model.total : steps.length}: ${selected.title}`
    : model.label

  return (
    <div
      role={interactive ? 'slider' : 'img'}
      aria-label={interactive ? (label ?? 'Steps') : (label ?? model.label)}
      aria-valuemin={interactive ? 1 : undefined}
      aria-valuemax={interactive ? Math.max(1, steps.length) : undefined}
      aria-valuenow={interactive ? selectedIndex + 1 : undefined}
      aria-valuetext={interactive ? ariaValueText : undefined}
      aria-orientation={interactive ? 'horizontal' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      data-size={size}
      className={cn(
        'relative inline-flex shrink-0 items-end select-none',
        interactive && 'cursor-pointer rounded-xs focus-visible:outline-offset-4',
        className,
      )}
      style={{ height: s.h + 4 + (model.simulated ? 3 : 0), paddingBottom: model.simulated ? 3 : 0, gap: s.gap }}
    >
      {model.leading > 0 && (
        <span aria-hidden className={cn('mr-0.5 shrink-0 text-ink-3 tabular', s.text)} style={{ height: s.h, lineHeight: `${s.h}px` }}>
          +{model.leading}
        </span>
      )}
      {model.cells.map((c) => {
        const isSelected = interactive && c.stepId !== undefined && c.stepId === selected?.id
        return (
          <span
            key={c.key}
            aria-hidden
            data-state={c.state}
            data-wide={c.wide || undefined}
            onClick={interactive && c.stepId ? () => select(c.index) : undefined}
            className={cn(
              'block shrink-0 rounded-cell transition-[background-color,border-color,height] duration-(--dur-2) ease-standard',
              CELL[c.state],
              c.planned && c.state === 'pending' && 'opacity-70',
              isSelected && 'outline-1 outline-offset-1 outline-ink',
            )}
            style={{ width: cellWidth(c), height: c.state === 'waiting' ? s.h + 4 : s.h }}
          />
        )
      })}
      {model.trailing > 0 && (
        <span aria-hidden className={cn('ml-0.5 shrink-0 text-ink-3 tabular', s.text)} style={{ height: s.h, lineHeight: `${s.h}px` }}>
          +{model.trailing}
        </span>
      )}
      {model.endCap && (
        <span aria-hidden className="grid shrink-0 place-items-center" style={{ marginLeft: 4 - s.gap, height: s.h, width: s.cap }}>
          <RunStatusGlyph status={model.endCap} size={s.cap} decorative />
        </span>
      )}
      {model.simulated && (
        <span aria-hidden className="sig-dash-baseline pointer-events-none absolute right-0 bottom-0 left-0 h-px" />
      )}
    </div>
  )
}

// ------------------------------------------------------------------ outcome strip

const OUTCOME_CELL: Record<RunStatus, StepStatus> = {
  queued: 'pending',
  running: 'running',
  waiting: 'waiting',
  paused: 'pending',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'skipped',
}

export interface OutcomeTapeProps {
  /** Run statuses, oldest first (e.g. a workflow's last runs). */
  outcomes: readonly RunStatus[]
  size?: StepTapeSize
  /** Most cells to draw (the newest are kept). Default 12. */
  max?: number
  /** Accessible label prefix, default "Last runs". */
  label?: string
  className?: string
}

/** One cell per run outcome (workflow list strips, §5.4.2): done ink-3, failed fail, stopped slashed, live while running. */
export function OutcomeTape({ outcomes, size = 'sm', max = 12, label = 'Last runs', className }: OutcomeTapeProps) {
  const s = SIZES[size]
  const shown = outcomes.slice(-max)
  const count = (st: RunStatus) => shown.filter((o) => o === st).length
  const parts = [
    [count('succeeded'), 'done'],
    [count('failed'), 'failed'],
    [count('cancelled'), 'stopped'],
    [count('running') + count('waiting') + count('queued') + count('paused'), 'in progress'],
  ].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`)
  return (
    <div
      role="img"
      aria-label={shown.length ? `${label}: ${parts.join(', ')}` : `${label}: none yet`}
      className={cn('inline-flex shrink-0 items-end', className)}
      style={{ gap: s.gap, height: s.h + 4 }}
    >
      {shown.length === 0 && <span className={cn('text-ink-4', s.text)}>—</span>}
      {shown.map((o, i) => {
        const st = OUTCOME_CELL[o]
        return <span key={i} aria-hidden className={cn('block shrink-0 rounded-cell', CELL[st])} style={{ width: s.w, height: st === 'waiting' ? s.h + 4 : s.h }} />
      })}
    </div>
  )
}
