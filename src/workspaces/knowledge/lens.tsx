import { useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight } from 'lucide-react'
import type { LensModule, LensProps } from '@/app/lens/types'
import { useDB, useRow, type Tables } from '@/core/db'
import { AI_AVAILABILITY_LABEL, KNOWLEDGE_KIND_META, useKnowledgeUsage } from '@/core/services'
import { Button, EntityChip } from '@/ui'
import { cn } from '@/lib/cn'
import { formatBytes, timeAgo } from '@/lib/format'
import { countWords, excerptOf, isImage, isIndexed } from './model'
import { AvailabilityTag, NotIndexedTag, originWords } from './parts'
import { AvailabilityControl, CollectionControl, ProjectsControl, TagsControl } from './properties'

/**
 * Lens renderers for the kinds Knowledge owns (§5.4.8): `knowledge` and `collection`. The panel is the
 * Inspector › Item body (the shell adds the header, Links and History); the card is the hover card and
 * ⌘K preview body. Both work anywhere in the app.
 */

function Section({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[88px_minmax(0,1fr)] items-start gap-3', className)}>
      <span className="type-caption pt-1.5 text-ink-3">{label}</span>
      <div className="flex min-w-0 items-center pt-0.5">{children}</div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ knowledge

function KnowledgePanel({ entity }: LensProps) {
  const item = useRow('knowledge', entity.id)
  const usage = useKnowledgeUsage(entity.id)
  const cited = useDB((s: Tables) => {
    let n = 0
    for (const l of Object.values(s.links)) if (l.rel === 'cites' && l.to.kind === 'knowledge' && l.to.id === entity.id && l.from.kind === 'message') n++
    return n
  })
  const origin = useDB((s: Tables) => (item ? originWords(s, item)?.label : undefined))
  const words = useMemo(() => (item ? countWords(item.content) : 0), [item])
  if (!item) return null
  const summary = item.summary?.trim() || excerptOf(item, 320)
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      {item.file?.previewUrl && isImage(item) && (
        <img src={item.file.previewUrl} alt="" className="max-h-44 w-full rounded-sm border border-line bg-sunken object-contain" draggable={false} />
      )}
      {summary && <p className="type-body-sm text-pretty text-ink-2">{summary}</p>}
      <p className="type-meta flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
        <span className="text-ink-2">{isImage(item) ? 'Image' : (KNOWLEDGE_KIND_META[item.kind] ?? KNOWLEDGE_KIND_META.note).label}</span>
        <span aria-hidden>·</span>
        <span className="tabular">{words.toLocaleString('en-US')} words</span>
        {origin && (
          <>
            <span aria-hidden>·</span>
            <span>from {origin}</span>
          </>
        )}
        {item.file && (
          <>
            <span aria-hidden>·</span>
            <span>{formatBytes(item.file.size)}</span>
          </>
        )}
        {!isIndexed(item) && <NotIndexedTag />}
      </p>
      <div className="flex flex-col gap-2.5">
        <Section label="Available to AI">
          <AvailabilityControl item={item} />
        </Section>
        <Section label="Collection">
          <CollectionControl item={item} />
        </Section>
        <Section label="Projects">
          <ProjectsControl item={item} />
        </Section>
        <Section label="Tags">
          <TagsControl item={item} />
        </Section>
        <Section label="Used">
          <span className="type-body-sm text-ink-2">
            {usage.count ? (
              <>
                by {usage.count} run{usage.count === 1 ? '' : 's'} · last {timeAgo(usage.lastAt)}
              </>
            ) : (
              <span className="text-ink-3">No run has read it yet</span>
            )}
            {cited > 0 && (
              <span className="text-ink-3">
                {' '}
                · cited in {cited} answer{cited === 1 ? '' : 's'}
              </span>
            )}
          </span>
        </Section>
      </div>
    </div>
  )
}

function KnowledgeCard({ entity }: LensProps) {
  const item = useRow('knowledge', entity.id)
  const usage = useKnowledgeUsage(entity.id)
  if (!item) return null
  const kind = isImage(item) ? 'Image' : (KNOWLEDGE_KIND_META[item.kind] ?? KNOWLEDGE_KIND_META.note).label
  return (
    <div className="flex flex-col gap-2">
      {item.file?.previewUrl && isImage(item) ? (
        <img src={item.file.previewUrl} alt="" className="max-h-28 w-full rounded-xs border border-line bg-sunken object-cover" draggable={false} />
      ) : (
        <p className="type-caption line-clamp-3 text-pretty text-ink-2">{excerptOf(item, 260)}</p>
      )}
      <p className="type-meta flex flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
        <span>{kind}</span>
        <span aria-hidden>·</span>
        <span className="tabular">{usage.count ? `used by ${usage.count} run${usage.count === 1 ? '' : 's'}` : 'not used yet'}</span>
        {item.aiAvailability && item.aiAvailability !== 'always' && <AvailabilityTag value={item.aiAvailability} />}
        {!isIndexed(item) && <NotIndexedTag />}
      </p>
      {item.aiAvailability && item.aiAvailability !== 'always' && (
        <span className="sr-only">Available to AI: {AI_AVAILABILITY_LABEL[item.aiAvailability]}</span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ collection

function useCollectionItems(id: string) {
  return useDB(
    useShallow((s: Tables) =>
      Object.values(s.knowledge)
        .filter((k) => k.collectionId === id)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    ),
  )
}

function CollectionPanel({ entity }: LensProps) {
  const navigate = useNavigate()
  const collection = useRow('collections', entity.id)
  const items = useCollectionItems(entity.id)
  const kinds = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of items) m.set(k.kind, (m.get(k.kind) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [items])
  if (!collection) return null
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      {collection.description && <p className="type-body-sm text-pretty text-ink-2">{collection.description}</p>}
      <p className="type-meta flex flex-wrap gap-x-1.5 text-ink-3">
        <span className="text-ink-2 tabular">
          {items.length} item{items.length === 1 ? '' : 's'}
        </span>
        {kinds.map(([kind, n]) => (
          <span key={kind}>
            · {n} {(KNOWLEDGE_KIND_META[kind as keyof typeof KNOWLEDGE_KIND_META]?.label ?? kind).toLowerCase()}
            {n === 1 ? '' : 's'}
          </span>
        ))}
      </p>
      {items.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="type-label text-ink-3">Recent</span>
          <div className="flex flex-wrap gap-1.5">
            {items.slice(0, 8).map((k) => (
              <EntityChip key={k.id} entity={{ kind: 'knowledge', id: k.id }} size="sm" />
            ))}
            {items.length > 8 && <span className="type-meta self-center text-ink-3">+{items.length - 8}</span>}
          </div>
        </div>
      ) : (
        <p className="type-caption text-ink-3">Nothing in this collection yet.</p>
      )}
      <Button size="sm" variant="secondary" leadingIcon={ArrowUpRight} onClick={() => navigate(`/knowledge?collection=${encodeURIComponent(collection.id)}`)} className="self-start">
        Open collection
      </Button>
    </div>
  )
}

function CollectionCard({ entity }: LensProps) {
  const collection = useRow('collections', entity.id)
  const items = useCollectionItems(entity.id)
  if (!collection) return null
  return (
    <div className="flex flex-col gap-1.5">
      {collection.description && <p className="type-caption line-clamp-2 text-pretty text-ink-2">{collection.description}</p>}
      <p className="type-meta text-ink-3 tabular">
        {items.length} item{items.length === 1 ? '' : 's'}
        {items[0] ? ` · latest “${items[0].title}”` : ''}
      </p>
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  knowledge: { panel: KnowledgePanel, card: KnowledgeCard },
  collection: { panel: CollectionPanel, card: CollectionCard },
}
