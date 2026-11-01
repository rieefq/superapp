import { useEffect, useState } from 'react'
import { KIND_META } from '@/core/services/entities'
import type { EntityKind } from '@/core/types'
import type { LensModule, LensRenderer } from './types'

/**
 * Lazy lens modules per owning workspace (KIND_META[kind].workspace). Each workspace that owns
 * entity kinds exports `lenses` from its own `lens.tsx`; the shell never imports workspace UI eagerly.
 */
const loaders: Record<string, () => Promise<LensModule>> = {
  chat: () => import('@/workspaces/chat/lens'),
  research: () => import('@/workspaces/research/lens'),
  code: () => import('@/workspaces/code/lens'),
  studio: () => import('@/workspaces/studio/lens'),
  agents: () => import('@/workspaces/agents/lens'),
  workflows: () => import('@/workspaces/workflows/lens'),
  projects: () => import('@/workspaces/projects/lens'),
  knowledge: () => import('@/workspaces/knowledge/lens'),
  integrations: () => import('@/workspaces/integrations/lens'),
}

const cache = new Map<string, LensModule>()

export async function loadLens(kind: EntityKind): Promise<LensRenderer | undefined> {
  const owner = KIND_META[kind]?.workspace
  const load = owner ? loaders[owner] : undefined
  if (!owner || !load) return undefined
  let mod = cache.get(owner)
  if (!mod) {
    mod = await load()
    cache.set(owner, mod)
  }
  return mod.lenses[kind]
}

/** The lens renderer for a kind (undefined while loading or when the owner provides none). */
export function useLens(kind: EntityKind | undefined): { lens: LensRenderer | undefined; loading: boolean } {
  const owner = kind ? KIND_META[kind]?.workspace : undefined
  const cached = owner ? cache.get(owner) : undefined
  const [state, setState] = useState<{ kind?: EntityKind; lens?: LensRenderer; loading: boolean }>(() => ({
    kind,
    lens: kind && cached ? cached.lenses[kind] : undefined,
    loading: !!kind && !cached && !!owner && owner in loaders,
  }))
  useEffect(() => {
    let alive = true
    if (!kind) return
    if (cached) {
      setState({ kind, lens: cached.lenses[kind], loading: false })
      return
    }
    setState({ kind, lens: undefined, loading: true })
    loadLens(kind)
      .then((lens) => alive && setState({ kind, lens, loading: false }))
      .catch(() => alive && setState({ kind, lens: undefined, loading: false }))
    return () => {
      alive = false
    }
  }, [kind, cached])
  return state.kind === kind ? { lens: state.lens, loading: state.loading } : { lens: undefined, loading: !!kind }
}
