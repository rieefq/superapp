import { useMemo, type CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { Hue } from '@/core/types'
import { cn } from '@/lib/cn'
import { getIcon, initialsOf } from '@/ui/primitives'
import { sigilElements, sigilPaths } from './sigil'
import './signature.css'

/*
 * Identity marks (docs/DESIGN.md §5.2, §5.4.7). Circle = actors, rounded square = things that last,
 * dashed edge = simulated. Identity hues appear only inside these marks.
 */

const hueVar = (hue: Hue) => `var(--hue-${hue})`

export interface AgentMarkProps {
  /** `Agent.sigil` — the same seed always draws the same sigil. */
  seed: number
  hue: Hue
  /** 16 · 20 · 24 · 32 · 48 · 64. Default 24. */
  size?: number
  /** A run of this agent is running: 6px live badge at the bottom-right. */
  live?: boolean
  /** The agent is paused: ‖ badge. */
  paused?: boolean
  /** Accessible name (the agent's name). Without it the mark is decorative. */
  label?: string
  /** Kept for compatibility; agents are always circles. */
  shape?: 'square' | 'circle'
  className?: string
  style?: CSSProperties
}

/**
 * Agent identity: a 15% hue disc with a 1px ring at 45% and a deterministic sigil of 3–5 radial
 * strokes, arcs and dots. Set `--sig-surface` on a parent to match the badge ring to its surface.
 */
export function AgentMark({ seed, hue, size = 24, live, paused, label, className, style }: AgentMarkProps) {
  const c = size / 2
  const paths = useMemo(() => sigilPaths(sigilElements(seed), c, c - 1), [seed, c])
  const stroke = size <= 32 ? 1.5 : Math.round(1.5 * Math.sqrt(size / 32) * 10) / 10
  const dot = Math.max(1.1, Math.min(size * 0.055, 3.2))
  const badge = live ? 'live' : paused ? 'paused' : null
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label ? `${label}${live ? ', working' : paused ? ', paused' : ''}` : undefined}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-block shrink-0 align-middle', className)}
      style={{ width: size, height: size, ...style }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="block" aria-hidden>
        <circle cx={c} cy={c} r={c} fill={hueVar(hue)} fillOpacity={0.15} />
        <circle cx={c} cy={c} r={c - 0.5} fill="none" stroke={hueVar(hue)} strokeOpacity={0.45} strokeWidth={1} />
        <path d={paths.stroke} fill="none" stroke={hueVar(hue)} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
        {paths.dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={dot} fill={hueVar(hue)} />
        ))}
      </svg>
      {badge && (
        <span
          aria-hidden
          className="absolute grid place-items-center rounded-full bg-[var(--sig-surface,var(--surface-canvas))]"
          style={{ width: 10, height: 10, right: size <= 20 ? -3 : -2, bottom: size <= 20 ? -3 : -2 }}
        >
          {badge === 'live' ? (
            <span className="relative size-1.5">
              <span className="sig-halo sig-breathe absolute -inset-px rounded-full bg-(--live-glow)" />
              <span className="absolute inset-0 rounded-full bg-live" />
            </span>
          ) : (
            <svg viewBox="0 0 6 6" width={6} height={6} className="text-ink-2">
              <rect x="0.75" y="0.5" width="1.6" height="5" rx="0.4" fill="currentColor" />
              <rect x="3.65" y="0.5" width="1.6" height="5" rx="0.4" fill="currentColor" />
            </svg>
          )}
        </span>
      )}
    </span>
  )
}

export interface MonogramMarkProps {
  /** Monogram letters ("AP", "GH"); longer names are reduced to initials. */
  text: string
  hue: Hue
  size?: number
  /** square: projects, collections, workflows · ring: integrations. Default square. */
  variant?: 'square' | 'ring'
  /** Simulated integration: the ring is dashed. */
  simulated?: boolean
  /** Draw an icon instead of letters (lucide component or icon name). */
  icon?: LucideIcon | string
  /** Accessible name. Without it the mark is decorative. */
  label?: string
  className?: string
}

const monogramOf = (text: string) => {
  const t = text.trim()
  if (t.length <= 3 && !/\s/.test(t)) return t.toUpperCase()
  return initialsOf(t, 2)
}

/** Monogram: a 15% hue rounded square (radius 25%) or a 1px hue ring; letters at 600 in the hue at 55% of the size. */
export function MonogramMark({ text, hue, size = 24, variant = 'square', simulated, icon, label, className }: MonogramMarkProps) {
  const letters = monogramOf(text)
  const Icon = typeof icon === 'string' ? getIcon(icon) : icon
  const ring = variant === 'ring'
  // Square: 55% of the size (§5.4.7). A ring has less room inside, so two letters step down.
  const fontSize = Math.round(size * (letters.length > 2 || (ring && letters.length > 1) ? 0.42 : 0.55) * 10) / 10
  const c = size / 2
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'relative inline-grid shrink-0 place-items-center overflow-hidden align-middle leading-none font-semibold select-none',
        ring ? 'rounded-full' : '',
        className,
      )}
      style={{
        width: size,
        height: size,
        color: hueVar(hue),
        borderRadius: ring ? undefined : size * 0.25,
        background: ring ? 'transparent' : `color-mix(in oklab, ${hueVar(hue)} 15%, transparent)`,
        fontSize,
        letterSpacing: letters.length > 1 ? '-0.01em' : undefined,
      }}
    >
      {ring && (
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="absolute inset-0" aria-hidden>
          <circle
            cx={c}
            cy={c}
            r={c - 0.5}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray={simulated ? `${Math.max(1.5, size / 14)} ${Math.max(1.5, size / 16)}` : undefined}
          />
        </svg>
      )}
      {Icon ? (
        <Icon aria-hidden className="relative" style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={size <= 20 ? 2 : 1.75} />
      ) : (
        <span className="relative" aria-hidden>
          {letters}
        </span>
      )}
    </span>
  )
}
