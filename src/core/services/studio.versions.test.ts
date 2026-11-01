import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { __resetEngineForTests } from '@/core/runs/engine'
import { registerStudioFactories } from '@/core/runs/factories/studio'
import { useSettingsStore } from '@/core/settings'
import { paletteWarmth } from '@/core/sim/art'
import type { Asset } from '@/core/types'
import {
  createVariation, editAsset, generateAsset, retryGeneration, setCurrentVersion, stopGeneration, updateAssetContent, versionAt, versionContent, versionParams,
  type StudioVersion,
} from './studio'
import { fx } from './testFixtures'

/** Takes, per-version text, instruction edits, grounding and retry (Studio's version model). */

const NOW = new Date('2026-11-01T10:00:00Z').getTime()
registerStudioFactories()
const finish = () => vi.advanceTimersByTime(5 * 60_000)
const asset = (id: string): Asset => db.get('assets', id)!

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('takes', () => {
  it('one generation makes several versions, each with its own text', () => {
    const created = generateAsset({ kind: 'document', prompt: 'Landing page copy for shipment analytics', takes: 3 })
    expect(created.params.takes).toBe(3)
    finish()
    expect(db.get('runs', created.runId!)?.steps.find((s) => s.kind === 'generate')?.title).toBe('Write 3 variants')
    const a = asset(created.id)
    expect(a.versions).toHaveLength(3)
    expect(a.currentVersion).toBe(0)
    expect(a.versions.map((v) => v.note)).toEqual(['Take 1 of 3', 'Take 2 of 3', 'Take 3 of 3'])
    const texts = a.versions.map((_, i) => versionContent(a, i).content)
    expect(new Set(texts).size).toBe(3)
    expect(a.content).toBe(texts[0])
    expect(new Set(a.versions.map((v) => (v.preview.type === 'procedural' ? v.preview.seed : 0))).size).toBe(3)
  })

  it('clamps takes to 1–4 and keeps a single take unlabeled', () => {
    const many = generateAsset({ kind: 'image', prompt: 'Quiet harbor', takes: 9 })
    const one = generateAsset({ kind: 'image', prompt: 'Quiet harbor', takes: 1 })
    expect(many.params.takes).toBe(4)
    expect(one.params.takes).toBeUndefined()
    finish()
    expect(asset(many.id).versions).toHaveLength(4)
    expect(asset(one.id).versions).toHaveLength(1)
    expect(asset(one.id).versions[0].note).toBeUndefined()
  })
})

describe('per-version text', () => {
  it('switching versions swaps the working copy and keeps hand edits', () => {
    const created = generateAsset({ kind: 'document', prompt: 'Launch email for analytics', takes: 2 })
    finish()
    const v2 = versionContent(asset(created.id), 1).content
    updateAssetContent(created.id, { content: '# Hand-edited take one' })
    expect(versionContent(asset(created.id), 0).content).toBe('# Hand-edited take one')
    expect((versionAt(asset(created.id), 0) as StudioVersion).editedAt).toBeGreaterThanOrEqual(NOW)
    setCurrentVersion(created.id, 1)
    expect(asset(created.id).content).toBe(v2)
    setCurrentVersion(created.id, 0)
    expect(asset(created.id).content).toBe('# Hand-edited take one')
  })

  it('an edit flushed after a switch lands in the version it was made on', () => {
    const created = generateAsset({ kind: 'presentation', prompt: 'Board update on the launch', takes: 2 })
    finish()
    const a = asset(created.id)
    const first = a.versions[0].id
    setCurrentVersion(created.id, 1)
    const slides = versionContent(asset(created.id), 0).slides!.map((s, i) => (i === 0 ? { ...s, title: 'Renamed in v1' } : s))
    updateAssetContent(created.id, { slides }, { versionId: first })
    expect(versionContent(asset(created.id), 0).slides?.[0].title).toBe('Renamed in v1')
    expect(asset(created.id).slides?.[0].title).not.toBe('Renamed in v1')
  })

  it('keeps the text of versions that predate snapshots when a new version lands', () => {
    db.insert(
      'assets',
      fx.asset({
        id: 'ast_old',
        kind: 'document',
        prompt: 'Launch copy',
        params: { format: 'landing' },
        content: '# The original copy',
        versions: [{ id: 'ver_old', prompt: 'Launch copy', preview: { type: 'procedural', seed: 1, palette: ['#111111', '#eeeeee'], style: 'paper' }, createdAt: NOW - 1000 }],
        currentVersion: 0,
      }),
    )
    createVariation('ast_old')
    finish()
    const a = asset('ast_old')
    expect(a.versions).toHaveLength(2)
    expect(versionContent(a, 0).content).toBe('# The original copy')
    expect(a.content).not.toBe('# The original copy')
    expect(a.versions[1].note).toBe('Variation')
  })

  it('never shows another version’s text under a version whose text was not recorded', () => {
    const slides = [{ id: 's1', title: 'Current deck', body: '', layout: 'title' as const }]
    db.insert(
      'assets',
      fx.asset({
        id: 'ast_deck',
        kind: 'presentation',
        slides,
        currentVersion: 1,
        versions: [
          { id: 'v1', prompt: 'p', preview: { type: 'procedural', seed: 1, palette: ['#111111'], style: 'rays' }, createdAt: NOW - 2000 },
          { id: 'v2', prompt: 'p', preview: { type: 'procedural', seed: 2, palette: ['#111111'], style: 'rays' }, createdAt: NOW - 1000 },
        ],
      }),
    )
    setCurrentVersion('ast_deck', 0)
    expect(versionContent(asset('ast_deck'), 0)).toMatchObject({ known: false })
    expect(asset('ast_deck').slides).toBeUndefined()
    setCurrentVersion('ast_deck', 1)
    expect(asset('ast_deck').slides).toEqual(slides)
  })
})

describe('instruction edits', () => {
  it('keep the composition and move the palette the way the instruction says', () => {
    const created = generateAsset({ kind: 'image', prompt: 'Cool blue harbor at dawn, wide banner' })
    finish()
    const before = asset(created.id).versions[0]
    editAsset(created.id, 'Make the sky warmer')
    finish()
    expect(db.get('runs', asset(created.id).runId!)?.steps[0]?.title).toBe('Interpret the instruction')
    const after = asset(created.id).versions[1]
    expect(after.preview.type === 'procedural' && before.preview.type === 'procedural' && after.preview.seed === before.preview.seed).toBe(true)
    if (after.preview.type === 'procedural' && before.preview.type === 'procedural') {
      expect(paletteWarmth(after.preview.palette)).toBeGreaterThan(paletteWarmth(before.preview.palette))
    }
    expect(db.get('runs', asset(created.id).runId!)?.steps[0]?.output).toContain('Applied — Palette: warmer')
  })

  it('change params for the new version only (earlier versions keep theirs)', () => {
    const created = generateAsset({ kind: 'image', prompt: 'Harbor at dawn', params: { aspect: '16:9' } })
    finish()
    editAsset(created.id, 'make it square')
    finish()
    const a = asset(created.id)
    expect(versionParams(a, 1).aspect).toBe('1:1')
    expect(versionParams(a, 0).aspect).toBe('16:9')
    expect(a.params.aspect).toBe('1:1')
  })

  it('turn instructions it cannot map into a guided variation (new composition), and say so', () => {
    const created = generateAsset({ kind: 'image', prompt: 'Harbor at dawn' })
    finish()
    editAsset(created.id, 'more like the second one')
    finish()
    expect(db.get('runs', asset(created.id).runId!)?.steps[0]?.output).toContain('No setting matched this instruction exactly')
    const [a, b] = asset(created.id).versions
    expect(a.preview.type === 'procedural' && b.preview.type === 'procedural' && a.preview.seed !== b.preview.seed).toBe(true)
  })

  it('apply deck edits: tone, fewer slides, an added slide', () => {
    const created = generateAsset({ kind: 'presentation', prompt: 'Launch plan for the analytics add-on' })
    finish()
    editAsset(created.id, 'more executive, shorter, and add a slide about pricing')
    finish()
    const a = asset(created.id)
    expect(a.params).toMatchObject({ tone: 'executive', slideCount: 6 })
    const slides = versionContent(a, 1).slides!
    expect(slides).toHaveLength(6)
    expect(slides.some((s) => s.title === 'Pricing')).toBe(true)
    expect(versionContent(a, 0).slides).toHaveLength(8)
  })
})

describe('grounding and retry', () => {
  it('grounds text in exactly the context the composer showed, and lists it as read', () => {
    db.insert('knowledge', fx.knowledge({ id: 'kno_voice', title: 'Brand voice', content: 'We write clear, calm, specific sentences. We never promise what we cannot measure.' }))
    const created = generateAsset({ kind: 'document', prompt: 'Landing page for analytics', contextRefs: [{ kind: 'knowledge', id: 'kno_voice' }] })
    finish()
    const run = db.get('runs', created.runId!)!
    const step = run.steps.find((s) => s.kind === 'read')
    expect(step).toMatchObject({ title: 'Read 1 attached item', refs: [{ kind: 'knowledge', id: 'kno_voice' }] })
    expect(asset(created.id).content).toContain('Grounded in your knowledge: “Brand voice”')
    // A variation reuses the same grounding.
    createVariation(created.id)
    finish()
    const again = db.get('runs', asset(created.id).runId!)!
    expect(again.steps.find((s) => s.kind === 'read')?.refs).toEqual([{ kind: 'knowledge', id: 'kno_voice' }])
  })

  it('a stopped first generation fails and Retry starts it again', () => {
    const created = generateAsset({ kind: 'image', prompt: 'Harbor at dawn' })
    vi.advanceTimersByTime(500)
    stopGeneration(created.id)
    expect(asset(created.id).status).toBe('failed')
    const run = retryGeneration(created.id)
    expect(run).toBeDefined()
    expect(asset(created.id)).toMatchObject({ status: 'generating', runId: run!.id })
    finish()
    expect(asset(created.id)).toMatchObject({ status: 'ready' })
    expect(asset(created.id).versions).toHaveLength(1)
  })
})
