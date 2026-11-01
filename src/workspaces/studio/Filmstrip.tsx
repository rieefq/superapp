import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Columns2 } from 'lucide-react'
import { useRun } from '@/core/runs'
import { setCurrentVersion } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, StepTape, Tooltip } from '@/ui'
import { AssetThumb, assetAspect } from './previews'

/**
 * The 64px version filmstrip (§6.8): one frame per version, the current one ringed in ink. Arrow
 * keys move and pick (like tabs); `←`/`→` and `1`–`9` work from anywhere on the asset page. While
 * comparing, picking a frame sets B (A is always the current version).
 */
export interface FilmstripProps {
  asset: Asset
  comparing: boolean
  compareIndex: number | null
  onCompareIndex: (index: number) => void
  onToggleCompare: () => void
}

export function Filmstrip({ asset, comparing, compareIndex, onCompareIndex, onToggleCompare }: FilmstripProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const run = useRun(asset.status === 'generating' ? asset.runId : undefined)
  const count = asset.versions.length
  const current = asset.currentVersion

  // Keep the current frame in view — scrolling the strip only, never the page.
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-version-index="${current}"]`)
    if (!list || !el) return
    const left = el.offsetLeft - list.offsetLeft
    if (left < list.scrollLeft) list.scrollLeft = left - 4
    else if (left + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + el.offsetWidth - list.clientWidth + 4
  }, [current, count])

  const pick = (i: number) => {
    if (comparing) {
      if (i !== current) onCompareIndex(i)
      return
    }
    setCurrentVersion(asset.id, i)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -Infinity, End: Infinity }
    if (!(e.key in moves)) return
    e.preventDefault()
    e.stopPropagation()
    const next = Math.max(0, Math.min(count - 1, moves[e.key] === -Infinity ? 0 : moves[e.key] === Infinity ? count - 1 : i + moves[e.key]))
    pick(next)
    listRef.current?.querySelector<HTMLElement>(`[data-version-index="${next}"]`)?.focus({ preventScroll: true })
  }

  const ratio = assetAspect(asset)
  const frameWidth = Math.round(Math.min(114, Math.max(36, 64 * ratio)))
  const focusIndex = comparing && compareIndex !== null ? compareIndex : current

  return (
    <section aria-label="Versions" className="flex min-w-0 flex-col gap-2">
      <div className="flex h-7 items-center gap-2">
        <h2 className="type-label text-ink-3">Versions</h2>
        <span className="type-meta text-ink-3 tabular">{count}</span>
        <span className="type-meta hidden text-ink-3 md:inline pointer-coarse:hidden">← → to switch · 1–9 to pick</span>
        <span className="flex-1" />
        {count > 1 && (
          <Button size="xs" variant={comparing ? 'secondary' : 'ghost'} leadingIcon={Columns2} aria-pressed={comparing} onClick={onToggleCompare}>
            {comparing ? 'Done comparing' : 'Compare A/B'}
          </Button>
        )}
      </div>
      {comparing && (
        <p className="type-caption text-ink-3" role="status">
          A is the current version (v{current + 1}). Pick B from the strip{compareIndex !== null ? ` — now v${compareIndex + 1}` : ''}.
        </p>
      )}
      <div ref={listRef} role="group" aria-label="Version frames" className="no-scrollbar -mx-1 flex min-w-0 items-end gap-2 overflow-x-auto px-1 pt-1 pb-1">
        {asset.versions.map((v, i) => {
          const isCurrent = i === current
          const isB = comparing && i === compareIndex
          const label = `v${i + 1}${v.note ? ` · ${v.note}` : ''}`
          return (
            <Tooltip key={v.id} content={label}>
              <button
                type="button"
                data-version-index={i}
                tabIndex={i === focusIndex ? 0 : -1}
                aria-pressed={comparing ? isB : isCurrent}
                aria-label={`Version ${i + 1} of ${count}${v.note ? `: ${v.note}` : ''}${isCurrent ? ' (current)' : ''}${isB ? ' (B)' : ''}`}
                onClick={() => pick(i)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className="group/frame flex shrink-0 flex-col items-center gap-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)"
              >
                <span
                  className={cn(
                    'relative block h-16 overflow-hidden rounded-[4px] bg-sunken transition-[box-shadow] duration-(--dur-1)',
                    isCurrent ? 'ring-2 ring-ink' : isB ? 'ring-2 ring-ink-3' : 'ring-1 ring-line-strong group-hover/frame:ring-ink-3',
                  )}
                  style={{ width: frameWidth }}
                >
                  <AssetThumb asset={asset} index={i} tiny />
                  {(isCurrent || isB) && comparing && (
                    <span className="type-meta-caps absolute top-1 left-1 grid size-4 place-items-center rounded-xs bg-overlay text-ink">{isCurrent ? 'A' : 'B'}</span>
                  )}
                </span>
                <span className={cn('type-meta tabular', isCurrent ? 'text-ink' : 'text-ink-3')}>v{i + 1}</span>
              </button>
            </Tooltip>
          )
        })}
        {asset.status === 'generating' && (
          <div className="flex shrink-0 flex-col items-center gap-1" aria-label={`Generating version ${count + 1}`} role="status">
            <span className="sim-hatch grid h-16 place-items-center rounded-[4px] border border-dashed border-line-input px-2" style={{ width: frameWidth }}>
              {run ? <StepTape run={run} size="xs" max={8} /> : null}
            </span>
            <span className="type-meta text-live-ink tabular">v{count + 1}</span>
          </div>
        )}
      </div>
    </section>
  )
}
