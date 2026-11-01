import { db, ID_PREFIX, useRows } from '@/core/db'
import type { EntityRef, Link, LinkRel } from '@/core/types'
import { newId } from '@/lib/id'

/** Create a link from → to (idempotent for the same from/to/rel). */
export function link(from: EntityRef, to: EntityRef, rel: LinkRel): Link {
  const existing = db.find(
    'links',
    (l) => l.rel === rel && l.from.kind === from.kind && l.from.id === from.id && l.to.kind === to.kind && l.to.id === to.id,
  )
  if (existing) return existing
  const row: Link = { id: newId(ID_PREFIX.links), from, to, rel, createdAt: Date.now() }
  db.insert('links', row)
  return row
}

export function unlink(id: string): void {
  db.remove('links', id)
}

/** Remove every link touching an entity (call when deleting it). */
export function unlinkAll(ref: EntityRef): void {
  const ids = db
    .filter('links', (l) => (l.from.kind === ref.kind && l.from.id === ref.id) || (l.to.kind === ref.kind && l.to.id === ref.id))
    .map((l) => l.id)
  db.removeMany('links', ids)
}

export interface Connection {
  link: Link
  /** The entity on the other end. */
  other: EntityRef
  direction: 'outgoing' | 'incoming'
}

function connectionsFrom(links: Link[], ref: EntityRef): Connection[] {
  const out: Connection[] = []
  for (const l of links) {
    if (l.from.kind === ref.kind && l.from.id === ref.id) out.push({ link: l, other: l.to, direction: 'outgoing' })
    else if (l.to.kind === ref.kind && l.to.id === ref.id) out.push({ link: l, other: l.from, direction: 'incoming' })
  }
  return out.sort((a, b) => b.link.createdAt - a.link.createdAt)
}

/** All entities connected to `ref` in either direction (backlinks + forward links). */
export function getConnections(ref: EntityRef): Connection[] {
  return connectionsFrom(db.all('links'), ref)
}

export function useConnections(ref: EntityRef | null | undefined): Connection[] {
  const links = useRows(
    'links',
    (l) => !!ref && ((l.from.kind === ref.kind && l.from.id === ref.id) || (l.to.kind === ref.kind && l.to.id === ref.id)),
  )
  return ref ? connectionsFrom(links, ref) : []
}
