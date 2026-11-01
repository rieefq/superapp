export const SECOND = 1_000
export const MIN = 60 * SECOND
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

/**
 * Wall-clock helpers relative to `now`, in the viewer's local time zone, so seeded history
 * lands on plausible working hours (weekday mornings, Monday 09:00 digests, 02:00 syncs).
 * Every helper returns a time strictly before today's midnight (or an offset before `now`),
 * so seeded history is always in the past.
 */
export interface Clock {
  now: number
  /** The k-th most recent weekday before today (k ≥ 1), at hh:mm local time. */
  wd(k: number, hh: number, mm?: number): number
  /** k calendar days before today (k ≥ 1), at hh:mm local time. */
  day(k: number, hh: number, mm?: number): number
  /** The most recent `count` occurrences of a weekday (0 = Sunday … 6 = Saturday) before today. */
  last(dow: number, count: number, hh: number, mm?: number): number[]
  /** `minutes` before now. */
  ago(minutes: number): number
}

export function createClock(now: number): Clock {
  const midnight = new Date(now)
  midnight.setHours(0, 0, 0, 0)
  const base = midnight.getTime()

  const at = (daysBack: number, hh: number, mm: number): number => {
    if (daysBack < 1) throw new Error('seed clock: history must be at least one day back')
    const d = new Date(base)
    d.setDate(d.getDate() - daysBack)
    d.setHours(hh, mm, 0, 0)
    return d.getTime()
  }
  const dowOf = (daysBack: number) => new Date(at(daysBack, 12, 0)).getDay()

  const weekdays: number[] = []
  for (let k = 1; weekdays.length < 45; k++) {
    const dow = dowOf(k)
    if (dow !== 0 && dow !== 6) weekdays.push(k)
  }

  return {
    now,
    wd: (k, hh, mm = 0) => {
      const daysBack = weekdays[k - 1]
      if (daysBack === undefined) throw new Error(`seed clock: weekday ${k} is out of range`)
      return at(daysBack, hh, mm)
    },
    day: (k, hh, mm = 0) => at(k, hh, mm),
    last: (dow, count, hh, mm = 0) => {
      const out: number[] = []
      for (let k = 1; out.length < count; k++) if (dowOf(k) === dow) out.push(at(k, hh, mm))
      return out
    },
    ago: (minutes) => now - minutes * MIN,
  }
}
