import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { DEFAULT_SETTINGS, updateSettings, useSettingsStore } from '@/core/settings'
import { at, cost, finished, useTimeZone } from './fixtures.test-utils'
import { BUDGET_UPDATE_TITLE, checkBudgetUpdate, monthSpend, shouldPostBudgetUpdate } from './budget'

useTimeZone('UTC')

const NOW = at('2026-06-20T12:00:00Z')

describe('monthSpend', () => {
  it('counts live spend, and simulated estimates only when asked', () => {
    const runs = [
      finished({ id: 'live', start: at('2026-06-02T10:00:00Z'), simulated: false, usage: cost(30) }),
      finished({ id: 'sim', start: at('2026-06-05T10:00:00Z'), simulated: true, usage: cost(12) }),
      finished({ id: 'may', start: at('2026-05-31T23:00:00Z'), simulated: false, usage: cost(100) }),
    ]
    expect(monthSpend(runs, NOW, false)).toEqual({ liveUsd: 30, simulatedUsd: 12, countedUsd: 30 })
    expect(monthSpend(runs, NOW, true).countedUsd).toBe(42)
  })
})

describe('shouldPostBudgetUpdate', () => {
  it('posts once per month, only at or above 80% of a set budget', () => {
    expect(shouldPostBudgetUpdate(39.99, 50, [], NOW)).toBe(false)
    expect(shouldPostBudgetUpdate(40, 50, [], NOW)).toBe(true)
    expect(shouldPostBudgetUpdate(40, 0, [], NOW)).toBe(false)
    const thisMonth = { kind: 'system' as const, title: BUDGET_UPDATE_TITLE, createdAt: at('2026-06-10T00:00:00Z') }
    const lastMonth = { ...thisMonth, createdAt: at('2026-05-28T00:00:00Z') }
    expect(shouldPostBudgetUpdate(45, 50, [thisMonth], NOW)).toBe(false)
    expect(shouldPostBudgetUpdate(45, 50, [lastMonth], NOW)).toBe(true)
  })
})

describe('checkBudgetUpdate', () => {
  beforeEach(() => {
    db.replaceAll(emptyTables())
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
  })
  afterEach(() => {
    db.replaceAll(emptyTables())
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS })
  })

  it('posts one quiet Update when live spend crosses 80%, and never twice in a month', () => {
    updateSettings('safety', { monthlyBudgetUsd: 50, countSimulatedSpend: false })
    db.insert('runs', finished({ id: 'run_sim', start: at('2026-06-03T10:00:00Z'), simulated: true, usage: cost(45) }))
    expect(checkBudgetUpdate(NOW)).toBe(false) // estimates do not count by default
    db.insert('runs', finished({ id: 'run_live', start: at('2026-06-04T10:00:00Z'), simulated: false, usage: cost(41) }))
    expect(checkBudgetUpdate(NOW)).toBe(true)
    const posted = db.all('notifications')
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ kind: 'system', title: BUDGET_UPDATE_TITLE, tone: 'warning' })
    expect(posted[0].body).toMatch(/\$41\.00 of \$50\.00 this month \(82%\)/)
    expect(checkBudgetUpdate(NOW)).toBe(false)
    expect(db.all('notifications')).toHaveLength(1)
  })
})
