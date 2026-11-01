import { ID_PREFIX } from '@/core/db/schema'
import type { Run } from '@/core/types'
import { truncate } from '@/lib/format'

/**
 * Failure reasons: turn raw run errors into short, human-readable reasons (for display) and
 * stable fingerprints (for grouping). Pure.
 */

export const UNKNOWN_FAILURE = 'Failed without an error message'

const MAX_REASON = 160
/** A cut is only made after at least this many characters, so "Error. Disk full" stays whole. */
const MIN_HEAD = 12
/** Generic "Error:" prefixes add nothing in a list of failure reasons. */
const ERROR_PREFIX = /^(?:uncaught\s+)?(?:error|err)\s*:\s*/i
/** A sentence end followed by a capitalized sentence (or an opening quote/bracket). */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[\p{Lu}“"'([])/gu
/** A clause break: "; " or a spaced dash. */
const CLAUSE_BREAK = /;\s+|\s+[—–]\s+/g
const TRAILING_PUNCTUATION = /[\s.,;:!]+$/u

/** The error text of a run: `run.error`, else its last failed step's error, else any step error. */
export function runFailureMessage(run: Pick<Run, 'error' | 'steps'>): string {
  const own = run.error?.trim()
  if (own) return own
  let anyStepError: string | undefined
  for (let i = run.steps.length - 1; i >= 0; i--) {
    const step = run.steps[i]
    const error = step.error?.trim()
    if (!error) continue
    if (step.status === 'failed') return error
    anyStepError ??= error
  }
  return anyStepError ?? UNKNOWN_FAILURE
}

/** Cut `text` at the first break (matched by the global `re`) that comes after `MIN_HEAD` characters. */
function cutAtFirstBreak(text: string, re: RegExp): string {
  for (const m of text.matchAll(re)) {
    if (m.index >= MIN_HEAD) return text.slice(0, m.index)
  }
  return text
}

/**
 * A short reason for display: the first line, first sentence and first clause of the message,
 * whitespace collapsed, a generic "Error:" prefix dropped, capitalized, at most 160 characters.
 * "Linear API returned 503 after 3 retries. The email stays unlabeled." → "Linear API returned 503 after 3 retries".
 */
export function normalizeFailureReason(message: string): string {
  const firstLine = message.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? ''
  let text = firstLine.replace(/\s+/g, ' ').replace(ERROR_PREFIX, '')
  text = cutAtFirstBreak(text, SENTENCE_BREAK)
  text = cutAtFirstBreak(text, CLAUSE_BREAK)
  text = text.replace(TRAILING_PUNCTUATION, '')
  if (!text) return UNKNOWN_FAILURE
  return truncate(text.charAt(0).toUpperCase() + text.slice(1), MAX_REASON)
}

/** Table ids (`run_k3j9x0q2ab`), plus run-step (`stp_`) and user (`usr_`) ids. */
const ID_PREFIXES = [...Object.values(ID_PREFIX), 'stp', 'usr']
const ENTITY_ID = new RegExp(`\\b(?:${ID_PREFIXES.join('|')})_[a-z0-9_]+\\b`, 'g')
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g
/** Hex hashes (commit shas, request ids): 7+ hex chars containing both a digit and a letter. */
const HEX_HASH = /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,}\b/g
const URL_PATTERN = /\bhttps?:\/\/\S+/g
const QUOTED = /“[^”]*”|‘[^’]*’|"[^"]*"|`[^`]*`/g
/** Long numbers (ids, timestamps, byte counts). Short ones (HTTP 429, 3 retries, 30 s) are kept: they distinguish failures. */
const LONG_NUMBER = /\d{4,}/g

/**
 * Grouping key for a failure message: its normalized reason, lowercased, with volatile parts
 * (entity ids, UUIDs, hashes, URLs, quoted names, long numbers) masked, so
 * "“Draft reply” has no available agent" and "“Classify” has no available agent" group together.
 */
export function failureFingerprint(message: string): string {
  return normalizeFailureReason(message)
    .toLowerCase()
    .replace(URL_PATTERN, '<url>')
    .replace(QUOTED, '<quoted>')
    .replace(UUID, '<uuid>')
    .replace(ENTITY_ID, '<id>')
    .replace(HEX_HASH, '<hash>')
    .replace(LONG_NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
}
