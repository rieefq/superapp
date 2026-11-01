import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { ArrowUpRight, Ellipsis, Layers, MessageSquare, PenLine, Shuffle, SquareCheck, Trash2 } from 'lucide-react'
import { openStartSheet, setSelection } from '@/app/shell/store'
import { useInspectEntity } from '@/app/templates'
import { toggleHold } from '@/app/shell/scope'
import { useIsPinned } from '@/core/context'
import { KNOWLEDGE_KIND_META, useKnowledgeUsage } from '@/core/services'
import type { EntityRef, ID, KnowledgeItem } from '@/core/types'
import { Checkbox, IconButton, Menu, SimBadge, type MenuItem } from '@/ui'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { askAbout, deleteWithConfirm } from './actions'
import type { LibraryEntry } from './hooks'
import { excerptOf, isImage, isIndexed, type ViewMode } from './model'
import { AvailabilityTag, Highlight, KnowledgeTile, NotIndexedTag, OriginLabel } from './parts'

/**
 * The library's results (§6.7): `--row-h-2` rows (kind tile, title 600, excerpt with highlights, meta) or
 * a ruled grid of cards. One tab stop (roving): ↑↓ or J K move (←→ too in the grid), Home/End jump,
 * ⏎ opens, Space inspects, X selects, H holds, T turns into…, E edits.
 */

export interface ResultsProps {
  entries: readonly LibraryEntry[]
  view: ViewMode
  selected: ReadonlySet<ID>
  onToggle: (id: ID, opts?: { range?: boolean }) => void
  /** Selection mode: checkboxes stay visible. */
  selecting: boolean
}

const kref = (id: ID): EntityRef => ({ kind: 'knowledge', id })

export function Results({ entries, view, selected, onToggle, selecting }: ResultsProps) {
  const navigate = useNavigate()
  const inspect = useInspectEntity()
  const listRef = useRef<HTMLDivElement>(null)
  const [current, setCurrent] = useState<ID | null>(null)
  const currentId = current && entries.some((e) => e.item.id === current) ? current : (entries[0]?.item.id ?? null)

  // The library has no selection once it is gone.
  useEffect(() => () => setSelection(null), [])

  const links = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-row-link]') ?? [])
  const focusAt = (i: number) => {
    const all = links()
    const el = all[Math.max(0, Math.min(all.length - 1, i))]
    if (!el) return
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }

  const columns = () => {
    if (view === 'list') return 1
    const all = links()
    if (all.length < 2) return 1
    const top = all[0].closest('[role="listitem"]')?.getBoundingClientRect().top ?? 0
    let n = 0
    for (const el of all) {
      if ((el.closest('[role="listitem"]')?.getBoundingClientRect().top ?? 0) !== top) break
      n++
    }
    return Math.max(1, n)
  }

  const onFocusRow = useCallback((id: ID) => {
    setCurrent(id)
    setSelection(kref(id))
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const link = target.closest<HTMLElement>('[data-row-link]')
    if (!link || e.metaKey || e.ctrlKey || e.altKey) return
    const all = links()
    const i = all.indexOf(link)
    const id = link.dataset.id as ID
    const cols = columns()
    const key = e.key
    const handled = () => {
      e.preventDefault()
      e.stopPropagation()
    }
    if (key === 'ArrowDown' || key === 'j') {
      handled()
      focusAt(i + cols)
    } else if (key === 'ArrowUp' || key === 'k') {
      handled()
      focusAt(i - cols)
    } else if (view === 'grid' && key === 'ArrowRight') {
      handled()
      focusAt(i + 1)
    } else if (view === 'grid' && key === 'ArrowLeft') {
      handled()
      focusAt(i - 1)
    } else if (key === 'Home') {
      handled()
      focusAt(0)
    } else if (key === 'End') {
      handled()
      focusAt(all.length - 1)
    } else if (key === ' ') {
      handled()
      inspect(kref(id))
    } else if (key === 'x' || key === 'X') {
      handled()
      onToggle(id, { range: e.shiftKey })
    } else if (key === 'h') {
      handled()
      toggleHold(kref(id))
    } else if (key === 't') {
      handled()
      openStartSheet('task', { source: kref(id) })
    } else if (key === 'e') {
      handled()
      navigate(`/knowledge/${encodeURIComponent(id)}?edit=1`)
    }
  }

  return (
    <div
      ref={listRef}
      role="list"
      aria-label="Knowledge items"
      onKeyDown={onKeyDown}
      className={cn(
        view === 'list'
          ? 'flex flex-col gap-px @container'
          : 'grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] pr-px pb-px',
      )}
    >
      {entries.map((entry) =>
        view === 'list' ? (
          <ResultRow
            key={entry.item.id}
            entry={entry}
            isCurrent={entry.item.id === currentId}
            checked={selected.has(entry.item.id)}
            selecting={selecting}
            onToggle={onToggle}
            onFocusRow={onFocusRow}
          />
        ) : (
          <ResultCard
            key={entry.item.id}
            entry={entry}
            isCurrent={entry.item.id === currentId}
            checked={selected.has(entry.item.id)}
            selecting={selecting}
            onToggle={onToggle}
            onFocusRow={onFocusRow}
          />
        ),
      )}
    </div>
  )
}

interface ItemProps {
  entry: LibraryEntry
  isCurrent: boolean
  checked: boolean
  selecting: boolean
  onToggle: (id: ID, opts?: { range?: boolean }) => void
  onFocusRow: (id: ID) => void
}

function useRowMenu(item: KnowledgeItem, onToggle: ItemProps['onToggle'], checked: boolean): MenuItem[] {
  const navigate = useNavigate()
  const ref = kref(item.id)
  return [
    { id: 'open', label: 'Open', icon: ArrowUpRight, shortcut: 'enter', onSelect: () => navigate(`/knowledge/${encodeURIComponent(item.id)}`) },
    { id: 'edit', label: 'Edit', icon: PenLine, shortcut: 'e', onSelect: () => navigate(`/knowledge/${encodeURIComponent(item.id)}?edit=1`) },
    { id: 'ask', label: 'Ask about this', icon: MessageSquare, onSelect: () => askAbout(ref, navigate) },
    { id: 'turn', label: 'Turn into…', icon: Shuffle, shortcut: 't', onSelect: () => openStartSheet('task', { source: ref }) },
    { id: 'select', label: checked ? 'Deselect' : 'Select', icon: SquareCheck, shortcut: 'x', onSelect: () => onToggle(item.id) },
    { type: 'separator' },
    { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void deleteWithConfirm([item.id]) },
  ]
}

/** Hold + ⋯, revealed on hover and focus (always visible on touch), on a solid wash so the meta under it stays hidden. */
function RowActions({ item, isCurrent, menu, wash, className }: { item: KnowledgeItem; isCurrent: boolean; menu: MenuItem[]; wash?: string; className?: string }) {
  const held = useIsPinned(kref(item.id))
  const never = item.aiAvailability === 'never'
  return (
    <span
      className={cn(
        'relative z-10 flex items-center gap-0.5 rounded-sm',
        'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100',
        wash,
        className,
      )}
    >
      <IconButton
        icon={Layers}
        size="xs"
        label={never && !held ? 'Set to Never — it can’t ride along in AI actions' : held ? `Release “${item.title}”` : `Hold “${item.title}” — it rides along in new AI actions`}
        active={held}
        disabled={never && !held}
        shortcut="h"
        tabIndex={isCurrent ? 0 : -1}
        onClick={() => toggleHold(kref(item.id))}
      />
      <Menu
        items={menu}
        aria-label={`Actions for “${item.title}”`}
        placement="bottom-end"
        trigger={<IconButton icon={Ellipsis} size="xs" label="More actions" tabIndex={isCurrent ? 0 : -1} />}
      />
    </span>
  )
}

/** "Held" at rest (the actions show the toggle on hover). */
function HeldMark({ id }: { id: ID }) {
  const held = useIsPinned(kref(id))
  if (!held) return null
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink-2">
      <Layers aria-hidden className="size-3" strokeWidth={1.75} />
      Held
    </span>
  )
}

function SelectBox({ item, checked, visible, onToggle }: { item: KnowledgeItem; checked: boolean; visible: boolean; onToggle: ItemProps['onToggle'] }) {
  return (
    <Checkbox
      size="md"
      checked={checked}
      tabIndex={-1}
      aria-label={`Select “${item.title}”`}
      onClick={(e: MouseEvent<HTMLInputElement>) => {
        e.stopPropagation()
        onToggle(item.id, { range: e.shiftKey })
      }}
      onChange={() => {}}
      className={cn(
        'absolute inset-0 z-10 grid place-items-center',
        visible || checked ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100',
      )}
    />
  )
}

const ResultRow = memo(function ResultRow({ entry, isCurrent, checked, selecting, onToggle, onFocusRow }: ItemProps) {
  const { item, snippet, titleRanges } = entry
  const menu = useRowMenu(item, onToggle, checked)
  const usage = useKnowledgeUsage(item.id)
  const showBox = selecting || checked
  const excerpt = snippet ? snippet.text : excerptOf(item)
  return (
    <div
      role="listitem"
      className={cn(
        'group/row relative flex min-h-(--row-h-2) items-center gap-3 rounded-sm px-3 py-2 transition-colors duration-(--dur-1)',
        checked ? 'bg-accent-tint' : 'hover:bg-hover focus-within:bg-hover',
      )}
    >
      <span className="relative grid size-5 shrink-0 place-items-center self-start mt-0.5">
        <KnowledgeTile item={item} size={20} className={cn(showBox ? 'opacity-0' : 'group-hover/row:opacity-0 group-focus-within/row:opacity-0')} />
        <SelectBox item={item} checked={checked} visible={showBox} onToggle={onToggle} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/knowledge/${encodeURIComponent(item.id)}`}
            data-row-link=""
            data-id={item.id}
            data-inspect={`knowledge:${item.id}`}
            tabIndex={isCurrent ? 0 : -1}
            onFocus={() => onFocusRow(item.id)}
            aria-keyshortcuts="Space x h t e"
            className={cn(
              'type-body-sm min-w-0 truncate font-semibold text-ink outline-none',
              'after:absolute after:inset-0 after:rounded-sm after:content-[""] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--focus-ring)',
            )}
          >
            <Highlight text={item.title} ranges={titleRanges} />
          </Link>
          {item.simulated && <SimBadge className="relative z-10 shrink-0" />}
          <AvailabilityTag value={item.aiAvailability} className="relative z-10 hidden @min-[520px]:inline-flex" />
          {!isIndexed(item) && <NotIndexedTag className="relative z-10 hidden @min-[520px]:inline-flex" />}
          <span className="flex-1" />
          <span className="type-meta relative flex shrink-0 items-center gap-2 text-ink-3">
            <HeldMark id={item.id} />
            <OriginLabel item={item} className="hidden max-w-[260px] @min-[860px]:inline-flex" />
            {usage.count > 0 && (
              <span className="hidden whitespace-nowrap tabular @min-[640px]:inline">
                used by {usage.count} run{usage.count === 1 ? '' : 's'}
              </span>
            )}
            <time dateTime={new Date(item.updatedAt).toISOString()} className="whitespace-nowrap tabular" title={`Updated ${new Date(item.updatedAt).toLocaleString()}`}>
              {timeAgo(item.updatedAt)}
            </time>
            <RowActions
              item={item}
              isCurrent={isCurrent}
              menu={menu}
              wash={checked ? 'bg-accent-tint' : 'bg-hover'}
              className="absolute top-1/2 right-0 min-w-[88px] -translate-y-1/2 justify-end pl-2"
            />
          </span>
        </div>
        <p className="type-caption truncate text-ink-3">
          {snippet ? <Highlight text={excerpt} ranges={snippet.highlights} /> : excerpt || <span className="text-ink-4">Empty</span>}
        </p>
      </div>
    </div>
  )
})

const ResultCard = memo(function ResultCard({ entry, isCurrent, checked, selecting, onToggle, onFocusRow }: ItemProps) {
  const { item, snippet, titleRanges } = entry
  const menu = useRowMenu(item, onToggle, checked)
  const usage = useKnowledgeUsage(item.id)
  const showBox = selecting || checked
  const kind = (KNOWLEDGE_KIND_META[item.kind] ?? KNOWLEDGE_KIND_META.note).label
  const preview = item.file?.previewUrl && isImage(item) ? item.file.previewUrl : null
  return (
    <div
      role="listitem"
      className={cn(
        'group/row relative -mr-px -mb-px flex min-h-[176px] flex-col gap-2 border border-line p-3.5 transition-colors duration-(--dur-1)',
        checked ? 'bg-accent-tint' : 'bg-canvas hover:bg-hover focus-within:bg-hover',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="relative grid size-5 shrink-0 place-items-center">
          <KnowledgeTile item={item} size={20} className={cn(showBox ? 'opacity-0' : 'group-hover/row:opacity-0 group-focus-within/row:opacity-0')} />
          <SelectBox item={item} checked={checked} visible={showBox} onToggle={onToggle} />
        </span>
        <span className="type-label truncate text-ink-3">{isImage(item) ? 'Image' : kind}</span>
        <span className="flex-1" />
        {item.simulated && <SimBadge className="relative z-10" />}
        <RowActions item={item} isCurrent={isCurrent} menu={menu} />
      </div>
      <Link
        to={`/knowledge/${encodeURIComponent(item.id)}`}
        data-row-link=""
        data-id={item.id}
        data-inspect={`knowledge:${item.id}`}
        tabIndex={isCurrent ? 0 : -1}
        onFocus={() => onFocusRow(item.id)}
        aria-keyshortcuts="Space x h t e"
        className={cn(
          'type-body-sm line-clamp-2 font-semibold text-pretty text-ink outline-none',
          'after:absolute after:inset-0 after:content-[""] focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--focus-ring)',
        )}
      >
        <Highlight text={item.title} ranges={titleRanges} />
      </Link>
      {preview ? (
        <span className="block h-24 overflow-hidden rounded-xs border border-line bg-sunken">
          <img src={preview} alt="" className="size-full object-cover" draggable={false} />
        </span>
      ) : (
        <p className="type-caption line-clamp-3 text-pretty text-ink-3">
          {snippet ? <Highlight text={snippet.text} ranges={snippet.highlights} /> : excerptOf(item, 260)}
        </p>
      )}
      <span className="flex-1" />
      <div className="type-meta flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
        <HeldMark id={item.id} />
        <time dateTime={new Date(item.updatedAt).toISOString()} className="tabular">
          {timeAgo(item.updatedAt)}
        </time>
        {usage.count > 0 && (
          <span className="tabular">
            · used by {usage.count} run{usage.count === 1 ? '' : 's'}
          </span>
        )}
        <AvailabilityTag value={item.aiAvailability} className="relative z-10" />
        {!isIndexed(item) && <NotIndexedTag className="relative z-10" />}
      </div>
    </div>
  )
})
