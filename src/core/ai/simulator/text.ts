/**
 * Text utilities for the local answer composer: tokenizing, sentence splitting,
 * keyword extraction and small grammar helpers. Pure functions, no app state.
 */

const STOPWORD_LIST = `a about above after again against all also am an and any are aren't as at be because been
before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down
during each few for from further get gets got had hadn't has hasn't have haven't having he he'd he'll he's her here
here's hers herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself just let let's
like me more most mustn't my myself no nor not now of off on once only or other ought our ours ourselves out over own
please same shan't she she'd she'll she's should shouldn't so some such than thank thanks that that's the their
theirs them themselves then there there's these they they'd they'll they're they've this those through to too under
until up us very was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while
who who's whom why why's will with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
hey hi hello okay ok really maybe want need way ways thing things something anything help tell give show know think
make made use using used can could would should might may must lot lots kind sort good best better new one ones`

export const STOPWORDS: ReadonlySet<string> = new Set(STOPWORD_LIST.split(/\s+/).filter(Boolean))

/** Lowercased word tokens. Keeps tokens like `c++`, `c#`, `node.js`, `e-mail`, `q4`. */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/[’]/g, "'").match(/[a-z0-9][a-z0-9'+#.-]*[a-z0-9+#]|[a-z0-9]/g) ?? []
}

/** Number of words in markdown (tokens containing a letter or digit). */
export function countWords(md: string): number {
  let n = 0
  for (const token of md.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++
  return n
}

/** Light stemmer used only for matching ("tokens" ≈ "token", "refreshing" ≈ "refresh"). */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/'s$/, '')
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`
  else if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2)
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) w = w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3)
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2)
  return w
}

/** Unique, meaningful keywords in order of first appearance. */
export function keywords(text: string, limit = 12): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of words(text)) {
    if (w.length < 2 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue
    const s = stem(w)
    if (seen.has(s)) continue
    seen.add(s)
    out.push(w)
    if (out.length >= limit) break
  }
  return out
}

/** Stems of the keywords of `text`, for overlap scoring. */
export function keywordStems(text: string): Set<string> {
  return new Set(keywords(text, 64).map(stem))
}

const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'etc', 'vs', 'mr', 'mrs', 'ms', 'dr', 'prof', 'inc', 'ltd', 'co', 'jr', 'sr', 'st', 'no', 'fig',
  'approx', 'est', 'dept', 'u.s', 'a.m', 'p.m', 'cf', 'al',
])

/** Split one line of prose into sentences without breaking on abbreviations, initials or decimals. */
function splitLine(line: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue
    let j = i + 1
    while (j < line.length && /["”’')\]]/.test(line[j])) j++
    if (j >= line.length || !/\s/.test(line[j])) continue
    let k = j
    while (k < line.length && /\s/.test(line[k])) k++
    if (k >= line.length || !/["“‘'(\[\p{Lu}\p{N}*_]/u.test(line[k])) continue
    if (ch === '.') {
      const before = line.slice(start, i).split(/\s+/).pop() ?? ''
      const token = before.replace(/^["“(\[]+/, '').toLowerCase()
      if (ABBREVIATIONS.has(token) || /^\p{Lu}$/u.test(before)) continue
    }
    out.push(line.slice(start, j).trim())
    start = k
    i = k - 1
  }
  const rest = line.slice(start).trim()
  if (rest) out.push(rest)
  return out
}

/**
 * Split prose or markdown into sentences. Bullets and numbered items count as sentences;
 * headings, table rows and fenced code are skipped. Fragments under three words are dropped.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  let fence: string | null = null
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = raw.trim()
    const fenceMatch = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1]
      else if (trimmed.startsWith(fence)) fence = null
      continue
    }
    if (fence || !trimmed || trimmed.startsWith('#') || trimmed.startsWith('|')) continue
    const line = trimmed
      .replace(/^>\s?/, '')
      .replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/, '')
      .replace(/^\[[ xX]\]\s+/, '')
      .trim()
    for (const part of splitLine(line)) {
      if (countWords(part) >= 3) out.push(part)
    }
  }
  return out
}

/** Uppercase the first letter. */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/** Sentence case for user-typed text: fixes ALL-CAPS input, then capitalizes the first letter. */
export function sentenceCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '')
  const base = letters.length > 3 && letters === letters.toUpperCase() ? text.toLowerCase() : text
  return capitalize(base)
}

const MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'vs'])

/** Title Case, keeping minor words lowercase and acronyms intact. */
export function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((w, i) => (i > 0 && MINOR_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : capitalize(w)))
    .join(' ')
}

/** Words that may start a sentence but are not proper nouns (safe to lowercase mid-sentence). */
const COMMON_STARTERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'there', 'most',
  'many', 'some', 'each', 'every', 'all', 'any', 'when', 'if', 'for', 'in', 'on', 'at', 'by', 'with', 'after',
  'before', 'during', 'because', 'since', 'while', 'to', 'users', 'customers', 'teams', 'you', 'your', 'one', 'two',
  'three', 'no', 'not', 'only', 'both', 'new', 'existing', 'current', 'once', 'until', 'as', 'what', 'how', 'why',
  'where', 'which', 'who', 'support', 'sessions', 'tokens', 'pricing', 'customer', 'teams', 'engineers', 'people',
])

/** Lowercase a sentence's first letter when it is a common word (keeps "Lumen", "SSO", "I"). */
export function lowerFirst(sentence: string): string {
  const first = sentence.split(/\s+/)[0] ?? ''
  const bare = first.replace(/[^\p{L}']/gu, '')
  if (!bare || bare.length > 1 && bare[1] === bare[1].toUpperCase() && /\p{L}/u.test(bare[1])) return sentence
  if (!COMMON_STARTERS.has(bare.toLowerCase())) return sentence
  return sentence.charAt(0).toLowerCase() + sentence.slice(1)
}

/** Remove trailing sentence punctuation and whitespace. */
export function stripTrailingPunctuation(text: string): string {
  return text.replace(/[\s.,!?;:…—–-]+$/u, '')
}

/** Collapse runs of whitespace into single spaces. */
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** First `n` words of `text`, with an ellipsis when shortened. */
export function truncateWords(text: string, n: number): string {
  const parts = collapse(text).split(' ')
  if (parts.length <= n) return parts.join(' ')
  return `${stripTrailingPunctuation(parts.slice(0, n).join(' '))}…`
}

/** Make sure a sentence ends with terminal punctuation. */
export function ensurePeriod(sentence: string): string {
  const s = sentence.trim()
  return /[.!?…:]["”’)]?$/u.test(s) ? s : `${s}.`
}

const PERSON_SWAPS: Array<[RegExp, string]> = [
  [/\bI am\b/g, 'you are'],
  [/\bI'm\b/g, "you're"],
  [/\bI've\b/g, "you've"],
  [/\bI'd\b/g, "you'd"],
  [/\bI'll\b/g, "you'll"],
  [/\bI\b/g, 'you'],
  [/\b[Ww]e're\b/g, "you're"],
  [/\b[Ww]e've\b/g, "you've"],
  [/\b[Ww]e'll\b/g, "you'll"],
  [/\b[Ww]e'd\b/g, "you'd"],
  [/\bwe\b/g, 'you'],
  [/\bWe\b/g, 'You'],
  [/\b(?:my|our)\b/g, 'your'],
  [/\b(?:My|Our)\b/g, 'Your'],
  [/\b(?:me|us)\b/g, 'you'],
  [/\b(?:mine|ours)\b/g, 'yours'],
  [/\b(?:myself|ourselves)\b/g, 'yourself'],
]

/** Rewrite first person into second person ("my team" → "your team") for restating a request. */
export function swapPerson(text: string): string {
  let out = text.replace(/’/g, "'")
  for (const [re, rep] of PERSON_SWAPS) out = out.replace(re, rep)
  return out
}

const ING_EXCEPTIONS: Record<string, string> = {
  be: 'being', see: 'seeing', agree: 'agreeing', free: 'freeing', die: 'dying', lie: 'lying', tie: 'tying',
  set: 'setting', get: 'getting', put: 'putting', run: 'running', plan: 'planning', ship: 'shipping', stop: 'stopping',
  begin: 'beginning', forget: 'forgetting', admit: 'admitting', commit: 'committing', submit: 'submitting',
  permit: 'permitting', refer: 'referring', prefer: 'preferring', occur: 'occurring', control: 'controlling',
  debug: 'debugging', log: 'logging', map: 'mapping', drop: 'dropping', swap: 'swapping', scan: 'scanning',
  cut: 'cutting', hit: 'hitting', sit: 'sitting', win: 'winning', chat: 'chatting', pin: 'pinning', tag: 'tagging',
  wrap: 'wrapping', plug: 'plugging', go: 'going', do: 'doing', shop: 'shopping', bet: 'betting', jog: 'jogging',
}

/** "set" → "setting", "write" → "writing", "migrate" → "migrating", "fix" → "fixing". */
export function gerundWord(word: string): string {
  const lower = word.toLowerCase()
  const exception = ING_EXCEPTIONS[lower]
  let out: string
  if (exception) out = exception
  else if (lower.endsWith('ie')) out = `${lower.slice(0, -2)}ying`
  else if (/[^aeiouy]e$/.test(lower) || lower.endsWith('ue')) out = `${lower.slice(0, -1)}ing`
  else out = `${lower}ing`
  return word.charAt(0) === word.charAt(0).toUpperCase() && /\p{L}/u.test(word.charAt(0)) ? capitalize(out) : out
}

/** Turn a verb phrase into a gerund phrase: "set up SSO" → "setting up SSO". */
export function gerund(verbPhrase: string): string {
  const [first, ...rest] = verbPhrase.trim().split(/\s+/)
  if (!first) return verbPhrase
  return [gerundWord(first), ...rest].join(' ')
}

/** Third-person verb to base form: "parses" → "parse", "fetches" → "fetch", "applies" → "apply". */
export function baseVerb(word: string): string {
  const w = word.toLowerCase()
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (/(ss|sh|ch|x|z)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1)
  return w
}

/** Human list: ["a"] → "a"; ["a","b"] → "a and b"; ["a","b","c"] → "a, b and c". */
export function joinList(items: readonly string[], conjunction = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]}`
}

/** Escape characters that would break a markdown table cell. */
export function tableCell(text: string): string {
  return collapse(text).replace(/\|/g, '\\|')
}
