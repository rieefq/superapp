/** Small numeric helpers for analytics. Pure; never mutate their inputs. */

/**
 * Percentile `p` (0..1) of values sorted ascending, interpolating linearly between the
 * closest ranks (the R-7 / spreadsheet PERCENTILE.INC definition). Null when empty.
 */
export function percentileSorted(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null
  const q = Math.min(1, Math.max(0, p))
  const rank = (sorted.length - 1) * q
  const lo = Math.floor(rank)
  const hi = Math.ceil(rank)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo)
}

/** Percentile `p` (0..1) of unsorted values. Null when empty. */
export function percentile(values: readonly number[], p: number): number | null {
  return percentileSorted([...values].sort((a, b) => a - b), p)
}

/** Median of unsorted values (mean of the middle two for an even count). Null when empty. */
export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5)
}

/** `part / whole`, or null when `whole` is not positive (nothing to compare against). */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null
}

/** Arithmetic mean, or null when empty. */
export function mean(values: readonly number[]): number | null {
  if (!values.length) return null
  let total = 0
  for (const v of values) total += v
  return total / values.length
}
