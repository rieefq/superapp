import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Copy, Library, LayoutGrid, Palette, Search, Star, Trash2, X } from 'lucide-react'
import { Stage, StageHeader, useInspectEntity } from '@/app/templates'
import { useRegisterCommands } from '@/app/commands/registry'
import { setSelection } from '@/app/shell/store'
import { useDB, type Tables } from '@/core/db'
import { deleteBoard, renameBoard } from '@/core/services/studio'
import type { Asset, AssetKind, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, EmptyState, ErrorState, confirm, toast, type MenuItem } from '@/ui'
import { MoveToBoardDialog } from './actions'
import { AssetTile } from './AssetTile'
import { KINDS } from './kinds'
import { filterAssets, gridMove, inPlace, inScope, isAssetKind, matchesQuery, type Place } from './logic'
import { PromptBar, type PromptBarHandle } from './PromptBar'
import { useStudioView } from './view'

/**
 * The board stage (§6.8): the sticky generation bar over the contact sheet on --surface-sunken —
 * 200px tiles (160–240) with 8px gaps, the only gapped grid in the product. Arrow keys move through
 * the tiles, ⏎ opens, Space inspects, `.` opens a tile's actions, H holds it.
 */
export function ContactSheet({ composeRef }: { composeRef: (h: PromptBarHandle | null) => void }) {
  const view = useStudioView()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const inspect = useInspectEntity()
  const assetsTable = useDB((s: Tables) => s.assets)
  const board = useDB((s: Tables) => (view.place.type === 'board' ? s.boards[view.place.id] : undefined))
  const assets = useMemo(
    () => filterAssets(Object.values(assetsTable), { place: view.place, kind: view.kind, q: view.q, projectId: view.projectId }),
    [assetsTable, view.place, view.kind, view.q, view.projectId],
  )
  // Re-render tiles only when the visible set or order changes (rows re-render themselves).
  const idsKey = assets.map((a) => a.id).join('|')
  const ids = useMemo(() => (idsKey ? idsKey.split('|') : []), [idsKey])
  const bodyRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<PromptBarHandle | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const [moveId, setMoveId] = useState<ID | null>(null)
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null)
  const [composeKind, setComposeKind] = useState<AssetKind | null>(view.kind)

  // ?compose=<kind> (⌘K "Generate an image…", N): pick the kind and focus the bar.
  useEffect(() => {
    const compose = params.get('compose')
    if (compose === null) return
    if (isAssetKind(compose)) setComposeKind(compose)
    requestAnimationFrame(() => barRef.current?.focus())
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.delete('compose')
        return next
      },
      { replace: true },
    )
  }, [params, setParams])
  useEffect(() => {
    if (view.kind) setComposeKind(view.kind)
  }, [view.kind])

  const setBar = useCallback(
    (h: PromptBarHandle | null) => {
      barRef.current = h
      composeRef(h)
    },
    [composeRef],
  )

  // A board that no longer exists (deleted elsewhere, stale link).
  const missingBoard = view.place.type === 'board' && !board

  const onGenerated = (asset: Asset) => {
    const shown = inPlace(asset, view.place) && (!view.kind || asset.kind === view.kind) && matchesQuery(asset, view.q) && inScope(asset, view.projectId)
    if (!shown) {
      const place: Place = asset.boardId ? { type: 'board', id: asset.boardId } : { type: 'all' }
      navigate(view.href({ place, kind: null, q: '', all: view.projectId && asset.projectId !== view.projectId ? true : undefined }))
    }
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    setFocusIndex(0)
  }

  // ---- grid keyboard
  const idsRef = useRef(ids)
  idsRef.current = ids
  const columns = () => {
    const tiles = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[data-asset-tile]') ?? [])
    if (!tiles.length) return 1
    const top = tiles[0].offsetTop
    const n = tiles.findIndex((t) => t.offsetTop !== top)
    return n < 0 ? tiles.length : n
  }
  const focusTile = (i: number) => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-tile-index="${i}"]`)
    el?.focus()
    el?.scrollIntoView({ block: 'nearest' })
  }
  const onTileKey = useCallback((e: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === ' ') {
      e.preventDefault()
      const id = idsRef.current[index]
      if (id) inspect({ kind: 'asset', id })
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
    const next = gridMove(index, e.key, columns(), idsRef.current.length)
    e.preventDefault()
    if (next !== index) focusTile(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspect])
  const onFocusIndex = useCallback((i: number) => {
    setFocusIndex(i)
    const id = idsRef.current[i]
    if (id) setSelection({ kind: 'asset', id })
  }, [])
  const onInspect = useCallback((id: ID) => inspect({ kind: 'asset', id }), [inspect])
  const onMove = useCallback((id: ID) => setMoveId(id), [])
  const tabStop = Math.min(focusIndex, Math.max(0, ids.length - 1))

  // ---- header
  const placeTitle =
    view.place.type === 'all' ? 'All assets' : view.place.type === 'favorites' ? 'Favorites' : view.place.type === 'unfiled' ? 'No board' : (board?.name ?? 'Board')
  const PlaceIcon = view.place.type === 'favorites' ? Star : view.place.type === 'board' ? LayoutGrid : Library
  const removeBoard = async () => {
    if (!board) return
    const n = Object.values(assetsTable).filter((a) => a.boardId === board.id).length
    const ok = await confirm({
      title: `Delete the board “${board.name}”?`,
      description: n ? `Its ${n} ${n === 1 ? 'asset stays' : 'assets stay'} in Studio, without a board.` : 'The board is empty.',
      tone: 'danger',
      confirmLabel: 'Delete board',
    })
    if (!ok) return
    deleteBoard(board.id)
    toast({ title: `Deleted the board “${board.name}”` })
    navigate(view.href({ place: { type: 'all' } }), { replace: true })
  }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${view.href()}`)
      toast({ title: 'Link copied' })
    } catch {
      toast({ tone: 'error', title: 'Couldn’t copy the link' })
    }
  }
  const menu: MenuItem[] = [
    { id: 'link', label: 'Copy link', icon: Copy, onSelect: () => void copyLink() },
    ...(board ? [{ type: 'separator' as const }, { id: 'delete', label: 'Delete board…', icon: Trash2, danger: true, onSelect: () => void removeBoard() }] : []),
  ]

  useRegisterCommands(
    'studio.sheet',
    board
      ? [
          { id: 'studio.board.delete', title: `Delete the board “${board.name}”`, icon: Trash2, group: 'Studio', keywords: ['board', 'remove'], run: (ctx) => (ctx.close(), void removeBoard()) },
        ]
      : [],
  )

  const filters = (
    <span className="flex min-w-0 items-center gap-1.5">
      {view.kind && (
        <FilterChip label={KINDS[view.kind].plural} onClear={() => navigate(view.href({ kind: null }))} />
      )}
      {view.q && <FilterChip label={`“${view.q}”`} icon={<Search aria-hidden className="size-3" strokeWidth={2} />} onClear={() => navigate(view.href({ q: '' }))} />}
    </span>
  )

  const clearAll = () => navigate(view.href({ kind: null, q: '' }))
  const examples = (view.kind ? KINDS[view.kind].examples : [...KINDS.image.examples.slice(0, 1), ...KINDS.presentation.examples.slice(0, 1), ...KINDS.document.examples.slice(0, 1)]).slice(0, 3)
  const empty = ids.length === 0

  return (
    <Stage
      header={
        <StageHeader
          leading={<PlaceIcon aria-hidden className="mr-0.5 size-4 text-ink-3" strokeWidth={1.75} />}
          title={placeTitle}
          onRename={board ? (name) => renameBoard(board.id, name) : undefined}
          status={filters}
          menu={menu}
        />
      }
      padded={false}
      bodyRef={bodyRef}
    >
      <div className="min-h-full bg-sunken">
        <div className="z-(--z-sticky) bg-sunken px-4 pt-4 pb-3 md:sticky md:top-0 md:px-6 md:pt-5">
          <div className="max-w-[920px]">
            <PromptBar
              initialKind={composeKind}
              boardId={board ? board.id : null}
              scope={view.scope}
              onGenerated={onGenerated}
              handleRef={setBar}
              prefill={prefill}
            />
          </div>
        </div>
        <div className="px-4 pt-1 pb-10 md:px-6">
          <SheetBoundary>
            {missingBoard ? (
              <EmptyState
                icon={LayoutGrid}
                title="This board no longer exists"
                description="It was deleted. Its assets are still in Studio, without a board."
                actions={<Button onClick={() => navigate(view.href({ place: { type: 'all' } }))}>Show all assets</Button>}
                className="py-16"
              />
            ) : empty ? (
              <SheetEmpty
                place={view.place}
                filtered={!!view.kind || !!view.q}
                examples={examples}
                onExample={(text) => setPrefill({ text, nonce: Date.now() })}
                onClear={clearAll}
              />
            ) : (
              <div
                ref={gridRef}
                role="list"
                aria-label={`${placeTitle}${view.kind ? ` · ${KINDS[view.kind].plural}` : ''}: ${ids.length} ${ids.length === 1 ? 'asset' : 'assets'}`}
                className={cn('grid gap-2', 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]', '3xl:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]')}
              >
                {ids.map((id, i) => (
                  <AssetTile key={id} id={id} index={i} tabbable={i === tabStop} onFocusIndex={onFocusIndex} onMove={onMove} onInspect={onInspect} onKeyDown={onTileKey} />
                ))}
              </div>
            )}
          </SheetBoundary>
        </div>
      </div>
      <MoveToBoardDialog assetId={moveId} onClose={() => setMoveId(null)} />
    </Stage>
  )
}

function FilterChip({ label, icon, onClear }: { label: string; icon?: ReactNode; onClear: () => void }) {
  return (
    <span className="type-caption inline-flex h-6 max-w-[200px] shrink-0 items-center gap-1 rounded-sm border border-line-strong pr-0.5 pl-2 font-medium text-ink-2">
      {icon}
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear the filter ${label}`}
        className="relative grid size-5 place-items-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']"
      >
        <X aria-hidden className="size-3" strokeWidth={2} />
      </button>
    </span>
  )
}

function SheetEmpty({ place, filtered, examples, onExample, onClear }: { place: Place; filtered: boolean; examples: string[]; onExample: (text: string) => void; onClear: () => void }) {
  if (filtered) {
    return (
      <EmptyState
        icon={Search}
        title="No assets match"
        description="Nothing in this view matches the kind or search. Clear them to see everything here."
        actions={<Button onClick={onClear}>Clear filters</Button>}
        className="py-16"
      />
    )
  }
  if (place.type === 'favorites') {
    return <EmptyState icon={Star} title="No favorites yet" description="Star an asset on the contact sheet or in its view to keep it here." className="py-16" />
  }
  return (
    <div className="flex flex-col items-center gap-5 py-14 text-center">
      <EmptyState
        icon={Palette}
        title="Describe something to make."
        description={
          place.type === 'board'
            ? 'This board is empty. What you generate here is filed on it.'
            : 'Images, video storyboards, decks, docs and narration. Previews are drawn locally and labeled simulated.'
        }
        className="py-0"
      />
      <ul className="flex max-w-[640px] flex-wrap justify-center gap-2" aria-label="Examples">
        {examples.map((x) => (
          <li key={x}>
            <button
              type="button"
              onClick={() => onExample(x)}
              className="type-caption rounded-sm border border-line-strong bg-canvas px-2.5 py-1.5 text-left text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:min-h-11"
            >
              {x}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

class SheetBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[studio] contact sheet failed', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="Couldn’t show the contact sheet"
          message="Something in this view failed to render. Your assets are safe."
          details={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          className="py-12"
        />
      )
    }
    return this.props.children
  }
}
