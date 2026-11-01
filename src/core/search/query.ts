import type { Bm25Index, QueryGroup } from './bm25'
import { tokenize } from './text'

/** Weight of prefix completions relative to an exact term match. */
export const PREFIX_WEIGHT = 0.85
export const MAX_PREFIX_EXPANSIONS = 50

/** What to highlight in snippets/titles for a query. */
export interface HighlightSpec {
  /** Stems of the query's terms. */
  stems: ReadonlySet<string>
  /** Folded surface of the word being typed (matched as a prefix), if any. */
  prefix: string | null
}

export interface ParsedQuery {
  groups: QueryGroup[]
  /** " stem stem " — the query's terms in order, for the exact-phrase bonus; null with fewer than 2 terms. */
  phrase: string | null
  highlight: HighlightSpec
}

export interface ParseOptions {
  /** Treat the last word as a prefix while it is being typed (no trailing space). */
  prefix: boolean
  /** Keep only the rarest N terms (long conversational queries). Requires an index. */
  maxTerms?: number
}

/**
 * Turn raw input into scoring groups. Every complete non-stopword term is a required
 * group. The word being typed becomes a group of its exact stem plus the index's
 * completions for it; it is optional when it cannot stand on its own (a single letter
 * or a stopword such as "fo" on the way to "forge").
 */
export function parseQuery(raw: string, index: Bm25Index | null, opts: ParseOptions): ParsedQuery {
  const tokens = tokenize(raw)
  const last = tokens[tokens.length - 1]
  const typing = opts.prefix && last !== undefined && last.end === raw.length
  const complete = typing ? tokens.slice(0, -1) : tokens

  const groups: QueryGroup[] = []
  const stems = new Set<string>()
  const phraseStems: string[] = []
  for (const t of complete) {
    if (!t.isTerm) continue
    phraseStems.push(t.stem)
    if (stems.has(t.stem)) continue
    stems.add(t.stem)
    groups.push({ terms: new Map([[t.stem, 1]]), required: true })
  }

  let prefix: string | null = null
  if (typing && last) {
    const terms = new Map<string, number>()
    if (last.isTerm) {
      terms.set(last.stem, 1)
      phraseStems.push(last.stem)
    }
    if (index) {
      for (const s of index.expandPrefix(last.surface, MAX_PREFIX_EXPANSIONS)) if (!terms.has(s)) terms.set(s, PREFIX_WEIGHT)
    }
    prefix = last.surface
    const duplicate = last.isTerm && stems.has(last.stem) && terms.size === 1
    if (terms.size && !duplicate) groups.push({ terms, required: last.isTerm })
    if (last.isTerm) stems.add(last.stem)
  }

  let kept = groups
  if (opts.maxTerms !== undefined && index && groups.length > opts.maxTerms) {
    const rarity = (g: QueryGroup) => Math.max(...[...g.terms.keys()].map((s) => index.idf(s)))
    kept = [...groups].sort((a, b) => rarity(b) - rarity(a)).slice(0, opts.maxTerms)
  }

  return {
    groups: kept,
    phrase: phraseStems.length >= 2 ? ` ${phraseStems.join(' ')} ` : null,
    highlight: { stems, prefix },
  }
}
