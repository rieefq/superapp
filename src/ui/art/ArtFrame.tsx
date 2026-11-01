import type { HTMLAttributes, ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/cn'
import { SimTag } from '../display/internal'
import { parseAspect } from './ProceduralArt'

export interface ArtFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** Width / height ("16/9", "4:5", 1.5). Default 1. */
  aspect?: number | string
  /** Shows the hatched "Simulated preview" badge (honest labeling). */
  simulated?: boolean
  /** Replaces the default badge content. */
  badge?: ReactNode
  state?: 'ready' | 'generating' | 'failed'
  /** Overlay actions (top-right), revealed on hover / focus. */
  actions?: ReactNode
  /** Bottom caption overlay (e.g. version, size). */
  caption?: ReactNode
  radius?: 'sm' | 'md' | 'lg'
  children?: ReactNode
}

const RADIUS = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg' } as const

/** Preview container: aspect box, hairline edge, sim badge slot, generating/failed states. */
export function ArtFrame({
  aspect = 1,
  simulated = false,
  badge,
  state = 'ready',
  actions,
  caption,
  radius = 'md',
  className,
  style,
  children,
  ...props
}: ArtFrameProps) {
  const ratio = parseAspect(aspect) ?? 1
  const badgeNode =
    badge ??
    (simulated ? (
      <SimTag className="bg-sim-tint/95">
        <span className="@max-[239px]:hidden">Simulated preview</span>
        <span className="@min-[240px]:hidden">Simulated</span>
      </SimTag>
    ) : null)
  return (
    <div
      className={cn('group/art @container relative isolate w-full overflow-hidden bg-sunken', RADIUS[radius], className)}
      style={{ aspectRatio: String(ratio), ...style }}
      aria-busy={state === 'generating' || undefined}
      {...props}
    >
      <div className={cn('absolute inset-0 transition-opacity duration-(--dur-3) ease-settle', state !== 'ready' && 'opacity-35 saturate-50')}>{children}</div>
      {state === 'generating' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div aria-hidden className="atr-skeleton absolute inset-0 opacity-70 [background-color:transparent]" />
          <span role="status" className="relative inline-flex items-center gap-2 rounded-sm border border-line bg-overlay/90 px-2.5 py-1 text-xs text-ink shadow-e1">
            <span className="size-1.5 animate-pulse rounded-full bg-live shadow-[0_0_0_3px_var(--live-glow)]" aria-hidden />
            Generating…
          </span>
        </div>
      )}
      {state === 'failed' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span role="status" className="inline-flex items-center gap-1.5 rounded-sm border border-line bg-overlay/90 px-2.5 py-1 text-xs text-fail-ink shadow-e1">
            <ImageOff aria-hidden className="size-3.5" />
            Generation failed
          </span>
        </div>
      )}
      {actions && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-(--dur-1) group-focus-within/art:opacity-100 group-hover/art:opacity-100 pointer-coarse:opacity-100">
          {actions}
        </div>
      )}
      {(badgeNode || caption) && (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          <span className="pointer-events-auto">{badgeNode}</span>
          {caption && (
            <span className="truncate rounded-xs bg-overlay/85 px-1.5 py-0.5 font-mono text-2xs text-ink-2 backdrop-blur-sm @max-[199px]:hidden">{caption}</span>
          )}
        </div>
      )}
      <span aria-hidden className={cn('pointer-events-none absolute inset-0 ring-1 ring-ink/10 ring-inset', RADIUS[radius])} />
    </div>
  )
}
