import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import {
  BookMarked,
  Clock,
  Hash,
  Layers,
  Library,
  MessagesSquare,
  Orbit,
  Plus,
  ScanSearch,
  SquareDashed,
  Telescope,
  Upload,
  type LucideIcon,
} from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows } from '@/app/templates'
import { useDB, type Tables } from '@/core/db'
import type { KnowledgeItem } from '@/core/types'
import { IconButton, MonogramMark } from '@/ui'
import { cn } from '@/lib/cn'
import { CollectionDialog } from './dialogs'
import { useFilterContext, useKnowledgePrefs, useListScope, usePaneCounts } from './hooks'
import { matchesSmartFilter, parseLibraryParams, sameSection, sectionHref, SMART_FILTERS, type Section, type SmartFilter } from './model'

const FILTER_ICON: Record<SmartFilter, LucideIcon> = {
  recent: Clock,
  held: Layers,
  memory: BookMarked,
  research: Telescope,
  uploads: Upload,
  chat: MessagesSquare,
  agents: Orbit,
  simulated: SquareDashed,
}

const FILTER_IDS = SMART_FILTERS.map((f) => f.id)
const TAGS_COLLAPSED = 8

/** Which section the URL shows (the reader and the lab select nothing). */
function useCurrentSection(): Section | null {
  const location = useLocation()
  return useMemo(() => {
    if (location.pathname.replace(/\/+$/, '') !== '/knowledge') return null
    return parseLibraryParams(new URLSearchParams(location.search)).section
  }, [location.pathname, location.search])
}

function Count({ n }: { n: number }) {
  return <span className={cn('tabular', n === 0 && 'text-ink-4')}>{n}</span>
}

/** A list-pane group header with an action (ListGroup's look, plus a button). */
function GroupHeader({ label, count, action }: { label: string; count?: number; action?: ReactNode }) {
  return (
    <div className="flex h-8 items-center gap-1.5 pt-2 pr-2 pl-4">
      <h3 className="type-label flex flex-1 items-center gap-1.5 text-ink-3">
        {label}
        {count !== undefined && <span className="type-meta font-normal tracking-normal normal-case">{count}</span>}
      </h3>
      {action}
    </div>
  )
}

/**
 * The list pane's body (§6.7): All knowledge · Collections (the scoped project's first) · Smart filters ·
 * Tags · Tools. Rendered in the list pane and, on phones, in the Browse sheet.
 */
export function KnowledgeSections({ onNavigate }: { onNavigate?: () => void }) {
  ;(window as unknown as Record<string, number>).__knPane = ((window as unknown as Record<string, number>).__knPane ?? 0) + 1 // PERF-PROBE
  const navigate = useNavigate()
  const current = useCurrentSection()
  const { scope } = useListScope()
  const location = useLocation()
  const ctx = useFilterContext(scope)
  const match = useCallback((item: KnowledgeItem, id: string) => matchesSmartFilter(item, id as SmartFilter, ctx), [ctx])
  const counts = usePaneCounts(scope, match, FILTER_IDS)
  const collections = useDB(useShallow((s: Tables) => Object.values(s.collections)))
  const tagsExpanded = useKnowledgePrefs((s) => s.tagsExpanded)
  const setTagsExpanded = useKnowledgePrefs((s) => s.setTagsExpanded)
  const [creating, setCreating] = useState(false)

  // Collections: the scoped project's first (those holding its items), then the rest; A→Z within each.
  const ordered = useMemo(() => {
    const byName = [...collections].sort((a, b) => a.name.localeCompare(b.name))
    if (!scope) return byName
    return [...byName.filter((c) => (counts.collections[c.id] ?? 0) > 0), ...byName.filter((c) => !(counts.collections[c.id] ?? 0))]
  }, [collections, counts.collections, scope])

  const tags = tagsExpanded ? counts.tags : counts.tags.slice(0, TAGS_COLLAPSED)
  const selected = (section: Section) => !!current && sameSection(current, section)
  const go = (to: string) => () => {
    onNavigate?.()
    navigate(to)
  }
  const inLab = location.pathname.startsWith('/knowledge/retrieval')

  return (
    <>
      <ListRows label="Knowledge sections" className="pb-3">
        <ListRow
          onClick={go(sectionHref({ type: 'all' }))}
          selected={selected({ type: 'all' })}
          leading={<Library aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
          title="All knowledge"
          meta={<Count n={counts.all} />}
        />

        <GroupHeader
          label="Collections"
          action={<IconButton icon={Plus} label="New collection" size="xs" onClick={() => setCreating(true)} />}
        />
        {ordered.map((c) => (
          <ListRow
            key={c.id}
            onClick={go(sectionHref({ type: 'collection', id: c.id }))}
            selected={selected({ type: 'collection', id: c.id })}
            entity={{ kind: 'collection', id: c.id }}
            leading={<MonogramMark text={c.name} hue={c.hue} size={16} />}
            title={c.name}
            meta={<Count n={counts.collections[c.id] ?? 0} />}
          />
        ))}
        {collections.length === 0 && <p className="type-caption px-4 pb-1 text-ink-3">No collections yet. Group related items with +.</p>}
        {counts.noCollection > 0 && (
          <ListRow
            onClick={go(sectionHref({ type: 'collection', id: null }))}
            selected={selected({ type: 'collection', id: null })}
            leading={<span aria-hidden className="block size-4 rounded-[4px] border border-line-input" />}
            title="No collection"
            meta={<Count n={counts.noCollection} />}
          />
        )}

        <ListGroup label="Smart filters" className="pt-1">
          {SMART_FILTERS.map((f) => {
            const Icon = FILTER_ICON[f.id]
            return (
              <ListRow
                key={f.id}
                onClick={go(sectionHref({ type: 'filter', id: f.id }))}
                selected={selected({ type: 'filter', id: f.id })}
                leading={<Icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
                title={f.label}
                meta={<Count n={counts.filters[f.id] ?? 0} />}
                aria-label={`${f.label}: ${counts.filters[f.id] ?? 0}. ${f.description}`}
              />
            )
          })}
        </ListGroup>

        {counts.tags.length > 0 && (
          <ListGroup label="Tags" count={counts.tags.length}>
            {tags.map((t) => (
              <ListRow
                key={t.tag}
                onClick={go(sectionHref({ type: 'tag', tag: t.tag }))}
                selected={selected({ type: 'tag', tag: t.tag })}
                leading={<Hash aria-hidden className="size-3.5 text-ink-3" strokeWidth={1.75} />}
                title={t.tag}
                meta={<Count n={t.count} />}
              />
            ))}
            {counts.tags.length > TAGS_COLLAPSED && (
              <button
                type="button"
                onClick={() => setTagsExpanded(!tagsExpanded)}
                className="type-caption mx-1.5 flex h-8 items-center rounded-sm px-2.5 text-left font-medium text-ink-3 hover:bg-hover hover:text-ink pointer-coarse:h-11"
              >
                {tagsExpanded ? 'Show fewer tags' : `Show all ${counts.tags.length} tags`}
              </button>
            )}
          </ListGroup>
        )}

        <ListGroup label="Tools">
          <ListRow
            onClick={go('/knowledge/retrieval')}
            selected={inLab}
            leading={<ScanSearch aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
            title="Retrieval lab"
            secondary="What would the AI retrieve?"
          />
        </ListGroup>
      </ListRows>
      <CollectionDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(id) => {
          onNavigate?.()
          navigate(sectionHref({ type: 'collection', id }))
        }}
      />
    </>
  )
}

/** The list pane (§3.4 anatomy): "Knowledge" · count · + New note (N), then the sections. */
export function KnowledgeListPane({ onNewNote }: { onNewNote: () => void }) {
  const { scope } = useListScope()
  const count = useDB((s: Tables) => {
    let n = 0
    for (const k of Object.values(s.knowledge)) if (!scope || k.projectIds.includes(scope)) n++
    return n
  })
  return (
    <ListPane title="Knowledge" count={count} onNew={onNewNote} newLabel="New note">
      <KnowledgeSections />
    </ListPane>
  )
}
