/**
 * Command center logic (§3.7): query prefixes, matching with highlights, handle jumps and the
 * intent row. Pure functions — unit-tested in model.test.ts.
 */
import type { Tables } from '@/core/db'
import type { Intent, IntentResult } from '@/core/ai'
import type { EntityKind, EntityRef } from '@/core/types'
import { shortCode } from '@/lib/id'

export type Mode = 'search' | 'command' | 'project' | 'item' | 'ask'

const PREFIX: Record<string, Mode> = { '>': 'command', '#': 'project', '@': 'item', '?': 'ask' }

/** `> theme light` → command mode; `#atlas` → project mode; `@prd` → item mode; `?why` → quick ask. */
export function parseQuery(raw: string): { mode: Mode; text: string; prefix: string } {
  const first = raw.trimStart().charAt(0)
  const mode = PREFIX[first]
  if (mode) return { mode, text: raw.trimStart().slice(1).trim(), prefix: first }
  return { mode: 'search', text: raw.trim(), prefix: '' }
}

export type Range = [number, number]

export interface Match {
  score: number
  /** [start, end) ranges in the title that matched. */
  ranges: Range[]
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean)

/** Word-start positions in a title, lowercased. */
function wordStarts(title: string): { word: string; start: number }[] {
  const out: { word: string; start: number }[] = []
  const re = /[a-z0-9]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(title))) out.push({ word: m[0].toLowerCase(), start: m.index })
  return out
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([r[0], r[1]])
  }
  return out
}

/**
 * Score a title (and optional keywords) against a query. Exact > prefix > every word a word-prefix >
 * substring > keyword > subsequence. Returns null when nothing matches.
 */
export function matchText(query: string, title: string, keywords: readonly string[] = []): Match | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 1, ranges: [] }
  const t = title.toLowerCase()
  if (t === q) return { score: 100, ranges: [[0, title.length]] }
  if (t.startsWith(q)) return { score: 90 - Math.min(20, title.length - q.length) / 4, ranges: [[0, q.length]] }
  const qWords = words(q)
  const starts = wordStarts(title)
  if (qWords.length) {
    const ranges: Range[] = []
    let all = true
    for (const w of qWords) {
      const hit = starts.find((s) => s.word.startsWith(w))
      if (!hit) {
        all = false
        break
      }
      ranges.push([hit.start, hit.start + w.length])
    }
    if (all) return { score: 70 + Math.min(10, qWords.length * 3) - Math.min(10, starts.length - qWords.length), ranges: merge(ranges) }
  }
  const at = t.indexOf(q)
  if (at >= 0) return { score: 55, ranges: [[at, at + q.length]] }
  const kw = keywords.map((k) => k.toLowerCase())
  if (kw.some((k) => k.startsWith(q) || q.split(/\s+/).every((w) => kw.some((x) => x.startsWith(w))))) return { score: 45, ranges: [] }
  // Subsequence (fuzzy): every query character in order.
  const compact = q.replace(/\s+/g, '')
  const ranges: Range[] = []
  let ti = 0
  for (const ch of compact) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    ranges.push([found, found + 1])
    ti = found + 1
  }
  return compact.length >= 2 ? { score: 20 - Math.min(15, ti - compact.length), ranges: merge(ranges) } : null
}

/** "Atlas Lumen PRD" for "atlas lumen prd": every query word starts a title word and the title is short. */
export function isStrongTitleMatch(query: string, title: string): boolean {
  const qWords = words(query)
  if (!qWords.length || query.trim().length < 3) return false
  const tWords = words(title)
  return qWords.every((w) => tWords.some((t) => t.startsWith(w))) && tWords.length <= qWords.length + 2
}

// ------------------------------------------------------------------------------------------------ handles

export const HANDLE_RE = /^([a-z]{3})-([a-z0-9]{2,8})$/i

const PREFIX_TABLE: Record<string, { table: keyof Tables; kind: EntityKind }> = {
  prj: { table: 'projects', kind: 'project' },
  tsk: { table: 'tasks', kind: 'task' },
  thr: { table: 'threads', kind: 'thread' },
  msg: { table: 'messages', kind: 'message' },
  run: { table: 'runs', kind: 'run' },
  apv: { table: 'approvals', kind: 'approval' },
  agt: { table: 'agents', kind: 'agent' },
  wfl: { table: 'workflows', kind: 'workflow' },
  kno: { table: 'knowledge', kind: 'knowledge' },
  col: { table: 'collections', kind: 'collection' },
  inv: { table: 'investigations', kind: 'investigation' },
  src: { table: 'sources', kind: 'source' },
  rep: { table: 'repos', kind: 'repo' },
  ses: { table: 'sessions', kind: 'session' },
  ast: { table: 'assets', kind: 'asset' },
  brd: { table: 'boards', kind: 'board' },
}

/** `RUN-K3J9` → the run whose `shortCode(id)` is that handle (§2.7: handles are derived, never stored). */
export function findByHandle(tables: Tables, handle: string): EntityRef | null {
  const m = HANDLE_RE.exec(handle.trim())
  if (!m) return null
  const target = PREFIX_TABLE[m[1].toLowerCase()]
  if (!target) return null
  const want = handle.trim().toUpperCase()
  const rows = tables[target.table] as Record<string, { id: string }>
  for (const id of Object.keys(rows)) if (shortCode(id) === want) return { kind: target.kind, id }
  return null
}

// ------------------------------------------------------------------------------------------------ intent

/** The verbs ⇥ cycles through, in order (§3.7). */
export const VERBS: readonly Intent[] = ['ask', 'research', 'build', 'delegate', 'create', 'automate', 'organize']

export const VERB_LABEL: Record<Intent, string> = {
  ask: 'Ask',
  research: 'Research',
  build: 'Build',
  delegate: 'Delegate',
  create: 'Create',
  automate: 'Automate',
  organize: 'Organize',
}

/** What ⏎ will do for each verb (shown in the preview pane and read to screen readers). */
export const VERB_EFFECT: Record<Intent, string> = {
  ask: 'Sends it to Chat as a new conversation.',
  research: 'Opens the Start sheet as Research. Nothing runs until you press Start.',
  build: 'Opens the Start sheet as a Coding session. Nothing runs until you press Start.',
  delegate: 'Opens the Start sheet to assign an agent. Nothing runs until you press Start.',
  create: 'Starts a Studio draft from the request.',
  automate: 'Drafts a workflow from the request and opens it in the editor.',
  organize: 'Opens the Start sheet as a Task.',
}

export function nextVerb(current: Intent, direction: 1 | -1 = 1): Intent {
  const i = VERBS.indexOf(current)
  return VERBS[(i + direction + VERBS.length) % VERBS.length]
}

/**
 * Show the intent row when the text reads like a request: ≥3 words, or a confident non-chat intent
 * (§3.7). A short phrase that only reads as "ask" is treated as a search.
 */
export function shouldShowIntent(text: string, result: IntentResult): boolean {
  const n = words(text).length
  if (n >= 3) return true
  return result.intent !== 'ask' && result.confidence >= 0.5
}

/** `Looks like a research task: mentions “competitors”, “sources”.` → ['competitors', 'sources']. */
export function mentionsFromReason(reason: string): string[] {
  const m = /mentions (.+?)\.?$/.exec(reason)
  if (!m) return []
  return m[1]
    .split(/,\s*/)
    .map((s) => s.replace(/[“”"]/g, '').trim())
    .filter(Boolean)
}
