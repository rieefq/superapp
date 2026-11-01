import type { LensModule } from '@/app/lens/types'

/**
 * Lens renderers for the entity kinds this workspace owns (docs/DESIGN.md §5.4.8).
 * Fill in `panel` (Inspector › Item body) and optionally `card` (hover card / ⌘K preview).
 */
export const lenses: LensModule['lenses'] = {}
