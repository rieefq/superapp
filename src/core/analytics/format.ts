import { formatDuration, formatPercent, pluralize } from '@/lib/format'
import type { HomeSummary } from './home'
import type { InsightsDay } from './insights'

/**
 * Presentation helpers for analytics. Deltas match the UI kit's `StatDelta`
 * ({ value, direction }): `value` is unsigned because the Stat glyph draws the sign.
 */

export type Direction = 'up' | 'down' | 'flat'

export interface Delta {
  /** Unsigned magnitude for a Stat delta: "12%", "4.5 pts", "$1.20", "3×", "New". */
  value: string
  direction: Direction
  /** Signed text for plain-text contexts: "+12%", "−4.5 pts", "New", "No change". */
  label: string
}

const MINUS = '−'
const FLAT_LABEL = 'No change'

const trimZero = (s: string) => s.replace(/\.0$/, '')
const isNum = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n)

function signed(direction: Direction, value: string): Delta {
  if (direction === 'flat') return { value, direction, label: FLAT_LABEL }
  return { value, direction, label: `${direction === 'up' ? '+' : MINUS}${value}` }
}

/** Relative change (0.25 = +25%). Null without a usable baseline (missing, or 0 while current is not). */
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (!isNum(current) || !isNum(previous)) return null
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / Math.abs(previous)
}

/**
 * Percent delta between two counts or amounts: "12%" up, "4.2%" down, "3×" for ten-fold-plus
 * growth, "New" when the previous period had none. Changes under 0.5% are flat. Null when
 * either side is missing.
 */
export function percentDelta(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (!isNum(current) || !isNum(previous)) return null
  if (previous === 0) {
    if (current === 0) return signed('flat', '0%')
    return { value: 'New', direction: current > 0 ? 'up' : 'down', label: 'New' }
  }
  const change = (current - previous) / Math.abs(previous)
  if (Math.abs(change) < 0.005) return signed('flat', '0%')
  const direction: Direction = change > 0 ? 'up' : 'down'
  if (previous > 0 && current / previous >= 10) return signed(direction, `${Math.round(current / previous)}×`)
  const pct = Math.abs(change) * 100
  return signed(direction, `${pct < 10 ? trimZero(pct.toFixed(1)) : Math.round(pct)}%`)
}

/** Delta between two rates (0..1) in percentage points: "4.5 pts". Changes under 0.05 pts are flat. */
export function pointsDelta(current: number | null | undefined, previous: number | null | undefined): Delta | null {
  if (!isNum(current) || !isNum(previous)) return null
  const points = Math.round((current - previous) * 1000) / 10
  if (points === 0) return signed('flat', '0 pts')
  const abs = Math.abs(points)
  return signed(points > 0 ? 'up' : 'down', `${abs < 10 ? trimZero(abs.toFixed(1)) : Math.round(abs)} pts`)
}

/** Absolute delta shown with a formatter, e.g. `absoluteDelta(cost, prevCost, formatUsd)` → "$1.20". */
export function absoluteDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
  format: (n: number) => string,
  epsilon = 0,
): Delta | null {
  if (!isNum(current) || !isNum(previous)) return null
  const diff = current - previous
  if (Math.abs(diff) <= epsilon) return signed('flat', format(0))
  return signed(diff > 0 ? 'up' : 'down', format(Math.abs(diff)))
}

/** The span a range covers: "24 hours" for one day, otherwise "7 days". */
function rangeSpan(rangeDays: number): string {
  return rangeDays === 1 ? '24 hours' : pluralize(rangeDays, 'day')
}

/** "Last 7 days", "Last 24 hours". */
export function rangeLabel(rangeDays: number): string {
  return `Last ${rangeSpan(rangeDays)}`
}

/** "vs previous 7 days" — the period a delta compares against ("vs previous 24 hours" for one day). */
export function comparisonLabel(rangeDays: number): string {
  return `vs previous ${rangeSpan(rangeDays)}`
}

/** Short range token for controls and URLs: "24h", "7d", "30d", "90d". */
export function rangeToken(rangeDays: number): string {
  return rangeDays === 1 ? '24h' : `${rangeDays}d`
}

/** Parse "24h" / "7d" / "30" into days; null when unrecognized. */
export function parseRangeToken(token: string | null | undefined): number | null {
  if (!token) return null
  const m = /^(\d+)\s*(h|d)?$/i.exec(token.trim())
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return null
  if (m[2]?.toLowerCase() === 'h') return n === 24 ? 1 : null
  return n
}

/** A 0..1 rate as a percentage ("87%", "99.5%", "4.2%"), or an em dash when there is no rate. */
export function formatRate(rate: number | null | undefined): string {
  if (!isNum(rate)) return '—'
  const fine = (rate > 0 && rate < 0.1) || (rate > 0.99 && rate < 1)
  return formatPercent(rate, fine ? 1 : 0)
}

/** A duration, or an em dash when there is none. */
export function formatMaybeDuration(ms: number | null | undefined): string {
  return isNum(ms) ? formatDuration(ms) : '—'
}

// ---------------------------------------------------------------- chart adapters

/** `heatmap[weekday][hour]` → cells for the weekday-hour Heatmap (0 = Monday). */
export function heatmapCells(heatmap: readonly (readonly number[])[]): { day: number; hour: number; value: number }[] {
  const cells: { day: number; hour: number; value: number }[] = []
  heatmap.forEach((hours, day) => hours.forEach((value, hour) => cells.push({ day, hour, value })))
  return cells
}

/** One time-series point per day: `dailyPoints(insights.daily, (d) => d.costUsd)`. */
export function dailyPoints(daily: readonly InsightsDay[], pick: (day: InsightsDay) => number): { t: number; v: number }[] {
  return daily.map((d) => ({ t: d.day, v: pick(d) }))
}

// ---------------------------------------------------------------- home sentence

export interface HomePhrase {
  key: 'working' | 'waitingOnYou' | 'overdue' | 'dueToday'
  count: number
  text: string
}

/**
 * Non-zero parts of Home's state sentence, in reading order:
 * "2 agents working · 1 approval waiting on you · 1 task overdue · 3 tasks due today".
 * Empty when there is nothing to report.
 */
export function homeSummaryPhrases(s: HomeSummary): HomePhrase[] {
  const parts: HomePhrase[] = [
    { key: 'working', count: s.working, text: `${pluralize(s.working, 'agent')} working` },
    { key: 'waitingOnYou', count: s.waitingOnYou, text: `${pluralize(s.waitingOnYou, 'approval')} waiting on you` },
    { key: 'overdue', count: s.overdue, text: `${pluralize(s.overdue, 'task')} overdue` },
    { key: 'dueToday', count: s.dueToday, text: `${pluralize(s.dueToday, 'task')} due today` },
  ]
  return parts.filter((p) => p.count > 0)
}
