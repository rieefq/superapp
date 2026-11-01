const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "4m ago", "3h ago", "yesterday", "Mar 4". */
export function timeAgo(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 0) return timeUntil(ts, now)
  if (diff < 45_000) return 'just now'
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`
  if (diff < 2 * DAY) return 'yesterday'
  if (diff < 7 * DAY) return `${Math.round(diff / DAY)}d ago`
  return formatDate(ts)
}

/** "in 5m", "in 3h", "tomorrow", "Mar 4". */
export function timeUntil(ts: number, now = Date.now()): string {
  const diff = ts - now
  if (diff <= 0) return timeAgo(ts, now)
  if (diff < HOUR) return `in ${Math.max(1, Math.round(diff / MINUTE))}m`
  if (diff < DAY) return `in ${Math.round(diff / HOUR)}h`
  if (diff < 2 * DAY) return 'tomorrow'
  if (diff < 7 * DAY) return `in ${Math.round(diff / DAY)}d`
  return formatDate(ts)
}

export function formatDate(ts: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? opts : { ...opts, year: 'numeric' })
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** 950ms → "0.9s", 75s → "1m 15s", 3h 4m. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms / 100) / 10)}s`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** 1234 → "1.2K", 2_500_000 → "2.5M". */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat().format(n)
}

/** Tokens with unit: "12.4K tok". */
export function formatTokens(n: number): string {
  return `${formatCompact(n)} tok`
}

/** USD with sensible precision: $0.0042, $0.08, $12.40, $1.2K. */
export function formatUsd(n: number): string {
  if (n === 0) return '$0.00'
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`
  if (Math.abs(n) < 1000) return `$${n.toFixed(2)}`
  return `$${formatCompact(n)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

export const TIME = { MINUTE, HOUR, DAY }
