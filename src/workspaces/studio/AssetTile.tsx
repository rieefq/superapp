import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { motion } from 'motion/react'
import { ArrowUpRight, Ellipsis, FolderInput, Layers, RotateCcw, Shuffle, Square, Star, Trash2 } from 'lucide-react'
import { announce } from '@/app/shell/Announcer'
import { attachRun } from '@/app/shell/store'
import { useIsPinned, useContextStore } from '@/core/context'
import { useRun } from '@/core/runs'
import { createVariation, retryGeneration, stopGeneration, toggleFavorite, useAsset, versionParams } from '@/core/services/studio'
import type { Asset, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { IconButton, Menu, RunStatusGlyph, SimBadge, StepTape, runCurrentLine, toast, useReducedMotion, type MenuItem } from '@/ui'
import { confirmDeleteAsset, downloadItems } from './actions'
import { KINDS } from './kinds'
import { AssetThumb, assetAspect } from './previews'

/**
 * A contact-sheet tile (§6.8): the version's preview at its own aspect on a hatched mat (simulated),
 * the `SIM` corner tag, title (13/600) and `meta` (kind icon · v3 · generator). Generating tiles show the
 * run's Step Tape and current step, then *develop* (a 600ms fade). Failed tiles show ✕ and Retry.
 * Subscribes to its own row and run only, so a streaming run never re-renders the whole sheet.
 */

const MAT_RATIO = 5 / 4

export interface AssetTileProps {
  id: ID
  index: number
  /** The roving tab stop of the grid. */
  tabbable: boolean
  onFocusIndex: (index: number) => void
  onMove: (id: ID) => void
  onInspect: (id: ID) => void
  onKeyDown: (e: KeyboardEvent<HTMLAnchorElement>, index: number) => void
}

export const AssetTile = memo(function AssetTile({ id, index, tabbable, onFocusIndex, onMove, onInspect, onKeyDown }: AssetTileProps) {
  const asset = useAsset(id)
  if (!asset) return null
  return <Tile asset={asset} index={index} tabbable={tabbable} onFocusIndex={onFocusIndex} onMove={onMove} onInspect={onInspect} onKeyDown={onKeyDown} />
})

function Tile({ asset, index, tabbable, onFocusIndex, onMove, onInspect, onKeyDown }: Omit<AssetTileProps, 'id'> & { asset: Asset }) {
  const generating = asset.status === 'generating'
  const failed = asset.status === 'failed'
  const run = useRun(generating || failed ? asset.runId : undefined)
  const reduced = useReducedMotion()
  const info = KINDS[asset.kind]
  const KindIcon = info.icon
  const held = useIsPinned({ kind: 'asset', id: asset.id })
  const versions = asset.versions.length
  const current = asset.versions[asset.currentVersion]

  // Develop: when this tile finishes generating while on screen, the new version fades in (600ms).
  const wasGenerating = useRef(generating)
  const [developKey, setDevelopKey] = useState<string | null>(null)
  useEffect(() => {
    if (wasGenerating.current && !generating && current) setDevelopKey(current.id)
    wasGenerating.current = generating
  }, [generating, current])

  const ratio = assetAspect(asset)
  const wide = ratio >= MAT_RATIO
  const meta = generating
    ? run
      ? runCurrentLine(run)
      : 'Generating'
    : failed
      ? (run?.status === 'cancelled' ? 'Stopped' : 'Failed')
      : `v${asset.currentVersion + 1}${versions > 1 ? ` of ${versions}` : ''} · ${asset.generator.label}`

  const [menuOpen, setMenuOpen] = useState(false)
  const toggleHold = () => {
    const store = useContextStore.getState()
    const ref = { kind: 'asset' as const, id: asset.id }
    if (held) store.unpin(ref)
    else store.pin(ref)
    announce(held ? `Released “${asset.title}”` : `Holding “${asset.title}”`)
  }
  const handleKey = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat) {
      if (e.key === '.') {
        e.preventDefault()
        setMenuOpen(true)
        return
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault()
        toggleHold()
        return
      }
    }
    onKeyDown(e, index)
  }

  const menu: MenuItem[] = [
    { id: 'open', label: 'Open', icon: ArrowUpRight, shortcut: 'enter', onSelect: () => document.getElementById(`studio-tile-${asset.id}`)?.click() },
    { id: 'inspect', label: 'Inspect', icon: Layers, shortcut: 'space', onSelect: () => onInspect(asset.id) },
    { type: 'separator' },
    ...(!generating && versions > 0
      ? [{ id: 'variation', label: 'Create a variation', icon: Shuffle, onSelect: () => (createVariation(asset.id), toast({ title: `Generating a variation of “${asset.title}”` })) }]
      : []),
    ...(generating ? [{ id: 'stop', label: 'Stop generating', icon: Square, onSelect: () => stopGeneration(asset.id) }] : []),
    ...(failed ? [{ id: 'retry', label: 'Retry', icon: RotateCcw, onSelect: () => retryGeneration(asset.id) }] : []),
    { id: 'favorite', label: asset.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, onSelect: () => toggleFavorite(asset.id) },
    {
      id: 'hold',
      label: held ? 'Release' : 'Hold',
      icon: Layers,
      shortcut: 'h',
      onSelect: toggleHold,
    },
    { id: 'move', label: 'Move to board…', icon: FolderInput, onSelect: () => onMove(asset.id) },
    ...(versions > 0 ? [{ type: 'separator' as const }, ...downloadItems(asset)] : []),
    { type: 'separator' },
    { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void confirmDeleteAsset(asset) },
  ]

  const label = `${asset.title} — ${info.label}${versions ? `, version ${asset.currentVersion + 1} of ${versions}` : ''}${generating ? ', generating' : failed ? ', failed' : ''}, simulated`

  return (
    <div role="listitem" className="group/tile relative min-w-0" data-asset-tile={asset.id} data-status={asset.status}>
      <Link
        id={`studio-tile-${asset.id}`}
        to={`/studio/${encodeURIComponent(asset.id)}`}
        tabIndex={tabbable ? 0 : -1}
        aria-label={label}
        data-tile-index={index}
        onFocus={() => onFocusIndex(index)}
        onKeyDown={handleKey}
        className="block rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
      >
        <div
          className="sim-hatch relative overflow-hidden rounded-sm border border-dashed border-line-input transition-colors duration-(--dur-1) group-hover/tile:border-ink-3"
          style={{ aspectRatio: String(MAT_RATIO) }}
        >
          <div className="absolute inset-1.5 grid place-items-center">
            <div
              className={cn(
                'relative max-h-full max-w-full overflow-hidden rounded-[3px] ring-1 ring-line-strong',
              )}
              style={{ aspectRatio: String(ratio), width: wide ? '100%' : 'auto', height: wide ? 'auto' : '100%' }}
            >
              {versions > 0 && (
                <motion.div
                  key={developKey ?? 'static'}
                  initial={developKey && !reduced ? { opacity: 0 } : false}
                  animate={{ opacity: generating ? 0.35 : 1 }}
                  transition={{ duration: developKey && !reduced ? 0.6 : 0.24 }}
                  className="absolute inset-0"
                >
                  <AssetThumb asset={asset} />
                </motion.div>
              )}
            </div>
          </div>
          {asset.generator.simulated && (
            <span className="absolute bottom-1.5 left-1.5">
              <SimBadge size="xs" noTooltip />
            </span>
          )}
          {asset.kind === 'video' && versions > 0 && !generating && (
            <span className="type-meta absolute right-1.5 bottom-1.5 rounded-xs bg-overlay px-1 text-ink-2 tabular">
              {String(versionParams(asset).durationSec ?? 30)} s
            </span>
          )}
          {(generating || failed) && (
            <div className="absolute inset-0 grid place-items-center p-3">
              <div className="flex max-w-full flex-col items-center gap-2 rounded-sm border border-line bg-overlay px-3 py-2 text-center shadow-e1">
                {generating ? (
                  run ? (
                    <StepTape run={run} size="sm" max={10} />
                  ) : (
                    <RunStatusGlyph status="queued" size={12} />
                  )
                ) : (
                  <span className="flex items-center gap-1.5 text-fail-ink">
                    <RunStatusGlyph status={run?.status === 'cancelled' ? 'cancelled' : 'failed'} size={12} />
                    <span className="type-caption font-medium">{run?.status === 'cancelled' ? 'Stopped' : 'Generation failed'}</span>
                  </span>
                )}
                {generating && run && <span className="type-caption max-w-[22ch] truncate text-live-ink">{runCurrentLine(run)}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-0.5 px-0.5 pt-2 pb-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-semibold text-ink">{asset.title}</span>
            {asset.favorite && <Star aria-label="Favorite" className="size-3 shrink-0 fill-ink text-ink" strokeWidth={1.75} />}
          </span>
          <span className={cn('type-meta flex min-w-0 items-center gap-1.5', failed ? 'text-fail-ink' : 'text-ink-3')}>
            <KindIcon aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 truncate">{meta}</span>
            {!generating && !failed && <span className="shrink-0 pointer-coarse:hidden">{timeAgo(asset.updatedAt).replace(' ago', '')}</span>}
          </span>
        </div>
      </Link>
      <div
        className={cn(
          'absolute top-2.5 right-2.5 flex items-center gap-1 transition-opacity duration-(--dur-1)',
          'opacity-0 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 pointer-coarse:opacity-100',
        )}
      >
        {failed && (
          <IconButton icon={RotateCcw} label={`Retry “${asset.title}”`} size="xs" variant="secondary" onClick={() => retryGeneration(asset.id)} tabIndex={tabbable ? 0 : -1} />
        )}
        {generating && run && (
          <IconButton icon={ArrowUpRight} label="Show the run" size="xs" variant="secondary" onClick={() => attachRun(run.id, 'studio')} tabIndex={tabbable ? 0 : -1} />
        )}
        <IconButton
          icon={Star}
          label={asset.favorite ? `Remove “${asset.title}” from favorites` : `Add “${asset.title}” to favorites`}
          size="xs"
          variant="secondary"
          active={!!asset.favorite}
          onClick={() => toggleFavorite(asset.id)}
          tabIndex={tabbable ? 0 : -1}
          className={cn(asset.favorite && '[&_svg]:fill-current')}
        />
        <Menu
          items={menu}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          aria-label={`Actions for “${asset.title}”`}
          placement="bottom-end"
          trigger={<IconButton icon={Ellipsis} label={`Actions for “${asset.title}”`} shortcut="." size="xs" variant="secondary" tabIndex={tabbable ? 0 : -1} />}
        />
      </div>
    </div>
  )
}
