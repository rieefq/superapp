import type { Rng } from '@/lib/rng'
import { countWords, ensurePeriod, keywordStems, lowerFirst, splitSentences, stem, stripTrailingPunctuation, truncateWords, words } from './text'

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
  source: 'knowledge' | 'file'
}

export interface EvidenceSource {
  index: number
  title: string
  text: string
  source: 'knowledge' | 'file'
}

const MAX_SENTENCE_WORDS = 45

function scoreSentence(sentence: string, query: ReadonlySet<string>, position: number): number {
  let overlap = 0
  const seen = new Set<string>()
  for (const w of words(sentence)) {
    const s = stem(w)
    if (query.has(s) && !seen.has(s)) {
      seen.add(s)
      overlap++
    }
  }
  const n = countWords(sentence)
  const lengthPrior = n >= 8 && n <= 32 ? 0.4 : n < 5 ? -0.6 : 0
  return overlap * 2 + lengthPrior + (position === 0 ? 0.3 : 0) - position * 0.02
}

/** Best sentences per source for `queryText`, interleaved across sources, at most `max`. */
export function gatherEvidence(
  sources: readonly EvidenceSource[],
  queryText: string,
  opts: { perSource: number; max: number },
): Evidence[] {
  const query = keywordStems(queryText)
  const perSource: Evidence[][] = sources.map((src) => {
    const sentences = splitSentences(src.text)
    const scored = sentences.map((sentence, i) => ({
      index: src.index,
      title: src.title,
      sentence: countWords(sentence) > MAX_SENTENCE_WORDS ? truncateWords(sentence, MAX_SENTENCE_WORDS) : sentence,
      score: scoreSentence(sentence, query, i),
      source: src.source,
    }))
    return scored.sort((a, b) => b.score - a.score).slice(0, opts.perSource)
  })
  const out: Evidence[] = []
  for (let round = 0; out.length < opts.max; round++) {
    let added = false
    for (const list of perSource) {
      if (round < list.length && out.length < opts.max) {
        out.push(list[round])
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

const IMPERATIVE_START =
  /^(?:use|add|avoid|keep|make|set|rotate|run|check|ensure|include|do|don't|never|always|prefer|write|start|stop|review|send|ask|create|update|remove|store|track|test|deploy|call|follow|read|share|escalate|respond|assign|tag|close|open|link|document|measure|limit|require|reply|confirm|route|flag|treat|lead|focus|aim|plan|schedule|move|ship|try|consider|note|see|refer)\b/i

/** True when the sentence reads well after "X notes that …". */
function embeddable(sentence: string): boolean {
  return !IMPERATIVE_START.test(sentence) && !/[?:]$/.test(sentence.trim()) && !/^["“]/.test(sentence)
}

/** One attributed sentence: quotes or lightly reframes the evidence and ends with its citation. */
export function citeSentence(e: Evidence, rng: Rng): string {
  const s = e.sentence.trim()
  const bare = stripTrailingPunctuation(s)
  const name = `*${e.title}*`
  const m = marker(e)
  if (!embeddable(s)) {
    return rng.pick([
      `${name} recommends: “${ensurePeriod(bare)}”${m}`,
      `From ${name}: “${ensurePeriod(bare)}”${m}`,
      `As ${name} puts it, “${ensurePeriod(bare)}”${m}`,
    ])
  }
  return rng.pick([
    `${name} notes that ${lowerFirst(bare)}${m}.`,
    `According to ${name}, ${lowerFirst(bare)}${m}.`,
    `${name}: “${ensurePeriod(bare)}”${m}`,
    `${ensurePeriod(bare).replace(/[.!…]$/u, '')}${m}.`,
    `As ${name} puts it, “${ensurePeriod(bare)}”${m}`,
  ])
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
  const request = keywordStems(requestText)
  const counts = new Map<string, { word: string; n: number }>()
  for (const e of evidence) {
    const seen = new Set<string>()
    for (const w of words(e.sentence)) {
      const s = stem(w)
      if (w.length < 4 || request.has(s) || seen.has(s) || !keywordStems(w).size) continue
      seen.add(s)
      const cur = counts.get(s)
      counts.set(s, { word: cur?.word ?? w, n: (cur?.n ?? 0) + 1 })
    }
  }
  let best: { word: string; n: number } | undefined
  for (const c of counts.values()) if (c.n >= 2 && (!best || c.n > best.n)) best = c
  return best?.word
}
