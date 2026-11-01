import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Ellipsis, FolderOpen, LayoutGrid, Library, PenLine, Plus, Star, Trash2 } from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows, ScopeFilterRow } from '@/app/templates'
import { announce } from '@/app/shell/Announcer'
import { useDB, type Tables } from '@/core/db'
import { createBoard, deleteBoard, renameBoard } from '@/core/services/studio'
import type { Asset, Board, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { IconButton, Input, Menu, confirm, toast } from '@/ui'
import { KIND_ORDER, KINDS } from './kinds'
import { boardsInScope, inPlace, inScope, matchesQuery, samePlace, type Place } from './logic'
import { useStudioView } from './view'

/**
 * Studio's list pane (§6.8 Library): All assets · Favorites, the kinds (a facet that combines with the
 * place), and Boards (+ New board, rename, delete). Counts follow the scope and the search.
 */
export function StudioListPane({ activePlace, onNew }: { activePlace: Place | null; onNew: () => void }) {
  const view = useStudioView()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const assets = useDB((s: Tables) => s.assets)
  const boardsTable = useDB((s: Tables) => s.boards)
  const boards = useMemo(() => boardsInScope(Object.values(boardsTable), view.projectId), [boardsTable, view.projectId])
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ID | null>(null)

  // ⌘K "New board" lands here with ?newboard=1.
  useEffect(() => {
    if (params.get('newboard') !== '1') return
    setCreating(true)
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('newboard')
        return next
      },
      { replace: true },
    )
  }, [params, setParams])

  const visible = useMemo(() => Object.values(assets).filter((a) => inScope(a, view.projectId) && matchesQuery(a, view.q)), [assets, view.projectId, view.q])
  const count = (pred: (a: Asset) => boolean) => visible.reduce((n, a) => n + (pred(a) ? 1 : 0), 0)
  const place = activePlace ?? view.place
  const kindCounts = useMemo(() => {
    const out = Object.fromEntries(KIND_ORDER.map((k) => [k, 0])) as Record<string, number>
    for (const a of visible) if (inPlace(a, place)) out[a.kind] += 1
    return out
  }, [visible, place])
  const unfiled = count((a) => !a.boardId)

  const isPlace = (p: Place) => !!activePlace && samePlace(activePlace, p)
  const toPlace = (p: Place) => view.href({ place: p })

  const submitNew = (name: string) => {
    const clean = name.trim()
    setCreating(false)
    if (!clean) return
    const board = createBoard({ name: clean, projectId: view.scope })
    announce(`Created board “${board.name}”`)
    navigate(view.href({ place: { type: 'board', id: board.id }, kind: null }))
  }

  const remove = async (board: Board) => {
    const n = Object.values(assets).filter((a) => a.boardId === board.id).length
    const ok = await confirm({
      title: `Delete the board “${board.name}”?`,
      description: n ? `Its ${n} ${n === 1 ? 'asset stays' : 'assets stay'} in Studio, without a board.` : 'The board is empty.',
      tone: 'danger',
      confirmLabel: 'Delete board',
    })
    if (!ok) return
    deleteBoard(board.id)
    toast({ title: `Deleted the board “${board.name}”` })
    if (activePlace?.type === 'board' && activePlace.id === board.id) navigate(view.href({ place: { type: 'all' } }), { replace: true })
  }

  return (
    <ListPane
      title="Studio"
      count={visible.length}
      onNew={onNew}
      newLabel="New"
      search={{
        value: view.q,
        onChange: (q) => navigate(view.href({ q, place: activePlace ? undefined : view.place }), { replace: true }),
        placeholder: 'Search assets',
      }}
      scopeToggle={view.scope ? { value: view.showAll ? 'all' : 'project', onChange: (v) => navigate(view.href({ all: v === 'all' }), { replace: true }) } : undefined}
    >
      {!view.showAll && <ScopeFilterRow onShowAll={() => navigate(view.href({ all: true }), { replace: true })} />}
      <ListRows label="Studio places">
        <ListGroup label="Library">
          <ListRow
            to={toPlace({ type: 'all' })}
            selected={isPlace({ type: 'all' })}
            leading={<Library aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
            title="All assets"
            meta={visible.length}
          />
          <ListRow
            to={toPlace({ type: 'favorites' })}
            selected={isPlace({ type: 'favorites' })}
            leading={<Star aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
            title="Favorites"
            meta={count((a) => !!a.favorite)}
          />
        </ListGroup>
        <ListGroup label="Kinds">
          {KIND_ORDER.map((k) => {
            const Icon = KINDS[k].icon
            const on = view.kind === k && !!activePlace
            return (
              <ListRow
                key={k}
                to={view.href({ kind: on ? null : k, place: activePlace ? undefined : { type: 'all' } })}
                selected={on}
                aria-label={`${KINDS[k].plural}${on ? ' (filter on — select to clear)' : ''}`}
                leading={<Icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
                title={KINDS[k].plural}
                meta={kindCounts[k]}
              />
            )
          })}
        </ListGroup>
        <ListGroup label="Boards" count={boards.length}>
          {boards.map((b) =>
            renaming === b.id ? (
              <InlineName
                key={b.id}
                initial={b.name}
                label="Board name"
                onDone={(name) => {
                  setRenaming(null)
                  if (name && name !== b.name) {
                    renameBoard(b.id, name)
                    announce(`Renamed the board to “${name}”`)
                  }
                }}
              />
            ) : (
              <div key={b.id} className="group/board relative">
                <ListRow
                  to={toPlace({ type: 'board', id: b.id })}
                  selected={isPlace({ type: 'board', id: b.id })}
                  entity={{ kind: 'board', id: b.id }}
                  leading={<LayoutGrid aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
                  title={b.name}
                  meta={<span className="group-focus-within/board:invisible group-hover/board:invisible pointer-coarse:invisible">{count((a) => a.boardId === b.id)}</span>}
                />
                {/* A sibling of the row (never nested in its link); keyboard users rename and delete from the stage header. */}
                <span className="absolute top-1/2 right-3 -translate-y-1/2 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/board:opacity-100 group-hover/board:opacity-100 pointer-coarse:opacity-100">
                  <Menu
                    aria-label={`Board “${b.name}”`}
                    placement="bottom-end"
                    items={[
                      { id: 'rename', label: 'Rename', icon: PenLine, onSelect: () => setRenaming(b.id) },
                      { id: 'delete', label: 'Delete board…', icon: Trash2, danger: true, onSelect: () => void remove(b) },
                    ]}
                    trigger={<IconButton icon={Ellipsis} label={`Actions for the board “${b.name}”`} size="xs" tabIndex={-1} />}
                  />
                </span>
              </div>
            ),
          )}
          {unfiled > 0 && (
            <ListRow
              to={toPlace({ type: 'unfiled' })}
              selected={isPlace({ type: 'unfiled' })}
              leading={<FolderOpen aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
              title="No board"
              meta={unfiled}
            />
          )}
          {creating ? (
            <InlineName initial="" label="New board name" placeholder="Board name" onDone={submitNew} />
          ) : (
            <ListRow onClick={() => setCreating(true)} leading={<Plus aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />} title="New board" />
          )}
        </ListGroup>
      </ListRows>
    </ListPane>
  )
}

/** A row-sized name field: ⏎ saves, Esc cancels, blur saves. */
function InlineName({ initial, label, placeholder, onDone }: { initial: string; label: string; placeholder?: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (name: string) => {
    if (done.current) return
    done.current = true
    onDone(name.replace(/\s+/g, ' ').trim())
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(initial)
    }
  }
  return (
    <div className={cn('mx-1.5 flex h-(--row-h) items-center px-1')}>
      <Input
        autoFocus
        size="sm"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onValueChange={setValue}
        onKeyDown={onKeyDown}
        onBlur={() => finish(value)}
        onFocus={(e) => e.currentTarget.select()}
        wrapperClassName="w-full"
      />
    </div>
  )
}
