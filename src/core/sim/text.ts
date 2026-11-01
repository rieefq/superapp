/**
 * Small, dependency-free text helpers shared by the simulation generators: key-term
 * extraction, topic phrases, comparisons, slugs and excerpts. Pure functions only.
 */

const STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between ' +
    'both but by can could did do does doing down during each few for from further had has have having he her here ' +
    'hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off ' +
    'on once only or other our ours ourselves out over own same she should so some such than that the their theirs ' +
    'them themselves then there these they this those through to too under until up very was we were what when where ' +
    'which while who whom why will with would you your yours yourself yourselves us via per vs versus etc eg ie lets ' +
    'let get got gets getting make makes made making use used uses using need needs want wants way ways thing things ' +
    'something anything everything stuff really much many lot lots best good better new within without across around ' +
    'toward towards whether shall may might must ought one two three please tell explain describe find look looking ' +
    'currently actually still even well like just kind sort able'
  ).split(/\s+/),
)

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu

/** Words that open a question ("how does…", "should we…") and carry no topic. */
const LEADING = new Set([
  'how', 'what', 'whats', "what's", 'why', 'when', 'where', 'which', 'who', 'whom', 'whose', 'should', 'could', 'would',
  'can', 'do', 'does', 'did', 'is', 'are', 'was', 'were', 'will', 'has', 'have', 'had', 'we', 'i', 'you', 'it',
  'there', 'the', 'a', 'an', 'to', 'best', 'way', 'ways', 'most', 'much', 'many', 'be', 'been', 'might', 'may', 'must',
  'shall', 'lets', "let's", 'please', 'tell', 'me', 'us', 'explain', 'describe', 'find', 'out', 'about', 'research',
  'investigate', 'analyze', 'analyse', 'understand', 'our', 'my', 'need', 'want', 'know', 'think', 'really',
])

/** Words that look like ordinary vocabulary even when capitalized at the start of a sentence. */
const COMMON_SUFFIX = /(ing|ed|tion|tions|ment|ments|ness|ity|ies|al|ive|ous|ful|less|ly|er|ers|ics|based|ship|ence|ance)$/i

export function words(text: string): string[] {
  return text.match(WORD_RE) ?? []
}

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase())
}

function isAcronym(raw: string): boolean {
  return /^[A-Z0-9][A-Z0-9&+-]{1,7}$/.test(raw) && /[A-Z]/.test(raw)
}

/** Proper-noun-ish: inner capitals (SaaS, eInvoice), acronyms, or capitalized mid-sentence. */
function keepCase(raw: string, index: number): boolean {
  if (isAcronym(raw)) return true
  if (/^[\p{Ll}\p{N}]+[\p{Lu}]/u.test(raw) || /^\p{Lu}.*\p{Lu}/u.test(raw)) return true
  if (!/^\p{Lu}/u.test(raw)) return false
  if (index > 0) return true
  return !COMMON_SUFFIX.test(raw)
}

/**
 * The most informative terms of a text, in order of first appearance.
 * Proper nouns and acronyms keep their casing; everything else is lowercased.
 */
export function keyTerms(text: string, max = 5, extraStop?: ReadonlySet<string>): string[] {
  const tokens = words(text)
  const seen = new Map<string, { term: string; score: number; first: number }>()
  tokens.forEach((raw, i) => {
    const clean = raw.replace(/['’]s$/i, '')
    const lower = clean.toLowerCase()
    if (STOPWORDS.has(lower) || extraStop?.has(lower)) return
    if (/^\d+$/.test(lower)) return
    const acronym = isAcronym(clean)
    if (lower.length < 3 && !acronym) return
    const proper = keepCase(clean, i)
    const entry = seen.get(lower) ?? { term: proper ? clean : lower, score: 0, first: i }
    entry.score += 1 + (proper ? 1.2 : 0) + Math.min(lower.length, 12) / 12
    seen.set(lower, entry)
  })
  return [...seen.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .slice(0, max)
    .sort((a, b) => a.first - b.first)
    .map((e) => e.term)
}

/** Remove trailing sentence punctuation and collapse whitespace. */
export function cleanSentence(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[\s?!.;,:]+$/, '')
}

/**
 * The subject of a question, usable inside templates: "Why do logistics customers churn?"
 * → "logistics customers churn"; "EU e-invoicing mandate: impact on Atlas" → "EU e-invoicing mandate".
 */
export function topicPhrase(text: string, maxWords = 7): string {
  let cleaned = cleanSentence(text)
  const colon = cleaned.indexOf(':')
  if (colon > 0) {
    const left = cleaned.slice(0, colon).trim()
    const right = cleaned.slice(colon + 1).trim()
    cleaned = words(left).length >= 2 ? left : right || left
  }
  const parts = cleaned.split(' ').filter(Boolean)
  let i = 0
  while (i < parts.length - 1 && LEADING.has(parts[i].toLowerCase().replace(/[^a-z'’]/g, ''))) i++
  let kept = parts.slice(i)
  // Drop trailing pronoun phrases ("… against us", "… for our team").
  while (kept.length > 2 && /^(us|we|me|them|it|our|my|team|teams|company)$/i.test(kept[kept.length - 1].replace(/[^\w]/g, ''))) {
    kept = kept.slice(0, -1)
    if (kept.length > 2 && /^(against|for|to|with|on|in|at|of|by|from|the|our|my)$/i.test(kept[kept.length - 1])) kept = kept.slice(0, -1)
  }
  kept = kept.map((w) => (/^(our|my)$/i.test(w) ? 'the' : w)).filter((w) => !/^(we|us)$/i.test(w))
  let phrase = kept.slice(0, maxWords).join(' ').replace(/[,;:–—-]+$/, '').trim()
  if (words(phrase).length < 2) {
    const terms = keyTerms(text, 3)
    if (terms.length) phrase = terms.join(' ')
  }
  if (!phrase) return 'this topic'
  const first = phrase.split(' ')[0]
  return i === 0 && !keepCase(first, 0) ? lowerFirst(phrase) : phrase
}

export interface Comparison {
  a: string
  b: string
}

function trimSubject(text: string, fromEnd: boolean): string {
  const ws = cleanSentence(text)
    .replace(/^(the|a|an|our|their|between)\s+/i, '')
    .split(' ')
    .filter(Boolean)
  const picked = fromEnd ? ws.slice(-3) : ws.slice(0, 3)
  return picked.join(' ').replace(/^(the|a|an)\s+/i, '').replace(/[,;:]+$/, '')
}

/** Detect "A vs B", "compare A and B", "difference between A and B", "should we A or B". */
export function detectComparison(text: string): Comparison | null {
  const t = cleanSentence(text)
  let m = /(.+?)\s+(?:vs\.?|versus)\s+(.+)/i.exec(t)
  if (m) return pair(trimSubject(m[1], true), trimSubject(m[2], false))
  m = /\bcompar(?:e|ing|ison of)\s+(.+?)\s+(?:and|with|to|against)\s+(.+)/i.exec(t)
  if (m) return pair(trimSubject(m[1], false), trimSubject(m[2], false))
  m = /\bdifferences?\s+between\s+(.+?)\s+and\s+(.+)/i.exec(t)
  if (m) return pair(trimSubject(m[1], false), trimSubject(m[2], false))
  m = /^(?:should\s+(?:we|i)|which\s+is\s+better[,:]?|is\s+it\s+better\s+to|do\s+we)\s+(.+?)\s+or\s+(.+)/i.exec(t)
  if (m) return pair(trimSubject(m[1], false), trimSubject(m[2], false).split(' ')[0])
  return null
}

function pair(a: string, b: string): Comparison | null {
  if (!a || !b || a.toLowerCase() === b.toLowerCase()) return null
  return { a, b }
}

export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

export function lowerFirst(text: string): string {
  if (!text) return text
  const first = text.split(' ')[0]
  if (isAcronym(first) || /^\p{Lu}.*\p{Lu}/u.test(first)) return text
  return text[0].toLowerCase() + text.slice(1)
}

/** Truncate at a word boundary with an ellipsis. */
export function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`
}

/** A short title from free text: first sentence, no trailing punctuation, capitalized. */
export function titleFromText(text: string, max = 64): string {
  const firstLine = text.trim().split(/\n/)[0] ?? ''
  const sentence = /^(.+?[.!?])(\s|$)/.exec(firstLine)?.[1] ?? firstLine
  return capitalize(shorten(cleanSentence(sentence), max)) || 'Untitled'
}

export function slugify(text: string, max = 48): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= max) return slug || 'change'
  const cut = slug.slice(0, max)
  const dash = cut.lastIndexOf('-')
  return (dash > max * 0.5 ? cut.slice(0, dash) : cut).replace(/-+$/, '') || 'change'
}

export function camelCase(text: string): string {
  const ws = words(text.replace(/[_-]+/g, ' ')).map((w) => w.toLowerCase())
  return ws.map((w, i) => (i === 0 ? w : capitalize(w))).join('')
}

export function pascalCase(text: string): string {
  return capitalize(camelCase(text))
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[], conj = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`
}

/** Replace `{name}` placeholders; unknown placeholders are left empty. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '').replace(/\s{2,}/g, ' ').trim()
}

/** Strip markdown to prose (headings, emphasis, links, lists, tables, code fences). */
export function stripMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, '\n')
    .replace(/(`{3,}|~{3,})[\s\S]*?\1/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|\W)[*_](\S[^*_\n]*?)[*_](?=\W|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First sentence(s) of a passage as clean prose, at most `max` characters, ending with punctuation. */
export function excerpt(text: string, max = 180): string {
  const prose = stripMarkdown(text)
  if (!prose) return ''
  const sentences = prose.match(/[^.!?]+[.!?]+["”’)]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [prose]
  let out = ''
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s
    if (next.length > max) break
    out = next
  }
  if (!out) out = shorten(sentences[0], max)
  return /[.!?…"”’)]$/.test(out) ? out : `${out}.`
}

/** Light stemming used for fuzzy keyword matching ("expiry", "expires" → "expir"). */
export function stem(word: string): string {
  const w = word.toLowerCase()
  if (w.length <= 4) return w
  const rules: Array<[RegExp, string]> = [
    [/ations?$/, 'at'],
    [/ings?$/, ''],
    [/ies$/, 'y'],
    [/(ss)$/, '$1'],
    [/es$/, 'e'],
    [/s$/, ''],
    [/ed$/, ''],
    [/ly$/, ''],
    [/ments?$/, ''],
  ]
  let out = w
  for (const [re, rep] of rules) {
    if (re.test(out)) {
      const next = out.replace(re, rep)
      if (next.length >= 4) out = next
      break
    }
  }
  return out.replace(/[yie]$/, '').length >= 4 ? out.replace(/[yie]$/, '') : out
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
