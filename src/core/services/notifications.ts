import { db, ID_PREFIX, useCount, useRows } from '@/core/db'
import type { EntityRef, Notification, NotificationKind, Tone } from '@/core/types'
import { createEmitter } from '@/lib/emitter'
import { newId } from '@/lib/id'

const MAX_NOTIFICATIONS = 300

/** Fired for every new notification; the shell turns these into toasts when enabled. */
export const notificationEvents = createEmitter<{ created: Notification }>()

export function notify(input: { kind: NotificationKind; title: string; body?: string; ref?: EntityRef; tone?: Tone }): Notification {
  const n: Notification = {
    id: newId(ID_PREFIX.notifications),
    kind: input.kind,
    title: input.title,
    body: input.body,
    ref: input.ref,
    tone: input.tone ?? 'neutral',
    createdAt: Date.now(),
  }
  db.insert('notifications', n)
  const all = db.all('notifications')
  if (all.length > MAX_NOTIFICATIONS) {
    const excess = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - MAX_NOTIFICATIONS)
    db.removeMany('notifications', excess.map((x) => x.id))
  }
  notificationEvents.emit('created', n)
  return n
}

export function markRead(id: string): void {
  db.update('notifications', id, (n) => (n.readAt ? n : { ...n, readAt: Date.now() }))
}

export function markAllRead(): void {
  const now = Date.now()
  for (const n of db.filter('notifications', (x) => !x.readAt)) db.update('notifications', n.id, { readAt: now })
}

export function clearNotifications(): void {
  db.removeMany('notifications', db.all('notifications').map((n) => n.id))
}

export function useNotifications(limit = 100): Notification[] {
  return useRows('notifications', undefined, (a, b) => b.createdAt - a.createdAt).slice(0, limit)
}

export function useUnreadCount(): number {
  return useCount('notifications', (n) => !n.readAt)
}
