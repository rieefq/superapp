import type { Hue } from '@/core/types'

/**
 * Categorical series order (dataviz six-checks). Series are drawn with the `--series-*`
 * tokens: the identity hue families stepped to mid lightness and higher chroma for data
 * marks (identity hues themselves are tuned for text and fail the lightness/chroma gates
 * as fills). Validated with `validate_palette.js` in this order on both chart surfaces —
 * ALL CHECKS PASS: dark (#181817) worst adjacent CVD ΔE 12.9, normal-vision 21.0;
 * light (#fdfdfb) worst adjacent CVD ΔE 11.3, normal-vision 20.6; contrast ≥ 3:1.
 * Mint (≈ done) and coral (≈ fail) are kept out of the leading slots so single- and
 * two-series charts never read as status. Never cycle: a 9th series folds into "Other".
 */
export const SERIES_HUES: readonly Hue[] = ['rose', 'volt', 'sky', 'coral', 'cyan', 'amber', 'violet', 'mint']

export const MAX_SERIES = SERIES_HUES.length

/** De-emphasis / "Other" color — never a hue. */
export const OTHER_COLOR = 'var(--ink-4)'

/** Surface the chart sits on (for 2px rings and ramp mixing). Set by the chart frame. */
export const CHART_SURFACE = 'var(--chart-surface, var(--surface-canvas))'

/** Data-mark fill for a hue family (series token, not the identity text hue). */
export function hueColor(hue: Hue): string {
  return `var(--series-${hue})`
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
  const pct = Math.round(24 + clamped * 76)
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
