import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownUp,
  Check,
  FolderInput,
  FolderPlus,
  Hash,
  LayoutGrid,
  Link2,
  List,
  ListFilter,
  NotebookPen,
  Pencil,
  Plus,
  ScanSearch,
  SquareCheck,
  Tag as TagIcon,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ScopeFilterRow, StageHeader, useShellLayout, useWorkspaceScreen } from '@/app/templates'
import { useRegisterCommands } from '@/app/commands/registry'
import { useContextStore } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { addKnowledgeToProject, deleteCollection, KNOWLEDGE_KIND_META, moveKnowledge, removeTag, tagKnowledge, updateCollection, useTags } from '@/core/services'
import type { Collection, ID } from '@/core/types'
import {
  Button,
  Checkbox,
  EmptyState,
  FileIcon,
  HUE_FILL,
  IconButton,
  Input,
  Menu,
  MonogramMark,
  Popover,
  ProgressBar,
  SearchField,
  SegmentedControl,
  Skeleton,
  Tag,
  confirm,
  toast,
  useHotkey,
  type MenuItem,
} from '@/ui'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { deleteWithConfirm } from './actions'
import { AskCollection } from './askCollection'
import { AddLinkDialog, CollectionDialog, RenameTagDialog } from './dialogs'
import { useKnowledgePrefs, useLibraryQuery, useLibraryResults, useListScope } from './hooks'
import {
  activeFacetCount,
  effectiveSort,
  KIND_ORDER,
  parseTagInput,
  SMART_FILTER_META,
  SORT_LABEL,
  SOURCE_LABEL,
  SOURCE_ORDER,
  type LibraryQuery,
  type Section,
  type SortKey,
} from './model'
import { FILTER_ICON } from './parts'
import { Results } from './results'
import { rememberLibrary } from './nav'
import { BrowseButton, KnowledgeScreen, useNewNote, usePhone } from './screen'
import { dismissUpload, retryUpload, uploadFiles, useUploads } from './uploads'

/**
 * Knowledge › Library (§6.7): search (`/`, real local full-text with highlighted matches), list | grid,
 * sort, Upload, Add link, New note (N); rows with kind tile, excerpt, origin, usage and honesty tags;
 * bulk selection (X) → move · tag · add to project · delete; drop files anywhere.
 */
export function LibraryView() {
  const [query, setQuery] = useLibraryQuery()
  const { scope, projectScope, showingAll } = useListScope()
  const setShowAllFor = useKnowledgePrefs((s) => s.setShowAllFor)
  const view = useKnowledgePrefs((s) => s.view)
  const setView = useKnowledgePrefs((s) => s.setView)
  const results = useLibraryResults(query, scope)
  const phone = usePhone()
  const searchRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const location = useLocation()
  const [rawParams, setRawParams] = useSearchParams()
  const navigate = useNavigate()

  // Back from an item returns here.
  useEffect(() => rememberLibrary(`${location.pathname}${location.search}`), [location.pathname, location.search])

  // ⌘K entry points: `?add=link` opens Add a link, `?new=collection` opens New collection (then the parameter goes).
  useEffect(() => {
    const add = rawParams.get('add')
    const create = rawParams.get('new')
    if (!add && !create) return
    if (add === 'link') setLinkOpen(true)
    if (create === 'collection') setCollectionOpen(true)
    setRawParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('add')
        next.delete('new')
        return next
      },
      { replace: true },
    )
  }, [rawParams, setRawParams])

  // ---- search field: local state, mirrored to ?q= (history is replaced while typing)
  const [draft, setDraft] = useState(query.q)
  useEffect(() => setDraft(query.q), [query.q])
  const onSearch = (value: string) => {
    setDraft(value)
    setQuery({ q: value, sort: query.sort === 'relevance' && !value.trim() ? null : query.sort }, { replace: true })
  }

  // `/` focuses the search field here (the Ask composer would otherwise take it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ---- bulk selection (X), cleared when the section changes
  const [selected, setSelected] = useState<ReadonlySet<ID>>(() => new Set())
  const lastToggled = useRef<ID | null>(null)
  const sectionKey = JSON.stringify(query.section)
  useEffect(() => {
    setSelected(new Set())
    lastToggled.current = null
  }, [sectionKey, scope])
  const entryIds = useMemo(() => results.entries.map((e) => e.item.id), [results.entries])
  // Items that left the view (deleted, filtered out) leave the selection too.
  useEffect(() => {
    setSelected((cur) => {
      if (!cur.size) return cur
      const visible = new Set(entryIds)
      const next = new Set([...cur].filter((id) => visible.has(id)))
      return next.size === cur.size ? cur : next
    })
  }, [entryIds])
  const toggle = (id: ID, opts: { range?: boolean } = {}) => {
    setSelected((cur) => {
      const next = new Set(cur)
      const anchor = lastToggled.current
      if (opts.range && anchor && anchor !== id) {
        const a = entryIds.indexOf(anchor)
        const b = entryIds.indexOf(id)
        if (a >= 0 && b >= 0) {
          const on = !cur.has(id)
          for (const x of entryIds.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (on) next.add(x)
            else next.delete(x)
          }
          lastToggled.current = id
          return next
        }
      }
      if (next.has(id)) next.delete(id)
      else next.add(id)
      lastToggled.current = id
      return next
    })
  }
  const clearSelection = () => setSelected(new Set())
  const selectAll = () => setSelected(new Set(entryIds))
  useHotkey('escape', clearSelection, { enabled: selected.size > 0, preventDefault: false })

  // ---- uploads: into the collection in view, filed in the scoped project
  const collectionId = query.section.type === 'collection' ? query.section.id : null
  const upload = (files: File[]) => void uploadFiles(files, { collectionId, projectId: projectScope })
  const openPicker = () => fileRef.current?.click()

  const newNote = useNewNote()
  useRegisterCommands('knowledge.library', [
    { id: 'knowledge.library.select-all', title: 'Select every item in view', icon: SquareCheck, group: 'Knowledge', keywords: ['bulk', 'select'], run: (ctx) => { ctx.close(); selectAll() } },
    { id: 'knowledge.library.search', title: 'Search Knowledge', icon: ScanSearch, group: 'Knowledge', shortcut: '/', keywords: ['find', 'filter'], run: (ctx) => { ctx.close(); setTimeout(() => searchRef.current?.focus(), 30) } },
  ])

  const sort = effectiveSort(query)
  const facets = activeFacetCount(query)
  const collection = useDB((s: Tables) => (collectionId ? s.collections[collectionId] : undefined))

  const toolbar =
    selected.size > 0 ? (
      <BulkBar selected={selected} total={entryIds.length} onSelectAll={selectAll} onClear={clearSelection} />
    ) : (
      <>
        <SearchField
          ref={searchRef}
          size="sm"
          value={draft}
          onValueChange={onSearch}
          placeholder={searchPlaceholder(query.section, collection)}
          aria-label="Search Knowledge"
          kbd={phone ? undefined : '/'}
          data-search-input
          wrapperClassName="min-w-0 flex-1 md:max-w-md"
          onEscape={() => searchRef.current?.blur()}
        />
        <span className="flex-1 max-md:hidden" />
        <FilterMenu query={query} setQuery={setQuery} iconOnly={phone} />
        <SortMenu sort={sort} searching={!!query.q.trim()} onChange={(s) => setQuery({ sort: s })} iconOnly={phone} />
        <SegmentedControl
          size="sm"
          aria-label="View"
          value={view}
          onValueChange={setView}
          options={[
            { value: 'list', label: 'List', icon: List, iconOnly: true },
            { value: 'grid', label: 'Grid', icon: LayoutGrid, iconOnly: true },
          ]}
        />
      </>
    )

  const ask = collection && (results.sectionCount > 0 || entryIds.length > 0) ? <AskCollection collection={collection} /> : undefined

  return (
    <KnowledgeScreen header={<LibraryHeader query={query} count={results.sectionCount} onUpload={openPicker} onAddLink={() => setLinkOpen(true)} onNewNote={newNote} onSelectAll={selectAll} />} toolbar={toolbar} composer={ask}>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        data-knowledge-upload=""
        aria-label="Upload files to Knowledge"
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? [])
          e.currentTarget.value = ''
          if (files.length) upload(files)
        }}
      />
      <div className="flex flex-col gap-3">
        {(projectScope || facets > 0 || sectionIntro(query.section, collection)) && (
          <div className="-mt-1 flex min-w-0 flex-col gap-2">
            {sectionIntro(query.section, collection) && <p className="type-body-sm max-w-[72ch] text-pretty text-ink-2">{sectionIntro(query.section, collection)}</p>}
            {projectScope && !showingAll && <ScopeFilterRow onShowAll={() => setShowAllFor(projectScope)} className="-ml-4 h-6" />}
            {projectScope && showingAll && <ShowingAllRow onFilter={() => setShowAllFor(null)} />}
            {facets > 0 && <FacetChips query={query} setQuery={setQuery} />}
          </div>
        )}
        <UploadRows />
        <LibraryBody
          query={query}
          results={results}
          view={view}
          selected={selected}
          onToggle={toggle}
          onUpload={openPicker}
          onNewNote={newNote}
          onClearSearch={() => onSearch('')}
          onClearFacets={() => setQuery({ kinds: [], sources: [], project: null })}
          onSearchAll={() => setQuery({ section: { type: 'all' }, kinds: [], sources: [], project: null })}
          collection={collection}
        />
      </div>
      <AddLinkDialog open={linkOpen} onOpenChange={setLinkOpen} collectionId={collectionId} />
      <CollectionDialog open={collectionOpen} onOpenChange={setCollectionOpen} onSaved={(id) => navigate(`/knowledge?collection=${encodeURIComponent(id)}`)} />
    </KnowledgeScreen>
  )
}

function searchPlaceholder(section: Section, collection?: Collection): string {
  if (section.type === 'collection') return collection ? `Search ${collection.name}` : 'Search items without a collection'
  if (section.type === 'filter') return `Search ${SMART_FILTER_META[section.id].label.toLowerCase()}`
  if (section.type === 'tag') return `Search #${section.tag}`
  return 'Search all knowledge'
}

function sectionIntro(section: Section, collection?: Collection): string | undefined {
  if (section.type === 'collection') return collection?.description ?? (section.id === null ? 'Items that are not in any collection.' : undefined)
  if (section.type === 'filter') return SMART_FILTER_META[section.id].description
  return undefined
}

function ShowingAllRow({ onFilter }: { onFilter: () => void }) {
  const scope = useContextStore((s) => s.scopeProjectId)
  const project = useDB((s: Tables) => (scope ? s.projects[scope] : undefined))
  if (!project) return null
  return (
    <div className="type-caption flex h-6 items-center gap-1.5 text-ink-3">
      <span>Showing all work</span>
      <span aria-hidden>·</span>
      <button type="button" onClick={onFilter} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
        Filter to {project.name}
      </button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ header

function LibraryHeader({
  query,
  count,
  onUpload,
  onAddLink,
  onNewNote,
  onSelectAll,
}: {
  query: LibraryQuery
  count: number
  onUpload: () => void
  onAddLink: () => void
  onNewNote: () => void
  onSelectAll: () => void
}) {
  const navigate = useNavigate()
  const layout = useShellLayout()
  const phone = layout.formFactor === 'phone'
  const compact = phone || layout.docking.stageWidth < 760
  const paneVisible = useWorkspaceScreen().listVisible
  const section = query.section
  const collection = useDB((s: Tables) => (section.type === 'collection' && section.id ? s.collections[section.id] : undefined))
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const [renamingTag, setRenamingTag] = useState(false)

  const title =
    section.type === 'all'
      ? 'All knowledge'
      : section.type === 'collection'
        ? (collection?.name ?? (section.id === null ? 'No collection' : 'Collection not found'))
        : section.type === 'filter'
          ? SMART_FILTER_META[section.id].label
          : `#${section.tag}`

  const leading: ReactNode =
    section.type === 'collection' && collection ? (
      <MonogramMark text={collection.name} hue={collection.hue} size={20} />
    ) : section.type === 'tag' ? (
      <Hash aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
    ) : section.type === 'filter' ? (
      (() => {
        const Icon = FILTER_ICON[section.id]
        return <Icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />
      })()
    ) : undefined

  const menu: MenuItem[] = []
  if (collection) {
    menu.push(
      { id: 'edit', label: 'Edit collection…', icon: Pencil, onSelect: () => setEditing(true) },
      {
        id: 'delete',
        label: 'Delete collection…',
        icon: Trash2,
        danger: true,
        onSelect: async () => {
          const n = Object.values(useDB.getState().knowledge).filter((k) => k.collectionId === collection.id).length
          const ok = await confirm({
            title: `Delete “${collection.name}”?`,
            description: n ? `Its ${n} item${n === 1 ? '' : 's'} stay in Knowledge without a collection. Agents scoped to it lose that scope.` : 'The collection is empty. Agents scoped to it lose that scope.',
            confirmLabel: 'Delete collection',
            tone: 'danger',
          })
          if (!ok) return
          deleteCollection(collection.id)
          navigate('/knowledge', { replace: true })
          toast({ title: `Deleted “${collection.name}”`, description: n ? `${n} item${n === 1 ? '' : 's'} kept without a collection.` : undefined })
        },
      },
      { type: 'separator' },
    )
  }
  if (section.type === 'tag') {
    menu.push(
      { id: 'rename-tag', label: 'Rename tag…', icon: Pencil, onSelect: () => setRenamingTag(true) },
      {
        id: 'remove-tag',
        label: `Remove #${section.tag} from every item…`,
        icon: Trash2,
        danger: true,
        onSelect: async () => {
          const ok = await confirm({
            title: `Remove #${section.tag}?`,
            description: 'The tag is removed from every item. The items themselves stay.',
            confirmLabel: 'Remove tag',
            tone: 'danger',
          })
          if (!ok) return
          const n = removeTag(section.tag)
          navigate('/knowledge', { replace: true })
          toast({ title: `Removed #${section.tag}`, description: `${n} item${n === 1 ? '' : 's'} updated.` })
        },
      },
      { type: 'separator' },
    )
  }
  menu.push(
    { id: 'select', label: 'Select all in view', icon: SquareCheck, shortcut: 'x', onSelect: onSelectAll },
    { id: 'new-collection', label: 'New collection…', icon: FolderPlus, onSelect: () => setCreating(true) },
    { id: 'lab', label: 'Open the retrieval lab', icon: ScanSearch, onSelect: () => navigate('/knowledge/retrieval') },
  )
  if (compact) {
    menu.unshift({ id: 'link', label: 'Add a link…', icon: Link2, onSelect: onAddLink }, { type: 'separator' })
  }

  return (
    <>
      <StageHeader
        title={collection ? collection.name : title}
        onRename={collection ? (name) => updateCollection(collection.id, { name }) : undefined}
        leading={
          phone ? (
            <span className="flex items-center gap-1.5">
              <BrowseButton />
              {leading}
            </span>
          ) : (
            leading
          )
        }
        status={<span className="type-meta text-ink-3 tabular" aria-label={`${count} items`}>{count}</span>}
        actions={
          compact ? (
            <>
              <IconButton icon={Upload} label="Upload files" size="sm" onClick={onUpload} />
              <IconButton icon={NotebookPen} label="New note" shortcut="n" size="sm" variant="secondary" onClick={onNewNote} />
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" leadingIcon={Link2} onClick={onAddLink}>
                Add link
              </Button>
              <Button size="sm" variant="secondary" leadingIcon={Upload} onClick={onUpload}>
                Upload
              </Button>
              {/* The list pane carries "+ New note"; the header repeats it only while the pane is hidden. */}
              {!paneVisible && (
                <Button size="sm" variant="secondary" leadingIcon={Plus} kbd="n" onClick={onNewNote}>
                  New note
                </Button>
              )}
            </>
          )
        }
        menu={menu}
      />
      {collection && <CollectionDialog open={editing} onOpenChange={setEditing} collection={collection} />}
      <CollectionDialog open={creating} onOpenChange={setCreating} onSaved={(id) => navigate(`/knowledge?collection=${encodeURIComponent(id)}`)} />
      {section.type === 'tag' && <RenameTagDialog open={renamingTag} onOpenChange={setRenamingTag} tag={section.tag} />}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ toolbar menus

function FilterMenu({ query, setQuery, iconOnly }: { query: LibraryQuery; setQuery: (p: Partial<LibraryQuery>) => void; iconOnly?: boolean }) {
  const projects = useDB(useShallow((s: Tables) => Object.values(s.projects).filter((p) => p.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))))
  const n = activeFacetCount(query)
  const toggleIn = <T extends string>(list: readonly T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const items: MenuItem[] = [
    { type: 'label', label: 'Kind' },
    ...KIND_ORDER.map(
      (k): MenuItem => ({
        type: 'checkbox',
        id: `kind-${k}`,
        label: KNOWLEDGE_KIND_META[k].label,
        checked: query.kinds.includes(k),
        keepOpen: true,
        onCheckedChange: () => setQuery({ kinds: toggleIn(query.kinds, k) }),
      }),
    ),
    { type: 'separator' },
    { type: 'label', label: 'Source' },
    ...SOURCE_ORDER.map(
      (src): MenuItem => ({
        type: 'checkbox',
        id: `source-${src}`,
        label: SOURCE_LABEL[src],
        checked: query.sources.includes(src),
        keepOpen: true,
        onCheckedChange: () => setQuery({ sources: toggleIn(query.sources, src) }),
      }),
    ),
    { type: 'separator' },
    { type: 'label', label: 'Project' },
    { type: 'radio', id: 'project-any', label: 'Any project', checked: !query.project, keepOpen: true, onSelect: () => setQuery({ project: null }) },
    ...projects.map(
      (p): MenuItem => ({ type: 'radio', id: `project-${p.id}`, label: p.name, checked: query.project === p.id, keepOpen: true, onSelect: () => setQuery({ project: p.id }) }),
    ),
    { type: 'radio', id: 'project-none', label: 'No project', checked: query.project === 'none', keepOpen: true, onSelect: () => setQuery({ project: 'none' }) },
  ]
  if (n > 0) items.push({ type: 'separator' }, { id: 'clear', label: 'Clear filters', icon: X, onSelect: () => setQuery({ kinds: [], sources: [], project: null }) })
  const label = n ? `Filter (${n} active)` : 'Filter'
  return (
    <Menu
      items={items}
      aria-label="Filter by kind, source and project"
      placement="bottom-end"
      trigger={
        iconOnly ? (
          <IconButton icon={ListFilter} label={label} size="sm" active={n > 0} />
        ) : (
          <Button size="sm" variant="ghost" leadingIcon={ListFilter} aria-label={label} className={cn(n > 0 && 'text-ink')}>
            Filter
            {n > 0 && <span className="type-meta grid h-4 min-w-4 place-items-center rounded-xs bg-press px-1 text-ink tabular">{n}</span>}
          </Button>
        )
      }
    />
  )
}

function SortMenu({ sort, searching, onChange, iconOnly }: { sort: SortKey; searching: boolean; onChange: (s: SortKey) => void; iconOnly?: boolean }) {
  const keys: SortKey[] = searching ? ['relevance', 'updated', 'title', 'used'] : ['updated', 'title', 'used']
  const items: MenuItem[] = [
    { type: 'label', label: 'Sort by' },
    ...keys.map((k): MenuItem => ({ type: 'radio', id: `sort-${k}`, label: SORT_LABEL[k], checked: sort === k, onSelect: () => onChange(k) })),
  ]
  return (
    <Menu
      items={items}
      aria-label="Sort"
      placement="bottom-end"
      trigger={
        iconOnly ? (
          <IconButton icon={ArrowDownUp} label={`Sort: ${SORT_LABEL[sort]}`} size="sm" />
        ) : (
          <Button size="sm" variant="ghost" leadingIcon={ArrowDownUp} aria-label={`Sort: ${SORT_LABEL[sort]}`}>
            {SORT_LABEL[sort]}
          </Button>
        )
      }
    />
  )
}

function FacetChips({ query, setQuery }: { query: LibraryQuery; setQuery: (p: Partial<LibraryQuery>) => void }) {
  const project = useDB((s: Tables) => (query.project && query.project !== 'none' ? s.projects[query.project] : undefined))
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      {query.kinds.map((k) => (
        <Tag key={k} onRemove={() => setQuery({ kinds: query.kinds.filter((x) => x !== k) })} removeLabel={`Remove the ${KNOWLEDGE_KIND_META[k].label} filter`}>
          {KNOWLEDGE_KIND_META[k].label}
        </Tag>
      ))}
      {query.sources.map((src) => (
        <Tag key={src} onRemove={() => setQuery({ sources: query.sources.filter((x) => x !== src) })} removeLabel={`Remove the ${SOURCE_LABEL[src]} filter`}>
          {SOURCE_LABEL[src]}
        </Tag>
      ))}
      {query.project && (
        <Tag hue={project?.hue} onRemove={() => setQuery({ project: null })} removeLabel="Remove the project filter">
          {query.project === 'none' ? 'No project' : (project?.name ?? 'Project')}
        </Tag>
      )}
      <button
        type="button"
        onClick={() => setQuery({ kinds: [], sources: [], project: null })}
        className="type-caption rounded-xs px-1 text-ink-3 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
      >
        Clear filters
      </button>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ bulk

function BulkBar({ selected, total, onSelectAll, onClear }: { selected: ReadonlySet<ID>; total: number; onSelectAll: () => void; onClear: () => void }) {
  const ids = [...selected]
  const n = ids.length
  const collections = useDB(useShallow((s: Tables) => Object.values(s.collections).sort((a, b) => a.name.localeCompare(b.name))))
  const projects = useDB(useShallow((s: Tables) => Object.values(s.projects).filter((p) => p.status === 'active' || p.status === 'paused').sort((a, b) => a.name.localeCompare(b.name))))
  const all = n === total
  const plural = (k: number) => `${k} item${k === 1 ? '' : 's'}`

  const moveItems: MenuItem[] = [
    { type: 'label', label: `Move ${plural(n)} to` },
    ...collections.map(
      (c): MenuItem => ({
        id: c.id,
        label: c.name,
        onSelect: () => {
          const moved = moveKnowledge(ids, c.id)
          toast({ tone: 'success', title: `Moved ${plural(moved)} to ${c.name}` })
        },
      }),
    ),
    { type: 'separator' },
    {
      id: 'none',
      label: 'No collection',
      onSelect: () => {
        const moved = moveKnowledge(ids, null)
        toast({ title: `Removed ${plural(moved)} from their collection` })
      },
    },
  ]
  const projectItems: MenuItem[] = [
    { type: 'label', label: `Add ${plural(n)} to` },
    ...projects.map(
      (p): MenuItem => ({
        id: p.id,
        label: p.name,
        onSelect: () => {
          const added = addKnowledgeToProject(ids, p.id)
          toast({ tone: 'success', title: added ? `Added ${plural(added)} to ${p.name}` : `Already in ${p.name}` })
        },
      }),
    ),
  ]
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5" role="toolbar" aria-label="Selected items">
      <Checkbox
        checked={all ? true : 'indeterminate'}
        onCheckedChange={() => (all ? onClear() : onSelectAll())}
        aria-label={all ? 'Deselect all' : 'Select all'}
        className="mr-1"
      />
      <span className="type-body-sm mr-2 shrink-0 font-medium text-ink tabular" aria-live="polite">
        {n} selected
      </span>
      <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <Menu items={moveItems} aria-label="Move to collection" trigger={<Button size="sm" variant="ghost" leadingIcon={FolderInput}>Move</Button>} />
        <TagPopover ids={ids} />
        <Menu items={projectItems} aria-label="Add to project" trigger={<Button size="sm" variant="ghost" leadingIcon={FolderPlus}>Add to project</Button>} />
        <Button size="sm" variant="danger" leadingIcon={Trash2} onClick={() => void deleteWithConfirm(ids).then((ok) => ok && onClear())}>
          Delete
        </Button>
      </div>
      <Button size="sm" variant="ghost" onClick={onClear} kbd="escape" className="shrink-0">
        Clear
      </Button>
    </div>
  )
}

function TagPopover({ ids }: { ids: ID[] }) {
  const tags = useTags()
  const [value, setValue] = useState('')
  const apply = (raw: string, close: () => void) => {
    const list = parseTagInput(raw)
    if (!list.length) return
    let changed = 0
    for (const t of list) changed += tagKnowledge(ids, t)
    toast({ tone: 'success', title: `Tagged ${list.map((t) => `#${t}`).join(' ')}`, description: `${changed} change${changed === 1 ? '' : 's'} across ${ids.length} item${ids.length === 1 ? '' : 's'}.` })
    setValue('')
    close()
  }
  return (
    <Popover
      aria-label="Tag selected items"
      placement="bottom-start"
      trigger={<Button size="sm" variant="ghost" leadingIcon={TagIcon}>Tag</Button>}
      className="w-72"
    >
      {({ close }) => (
        <form
          className="flex flex-col gap-2.5 p-3"
          onSubmit={(e) => {
            e.preventDefault()
            apply(value, close)
          }}
        >
          <Input value={value} onValueChange={setValue} size="sm" placeholder="Add a tag — comma for several" prefix={<span className="text-ink-3">#</span>} data-autofocus aria-label="Tag" />
          {tags.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="type-label text-ink-3">Most used</span>
              <div className="flex flex-wrap gap-1">
                {tags.slice(0, 10).map((t) => (
                  <Tag key={t.tag} selectable selected={false} onSelectedChange={() => apply(t.tag, close)}>
                    #{t.tag}
                  </Tag>
                ))}
              </div>
            </div>
          )}
          <Button type="submit" size="sm" variant="primary" leadingIcon={Check} disabled={!parseTagInput(value).length}>
            Add to {ids.length} item{ids.length === 1 ? '' : 's'}
          </Button>
        </form>
      )}
    </Popover>
  )
}

// ------------------------------------------------------------------------------------------------ uploads

function UploadRows() {
  const navigate = useNavigate()
  const rows = useUploads((s) => s.rows)
  if (!rows.length) return null
  const reading = rows.filter((r) => r.status === 'queued' || r.status === 'reading').length
  return (
    <section aria-label="Adding to Knowledge" className="flex flex-col rounded-md border border-line">
      <h2 className="type-label flex h-8 items-center gap-2 border-b border-line px-3 text-ink-3">
        {reading ? `Reading ${reading} file${reading === 1 ? '' : 's'}` : 'Added'}
        <span className="type-meta font-normal tracking-normal normal-case">read locally, never uploaded</span>
      </h2>
      <ul className="flex flex-col divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="flex min-h-11 items-center gap-3 px-3 py-2" aria-live="polite">
            <FileIcon name={r.name} className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="type-body-sm flex min-w-0 items-center gap-2">
                <span className="truncate text-ink">{r.status === 'done' && r.title ? r.title : r.name}</span>
                <span className="type-meta shrink-0 text-ink-3 tabular">{formatBytes(r.size)}</span>
              </span>
              {(r.status === 'queued' || r.status === 'reading') && <ProgressBar size="sm" aria-label={`Reading ${r.name}`} className="max-w-64" />}
              {r.status === 'error' && <span className="type-caption text-fail-ink">Couldn’t read {r.name}: {r.error}</span>}
            </span>
            {r.status === 'done' && r.itemId && (
              <>
                <span className="type-caption flex items-center gap-1 text-ink-3">
                  <span aria-hidden className="text-done">✓</span> Added
                </span>
                <Button size="xs" variant="ghost" onClick={() => navigate(`/knowledge/${encodeURIComponent(r.itemId!)}`)}>
                  Open
                </Button>
              </>
            )}
            {r.status === 'error' && (
              <>
                <Button size="xs" variant="secondary" onClick={() => void retryUpload(r.id)}>
                  Retry
                </Button>
                <IconButton icon={X} size="xs" label={`Dismiss ${r.name}`} onClick={() => dismissUpload(r.id)} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ body & states

function LibraryBody({
  query,
  results,
  view,
  selected,
  onToggle,
  onUpload,
  onNewNote,
  onClearSearch,
  onClearFacets,
  onSearchAll,
  collection,
}: {
  query: LibraryQuery
  results: ReturnType<typeof useLibraryResults>
  view: 'list' | 'grid'
  selected: ReadonlySet<ID>
  onToggle: (id: ID, opts?: { range?: boolean }) => void
  onUpload: () => void
  onNewNote: () => void
  onClearSearch: () => void
  onClearFacets: () => void
  onSearchAll: () => void
  collection?: Collection
}) {
  const q = query.q.trim()
  const facets = activeFacetCount(query)

  if (results.indexing) {
    return (
      <div aria-busy="true" className="flex flex-col gap-1">
        <p className="type-caption text-ink-3" role="status">
          Indexing {results.scopedCount} item{results.scopedCount === 1 ? '' : 's'}…
        </p>
        <ResultSkeleton />
      </div>
    )
  }

  if (results.scopedCount === 0 && !q) {
    return (
      <EmptyState
        bordered
        icon={NotebookPen}
        title="Your library is empty"
        description="Knowledge fills itself as you save things from other workspaces. Or drop files anywhere here — they’re read locally, never uploaded."
        actions={
          <>
            <Button variant="primary" leadingIcon={Upload} onClick={onUpload}>
              Upload files
            </Button>
            <Button variant="ghost" leadingIcon={Plus} onClick={onNewNote}>
              New note
            </Button>
          </>
        }
        className="py-16"
      />
    )
  }

  if (results.entries.length === 0) {
    if (q) {
      const narrowed = query.section.type !== 'all' || facets > 0
      return (
        <EmptyState
          icon={ScanSearch}
          title={`No matches for “${q}”`}
          description={narrowed ? 'Search reads titles, tags and the full text of every item in this view. Try all of Knowledge.' : 'Search reads titles, tags and the full text of every item.'}
          actions={
            <>
              <Button variant="secondary" onClick={onClearSearch}>
                Clear search
              </Button>
              {narrowed && (
                <Button variant="ghost" onClick={onSearchAll}>
                  Search all knowledge
                </Button>
              )}
            </>
          }
        />
      )
    }
    if (facets > 0 && results.sectionCount > 0) {
      return (
        <EmptyState
          icon={ListFilter}
          title="No items match these filters"
          description="Remove a filter, or clear them all."
          actions={
            <Button variant="secondary" onClick={onClearFacets}>
              Clear filters
            </Button>
          }
        />
      )
    }
    return <SectionEmpty section={query.section} collection={collection} onUpload={onUpload} onNewNote={onNewNote} />
  }

  return (
    <div className={cn('flex flex-col', results.pending && 'opacity-80 transition-opacity duration-(--dur-1)')}>
      <p className="sr-only" role="status">
        {q ? `${results.entries.length} match${results.entries.length === 1 ? '' : 'es'} for ${q}` : `${results.entries.length} items`}
      </p>
      <Results entries={results.entries} view={view} selected={selected} onToggle={onToggle} selecting={selected.size > 0} />
    </div>
  )
}

const SECTION_ICON: Record<string, LucideIcon> = { collection: FolderInput, tag: Hash }

function SectionEmpty({ section, collection, onUpload, onNewNote }: { section: Section; collection?: Collection; onUpload: () => void; onNewNote: () => void }) {
  if (section.type === 'collection') {
    return (
      <EmptyState
        illustration={
          collection ? (
            <span aria-hidden className={cn('grid size-11 place-items-center rounded-md border border-line bg-raised')}>
              <span className={cn('size-4 rounded-[4px]', HUE_FILL[collection.hue])} />
            </span>
          ) : undefined
        }
        icon={SECTION_ICON.collection}
        title={collection ? `Nothing in ${collection.name} yet` : 'Every item is in a collection'}
        description={collection ? 'Select items in the library and Move them here, or upload straight into this collection.' : 'Items without a collection show up here.'}
        actions={
          collection ? (
            <>
              <Button variant="primary" leadingIcon={Upload} onClick={onUpload}>
                Upload into {collection.name}
              </Button>
              <Button variant="ghost" leadingIcon={Plus} onClick={onNewNote}>
                New note
              </Button>
            </>
          ) : undefined
        }
      />
    )
  }
  if (section.type === 'filter') {
    const meta = SMART_FILTER_META[section.id]
    return <EmptyState icon={FILTER_ICON[section.id]} title={`Nothing in ${meta.label}`} description={meta.empty} />
  }
  if (section.type === 'tag') {
    return <EmptyState icon={Hash} title={`No items are tagged #${section.tag}`} description="Tags come from the items themselves. Add tags on an item, or tag several at once with X." />
  }
  return null
}

function ResultSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-px">
      {[64, 48, 72, 56, 40].map((w, i) => (
        <div key={i} className="flex h-(--row-h-2) items-center gap-3 px-3">
          <Skeleton width={20} height={20} className="rounded-xs" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton height={10} width={`${w}%`} />
            <Skeleton height={8} width={`${w + 16}%`} />
          </div>
          <Skeleton height={8} width={48} />
        </div>
      ))}
    </div>
  )
}
