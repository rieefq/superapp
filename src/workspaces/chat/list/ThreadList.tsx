import { memo, useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { Archive, ArchiveRestore, ChevronLeft, Ellipsis, MessagesSquare, PencilLine, Pin, PinOff, SearchX, Trash2 } from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows, ScopeFilterRow } from '@/app/templates'
import { renameThread, setThreadProject } from '@/core/ai'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import { useSearch, type SearchResult } from '@/core/search'
import type { ID, Project, Thread } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, ContextMenu, EmptyState, HUE_FILL, IconButton, LiveIndicator, Menu, Skeleton, Tag, toast, useNow, type MenuItem } from '@/ui'
import { deleteWithConfirm, setArchived, threadRoute, togglePinned } from '../actions'
import { groupThreads, previewOf, rowTime } from '../logic/grouping'
import { useLiveLocation } from '../useLiveLocation'

/**
 * The conversation list (§6.2 list pane): search over titles and every message (the local search
 * index), `This project · All`, groups Pinned · Today · Yesterday · Previous 7 days · Earlier, two-line
 * rows (title, last line, ● while streaming, the project mark when viewing All), a per-row ⋯ menu
 * (also right-click / ⇧F10 / `.`), inline rename (F2) and an Archived view.
 */
export const ThreadList = memo(function ThreadList({ activeId }: { activeId?: ID }) {
  const navigate = useNavigate()
  const location = useLiveLocation()
  const archivedView = new URLSearchParams(location.search).get('view') === 'archived'
  const scope = useScope()
  const [mode, setMode] = useState<'project' | 'all'>('project')
  const scoped = !!scope && mode === 'project'
  const [query, setQuery] = useState('')
  const [renamingId, setRenamingId] = useState<ID | null>(null)
  const [menuId, setMenuId] = useState<ID | null>(null)
  const now = useNow(true, 60_000)

  const threads = useDB(
    useShallow((s: Tables) =>
      Object.values(s.threads).filter((t) => !!t.archived === archivedView && (!scoped || t.projectId === scope)),
    ),
  )
  const archivedCount = useDB((s: Tables) => {
    let n = 0
    for (const t of Object.values(s.threads)) if (t.archived && (!scoped || t.projectId === scope)) n++
    return n
  })
  const projects = useDB(
    useShallow((s: Tables) =>
      Object.values(s.projects)
        .filter((p) => p.status === 'active' || p.status === 'paused')
        .sort((a, b) => a.name.localeCompare(b.name)),
    ),
  )
  const groups = useMemo(() => groupThreads(threads, now), [threads, now])
  const searching = query.trim().length > 0
  const { results, ready } = useSearch(query, { kinds: ['thread'], projectId: scoped ? scope : undefined, limit: 60 })
  const showProject = !scoped

  const openArchived = (on: boolean) => {
    const next = new URLSearchParams(location.search)
    if (on) next.set('view', 'archived')
    else next.delete('view')
    const qs = next.toString()
    navigate(`${location.pathname}${qs ? `?${qs}` : ''}`, { replace: true })
  }

  const focusRow = (id: ID) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(id)}"] [data-list-row]`)?.focus())

  const menuFor = useCallback(
    (thread: Thread): MenuItem[] => [
      { id: 'rename', label: 'Rename', icon: PencilLine, shortcut: 'f2', onSelect: () => setRenamingId(thread.id) },
      { id: 'pin', label: thread.pinned ? 'Unpin' : 'Pin to the top', icon: thread.pinned ? PinOff : Pin, onSelect: () => togglePinned(thread.id) },
      {
        id: 'archive',
        label: thread.archived ? 'Unarchive' : 'Archive',
        icon: thread.archived ? ArchiveRestore : Archive,
        onSelect: () => setArchived(thread.id, !thread.archived),
      },
      { type: 'separator' },
      { type: 'label', label: 'Move to project' },
      ...projects.map(
        (p: Project): MenuItem => ({
          type: 'radio',
          id: `move:${p.id}`,
          label: p.name,
          checked: thread.projectId === p.id,
          onSelect: () => moveThread(thread, p.id),
        }),
      ),
      { type: 'radio', id: 'move:none', label: 'No project', checked: !thread.projectId, onSelect: () => moveThread(thread, null) },
      { type: 'separator' },
      { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void deleteWithConfirm(thread.id, { navigate, isOpen: thread.id === activeId }) },
    ],
    [projects, navigate, activeId],
  )

  const contextItems = (target: Element): MenuItem[] => {
    const id = target.closest('[data-thread-id]')?.getAttribute('data-thread-id')
    const thread = id ? db.get('threads', id) : undefined
    return thread ? menuFor(thread) : []
  }

  // F2 renames and `.` opens the actions of the focused row (⇧F10 / the Menu key open them at the row).
  const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const row = (e.target as HTMLElement).closest('[data-thread-id]')
    const id = row?.getAttribute('data-thread-id')
    if (!id || (e.target as HTMLElement).tagName === 'INPUT') return
    if (e.key === 'F2') {
      e.preventDefault()
      setRenamingId(id)
    } else if (e.key === '.') {
      e.preventDefault()
      setMenuId(id)
    }
  }

  const rowProps = (thread: Thread) => ({
    thread,
    active: thread.id === activeId,
    showProject,
    renaming: renamingId === thread.id,
    menuOpen: menuId === thread.id,
    onMenuOpenChange: (open: boolean) => setMenuId(open ? thread.id : null),
    menu: menuFor,
    onRenamed: (focus: boolean) => {
      setRenamingId(null)
      if (focus) focusRow(thread.id)
    },
  })

  const total = searching ? results.length : threads.length
  let body: ReactNode
  if (searching) {
    body = <SearchResults query={query} results={results} ready={ready} activeId={activeId} showProject={showProject} onClear={() => setQuery('')} />
  } else if (!threads.length) {
    body = archivedView ? (
      <EmptyState compact icon={Archive} title="Nothing archived" description="Archived conversations wait here. Archive one from its ⋯ menu." />
    ) : (
      <EmptyState
        compact
        icon={MessagesSquare}
        title={scoped ? 'No conversations in this project' : 'No conversations yet'}
        description={scoped ? 'New conversations you start here are filed into it.' : 'Ask anything. Conversations you start appear here.'}
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/chat/new')}>
            New conversation
          </Button>
        }
      />
    )
  } else {
    body = (
      <ListRows label={archivedView ? 'Archived conversations' : 'Conversations'}>
        {groups.map((g) => (
          <ListGroup key={g.id} label={g.label}>
            {g.threads.map((t) => (
              <ThreadRow key={t.id} {...rowProps(t)} />
            ))}
          </ListGroup>
        ))}
      </ListRows>
    )
  }

  return (
    <ListPane
      title={archivedView ? 'Archived' : 'Conversations'}
      count={total}
      onNew={() => navigate('/chat/new')}
      newLabel="New"
      search={{ value: query, onChange: setQuery, placeholder: 'Search conversations' }}
      scopeToggle={{ value: mode, onChange: setMode }}
      footer={
        archivedView ? (
          <button type="button" onClick={() => openArchived(false)} className={FOOTER_BUTTON}>
            <ChevronLeft aria-hidden className="size-3.5" strokeWidth={1.75} />
            All conversations
          </button>
        ) : archivedCount > 0 ? (
          <button type="button" onClick={() => openArchived(true)} className={FOOTER_BUTTON}>
            <Archive aria-hidden className="size-3.5" strokeWidth={1.75} />
            Archived
            <span className="type-meta text-ink-3">{archivedCount}</span>
          </button>
        ) : undefined
      }
    >
      {scoped && <ScopeFilterRow onShowAll={() => setMode('all')} />}
      <ContextMenu items={contextItems} aria-label="Conversation actions">
        <div onKeyDown={onListKeyDown} className="min-h-full">
          {body}
        </div>
      </ContextMenu>
    </ListPane>
  )

  function moveThread(thread: Thread, projectId: ID | null) {
    const before = thread.projectId
    if (before === projectId) return
    setThreadProject(thread.id, projectId)
    const name = projectId ? (db.get('projects', projectId)?.name ?? 'the project') : 'no project'
    toast({
      title: projectId ? `Moved to ${name}` : 'Removed from its project',
      duration: 8000,
      action: { label: 'Undo', onClick: () => setThreadProject(thread.id, before) },
    })
  }
})

const FOOTER_BUTTON =
  'type-caption flex h-10 w-full items-center gap-2 px-4 text-left font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink'

// ------------------------------------------------------------------------------------------------ rows

interface ThreadRowProps {
  thread: Thread
  active: boolean
  showProject: boolean
  renaming: boolean
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  menu: (thread: Thread) => MenuItem[]
  onRenamed: (focusRow: boolean) => void
}

/** Ids of the last two messages: enough for the preview line and the streaming dot. */
const tailOf = (t: Thread) => t.messageIds.slice(-2)

const ThreadRow = memo(function ThreadRow({ thread, active, showProject, renaming, menuOpen, onMenuOpenChange, menu, onRenamed }: ThreadRowProps) {
  const preview = useDB((s: Tables) => previewOf(tailOf(thread).map((id) => s.messages[id])))
  const streaming = useDB((s: Tables) => tailOf(thread).some((id) => s.messages[id]?.status === 'streaming'))
  const hue = useDB((s: Tables) => (showProject && thread.projectId ? s.projects[thread.projectId]?.hue : undefined))
  const now = useNow(true, 60_000)

  if (renaming) return <RenameRow thread={thread} onDone={onRenamed} />
  return (
    <div data-thread-id={thread.id} className="group/row relative">
      <ListRow
        to={threadRoute(thread.id)}
        selected={active}
        entity={{ kind: 'thread', id: thread.id }}
        aria-label={`${thread.title}${streaming ? ', writing' : ''}`}
        leading={showProject ? <ProjectSquare hue={hue} /> : undefined}
        title={thread.title}
        secondary={preview || <span className="text-ink-4">No messages yet</span>}
        meta={
          streaming ? (
            <span className="inline-flex h-4 items-center gap-1.5 text-live-ink">
              <LiveIndicator size="xs" />
              <span className="sr-only">Writing</span>
            </span>
          ) : (
            <span className="group-hover/row:invisible group-focus-within/row:invisible pointer-coarse:invisible">{rowTime(thread.updatedAt, now)}</span>
          )
        }
        className="pr-9"
      />
      <div
        className={cn(
          'absolute top-1.5 right-2.5 opacity-0 transition-opacity duration-(--dur-1) group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100',
          menuOpen && 'opacity-100',
        )}
      >
        <Menu
          open={menuOpen}
          onOpenChange={onMenuOpenChange}
          items={menu(thread)}
          placement="bottom-end"
          aria-label={`Actions for ${thread.title}`}
          trigger={<IconButton icon={Ellipsis} label={`Actions for “${thread.title}”`} size="xs" tabIndex={-1} tooltip={false} />}
        />
      </div>
    </div>
  )
})

function ProjectSquare({ hue }: { hue?: string }) {
  return hue ? (
    <span aria-hidden className={cn('mt-[3px] size-2.5 shrink-0 rounded-[3px]', HUE_FILL[hue as keyof typeof HUE_FILL])} />
  ) : (
    <span aria-hidden className="mt-[3px] size-2.5 shrink-0 rounded-[3px] border border-line-input" />
  )
}

function RenameRow({ thread, onDone }: { thread: Thread; onDone: (focusRow: boolean) => void }) {
  const [value, setValue] = useState(thread.title)
  const commit = (focus: boolean) => {
    const next = value.replace(/\s+/g, ' ').trim()
    if (next && next !== thread.title) renameThread(thread.id, next)
    onDone(focus)
  }
  return (
    <div data-thread-id={thread.id} className="mx-1.5 flex h-(--row-h-2) items-center rounded-sm bg-accent-tint px-1.5">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => commit(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onDone(true)
          }
        }}
        aria-label="Conversation title"
        className="type-body-sm h-8 w-full min-w-0 rounded-sm border border-line-input bg-raised px-2 text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-(--focus-ring)"
      />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ search

function SearchResults({
  query,
  results,
  ready,
  activeId,
  showProject,
  onClear,
}: {
  query: string
  results: SearchResult[]
  ready: boolean
  activeId?: ID
  showProject: boolean
  onClear: () => void
}) {
  if (!results.length && !ready) {
    return (
      <div aria-busy="true" aria-label="Searching" className="flex flex-col gap-3 px-4 py-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton variant="rect" height={10} width={`${70 - i * 12}%`} />
            <Skeleton variant="rect" height={8} width={`${88 - i * 9}%`} />
          </div>
        ))}
      </div>
    )
  }
  if (!results.length) {
    return (
      <EmptyState
        compact
        icon={SearchX}
        title="No conversations match"
        description={`Nothing in titles or messages matches “${query.trim()}”.`}
        actions={
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear search
          </Button>
        }
      />
    )
  }
  return (
    <ListRows label="Search results">
      <ListGroup label={ready ? 'Results' : 'Searching…'} count={results.length}>
        {results.map((r) => (
          <ResultRow key={r.ref.id} result={r} active={r.ref.id === activeId} showProject={showProject} />
        ))}
      </ListGroup>
    </ListRows>
  )
}

const ResultRow = memo(function ResultRow({ result, active, showProject }: { result: SearchResult; active: boolean; showProject: boolean }) {
  const thread = useDB((s: Tables) => s.threads[result.ref.id])
  const hue = useDB((s: Tables) => (showProject && thread?.projectId ? s.projects[thread.projectId]?.hue : undefined))
  if (!thread) return null
  const anchor = result.anchor?.kind === 'message' ? `?m=${encodeURIComponent(result.anchor.id)}` : ''
  return (
    <div data-thread-id={thread.id} className="group/row relative">
      <ListRow
        to={`${threadRoute(thread.id)}${anchor}`}
        selected={active}
        entity={{ kind: 'thread', id: thread.id }}
        leading={showProject ? <ProjectSquare hue={hue} /> : undefined}
        title={thread.title}
        secondary={<Highlighted text={result.snippet} ranges={result.highlights} />}
        meta={thread.archived ? <Tag size="sm">Archived</Tag> : rowTime(thread.updatedAt)}
      />
    </div>
  )
})

/** A snippet with its matches marked (neutral highlight wash, §4.1 --highlight). */
function Highlighted({ text, ranges }: { text: string; ranges: ReadonlyArray<readonly [number, number]> }) {
  if (!ranges.length) return <>{text}</>
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([a, b], i) => {
    if (a > at) parts.push(text.slice(at, a))
    parts.push(
      <mark key={i} className="rounded-[2px] bg-highlight text-ink-2">
        {text.slice(a, b)}
      </mark>,
    )
    at = b
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}
