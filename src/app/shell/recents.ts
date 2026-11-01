/**
 * Recents (§2.7): the entity a route opens, derived from the pathname and query. Pure — unit-tested.
 * Reserved segments (`new`, `runs`, `roster`, `repos`, `my-tasks`) are never ids (§2.6).
 */
import type { EntityRef } from '@/core/types'

const RESERVED = new Set(['new', 'runs', 'roster', 'repos', 'my-tasks'])

const dec = (s: string | undefined) => {
  if (!s) return ''
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** The entities a location opens, most specific last ([] when it opens none). */
export function entitiesFromLocation(pathname: string, search = ''): EntityRef[] {
  const parts = pathname.split('/').filter(Boolean)
  const params = new URLSearchParams(search)
  const [ws, a, b] = parts
  const id = dec(a)
  const out: EntityRef[] = []
  const ok = (x: string) => !!x && !RESERVED.has(x)
  switch (ws) {
    case 'chat':
      if (ok(id)) out.push({ kind: 'thread', id })
      break
    case 'research':
      if (ok(id)) out.push({ kind: 'investigation', id })
      break
    case 'code':
      if (a === 'repos' && b) out.push({ kind: 'repo', id: dec(b) })
      else if (ok(id)) out.push({ kind: 'session', id })
      break
    case 'studio':
      if (ok(id)) out.push({ kind: 'asset', id })
      break
    case 'agents':
      if (a === 'runs' && b) out.push({ kind: 'run', id: dec(b) })
      else if (ok(id)) out.push({ kind: 'agent', id })
      break
    case 'workflows':
      if (ok(id)) out.push({ kind: 'workflow', id })
      break
    case 'projects':
      if (ok(id)) out.push({ kind: 'project', id })
      if (params.get('task')) out.push({ kind: 'task', id: params.get('task')! })
      break
    case 'knowledge':
      if (ok(id)) out.push({ kind: 'knowledge', id })
      break
    case 'integrations':
      if (ok(id)) out.push({ kind: 'integration', id })
      break
  }
  return out
}
