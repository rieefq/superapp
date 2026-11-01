import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import {
  ArrowLeft, Copy, Download, FolderInput, Hash, Layers, Link2, Presentation, RotateCcw, Shuffle, Square, Star, Trash2,
} from 'lucide-react'
import { HoldButton, SaveToKnowledgeButton, TurnIntoMenu } from '@/app/components'
import { switchScope } from '@/app/shell/scope'
import { useScope } from '@/core/context'
import { useConnections } from '@/core/services/links'
import { useRegisterCommands } from '@/app/commands/registry'
import { announce } from '@/app/shell/Announcer'
import { Stage, StageHeader, useInspectEntity } from '@/app/templates'
import { useDB, type Tables } from '@/core/db'
import { useRun } from '@/core/runs'
import {
  createVariation, renameAsset, retryGeneration, setCurrentVersion, stopGeneration, toggleFavorite, versionContent,
} from '@/core/services/studio'
import { useSettings } from '@/core/settings'
import type { Asset, EntityRef } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import {
  Button, EmptyState, EntityChip, ErrorState, IconButton, KindTile, RunStatusBadge, StepTape, isTypingTarget, toast, type MenuItem,
} from '@/ui'
import { confirmDeleteAsset, downloadItems, exportFormats, MoveToBoardDialog } from './actions'
import { Filmstrip } from './Filmstrip'
import { SimulatedNote } from './honesty'
import { KINDS } from './kinds'
import { Presenter } from './Presenter'
import { previewSpec } from './previews'
import { AudioStage } from './stages/AudioStage'
import { LightTable } from './stages/common'
import { DeckStage } from './stages/DeckStage'
import { DocStage } from './stages/DocStage'
import { ImageStage } from './stages/ImageStage'
import { ShotList, VideoStage } from './stages/VideoStage'
import { IterateBar, VersionDetails } from './VersionPanel'
import { useStudioView } from './view'

/**
 * The asset view (`/studio/:assetId`, §6.8): the version at fit size on the light table, the honest
 * "Simulated generator" line, the version filmstrip (← → / 1–9, A/B compare), the version's prompt,
 * params and Colophon, entity actions (Hold · Save to Knowledge · Turn into…) and the Iterate composer.
 */
export function AssetView() {
  const { assetId: raw } = useParams()
  const assetId = raw ? decodeURIComponent(raw) : undefined
  const asset = useDB((s: Tables) => (assetId ? s.assets[assetId] : undefined))
  const navigate = useNavigate()
  const view = useStudioView()
  if (!asset) {
    return (
      <Stage header={<StageHeader title="Asset not found" backTo={view.href()} />}>
        <EmptyState
          title="This asset doesn’t exist"
          description="It may have been deleted. Links to it elsewhere show “Deleted item”."
          actions={
            <Button leadingIcon={ArrowLeft} onClick={() => navigate(view.href())}>
              Back to Studio
            </Button>
          }
          className="py-16"
        />
      </Stage>
    )
  }
  return (
    <AssetBoundary key={asset.id}>
      <AssetPage asset={asset} />
    </AssetBoundary>
  )
}

function AssetPage({ asset }: { asset: Asset }) {
  const navigate = useNavigate()
  const view = useStudioView()
  const inspect = useInspectEntity()
  const ref = useMemo<EntityRef>(() => ({ kind: 'asset', id: asset.id }), [asset.id])
  const info = KINDS[asset.kind]
  const board = useDB((s: Tables) => (asset.boardId ? s.boards[asset.boardId] : undefined))
  const project = useDB((s: Tables) => (asset.projectId ? s.projects[asset.projectId] : undefined))
  const scope = useScope()
  const origins = useConnections(ref).filter((c) => c.link.rel === 'derived_from' && c.direction === 'outgoing')
  const run = useRun(asset.status === 'generating' ? asset.runId : undefined)
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  const [comparing, setComparing] = useState(false)
  const [compareIndex, setCompareIndex] = useState<number | null>(null)
  const [moving, setMoving] = useState(false)
  const [presenting, setPresenting] = useState<number | null>(null)
  const [slide, setSlide] = useState(0)
  const actionsRef = useRef<HTMLDivElement>(null)
  const generating = asset.status === 'generating'
  const index = asset.currentVersion
  const count = asset.versions.length
  const backTo = view.href({ place: board ? { type: 'board', id: board.id } : { type: 'all' } })

  // B defaults to the previous version; compare ends when there is nothing to compare.
  useEffect(() => {
    if (!comparing) return
    if (count < 2) {
      setComparing(false)
      setCompareIndex(null)
    } else if (compareIndex === null || compareIndex === index || compareIndex >= count) setCompareIndex(index > 0 ? index - 1 : 1)
  }, [comparing, compareIndex, index, count])

  const toggleCompare = () => {
    setComparing((c) => !c)
    setCompareIndex(null)
  }

  // ← → switch versions and 1–9 pick one, from anywhere on the page (not while typing or inside a player).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || !singleKeys || presenting !== null) return
      const target = e.target as HTMLElement | null
      if (isTypingTarget(target) || target?.closest?.('[data-studio-keys-local], [role="dialog"], [role="menu"], [role="listbox"], [role="slider"], [role="radiogroup"]')) return
      if (document.querySelector('[data-layer][aria-modal="true"]')) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const next = index + (e.key === 'ArrowRight' ? 1 : -1)
        if (next < 0 || next >= count) return
        e.preventDefault()
        setCurrentVersion(asset.id, next)
        announce(`Version ${next + 1} of ${count}`)
      } else if (/^[1-9]$/.test(e.key)) {
        const next = Number(e.key) - 1
        if (next >= count) return
        e.preventDefault()
        setCurrentVersion(asset.id, next)
        announce(`Version ${next + 1} of ${count}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [asset.id, index, count, singleKeys, presenting])

  const variation = () => {
    const r = createVariation(asset.id)
    if (r) announce(`Generating a variation of “${asset.title}”`)
  }
  const remove = async () => {
    if (await confirmDeleteAsset(asset)) navigate(backTo, { replace: true })
  }
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `${what} copied` })
    } catch {
      toast({ tone: 'error', title: `Couldn’t copy the ${what.toLowerCase()}` })
    }
  }
  const slides = asset.kind === 'presentation' ? (versionContent(asset, index).slides ?? []) : []
  const present = (from = slide) => {
    if (!slides.length) return
    setPresenting(Math.max(0, Math.min(slides.length - 1, from)))
  }

  const menu: MenuItem[] = [
    { id: 'favorite', label: asset.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, onSelect: () => toggleFavorite(asset.id) },
    { id: 'move', label: 'Move to board…', icon: FolderInput, onSelect: () => setMoving(true) },
    { id: 'inspect', label: 'Inspect', icon: Layers, onSelect: () => inspect(ref) },
    ...(exportFormats(asset).length ? [{ type: 'separator' as const }, ...downloadItems(asset)] : []),
    { type: 'separator' },
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copy(`${window.location.origin}/studio/${encodeURIComponent(asset.id)}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Hash, onSelect: () => void copy(shortCode(asset.id), 'Handle') },
    { type: 'separator' },
    { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void remove() },
  ]

  useRegisterCommands('studio.asset', [
    ...(count && !generating ? [{ id: 'studio.asset.variation', title: `Create a variation of “${asset.title}”`, icon: Shuffle, group: 'Studio', keywords: ['variation', 'again', 'new version'], run: (ctx: { close: () => void }) => (ctx.close(), variation()) }] : []),
    ...(generating ? [{ id: 'studio.asset.stop', title: 'Stop generating', icon: Square, group: 'Studio', keywords: ['cancel'], run: (ctx: { close: () => void }) => (ctx.close(), stopGeneration(asset.id)) }] : []),
    ...(asset.kind === 'presentation' && slides.length ? [{ id: 'studio.asset.present', title: `Present “${asset.title}”`, icon: Presentation, group: 'Studio', keywords: ['slides', 'fullscreen', 'deck'], run: (ctx: { close: () => void }) => (ctx.close(), present(0)) }] : []),
    { id: 'studio.asset.favorite', title: asset.favorite ? 'Remove from favorites' : 'Add to favorites', icon: Star, group: 'Studio', keywords: ['star', 'favorite'], run: (ctx) => (ctx.close(), toggleFavorite(asset.id)) },
    { id: 'studio.asset.move', title: 'Move to board…', icon: FolderInput, group: 'Studio', keywords: ['board', 'file'], run: (ctx) => (ctx.close(), setMoving(true)) },
    ...(count > 1 ? [{ id: 'studio.asset.compare', title: comparing ? 'Stop comparing versions' : 'Compare versions (A/B)', icon: Copy, group: 'Studio', keywords: ['diff', 'versions'], run: (ctx: { close: () => void }) => (ctx.close(), toggleCompare()) }] : []),
    ...downloadItems(asset).map((d) => ({
      id: `studio.asset.${'id' in d ? d.id : 'download'}`,
      title: 'label' in d ? d.label : 'Download',
      icon: Download,
      group: 'Studio',
      keywords: ['export', 'download', 'file'],
      run: (ctx: { close: () => void }) => {
        ctx.close()
        if ('onSelect' in d) d.onSelect?.()
      },
    })),
    { id: 'studio.asset.delete', title: `Delete “${asset.title}”…`, icon: Trash2, group: 'Studio', keywords: ['remove'], run: (ctx) => (ctx.close(), void remove()) },
  ])

  const status = generating ? (
    <span className="flex items-center gap-2">
      <RunStatusBadge status="running" />
      {run && <StepTape run={run} size="sm" max={10} className="hidden sm:inline-flex" />}
    </span>
  ) : asset.status === 'failed' ? (
    <RunStatusBadge status="failed" />
  ) : null

  const actions = (
    <>
      {asset.kind === 'presentation' && slides.length > 0 && (
        <Button size="sm" variant="primary" leadingIcon={Presentation} onClick={() => present(slide)} aria-label="Present (full screen)">
          <span className="max-sm:sr-only">Present</span>
        </Button>
      )}
      {asset.status === 'failed' ? (
        <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={() => retryGeneration(asset.id)} aria-label="Retry">
          <span className="max-sm:sr-only">Retry</span>
        </Button>
      ) : (
        <Button size="sm" variant={asset.kind === 'presentation' ? 'ghost' : 'secondary'} leadingIcon={Shuffle} onClick={variation} disabled={generating || !count} aria-label="Variation">
          <span className="max-sm:sr-only">Variation</span>
        </Button>
      )}
      <IconButton
        icon={Star}
        label={asset.favorite ? 'Remove from favorites' : 'Add to favorites'}
        size="sm"
        active={!!asset.favorite}
        onClick={() => toggleFavorite(asset.id)}
        className={cn(asset.favorite && '[&_svg]:fill-current')}
      />
    </>
  )

  const textual = asset.kind === 'presentation' || asset.kind === 'document' || asset.kind === 'audio' || asset.kind === 'video'
  const shown = comparing ? compareIndex : null

  return (
    <Stage
      primary={ref}
      header={
        <StageHeader
          leading={<KindTile kind="asset" icon={iconName(asset)} size={20} simulated={asset.generator.simulated} />}
          title={asset.title}
          onRename={(t) => renameAsset(asset.id, t)}
          status={status}
          actions={actions}
          menu={menu}
          backTo={backTo}
        />
      }
      composer={<IterateBar asset={asset} />}
      measure={1120}
      padded={false}
    >
      <LightTable className="justify-center">
        {asset.kind === 'image' && <ImageStage asset={asset} index={index} compareIndex={shown} />}
        {asset.kind === 'video' && <VideoStage asset={asset} index={index} compareIndex={shown} />}
        {asset.kind === 'presentation' && <DeckStage asset={asset} index={index} compareIndex={shown} onPresent={present} selected={slide} onSelect={setSlide} />}
        {asset.kind === 'document' && <DocStage asset={asset} index={index} compareIndex={shown} />}
        {asset.kind === 'audio' && <AudioStage asset={asset} index={index} compareIndex={shown} />}
        {asset.generator.simulated && <SimulatedNote kind={asset.kind} className="justify-center text-center" />}
      </LightTable>
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 py-6 md:px-6">
        {count > 0 ? (
          <Filmstrip asset={asset} comparing={comparing} compareIndex={compareIndex} onCompareIndex={setCompareIndex} onToggleCompare={toggleCompare} />
        ) : null}
        {count > 0 && <VersionDetails asset={asset} index={index} />}
        <div ref={actionsRef} className="flex min-w-0 flex-wrap items-center gap-1.5 border-t border-line pt-4" aria-label="Use this asset" role="group">
          <HoldButton entity={ref} hotkeyScope={actionsRef} />
          {textual && count > 0 && <SaveToKnowledgeButton entity={ref} hotkeyScope={actionsRef} />}
          <TurnIntoMenu entity={ref} hotkeyScope={actionsRef} />
        </div>
        <dl className="type-caption -mt-3 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-ink-3">
          <div className="flex min-w-0 items-center gap-2">
            <dt>Board</dt>
            <dd className="min-w-0">
              {board ? (
                <button
                  type="button"
                  onClick={() => navigate(backTo)}
                  className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
                >
                  {board.name}
                </button>
              ) : (
                <button type="button" onClick={() => setMoving(true)} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
                  None · Move to board…
                </button>
              )}
            </dd>
          </div>
          {project && (
            <div className="flex min-w-0 items-center gap-2">
              <dt>Project</dt>
              <dd className="flex min-w-0 items-center gap-1.5">
                <EntityChip entity={{ kind: 'project', id: project.id }} size="sm" />
                {scope && scope !== project.id && (
                  <>
                    <span>From {project.name} ·</span>
                    <button type="button" onClick={() => switchScope(project.id)} className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink">
                      Switch project
                    </button>
                  </>
                )}
              </dd>
            </div>
          )}
          {origins.length > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              <dt>Came from</dt>
              <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
                {origins.slice(0, 3).map((c) => (
                  <EntityChip key={`${c.other.kind}:${c.other.id}`} entity={c.other} size="sm" />
                ))}
              </dd>
            </div>
          )}
        </dl>
        {asset.kind === 'video' && !comparing && count > 0 && <ShotList asset={asset} index={index} />}
        {count === 0 && !generating && asset.status !== 'failed' && (
          <p className="type-body-sm text-ink-3">{info.label} with no versions yet.</p>
        )}
      </div>
      <MoveToBoardDialog assetId={moving ? asset.id : null} onClose={() => setMoving(false)} />
      {presenting !== null && slides.length > 0 && (
        <Presenter
          title={asset.title}
          slides={slides}
          palette={previewSpec(asset.versions[index]?.preview)?.palette ?? []}
          spec={previewSpec(asset.versions[index]?.preview)}
          start={presenting}
          simulated={asset.generator.simulated}
          onClose={(last) => {
            setPresenting(null)
            setSlide(last)
          }}
        />
      )}
    </Stage>
  )
}

function iconName(asset: Asset): string {
  return { image: 'Image', video: 'Clapperboard', presentation: 'Presentation', document: 'FileText', audio: 'AudioLines' }[asset.kind]
}

class AssetBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[studio] asset view failed', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <Stage header={<StageHeader title="Couldn’t show this asset" />}>
          <ErrorState
            title="Couldn’t show this asset"
            message="Part of this view failed to render. The asset and its versions are safe."
            details={this.state.error.stack ?? this.state.error.message}
            onRetry={() => this.setState({ error: null })}
            className="py-12"
          />
        </Stage>
      )
    }
    return this.props.children
  }
}
