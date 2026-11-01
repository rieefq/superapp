import type { SlashCommand } from '@/app/types'

/**
 * Pure text helpers for the Composer: detecting the `@` mention and `/` command triggers at the
 * caret, completing them, and parsing a submitted slash command.
 */

export interface Trigger {
  kind: '@' | '/'
  /** Text typed after the trigger character (may be empty). */
  query: string
  /** Index of the trigger character in the text. */
  start: number
  /** Index just after the query (the caret). */
  end: number
}

/**
 * The active trigger at `caret`, if any.
 * - `@` opens when it starts a word (start of text or after whitespace/punctuation) and the query has no spaces
 *   beyond a short multi-word allowance (people type "@atlas lumen").
 * - `/` opens only at the very start of the draft (commands are whole-message actions).
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret)
  // Slash command: only while typing the command name at the start of the draft.
  const slash = /^\/([\w-]*)$/.exec(before)
  if (slash) return { kind: '/', query: slash[1], start: 0, end: caret }
  // Mention: the last '@' that starts a word, with at most two spaces after it.
  const at = before.lastIndexOf('@')
  if (at < 0) return null
  const prev = at > 0 ? before[at - 1] : ''
  if (prev && !/[\s([{"'“‘]/.test(prev)) return null
  const query = before.slice(at + 1)
  if (query.length > 48 || /\n/.test(query) || (query.match(/ /g)?.length ?? 0) > 2 || /^\s/.test(query)) return null
  return { kind: '@', query, start: at, end: caret }
}

/** Replace the trigger (character + query) with `insert`; returns the new text and caret. */
export function completeTrigger(text: string, trigger: Trigger, insert: string): { text: string; caret: number } {
  const head = text.slice(0, trigger.start)
  let tail = text.slice(trigger.end)
  // Avoid double spaces when the mention is removed from the middle of a sentence.
  if (!insert && head.endsWith(' ') && tail.startsWith(' ')) tail = tail.slice(1)
  const next = head + insert + tail
  return { text: next, caret: head.length + insert.length }
}

/** Slash commands matching a typed prefix, best first (prefix matches before substring matches). */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  const q = query.toLowerCase()
  if (!q) return [...commands]
  const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = commands.filter((c) => !prefix.includes(c) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)))
  return [...prefix, ...rest]
}

/** `/research webhook retries` → { command, args }. Unknown commands return null (sent as plain text). */
export function parseSlash(text: string, commands: readonly SlashCommand[]): { command: SlashCommand; args: string } | null {
  const m = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!m) return null
  const command = commands.find((c) => c.name.toLowerCase() === m[1].toLowerCase())
  return command ? { command, args: (m[2] ?? '').trim() } : null
}

/** Words of `text` that `query` matched (deduped, in order), for "Matches: webhook, retry". */
export function matchedTerms(text: string, ranges: ReadonlyArray<readonly [number, number]>, max = 3): string[] {
  const out: string[] = []
  for (const [a, b] of ranges) {
    const word = text.slice(a, b).toLowerCase().replace(/[^\p{L}\p{N}-]+/gu, '')
    if (word.length > 1 && !out.includes(word)) out.push(word)
    if (out.length >= max) break
  }
  return out
}
