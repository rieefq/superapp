import { useEffect, useRef, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Copy, Image as ImageIcon, LayoutList, Plus, Presentation, Quote, Columns2, Heading, Trash2 } from 'lucide-react'
import { updateAssetContent, versionContent } from '@/core/services/studio'
import type { Asset, Slide } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, IconButton, Input, SegmentedControl, Textarea, toast } from '@/ui'
import { addSlideAfter, duplicateSlide, moveSlide, removeSlide } from '../logic'
import { SlideView, previewSpec } from '../previews'
import { FailedCard, GeneratingCard, SideLabel, UnrecordedCard, isUnrecorded } from './common'
import { useVersionDraft } from './useVersionDraft'

/*
 * The deck editor (§6.8): outline · 16:9 slide · fields (title, layout, body, notes). Edits apply to
 * the version on screen and autosave. Present starts from the selected slide.
 */

const LAYOUTS: { value: Slide['layout']; label: string; icon: typeof Heading }[] = [
  { value: 'title', label: 'Title', icon: Heading },
  { value: 'bullets', label: 'Bullets', icon: LayoutList },
  { value: 'quote', label: 'Quote', icon: Quote },
  { value: 'image', label: 'Image', icon: ImageIcon },
  { value: 'split', label: 'Split', icon: Columns2 },
]

export interface DeckStageProps {
  asset: Asset
  index: number
  compareIndex: number | null
  /** Present from a slide. */
  onPresent: (slide: number) => void
  /** The selected slide (shared with the header's Present button). */
  selected: number
  onSelect: (slide: number) => void
}

export function DeckStage({ asset, index, compareIndex, onPresent, selected, onSelect }: DeckStageProps) {
  const version = asset.versions[index]
  const { slides } = versionContent(asset, index)
  if (compareIndex !== null) return <DeckCompare asset={asset} index={index} compareIndex={compareIndex} />
  if (!slides?.length) {
    return (
      <div className="sim-hatch grid aspect-video w-full max-w-[860px] place-items-center rounded-md border border-dashed border-line-input">
        {asset.status === 'generating' ? (
          <GeneratingCard asset={asset} />
        ) : asset.status === 'failed' ? (
          <FailedCard asset={asset} />
        ) : isUnrecorded(asset, index) ? (
          <UnrecordedCard asset={asset} index={index} />
        ) : (
          <p className="type-body-sm text-ink-3">This deck has no slides yet.</p>
        )}
      </div>
    )
  }
  return (
    <DeckEditor
      key={version?.id ?? 'working'}
      asset={asset}
      versionId={version?.id}
      initial={slides}
      selected={selected}
      onSelect={onSelect}
      onPresent={onPresent}
    />
  )
}

function DeckEditor({
  asset,
  versionId,
  initial,
  selected,
  onSelect,
  onPresent,
}: {
  asset: Asset
  versionId: string | undefined
  initial: Slide[]
  selected: number
  onSelect: (i: number) => void
  onPresent: (i: number) => void
}) {
  const generating = asset.status === 'generating'
  const [slides, setSlides] = useVersionDraft<Slide[]>(initial, (value) => updateAssetContent(asset.id, { slides: value }, { versionId }))
  const sel = Math.max(0, Math.min(slides.length - 1, selected))
  const slide = slides[sel]
  const spec = previewSpec(asset.versions.find((v) => v.id === versionId)?.preview)
  const palette = spec?.palette ?? []
  const outlineRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (selected !== sel) onSelect(sel)
  }, [selected, sel, onSelect])

  const patch = (p: Partial<Slide>) => setSlides(slides.map((s, i) => (i === sel ? { ...s, ...p } : s)))
  const apply = (r: { slides: Slide[]; at: number }) => {
    setSlides(r.slides)
    onSelect(r.at)
  }
  const del = () => {
    if (slides.length <= 1) return
    const before = slides
    const removed = slides[sel]
    apply(removeSlide(slides, sel))
    toast({
      title: `Deleted slide ${sel + 1}`,
      description: `“${removed.title}”`,
      action: {
        label: 'Undo',
        onClick: () => {
          setSlides(before)
          onSelect(sel)
        },
      },
    })
  }

  const onOutlineKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const delta = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!delta && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    e.stopPropagation()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? slides.length - 1 : Math.max(0, Math.min(slides.length - 1, i + delta))
    onSelect(next)
    outlineRef.current?.querySelector<HTMLElement>(`[data-slide-index="${next}"]`)?.focus({ preventScroll: true })
  }

  // Keep the selected slide in view inside the outline (never scrolls the page).
  useEffect(() => {
    const list = outlineRef.current
    const el = list?.querySelector<HTMLElement>(`[data-slide-index="${sel}"]`)?.parentElement
    if (!list || !el) return
    const horizontal = list.scrollWidth > list.clientWidth + 1
    if (horizontal) {
      const left = el.offsetLeft - list.offsetLeft
      if (left < list.scrollLeft) list.scrollLeft = left
      else if (left + el.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = left + el.offsetWidth - list.clientWidth
    } else {
      const top = el.offsetTop - list.offsetTop
      if (top < list.scrollTop) list.scrollTop = top
      else if (top + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + el.offsetHeight - list.clientHeight
    }
  }, [sel])

  const readOnly = generating
  return (
    <div className="grid w-full max-w-[1280px] grid-cols-1 gap-5 lg:grid-cols-[208px_minmax(0,1fr)]">
      <nav aria-label="Slides" className="flex min-w-0 flex-col gap-2">
        <div className="flex h-7 items-center gap-2">
          <h2 className="type-label text-ink-3">Outline</h2>
          <span className="type-meta text-ink-3 tabular">{slides.length}</span>
        </div>
        <ol
          ref={outlineRef}
          className="no-scrollbar -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-1 lg:max-h-[min(70vh,760px)] lg:flex-col lg:overflow-x-visible lg:overflow-y-auto"
        >
          {slides.map((s, i) => (
            <li key={s.id} className="shrink-0 lg:shrink">
              <button
                type="button"
                data-slide-index={i}
                tabIndex={i === sel ? 0 : -1}
                aria-current={i === sel ? 'true' : undefined}
                aria-label={`Slide ${i + 1}: ${s.title}`}
                onClick={() => onSelect(i)}
                onDoubleClick={() => onPresent(i)}
                onKeyDown={(e) => onOutlineKey(e, i)}
                className={cn(
                  'group/slide flex w-36 items-start gap-2 rounded-sm p-1 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-ring) lg:w-full',
                  i === sel ? 'bg-accent-tint' : 'hover:bg-hover',
                )}
              >
                <span className={cn('type-meta w-4 shrink-0 pt-0.5 text-right tabular', i === sel ? 'text-ink' : 'text-ink-3')}>{i + 1}</span>
                <span className={cn('block min-w-0 flex-1 overflow-hidden rounded-[3px]', i === sel ? 'ring-2 ring-ink' : 'ring-1 ring-line-strong')}>
                  <SlideView slide={s} index={i} total={slides.length} palette={palette} thumb />
                </span>
              </button>
            </li>
          ))}
        </ol>
        <Button size="sm" variant="ghost" leadingIcon={Plus} onClick={() => apply(addSlideAfter(slides, sel))} disabled={readOnly} className="self-start">
          Add slide
        </Button>
      </nav>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="sim-hatch rounded-md border border-dashed border-line-input p-2">
          <div className="relative overflow-hidden rounded-sm">
            {slide && <SlideView slide={slide} index={sel} total={slides.length} palette={palette} spec={spec} />}
            {generating && (
              <div className="absolute inset-0 grid place-items-center bg-overlay/60 p-4">
                <GeneratingCard asset={asset} />
              </div>
            )}
          </div>
        </div>
        {slide && (
          <section aria-label={`Edit slide ${sel + 1}`} className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="type-label text-ink-3">Slide {sel + 1} of {slides.length}</h2>
              <span className="flex-1" />
              <IconButton icon={ArrowUp} label="Move slide up" size="sm" disabled={readOnly || sel === 0} onClick={() => apply(moveSlide(slides, sel, -1))} />
              <IconButton icon={ArrowDown} label="Move slide down" size="sm" disabled={readOnly || sel === slides.length - 1} onClick={() => apply(moveSlide(slides, sel, 1))} />
              <IconButton icon={Copy} label="Duplicate slide" size="sm" disabled={readOnly} onClick={() => apply(duplicateSlide(slides, sel))} />
              <IconButton icon={Trash2} label="Delete slide" size="sm" disabled={readOnly || slides.length <= 1} onClick={del} />
              <Button size="sm" variant="secondary" leadingIcon={Presentation} onClick={() => onPresent(sel)}>
                Present from here
              </Button>
            </div>
            {readOnly && <p className="type-caption text-ink-3">Editing pauses while v{asset.versions.length + 1} generates; it opens as a new version.</p>}
            <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <label className="flex min-w-0 flex-col gap-1.5">
                <span className="type-caption text-ink-3">Title</span>
                <Input value={slide.title} onValueChange={(v) => patch({ title: v })} disabled={readOnly} aria-label="Slide title" />
              </label>
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="type-caption text-ink-3" id="studio-layout-label">
                  Layout
                </span>
                <SegmentedControl<Slide['layout']>
                  size="md"
                  aria-label="Slide layout"
                  value={slide.layout}
                  onValueChange={(v) => patch({ layout: v })}
                  disabled={readOnly}
                  options={LAYOUTS.map((l) => ({ value: l.value, label: l.label, icon: l.icon, iconOnly: true }))}
                />
              </div>
            </div>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="type-caption text-ink-3">Body · one point per line, “- ” for a bullet; a blank line splits the columns</span>
              <Textarea value={slide.body} onValueChange={(v) => patch({ body: v })} autosize minRows={3} maxRows={14} disabled={readOnly} aria-label="Slide body" />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="type-caption text-ink-3">Speaker notes</span>
              <Textarea value={slide.notes ?? ''} onValueChange={(v) => patch({ notes: v })} autosize minRows={2} maxRows={10} disabled={readOnly} aria-label="Speaker notes" />
            </label>
          </section>
        )}
      </div>
    </div>
  )
}

function DeckCompare({ asset, index, compareIndex }: { asset: Asset; index: number; compareIndex: number }) {
  const a = versionContent(asset, index)
  const b = versionContent(asset, compareIndex)
  const pa = previewSpec(asset.versions[index]?.preview)
  const pb = previewSpec(asset.versions[compareIndex]?.preview)
  const rows = Math.max(a.slides?.length ?? 0, b.slides?.length ?? 0)
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-3" aria-label="Compare versions">
      <div className="grid grid-cols-2 gap-4">
        <SideLabel side="A" index={index} current />
        <SideLabel side="B" index={compareIndex} />
      </div>
      {!b.known && <p className="type-caption text-ink-3">v{compareIndex + 1} predates per-version text in this build, so only its preview was kept.</p>}
      <ol className="flex flex-col gap-3">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="grid grid-cols-2 gap-4">
            {[a, b].map((side, k) => {
              const s = side.slides?.[i]
              return s ? (
                <div key={k} className="overflow-hidden rounded-sm ring-1 ring-line-strong">
                  <SlideView slide={s} index={i} total={side.slides!.length} palette={(k === 0 ? pa : pb)?.palette ?? []} spec={k === 0 ? pa : pb} />
                </div>
              ) : (
                <div key={k} className="grid aspect-video place-items-center rounded-sm border border-dashed border-line-strong">
                  <span className="type-caption text-ink-3">{side.known ? `No slide ${i + 1}` : '—'}</span>
                </div>
              )
            })}
          </li>
        ))}
      </ol>
    </div>
  )
}
