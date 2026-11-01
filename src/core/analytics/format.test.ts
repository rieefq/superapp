import { describe, expect, it } from 'vitest'
import { formatUsd } from '@/lib/format'
import {
  absoluteDelta, comparisonLabel, dailyPoints, formatMaybeDuration, formatRate, heatmapCells, homeSummaryPhrases,
  percentChange, percentDelta, pointsDelta, rangeLabel,
} from './format'
import type { InsightsDay } from './insights'

describe('percent deltas', () => {
  it('computes relative change with a usable baseline only', () => {
    expect(percentChange(12, 10)).toBeCloseTo(0.2)
    expect(percentChange(8, 10)).toBeCloseTo(-0.2)
    expect(percentChange(0, 0)).toBe(0)
    expect(percentChange(5, 0)).toBeNull()
    expect(percentChange(null, 3)).toBeNull()
    expect(percentChange(3, undefined)).toBeNull()
  })

  it('formats unsigned values for Stat deltas and signed labels for text', () => {
    expect(percentDelta(12, 10)).toEqual({ value: '20%', direction: 'up', label: '+20%' })
    expect(percentDelta(9.6, 10)).toEqual({ value: '4%', direction: 'down', label: '−4%' })
    expect(percentDelta(10.45, 10)).toEqual({ value: '4.5%', direction: 'up', label: '+4.5%' })
    expect(percentDelta(10.04, 10)).toEqual({ value: '0%', direction: 'flat', label: 'No change' })
    expect(percentDelta(0, 0)).toEqual({ value: '0%', direction: 'flat', label: 'No change' })
    expect(percentDelta(5, 0)).toEqual({ value: 'New', direction: 'up', label: 'New' })
    expect(percentDelta(120, 10)).toEqual({ value: '12×', direction: 'up', label: '+12×' })
    expect(percentDelta(0, 10)).toEqual({ value: '100%', direction: 'down', label: '−100%' })
    expect(percentDelta(null, 10)).toBeNull()
  })

  it('compares rates in percentage points', () => {
    expect(pointsDelta(0.9, 0.855)).toEqual({ value: '4.5 pts', direction: 'up', label: '+4.5 pts' })
    expect(pointsDelta(0.5, 0.62)).toEqual({ value: '12 pts', direction: 'down', label: '−12 pts' })
    expect(pointsDelta(0.5, 0.5004)).toEqual({ value: '0 pts', direction: 'flat', label: 'No change' })
    expect(pointsDelta(null, 0.5)).toBeNull()
    expect(pointsDelta(0.5, null)).toBeNull()
  })

  it('formats absolute deltas with any formatter', () => {
    expect(absoluteDelta(3.5, 2.3, formatUsd)).toEqual({ value: '$1.20', direction: 'up', label: '+$1.20' })
    expect(absoluteDelta(2, 2, formatUsd)).toEqual({ value: '$0.00', direction: 'flat', label: 'No change' })
    expect(absoluteDelta(1000, 1600, (ms) => `${ms / 1000}s`, 50)?.label).toBe('−0.6s')
    expect(absoluteDelta(1000, 1040, (ms) => `${ms}ms`, 50)?.direction).toBe('flat')
  })
})

describe('labels', () => {
  it('names ranges and comparisons', () => {
    expect(rangeLabel(7)).toBe('Last 7 days')
    expect(comparisonLabel(30)).toBe('vs previous 30 days')
  })

  it('formats rates and optional durations', () => {
    expect(formatRate(null)).toBe('—')
    expect(formatRate(0.87)).toBe('87%')
    expect(formatRate(0.995)).toBe('99.5%')
    expect(formatRate(0.042)).toBe('4.2%')
    expect(formatRate(1)).toBe('100%')
    expect(formatRate(0)).toBe('0%')
    expect(formatMaybeDuration(null)).toBe('—')
    expect(formatMaybeDuration(75_000)).toBe('1m 15s')
  })
})

describe('chart adapters', () => {
  it('flattens the heatmap into weekday-hour cells', () => {
    const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0))
    heatmap[0][9] = 3
    heatmap[6][23] = 1
    const cells = heatmapCells(heatmap)
    expect(cells).toHaveLength(168)
    expect(cells.find((c) => c.day === 0 && c.hour === 9)?.value).toBe(3)
    expect(cells.find((c) => c.day === 6 && c.hour === 23)?.value).toBe(1)
    expect(cells.reduce((n, c) => n + c.value, 0)).toBe(4)
  })

  it('maps daily buckets to time points', () => {
    const day = (d: number, costUsd: number): InsightsDay => ({
      day: d, partial: false, byKind: { chat: 0, code: 0, agent: 0, research: 0, workflow: 0, studio: 0 },
      runs: 0, succeeded: 0, failed: 0, costUsd, tokens: 0,
    })
    expect(dailyPoints([day(1, 0.5), day(2, 1.25)], (d) => d.costUsd)).toEqual([{ t: 1, v: 0.5 }, { t: 2, v: 1.25 }])
  })
})

describe('homeSummaryPhrases', () => {
  it('lists non-zero parts in reading order with plurals', () => {
    expect(homeSummaryPhrases({ working: 0, waitingOnYou: 0, dueToday: 0, overdue: 0, activeRuns: 0 })).toEqual([])
    expect(homeSummaryPhrases({ working: 2, waitingOnYou: 1, dueToday: 3, overdue: 1, activeRuns: 4 }).map((p) => p.text)).toEqual([
      '2 agents working', '1 approval waiting on you', '1 task overdue', '3 tasks due today',
    ])
    expect(homeSummaryPhrases({ working: 1, waitingOnYou: 0, dueToday: 0, overdue: 0, activeRuns: 1 })).toEqual([
      { key: 'working', count: 1, text: '1 agent working' },
    ])
  })
})
