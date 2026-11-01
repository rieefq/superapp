import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { __resetEngineForTests } from '@/core/runs/engine'
import { registerResearchFactories } from '@/core/runs/factories/research'
import { fx } from '@/core/services/testFixtures'
import {
  activeResearchRun, askFollowUp, completeInvestigation, createInvestigation, isInvestigationSimulated, reopenInvestigation, saveFindingSnippet,
  saveReportToKnowledge, updateInvestigation,
} from '@/core/services/research'
import { useSettingsStore } from '@/core/settings'
import { deriveAngles, subjectPhrase } from '@/core/sim/research'
import { searchSimulatedWeb } from '@/core/sim/web'
import { createRng } from '@/lib/rng'
import { cancelQueuedFollowUp, queueFollowUp } from './actions'

/**
 * The research core as the workspace uses it: context that rides along, knowledge-only runs,
 * snippets, reopen, honest simulated flags, the follow-up queue and the subject of generated text.
 */

const NOW = new Date('2026-11-01T10:00:00Z').getTime()

registerResearchFactories()

const finish = () => vi.advanceTimersByTime(10 * 60_000)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
  db.insert('agents', fx.agent({ id: 'agt_scout', name: 'Scout' }))
  db.insert('knowledge', fx.knowledge({ id: 'kno_notes', title: 'Forwarder interview notes', content: 'Forwarders want invoices and tracking in one portal. Onboarding took three weeks.' }))
  db.insert('knowledge', fx.knowledge({ id: 'kno_secret', title: 'Board memo', content: 'Forwarders portal pricing draft for the board.', aiAvailability: 'never' }))
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('context that rides along', () => {
  it('reads the attached context (Saw list) and turns attached knowledge into sources; “Never” items are skipped', () => {
    db.insert('tasks', fx.task({ id: 'tsk_ctx', title: 'Write the portal brief' }))
    const inv = createInvestigation({
      question: 'What do forwarders expect from a customer portal?',
      context: [{ kind: 'knowledge', id: 'kno_notes' }, { kind: 'knowledge', id: 'kno_secret' }, { kind: 'task', id: 'tsk_ctx' }],
    })
    const run = db.get('runs', db.get('investigations', inv.id)!.runIds[0])!
    expect(run.script?.params.context).toHaveLength(3)
    finish()
    const done = db.get('runs', run.id)!
    const read = done.steps.find((s) => s.tool === 'context')
    expect(read?.refs).toEqual([{ kind: 'knowledge', id: 'kno_notes' }, { kind: 'task', id: 'tsk_ctx' }])
    const sources = db.filter('sources', (s) => s.investigationId === inv.id)
    expect(sources.some((s) => s.knowledgeId === 'kno_notes' && !s.simulated)).toBe(true)
    expect(sources.some((s) => s.knowledgeId === 'kno_secret')).toBe(false)
    // Search steps record the sources they found (timeline chips and the Saw list).
    const search = done.steps.find((s) => s.tool === 'web.search')
    expect(search?.refs?.length).toBeGreaterThan(0)
    expect(search?.refs?.every((r) => r.kind === 'source')).toBe(true)
  })

  it('runs knowledge-only when the web is switched off', () => {
    const inv = createInvestigation({ question: 'What do forwarders expect from a customer portal?', sources: { knowledge: true, web: false } })
    finish()
    const done = db.get('investigations', inv.id)!
    expect(done.status).toBe('review')
    expect(db.filter('sources', (s) => s.investigationId === inv.id).every((s) => !s.simulated)).toBe(true)
    expect(db.get('runs', done.runIds[0])!.steps.some((s) => s.tool === 'web.search')).toBe(false)
    expect(() => updateInvestigation(inv.id, { sources: { knowledge: false, web: false } })).toThrow(/at least one source/)
  })

  it('matches the default angles to the depth’s searches', () => {
    expect(createInvestigation({ question: 'How are forwarders adopting portals?', start: false }).angles).toHaveLength(3)
    expect(createInvestigation({ question: 'How are forwarders adopting portals?', depth: 'deep', start: false }).angles).toHaveLength(4)
  })
})

describe('review and knowledge', () => {
  it('reopens a completed investigation and saves findings as labeled snippets', () => {
    const inv = createInvestigation({ question: 'What do forwarders expect from a customer portal?' })
    finish()
    expect(isInvestigationSimulated(db.get('investigations', inv.id)!)).toBe(true)
    completeInvestigation(inv.id)
    expect(reopenInvestigation(inv.id)?.status).toBe('review')

    const finding = db.get('investigations', inv.id)!.findings.find((f) => f.sourceIds.some((sid) => db.get('sources', sid)?.simulated))!
    const snippet = saveFindingSnippet(inv.id, finding.id)!
    expect(snippet).toMatchObject({ kind: 'snippet', simulated: true, source: { type: 'research', ref: { kind: 'investigation', id: inv.id } } })
    expect(snippet.content).toContain(finding.text)
    expect(snippet.content).toMatch(/\[\d+\] .+ simulated source/)
  })

  it('labels a saved report simulated when its sources are, even without runs', () => {
    db.insert('investigations', {
      id: 'inv_seed', title: 'Seeded', question: 'Q?', projectId: null, status: 'complete', depth: 'standard', angles: [],
      sourceIds: ['src_a'], findings: [], runIds: [], report: '# Seeded\n\nBody [1].', createdAt: NOW, updatedAt: NOW,
    })
    db.insert('sources', { id: 'src_a', investigationId: 'inv_seed', kind: 'web', title: 'A', snippet: '', credibility: 0.6, status: 'cited', simulated: true, addedAt: NOW })
    const item = saveReportToKnowledge('inv_seed')!
    expect(item.simulated).toBe(true)
    // Idempotent: a second save updates the same item.
    expect(saveReportToKnowledge('inv_seed')?.id).toBe(item.id)
    expect(db.filter('knowledge', (k) => k.source.ref?.id === 'inv_seed')).toHaveLength(1)
  })
})

describe('follow-up queue', () => {
  it('waits for the running run, then starts follow-ups in order; a cancelled one never starts', () => {
    const inv = createInvestigation({ question: 'What do forwarders expect from a customer portal?' })
    queueFollowUp(inv.id, { question: 'What about onboarding time?', context: [], memory: false })
    queueFollowUp(inv.id, { question: 'Skip me', context: [], memory: false })
    cancelQueuedFollowUp(inv.id, 1)
    expect(db.get('investigations', inv.id)!.runIds).toHaveLength(1)
    finish()
    const runs = db.get('investigations', inv.id)!.runIds.map((id) => db.get('runs', id)!)
    expect(runs).toHaveLength(2)
    expect(runs[1].title).toBe('Follow-up: What about onboarding time?')
    finish()
    expect(activeResearchRun(db.get('investigations', inv.id)!)).toBeUndefined()
    expect(db.get('investigations', inv.id)!.report).toContain('## Follow-up: What about onboarding time')
    expect(db.get('investigations', inv.id)!.runIds).toHaveLength(2)
    // A follow-up asked when nothing runs starts right away.
    expect(askFollowUp(inv.id, 'One more?')).toBeDefined()
  })
})

describe('generated text', () => {
  it('cuts the subject at its first clause and keeps how-to templates for how-to questions', () => {
    expect(subjectPhrase('How are mid-market freight forwarders adopting customer portals, and what do they expect from them?')).toBe(
      'mid-market freight forwarders adopting customer portals',
    )
    expect(deriveAngles('How are mid-market forwarders adopting portals?', 3)[0]).toBe('What is the current landscape for mid-market forwarders adopting portals?')
    expect(deriveAngles('How do we reduce onboarding time?', 3)[0]).toMatch(/^What approaches do teams use for/)
    const titles = searchSimulatedWeb({ question: 'How are mid-market forwarders adopting customer portals, and why?', angle: '', angleIndex: 0, count: 4, rng: createRng(7), keyPrefix: 't' }).map((r) => r.title)
    for (const t of titles) expect(t).not.toMatch(/, and why|adopting customer$/)
  })
})
