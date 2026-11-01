import type { Rng } from '@/lib/rng'
import { countWords, ensurePeriod, keywords, splitSentences, stem, stripTrailingPunctuation, truncateWords, words } from './text'

/**
 * Evidence = real sentences from the knowledge passages (cited as [n]) or attached files
 * (cited by filename) that are most relevant to the request. The composer only ever quotes
 * or lightly reframes these sentences; it never invents claims.
 */
export interface Evidence {
  /** [n] index of a knowledge doc; 0 for attached files. */
  index: number
  title: string
  sentence: string
  score: number
  /** Distinct request keywords the sentence shares. */
  overlap: number
  source: 'knowledge' | 'file'
  /** 'guidance' for imperative sentences ("Use short sentences."), 'statement' otherwise. */
  kind: 'statement' | 'guidance'
  /** The first word can be lowercased safely when the sentence is embedded mid-sentence. */
  lowerable: boolean
}

export interface EvidenceSource {
  index: number
  title: string
  text: string
  source: 'knowledge' | 'file'
}

const MAX_SENTENCE_WORDS = 45

/** Words that describe the request's shape rather than its topic; ignored for relevance. */
const QUERY_NOISE = new Set(
  [
    'plan', 'compare', 'comparison', 'summarize', 'summarise', 'summary', 'write', 'draft', 'email', 'idea', 'ideas',
    'brainstorm', 'explain', 'function', 'code', 'script', 'list', 'name', 'names', 'create', 'question', 'questions',
    'step', 'steps', 'guide', 'versus', 'option', 'options', 'pros', 'cons', 'outline', 'post', 'message', 'draft',
    'quick', 'short', 'long', 'detailed', 'simple', 'version', 'week', 'weeks', 'day', 'days', 'month', 'months',
  ].map(stem),
)

const IMPERATIVE_START =
  /^(?:use|add|avoid|keep|make|set|rotate|run|check|ensure|include|do|don't|never|always|prefer|write|start|stop|review|send|ask|create|update|remove|store|track|test|deploy|call|follow|read|share|escalate|respond|assign|tag|close|open|link|document|measure|limit|require|reply|confirm|route|flag|treat|lead|focus|aim|plan|schedule|move|ship|try|consider|note|see|refer|be|give|tell|show|get|let)\b/i

const COMMON_STARTERS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'they', 'their', 'there', 'most',
  'many', 'some', 'each', 'every', 'all', 'any', 'when', 'if', 'for', 'in', 'on', 'at', 'by', 'with', 'after',
  'before', 'during', 'because', 'since', 'while', 'to', 'you', 'your', 'one', 'two', 'three', 'no', 'not', 'only',
  'both', 'once', 'until', 'as', 'what', 'how', 'why', 'where', 'which', 'who',
])

/** True when the sentence's first word is safe to lowercase (not a name, acronym or product). */
function canLowerFirst(sentence: string, sourceText: string): boolean {
  const first = /^[\p{L}][\p{L}'’-]*/u.exec(sentence)?.[0]
  if (!first) return false
  if (first.charAt(0) === first.charAt(0).toLowerCase()) return true
  const rest = first.slice(1)
  if (rest && rest !== rest.toLowerCase()) return false // SSO, GitHub, iOS-style words
  const lower = first.toLowerCase()
  if (COMMON_STARTERS.has(lower)) return true
  // Lowercase is safe only if the word also appears lowercase in the same source.
  return new RegExp(`(^|[^\\p{L}])${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'u').test(sourceText)
}

function overlapCount(sentence: string, query: ReadonlySet<string>): number {
  const seen = new Set<string>()
  for (const w of words(sentence)) {
    const s = stem(w)
    if (query.has(s)) seen.add(s)
  }
  return seen.size
}

/** Request keywords used for relevance, without shape words like "plan" or "compare". */
export function relevanceStems(requestText: string): Set<string> {
  return new Set(keywords(requestText, 64).map(stem).filter((s) => !QUERY_NOISE.has(s)))
}

/**
 * Best sentences per source for `queryText`, interleaved across sources, at most `max`.
 * Knowledge docs that share no keywords with the request are skipped (the composer mentions
 * them separately as "possibly related"); within a doc, only the first pick may be
 * non-overlapping. Attached files are always used. When few docs are relevant, each may
 * contribute more sentences (up to three) so the answer stays grounded.
 */
export function gatherEvidence(
  sources: readonly EvidenceSource[],
  queryText: string,
  opts: { perSource: number; max: number },
): Evidence[] {
  const query = relevanceStems(queryText)
  const ranked = sources.map((src) => {
    const scored: Evidence[] = splitSentences(src.text).map((sentence, i) => {
      const overlap = overlapCount(sentence, query)
      const n = countWords(sentence)
      const lengthPrior = n >= 8 && n <= 32 ? 0.4 : n < 5 ? -0.6 : 0
      return {
        index: src.index,
        title: src.title,
        sentence: n > MAX_SENTENCE_WORDS ? truncateWords(sentence, MAX_SENTENCE_WORDS) : sentence,
        score: overlap * 2 + lengthPrior + (i === 0 ? 0.3 : 0) - i * 0.02,
        overlap,
        source: src.source,
        kind: IMPERATIVE_START.test(sentence) ? 'guidance' : 'statement',
        lowerable: canLowerFirst(sentence, src.text),
      }
    })
    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]?.overlap ?? 0
    return { src, scored, best }
  })

  const kept = ranked.filter((r) => r.src.source === 'file' || r.best > 0)
  const perSource = Math.min(3, Math.max(opts.perSource, Math.ceil(opts.max / Math.max(1, kept.length))))
  const picksOf = (r: (typeof ranked)[number]) =>
    r.scored.filter((e, i) => i === 0 || e.overlap > 0 || r.src.source === 'file').slice(0, perSource)

  const lists = kept.map(picksOf)
  const out: Evidence[] = []
  for (let round = 0; out.length < opts.max; round++) {
    let added = false
    for (const picks of lists) {
      if (round < picks.length && out.length < opts.max) {
        out.push(picks[round])
        added = true
      }
    }
    if (!added) break
  }
  return out
}

/** Citation marker for a piece of evidence: " [2]" for knowledge, " (from *notes.md*)" for files. */
export function marker(e: Evidence): string {
  return e.source === 'knowledge' ? ` [${e.index}]` : ` (from *${e.title}*)`
}

/** True when the sentence reads well after "X notes that …". */
function embeddable(e: Evidence): boolean {
  const s = e.sentence.trim()
  return e.kind === 'statement' && e.lowerable && !/[?:]$/.test(s) && !/^["“]/.test(s)
}

/** One attributed sentence: quotes or lightly reframes the evidence and ends with its citation. */
export function citeSentence(e: Evidence, rng: Rng): string {
  const s = e.sentence.trim()
  const bare = stripTrailingPunctuation(s)
  const quoted = ensurePeriod(bare)
  const name = `*${e.title}*`
  const m = marker(e)
  if (e.kind === 'guidance') {
    return rng.pick([`${name} recommends: “${quoted}”${m}`, `From ${name}: “${quoted}”${m}`])
  }
  const variants = [`${name}: “${quoted}”${m}`, `As ${name} puts it, “${quoted}”${m}`, `${quoted.replace(/[.!…]$/u, '')}${m}.`]
  if (embeddable(e)) {
    const lowered = bare.charAt(0).toLowerCase() + bare.slice(1)
    variants.push(`${name} notes that ${lowered}${m}.`, `According to ${name}, ${lowered}${m}.`)
  }
  return rng.pick(variants)
}

/** Short quote for table cells and inline asides: “first words…” [n]. */
export function quoteShort(e: Evidence, maxWords = 14): string {
  return `“${truncateWords(stripTrailingPunctuation(e.sentence), maxWords)}”${marker(e)}`
}

/** Distinct knowledge doc titles referenced by the evidence (for prose and reasoning). */
export function evidenceTitles(evidence: readonly Evidence[]): string[] {
  return [...new Set(evidence.map((e) => e.title))]
}

/**
 * The keyword most often shared across evidence sentences but absent from the request:
 * a factual "these passages keep mentioning X" observation.
 */
export function recurringTheme(evidence: readonly Evidence[], requestText: string): string | undefined {
  if (evidence.length < 2) return undefined
  const request = relevanceStems(requestText)
  const counts = new Map<string, { word: string; n: number }>()
  for (const e of evidence) {
    const seen = new Set<string>()
    for (const w of keywords(e.sentence, 64)) {
      const s = stem(w)
      if (w.length < 4 || request.has(s) || seen.has(s)) continue
      seen.add(s)
      const cur = counts.get(s)
      counts.set(s, { word: cur?.word ?? w, n: (cur?.n ?? 0) + 1 })
    }
  }
  let best: { word: string; n: number } | undefined
  for (const c of counts.values()) if (c.n >= 2 && (!best || c.n > best.n)) best = c
  return best?.word
}

