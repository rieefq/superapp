import { memo, useMemo, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import { versionContent, versionParams } from '@/core/services/studio'
import { narrationWaveform } from '@/core/sim/studio'
import type { Asset, AssetPreview, Slide } from '@/core/types'
import { cn } from '@/lib/cn'
import { ProceduralArt, type ProceduralSpec } from '@/ui'
import { KINDS } from './kinds'
import { aspectRatio, bodyBlocks, quoteParts, slideTheme, splitColumns, type SlideTheme } from './logic'

/*
 * Studio previews: procedural art, slides, document pages and narration waveforms — the same
 * renderers serve tiles, the filmstrip, the asset stage, Present mode and the Lens.
 */

type ProceduralPreview = Extract<AssetPreview, { type: 'procedural' }>

const FALLBACK_SPEC: ProceduralSpec = { seed: 7, palette: ['#1c1b18', '#55524a', '#b4b1a7', '#edebe5'], style: 'abstract' }

export function previewSpec(preview: AssetPreview | undefined): ProceduralSpec | undefined {
  return preview?.type === 'procedural' ? (preview as ProceduralPreview) : undefined
}

/** A derived spec (one storyboard shot, the slide visual) from a version's spec. */
export function shotSpec(spec: ProceduralSpec, index: number): ProceduralSpec {
  return { seed: (spec.seed + (index + 1) * 7919) >>> 0, palette: spec.palette, style: spec.style }
}

/** Accessible description of a procedural preview (always says it is simulated). */
export function artLabel(asset: Asset, index = asset.currentVersion): string {
  const style = String(versionParams(asset, index).style ?? previewSpec(asset.versions[index]?.preview)?.style ?? 'procedural')
  return `${asset.title}, v${index + 1}: procedural ${style} preview (simulated, not a model-generated image)`
}

// ------------------------------------------------------------------------------------------------ inline markdown

/** **bold** and _italic_ inside slide text. */
export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*([^*]+)\*\*|_([^_]+)_/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1] ? <strong key={k++} className="font-semibold">{m[1]}</strong> : <em key={k++}>{m[2]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function Blocks({ text, theme, className }: { text: string; theme: SlideTheme; className?: string }) {
  const blocks = bodyBlocks(text)
  return (
    <div className={cn('flex flex-col gap-[1.1cqw]', className)}>
      {blocks.map((b, i) =>
        b.type === 'bullet' ? (
          <p key={i} className="flex gap-[1.4cqw] text-[2.3cqw] leading-[1.45]">
            <span aria-hidden className="mt-[0.95cqw] size-[0.75cqw] shrink-0 rounded-[0.12cqw]" style={{ background: theme.accent }} />
            <span>{renderInline(b.text)}</span>
          </p>
        ) : (
          <p key={i} className="text-[2.3cqw] leading-[1.45]">
            {renderInline(b.text)}
          </p>
        ),
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ slide

export interface SlideViewProps {
  slide: Slide
  index: number
  total: number
  palette: readonly string[]
  /** The version's art, for image slides. */
  spec?: ProceduralSpec
  /** Tiny renders (thumbnails) skip the art and the page number. */
  thumb?: boolean
  className?: string
}

/**
 * One slide at 16:9 in the document voice, themed from the version's palette. Sizes are container
 * query units, so the same slide reads identically as a 64px thumbnail, in the editor and in Present.
 */
export const SlideView = memo(function SlideView({ slide, index, total, palette, spec, thumb, className }: SlideViewProps) {
  const theme = useMemo(() => slideTheme(palette), [palette])
  const art = spec && !thumb ? shotSpec(spec, index) : undefined
  return (
    <div
      className={cn('@container relative aspect-video w-full overflow-hidden font-serif select-text', className)}
      style={{ background: theme.background, color: theme.ink }}
      data-slide-layout={slide.layout}
    >
      {slide.layout === 'image' ? (
        <div className="absolute inset-0 grid grid-cols-[45%_55%]">
          <div className="flex min-w-0 flex-col justify-center gap-[2.4cqw] py-[6cqw] pr-[3.5cqw] pl-[7cqw]">
            <div aria-hidden className="h-[0.45cqw] w-[6cqw]" style={{ background: theme.accent }} />
            <h3 className="text-[4cqw] leading-[1.15] font-medium tracking-[-0.01em]">{slide.title}</h3>
            {slide.body.trim() && <Blocks text={slide.body} theme={theme} className="opacity-90" />}
          </div>
          <div className="relative min-w-0">
            {art ? (
              <ProceduralArt spec={art} className="absolute inset-0" title={`Slide visual: procedural ${art.style} preview (simulated)`} />
            ) : (
              <div aria-hidden className="absolute inset-[12%] opacity-80" style={{ background: theme.accent }} />
            )}
          </div>
        </div>
      ) : slide.layout === 'title' ? (
        <div className="absolute inset-0 flex flex-col justify-center gap-[2.4cqw] px-[8cqw]">
          <div aria-hidden className="h-[0.5cqw] w-[7cqw]" style={{ background: theme.accent }} />
          <h3 className="max-w-[80%] text-[6.2cqw] leading-[1.08] font-medium tracking-[-0.015em] text-balance">{slide.title}</h3>
          {slide.body.trim() && (
            <p className="max-w-[75%] text-[2.4cqw] leading-[1.4]" style={{ color: theme.muted }}>
              {renderInline(slide.body.replace(/\n+/g, ' · '))}
            </p>
          )}
        </div>
      ) : slide.layout === 'quote' ? (
        <QuoteSlide slide={slide} theme={theme} />
      ) : slide.layout === 'split' ? (
        <div className="absolute inset-0 flex flex-col gap-[3.4cqw] px-[7cqw] py-[6cqw]">
          <h3 className="text-[4.2cqw] leading-[1.15] font-medium tracking-[-0.01em]">{slide.title}</h3>
          <div className="grid flex-1 grid-cols-2 gap-[5cqw]">
            {splitColumns(slide.body).map((col, i) => (
              <div key={i} className="min-w-0 border-t-[0.25cqw] pt-[2cqw]" style={{ borderColor: i === 0 ? theme.accent : theme.muted }}>
                <Blocks text={col} theme={theme} />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col gap-[3.2cqw] px-[7cqw] py-[6cqw]">
          <h3 className="text-[4.2cqw] leading-[1.15] font-medium tracking-[-0.01em]">{slide.title}</h3>
          <Blocks text={slide.body} theme={theme} />
        </div>
      )}
      {!thumb && (
        <span aria-hidden className="absolute right-[3.5cqw] bottom-[3cqw] font-mono text-[1.35cqw] tabular" style={{ color: theme.muted }}>
          {index + 1} / {total}
        </span>
      )}
    </div>
  )
})

function QuoteSlide({ slide, theme }: { slide: Slide; theme: SlideTheme }) {
  const q = quoteParts(slide.body)
  return (
    <div className="absolute inset-0 flex flex-col justify-center px-[9cqw]">
      <span aria-hidden className="h-[6cqw] text-[10cqw] leading-[0.9]" style={{ color: theme.accent }}>
        “
      </span>
      <blockquote className="mt-[1cqw] text-[3.3cqw] leading-[1.35] italic text-pretty">{renderInline(q.quote)}</blockquote>
      {q.by && (
        <p className="mt-[2.6cqw] text-[1.9cqw]" style={{ color: theme.muted }}>
          — {q.by}
        </p>
      )}
      <p className="absolute bottom-[3cqw] left-[9cqw] font-sans text-[1.35cqw] tracking-[0.06em] uppercase" style={{ color: theme.muted }}>
        {slide.title}
      </p>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ doc page

/** A document thumbnail: a page in the document voice with the first heading and a few lines. */
export function DocPage({ content, className }: { content: string | undefined; className?: string }) {
  const { heading, lines } = useMemo(() => {
    const src = (content ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('>'))
    const h = src.find((l) => /^#{1,3}\s/.test(l))?.replace(/^#+\s*/, '') ?? src[0]?.replace(/[*_#]/g, '') ?? ''
    const body = src.filter((l) => !/^#{1,3}\s/.test(l)).slice(0, 7).map((l) => l.replace(/[*_#`[\]]/g, '').replace(/^[-\d.]+\s*/, ''))
    return { heading: h, lines: body }
  }, [content])
  return (
    <div className={cn('@container h-full w-full overflow-hidden bg-raised text-ink', className)}>
      <div className="flex h-full w-full flex-col gap-[5cqw] px-[9cqw] py-[10cqw]">
        <p className="line-clamp-3 font-serif text-[9cqw] leading-[1.15] font-medium text-pretty">{heading || 'Untitled'}</p>
        <div className="flex flex-col gap-[3.2cqw]">
          {lines.map((l, i) => (
            <p key={i} className="line-clamp-2 text-[5.2cqw] leading-[1.35] text-ink-3">
              {l}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ waveform

export interface WaveformProps {
  script: string | undefined
  bars?: number
  /** 0–1: the played part draws in ink. */
  progress?: number
  className?: string
  /** Bar color class for the unplayed part. */
  tone?: 'ink-3' | 'ink-4'
}

/** A narration envelope drawn from the script (deterministic; no audio exists). */
export const Waveform = memo(function Waveform({ script, bars = 72, progress = 0, className, tone = 'ink-3' }: WaveformProps) {
  const levels = useMemo(() => narrationWaveform(script ?? '', bars), [script, bars])
  const played = Math.round(progress * levels.length)
  return (
    <div aria-hidden className={cn('flex h-full w-full items-center gap-[2px]', className)}>
      {levels.map((v, i) => (
        <span
          key={i}
          className={cn('min-w-px flex-1 rounded-full transition-colors duration-(--dur-1)', i < played ? 'bg-ink' : tone === 'ink-4' ? 'bg-ink-4' : 'bg-ink-3')}
          style={{ height: `${Math.max(6, v * 100)}%` }}
        />
      ))}
    </div>
  )
})

// ------------------------------------------------------------------------------------------------ thumbnails

export interface AssetThumbProps {
  asset: Asset
  /** Version to show (default: current). */
  index?: number
  className?: string
  /** Extra-small renders (filmstrip). */
  tiny?: boolean
}

/**
 * The kind-aware thumbnail of a version: art at its own aspect for images and video, the first slide
 * for decks, a page for docs, a waveform card for narration. Fills its box (callers size it).
 */
export const AssetThumb = memo(function AssetThumb({ asset, index = asset.currentVersion, className, tiny }: AssetThumbProps) {
  const version = asset.versions[index]
  const spec = previewSpec(version?.preview)
  if (asset.kind === 'image' || asset.kind === 'video') {
    return spec ? <ProceduralArt spec={asset.kind === 'video' ? shotSpec(spec, 0) : spec} title={artLabel(asset, index)} className={cn('h-full w-full', className)} /> : <Blank className={className} />
  }
  const text = versionContent(asset, index)
  if (asset.kind === 'presentation') {
    const slide = text.slides?.[0]
    return slide ? (
      <SlideView slide={slide} index={0} total={text.slides!.length} palette={spec?.palette ?? FALLBACK_SPEC.palette} thumb className={className} />
    ) : (
      <Blank className={className} />
    )
  }
  if (asset.kind === 'document') return <DocPage content={text.content} className={className} />
  return (
    <div className={cn('@container h-full w-full bg-sunken', className)}>
      <div className="flex h-full w-full flex-col justify-between p-[7cqw]">
        {!tiny && (
          <span className="flex items-center gap-[3cqw] text-ink-3">
            <span className="grid size-[11cqw] min-h-4 min-w-4 place-items-center rounded-full border border-line-strong">
              <Play aria-hidden className="size-[5cqw] min-h-2 min-w-2 translate-x-[0.4cqw]" strokeWidth={2} />
            </span>
            <span className="truncate font-mono text-[5cqw]">{String(versionParams(asset, index).voice ?? KINDS.audio.label)}</span>
          </span>
        )}
        <div className={cn('w-full', tiny ? 'h-full' : 'h-[46%]')}>
          <Waveform script={text.content} bars={tiny ? 18 : 40} />
        </div>
      </div>
    </div>
  )
})

function Blank({ className }: { className?: string }) {
  return <div aria-hidden className={cn('sim-hatch h-full w-full', className)} />
}

/** The aspect a version is shown at in tiles and on the stage. */
export function assetAspect(asset: Asset, index = asset.currentVersion): number {
  switch (asset.kind) {
    case 'image':
      return aspectRatio(versionParams(asset, index).aspect, 1)
    case 'video':
      return aspectRatio(versionParams(asset, index).aspect, 16 / 9)
    case 'presentation':
      return 16 / 9
    case 'document':
      return 3 / 4
    case 'audio':
      return 16 / 9
  }
}
