/**
 * Number and time formats for the signature kit (docs/DESIGN.md §8.3):
 * tokens `1,204 tok` / `12.4k tok`, costs `$0.08` / `$0.004` (3 decimals below a cent),
 * durations `3.1 s` / `01:24`, estimates prefixed `est.`. Pure and locale-stable (en-US digits).
 */

const GROUPED = new Intl.NumberFormat('en-US')

const trimZero = (s: string) => s.replace(/\.0$/, '')

/** 980 → "980", 1204 → "1,204", 12_400 → "12.4k", 1_250_000 → "1.3M". */
export function formatTokenCount(n: number): string {
  const v = Math.max(0, Math.round(Number.isFinite(n) ? n : 0))
  if (v < 10_000) return GROUPED.format(v)
  if (v < 999_500) return `${trimZero((v / 1000).toFixed(v < 100_000 ? 1 : 0))}k`
  return `${trimZero((v / 1_000_000).toFixed(1))}M`
}

/** "1,204 tok"; estimates read "~980 tok est." */
export function formatTok(n: number, opts: { est?: boolean } = {}): string {
  const count = formatTokenCount(n)
  return opts.est ? `~${count} tok est.` : `${count} tok`
}

/** "$0.00", "$0.004", "$0.08", "$12.40", "$1.2k"; `est` prefixes "est. ". */
export function formatCost(usd: number, opts: { est?: boolean } = {}): string {
  const v = Number.isFinite(usd) ? Math.max(0, usd) : 0
  let text: string
  if (v === 0) text = '$0.00'
  else if (v < 0.001) text = '<$0.001'
  else if (v < 0.01) text = `$${v.toFixed(3)}`
  else if (v < 1000) text = `$${v.toFixed(2)}`
  else text = `$${trimZero((v / 1000).toFixed(1))}k`
  return opts.est ? `est. ${text}` : text
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Elapsed clock: "00:07", "01:24", "1:02:03". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Duration: "0.4 s", "3.1 s", "42 s", then the clock ("01:24", "1:02:03"). */
export function formatSeconds(ms: number): string {
  const v = Math.max(0, Number.isFinite(ms) ? ms : 0)
  if (v < 9_950) return `${(v / 1000).toFixed(1)} s`
  if (v < 59_500) return `${Math.round(v / 1000)} s`
  return formatClock(v)
}

/** 24-hour wall time "10:42" (receipts, stamps). */
export function formatHm(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "just now", "4m", "3h", "2d" — compact age for "waiting 4m". */
export function formatAge(ms: number): string {
  const v = Math.max(0, ms)
  if (v < 60_000) return 'just now'
  if (v < 3_600_000) return `${Math.floor(v / 60_000)}m`
  if (v < 86_400_000) return `${Math.floor(v / 3_600_000)}h`
  return `${Math.floor(v / 86_400_000)}d`
}

/** "Nov 1, 2026" (Markdown exports). */
export function formatLongDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
