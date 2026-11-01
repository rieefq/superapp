import { db, type RowOf, type TableName } from '@/core/db'
import { getContext } from '@/core/context'
import { HUES, refKey, sameRef, type EntityRef, type Hue } from '@/core/types'
import { truncate } from '@/lib/format'
import { link } from './links'

// ---------------------------------------------------------------- derived-value memo

/**
 * Tables are immutable records that are replaced on every write, so a value derived
 * from one table can be cached on the table object itself. Hooks use this to keep
 * selectors cheap and their results referentially stable between unrelated writes.
 */
const tableMemo = new WeakMap<object, Map<string, unknown>>()

export function memoOnTable<R>(table: object, key: string, compute: () => R): R {
  let entries = tableMemo.get(table)
  if (!entries) {
    entries = new Map()
    tableMemo.set(table, entries)
  }
  if (entries.has(key)) return entries.get(key) as R
  const value = compute()
  entries.set(key, value)
  return value
}

/** Coarse time bucket for memo keys of time-dependent values (overdue, last 24h…). */
export function timeBucket(ms: number, now = Date.now()): number {
  return Math.floor(now / ms)
}

// ---------------------------------------------------------------- batched writes

/** Apply `update` to every row matching `pred` in a single store write. Returns how many rows changed. */
export function updateRows<T extends TableName>(
  table: T,
  pred: (row: RowOf<T>) => boolean,
  update: (row: RowOf<T>) => RowOf<T>,
): number {
  const changed: RowOf<T>[] = []
  for (const row of db.all(table)) {
    if (!pred(row)) continue
    const next = update(row)
    if (next !== row) changed.push(next)
  }
  db.insertMany(table, changed)
  return changed.length
}

// ---------------------------------------------------------------- entity graph

const plainRef = (ref: EntityRef): EntityRef => ({ kind: ref.kind, id: ref.id })

/**
 * Record that `target` was created from `source`: link target —derived_from→ source and,
 * when the source is a chat message, append the target to `message.derived` for backlinks.
 * Idempotent.
 */
export function markDerived(target: EntityRef, source: EntityRef): void {
  if (sameRef(target, source)) return
  link(plainRef(target), plainRef(source), 'derived_from')
  if (source.kind === 'message') {
    db.update('messages', source.id, (m) =>
      m.derived?.some((r) => sameRef(r, target)) ? m : { ...m, derived: [...(m.derived ?? []), plainRef(target)] },
    )
  }
}

/**
 * Remove every reference to entities that are being deleted: links, context pins,
 * project memory, conversation context and message backlinks. One write per table.
 */
export function forgetRefs(refs: readonly EntityRef[]): void {
  if (!refs.length) return
  const keys = new Set(refs.map(refKey))
  const gone = (r: EntityRef) => keys.has(refKey(r))
  db.removeMany(
    'links',
    db.filter('links', (l) => gone(l.from) || gone(l.to)).map((l) => l.id),
  )
  const ctx = getContext()
  for (const p of ctx.pinned) if (gone(p.ref)) ctx.unpin(p.ref)
  updateRows('projects', (p) => p.pinnedRefs.some(gone), (p) => ({ ...p, pinnedRefs: p.pinnedRefs.filter((r) => !gone(r)) }))
  updateRows('threads', (t) => t.contextRefs.some(gone), (t) => ({ ...t, contextRefs: t.contextRefs.filter((r) => !gone(r)) }))
  updateRows(
    'messages',
    (m) => !!m.derived?.some(gone),
    (m) => ({ ...m, derived: (m.derived ?? []).filter((r) => !gone(r)) }),
  )
}

export function forgetRef(ref: EntityRef): void {
  forgetRefs([ref])
}

// ---------------------------------------------------------------- small utilities

/** The identity hue used least among `used` (ties resolve in HUES order). */
export function leastUsedHue(used: readonly Hue[]): Hue {
  const counts = new Map<Hue, number>(HUES.map((h) => [h, 0]))
  for (const h of used) counts.set(h, (counts.get(h) ?? 0) + 1)
  let best: Hue = HUES[0]
  for (const h of HUES) if ((counts.get(h) ?? 0) < (counts.get(best) ?? 0)) best = h
  return best
}

/** Keys of `patch` whose values differ from `row` (deep-compared via JSON for arrays/objects). */
export function changedKeys<R extends object>(row: R, patch: Partial<R>): (keyof R)[] {
  const out: (keyof R)[] = []
  for (const key of Object.keys(patch) as (keyof R)[]) {
    const a = row[key]
    const b = patch[key]
    const same = a === b || (typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b))
    if (!same) out.push(key)
  }
  return out
}

// ---------------------------------------------------------------- text

/** Collapse whitespace and clip to one line of at most `max` characters. */
export function clipLine(text: string, max: number): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), max)
}

/** Markdown → readable plain text (keeps code content, link targets and list structure). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, '')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * First sentences of a (markdown) text, for auto-summaries. Headings, code blocks and
 * tables are skipped because they are not prose.
 */
export function firstSentences(markdown: string, maxSentences = 2, maxChars = 240): string {
  const prose = markdown
    .replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, '\n')
    .split('\n')
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line) && !/^\s*\|/.test(line))
    .join('\n')
  const flat = plainText(prose).replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const sentences = flat.match(/[^.!?]+(?:[.!?]+["”’)\]]*|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [flat]
  let out = ''
  for (const sentence of sentences.slice(0, maxSentences)) {
    const next = out ? `${out} ${sentence}` : sentence
    if (next.length > maxChars) break
    out = next
  }
  return out || truncate(sentences[0], maxChars)
}
