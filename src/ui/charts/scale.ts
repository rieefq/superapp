/**
 * Chart scale + tick utilities. Pure functions (no React) so they can be unit-tested
 * and reused by every chart.
 */

export interface NiceTicks {
  /** Domain lower bound, expanded to a tick. */
  min: number
  /** Domain upper bound, expanded to a tick. */
  max: number
  step: number
  ticks: number[]
}

/** Round to a "nice" number (1, 2, 2.5, 5 × 10^n). `round` picks nearest; otherwise ceiling. */
export function niceNumber(value: number, round: boolean): number {
  if (value <= 0 || !Number.isFinite(value)) return 1
  const exp = Math.floor(Math.log10(value))
  const f = value / 10 ** exp
  let nf: number
  if (round) nf = f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return nf * 10 ** exp
}

function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0
  const s = step.toString()
  if (s.includes('e-')) return Number(s.split('e-')[1])
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

/**
 * Nice, evenly spaced ticks covering [min, max] with roughly `count` intervals.
 * The returned domain is expanded outward to the nearest ticks.
 *   niceTicks(0, 87) → { min: 0, max: 100, step: 20, ticks: [0, 20, 40, 60, 80, 100] }
 */
export function niceTicks(min: number, max: number, count = 5): NiceTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, step: 1, ticks: [0, 1] }
  if (min > max) [min, max] = [max, min]
  if (min === max) {
    if (min === 0) return { min: 0, max: 1, step: 0.25, ticks: [0, 0.25, 0.5, 0.75, 1] }
    const pad = Math.abs(min) * 0.5
    return niceTicks(min > 0 ? 0 : min - pad, max < 0 ? 0 : max + pad, count)
  }
  const target = Math.max(1, Math.round(count))
  // Pick the 1/2/2.5/5 × 10^n step whose expanded interval count is closest to the target
  // (ties prefer the larger step: fewer, calmer gridlines).
  const exp = Math.floor(Math.log10((max - min) / target))
  let step = niceNumber((max - min) / target, true)
  let best = Infinity
  for (let e = exp - 1; e <= exp + 1; e++) {
    for (const f of [1, 2, 2.5, 5]) {
      const s = f * 10 ** e
      const intervals = Math.round((Math.ceil(max / s - 1e-9) - Math.floor(min / s + 1e-9)))
      const score = Math.abs(intervals - target) - s * 1e-12
      if (score < best) {
        best = score
        step = s
      }
    }
  }
  step = Number(step.toPrecision(12))
  const nMin = Math.floor(min / step + 1e-9) * step
  const nMax = Math.ceil(max / step - 1e-9) * step
  const decimals = decimalsOf(step)
  const ticks: number[] = []
  for (let v = nMin; v <= nMax + step / 2; v += step) ticks.push(Number(v.toFixed(decimals)))
  return { min: ticks[0], max: ticks[ticks.length - 1], step, ticks }
}

export interface LinearScale {
  (value: number): number
  domain: [number, number]
  range: [number, number]
  invert(px: number): number
}

/** Linear map from a data domain to a pixel range. A zero-width domain maps to the range start. */
export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const span = d1 - d0
  const scale = ((v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))) as LinearScale
  scale.domain = domain
  scale.range = range
  scale.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * span)
  return scale
}

/**
 * Axis number formatter, one style per axis (dataviz rule): values print in full under
 * 10,000 (0 / 2,500 / 5,000) and compact once the axis reaches 10,000 (0 / 10K / 20K).
 */
export function axisNumberFormatter(ticks: number[], locale?: string): (v: number) => string {
  const maxAbs = ticks.reduce((m, t) => Math.max(m, Math.abs(t)), 0)
  if (maxAbs >= 10_000) {
    const nf = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
    return (v) => nf.format(v)
  }
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1
  const decimals = Math.min(4, decimalsOf(step))
  const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return (v) => nf.format(v)
}

/** Value formatter for tooltips / labels: full precision-ish, grouped. */
export function formatValue(v: number, locale?: string): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)
}

/* ------------------------------------------------------------------------------------------ */
/* Time ticks                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export type TimeUnit = 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'

export interface TimeTicks {
  ticks: number[]
  unit: TimeUnit
  /** Step in units (e.g. 2 for every other day). */
  every: number
  /** Format a tick for the axis at this granularity. */
  format: (t: number) => string
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** Candidate intervals, smallest first, with approximate durations. */
const INTERVALS: { unit: TimeUnit; every: number; approx: number }[] = [
  { unit: 'minute', every: 1, approx: MIN },
  { unit: 'minute', every: 5, approx: 5 * MIN },
  { unit: 'minute', every: 15, approx: 15 * MIN },
  { unit: 'minute', every: 30, approx: 30 * MIN },
  { unit: 'hour', every: 1, approx: HOUR },
  { unit: 'hour', every: 3, approx: 3 * HOUR },
  { unit: 'hour', every: 6, approx: 6 * HOUR },
  { unit: 'hour', every: 12, approx: 12 * HOUR },
  { unit: 'day', every: 1, approx: DAY },
  { unit: 'day', every: 2, approx: 2 * DAY },
  { unit: 'week', every: 1, approx: 7 * DAY },
  { unit: 'week', every: 2, approx: 14 * DAY },
  { unit: 'month', every: 1, approx: 30.4 * DAY },
  { unit: 'month', every: 3, approx: 91 * DAY },
  { unit: 'month', every: 6, approx: 182 * DAY },
  { unit: 'year', every: 1, approx: 365 * DAY },
]

/** Floor a timestamp to the start of its unit (local time). Weeks start on Monday. */
export function floorTime(t: number, unit: TimeUnit, every = 1): number {
  const d = new Date(t)
  switch (unit) {
    case 'minute':
      d.setSeconds(0, 0)
      d.setMinutes(Math.floor(d.getMinutes() / every) * every)
      break
    case 'hour':
      d.setMinutes(0, 0, 0)
      d.setHours(Math.floor(d.getHours() / every) * every)
      break
    case 'day':
      d.setHours(0, 0, 0, 0)
      break
    case 'week': {
      d.setHours(0, 0, 0, 0)
      const dow = (d.getDay() + 6) % 7 // Monday = 0
      d.setDate(d.getDate() - dow)
      break
    }
    case 'month':
      d.setHours(0, 0, 0, 0)
      d.setDate(1)
      d.setMonth(Math.floor(d.getMonth() / every) * every)
      break
    case 'year':
      d.setHours(0, 0, 0, 0)
      d.setMonth(0, 1)
      break
  }
  return d.getTime()
}

/** Add `n` units in local time (DST-safe for day and larger units). */
export function addTime(t: number, unit: TimeUnit, n: number): number {
  const d = new Date(t)
  switch (unit) {
    case 'minute':
      return t + n * MIN
    case 'hour':
      return t + n * HOUR
    case 'day':
      d.setDate(d.getDate() + n)
      return d.getTime()
    case 'week':
      d.setDate(d.getDate() + 7 * n)
      return d.getTime()
    case 'month':
      d.setMonth(d.getMonth() + n)
      return d.getTime()
    case 'year':
      d.setFullYear(d.getFullYear() + n)
      return d.getTime()
  }
}

function timeFormatter(unit: TimeUnit, start: number, end: number, locale?: string): (t: number) => string {
  const multiYear = new Date(start).getFullYear() !== new Date(end).getFullYear()
  switch (unit) {
    case 'minute':
    case 'hour': {
      const f = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
      const fDay = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' })
      // Midnight ticks name the day so multi-day hour axes stay legible.
      return (t) => {
        const d = new Date(t)
        return d.getHours() === 0 && d.getMinutes() === 0 && end - start > DAY ? fDay.format(d) : f.format(d)
      }
    }
    case 'day':
    case 'week': {
      const f = new Intl.DateTimeFormat(locale, multiYear ? { month: 'short', day: 'numeric', year: '2-digit' } : { month: 'short', day: 'numeric' })
      return (t) => f.format(new Date(t))
    }
    case 'month': {
      const f = new Intl.DateTimeFormat(locale, { month: 'short' })
      const fy = new Intl.DateTimeFormat(locale, { year: 'numeric' })
      return (t) => {
        const d = new Date(t)
        return d.getMonth() === 0 ? fy.format(d) : f.format(d)
      }
    }
    case 'year': {
      const f = new Intl.DateTimeFormat(locale, { year: 'numeric' })
      return (t) => f.format(new Date(t))
    }
  }
}

/**
 * Calendar-aligned ticks for a time axis: the smallest interval (1h, 6h, 1d, 1w, 1mo…) that
 * yields at most `maxTicks` ticks inside [start, end]. Ticks sit on local boundaries
 * (midnight, Monday, the 1st), so labels read naturally.
 */
export function timeTicks(start: number, end: number, maxTicks = 6, locale?: string): TimeTicks {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    const t = Number.isFinite(start) ? start : 0
    return { ticks: [t], unit: 'day', every: 1, format: timeFormatter('day', t, t, locale) }
  }
  const span = end - start
  const limit = Math.max(1, Math.floor(maxTicks))
  let choice = INTERVALS[INTERVALS.length - 1]
  for (const iv of INTERVALS) {
    if (span / iv.approx <= limit) {
      choice = iv
      break
    }
  }
  let every = choice.every
  if (choice.unit === 'year') every = Math.max(1, Math.ceil(span / (365 * DAY) / limit))
  const ticks: number[] = []
  const stepUnit = choice.unit
  let t = floorTime(start, stepUnit, every)
  if (t < start) t = addTime(t, stepUnit, every)
  // Week/day multiples beyond 1 are anchored to the first tick, not to an epoch.
  let guard = 0
  while (t <= end && guard++ < 500) {
    ticks.push(t)
    t = addTime(t, stepUnit, every)
  }
  return { ticks, unit: choice.unit, every, format: timeFormatter(choice.unit, start, end, locale) }
}

/** Index of the item whose value is closest to `target` in a sorted array (binary search). */
export function nearestIndex(sorted: readonly number[], target: number): number {
  if (sorted.length === 0) return -1
  let lo = 0
  let hi = sorted.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] < target) lo = mid + 1
    else hi = mid
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - target) <= Math.abs(sorted[lo] - target)) return lo - 1
  return lo
}

/** Rough text width for SVG layout (no DOM). Mono ≈ 0.6em per char, sans ≈ 0.56em. */
export function approxTextWidth(text: string, fontSize = 11, mono = false): number {
  return text.length * fontSize * (mono ? 0.62 : 0.56)
}
