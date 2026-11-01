import { cn } from '@/lib/cn'
import { Tooltip } from '@/ui/primitives'

/*
 * Honesty kit (docs/DESIGN.md §5.4.5, §8.4). SIM tags are always visible — never hover-only —
 * and carry the full explanation as their tooltip and accessible name.
 */

export const SIM_EXPLANATION = "Simulated: produced by Atrium's local simulator. No model, web service or integration was called."
export const LIVE_EXPLANATION = 'Live: a real model or service was called.'

const SIZE = {
  xs: 'type-meta-caps h-4 px-1',
  sm: 'h-5 px-1.5 text-2xs font-medium tracking-[0.02em]',
} as const

export interface SimBadgeProps {
  /** xs: 16px `SIM` tag · sm: 20px "Simulated". Default xs. */
  size?: 'xs' | 'sm'
  /** Override the visible text. */
  label?: string
  /** Override the tooltip and accessible name. */
  explanation?: string
  /** Skip the tooltip (dense lists that already explain simulation nearby). */
  noTooltip?: boolean
  className?: string
}

/** The hatched SIM tag: `.sim-hatch` fill, 1px dashed --line-input edge. */
export function SimBadge({ size = 'xs', label, explanation = SIM_EXPLANATION, noTooltip, className }: SimBadgeProps) {
  const text = label ?? (size === 'xs' ? 'SIM' : 'Simulated')
  const badge = (
    <span
      role="img"
      aria-label={explanation}
      className={cn(
        'sim-hatch inline-flex shrink-0 items-center justify-center rounded-xs border border-dashed border-line-input leading-none whitespace-nowrap text-sim-ink select-none',
        SIZE[size],
        className,
      )}
    >
      <span aria-hidden>{text}</span>
    </span>
  )
  if (noTooltip) return badge
  return (
    <Tooltip content={explanation} asLabel>
      {badge}
    </Tooltip>
  )
}

export interface LiveBadgeProps {
  /** xs: 16px `LIVE` tag · sm: 20px "Live". Default xs. */
  size?: 'xs' | 'sm'
  label?: string
  explanation?: string
  noTooltip?: boolean
  className?: string
}

/** `LIVE` — only where live and simulated work mix (tool chips, integration cards, source origins, repo chips). */
export function LiveBadge({ size = 'xs', label, explanation = LIVE_EXPLANATION, noTooltip, className }: LiveBadgeProps) {
  const text = label ?? (size === 'xs' ? 'LIVE' : 'Live')
  const badge = (
    <span
      role="img"
      aria-label={explanation}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xs border border-line-input leading-none whitespace-nowrap text-ink-2 select-none',
        SIZE[size],
        className,
      )}
    >
      <span aria-hidden>{text}</span>
    </span>
  )
  if (noTooltip) return badge
  return (
    <Tooltip content={explanation} asLabel>
      {badge}
    </Tooltip>
  )
}

/** SIM or LIVE for a piece of work. */
export function OriginBadge({ simulated, size = 'xs', className }: { simulated: boolean; size?: 'xs' | 'sm'; className?: string }) {
  return simulated ? <SimBadge size={size} className={className} /> : <LiveBadge size={size} className={className} />
}
