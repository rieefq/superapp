import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { __resetEngineForTests } from '@/core/runs/engine'
import { planStudioGeneration, registerStudioFactories } from '@/core/runs/factories/studio'
import { useSettingsStore } from '@/core/settings'
import { paletteFromPrompt } from '@/core/sim/art'
import type { Asset } from '@/core/types'
import { createRng } from '@/lib/rng'
import {
  createBoard, createVariation, deleteAsset, deleteBoard, editAsset, generateAsset, moveToBoard, renameAsset, renameBoard, setCurrentVersion,
  toggleFavorite, updateAssetContent,
} from './studio'
import { fx } from './testFixtures'

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

describe('generateAsset', () => {
  it('creates a generating image with simulated generator and inferred params, then a procedural version', () => {
    const prompt = 'A calm harbor at dawn, soft teal and coral, photographic, wide hero banner'
    const created = generateAsset({ kind: 'image', prompt })
    expect(created).toMatchObject({
      status: 'generating',
      generator: { id: 'image-gen', label: 'Image generator', simulated: true },
      params: { aspect: '16:9', style: 'photographic' },
      versions: [],
      currentVersion: 0,
    })
    expect(created.tags.length).toBeGreaterThan(0)
    const run = db.get('runs', created.runId!)
    expect(run).toMatchObject({ kind: 'studio', origin: { kind: 'asset', id: created.id }, script: { factory: 'studio.generate', params: { assetId: created.id, mode: 'create' } } })

    finish()
    const ready = asset(created.id)
    expect(ready.status).toBe('ready')
    expect(ready.versions).toHaveLength(1)
    expect(ready.versions[0].preview).toEqual({ type: 'procedural', seed: expect.any(Number), palette: paletteFromPrompt(prompt), style: 'photographic' })
    expect(db.get('runs', created.runId!)?.outputs).toContainEqual({ kind: 'asset', id: created.id })
    const generate = db.get('runs', created.runId!)!.steps.find((s) => s.kind === 'generate')
    expect(generate).toMatchObject({ integrationId: 'image-gen', capability: 'media.generate' })
    expect(generate?.output).toContain('no image model was called')
  })

  it('writes a deck grounded in knowledge without inventing numbers', () => {
    db.insert('knowledge', fx.knowledge({ id: 'kno_prd', title: 'Atlas Lumen PRD', content: 'Lumen adds shipment analytics to the Atlas portal. Operations managers want weekly volume trends and exception alerts.' }))
    const created = generateAsset({ kind: 'presentation', prompt: 'Board update on the Atlas Lumen analytics launch' })
    expect(created.params).toMatchObject({ slideCount: 8, tone: 'executive' })
    finish()
    const deck = asset(created.id)
    expect(deck.slides).toHaveLength(8)
    expect(deck.slides?.[0]).toMatchObject({ layout: 'title', title: created.title })
    expect(deck.slides?.some((s) => s.layout === 'quote' && s.title === 'From “Atlas Lumen PRD”')).toBe(true)
    expect(deck.slides?.map((s) => s.body).join(' ')).not.toMatch(/\d+%/)
    expect(new Set(deck.slides?.map((s) => s.id)).size).toBe(8)
    expect(db.get('runs', created.runId!)?.steps.map((s) => s.kind)).toEqual(['think', 'search', 'write', 'generate', 'think', 'artifact'])
  })

  it('writes copy, storyboards and narration for the other kinds', () => {
    const email = generateAsset({ kind: 'document', prompt: 'Launch email for shipment visibility dashboards' })
    const video = generateAsset({ kind: 'video', prompt: 'Hero video for shipment visibility', params: { shots: 5, durationSec: 25 } })
    const audio = generateAsset({ kind: 'audio', prompt: 'Calm narration for the onboarding walkthrough' })
    finish()
    expect(asset(email.id).params.format).toBe('email')
    expect(asset(email.id).content).toContain('**Subject options**')
    const board = asset(video.id)
    expect(board.slides).toHaveLength(5)
    expect(board.slides?.[0].body).toMatch(/^Framing: .+\nMotion: .+\nVO: “.+”$/)
    expect(board.slides?.[4]).toMatchObject({ title: 'Shot 5 · Call to action', notes: '0:20–0:25 · 16:9' })
    expect(asset(audio.id).params.voice).toBe('Calm guide')
    expect(asset(audio.id).content).toContain('no audio was synthesized')
  })
})

describe('versions and curation', () => {
  it('adds variations and edits as new versions', () => {
    const prompt = 'Bold neon poster for the Lumen launch'
    const created = generateAsset({ kind: 'image', prompt })
    finish()
    createVariation(created.id)
    expect(asset(created.id).status).toBe('generating')
    finish()
    editAsset(created.id, 'make it warmer, editorial layout')
    finish()
    const a = asset(created.id)
    expect(a.versions).toHaveLength(3)
    expect(a.currentVersion).toBe(2)
    expect(a.versions[1].note).toBe('Variation')
    expect(a.versions[1].preview).not.toEqual(a.versions[0].preview)
    expect(a.versions[2]).toMatchObject({ note: 'Edited: make it warmer, editorial layout', prompt: `${prompt}. make it warmer, editorial layout`, preview: { style: 'editorial' } })
    expect(setCurrentVersion(created.id, 0)?.currentVersion).toBe(0)
    expect(setCurrentVersion(created.id, 9)?.currentVersion).toBe(0)
  })

  it('manages favorites, titles, boards and content', () => {
    const board = createBoard({ name: 'Launch visuals', projectId: 'prj_lumen' })
    const created = generateAsset({ kind: 'document', prompt: 'Landing page copy for Lumen', boardId: board.id })
    expect(created).toMatchObject({ boardId: board.id, projectId: 'prj_lumen' })
    expect(toggleFavorite(created.id)?.favorite).toBe(true)
    expect(toggleFavorite(created.id)?.favorite).toBeUndefined()
    expect(renameAsset(created.id, '  Lumen landing  ')?.title).toBe('Lumen landing')
    expect(updateAssetContent(created.id, { content: '# Hand-edited' })?.content).toBe('# Hand-edited')
    expect(renameBoard(board.id, 'Lumen visuals')?.name).toBe('Lumen visuals')
    const other = createBoard({ name: 'Social' })
    expect(moveToBoard(created.id, other.id)?.boardId).toBe(other.id)
    deleteBoard(other.id)
    expect(asset(created.id).boardId).toBeNull()
    deleteAsset(created.id)
    expect(db.get('assets', created.id)).toBeUndefined()
    expect(db.get('runs', created.runId!)?.status).toBe('cancelled')
  })

  it('plans deterministically and fails cleanly for missing assets', () => {
    const created = generateAsset({ kind: 'image', prompt: 'Abstract pattern in navy and gold' })
    const a = planStudioGeneration({ assetId: created.id, mode: 'create' }, createRng(5)).steps.map((s) => s.output)
    const b = planStudioGeneration({ assetId: created.id, mode: 'create' }, createRng(5)).steps.map((s) => s.output)
    expect(a).toEqual(b)
    expect(planStudioGeneration({ assetId: 'ast_missing' }, createRng(1)).steps[0].failChance).toBe(1)
  })
})
