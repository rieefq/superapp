import type { EntityRef } from '@/core/types'
import type { ComposerContextRefs } from './useComposerContext'

/**
 * Translate the Context Line into sendMessage's selection fields so the model receives exactly
 * what the user saw: switched-off chips are excluded (including project memory) and automatic
 * retrieval is restricted to the "Likely" items that were displayed.
 */
export function toChatSelection(ctx: ComposerContextRefs): { excludeRefs: EntityRef[]; retrievedRefs: EntityRef[] } {
  const excludeRefs = [...ctx.excluded]
  if (ctx.projectId && !ctx.projectMemory) excludeRefs.push({ kind: 'project', id: ctx.projectId })
  return { excludeRefs, retrievedRefs: [...ctx.likely] }
}
