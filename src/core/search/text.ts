/**
 * Text analysis shared by the search index, query parsing, snippets and retrieval.
 * Index and query sides must use exactly the same pipeline:
 *   fold (lowercase, strip diacritics and apostrophes) → drop stopwords/short tokens → stem.
 */

const STOPWORD_LIST = `a about above after again against all also am an and any are as at be because been before being below
between both but by can could did do does doing down during each few for from further had has have having he her here
hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once
only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves
then there these they this those through to too under until up very was we were what when where which while who whom
why will with would you your yours yourself yourselves dont doesnt didnt isnt arent wasnt werent cant couldnt wont
wouldnt shouldnt im ive id youre youve theyre thats whats lets http https www`

export const STOPWORDS: ReadonlySet<string> = new Set(STOPWORD_LIST.split(/\s+/))

export const MIN_TOKEN_LENGTH = 2
export const MAX_TOKEN_LENGTH = 40

// A token starts with a letter or digit and continues with letters, digits, combining marks or apostrophes.
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu
const NON_ASCII_RE = /[^\x00-\x7f]/
const MARKS_RE = /\p{M}+/gu
const APOSTROPHES_RE = /['’]/g

/** Lowercase, strip diacritics (é → e) and apostrophes (don't → dont). */
export function fold(text: string): string {
  const base = NON_ASCII_RE.test(text) ? text.normalize('NFKD').replace(MARKS_RE, '') : text
  return base.toLowerCase().replace(APOSTROPHES_RE, '')
}

const LETTERS_ONLY_RE = /^[a-z]+$/
const HAS_VOWEL_RE = /[aeiouy]/

function undouble(stem: string): string {
  const n = stem.length
  const last = stem[n - 1]
  return n >= 2 && last === stem[n - 2] && !'aeiouylsz'.includes(last) ? stem.slice(0, -1) : stem
}

/**
 * Light English stemmer: plural (s/es/ies), -ing, -ed and a final silent e.
 * Deliberately conservative; it only has to map the index and the query to the same form
 * ("pricing", "prices", "priced" → "pric").
 */
export function stem(word: string): string {
  if (word.length <= 3 || !LETTERS_ONLY_RE.test(word)) return word
  let s = word
  if (s.length > 4 && s.endsWith('ies')) s = `${s.slice(0, -3)}y`
  else if (s.endsWith('sses') || s.endsWith('xes') || s.endsWith('ches') || s.endsWith('shes')) s = s.slice(0, -2)
  else if (s.endsWith('s') && !s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is')) s = s.slice(0, -1)

  // -ing/-ed stems drop the silent e ("making" → "mak"), so the base form drops it too ("make" → "mak").
  if (s.endsWith('ing') && s.length >= 6 && HAS_VOWEL_RE.test(s.slice(0, -3))) s = undouble(s.slice(0, -3))
  else if (s.endsWith('ed') && s.length >= 5 && HAS_VOWEL_RE.test(s.slice(0, -2))) s = undouble(s.slice(0, -2))
  else if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

/** True when a folded token carries meaning for search (not a stopword, sensible length). */
export function isTermSurface(surface: string): boolean {
  return surface.length >= MIN_TOKEN_LENGTH && surface.length <= MAX_TOKEN_LENGTH && !STOPWORDS.has(surface)
}

export interface Token {
  /** [start, end) offsets in the original text. */
  start: number
  end: number
  /** Folded form (lowercase, no diacritics/apostrophes). */
  surface: string
  stem: string
  /** False for stopwords and tokens that are too short/long to index. */
  isTerm: boolean
}

/** Tokenize with offsets into the original string (used for snippets and highlighting). */
export function tokenize(text: string): Token[] {
  const out: Token[] = []
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    const surface = fold(m[0])
    const isTerm = isTermSurface(surface)
    out.push({ start: m.index, end: m.index + m[0].length, surface, stem: isTerm ? stem(surface) : surface, isTerm })
  }
  return out
}

export interface Term {
  surface: string
  stem: string
}

/** Index-side analysis: only meaningful terms, in order (no offsets). */
export function analyze(text: string): Term[] {
  const out: Term[] = []
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(text); m; m = TOKEN_RE.exec(text)) {
    const surface = fold(m[0])
    if (isTermSurface(surface)) out.push({ surface, stem: stem(surface) })
  }
  return out
}

/**
 * Markdown → plain text for indexing and snippets: drops syntax (headings, emphasis,
 * code fences, link targets, table rules) and collapses whitespace.
 */
export function toPlainText(markdown: string): string {
  if (!markdown) return ''
  return markdown
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/^\s*(?:[-*_]\s*){3,}$/gm, ' ')
    .replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-*:?\s*$/gm, ' ')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/\s*\|\s*/g, ' · ')
    .replace(/\s+/g, ' ')
    .trim()
}
