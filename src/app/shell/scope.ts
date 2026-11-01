/**
 * Scope (the active project) and Holding helpers shared by the project switcher, the command center,
 * the Holding popover and Inspector › Context. Scope lives in `useContextStore`, never in the URL.
 */
import { db } from '@/core/db'
import { getContext, useContextStore } from '@/core/context'
import { estimateTokens } from '@/core/ai'
import { describeSource, resolveEntity } from '@/core/services'
import type { EntityRef, ID } from '@/core/types'
import { refKey } from '@/core/types'
import { ENTITY_DRAG_TYPE, toast } from '@/ui'

const tokenCache = new Map<string, { at: number; tokens: number }>()

/** Rough token estimate for an entity as context (~4 chars per token), cached briefly per ref. */
export function estimateRefTokens(ref: EntityRef): number {
  const key = refKey(ref)
  const hit = tokenCache.get(key)
  const now = Date.now()
  if (hit && now - hit.at < 5_000) return hit.tokens
  let tokens = 0
  try {
    const { title, text } = describeSource(ref)
    tokens = estimateTokens(`${title}\n${text}`)
  } catch {
    tokens = 0
  }
  tokenCache.set(key, { at: now, tokens })
  return tokens
}

/** "~2.4k tok" / "~640 tok" (§8.3: tokens as `12.4k tok`, estimates prefixed with ~). */
export function formatTokenEstimate(tokens: number): string {
  if (tokens >= 1000) return `~${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k tok`
  return `~${tokens} tok`
}

/** Held items that belong to a project other than `projectId`. */
export function heldFromOtherProjects(projectId: ID): { ref: EntityRef; projectId: ID }[] {
  const out: { ref: EntityRef; projectId: ID }[] = []
  for (const item of getContext().pinned) {
    const resolved = resolveEntity(item.ref)
    if (resolved.exists && resolved.projectId && resolved.projectId !== projectId) out.push({ ref: item.ref, projectId: resolved.projectId })
  }
  return out
}

/**
 * Switch scope. When held items come from another project, an 8-second toast says so and offers
 * to release them (§2.4) — held items never silently ride across a project switch.
 */
export function switchScope(projectId: ID | null): void {
  const store = useContextStore.getState()
  if (store.scopeProjectId === projectId) return
  store.setScope(projectId)
  if (!projectId) return
  const others = heldFromOtherProjects(projectId)
  if (!others.length) return
  const names = [...new Set(others.map((o) => db.get('projects', o.projectId)?.name).filter(Boolean))] as string[]
  const from = names.length === 1 ? names[0] : `${names.length} other projects`
  const n = others.length
  toast({
    title: `${n} held item${n === 1 ? ' is' : 's are'} from ${from} and still ride${n === 1 ? 's' : ''} along.`,
    tone: 'neutral',
    duration: 8000,
    action: {
      label: n === 1 ? 'Release it' : 'Release them',
      onClick: () => {
        const ctx = useContextStore.getState()
        for (const o of others) ctx.unpin(o.ref)
      },
    },
  })
}

/** Release every held item, with an Undo toast (§3.10: release uses Undo, not a confirm). */
export function releaseAll(): void {
  const ctx = useContextStore.getState()
  const before = ctx.pinned
  if (!before.length) return
  ctx.clear()
  toast({
    title: `Released ${before.length} held item${before.length === 1 ? '' : 's'}`,
    duration: 8000,
    action: { label: 'Undo', onClick: () => useContextStore.setState({ pinned: before }) },
  })
}

/** Release one held item, with an Undo toast. */
export function releaseOne(ref: EntityRef): void {
  const ctx = useContextStore.getState()
  const index = ctx.pinned.findIndex((p) => p.ref.kind === ref.kind && p.ref.id === ref.id)
  if (index < 0) return
  const item = ctx.pinned[index]
  ctx.unpin(ref)
  toast({
    title: `Released “${resolveEntity(ref).title}”`,
    duration: 8000,
    action: {
      label: 'Undo',
      onClick: () => {
        const cur = useContextStore.getState().pinned
        if (cur.some((p) => p.ref.kind === ref.kind && p.ref.id === ref.id)) return
        const next = [...cur]
        next.splice(Math.min(index, next.length), 0, item)
        useContextStore.setState({ pinned: next })
      },
    },
  })
}

/** Hold or release an entity (the `H` key, Inspector › Item › Hold). */
export function toggleHold(ref: EntityRef): void {
  const ctx = useContextStore.getState()
  const held = ctx.pinned.some((p) => p.ref.kind === ref.kind && p.ref.id === ref.id)
  if (held) {
    releaseOne(ref)
  } else {
    ctx.pin(ref)
    toast({ title: `Holding “${resolveEntity(ref).title}”`, description: 'It rides along in every new AI action.' })
  }
}

/** The drag payload type used by EntityChip (JSON EntityRef). */
export { ENTITY_DRAG_TYPE }

export function readDraggedEntity(data: DataTransfer | null): EntityRef | null {
  if (!data) return null
  try {
    const raw = data.getData(ENTITY_DRAG_TYPE)
    if (!raw) return null
    const ref = JSON.parse(raw) as EntityRef
    return ref && typeof ref.kind === 'string' && typeof ref.id === 'string' ? { kind: ref.kind, id: ref.id } : null
  } catch {
    return null
  }
}
