import { motion } from 'motion/react'
import { versionParams } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { ArtFrame, ProceduralArt, useReducedMotion } from '@/ui'
import { STYLE_OPTIONS } from '../kinds'
import { artLabel, assetAspect, previewSpec } from '../previews'
import { FailedCard, GeneratingCard, SideLabel } from './common'

/** True for a version that landed in the last few seconds: it *develops* (600ms fade). */
export function isFresh(asset: Asset, index: number): boolean {
  const v = asset.versions[index]
  return !!v && index === asset.versions.length - 1 && Date.now() - v.createdAt < 4000
}

/**
 * The image at fit size inside a hatched mat (simulated), with the version caption. While a new
 * version generates, the current one dims under the run card.
 */
export function ImagePreview({ asset, index, maxHeight = 'max(260px, min(100dvh - 500px, 720px))', overlay = true }: { asset: Asset; index: number; maxHeight?: string; overlay?: boolean }) {
  const reduced = useReducedMotion()
  const version = asset.versions[index]
  const spec = previewSpec(version?.preview)
  const ratio = assetAspect(asset, index)
  const params = versionParams(asset, index)
  const style = STYLE_OPTIONS.find((o) => o.value === params.style)?.label ?? String(params.style ?? spec?.style ?? '')
  const generating = overlay && asset.status === 'generating'
  const fresh = isFresh(asset, index)
  return (
    <div className="w-full" style={{ maxWidth: `calc(${maxHeight} * ${ratio})` }}>
      <div className="sim-hatch rounded-md border border-dashed border-line-input p-2">
        <ArtFrame aspect={ratio} simulated={asset.generator.simulated} radius="sm" caption={version ? `v${index + 1} · ${String(params.aspect ?? '')} · ${style}`.replace(/ · $/, '') : undefined}>
          {spec ? (
            <motion.div
              key={version!.id}
              className="absolute inset-0"
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: generating ? 0.35 : 1 }}
              transition={{ duration: reduced ? 0 : fresh ? 0.6 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <ProceduralArt spec={spec} title={artLabel(asset, index)} />
            </motion.div>
          ) : (
            <div aria-hidden className="sim-hatch absolute inset-0" />
          )}
          {overlay && (generating || asset.status === 'failed') && (
            <div className="absolute inset-0 grid place-items-center p-4">{generating ? <GeneratingCard asset={asset} /> : <FailedCard asset={asset} />}</div>
          )}
        </ArtFrame>
      </div>
    </div>
  )
}

export function ImageStage({ asset, index, compareIndex }: { asset: Asset; index: number; compareIndex: number | null }) {
  if (compareIndex === null) return <ImagePreview asset={asset} index={index} />
  return (
    <div className="grid w-full max-w-[1400px] grid-cols-1 gap-6 md:grid-cols-2" aria-label="Compare versions">
      <figure className="flex min-w-0 flex-col items-center gap-2">
        <ImagePreview asset={asset} index={index} maxHeight="max(200px, min(100dvh - 420px, 560px))" />
        <figcaption>
          <SideLabel side="A" index={index} current />
        </figcaption>
      </figure>
      <figure className="flex min-w-0 flex-col items-center gap-2">
        <ImagePreview asset={asset} index={compareIndex} maxHeight="max(200px, min(100dvh - 420px, 560px))" overlay={false} />
        <figcaption>
          <SideLabel side="B" index={compareIndex} />
        </figcaption>
      </figure>
    </div>
  )
}
