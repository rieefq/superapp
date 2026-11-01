/**
 * Small, pure text helpers shared by the assist heuristics (no dates, no app state).
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const TIME_MS = { MINUTE, HOUR, DAY } as const

/** Collapse whitespace and clip to `max` characters with an ellipsis. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…` : t
}

/** “Curly-quoted”, clipped text for titles and reasons. */
export function quoted(text: string, max = 60): string {
  return `“${clip(text, max)}”`
}

export function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/** Lowercase the first letter unless the first word looks like a name or acronym ("Slack", "PR"). */
export function lowerFirst(text: string): string {
  const first = text.split(/\s+/, 1)[0] ?? ''
  if (/^[A-Z0-9]{2,}/.test(first) || /^[A-Z][a-z]+[A-Z]/.test(first)) return text
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text
}

/** "a", "a and b", "a, b and c". */
export function joinList(items: readonly string[], conj = 'and'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${conj} ${items[items.length - 1]}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Human length of a duration: "5 minutes", "3 hours", "2 days". */
export function durationText(ms: number): string {
  const abs = Math.max(0, ms)
  if (abs < HOUR) return plural(Math.max(1, Math.round(abs / MINUTE)), 'minute')
  if (abs < DAY) return plural(Math.round(abs / HOUR), 'hour')
  return plural(Math.round(abs / DAY), 'day')
}

/** Relative past time from a duration: "just now", "5m ago", "3h ago", "2d ago". */
export function agoText(ms: number): string {
  if (ms < 45_000) return 'just now'
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m ago`
  if (ms < DAY) return `${Math.round(ms / HOUR)}h ago`
  return `${Math.round(ms / DAY)}d ago`
}

export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Local wall-clock "HH:MM" for a timestamp (deterministic for a given time zone). */
export function clockTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Last millisecond of the local calendar day containing `ts`. */
export function endOfLocalDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

/** Deterministic 32-bit FNV-1a hash, base36. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Strip trailing punctuation and dangling function words ("…to the", "…and"). */
export function trimTail(text: string): string {
  let out = text.trim()
  for (let i = 0; i < 4; i++) {
    const next = out
      .replace(/[\s.,!?;:…—–-]+$/u, '')
      .replace(/\s+(?:a|an|the|of|for|to|and|or|with|in|on|at|by|from|into|that|which|it|its|my|our|your|their|is|are|be)$/i, '')
    if (next === out) break
    out = next
  }
  return out
}

/** First `maxWords` words of a phrase, tidied for use as a label. */
export function labelize(text: string, maxWords = 6): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  return capitalize(trimTail(words.slice(0, maxWords).join(' ')))
}
