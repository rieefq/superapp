import type { Delta, InsightsBucket, InsightsTotals } from '@/core/analytics'
import type { ActivityEvent, ActorRef, EntityKind, ID, RunKind } from '@/core/types'
import { formatDuration } from '@/lib/format'

/**
 * Insights' presentation rules — pure functions, unit-tested (no React, no database).
 */

export const KIND_LABEL: Record<RunKind, string> = {
  chat: 'Chat',
  code: 'Coding',
  agent: 'Agent',
  research: 'Research',
  workflow: 'Workflow',
  studio: 'Studio',
}

/** Fewer runs than this in the window: explain what will appear (§6.10 states). */
export const FEW_RUNS = 5

const pad = (n: number) => String(n).padStart(2, '0')
const shortDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const longDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** Axis label for a bucket: "14:00" (hour) or "Oct 28" (day). */
export function bucketLabel(b: Pick<InsightsBucket, 'start' | 'unit'>): string {
  if (b.unit === 'hour') return `${pad(new Date(b.start).getHours())}:00`
  return shortDay.format(b.start)
}

/** Full label for tooltips and tables: "Wed, Oct 28" or "Wed, Oct 28 · 14:00–15:00". */
export function bucketTitle(b: Pick<InsightsBucket, 'start' | 'end' | 'unit' | 'partial'>, now?: number): string {
  if (b.unit === 'hour') {
    const end = new Date(b.end)
    return `${longDay.format(b.start)} · ${pad(new Date(b.start).getHours())}:00–${pad(end.getHours())}:00`
  }
  const today = now !== undefined && now >= b.start && now < b.end
  return `${longDay.format(b.start)}${today ? ' (today)' : ''}`
}

/** "Oct 25 – Nov 1" for the window; "Oct 31 14:00 – Nov 1 14:00" for 24 hours. */
export function windowLabel(from: number, to: number, rangeDays: number): string {
  if (rangeDays === 1) {
    const t = (ts: number) => `${shortDay.format(ts)} ${pad(new Date(ts).getHours())}:${pad(new Date(ts).getMinutes())}`
    return `${t(from)} – ${t(to)}`
  }
  return `${shortDay.format(from)} – ${shortDay.format(to)}`
}

/**
 * A delta as one plain phrase: "+12% vs previous 7 days", "No change vs previous 7 days", and
 * "none in the previous 7 days" when there is nothing to compare with.
 */
export function deltaPhrase(delta: Delta | null, comparison: string): string | null {
  if (!delta) return null
  if (delta.value === 'New') return comparison.replace(/^vs previous/, 'none in the previous')
  return `${delta.label} ${comparison}`
}

/** Approval waits read as spans ("42s", "6m", "9m 30s", "1h 12m"), never as clock times. */
export function formatWait(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—'
  return formatDuration(Math.max(0, ms)).replace(/ 0s$/, '').replace(/ 0m$/, '')
}

/** How finished runs ended, for the Success-rate tile's second line: "5 failed · 4 stopped". */
export function outcomeLine(t: Pick<InsightsTotals, 'failed' | 'cancelled' | 'succeeded'>): string {
  const parts: string[] = []
  if (t.failed) parts.push(`${t.failed} failed`)
  if (t.cancelled) parts.push(`${t.cancelled} stopped`)
  if (!parts.length) return t.succeeded ? 'No failures' : 'Nothing finished yet'
  return parts.join(' · ')
}

/** Share of a total as a 0..1 bar width; at least a hairline for non-zero values. */
export function barShare(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0
  return Math.max(0.012, Math.min(1, value / max))
}

// ---------------------------------------------------------------- journal

export type ActorFilter = 'all' | 'me' | 'agents' | 'workflows' | 'system' | `agent:${string}`

export interface JournalQuery {
  from: number
  to: number
  projectId: ID | null
  actor: ActorFilter
  verb: string | null
  kind: EntityKind | null
  text?: string
}

export function actorMatches(actor: ActorRef, filter: ActorFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'me':
      return actor.type === 'user'
    case 'agents':
      return actor.type === 'agent'
    case 'workflows':
      return actor.type === 'workflow'
    case 'system':
      return actor.type === 'system'
    default:
      return actor.type === 'agent' && actor.id === filter.slice('agent:'.length)
  }
}

/** Events in the window and filters, newest first. */
export function filterJournal(events: readonly ActivityEvent[], q: JournalQuery): ActivityEvent[] {
  const terms = q.text ? q.text.toLowerCase().split(/\s+/).filter(Boolean) : []
  return events
    .filter(
      (e) =>
        e.at >= q.from &&
        e.at <= q.to &&
        (q.projectId === null || e.projectId === q.projectId) &&
        actorMatches(e.actor, q.actor) &&
        (!q.verb || e.verb === q.verb) &&
        (!q.kind || e.target.kind === q.kind) &&
        (!terms.length || terms.every((t) => e.summary.toLowerCase().includes(t))),
    )
    .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
}

/** Verbs present in the events, most frequent first (for the verb filter). */
export function journalVerbs(events: readonly ActivityEvent[]): { verb: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const e of events) counts.set(e.verb, (counts.get(e.verb) ?? 0) + 1)
  return [...counts.entries()].map(([verb, count]) => ({ verb, count })).sort((a, b) => b.count - a.count || a.verb.localeCompare(b.verb))
}

/** Target kinds present in the events, most frequent first. */
export function journalKinds(events: readonly ActivityEvent[]): { kind: EntityKind; count: number }[] {
  const counts = new Map<EntityKind, number>()
  for (const e of events) counts.set(e.target.kind, (counts.get(e.target.kind) ?? 0) + 1)
  return [...counts.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

export interface JournalExportMeta {
  exportedAt: number
  range: string
  project: string
  filters: Record<string, string>
}

/** The JSON document "Export JSON" downloads: what was shown, with its filters. */
export function journalExport(events: readonly ActivityEvent[], meta: JournalExportMeta): string {
  return JSON.stringify(
    {
      kind: 'atrium.activity-journal',
      version: 1,
      exportedAt: new Date(meta.exportedAt).toISOString(),
      range: meta.range,
      project: meta.project,
      filters: meta.filters,
      count: events.length,
      events: events.map((e) => ({
        id: e.id,
        at: new Date(e.at).toISOString(),
        actor: e.actor,
        verb: e.verb,
        target: e.target,
        summary: e.summary,
        projectId: e.projectId,
        ...(e.meta ? { meta: e.meta } : {}),
      })),
    },
    null,
    2,
  )
}

/** Download text as a file (browser only). */
export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
