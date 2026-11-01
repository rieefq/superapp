import { createElement, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import type { AssetPreview } from '@/core/types'
import { cn } from '@/lib/cn'
import { buildArt, type ProceduralSpec, type SvgNode } from './generate'

type ProceduralPreview = Extract<AssetPreview, { type: 'procedural' }>

const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())

function toReact(node: SvgNode, key?: number): ReactNode {
  const props: Record<string, unknown> = { key }
  for (const [k, v] of Object.entries(node.attrs)) {
    if (v === undefined || k === 'xmlns') continue
    if (k === 'blend') props.style = { mixBlendMode: v } as CSSProperties
    else props[k.includes('-') ? camel(k) : k] = v
  }
  return createElement(node.tag, props, ...node.children.map((c, i) => (typeof c === 'string' ? c : toReact(c, i))))
}

/** "16/9", "4:5", "1.5" or a number → width / height. */
export function parseAspect(aspect: number | string | undefined): number | undefined {
  if (aspect === undefined) return undefined
  if (typeof aspect === 'number') return aspect > 0 ? aspect : undefined
  const m = /^\s*([\d.]+)\s*[/:x]\s*([\d.]+)\s*$/.exec(aspect)
  if (m) {
    const a = Number(m[1]) / Number(m[2])
    return Number.isFinite(a) && a > 0 ? a : undefined
  }
  const v = Number(aspect)
  return Number.isFinite(v) && v > 0 ? v : undefined
}

export interface ProceduralArtProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  /** A procedural preview (from an Asset version) or a bare spec. */
  spec: ProceduralSpec | ProceduralPreview
  /** Fixed aspect (w/h, "16/9", "4:5"). Omit to fill the parent box and re-flow to its shape. */
  aspect?: number | string
  /** Accessible description of the artwork. */
  title?: string
}

/**
 * Deterministic generative artwork for a procedural preview — re-composed (not stretched)
 * for the frame's aspect ratio, with unique gradient/filter ids per instance.
 */
export function ProceduralArt({ spec, aspect, title, className, style, ...props }: ProceduralArtProps) {
  const fixed = parseAspect(aspect)
  const ref = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<number | undefined>(undefined)
  const uid = useId()

  useLayoutEffect(() => {
    if (fixed !== undefined) return
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        // Quantize so tiny resizes don't recompose the artwork.
        const q = Math.round(Math.log(r.width / r.height) * 20) / 20
        setMeasured((m) => (m !== undefined && Math.abs(Math.log(m) - q) < 1e-6 ? m : Math.exp(q)))
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fixed])

  const ratio = fixed ?? measured ?? 1
  const paletteKey = spec.palette.join(',')
  const tree = useMemo(
    () => buildArt({ seed: spec.seed, palette: spec.palette, style: spec.style }, ratio, `pa${uid}`),
    [spec.seed, paletteKey, spec.style, ratio, uid], // palette compared by value

  )

  const svg = useMemo(() => toReact(tree), [tree])

  return (
    <div
      ref={ref}
      role="img"
      aria-label={title ?? `Generated ${spec.style} artwork`}
      className={cn('relative overflow-hidden', fixed === undefined && 'h-full w-full', className)}
      style={{ ...(fixed !== undefined ? { aspectRatio: String(fixed) } : null), ...style }}
      {...props}
    >
      <div aria-hidden className="absolute inset-0 [&>svg]:block [&>svg]:size-full">
        {svg}
      </div>
    </div>
  )
}
