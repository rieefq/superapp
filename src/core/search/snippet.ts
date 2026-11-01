import type { EntityRef } from '@/core/types'
import { parseQuery, type HighlightSpec } from './query'
import { tokenize } from './text'

export const SNIPPET_LENGTH = 140

export type Range = [number, number]

interface Match {
  start: number
  end: number
  /** Which query term matched (distinct terms make a better snippet than repeats). */
  key: string
}

export interface Snippet {
  text: string
  /** [start, end) ranges in `text`. */
  highlights: Range[]
  /** Distinct query terms in the snippet window, and total matches. */
  distinct: number
  hits: number
}

function findMatches(text: string, spec: HighlightSpec): Match[] {
  const out: Match[] = []
  if (!spec.stems.size && !spec.prefix) return out
  for (const t of tokenize(text)) {
    if (!t.isTerm) continue
    if (spec.stems.has(t.stem)) out.push({ start: t.start, end: t.end, key: t.stem })
    else if (spec.prefix && t.surface.startsWith(spec.prefix)) out.push({ start: t.start, end: t.end, key: '\u0000prefix' })
  }
  return out
}

/** The first `maxLength` characters, cut at a word boundary. */
function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const cut = text.lastIndexOf(' ', maxLength - 1)
  return `${text.slice(0, cut > maxLength * 0.5 ? cut : maxLength - 1)}…`
}

/**
 * A ~maxLength excerpt of plain `text` around its best cluster of matches (most distinct
 * query terms, then most matches), cut at word boundaries, with "…" where truncated.
 */
export function buildSnippet(text: string, spec: HighlightSpec, maxLength = SNIPPET_LENGTH): Snippet {
  const matches = findMatches(text, spec)
  if (!matches.length) return { text: clip(text, maxLength), highlights: [], distinct: 0, hits: 0 }

  // Sliding window over matches whose span fits in maxLength.
  const counts = new Map<string, number>()
  const add = (m: Match) => counts.set(m.key, (counts.get(m.key) ?? 0) + 1)
  let best = { i: 0, j: 0, distinct: 0, hits: 0 }
  let j = -1
  for (let i = 0; i < matches.length; i++) {
    if (j < i) add(matches[(j = i)])
    while (j + 1 < matches.length && matches[j + 1].end - matches[i].start <= maxLength) add(matches[++j])
    const distinct = counts.size
    const hits = j - i + 1
    if (distinct > best.distinct || (distinct === best.distinct && hits > best.hits)) best = { i, j, distinct, hits }
    const left = (counts.get(matches[i].key) ?? 1) - 1
    if (left) counts.set(matches[i].key, left)
    else counts.delete(matches[i].key)
  }

  const spanStart = matches[best.i].start
  const spanEnd = matches[best.j].end
  let start = 0
  let end = text.length
  if (text.length > maxLength) {
    const slack = Math.max(0, maxLength - (spanEnd - spanStart))
    start = Math.max(0, spanStart - Math.floor(slack * 0.35))
    end = Math.min(text.length, start + maxLength)
    start = Math.max(0, Math.min(start, end - maxLength))
    // Snap to word boundaries without cutting into the matched span.
    if (start > 0 && text[start - 1] !== ' ') {
      const space = text.indexOf(' ', start)
      if (space !== -1 && space < spanStart) start = space + 1
    }
    if (end < text.length && text[end] !== ' ') {
      const space = text.lastIndexOf(' ', end)
      if (space >= spanEnd) end = space
    }
    while (end > start && text[end - 1] === ' ') end--
  }
  const lead = start > 0 ? '…' : ''
  const tail = end < text.length ? '…' : ''
  const offset = lead.length - start
  const highlights: Range[] = []
  for (const m of matches) {
    if (m.start < start || m.end > end) continue
    const range: Range = [m.start + offset, m.end + offset]
    const prev = highlights[highlights.length - 1]
    if (prev && range[0] <= prev[1]) prev[1] = Math.max(prev[1], range[1])
    else highlights.push(range)
  }
  return { text: lead + text.slice(start, end) + tail, highlights, distinct: best.distinct, hits: best.hits }
}

export interface SnippetSource {
  text: string
  anchor?: EntityRef
}

/** Pick the best-matching field (e.g. the best message of a thread) and excerpt it. */
export function bestSnippet(fields: readonly SnippetSource[], spec: HighlightSpec, maxLength = SNIPPET_LENGTH): Snippet & { anchor?: EntityRef } {
  let best: (Snippet & { anchor?: EntityRef }) | null = null
  let fallback: SnippetSource | undefined
  for (const field of fields) {
    if (!field.text) continue
    fallback ??= field
    const snippet = buildSnippet(field.text, spec, maxLength)
    if (!snippet.hits) continue
    if (!best || snippet.distinct > best.distinct || (snippet.distinct === best.distinct && snippet.hits > best.hits)) {
      best = field.anchor ? { ...snippet, anchor: field.anchor } : snippet
    }
  }
  if (best) return best
  if (!fallback) return { text: '', highlights: [], distinct: 0, hits: 0 }
  return { text: clip(fallback.text, maxLength), highlights: [], distinct: 0, hits: 0 }
}

/**
 * Ranges of `text` matching `query` with the same rules as search (stemming, diacritics,
 * the last word as a prefix) — use it to highlight result titles.
 */
export function highlightText(text: string, query: string): Range[] {
  const { highlight } = parseQuery(query, null, { prefix: true })
  const ranges: Range[] = []
  for (const m of findMatches(text, highlight)) {
    const prev = ranges[ranges.length - 1]
    if (prev && m.start <= prev[1]) prev[1] = Math.max(prev[1], m.end)
    else ranges.push([m.start, m.end])
  }
  return ranges
}
