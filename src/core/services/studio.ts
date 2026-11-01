import { db, ID_PREFIX, useRow, useRows } from '@/core/db'
import { runEngine } from '@/core/runs/engine'
import { assetTags, assetTitle, inferAspect, inferDocFormat, inferImageStyle, inferTone, inferVoice } from '@/core/sim/studio'
import { ME, isRunActive, type Asset, type AssetKind, type Board, type EntityRef, type ID, type Run, type Slide } from '@/core/types'
import { newId } from '@/lib/id'
import { logActivity } from './activity'
import { forgetRef, markDerived } from './serviceHelpers'

/**
 * Studio: generated assets (images, video storyboards, decks, copy, narration) and boards.
 * Generation is a 'studio.generate' run (src/core/runs/factories/studio.ts). Every generator in
 * this build is simulated: previews are procedural art rendered locally, never model output.
 */

export const STUDIO_FACTORY = 'studio.generate'

export const GENERATORS: Record<AssetKind, { id: string; label: string }> = {
  image: { id: 'image-gen', label: 'Image generator' },
  video: { id: 'video-gen', label: 'Video generator' },
  audio: { id: 'voice', label: 'Voice synthesis' },
  presentation: { id: 'studio-docs', label: 'Studio writer' },
  document: { id: 'studio-docs', label: 'Studio writer' },
}

const assetRef = (id: ID): EntityRef => ({ kind: 'asset', id })
const boardRef = (id: ID): EntityRef => ({ kind: 'board', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

/** Kind-specific defaults, inferred from the prompt where it says something (style, aspect, tone…). */
export function defaultParams(kind: AssetKind, prompt: string): Record<string, unknown> {
  switch (kind) {
    case 'image':
      return { aspect: inferAspect(prompt, kind), style: inferImageStyle(prompt) }
    case 'video':
      return { durationSec: 30, aspect: '16:9', shots: 6 }
    case 'presentation':
      return { slideCount: 8, tone: inferTone(prompt) }
    case 'document':
      return { format: inferDocFormat(prompt), tone: inferTone(prompt) }
    case 'audio':
      return { voice: inferVoice(prompt), durationSec: 45 }
  }
}

function touch(id: ID, patch: Partial<Asset> | ((a: Asset) => Asset)): Asset | undefined {
  const now = Date.now()
  return db.update('assets', id, (a) => {
    const next = typeof patch === 'function' ? patch(a) : { ...a, ...patch }
    return next === a ? a : { ...next, updatedAt: now }
  })
}

export interface GenerateAssetInput {
  kind: AssetKind
  prompt: string
  title?: string
  projectId?: ID | null
  boardId?: ID | null
  params?: Record<string, unknown>
  origin?: EntityRef
}

function startGeneration(asset: Asset, mode: 'create' | 'variation' | 'edit', instruction?: string): Run {
  const titles = { create: `Generate ${asset.kind}: ${asset.title}`, variation: `Variation: ${asset.title}`, edit: `Edit: ${asset.title}` }
  const run = runEngine.start({
    kind: 'studio',
    title: titles[mode],
    factory: STUDIO_FACTORY,
    params: { assetId: asset.id, mode, ...(instruction ? { instruction } : {}) },
    projectId: asset.projectId,
    origin: assetRef(asset.id),
  })
  touch(asset.id, { status: 'generating', runId: run.id })
  return run
}

/** Create an asset and start generating its first version. */
export function generateAsset(input: GenerateAssetInput): Asset {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Describe what you want to create.')
  const board = input.boardId ? db.get('boards', input.boardId) : undefined
  const now = Date.now()
  const generator = GENERATORS[input.kind]
  const asset: Asset = {
    id: newId(ID_PREFIX.assets),
    kind: input.kind,
    title: input.title?.trim() || assetTitle(prompt, input.kind),
    prompt,
    projectId: input.projectId !== undefined ? input.projectId : (board?.projectId ?? null),
    boardId: board ? board.id : null,
    status: 'generating',
    generator: { id: generator.id, label: generator.label, simulated: true },
    params: { ...defaultParams(input.kind, prompt), ...(input.params ?? {}) },
    versions: [],
    currentVersion: 0,
    tags: assetTags(prompt),
    createdAt: now,
    updatedAt: now,
  }
  db.insert('assets', asset)
  if (input.origin) markDerived(assetRef(asset.id), input.origin)
  logActivity({ actor: ME, verb: 'created', target: assetRef(asset.id), summary: `Started generating ${quoted(asset.title)} (${asset.kind})`, projectId: asset.projectId })
  try {
    startGeneration(asset, 'create')
  } catch (error) {
    touch(asset.id, { status: 'failed' })
    throw error
  }
  return db.get('assets', asset.id) ?? asset
}

function activeRun(asset: Asset): Run | undefined {
  const run = asset.runId ? db.get('runs', asset.runId) : undefined
  return run && isRunActive(run.status) ? run : undefined
}

/** Generate another version from the same prompt. */
export function createVariation(assetId: ID): Run | undefined {
  const asset = db.get('assets', assetId)
  if (!asset) return undefined
  return activeRun(asset) ?? startGeneration(asset, 'variation')
}

/** Generate a new version with an instruction applied ("warmer colors", "shorter"). */
export function editAsset(assetId: ID, instruction: string): Run | undefined {
  const asset = db.get('assets', assetId)
  const text = instruction.trim()
  if (!asset || !text) return undefined
  const running = activeRun(asset)
  if (running) return running
  logActivity({ actor: ME, verb: 'edited', target: assetRef(assetId), summary: `Asked for an edit of ${quoted(asset.title)}: ${quoted(text)}`, projectId: asset.projectId })
  return startGeneration(asset, 'edit', text)
}

export function setCurrentVersion(assetId: ID, index: number): Asset | undefined {
  return touch(assetId, (a) => (index < 0 || index >= a.versions.length || index === a.currentVersion ? a : { ...a, currentVersion: index }))
}

export function toggleFavorite(assetId: ID): Asset | undefined {
  return touch(assetId, (a) => ({ ...a, favorite: !a.favorite || undefined }))
}

export function renameAsset(assetId: ID, title: string): Asset | undefined {
  const clean = title.trim()
  if (!clean) return db.get('assets', assetId)
  return touch(assetId, (a) => (a.title === clean ? a : { ...a, title: clean }))
}

/** Move an asset to a board (null: no board). */
export function moveToBoard(assetId: ID, boardId: ID | null): Asset | undefined {
  if (boardId && !db.get('boards', boardId)) return db.get('assets', assetId)
  return touch(assetId, (a) => (a.boardId === boardId ? a : { ...a, boardId }))
}

/** Hand edits to a document's copy or a deck's slides. */
export function updateAssetContent(assetId: ID, patch: { content?: string; slides?: Slide[] }): Asset | undefined {
  return touch(assetId, (a) => ({ ...a, ...(patch.content !== undefined ? { content: patch.content } : {}), ...(patch.slides !== undefined ? { slides: patch.slides } : {}) }))
}

export function deleteAsset(assetId: ID): void {
  const asset = db.get('assets', assetId)
  if (!asset) return
  const running = activeRun(asset)
  if (running) runEngine.cancel(running.id, 'Asset deleted')
  forgetRef(assetRef(assetId))
  db.remove('assets', assetId)
  logActivity({ actor: ME, verb: 'deleted', target: assetRef(assetId), summary: `Deleted ${quoted(asset.title)}`, projectId: asset.projectId })
}

// ---------------------------------------------------------------- boards

export function createBoard(input: { name: string; description?: string; projectId?: ID | null }): Board {
  const board: Board = {
    id: newId(ID_PREFIX.boards),
    name: input.name.trim() || 'Untitled board',
    projectId: input.projectId ?? null,
    createdAt: Date.now(),
  }
  if (input.description?.trim()) board.description = input.description.trim()
  db.insert('boards', board)
  logActivity({ actor: ME, verb: 'created', target: boardRef(board.id), summary: `Created board ${quoted(board.name)}`, projectId: board.projectId })
  return board
}

export function renameBoard(id: ID, name: string): Board | undefined {
  const clean = name.trim()
  const cur = db.get('boards', id)
  if (!cur || !clean || cur.name === clean) return cur
  return db.update('boards', id, { name: clean })
}

/** Delete a board; its assets stay in Studio without a board. */
export function deleteBoard(id: ID): void {
  const cur = db.get('boards', id)
  if (!cur) return
  const now = Date.now()
  db.insertMany(
    'assets',
    db.filter('assets', (a) => a.boardId === id).map((a) => ({ ...a, boardId: null, updatedAt: now })),
  )
  forgetRef(boardRef(id))
  db.remove('boards', id)
  logActivity({ actor: ME, verb: 'deleted', target: boardRef(id), summary: `Deleted board ${quoted(cur.name)}`, projectId: cur.projectId })
}

// ---------------------------------------------------------------- hooks

export interface AssetFilter {
  /** A board id, `null` for assets without a board, or omitted for all. */
  boardId?: ID | null
  /** Only this project's assets (null or omitted: all). */
  projectId?: ID | null
  kind?: AssetKind | AssetKind[]
}

export function useAssets(filter: AssetFilter = {}): Asset[] {
  const kinds = filter.kind === undefined ? null : Array.isArray(filter.kind) ? filter.kind : [filter.kind]
  return useRows(
    'assets',
    (a) =>
      (filter.boardId === undefined || a.boardId === filter.boardId) &&
      (!filter.projectId || a.projectId === filter.projectId) &&
      (!kinds || kinds.includes(a.kind)),
    (a, b) => b.updatedAt - a.updatedAt,
  )
}

export function useAsset(id: ID | null | undefined): Asset | undefined {
  return useRow('assets', id)
}

export function useBoards(): Board[] {
  return useRows('boards', undefined, (a, b) => a.createdAt - b.createdAt)
}
