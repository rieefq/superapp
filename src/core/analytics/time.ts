import { TIME } from '@/lib/format'

/**
 * Local-calendar helpers for analytics bucketing. Every function is pure and takes the
 * instant it works on. Day and month boundaries are computed with calendar arithmetic
 * (`new Date(y, m, d + n)`), never by adding 24h, so 23h and 25h DST days bucket correctly.
 */

/** Local midnight at the start of the calendar day containing `ts`. */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Start of the local calendar day `n` days after (or before, when negative) the day containing `ts`. */
export function addLocalDays(ts: number, n: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime()
}

/** Start of every local calendar day from the day of `from` through the day of `to` (inclusive). */
export function localDaysBetween(from: number, to: number): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return []
  const first = new Date(from)
  const y = first.getFullYear()
  const m = first.getMonth()
  const d = first.getDate()
  const last = startOfLocalDay(to)
  const days: number[] = []
  for (let i = 0; ; i++) {
    const day = new Date(y, m, d + i).getTime()
    if (day > last) break
    days.push(day)
  }
  return days
}

/**
 * Start of the local clock hour containing `ts`. Computed from the absolute instant (minus the
 * local minutes and seconds), so both occurrences of a repeated hour on a 25h day keep their own
 * start and a skipped hour never appears.
 */
export function startOfLocalHour(ts: number): number {
  const d = new Date(ts)
  return ts - (d.getMinutes() * TIME.MINUTE + d.getSeconds() * 1000 + d.getMilliseconds())
}

/** Start of every local clock hour from the hour of `from` through the hour of `to` (inclusive). */
export function localHoursBetween(from: number, to: number): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return []
  const last = startOfLocalHour(to)
  const hours: number[] = []
  for (let t = startOfLocalHour(from); t <= last; ) {
    hours.push(t)
    // One hour of absolute time, snapped to the local hour start (30-minute offset shifts snap back).
    const next = startOfLocalHour(t + TIME.HOUR)
    t = next > t ? next : t + TIME.HOUR
  }
  return hours
}

/** Index of the bucket containing `ts` in ascending day starts (largest start ≤ ts); -1 before the first. */
export function dayIndex(days: readonly number[], ts: number): number {
  let lo = 0
  let hi = days.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (days[mid] <= ts) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found
}

/** Local weekday with Monday first: 0 = Monday … 6 = Sunday. */
export function localWeekday(ts: number): number {
  return (new Date(ts).getDay() + 6) % 7
}

/** Local hour of day, 0–23. */
export function localHour(ts: number): number {
  return new Date(ts).getHours()
}

/** Local midnight on the first day of the month containing `ts`. */
export function startOfLocalMonth(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** Local midnight on the first day of the month after the one containing `ts` (exclusive month end). */
export function startOfNextLocalMonth(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
}

/** Start of the minute containing `ts`. */
export function minuteFloor(ts: number): number {
  return Math.floor(ts / TIME.MINUTE) * TIME.MINUTE
}

/** Last millisecond of the minute containing `ts`, so everything that happened this minute is "before now". */
export function minuteCeil(ts: number): number {
  return minuteFloor(ts) + TIME.MINUTE - 1
}
