import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { __resetEngineForTests, runEngine } from '@/core/runs/engine'
import { planFollowUp, planInvestigation, registerResearchFactories } from '@/core/runs/factories/research'
import { useSettingsStore } from '@/core/settings'
import type { Investigation } from '@/core/types'
import { createRng } from '@/lib/rng'
import { fx } from './testFixtures'
import {
  addFinding, addSource, askFollowUp, completeInvestigation, createInvestigation, deleteInvestigation, discardSource, removeFinding,
  restoreSource, saveReportToKnowledge, togglePinFinding, updateReport,
} from './research'

const NOW = new Date('2026-11-01T10:00:00Z').getTime()

registerResearchFactories()

function seedKnowledge() {
  db.insert('collections', { id: 'col_research', name: 'Research', hue: 'violet', icon: 'Telescope', createdAt: NOW })
  db.insert('agents', fx.agent({ id: 'agt_scout', name: 'Scout' }))
  db.insert('knowledge', fx.knowledge({
    id: 'kno_churn',
    title: 'Churn interview synthesis (6 customers)',
    content: 'Customers who churned mentioned slow onboarding and unclear invoices. Support response times mattered less than expected. Logistics teams want shipment visibility in one place.',
  }))
  db.insert('knowledge', fx.knowledge({
    id: 'kno_glossary',
    title: 'Atlas glossary',
    content: 'Churn: a customer who does not renew. Seat: one named user of the portal.',
  }))
}

function finish() {
  vi.advanceTimersByTime(10 * 60_000)
}

function inv(id: string): Investigation {
  const row = db.get('investigations', id)
  if (!row) throw new Error(`missing investigation ${id}`)
  return row
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
  seedKnowledge()
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('createInvestigation', () => {
  it('derives a title, standard depth and 3–4 angles, and starts a research run as Scout', () => {
    db.insert('threads', fx.thread())
    db.insert('messages', fx.message({ id: 'msg_q' }))
    const created = createInvestigation({ question: 'Why do logistics customers churn?', projectId: null, origin: { kind: 'message', id: 'msg_q' } })
    expect(created.title).toBe('Why do logistics customers churn')
    expect(created.depth).toBe('standard')
    expect(created.angles.length).toBeGreaterThanOrEqual(3)
    expect(created.angles.length).toBeLessThanOrEqual(4)
    expect(created.status).toBe('running')
    expect(created.runIds).toHaveLength(1)
    const run = db.get('runs', created.runIds[0])
    expect(run).toMatchObject({ kind: 'research', agentId: 'agt_scout', origin: { kind: 'investigation', id: created.id }, simulated: true })
    expect(db.get('messages', 'msg_q')?.derived).toEqual([{ kind: 'investigation', id: created.id }])
  })

  it('creates a draft without starting when start is false', () => {
    const draft = createInvestigation({ question: 'EU e-invoicing mandate: impact on Atlas', start: false, depth: 'quick' })
    expect(draft.status).toBe('draft')
    expect(draft.runIds).toEqual([])
    expect(draft.angles).toHaveLength(3)
    expect(db.all('runs')).toHaveLength(0)
  })
})

describe('research.investigate run', () => {
  it('fills sources, findings and a cited report progressively, then waits for review', () => {
    const created = createInvestigation({ question: 'Why do logistics customers churn?' })
    vi.advanceTimersByTime(4_500)
    // Knowledge retrieval is real: the churn interview note is found and recorded as a non-simulated source.
    const early = db.filter('sources', (s) => s.investigationId === created.id)
    expect(early.some((s) => s.knowledgeId === 'kno_churn')).toBe(true)

    finish()
    const done = inv(created.id)
    expect(done.status).toBe('review')
    const sources = done.sourceIds.map((id) => db.get('sources', id)!)
    const knowledge = sources.filter((s) => s.kind === 'knowledge')
    const web = sources.filter((s) => s.kind !== 'knowledge')
    expect(knowledge[0]).toMatchObject({ knowledgeId: 'kno_churn', simulated: false, credibility: 0.9 })
    expect(web.length).toBeGreaterThanOrEqual(6)
    for (const s of web) {
      expect(s.simulated).toBe(true)
      expect(s.domain).toMatch(/\.example$/)
      expect(s.url).toMatch(/^https:\/\/[a-z0-9-]+\.example\//)
      expect(['read', 'cited']).toContain(s.status)
      expect(s.credibility).toBeGreaterThanOrEqual(0.4)
      expect(s.credibility).toBeLessThanOrEqual(0.9)
      expect(s.snippet).not.toMatch(/\d+%/)
    }

    expect(done.findings.length).toBeGreaterThanOrEqual(3)
    expect(done.findings.length).toBeLessThanOrEqual(6)
    for (const f of done.findings) for (const sid of f.sourceIds) expect(done.sourceIds).toContain(sid)
    expect(done.findings[0].sourceIds).toContain(knowledge[0].id)
    for (const sid of done.findings.flatMap((f) => f.sourceIds)) expect(db.get('sources', sid)?.status).toBe('cited')

    const report = done.report ?? ''
    expect(report).toContain('## Executive summary')
    expect(report).toContain('## Key findings')
    expect(report).toContain('## Method & sources')
    expect(report).toContain(`${knowledge.length} came from your knowledge base`)
    expect(report).toContain(`${web.length} are simulated web sources`)
    expect(report).toMatch(/\[1\]/)
    expect(report).not.toContain('## Comparison')

    const run = db.get('runs', done.runIds[0])!
    expect(run.status).toBe('succeeded')
    expect(run.steps.map((s) => s.kind)).toEqual(['plan', 'search', 'search', 'search', 'search', 'browse', 'browse', 'think', 'write'])
    expect(run.steps.filter((s) => s.tool === 'web.search').every((s) => s.integrationId === 'web-search' && s.capability === 'web.search')).toBe(true)
  })

  it('adds a comparison table for comparison questions', () => {
    const created = createInvestigation({ question: 'Tidewell vs Freightly: which fits mid-market carriers?', depth: 'quick' })
    finish()
    const report = inv(created.id).report ?? ''
    expect(report).toContain('## Comparison')
    expect(report).toContain('| Dimension | Tidewell | Freightly | What to verify |')
  })

  it('honours sources discarded while the run is going', () => {
    const created = createInvestigation({ question: 'Usage-based pricing trends in B2B SaaS' })
    vi.advanceTimersByTime(9_000)
    const firstWeb = db.filter('sources', (s) => s.investigationId === created.id && s.simulated)[0]
    expect(firstWeb).toBeDefined()
    discardSource(firstWeb.id)
    finish()
    const done = inv(created.id)
    expect(db.get('sources', firstWeb.id)?.status).toBe('discarded')
    expect(done.findings.flatMap((f) => f.sourceIds)).not.toContain(firstWeb.id)
    expect(done.report).toContain('1 discarded source was excluded')
  })
})

describe('plans scale with depth', () => {
  function planFor(depth: Investigation['depth']) {
    const created = createInvestigation({ question: 'How should we price the Lumen analytics add-on?', depth, start: false })
    return planInvestigation({ investigationId: created.id }, createRng(7))
  }

  it('quick ≈ 5 steps, standard ≈ 8–9, deep ≈ 12–13', () => {
    expect(planFor('quick').steps).toHaveLength(5)
    expect(planFor('standard').steps.length).toBeGreaterThanOrEqual(8)
    expect(planFor('deep').steps.length).toBeGreaterThanOrEqual(12)
  })

  it('is deterministic for a seed and fails cleanly for a missing investigation', () => {
    const created = createInvestigation({ question: 'How should we price the Lumen analytics add-on?', start: false })
    const a = planInvestigation({ investigationId: created.id }, createRng(3)).steps.map((s) => [s.title, s.input, s.output])
    const b = planInvestigation({ investigationId: created.id }, createRng(3)).steps.map((s) => [s.title, s.input, s.output])
    expect(a).toEqual(b)
    const missing = planInvestigation({ investigationId: 'inv_missing' }, createRng(1))
    expect(missing.steps).toHaveLength(1)
    expect(missing.steps[0].failChance).toBe(1)
    expect(planFollowUp({ investigationId: created.id }, createRng(1)).steps[0].failChance).toBe(1)
  })
})

describe('report → knowledge', () => {
  it('saves once and updates the same item afterwards', () => {
    const created = createInvestigation({ question: 'Why do logistics customers churn?', projectId: null })
    finish()
    const first = saveReportToKnowledge(created.id)!
    expect(first).toMatchObject({ kind: 'report', collectionId: 'col_research', source: { type: 'research', ref: { kind: 'investigation', id: created.id } }, simulated: true })
    expect(inv(created.id).knowledgeId).toBe(first.id)
    expect(db.find('links', (l) => l.rel === 'produced' && l.from.id === created.id && l.to.id === first.id)).toBeDefined()

    updateReport(created.id, `${inv(created.id).report}\n\nReviewed by Morgan.`)
    const second = saveReportToKnowledge(created.id)!
    expect(second.id).toBe(first.id)
    expect(second.content).toContain('Reviewed by Morgan.')
    expect(db.filter('knowledge', (k) => k.kind === 'report')).toHaveLength(1)
  })

  it('never feeds its own saved report back into a follow-up', () => {
    const created = createInvestigation({ question: 'Why do logistics customers churn?' })
    finish()
    saveReportToKnowledge(created.id)
    const run = askFollowUp(created.id, 'Which onboarding steps matter most?')!
    expect(run.title).toBe('Follow-up: Which onboarding steps matter most?')
    finish()
    const done = inv(created.id)
    expect(done.status).toBe('review')
    expect(done.report).toContain('## Follow-up: Which onboarding steps matter most')
    const reportSources = done.sourceIds.map((id) => db.get('sources', id)!).filter((s) => s.knowledgeId === done.knowledgeId)
    expect(reportSources).toEqual([])
    expect(done.findings.length).toBeGreaterThan(3)
  })
})

describe('manual curation', () => {
  it('adds manual sources honestly, curates findings, completes and deletes', () => {
    const created = createInvestigation({ question: 'Pricing tiers for Atlas Lumen', start: false })
    const manual = addSource(created.id, { url: 'www.example.org/pricing-notes', snippet: 'Our own notes' })!
    expect(manual).toMatchObject({ kind: 'web', domain: 'example.org', simulated: false, status: 'queued', title: 'example.org' })
    expect(manual.content).toMatch(/not fetched/)
    expect(inv(created.id).sourceIds).toEqual([manual.id])

    const finding = addFinding(created.id, 'Tiering should follow seats, not shipments.', [manual.id])!
    expect(db.get('sources', manual.id)?.status).toBe('cited')
    expect(togglePinFinding(created.id, finding.id)?.pinned).toBe(true)
    discardSource(manual.id)
    expect(restoreSource(manual.id)?.status).toBe('cited')
    removeFinding(created.id, finding.id)
    expect(inv(created.id).findings).toEqual([])

    expect(completeInvestigation(created.id)?.status).toBe('complete')
    deleteInvestigation(created.id)
    expect(db.get('investigations', created.id)).toBeUndefined()
    expect(db.get('sources', manual.id)).toBeUndefined()
    expect(db.filter('links', (l) => l.from.id === created.id || l.to.id === created.id)).toEqual([])
  })

  it('cancels a running research run when the investigation is deleted', () => {
    const created = createInvestigation({ question: 'Why do logistics customers churn?' })
    const cancel = vi.spyOn(runEngine, 'cancel')
    deleteInvestigation(created.id)
    expect(cancel).toHaveBeenCalledWith(created.runIds[0], 'Investigation deleted')
    expect(db.get('runs', created.runIds[0])?.status).toBe('cancelled')
  })
})
