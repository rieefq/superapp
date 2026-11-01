import { describe, expect, it } from 'vitest'
import { axisNumberFormatter, floorTime, linearScale, nearestIndex, niceNumber, niceTicks, timeTicks } from './scale'
import { foldIntoOther, resolveSeriesColor, seriesColor, SERIES_HUES } from './palette'

describe('niceNumber', () => {
  it('rounds to 1/2/2.5/5 × 10^n', () => {
    expect(niceNumber(87, false)).toBe(100)
    expect(niceNumber(0.32, true)).toBe(0.25)
    expect(niceNumber(4.4, true)).toBe(5)
    expect(niceNumber(1.2, true)).toBe(1)
  })
})

describe('niceTicks', () => {
  it('covers the domain with nice evenly spaced ticks', () => {
    const r = niceTicks(0, 87, 5)
    expect(r.ticks).toEqual([0, 20, 40, 60, 80, 100])
    expect(r.min).toBe(0)
    expect(r.max).toBe(100)
    expect(r.step).toBe(20)
  })

  it('handles fractional ranges without float noise', () => {
    const r = niceTicks(0, 1.3, 5)
    expect(r.ticks).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5])
    for (const t of r.ticks) expect(String(t).length).toBeLessThan(6)
  })

  it('handles negative and mixed-sign domains', () => {
    const r = niceTicks(-42, 57, 4)
    expect(r.min).toBeLessThanOrEqual(-42)
    expect(r.max).toBeGreaterThanOrEqual(57)
    expect(r.ticks).toContain(0)
  })

  it('handles flat and zero domains', () => {
    expect(niceTicks(0, 0).ticks).toEqual([0, 0.25, 0.5, 0.75, 1])
    const flat = niceTicks(40, 40)
    expect(flat.min).toBe(0)
    expect(flat.max).toBeGreaterThanOrEqual(40)
  })

  it('swaps reversed bounds and survives non-finite input', () => {
    expect(niceTicks(10, 0).ticks[0]).toBe(0)
    expect(niceTicks(NaN, 3).ticks).toEqual([0, 1])
  })

  it('produces a sensible count for large ranges', () => {
    const r = niceTicks(0, 1_284_000, 5)
    expect(r.ticks.length).toBeGreaterThanOrEqual(4)
    expect(r.ticks.length).toBeLessThanOrEqual(8)
  })
})

describe('linearScale', () => {
  it('maps and inverts', () => {
    const s = linearScale([0, 100], [200, 0])
    expect(s(0)).toBe(200)
    expect(s(50)).toBe(100)
    expect(s.invert(100)).toBe(50)
  })
  it('degenerate domain maps to range start', () => {
    expect(linearScale([5, 5], [0, 10])(5)).toBe(0)
  })
})

describe('axisNumberFormatter', () => {
  it('prints in full under 10,000', () => {
    const f = axisNumberFormatter([0, 2500, 5000, 7500], 'en-US')
    expect(f(2500)).toBe('2,500')
  })
  it('goes compact once the axis reaches 10,000', () => {
    const f = axisNumberFormatter([0, 10_000, 20_000], 'en-US')
    expect(f(20_000)).toBe('20K')
    expect(f(0)).toBe('0')
  })
  it('keeps the decimals the step needs', () => {
    const f = axisNumberFormatter([0, 0.25, 0.5], 'en-US')
    expect(f(0.5)).toBe('0.50')
  })
})

describe('timeTicks', () => {
  const day = 86_400_000
  const start = new Date(2026, 9, 1, 0, 0).getTime() // Oct 1 2026, local midnight

  it('uses day ticks on local midnights for a one-week span', () => {
    const r = timeTicks(start, start + 6 * day, 7)
    expect(r.unit).toBe('day')
    expect(r.ticks).toHaveLength(7)
    for (const t of r.ticks) {
      const d = new Date(t)
      expect(d.getHours()).toBe(0)
      expect(d.getMinutes()).toBe(0)
    }
  })

  it('switches to week ticks (Mondays) for a month', () => {
    const r = timeTicks(start, start + 30 * day, 6)
    expect(r.unit).toBe('week')
    for (const t of r.ticks) expect(new Date(t).getDay()).toBe(1)
    expect(r.ticks.length).toBeLessThanOrEqual(6)
  })

  it('switches to month ticks for a year and labels January with the year', () => {
    const r = timeTicks(new Date(2025, 10, 15).getTime(), new Date(2026, 10, 15).getTime(), 6, 'en-US')
    expect(r.unit).toBe('month')
    for (const t of r.ticks) expect(new Date(t).getDate()).toBe(1)
    const jan = r.ticks.find((t) => new Date(t).getMonth() === 0)
    if (jan) expect(r.format(jan)).toBe('2026')
  })

  it('uses hour ticks within a day', () => {
    const r = timeTicks(start + 3_600_000 * 2.5, start + 3_600_000 * 20, 6)
    expect(r.unit).toBe('hour')
    for (const t of r.ticks) expect(new Date(t).getMinutes()).toBe(0)
    expect(r.ticks[0]).toBeGreaterThanOrEqual(start + 3_600_000 * 2.5)
  })

  it('never exceeds maxTicks and stays inside the domain', () => {
    for (const span of [3, 9, 45, 120, 400, 2000]) {
      const end = start + span * day
      const r = timeTicks(start, end, 5)
      expect(r.ticks.length).toBeLessThanOrEqual(6)
      for (const t of r.ticks) {
        expect(t).toBeGreaterThanOrEqual(start)
        expect(t).toBeLessThanOrEqual(end)
      }
    }
  })

  it('degrades gracefully for an empty span', () => {
    expect(timeTicks(start, start).ticks).toEqual([start])
  })
})

describe('floorTime', () => {
  it('floors weeks to Monday', () => {
    const sat = new Date(2026, 9, 31, 15).getTime()
    expect(new Date(floorTime(sat, 'week')).getDay()).toBe(1)
  })
})

describe('nearestIndex', () => {
  it('finds the closest sorted value', () => {
    expect(nearestIndex([0, 10, 20, 30], 14)).toBe(1)
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2)
    expect(nearestIndex([0, 10, 20, 30], -5)).toBe(0)
    expect(nearestIndex([0, 10, 20, 30], 99)).toBe(3)
    expect(nearestIndex([], 1)).toBe(-1)
  })
})

describe('palette', () => {
  it('assigns slots in the validated fixed order and never cycles', () => {
    expect(SERIES_HUES).toEqual(['rose', 'volt', 'sky', 'coral', 'cyan', 'amber', 'violet', 'mint'])
    expect(seriesColor(0)).toBe('var(--hue-rose)')
    expect(seriesColor(8)).toBe('var(--ink-4)')
  })
  it('lets an entity hue override the slot', () => {
    expect(resolveSeriesColor({ hue: 'sky', colorIndex: 4 }, 0)).toBe('var(--hue-sky)')
    expect(resolveSeriesColor({}, 2)).toBe('var(--hue-sky)')
  })
  it('folds the tail into Other', () => {
    const items = [5, 9, 1, 7, 3, 2, 8, 4].map((v, i) => ({ label: `s${i}`, value: v }))
    const { items: out, folded } = foldIntoOther(items, 6, (_rest, total) => ({ label: "Other", value: total }))
    expect(out).toHaveLength(6)
    expect(out[0].value).toBe(9)
    expect(out[5]).toEqual({ label: 'Other', value: 1 + 2 + 3 })
    expect(folded).toHaveLength(3)
  })
  it('does not fold when within the cap', () => {
    const items = [1, 2, 3].map((v) => ({ label: String(v), value: v }))
    expect(foldIntoOther(items, 6, () => ({ label: 'Other', value: 0 })).items.map((i) => i.value)).toEqual([3, 2, 1])
  })
})
