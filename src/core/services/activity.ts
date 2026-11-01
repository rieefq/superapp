import { db, ID_PREFIX, useRows } from '@/core/db'
import type { ActivityEvent, ActorRef, EntityRef, ID } from '@/core/types'
import { newId } from '@/lib/id'

const MAX_EVENTS = 2000

/** Append an event to the audit log (the transparent execution history). */
export function logActivity(input: {
  actor: ActorRef
  verb: string
  target: EntityRef
  summary: string
  projectId?: ID | null
  meta?: Record<string, unknown>
  at?: number
}): ActivityEvent {
  const event: ActivityEvent = {
    id: newId(ID_PREFIX.activity),
    at: input.at ?? Date.now(),
    actor: input.actor,
    verb: input.verb,
    target: input.target,
    summary: input.summary,
    projectId: input.projectId ?? null,
    meta: input.meta,
  }
  db.insert('activity', event)
  // Keep the log bounded.
  const all = db.all('activity')
  if (all.length > MAX_EVENTS) {
    const excess = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_EVENTS)
    db.removeMany('activity', excess.map((e) => e.id))
  }
  return event
}

/** Activity for an entity (as target), newest first. */
export function useActivityFor(ref: EntityRef | null | undefined, limit = 50): ActivityEvent[] {
  const rows = useRows(
    'activity',
    (e) => !!ref && e.target.kind === ref.kind && e.target.id === ref.id,
    (a, b) => b.at - a.at,
  )
  return rows.slice(0, limit)
}

/** Activity within a project (or all when projectId is null), newest first. */
export function useProjectActivity(projectId: ID | null, limit = 50): ActivityEvent[] {
  const rows = useRows('activity', (e) => projectId === null || e.projectId === projectId, (a, b) => b.at - a.at)
  return rows.slice(0, limit)
}
