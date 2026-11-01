import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ContextItem, EntityRef, ID } from '@/core/types'

/**
 * Shared context — the "working memory" every AI action can draw from.
 * - scopeProjectId: the active project (like a working directory). null = all work.
 * - pinned: entities the user explicitly placed in context; they travel across workspaces.
 */
interface ContextStore {
  scopeProjectId: ID | null
  pinned: ContextItem[]
  setScope: (projectId: ID | null) => void
  pin: (ref: EntityRef) => void
  unpin: (ref: EntityRef) => void
  toggle: (ref: EntityRef) => void
  clear: () => void
}

const same = (a: EntityRef, b: EntityRef) => a.kind === b.kind && a.id === b.id

export const useContextStore = create<ContextStore>()(
  persist(
    (set, get) => ({
      scopeProjectId: null,
      pinned: [],
      setScope: (projectId) => set({ scopeProjectId: projectId }),
      pin: (ref) => {
        if (get().pinned.some((p) => same(p.ref, ref))) return
        set((s) => ({ pinned: [...s.pinned, { ref, addedAt: Date.now(), source: 'user' }] }))
      },
      unpin: (ref) => set((s) => ({ pinned: s.pinned.filter((p) => !same(p.ref, ref)) })),
      toggle: (ref) => (get().pinned.some((p) => same(p.ref, ref)) ? get().unpin(ref) : get().pin(ref)),
      clear: () => set({ pinned: [] }),
    }),
    { name: 'atrium.context', version: 1 },
  ),
)

export const useScope = () => useContextStore((s) => s.scopeProjectId)
export const usePinned = () => useContextStore((s) => s.pinned)
export const useIsPinned = (ref: EntityRef | null | undefined) =>
  useContextStore((s) => !!ref && s.pinned.some((p) => same(p.ref, ref)))
export const getContext = () => useContextStore.getState()
