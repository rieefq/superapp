import type { Approval, Priority, Run, RunStatus, StepStatus, TaskStatus } from '@/core/types'

/**
 * The status glyph alphabet (docs/DESIGN.md §5.3) as data: shape, signal color and the
 * user-facing word. The shape always carries the meaning on its own; color only reinforces it.
 */
export type GlyphShape = 'ring' | 'dot' | 'diamond' | 'bars' | 'check' | 'cross' | 'slash' | 'dash'
export type GlyphTone = 'live' | 'attn' | 'done' | 'fail' | 'ink' | 'ink-2' | 'ink-3' | 'ink-4'

export interface GlyphSpec {
  shape: GlyphShape
  tone: GlyphTone
  word: string
  /** Breathing halo while live (static ring under reduced motion). */
  live?: boolean
}

export const RUN_STATUS_META: Record<RunStatus, GlyphSpec> = {
  queued: { shape: 'ring', tone: 'ink-3', word: 'Queued' },
  running: { shape: 'dot', tone: 'live', word: 'Running', live: true },
  waiting: { shape: 'diamond', tone: 'attn', word: 'Needs you' },
  paused: { shape: 'bars', tone: 'ink-2', word: 'Paused' },
  succeeded: { shape: 'check', tone: 'done', word: 'Done' },
  failed: { shape: 'cross', tone: 'fail', word: 'Failed' },
  cancelled: { shape: 'slash', tone: 'ink-3', word: 'Stopped' },
}

export const STEP_STATUS_META: Record<StepStatus, GlyphSpec> = {
  pending: { shape: 'ring', tone: 'ink-3', word: 'Pending' },
  running: { shape: 'dot', tone: 'live', word: 'Running', live: true },
  waiting: { shape: 'diamond', tone: 'attn', word: 'Needs you' },
  done: { shape: 'check', tone: 'done', word: 'Done' },
  failed: { shape: 'cross', tone: 'fail', word: 'Failed' },
  skipped: { shape: 'dash', tone: 'ink-4', word: 'Skipped' },
}

/** Step glyph, with done receding to ink-3 inside timelines (§5.3). */
export function stepGlyph(status: StepStatus, context: 'default' | 'timeline' = 'default'): GlyphSpec {
  const spec = STEP_STATUS_META[status]
  return context === 'timeline' && status === 'done' ? { ...spec, tone: 'ink-3' } : spec
}

export type TaskGlyphFill = 'none' | 'lower' | 'full' | 'dot'

export interface TaskGlyphSpec {
  fill: TaskGlyphFill
  slash?: boolean
  tone: GlyphTone
  /** Outline weight in px. */
  stroke: number
  word: string
}

export const TASK_STATUS_META: Record<TaskStatus, TaskGlyphSpec> = {
  backlog: { fill: 'none', tone: 'ink-4', stroke: 1, word: 'Backlog' },
  todo: { fill: 'none', tone: 'ink-3', stroke: 1.5, word: 'To do' },
  in_progress: { fill: 'lower', tone: 'ink-2', stroke: 1.5, word: 'In progress' },
  review: { fill: 'dot', tone: 'ink-2', stroke: 1.5, word: 'Review' },
  done: { fill: 'full', tone: 'done', stroke: 1.5, word: 'Done' },
  cancelled: { fill: 'none', slash: true, tone: 'ink-4', stroke: 1, word: 'Cancelled' },
}

/**
 * Task glyph with its live modifiers: in progress fills live while a run for the task is running;
 * review turns attn when agent work awaits you.
 */
export function taskGlyph(status: TaskStatus, opts: { live?: boolean; attention?: boolean } = {}): TaskGlyphSpec {
  const spec = TASK_STATUS_META[status]
  if (status === 'in_progress' && opts.live) return { ...spec, tone: 'live' }
  if (status === 'review' && opts.attention) return { ...spec, tone: 'attn' }
  return spec
}

export interface PrioritySpec {
  /** Filled bars, 0–3. */
  bars: 0 | 1 | 2 | 3
  urgent: boolean
  word: string
}

export const PRIORITY_META: Record<Priority, PrioritySpec> = {
  none: { bars: 0, urgent: false, word: 'No priority' },
  low: { bars: 1, urgent: false, word: 'Low priority' },
  medium: { bars: 2, urgent: false, word: 'Medium priority' },
  high: { bars: 3, urgent: false, word: 'High priority' },
  urgent: { bars: 3, urgent: true, word: 'Urgent' },
}

export type SignalTone = 'live' | 'attn' | 'done' | 'fail' | 'neutral'

/** The one signal a run status carries (neutral for queued, paused and stopped). */
export function runSignal(status: RunStatus): SignalTone {
  switch (status) {
    case 'running':
      return 'live'
    case 'waiting':
      return 'attn'
    case 'succeeded':
      return 'done'
    case 'failed':
      return 'fail'
    default:
      return 'neutral'
  }
}

export type ActivityState = 'idle' | 'working' | 'waiting'

/** The mark's capsule state (§5.4.1): waiting (any pending approval) beats working (any running run). */
export function activityState(runs: readonly Pick<Run, 'status'>[], approvals: readonly Pick<Approval, 'status'>[]): ActivityState {
  if (approvals.some((a) => a.status === 'pending') || runs.some((r) => r.status === 'waiting')) return 'waiting'
  if (runs.some((r) => r.status === 'running')) return 'working'
  return 'idle'
}

/** Tailwind classes for glyph tones (literal strings so Tailwind can see them). */
export const TONE_TEXT: Record<GlyphTone, string> = {
  live: 'text-live',
  attn: 'text-attn',
  done: 'text-done',
  fail: 'text-fail',
  ink: 'text-ink',
  'ink-2': 'text-ink-2',
  'ink-3': 'text-ink-3',
  'ink-4': 'text-ink-4',
}
