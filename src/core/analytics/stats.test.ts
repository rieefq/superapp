import { describe, expect, it } from 'vitest'
import { mean, median, percentile, percentileSorted, ratio } from './stats'

describe('stats', () => {
  it('interpolates percentiles between closest ranks', () => {
    expect(percentile([40, 10, 30, 20], 0.5)).toBe(25)
    expect(percentile([10, 20, 30, 40], 0.9)).toBeCloseTo(37)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1)
    expect(percentile([7], 0.9)).toBe(7)
    expect(percentileSorted([1, 2, 3], 0)).toBe(1)
    expect(percentileSorted([1, 2, 3], 1)).toBe(3)
    expect(percentileSorted([1, 2, 3], 5)).toBe(3) // clamped
    expect(percentile([], 0.5)).toBeNull()
  })

  it('computes medians without mutating the input', () => {
    const values = [3, 1, 2]
    expect(median(values)).toBe(2)
    expect(values).toEqual([3, 1, 2])
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('returns null ratios and means when there is nothing to divide by', () => {
    expect(ratio(3, 4)).toBe(0.75)
    expect(ratio(0, 0)).toBeNull()
    expect(mean([1, 2, 6])).toBe(3)
    expect(mean([])).toBeNull()
  })
})
