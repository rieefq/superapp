import { db, ID_PREFIX, useRow, useRows } from '@/core/db'
import { runEngine } from '@/core/runs/engine'
import { assetTags, assetTitle, inferAspect, inferDocFormat, inferImageStyle, inferTone, inferVoice } from '@/core/sim/studio'
import { ME, isRunActive, type Asset, type AssetKind, type AssetVersion, type Board, type EntityRef, type ID, type Run, type Slide, type Timestamp } from '@/core/types'
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

/** The catalog integration behind each kind's generator (all simulated in this build). */
export const GENERATOR_INTEGRATION: Partial<Record<AssetKind, string>> = { image: 'image-gen', video: 'video-gen', audio: 'voice' }

/** Most takes one generation may produce. */
export const MAX_TAKES = 4

const assetRef = (id: ID): EntityRef => ({ kind: 'asset', id })
const boardRef = (id: ID): EntityRef => ({ kind: 'board', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

// ---------------------------------------------------------------- versions

/**
 * Studio's private extension of an AssetVersion (Studio owns assets): the text a version was
 * generated with, the run that made it, and the params it used. Older versions may lack these
 * (seeded data); `versionContent` falls back to the asset's working copy for the current version.
 */
export interface StudioVersion extends AssetVersion {
  /** Markdown of this version (docs, narration, storyboard scripts). */
  content?: string
  /** Slides of this version (decks, storyboards). */
  slides?: Slide[]
  /** The run that produced this version. */
  runId?: ID
  /** Params this version was generated with (aspect, style, tone, format, voice…). */
  params?: Record<string, unknown>
  /** The context its text was grounded in (what the composer showed), reused by variations and edits. */
  context?: EntityRef[]
  /** Last hand edit of this version's text. */
  editedAt?: Timestamp
}

export function versionAt(asset: Asset, index = asset.currentVersion): StudioVersion | undefined {
  return asset.versions[index] as StudioVersion | undefined
}

/** The text of a version: its own snapshot, else (current version only) the asset's working copy. */
export function versionContent(asset: Asset, index = asset.currentVersion): { content?: string; slides?: Slide[]; known: boolean } {
  const v = versionAt(asset, index)
  if (v && (v.content !== undefined || v.slides !== undefined)) return { content: v.content, slides: v.slides, known: true }
  if (index === asset.currentVersion || !asset.versions.length) return { content: asset.content, slides: asset.slides, known: asset.content !== undefined || asset.slides !== undefined }
  return { known: false }
}

/** Params a version was made with: the asset's params, overridden by the version's own. */
export function versionParams(asset: Asset, index = asset.currentVersion): Record<string, unknown> {
  const own = versionAt(asset, index)?.params
  return own ? { ...asset.params, ...own } : asset.params
}

/** Copy the working text into the current version (keeps hand edits when switching versions). */
function syncCurrent(a: Asset): StudioVersion[] {
  const versions = a.versions as StudioVersion[]
  const cur = versions[a.currentVersion]
  if (!cur || (a.content === undefined && a.slides === undefined)) return versions
  if (cur.content === a.content && cur.slides === a.slides) return versions
  const next = [...versions]
  next[a.currentVersion] = {
    ...cur,
    ...(a.content !== undefined ? { content: a.content } : {}),
    ...(a.slides !== undefined ? { slides: a.slides } : {}),
  }
  return next
}

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
  /** Takes for the first generation (1–4); each becomes a version. */
  takes?: number
  /**
   * Exactly the context the composer showed for this generation (knowledge, held items…). Text kinds
   * ground their writing in it; when omitted, the writer retrieves knowledge itself (shown as a step).
   */
  contextRefs?: EntityRef[]
}

type Mode = 'create' | 'variation' | 'edit'

function startGeneration(asset: Asset, mode: Mode, extra: Record<string, unknown> = {}): Run {
  const titles = { create: `Generate ${asset.kind}: ${asset.title}`, variation: `Variation: ${asset.title}`, edit: `Edit: ${asset.title}` }
  const run = runEngine.start({
    kind: 'studio',
    title: titles[mode],
    factory: STUDIO_FACTORY,
    params: { assetId: asset.id, mode, ...extra },
    projectId: asset.projectId,
    origin: assetRef(asset.id),
  })
  touch(asset.id, { status: 'generating', runId: run.id })
  return run
}

const clampTakes = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_TAKES, Math.max(1, Math.round(n))) : 1)

/** Create an asset and start generating its first version (or several takes). */
export function generateAsset(input: GenerateAssetInput): Asset {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Describe what you want to create.')
  const board = input.boardId ? db.get('boards', input.boardId) : undefined
  const now = Date.now()
  const generator = GENERATORS[input.kind]
  const takes = clampTakes(input.takes ?? input.params?.takes)
  const asset: Asset = {
    id: newId(ID_PREFIX.assets),
    kind: input.kind,
    title: input.title?.trim() || assetTitle(prompt, input.kind),
    prompt,
    projectId: input.projectId !== undefined ? input.projectId : (board?.projectId ?? null),
    boardId: board ? board.id : null,
    status: 'generating',
    generator: { id: generator.id, label: generator.label, simulated: true },
    params: { ...defaultParams(input.kind, prompt), ...(input.params ?? {}), ...(takes > 1 ? { takes } : {}) },
    versions: [],
    currentVersion: 0,
    tags: assetTags(prompt),
    createdAt: now,
    updatedAt: now,
  }
  if (takes <= 1) delete asset.params.takes
  db.insert('assets', asset)
  if (input.origin) markDerived(assetRef(asset.id), input.origin)
  logActivity({ actor: ME, verb: 'created', target: assetRef(asset.id), summary: `Started generating ${quoted(asset.title)} (${asset.kind})`, projectId: asset.projectId })
  try {
    startGeneration(asset, 'create', input.contextRefs ? { contextRefs: input.contextRefs.map((r) => ({ kind: r.kind, id: r.id })) } : {})
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

/** The generation in progress for an asset, if any. */
export function activeGeneration(assetId: ID): Run | undefined {
  const asset = db.get('assets', assetId)
  return asset ? activeRun(asset) : undefined
}

/** Generate another version from the same prompt. */
export function createVariation(assetId: ID): Run | undefined {
  const asset = db.get('assets', assetId)
  if (!asset) return undefined
  return activeRun(asset) ?? startGeneration(asset, 'variation')
}

/** Generate a new version with an instruction applied ("warmer colors", "shorter"). Never overwrites. */
export function editAsset(assetId: ID, instruction: string): Run | undefined {
  const asset = db.get('assets', assetId)
  const text = instruction.trim()
  if (!asset || !text) return undefined
  const running = activeRun(asset)
  if (running) return running
  logActivity({ actor: ME, verb: 'edited', target: assetRef(assetId), summary: `Asked for an edit of ${quoted(asset.title)}: ${quoted(text)}`, projectId: asset.projectId })
  return startGeneration(asset, 'edit', { instruction: text })
}

/** Retry a failed or stopped generation (a fresh run; the first generation if there is no version yet). */
export function retryGeneration(assetId: ID): Run | undefined {
  const asset = db.get('assets', assetId)
  if (!asset) return undefined
  const running = activeRun(asset)
  if (running) return running
  const last = asset.runId ? db.get('runs', asset.runId) : undefined
  const params = last?.script?.params
  const mode: Mode = asset.versions.length ? (params?.mode === 'edit' && typeof params.instruction === 'string' ? 'edit' : 'variation') : 'create'
  const extra: Record<string, unknown> = {}
  if (mode === 'edit' && typeof params?.instruction === 'string') extra.instruction = params.instruction
  if (Array.isArray(params?.contextRefs)) extra.contextRefs = params.contextRefs
  logActivity({ actor: ME, verb: 'retried', target: assetRef(assetId), summary: `Retried generating ${quoted(asset.title)}`, projectId: asset.projectId })
  return startGeneration(asset, mode, extra)
}

/** Stop the generation in progress (the asset keeps the versions it already has). */
export function stopGeneration(assetId: ID): void {
  const asset = db.get('assets', assetId)
  const run = asset ? activeRun(asset) : undefined
  if (run) runEngine.cancel(run.id, 'Stopped by you')
}

const TEXT_KINDS: ReadonlySet<AssetKind> = new Set<AssetKind>(['presentation', 'document', 'audio', 'video'])

/**
 * Make a version current. Text kinds swap the working copy to that version's text (hand edits are
 * kept in the version they were made on). A version whose text was never recorded (seeded data that
 * predates per-version text) leaves no working copy, so nothing is shown under the wrong version.
 */
export function setCurrentVersion(assetId: ID, index: number): Asset | undefined {
  return touch(assetId, (a) => {
    if (index < 0 || index >= a.versions.length || index === a.currentVersion) return a
    const versions = syncCurrent(a)
    const target = versions[index]
    const next: Asset = { ...a, versions, currentVersion: index }
    if (target.content !== undefined || target.slides !== undefined) {
      if (target.content !== undefined) next.content = target.content
      else delete next.content
      if (target.slides !== undefined) next.slides = target.slides
      else delete next.slides
    } else if (TEXT_KINDS.has(a.kind)) {
      delete next.content
      delete next.slides
    }
    return next
  })
}

export function toggleFavorite(assetId: ID): Asset | undefined {
  return touch(assetId, (a) => ({ ...a, favorite: !a.favorite || undefined }))
}

export function renameAsset(assetId: ID, title: string): Asset | undefined {
  const clean = title.trim()
  const cur = db.get('assets', assetId)
  if (!cur || !clean || cur.title === clean) return cur
  const next = touch(assetId, { title: clean })
  logActivity({ actor: ME, verb: 'renamed', target: assetRef(assetId), summary: `Renamed ${quoted(cur.title)} to ${quoted(clean)}`, projectId: cur.projectId })
  return next
}

/** Move an asset to a board (null: no board). */
export function moveToBoard(assetId: ID, boardId: ID | null): Asset | undefined {
  const cur = db.get('assets', assetId)
  const board = boardId ? db.get('boards', boardId) : undefined
  if (!cur || (boardId && !board) || cur.boardId === boardId) return cur
  const next = touch(assetId, { boardId })
  logActivity({
    actor: ME,
    verb: 'moved',
    target: assetRef(assetId),
    summary: board ? `Moved ${quoted(cur.title)} to the board ${quoted(board.name)}` : `Removed ${quoted(cur.title)} from its board`,
    projectId: cur.projectId,
  })
  return next
}

/** Hand edits are logged at most once per asset in this window (autosave writes often). */
const EDIT_LOG_WINDOW = 10 * 60_000
const lastEditLogged = new Map<ID, number>()

/**
 * Hand edits to a document's copy or a deck's slides. They apply to the current version (and its
 * working copy), or — with `versionId` — to that version only (an editor flushing after a switch).
 */
export function updateAssetContent(assetId: ID, patch: { content?: string; slides?: Slide[] }, opts: { versionId?: ID } = {}): Asset | undefined {
  const before = db.get('assets', assetId)
  const targetIndex = before && opts.versionId ? before.versions.findIndex((v) => v.id === opts.versionId) : (before?.currentVersion ?? -1)
  if (before && opts.versionId && targetIndex < 0) return before
  const next = touch(assetId, (a) => {
    const now = Date.now()
    const index = opts.versionId ? a.versions.findIndex((v) => v.id === opts.versionId) : a.currentVersion
    const versions = a.versions as StudioVersion[]
    const nextVersions = versions[index]
      ? versions.map((v, i) =>
          i === index
            ? { ...v, ...(patch.content !== undefined ? { content: patch.content } : {}), ...(patch.slides !== undefined ? { slides: patch.slides } : {}), editedAt: now }
            : v,
        )
      : versions
    const working = index === a.currentVersion || !versions.length
    return {
      ...a,
      versions: nextVersions,
      ...(working && patch.content !== undefined ? { content: patch.content } : {}),
      ...(working && patch.slides !== undefined ? { slides: patch.slides } : {}),
    }
  })
  if (before && next) {
    const at = Date.now()
    if (at - (lastEditLogged.get(assetId) ?? 0) > EDIT_LOG_WINDOW) {
      lastEditLogged.set(assetId, at)
      const what = patch.slides !== undefined ? (before.kind === 'video' ? 'the shots of' : 'the slides of') : 'the text of'
      logActivity({ actor: ME, verb: 'edited', target: assetRef(assetId), summary: `Edited ${what} ${quoted(before.title)} (v${Math.max(0, targetIndex) + 1})`, projectId: before.projectId })
    }
  }
  return next
}

export function deleteAsset(assetId: ID): void {
  const asset = db.get('assets', assetId)
  if (!asset) return
  const running = activeRun(asset)
  if (running) runEngine.cancel(running.id, 'Asset deleted')
  forgetRef(assetRef(assetId))
  db.remove('assets', assetId)
  lastEditLogged.delete(assetId)
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
  const next = db.update('boards', id, { name: clean })
  logActivity({ actor: ME, verb: 'renamed', target: boardRef(id), summary: `Renamed board ${quoted(cur.name)} to ${quoted(clean)}`, projectId: cur.projectId })
  return next
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
