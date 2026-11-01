import type { EntityKind, EntityRef, FileChange, ID, Usage } from '@/core/types'
import type { FileEdit } from './repoEdits'

/** Reference pricing for estimates (Claude Sonnet 5.5, USD per million tokens). */
const INPUT_USD_PER_MTOK = 2
const OUTPUT_USD_PER_MTOK = 10

/** Estimated cost of simulated work at reference pricing, rounded to a millionth of a dollar. */
export function estimateUsd(inputTokens: number, outputTokens: number): number {
  return Math.round(inputTokens * INPUT_USD_PER_MTOK + outputTokens * OUTPUT_USD_PER_MTOK) / 1_000_000
}

/** Usage for a token count, split 70/30 input/output like the simulator does. */
export function usageOf(tokens: number): Usage {
  const inputTokens = Math.round(tokens * 0.7)
  const outputTokens = tokens - inputTokens
  return { inputTokens, outputTokens, costUsd: estimateUsd(inputTokens, outputTokens) }
}

export function sumUsage(items: Usage[]): Usage {
  const inputTokens = items.reduce((n, u) => n + u.inputTokens, 0)
  const outputTokens = items.reduce((n, u) => n + u.outputTokens, 0)
  return { inputTokens, outputTokens, costUsd: estimateUsd(inputTokens, outputTokens) }
}

export const ref = (kind: EntityKind, id: ID): EntityRef => ({ kind, id })

/** 1140 → "1,140" (no Intl: its first use is slow and locale-dependent). */
export function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Lines of a file; a trailing newline does not create an extra empty line. */
function splitLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Added and removed line counts of a minimal line diff (via the longest common subsequence),
 * matching what a unified diff of `before` → `after` shows.
 */
export function lineDiffCounts(before = '', after = ''): { additions: number; deletions: number } {
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const x = a.slice(start, endA)
  const y = b.slice(start, endB)
  let prev = new Uint16Array(y.length + 1)
  let cur = new Uint16Array(y.length + 1)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    }
    ;[prev, cur] = [cur, prev]
  }
  const common = prev[y.length]
  return { additions: y.length - common, deletions: x.length - common }
}

/** Apply exact find/replace edits in order. Each `find` must occur exactly once. */
export function applyEdits(content: string, edits: FileEdit[], label: string): string {
  let out = content
  for (const edit of edits) {
    const at = out.indexOf(edit.find)
    if (at < 0 || out.indexOf(edit.find, at + 1) >= 0) {
      throw new Error(`seed: edit anchor for ${label} must occur exactly once:\n${edit.find.slice(0, 120)}`)
    }
    out = out.slice(0, at) + edit.replace + out.slice(at + edit.find.length)
  }
  return out
}

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  json: 'json',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  css: 'css',
}

export function languageOf(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.') + 1)
  return LANGUAGES[ext]
}

/** A FileChange with additions/deletions computed from its contents. */
export function fileChange(path: string, before: string | undefined, after: string | undefined): FileChange {
  const { additions, deletions } = lineDiffCounts(before, after)
  const change: FileChange = {
    path,
    changeType: before === undefined ? 'added' : after === undefined ? 'deleted' : 'modified',
    additions,
    deletions,
  }
  if (before !== undefined) change.before = before
  if (after !== undefined) change.after = after
  const language = languageOf(path)
  if (language) change.language = language
  return change
}

/** Byte length of a string encoded as UTF-8. */
export function utf8Bytes(text: string): number {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

/** 1-based line number of the first line containing `needle`. */
export function lineOf(content: string, needle: string): number {
  const index = splitLines(content).findIndex((line) => line.includes(needle))
  if (index < 0) throw new Error(`seed: "${needle}" not found`)
  return index + 1
}

/** Key/value table from rows with ids. */
export function byId<T extends { id: ID }>(rows: T[]): Record<ID, T> {
  const out: Record<ID, T> = {}
  for (const row of rows) {
    if (out[row.id]) throw new Error(`seed: duplicate id ${row.id}`)
    out[row.id] = row
  }
  return out
}
