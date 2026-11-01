import { isRunActive, type ID, type Run, type RunStatus, type RunStep, type StepStatus } from '@/core/types'
import { RUN_STATUS_META, STEP_STATUS_META } from './glyphMeta'
import { stepTitle } from './tense'

/**
 * Step Tape model (docs/DESIGN.md §5.4.2): one cell per step, everywhere a run is referenced.
 * Pure: the component only draws what this computes.
 */
export type TapeCellState = StepStatus

export interface TapeCell {
  key: string
  state: TapeCellState
  /** Double width: the step produced file changes or references. */
  wide: boolean
  /** 0-based position in the run (planned cells continue the count). */
  index: number
  stepId?: ID
  title?: string
  /** A planned step that has not started yet (from `run.plannedSteps`). */
  planned?: boolean
  /** The single "next" cell added while the total is unknown. */
  next?: boolean
}

export interface TapeModel {
  /** Cells to draw, in order (after overflow compression). */
  cells: TapeCell[]
  /** Finished cells folded into the leading mono `+n`. */
  leading: number
  /** Not-yet-started cells folded into a trailing `+n` (only when even pending cells overflow). */
  trailing: number
  /** Total cells before compression. */
  total: number
  /** False while running without a planned step count. */
  totalKnown: boolean
  /** The terminal cap drawn 4px after the last cell. */
  endCap?: 'succeeded' | 'failed' | 'cancelled'
  /** 1px dashed baseline under the cells. */
  simulated: boolean
  /** Index (0-based) of the step the run is on: running/waiting/last. -1 with no steps. */
  current: number
  /** Accessible label, e.g. "Step 4 of 7: Reading sources, running". */
  label: string
}

export type TapeRun = Pick<Run, 'status' | 'steps' | 'simulated'> & Partial<Pick<Run, 'plannedSteps' | 'title'>>

export interface TapeOptions {
  /** Maximum width in cell units (a double-width cell counts 2). Default: unlimited. */
  max?: number
}

const FINISHED: readonly StepStatus[] = ['done', 'skipped']

export const isWideStep = (step: Pick<RunStep, 'fileChanges' | 'refs'>): boolean =>
  (step.fileChanges?.length ?? 0) > 0 || (step.refs?.length ?? 0) > 0

const units = (c: TapeCell) => (c.wide ? 2 : 1)

/** Index of the step the run is on (running › waiting › pending in flight › last step). */
export function currentStepIndex(steps: readonly Pick<RunStep, 'status'>[], status?: RunStatus): number {
  if (!steps.length) return -1
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i].status === 'running' || steps[i].status === 'waiting') return i
  if (status === 'failed') {
    const failed = steps.findIndex((s) => s.status === 'failed')
    if (failed >= 0) return failed
  }
  const last = steps.length - 1
  return last
}

function tapeLabel(run: TapeRun, total: number, totalKnown: boolean, current: number): string {
  const steps = run.steps
  const of = (n: number) => (totalKnown ? `Step ${n} of ${total}` : `Step ${n}`)
  const word = RUN_STATUS_META[run.status].word
  switch (run.status) {
    case 'succeeded':
      return `Done, ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`
    case 'failed': {
      if (current < 0) return 'Failed before the first step'
      const step = steps[current]
      return `Failed at step ${current + 1} of ${total}: ${stepTitle(step.title, 'failed')}`
    }
    case 'cancelled':
      return current < 0 ? 'Stopped before the first step' : `Stopped at step ${current + 1} of ${total}`
    case 'queued':
      return totalKnown && total > 0 ? `Queued, ${total} steps planned` : 'Queued'
    default: {
      if (current < 0) return `${word}, no steps yet`
      const step = steps[current]
      const stepWord = run.status === 'paused' ? 'paused' : STEP_STATUS_META[step.status].word.toLowerCase()
      return `${of(current + 1)}: ${stepTitle(step.title, step.status)}, ${stepWord}`
    }
  }
}

/** Compute the cells, overflow and label for a run's Step Tape. */
export function computeTape(run: TapeRun, opts: TapeOptions = {}): TapeModel {
  const active = isRunActive(run.status)
  const cells: TapeCell[] = run.steps.map((s, i) => ({
    key: s.id,
    state: s.status,
    wide: isWideStep(s),
    index: i,
    stepId: s.id,
    title: s.title,
  }))
  const planned = Math.max(0, run.plannedSteps ?? 0)
  const totalKnown = run.plannedSteps !== undefined && run.plannedSteps !== null && planned >= run.steps.length && planned > 0
  for (let i = cells.length; i < planned; i++) cells.push({ key: `planned-${i}`, state: 'pending', wide: false, index: i, planned: true })
  if (active && !totalKnown) cells.push({ key: 'next', state: 'pending', wide: false, index: cells.length, next: true })

  const total = cells.length
  const current = currentStepIndex(run.steps, run.status)
  const label = tapeLabel(run, totalKnown ? total : Math.max(total, run.steps.length), totalKnown, current)
  const endCap = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled' ? run.status : undefined

  let leading = 0
  let trailing = 0
  let visible = cells
  const max = Math.max(1, opts.max ?? Infinity)
  const width = (list: readonly TapeCell[]) => list.reduce((n, c) => n + units(c), 0)
  if (width(visible) > max) {
    // 1. Fold finished cells from the start (never the current step) into the leading "+n".
    let start = 0
    while (width(visible.slice(start)) > max && start < current && FINISHED.includes(visible[start].state)) start++
    leading = start
    visible = visible.slice(start)
    // 2. Still too wide: fold not-yet-started cells from the end into a trailing "+n".
    let end = visible.length
    while (end > 1 && width(visible.slice(0, end)) > max && (visible[end - 1].planned || visible[end - 1].next)) end--
    trailing = visible.length - end
    visible = visible.slice(0, end)
  }

  return { cells: visible, leading, trailing, total, totalKnown, endCap, simulated: run.simulated, current, label }
}

/** Completed steps over the total for pill meta: "3/7" (or "3" while the total is unknown). */
export function tapeProgress(run: TapeRun): string {
  const completed = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const planned = run.plannedSteps ?? 0
  const total = Math.max(planned, run.steps.length)
  return planned > 0 ? `${completed}/${total}` : String(completed)
}
