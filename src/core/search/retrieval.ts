import type { Tables } from '@/core/db'
import type { ID, KnowledgeItem } from '@/core/types'
import { Bm25Index, type IndexTerm } from './bm25'
import { parseQuery } from './query'
import { analyze, toPlainText } from './text'
import type { RetrievedPassage, RetrieveOptions } from './types'

export const PASSAGE_TARGET_CHARS = 700
export const DEFAULT_RETRIEVE_LIMIT = 5
/** Inside a project scope, items that belong to no project stay eligible at this weight. */
export const UNSCOPED_ITEM_FACTOR = 0.6
/** Title tokens are added to every passage so the item's topic lifts all of its passages. */
const PASSAGE_TITLE_WEIGHT = 2
/** Long conversational queries keep only their rarest terms. */
const MAX_QUERY_TERMS = 32
const MAX_CONTENT_CHARS = 200_000

const HEADING_RE = /^#{1,6}\s/

/** Split one oversized block at line breaks, else sentence ends, else whitespace. */
function splitLongBlock(block: string, target: number): string[] {
  const byLines = block.includes('\n')
  const pieces = byLines ? block.split('\n') : block.split(/(?<=[.!?])\s+/)
  const sep = byLines ? '\n' : ' '
  const out: string[] = []
  let current = ''
  for (const piece of pieces.flatMap((p) => (p.length > target * 1.4 ? hardSplit(p, target) : [p]))) {
    if (current && current.length + sep.length + piece.length > target) {
      out.push(current)
      current = ''
    }
    current = current ? current + sep + piece : piece
  }
  if (current) out.push(current)
  return out
}

function hardSplit(text: string, target: number): string[] {
  const out: string[] = []
  let rest = text
  while (rest.length > target * 1.4) {
    let cut = rest.lastIndexOf(' ', target)
    if (cut < target * 0.5) cut = target
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest) out.push(rest)
  return out
}

/**
 * Split content into ~`target`-character passages along paragraph boundaries. Short
 * paragraphs are packed together, oversized ones are split by lines/sentences, and a
 * heading is never left at the end of a passage (it moves to the passage it introduces).
 */
export function splitPassages(content: string, target = PASSAGE_TARGET_CHARS): string[] {
  const units: string[] = []
  for (const raw of content.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const block = raw.trim()
    if (!block) continue
    if (block.length > target * 1.4) units.push(...splitLongBlock(block, target))
    else units.push(block)
  }
  const passages: string[] = []
  let current: string[] = []
  let size = 0
  for (const unit of units) {
    const onlyHeading = current.length === 1 && HEADING_RE.test(current[0])
    if (current.length && !onlyHeading && size + 2 + unit.length > target) {
      const carry = current.length > 1 && HEADING_RE.test(current[current.length - 1]) ? current.pop() : undefined
      passages.push(current.join('\n\n'))
      current = carry ? [carry] : []
      size = carry ? carry.length : 0
    }
    size += (current.length ? 2 : 0) + unit.length
    current.push(unit)
  }
  if (current.length) passages.push(current.join('\n\n'))
  return passages
}

function addTerms(into: Map<string, IndexTerm>, text: string, weight: number): void {
  for (const t of analyze(text)) {
    const cur = into.get(t.surface)
    if (cur) cur.weight += weight
    else into.set(t.surface, { stem: t.stem, surface: t.surface, weight })
  }
}

/**
 * Passage-level BM25 index over knowledge content, used to ground AI answers.
 * Like EntityIndex it is pure: `sync` takes the knowledge table and re-indexes changed rows.
 */
export class PassageIndex {
  private readonly bm25 = new Bm25Index()
  private readonly passages = new Map<string, { itemId: ID; text: string }>()
  private readonly itemKeys = new Map<ID, string[]>()
  private synced: Tables['knowledge'] | null = null

  get built(): boolean {
    return this.synced !== null
  }

  get size(): number {
    return this.passages.size
  }

  isStale(knowledge: Tables['knowledge']): boolean {
    return this.synced !== knowledge
  }

  sync(knowledge: Tables['knowledge']): boolean {
    const prev = this.synced
    if (prev === knowledge) return false
    if (prev) for (const id in prev) if (!(id in knowledge)) this.removeItem(id)
    for (const id in knowledge) if (!prev || prev[id] !== knowledge[id]) this.indexItem(knowledge[id])
    this.synced = knowledge
    return true
  }

  private removeItem(id: ID): void {
    for (const key of this.itemKeys.get(id) ?? []) {
      this.bm25.delete(key)
      this.passages.delete(key)
    }
    this.itemKeys.delete(id)
  }

  private indexItem(item: KnowledgeItem): void {
    this.removeItem(item.id)
    const content = item.content.length > MAX_CONTENT_CHARS ? item.content.slice(0, MAX_CONTENT_CHARS) : item.content
    let texts = splitPassages(content)
    if (!texts.length) texts = [item.summary || item.title].filter(Boolean)
    const shared = new Map<string, IndexTerm>()
    addTerms(shared, item.title, PASSAGE_TITLE_WEIGHT)
    if (item.tags.length) addTerms(shared, item.tags.join(' '), 1)
    const keys = texts.map((text, i) => {
      const key = `${item.id}#${i}`
      const terms = new Map<string, IndexTerm>()
      addTerms(terms, toPlainText(text), 1)
      for (const t of shared.values()) {
        const cur = terms.get(t.surface)
        if (cur) cur.weight += t.weight
        else terms.set(t.surface, { ...t })
      }
      this.bm25.set(key, [...terms.values()])
      this.passages.set(key, { itemId: item.id, text })
      return key
    })
    this.itemKeys.set(item.id, keys)
  }

  /** Best passage per item, top `limit` items (see RetrieveOptions for scoping rules). */
  retrieve(query: string, opts: RetrieveOptions, knowledge: Tables['knowledge']): RetrievedPassage[] {
    const limit = Math.max(0, opts.limit ?? DEFAULT_RETRIEVE_LIMIT)
    if (!query.trim() || !limit) return []
    const parsed = parseQuery(query, this.bm25, { prefix: false, maxTerms: MAX_QUERY_TERMS })
    if (!parsed.groups.length) return []
    const ids = opts.ids ? new Set(opts.ids) : null
    const scope = opts.projectId ?? null

    const best = new Map<ID, { key: string; score: number; item: KnowledgeItem }>()
    for (const [key, s] of this.bm25.score(parsed.groups)) {
      const passage = this.passages.get(key)
      if (!passage || (ids && !ids.has(passage.itemId))) continue
      const item = knowledge[passage.itemId]
      if (!item) continue
      let score = s.score
      if (scope && !item.projectIds.includes(scope)) {
        if (!item.projectIds.length) score *= UNSCOPED_ITEM_FACTOR
        else if (!ids) continue
      }
      const cur = best.get(item.id)
      if (!cur || score > cur.score) best.set(item.id, { key, score, item })
    }
    return [...best.values()]
      .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
      .slice(0, limit)
      .map(({ key, score, item }) => ({ item, passage: this.passages.get(key)?.text ?? '', score }))
  }
}
