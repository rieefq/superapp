import { db, ID_PREFIX, useDB, useRow, useRows, type Tables } from '@/core/db'
import {
  ME,
  type ActorRef,
  type Collection,
  type EntityRef,
  type Hue,
  type ID,
  type KnowledgeItem,
  type KnowledgeKind,
} from '@/core/types'
import { newId } from '@/lib/id'
import { logActivity } from './activity'
import { describeRef } from './entities'
import { prepareImport } from './fileImport'
import { notify } from './notifications'
import { changedKeys, clipLine, forgetRef, leastUsedHue, markDerived, memoOnTable, updateRows } from './serviceHelpers'

const itemRef = (id: ID): EntityRef => ({ kind: 'knowledge', id })
const collectionRef = (id: ID): EntityRef => ({ kind: 'collection', id })

/** "#Launch Plan " → "launch-plan". */
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-')
}

function normalizeTags(tags: readonly string[]): string[] {
  const out: string[] = []
  for (const t of tags) {
    const tag = normalizeTag(t)
    if (tag && !out.includes(tag)) out.push(tag)
  }
  return out
}

/** Words in a text (letters/digits; markdown punctuation is ignored). */
export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

// ---------------------------------------------------------------- items

export interface CreateKnowledgeInput {
  title: string
  content: string
  kind?: KnowledgeKind
  collectionId?: ID | null
  projectIds?: ID[]
  tags?: string[]
  source?: KnowledgeItem['source']
  author?: ActorRef
  summary?: string
  file?: KnowledgeItem['file']
  pinned?: boolean
  /** Content produced by the local simulator (shown with the Simulated label). */
  simulated?: boolean
}

export interface KnowledgeActivityOptions {
  /** Activity verb: 'created' (default), 'imported', 'saved', 'duplicated'… */
  verb?: string
  summary?: string
}

const VERB_PHRASE: Record<string, string> = {
  created: 'Added',
  imported: 'Imported',
  saved: 'Saved',
  duplicated: 'Duplicated',
}

/** Create a knowledge item; links it to `source.ref` and logs activity. */
export function createKnowledge(input: CreateKnowledgeInput, opts: KnowledgeActivityOptions = {}): KnowledgeItem {
  const now = Date.now()
  const author = input.author ?? ME
  const src = input.source ?? { type: 'manual' as const }
  const source: KnowledgeItem['source'] = { type: src.type }
  if (src.ref) source.ref = { kind: src.ref.kind, id: src.ref.id }
  if (src.url) source.url = src.url
  if (src.integrationId) source.integrationId = src.integrationId
  const item: KnowledgeItem = {
    id: newId(ID_PREFIX.knowledge),
    kind: input.kind ?? 'note',
    title: input.title.trim() || 'Untitled',
    content: input.content,
    summary: input.summary?.trim() || undefined,
    tags: normalizeTags(input.tags ?? []),
    collectionId: input.collectionId ?? null,
    projectIds: [...new Set(input.projectIds ?? [])],
    source,
    file: input.file ? { ...input.file } : undefined,
    author,
    pinned: input.pinned || undefined,
    simulated: input.simulated || undefined,
    createdAt: now,
    updatedAt: now,
  }
  db.insert('knowledge', item)
  if (source.ref) markDerived(itemRef(item.id), source.ref)

  const verb = opts.verb ?? 'created'
  const from = source.ref ? ` from ${describeRef(source.ref)}` : ''
  logActivity({
    actor: author,
    verb,
    target: itemRef(item.id),
    summary: opts.summary ?? `${VERB_PHRASE[verb] ?? 'Added'} “${item.title}” ${verb === 'imported' ? 'into' : 'to'} Knowledge${from}`,
    projectId: item.projectIds[0] ?? null,
    meta: source.ref ? { source: source.ref } : undefined,
  })
  if (author.type === 'agent') {
    notify({
      kind: 'knowledge.added',
      title: `${db.get('agents', author.id)?.name ?? 'An agent'} saved “${clipLine(item.title, 70)}”`,
      body: 'New item in Knowledge.',
      ref: itemRef(item.id),
      tone: 'info',
    })
  }
  return item
}

export type KnowledgePatch = Partial<
  Pick<KnowledgeItem, 'title' | 'content' | 'summary' | 'kind' | 'tags' | 'collectionId' | 'projectIds' | 'pinned' | 'source'>
>

export function updateKnowledge(id: ID, patch: KnowledgePatch): KnowledgeItem | undefined {
  const cur = db.get('knowledge', id)
  if (!cur) return undefined
  const clean: KnowledgePatch = { ...patch }
  if (clean.title !== undefined) clean.title = clean.title.trim() || cur.title
  if (clean.tags) clean.tags = normalizeTags(clean.tags)
  if (clean.projectIds) clean.projectIds = [...new Set(clean.projectIds)]
  const fields = changedKeys(cur, clean)
  if (!fields.length) return cur
  const next = db.update('knowledge', id, { ...clean, updatedAt: Date.now() })
  logActivity({
    actor: ME,
    verb: fields.includes('content') ? 'edited' : 'updated',
    target: itemRef(id),
    summary: fields.includes('content') ? `Edited “${next?.title ?? cur.title}”` : `Updated ${fields.join(', ')} of “${next?.title ?? cur.title}”`,
    projectId: (next ?? cur).projectIds[0] ?? null,
    meta: { fields },
  })
  return next
}

export function deleteKnowledge(id: ID): void {
  const cur = db.get('knowledge', id)
  if (!cur) return
  forgetRef(itemRef(id))
  updateRows('investigations', (i) => i.knowledgeId === id, (i) => ({ ...i, knowledgeId: undefined }))
  updateRows('sources', (s) => s.knowledgeId === id, (s) => ({ ...s, knowledgeId: undefined }))
  updateRows('messages', (m) => !!m.attachments?.some((a) => a.knowledgeId === id), (m) => ({
    ...m,
    attachments: m.attachments?.map((a) => (a.knowledgeId === id ? { ...a, knowledgeId: undefined } : a)),
  }))
  db.remove('knowledge', id)
  logActivity({
    actor: ME,
    verb: 'deleted',
    target: itemRef(id),
    summary: `Deleted “${cur.title}” from Knowledge`,
    projectId: cur.projectIds[0] ?? null,
  })
}

export function duplicateKnowledge(id: ID): KnowledgeItem | undefined {
  const cur = db.get('knowledge', id)
  if (!cur) return undefined
  const copy = createKnowledge(
    {
      title: `${cur.title} (copy)`,
      content: cur.content,
      kind: cur.kind,
      collectionId: cur.collectionId,
      projectIds: cur.projectIds,
      tags: cur.tags,
      source: cur.source,
      summary: cur.summary,
      file: cur.file,
      simulated: cur.simulated,
    },
    { verb: 'duplicated', summary: `Duplicated “${cur.title}”` },
  )
  markDerived(itemRef(copy.id), itemRef(id))
  return copy
}

/** Pin / unpin an item to the top of Knowledge lists. */
export function toggleKnowledgePinned(id: ID): KnowledgeItem | undefined {
  const cur = db.get('knowledge', id)
  if (!cur) return undefined
  const pinned = !cur.pinned
  const next = db.update('knowledge', id, { pinned: pinned || undefined })
  logActivity({
    actor: ME,
    verb: pinned ? 'pinned' : 'unpinned',
    target: itemRef(id),
    summary: `${pinned ? 'Pinned' : 'Unpinned'} “${cur.title}”`,
    projectId: cur.projectIds[0] ?? null,
  })
  return next
}

export interface ImportOptions {
  collectionId?: ID | null
  projectId?: ID | null
}

/**
 * Import local files into Knowledge (real file reading): text-like files are read up to
 * 400 KB, images get a ≤480px preview, PDFs/binaries are stored as metadata with an honest
 * note. Files that cannot be read are skipped with a warning notification.
 */
export async function importFiles(files: readonly File[], opts: ImportOptions = {}): Promise<KnowledgeItem[]> {
  const items: KnowledgeItem[] = []
  for (const file of files) {
    try {
      const prepared = await prepareImport(file)
      items.push(
        createKnowledge(
          {
            title: prepared.title,
            content: prepared.content,
            kind: prepared.kind,
            summary: prepared.summary,
            file: prepared.file,
            collectionId: opts.collectionId ?? null,
            projectIds: opts.projectId ? [opts.projectId] : [],
            source: { type: 'upload' },
          },
          { verb: 'imported' },
        ),
      )
    } catch (err) {
      notify({
        kind: 'system',
        title: `Couldn’t import ${file.name}`,
        body: err instanceof Error ? err.message : 'The file could not be read.',
        tone: 'warning',
      })
    }
  }
  return items
}

// ---------------------------------------------------------------- collections

export interface CreateCollectionInput {
  name: string
  description?: string
  hue?: Hue
  icon?: string
}

export function createCollection(input: CreateCollectionInput): Collection {
  const collection: Collection = {
    id: newId(ID_PREFIX.collections),
    name: input.name.trim() || 'Untitled collection',
    description: input.description?.trim() || undefined,
    hue: input.hue ?? leastUsedHue(db.all('collections').map((c) => c.hue)),
    icon: input.icon || 'Library',
    createdAt: Date.now(),
  }
  db.insert('collections', collection)
  logActivity({ actor: ME, verb: 'created', target: collectionRef(collection.id), summary: `Created collection “${collection.name}”` })
  return collection
}

export function updateCollection(id: ID, patch: Partial<Pick<Collection, 'name' | 'description' | 'hue' | 'icon'>>): Collection | undefined {
  const cur = db.get('collections', id)
  if (!cur) return undefined
  const clean = { ...patch }
  if (clean.name !== undefined) clean.name = clean.name.trim() || cur.name
  const fields = changedKeys(cur, clean)
  if (!fields.length) return cur
  const next = db.update('collections', id, clean)
  logActivity({
    actor: ME,
    verb: 'updated',
    target: collectionRef(id),
    summary: fields.includes('name') ? `Renamed collection “${cur.name}” to “${clean.name}”` : `Updated collection “${cur.name}”`,
    meta: { fields },
  })
  return next
}

/** Delete a collection; its items stay in Knowledge without a collection. */
export function deleteCollection(id: ID): void {
  const cur = db.get('collections', id)
  if (!cur) return
  const moved = updateRows('knowledge', (k) => k.collectionId === id, (k) => ({ ...k, collectionId: null }))
  updateRows(
    'agents',
    (a) => a.knowledgeScope.collectionIds.includes(id),
    (a) => ({ ...a, knowledgeScope: { ...a.knowledgeScope, collectionIds: a.knowledgeScope.collectionIds.filter((c) => c !== id) } }),
  )
  forgetRef(collectionRef(id))
  db.remove('collections', id)
  logActivity({
    actor: ME,
    verb: 'deleted',
    target: collectionRef(id),
    summary: `Deleted collection “${cur.name}”${moved ? ` (${moved} item${moved === 1 ? '' : 's'} kept without a collection)` : ''}`,
  })
}

// ---------------------------------------------------------------- tags

/** Rename a tag on every item (merging with `to` when both exist). Returns the number of items changed. */
export function renameTag(from: string, to: string): number {
  const a = normalizeTag(from)
  const b = normalizeTag(to)
  if (!a || !b || a === b) return 0
  const affected = db.filter('knowledge', (k) => k.tags.includes(a))
  const changed = updateRows(
    'knowledge',
    (k) => k.tags.includes(a),
    (k) => ({ ...k, tags: normalizeTags(k.tags.map((t) => (t === a ? b : t))), updatedAt: Date.now() }),
  )
  if (changed) {
    logActivity({
      actor: ME,
      verb: 'updated',
      target: itemRef(affected[0].id),
      summary: `Renamed tag #${a} to #${b} on ${changed} item${changed === 1 ? '' : 's'}`,
      meta: { from: a, to: b, itemIds: affected.map((k) => k.id) },
    })
  }
  return changed
}

/** Remove a tag from every item. Returns the number of items changed. */
export function removeTag(tag: string): number {
  const t = normalizeTag(tag)
  if (!t) return 0
  const affected = db.filter('knowledge', (k) => k.tags.includes(t))
  const changed = updateRows(
    'knowledge',
    (k) => k.tags.includes(t),
    (k) => ({ ...k, tags: k.tags.filter((x) => x !== t), updatedAt: Date.now() }),
  )
  if (changed) {
    logActivity({
      actor: ME,
      verb: 'updated',
      target: itemRef(affected[0].id),
      summary: `Removed tag #${t} from ${changed} item${changed === 1 ? '' : 's'}`,
      meta: { tag: t, itemIds: affected.map((k) => k.id) },
    })
  }
  return changed
}

// ---------------------------------------------------------------- hooks

export interface KnowledgeFilter {
  /** A collection id, or null for items without a collection. */
  collectionId?: ID | null
  projectId?: ID
  kind?: KnowledgeKind | KnowledgeKind[]
  tag?: string
  /** Case-insensitive; every word must appear in the title, summary, tags or content. */
  query?: string
}

const searchTextCache = new WeakMap<KnowledgeItem, string>()

function searchText(item: KnowledgeItem): string {
  let text = searchTextCache.get(item)
  if (text === undefined) {
    text = `${item.title}\n${item.summary ?? ''}\n${item.tags.join(' ')}\n${item.file?.name ?? ''}\n${item.content}`.toLowerCase()
    searchTextCache.set(item, text)
  }
  return text
}

/** Pure filter used by `useKnowledge` (exported for tests and non-React callers). */
export function matchesKnowledge(item: KnowledgeItem, filter: KnowledgeFilter): boolean {
  if (filter.collectionId !== undefined && item.collectionId !== filter.collectionId) return false
  if (filter.projectId && !item.projectIds.includes(filter.projectId)) return false
  if (filter.kind && !(Array.isArray(filter.kind) ? filter.kind.includes(item.kind) : item.kind === filter.kind)) return false
  if (filter.tag && !item.tags.includes(normalizeTag(filter.tag))) return false
  const terms = filter.query?.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms?.length) {
    const text = searchText(item)
    if (!terms.every((term) => text.includes(term))) return false
  }
  return true
}

/** Knowledge items matching a filter: pinned first, then most recently updated. */
export function useKnowledge(filter: KnowledgeFilter = {}): KnowledgeItem[] {
  return useRows(
    'knowledge',
    (k) => matchesKnowledge(k, filter),
    (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt,
  )
}

export function useKnowledgeItem(id: ID | null | undefined): KnowledgeItem | undefined {
  return useRow('knowledge', id)
}

export function useCollections(): Collection[] {
  return useRows('collections', undefined, (a, b) => a.name.localeCompare(b.name))
}

export interface TagCount {
  tag: string
  count: number
}

/** Tag usage across Knowledge, most used first (memoized per knowledge-table version). */
export function computeTags(knowledge: Tables['knowledge']): TagCount[] {
  return memoOnTable(knowledge, 'tags', () => {
    const counts = new Map<string, number>()
    for (const item of Object.values(knowledge)) for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  })
}

export function useTags(): TagCount[] {
  return useDB((s) => computeTags(s.knowledge))
}
