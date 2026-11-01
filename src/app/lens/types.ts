import type { ComponentType } from 'react'
import type { EntityKind, EntityRef } from '@/core/types'

/**
 * Lens: one renderer per entity kind at three densities (docs/DESIGN.md §5.4.8).
 * - chip  → EntityChip (generic, from resolveEntity) — not provided here
 * - card  → HoverCard and ⌘K preview (optional; generic fallback exists)
 * - panel → Inspector › Item body (optional; generic fallback exists)
 * The Inspector adds Links (Came from · Led to · Used by · Cited by) and History automatically.
 */
export interface LensProps {
  entity: EntityRef
}

export interface LensRenderer {
  /** Kind-specific body for Inspector › Item (header, links and history are added by the shell). */
  panel?: ComponentType<LensProps>
  /** Compact preview for hover cards and the command-center preview pane. */
  card?: ComponentType<LensProps>
}

/** Shape of every `src/workspaces/<owner>/lens.tsx` module. */
export interface LensModule {
  lenses: Partial<Record<EntityKind, LensRenderer>>
}
