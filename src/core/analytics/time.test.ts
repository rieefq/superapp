import { describe, expect, it } from 'vitest'
import { at, HOUR, MIN, useTimeZone } from './fixtures.test-utils'
import {
  addLocalDays, dayIndex, localDaysBetween, localHour, localWeekday, minuteCeil, minuteFloor, startOfLocalDay,
  startOfLocalMonth, startOfNextLocalMonth,
} from './time'

// New York observes DST: 2026-03-08 has 23 hours, 2026-11-01 has 25 hours.
useTimeZone('America/New_York')

describe('local day boundaries (DST-safe)', () => {
  it('finds local midnight on either side of the spring-forward gap', () => {
    expect(startOfLocalDay(at('2026-03-08T12:00:00-04:00'))).toBe(at('2026-03-08T00:00:00-05:00'))
    expect(startOfLocalDay(at('2026-03-09T00:30:00-04:00'))).toBe(at('2026-03-09T00:00:00-04:00'))
    expect(startOfLocalDay(at('2026-03-08T23:59:00-04:00'))).toBe(at('2026-03-08T00:00:00-05:00'))
  })

  it('steps by calendar days, not 24h: 23h and 25h days', () => {
    const mar8 = at('2026-03-08T00:00:00-05:00')
    expect(addLocalDays(mar8, 1) - mar8).toBe(23 * HOUR)
    const nov1 = at('2026-11-01T00:00:00-04:00')
    expect(addLocalDays(nov1, 1) - nov1).toBe(25 * HOUR)
    expect(addLocalDays(at('2026-11-02T09:00:00-05:00'), -1)).toBe(nov1)
  })

  it('lists every local midnight between two instants, inclusive', () => {
    const days = localDaysBetween(at('2026-03-06T15:00:00-05:00'), at('2026-03-10T08:00:00-04:00'))
    expect(days).toHaveLength(5)
    expect(days.map((d) => new Date(d).getDate())).toEqual([6, 7, 8, 9, 10])
    for (const d of days) expect([new Date(d).getHours(), new Date(d).getMinutes()]).toEqual([0, 0])
    expect(localDaysBetween(at('2026-03-10T08:00:00-04:00'), at('2026-03-06T15:00:00-05:00'))).toEqual([])
    expect(localDaysBetween(at('2026-03-10T08:00:00-04:00'), at('2026-03-10T09:00:00-04:00'))).toHaveLength(1)
  })

  it('locates the bucket of an instant by binary search', () => {
    const days = localDaysBetween(at('2026-10-30T12:00:00-04:00'), at('2026-11-03T12:00:00-05:00'))
    expect(days).toHaveLength(5)
    expect(dayIndex(days, at('2026-10-29T23:59:00-04:00'))).toBe(-1)
    expect(dayIndex(days, days[0])).toBe(0)
    // 23:30 EST on Nov 1 is still Nov 1, although it is 24.5h after Nov 1's midnight.
    expect(dayIndex(days, at('2026-11-01T23:30:00-05:00'))).toBe(2)
    expect(dayIndex(days, at('2026-11-02T00:15:00-05:00'))).toBe(3)
    expect(dayIndex(days, at('2026-11-09T00:00:00-05:00'))).toBe(4)
    expect(dayIndex([], 0)).toBe(-1)
  })
})

describe('weekday, hour and month', () => {
  it('numbers weekdays from Monday and reads local hours', () => {
    expect(localWeekday(at('2026-11-02T09:00:00-05:00'))).toBe(0) // Monday
    expect(localWeekday(at('2026-11-01T23:30:00-05:00'))).toBe(6) // Sunday
    expect(localHour(at('2026-11-01T01:30:00-04:00'))).toBe(1) // first 01:30 (EDT)
    expect(localHour(at('2026-11-01T01:30:00-05:00'))).toBe(1) // repeated 01:30 (EST)
  })

  it('finds local month boundaries', () => {
    const now = at('2026-11-15T12:00:00-05:00')
    expect(startOfLocalMonth(now)).toBe(at('2026-11-01T00:00:00-04:00'))
    expect(startOfNextLocalMonth(now)).toBe(at('2026-12-01T00:00:00-05:00'))
    expect(startOfNextLocalMonth(at('2026-12-31T23:00:00-05:00'))).toBe(at('2027-01-01T00:00:00-05:00'))
  })

  it('floors and ceils to the minute', () => {
    const t = at('2026-11-15T12:34:56.789Z')
    expect(minuteFloor(t)).toBe(at('2026-11-15T12:34:00Z'))
    expect(minuteCeil(t)).toBe(at('2026-11-15T12:34:00Z') + MIN - 1)
    expect(minuteFloor(minuteCeil(t))).toBe(minuteFloor(t))
  })
})
