import { createThread } from '@/core/ai'
import { getContext } from '@/core/context'
import { db } from '@/core/db'
import {
  AI_AVAILABILITY_LABEL,
  deleteKnowledgeItems,
  duplicateKnowledge,
  entityRoute,
  pinToProject,
  updateKnowledge,
  type AiAvailability,
} from '@/core/services'
import { getSettings } from '@/core/settings'
import { sameRef, type EntityRef, type ID } from '@/core/types'
import { confirm, toast } from '@/ui'

/**
 * Imperative Knowledge actions shared by the library, the reader, the lens panel and ⌘K. Each writes
 * through the domain services (activity, links and cleanup stay consistent) and reports in a toast.
 */

type Navigate = (to: string) => void

const kref = (id: ID): EntityRef => ({ kind: 'knowledge', id })

/**
 * "Ask about this" (§6.7): open a conversation with the item attached. Reuses an empty conversation
 * that already has exactly this attachment, so repeated clicks never pile up blank threads.
 */
export function askAbout(ref: EntityRef, navigate: Navigate): void {
  const existing = db.find(
    'threads',
    (t) => !t.archived && t.messageIds.length === 0 && t.contextRefs.length === 1 && sameRef(t.contextRefs[0], ref),
  )
  // The item's project (the scope when the item belongs to it), else the scope: the run files where the item lives.
  const scope = getContext().scopeProjectId
  const projects = ref.kind === 'knowledge' ? (db.get('knowledge', ref.id)?.projectIds ?? []) : []
  const projectId = scope && projects.includes(scope) ? scope : (projects[0] ?? scope)
  const thread = existing ?? createThread({ projectId, contextRefs: [ref] })
  navigate(`/chat/${encodeURIComponent(thread.id)}`)
}

/**
 * Set "Available to AI". Never also releases the item from Holding, so nothing marked Never rides
 * along in later AI actions.
 */
export function setAvailability(id: ID, value: AiAvailability): void {
  const item = db.get('knowledge', id)
  if (!item) return
  updateKnowledge(id, { aiAvailability: value })
  const ctx = getContext()
  const held = ctx.pinned.some((p) => sameRef(p.ref, kref(id)))
  if (value === 'never' && held) {
    ctx.unpin(kref(id))
    toast({ title: `Available to AI: ${AI_AVAILABILITY_LABEL[value]}`, description: `Released “${item.title}” from Holding — items set to Never don’t ride along.` })
    return
  }
  toast({ title: `Available to AI: ${AI_AVAILABILITY_LABEL[value]}`, description: availabilityToast(value) })
}

function availabilityToast(value: AiAvailability): string {
  if (value === 'never') return 'Retrieval will never read it.'
  if (value === 'cited') return 'Read only when you hold, attach or @-mention it.'
  return 'Retrieval can pick it again.'
}

/** Delete with the confirm dialog when Settings › Safety asks for it. Resolves true when deleted. */
export async function deleteWithConfirm(ids: readonly ID[]): Promise<boolean> {
  const items = ids.map((id) => db.get('knowledge', id)).filter((k): k is NonNullable<typeof k> => !!k)
  if (!items.length) return false
  const one = items.length === 1
  if (getSettings().safety.confirmDestructive) {
    const ok = await confirm({
      title: one ? `Delete “${items[0].title}”?` : `Delete ${items.length} items?`,
      description: one
        ? 'It’s removed from Knowledge, from Holding and from any project memory or conversation that pointed to it. This can’t be undone.'
        : 'They’re removed from Knowledge, from Holding and from any project memory or conversation that pointed to them. This can’t be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return false
  }
  const n = deleteKnowledgeItems(items.map((k) => k.id))
  toast({ title: one ? `Deleted “${items[0].title}”` : `Deleted ${n} items` })
  return true
}

export function duplicate(id: ID, navigate: Navigate): void {
  const copy = duplicateKnowledge(id)
  if (!copy) {
    toast({ tone: 'error', title: 'Couldn’t duplicate', description: 'The item no longer exists.' })
    return
  }
  navigate(entityRoute(kref(copy.id)))
  toast({ tone: 'success', title: `Duplicated as “${copy.title}”` })
}

export function addToProjectMemory(id: ID, projectId: ID): void {
  const project = db.get('projects', projectId)
  const item = db.get('knowledge', id)
  if (!project || !item) return
  if (project.pinnedRefs.some((r) => sameRef(r, kref(id)))) {
    toast({ title: `Already in ${project.name}’s memory` })
    return
  }
  pinToProject(projectId, kref(id))
  if (!item.projectIds.includes(projectId)) updateKnowledge(id, { projectIds: [...item.projectIds, projectId] }, { silent: true })
  toast({ tone: 'success', title: `Added to ${project.name}’s memory`, description: 'It’s read in every new run of this project.' })
}
