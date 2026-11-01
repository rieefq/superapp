import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { LensModule, LensProps } from '@/app/lens/types'
import { useRow, useRows } from '@/core/db'
import { setCurrentVersion, versionParams } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { EntityChip, SimBadge } from '@/ui'
import { KINDS, PARAM_LABELS, paramDisplay } from './kinds'
import { AssetThumb, assetAspect } from './previews'

/**
 * Studio's Lens renderers (§5.4.8): `asset` and `board`, at panel density (Inspector › Item body:
 * the Inspector adds Links and History) and card density (hover cards and the ⌘K preview).
 */

function Thumb({ asset, maxHeight, className }: { asset: Asset; maxHeight: number; className?: string }) {
  const ratio = assetAspect(asset)
  return (
    <div className={cn('sim-hatch relative grid place-items-center rounded-sm border border-dashed border-line-input p-1.5', className)}>
      <div className="relative w-full overflow-hidden rounded-[3px] ring-1 ring-line-strong" style={{ aspectRatio: String(ratio), maxWidth: maxHeight * ratio }}>
        {asset.versions.length ? <AssetThumb asset={asset} /> : <div aria-hidden className="absolute inset-0 bg-sunken" />}
      </div>
      {asset.generator.simulated && (
        <span className="absolute bottom-1.5 left-1.5">
          <SimBadge size="xs" noTooltip />
        </span>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-3">
      <dt className="type-caption text-ink-3">{label}</dt>
      <dd className="type-body-sm min-w-0 text-ink-2">{children}</dd>
    </div>
  )
}

function AssetPanel({ entity }: LensProps) {
  const asset = useRow('assets', entity.id)
  if (!asset) return null
  const info = KINDS[asset.kind]
  const params = versionParams(asset)
  const facts = Object.keys(PARAM_LABELS)
    .map((k) => [PARAM_LABELS[k], paramDisplay(k, params[k])] as const)
    .filter((x): x is readonly [string, string] => !!x[1])
  const current = asset.versions[asset.currentVersion]
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <Thumb asset={asset} maxHeight={200} />
      <section aria-label="Prompt" className="flex flex-col gap-1">
        <h3 className="type-label text-ink-3">Prompt</h3>
        <p className="type-body-sm text-pretty text-ink-2">{current?.prompt ?? asset.prompt}</p>
      </section>
      <dl className="flex flex-col gap-2">
        <Row label="Kind">{info.label}</Row>
        <Row label="Generator">
          <span className="inline-flex flex-wrap items-center gap-1.5">
            {asset.generator.label}
            {asset.generator.simulated && <SimBadge size="xs" />}
          </span>
          {asset.generator.simulated && <span className="type-caption mt-0.5 block text-ink-3">{info.simulatedLine}.</span>}
        </Row>
        {facts.length > 0 && <Row label="Params">{facts.map(([l, v]) => `${l} ${v}`).join(' · ')}</Row>}
        {current?.preview.type === 'procedural' && (
          <Row label="Seed">
            <span className="type-meta tabular">#{current.preview.seed}</span>
          </Row>
        )}
        <Row label="Board">{asset.boardId ? <EntityChip entity={{ kind: 'board', id: asset.boardId }} size="sm" /> : 'None'}</Row>
        {asset.tags.length > 0 && <Row label="Tags">{asset.tags.join(', ')}</Row>}
      </dl>
      {asset.versions.length > 0 && (
        <section aria-label="Versions" className="flex flex-col gap-1.5">
          <h3 className="type-label flex items-center gap-1.5 text-ink-3">
            Versions <span className="type-meta font-normal tracking-normal normal-case">{asset.versions.length}</span>
          </h3>
          <ol className="flex flex-col">
            {asset.versions.map((v, i) => {
              const isCurrent = i === asset.currentVersion
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setCurrentVersion(asset.id, i)}
                    aria-pressed={isCurrent}
                    className={cn(
                      '-mx-1.5 flex min-h-8 w-[calc(100%+12px)] items-baseline gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-(--dur-1) hover:bg-hover',
                      isCurrent && 'bg-accent-tint',
                    )}
                  >
                    <span className={cn('type-meta w-6 shrink-0 tabular', isCurrent ? 'text-ink' : 'text-ink-3')}>v{i + 1}</span>
                    <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2">{v.note ?? (isCurrent ? 'Current' : 'Version')}</span>
                    <span className="type-meta shrink-0 text-ink-3">{timeAgo(v.createdAt).replace(' ago', '')}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      )}
      <Link
        to={`/studio/${encodeURIComponent(asset.id)}`}
        className="type-caption self-start rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
      >
        Open in Studio
      </Link>
    </div>
  )
}

function AssetCard({ entity }: LensProps) {
  const asset = useRow('assets', entity.id)
  if (!asset) return null
  const info = KINDS[asset.kind]
  return (
    <div className="flex flex-col gap-2 px-3 pt-1 pb-2">
      <Thumb asset={asset} maxHeight={140} />
      <p className="type-meta text-ink-3">
        {info.label} · {asset.versions.length ? `v${asset.currentVersion + 1} of ${asset.versions.length}` : asset.status === 'generating' ? 'generating' : 'no versions'} ·{' '}
        {asset.generator.label}
      </p>
      {asset.generator.simulated && <p className="type-caption text-ink-3">{info.simulatedLine}.</p>}
    </div>
  )
}

function useBoardAssets(boardId: string) {
  return useRows('assets', (a) => a.boardId === boardId, (a, b) => b.updatedAt - a.updatedAt)
}

function BoardPanel({ entity }: LensProps) {
  const board = useRow('boards', entity.id)
  const assets = useBoardAssets(entity.id)
  const counts = useMemo(() => {
    const out = new Map<string, number>()
    for (const a of assets) out.set(KINDS[a.kind].plural, (out.get(KINDS[a.kind].plural) ?? 0) + 1)
    return [...out.entries()]
  }, [assets])
  if (!board) return null
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      {board.description && <p className="type-body-sm text-ink-2">{board.description}</p>}
      <dl className="flex flex-col gap-2">
        <Row label="Assets">{assets.length ? counts.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(' · ') : 'Empty'}</Row>
        <Row label="Project">{board.projectId ? <EntityChip entity={{ kind: 'project', id: board.projectId }} size="sm" /> : 'None'}</Row>
      </dl>
      {assets.length > 0 && (
        <ul className="grid grid-cols-3 gap-1.5" aria-label="On this board">
          {assets.slice(0, 9).map((a) => (
            <li key={a.id}>
              <Link
                to={`/studio/${encodeURIComponent(a.id)}`}
                aria-label={`${a.title} (${KINDS[a.kind].label})`}
                className="sim-hatch relative grid aspect-square place-items-center overflow-hidden rounded-xs border border-dashed border-line-input p-1 outline-none focus-visible:outline-2 focus-visible:outline-(--focus-ring)"
              >
                <span className="relative block max-h-full w-full overflow-hidden rounded-[2px]" style={{ aspectRatio: String(assetAspect(a)) }}>
                  {a.versions.length ? <AssetThumb asset={a} tiny /> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        to={`/studio?board=${encodeURIComponent(board.id)}`}
        className="type-caption self-start rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
      >
        Open the board
      </Link>
    </div>
  )
}

function BoardCard({ entity }: LensProps) {
  const assets = useBoardAssets(entity.id)
  return (
    <div className="flex flex-col gap-2 px-3 pt-1 pb-2">
      <div className="grid grid-cols-3 gap-1">
        {assets.slice(0, 3).map((a) => (
          <span key={a.id} className="sim-hatch relative grid aspect-square place-items-center overflow-hidden rounded-xs border border-dashed border-line-input p-1">
            <span className="relative block max-h-full w-full overflow-hidden rounded-[2px]" style={{ aspectRatio: String(assetAspect(a)) }}>
              {a.versions.length ? <AssetThumb asset={a} tiny /> : null}
            </span>
          </span>
        ))}
      </div>
      <p className="type-meta text-ink-3">
        {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
      </p>
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  asset: { panel: AssetPanel, card: AssetCard },
  board: { panel: BoardPanel, card: BoardCard },
}
