import type { Message, Thread } from '@/core/types'
import { clipLine, plainText } from '@/core/services/serviceHelpers'

/**
 * The thread list's groups (§6.2): Pinned · Today · Yesterday · Previous 7 days · Earlier.
 * Pure functions so the list stays cheap to render and easy to test.
 */

export type ThreadGroupId = 'pinned' | 'today' | 'yesterday' | 'week' | 'earlier'

export const GROUP_LABEL: Record<ThreadGroupId, string> = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Previous 7 days',
  earlier: 'Earlier',
}

const ORDER: ThreadGroupId[] = ['pinned', 'today', 'yesterday', 'week', 'earlier']

export interface ThreadGroup {
  id: ThreadGroupId
  label: string
  threads: Thread[]
}

/** Local midnight of the day `ts` falls on (DST-safe: built from the calendar date). */
export function startOfLocalDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Local midnight `days` calendar days before the day of `ts`. */
export function daysBefore(ts: number, days: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - days).getTime()
}

/** Which group a thread belongs to. Pinned wins over dates. */
export function groupOf(thread: Pick<Thread, 'pinned' | 'updatedAt'>, now: number): ThreadGroupId {
  if (thread.pinned) return 'pinned'
  const today = startOfLocalDay(now)
  if (thread.updatedAt >= today) return 'today'
  if (thread.updatedAt >= daysBefore(now, 1)) return 'yesterday'
  if (thread.updatedAt >= daysBefore(now, 7)) return 'week'
  return 'earlier'
}

/** Newest first, grouped; empty groups are left out. */
export function groupThreads(threads: readonly Thread[], now = Date.now()): ThreadGroup[] {
  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)
  const buckets = new Map<ThreadGroupId, Thread[]>()
  for (const t of sorted) {
    const g = groupOf(t, now)
    const list = buckets.get(g)
    if (list) list.push(t)
    else buckets.set(g, [t])
  }
  return ORDER.filter((id) => buckets.has(id)).map((id) => ({ id, label: GROUP_LABEL[id], threads: buckets.get(id)! }))
}

/** Compact time for a list row: "now", "4m", "3h", "Tue", "Oct 24". */
export function rowTime(ts: number, now = Date.now()): string {
  const diff = now - ts
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (ts >= startOfLocalDay(now)) return `${Math.floor(diff / 3_600_000)}h`
  if (ts >= daysBefore(now, 6)) return new Date(ts).toLocaleDateString(undefined, { weekday: 'short' })
  const d = new Date(ts)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' })
}

/**
 * The second line of a row: the last message with text, as one plain line (§6.2 "last line in ink-3").
 * A streaming placeholder without text yet falls back to the message before it.
 */
export function previewOf(messages: readonly (Message | undefined)[], max = 96): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (!m) continue
    const text = clipLine(plainText(m.content), max)
    if (text) return m.role === 'user' ? `You: ${text}` : text
    if (m.attachments?.length) return `You: ${m.attachments.map((a) => a.name).join(', ')}`
  }
  return ''
}
