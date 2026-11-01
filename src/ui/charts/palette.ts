import type { Hue } from '@/core/types'

/**
 * Categorical series order (dataviz six-checks). Validated with
 * `validate_palette.js` against the identity-hue tokens on both chart surfaces
 * (dark #181817, light #fdfdfb): the mandated order (sky, coral, mint, …) failed the
 * adjacent CVD and normal-vision gates; this order is the best of all 40,320
 * permutations — worst adjacent CVD ΔE 11.2 dark / 8.7 light, normal-vision 15.1 / 15.3.
 * Mint (≈ done) and coral (≈ fail) are kept out of the leading slots so single- and
 * two-series charts never read as status. Never cycle: a 9th series folds into "Other".
 */
export const SERIES_HUES: readonly Hue[] = ['rose', 'volt', 'sky', 'coral', 'cyan', 'amber', 'violet', 'mint']

export const MAX_SERIES = SERIES_HUES.length

/** De-emphasis / "Other" color — never a hue. */
export const OTHER_COLOR = 'var(--ink-4)'

/** Surface the chart sits on (for 2px rings and ramp mixing). Set by the chart frame. */
export const CHART_SURFACE = 'var(--chart-surface, var(--surface-canvas))'

export function hueColor(hue: Hue): string {
  return `var(--hue-${hue})`
}

/** Color for categorical slot `index` (0-based). Out-of-range slots get the "Other" gray. */
export function seriesColor(index: number): string {
  const hue = SERIES_HUES[index]
  return hue ? hueColor(hue) : OTHER_COLOR
}

export interface SeriesColorSpec {
  /** Categorical slot in SERIES_HUES (0-based). */
  colorIndex?: number
  /** Follow an entity's identity hue instead (color follows the entity, not its rank). */
  hue?: Hue
}

/** Resolve a series color: explicit hue → slot → fallback slot (its position). */
export function resolveSeriesColor(spec: SeriesColorSpec, fallbackIndex: number): string {
  if (spec.hue) return hueColor(spec.hue)
  return seriesColor(spec.colorIndex ?? fallbackIndex)
}

/**
 * Sequential ramp (magnitude): one hue — the accent — mixed with the chart surface,
 * light → dark in light mode and dim → bright in dark mode (the anchor flips with the
 * surface, so "more" always means "more contrast"). `t` in [0, 1].
 */
export function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const pct = Math.round(14 + clamped * 86)
  return `color-mix(in oklab, var(--accent) ${pct}%, ${CHART_SURFACE})`
}

/** Fill for an empty / zero heat cell: a whisper off the surface. */
export const RAMP_EMPTY = `color-mix(in oklab, var(--ink) 6%, ${CHART_SURFACE})`

export interface FoldItem {
  label: string
  value: number
}

/**
 * Keep the largest items (by value, stable) and fold the tail into one "Other" item so the
 * result has at most `max` entries, in descending order with "Other" last. (When folding
 * happens at least two items fold — an "Other" of one would just be a worse label.)
 */
export function foldIntoOther<T extends FoldItem>(
  items: readonly T[],
  max: number,
  makeOther: (rest: T[], total: number) => T,
): { items: T[]; folded: T[] } {
  const sorted = [...items].sort((a, b) => b.value - a.value)
  if (sorted.length <= max) return { items: sorted, folded: [] }
  const keep = sorted.slice(0, Math.max(0, max - 1))
  const rest = sorted.slice(Math.max(0, max - 1))
  const total = rest.reduce((s, r) => s + r.value, 0)
  return { items: [...keep, makeOther(rest, total)], folded: rest }
}
