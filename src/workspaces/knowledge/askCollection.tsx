import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Composer, toChatSelection, useComposerContext, type ComposerSubmitMeta } from '@/app/components'
import { sendMessage } from '@/core/ai'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { retrieveKnowledge } from '@/core/search'
import { sameRef, type Collection, type EntityRef, type ID } from '@/core/types'

/** How many of the collection's best-matching items a question reads. */
export const COLLECTION_READS = 4

/** The collection's items that the question would read: real local retrieval, limited to the collection. */
export function collectionMatches(question: string, collectionId: ID, limit = COLLECTION_READS): EntityRef[] {
  const text = question.trim()
  if (!text) return []
  const ids = db.filter('knowledge', (k) => k.collectionId === collectionId && k.aiAvailability !== 'never').map((k) => k.id)
  if (!ids.length) return []
  try {
    // Explicit ids: items set to "When cited" count as cited here — the user asked this collection.
    return retrieveKnowledge(text, { ids, limit }).map((r) => ({ kind: 'knowledge', id: r.item.id }))
  } catch {
    return []
  }
}

/**
 * "Ask this collection" (§6.7): a composer at the foot of a collection view. The collection rides in the
 * Context Line; the line under the input names the items the question will read (its best matches,
 * found locally). Sending opens a new conversation in Chat with those items attached.
 */
export function AskCollection({ collection }: { collection: Collection }) {
  const navigate = useNavigate()
  const scope = useScope()
  const ref = useMemo<EntityRef>(() => ({ kind: 'collection', id: collection.id }), [collection.id])
  const ctx = useComposerContext({ initialAttached: [ref], autoRetrieve: false, label: `Knowledge · Ask ${collection.name}` })
  const [draft, setDraft] = useState('')
  const [reads, setReads] = useState<EntityRef[]>([])
  const count = useDB((s: Tables) => Object.values(s.knowledge).filter((k) => k.collectionId === collection.id).length)
  const titles = useDB((s: Tables) => reads.map((r) => s.knowledge[r.id]?.title).filter(Boolean).join(' · '))
  const collectionOn = ctx.refs.attached.some((r) => sameRef(r, ref))

  // Debounced, so the line settles while typing.
  useEffect(() => {
    const t = setTimeout(() => setReads(collectionOn ? collectionMatches(draft, collection.id) : []), 260)
    return () => clearTimeout(t)
  }, [draft, collection.id, collectionOn])

  const onSubmit = async (text: string, meta: ComposerSubmitMeta) => {
    const matches = collectionOn ? collectionMatches(text, collection.id) : []
    const result = await sendMessage({
      text,
      attachments: meta.attachments,
      modelId: meta.modelId,
      projectId: meta.context.projectId ?? scope,
      contextRefs: [...meta.context.attached, ...matches],
      ...toChatSelection(meta.context),
    })
    navigate(`/chat/${encodeURIComponent(result.threadId)}`)
  }

  const below = !collectionOn ? (
    <p className="type-caption text-ink-3">The collection is switched off — this goes to Chat as a plain question.</p>
  ) : draft.trim() && titles ? (
    <p className="type-caption truncate text-ink-3" title={titles}>
      Will read <span className="text-ink-2">{titles}</span>
    </p>
  ) : (
    <p className="type-caption text-ink-3">
      Reads the best-matching items of {count} in {collection.name} (found locally), then opens in Chat.
    </p>
  )

  return (
    <Composer
      context={ctx}
      size="compact"
      placeholder={`Ask ${collection.name}…`}
      submitLabel="Ask"
      value={draft}
      onValueChange={setDraft}
      below={below}
      onSubmit={onSubmit}
      aria-label={`Ask ${collection.name}`}
    />
  )
}
