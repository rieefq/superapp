import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { connectDemoRepo, createSession } from '@/core/services/code'
import { createInvestigation } from '@/core/services/research'
import { generateAsset } from '@/core/services/studio'
import { fx } from '@/core/services/testFixtures'
import { useSettingsStore } from '@/core/settings'
import { countLineChanges } from '@/core/sim/code/design'
import { isRunActive, type IntegrationConnection } from '@/core/types'
import { __resetEngineForTests, runEngine } from '../engine'
import { listRunFactories } from '../registry'
import { registerAllFactories } from './index'

const NOW = new Date('2026-11-01T10:00:00Z').getTime()

registerAllFactories()

const connected = (id: string): IntegrationConnection => ({ id, status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, connectedAt: NOW })

/** Simulate a page reload: in-memory engine state is gone, the database stays. */
function reload() {
  __resetEngineForTests()
  runEngine.resumeInterrupted()
}

async function drive(): Promise<void> {
  for (let round = 0; round < 60; round++) {
    await vi.advanceTimersByTimeAsync(20_000)
    const pending = db.filter('approvals', (a) => a.status === 'pending')
    for (const a of pending) runEngine.resolveApproval(a.id, 'approved')
    if (!pending.length && !db.all('runs').some((r) => isRunActive(r.status))) return
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
  db.insert('connections', connected('sandbox'))
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('simulation factories', () => {
  it('registers every script this module owns', () => {
    expect(listRunFactories()).toEqual(
      expect.arrayContaining(['research.investigate', 'research.follow_up', 'code.session', 'code.pull_request', 'workflow.execute', 'studio.generate']),
    )
  })

  it('resumes a research run after a reload without duplicating sources or findings', async () => {
    db.insert('knowledge', fx.knowledge({ id: 'kno_churn', title: 'Churn interviews', content: 'Customers who churned mentioned slow onboarding and unclear invoices.' }))
    const inv = createInvestigation({ question: 'Why do logistics customers churn?' })
    await vi.advanceTimersByTimeAsync(9_000)
    const before = db.get('investigations', inv.id)!.sourceIds.length
    expect(before).toBeGreaterThan(0)
    reload()
    await drive()
    const done = db.get('investigations', inv.id)!
    expect(done.status).toBe('review')
    expect(new Set(done.sourceIds).size).toBe(done.sourceIds.length)
    expect(db.filter('sources', (s) => s.investigationId === inv.id)).toHaveLength(done.sourceIds.length)
    expect(new Set(done.findings.map((f) => f.id)).size).toBe(done.findings.length)
    expect(done.report).toContain('## Key findings')
  })

  it('resumes a coding turn after a reload with a consistent change set', async () => {
    connectDemoRepo()
    const session = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await vi.advanceTimersByTimeAsync(14_000)
    reload()
    await drive()
    const done = db.get('sessions', session.id)!
    expect(done.status).toBe('needs_review')
    expect(done.changes.length).toBeGreaterThanOrEqual(2)
    for (const c of done.changes) expect([c.additions, c.deletions]).toEqual(Object.values(countLineChanges(c.before ?? '', c.after ?? '')))
    expect(done.checks.map((c) => c.status)).toEqual(['passed', 'passed', 'passed'])
  })

  it('adds exactly one version when a studio run is resumed after a reload', async () => {
    const asset = generateAsset({ kind: 'image', prompt: 'Calm harbor at dawn' })
    await vi.advanceTimersByTimeAsync(3_000)
    reload()
    await drive()
    expect(db.get('assets', asset.id)).toMatchObject({ status: 'ready', currentVersion: 0 })
    expect(db.get('assets', asset.id)?.versions).toHaveLength(1)
  })
})
