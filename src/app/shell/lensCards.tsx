import type { ComponentType, ReactNode } from 'react'
import type { EntityKind, EntityRef } from '@/core/types'
import { loadLens } from '../lens/registry'
import type { LensProps } from '../lens/types'

/**
 * Plugs each workspace's Lens `card` renderer into the signature hover cards (EntityCardProvider).
 * Lens modules load lazily: the first hover over a kind starts loading its module (that card shows the
 * generic excerpt); once loaded, later hovers render the workspace's own card.
 */
const cards = new Map<EntityKind, ComponentType<LensProps> | null>()

export function renderLensCard(entity: EntityRef): ReactNode {
  const known = cards.get(entity.kind)
  if (known === undefined) {
    cards.set(entity.kind, null)
    void loadLens(entity.kind)
      .then((lens) => cards.set(entity.kind, (lens?.card as ComponentType<LensProps> | undefined) ?? null))
      .catch(() => cards.delete(entity.kind))
    return null
  }
  if (!known) return null
  const Card = known
  return <Card entity={entity} />
}
