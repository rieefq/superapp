import { useId } from 'react'
import type { Priority, RunStatus, StepStatus, TaskStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import {
  PRIORITY_META, RUN_STATUS_META, TONE_TEXT, stepGlyph, taskGlyph, runSignal,
  type GlyphShape, type GlyphSpec, type GlyphTone, type SignalTone,
} from './glyphMeta'
import './signature.css'

export type { SignalTone } from './glyphMeta'

/*
 * Status glyphs (docs/DESIGN.md §5.3): an 8px glyph in a 12px box. The shape carries the meaning
 * without color; running breathes a --live-glow halo (a static 1px ring under reduced motion).
 */

interface GlyphA11y {
  /** Accessible name. Defaults to the status word; pass `decorative` when a word is already next to it. */
  label?: string
  decorative?: boolean
}

function a11y({ label, decorative }: GlyphA11y, word: string) {
  return decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label ?? word }
}

function ShapePaths({ shape, live }: { shape: GlyphShape; live?: boolean }) {
  switch (shape) {
    case 'ring':
      return <circle cx="6" cy="6" r="3.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    case 'dot':
      return (
        <>
          {live && <circle className="sig-halo sig-breathe" cx="6" cy="6" r="6" fill="var(--live-glow)" />}
          {live && <circle className="sig-rm-ring" cx="6" cy="6" r="5.5" fill="none" stroke="currentColor" strokeWidth="1" />}
          <circle cx="6" cy="6" r="4" fill="currentColor" />
        </>
      )
    case 'diamond':
      return <path d="M6 1.6 10.4 6 6 10.4 1.6 6Z" fill="currentColor" />
    case 'bars':
      return (
        <>
          <rect x="3" y="2.25" width="2" height="7.5" rx="0.6" fill="currentColor" />
          <rect x="7" y="2.25" width="2" height="7.5" rx="0.6" fill="currentColor" />
        </>
      )
    case 'check':
      return <path d="M2.4 6.3 4.85 8.7 9.6 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    case 'cross':
      return <path d="M3.1 3.1 8.9 8.9M8.9 3.1 3.1 8.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    case 'slash':
      return (
        <>
          <circle cx="6" cy="6" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M3.55 8.45 8.45 3.55" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )
    case 'dash':
      return <path d="M3 6h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  }
}

export interface StatusGlyphProps extends GlyphA11y {
  shape: GlyphShape
  tone: GlyphTone
  /** Breathing halo (running). */
  live?: boolean
  /** Box size in px (the glyph is 2/3 of it). Default 12. */
  size?: number
  /** Word used as the default accessible name. */
  word?: string
  className?: string
}

/** One glyph of the alphabet, drawn from its shape and tone. */
export function StatusGlyph({ shape, tone, live, size = 12, word = '', label, decorative, className }: StatusGlyphProps) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={cn('inline-block shrink-0 overflow-visible', TONE_TEXT[tone], className)}
      {...a11y({ label, decorative }, word)}
    >
      <ShapePaths shape={shape} live={live} />
    </svg>
  )
}

function fromSpec(spec: GlyphSpec, props: Omit<RunStatusGlyphProps, 'status'>) {
  return <StatusGlyph shape={spec.shape} tone={spec.tone} live={spec.live} word={spec.word} {...props} />
}

export interface RunStatusGlyphProps extends GlyphA11y {
  status: RunStatus
  size?: number
  className?: string
}

/** ○ queued · ● running · ◆ needs you · ‖ paused · ✓ done · ✕ failed · ⊘ stopped. */
export function RunStatusGlyph({ status, ...props }: RunStatusGlyphProps) {
  return fromSpec(RUN_STATUS_META[status], props)
}

export interface StepStatusGlyphProps extends GlyphA11y {
  status: StepStatus
  /** Inside timelines done recedes to ink-3. */
  context?: 'default' | 'timeline'
  size?: number
  className?: string
}

/** ○ pending · ● running · ◆ waiting · ✓ done · ✕ failed · – skipped. */
export function StepStatusGlyph({ status, context = 'default', ...props }: StepStatusGlyphProps) {
  return fromSpec(stepGlyph(status, context), props)
}

const BADGE_TONE: Record<SignalTone, string> = {
  live: 'bg-live-tint text-live-ink',
  attn: 'bg-attn-tint text-attn-ink',
  done: 'bg-hover text-ink-2',
  fail: 'bg-fail-tint text-fail-ink',
  neutral: 'bg-hover text-ink-2',
}

export interface RunStatusBadgeProps {
  status: RunStatus
  size?: 'sm' | 'md'
  className?: string
}

/** Status capsule: glyph + the user-facing word (Queued · Running · Needs you · Paused · Done · Failed · Stopped). */
export function RunStatusBadge({ status, size = 'sm', className }: RunStatusBadgeProps) {
  const spec = RUN_STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full leading-none font-medium whitespace-nowrap select-none',
        size === 'sm' ? 'h-[18px] gap-1 pr-2 pl-1 text-2xs' : 'h-[22px] gap-1.5 pr-2.5 pl-1.5 text-xs',
        BADGE_TONE[runSignal(status)],
        className,
      )}
    >
      <RunStatusGlyph status={status} decorative size={size === 'sm' ? 12 : 14} />
      {spec.word}
    </span>
  )
}

// ------------------------------------------------------------------ tasks & priority

export interface TaskGlyphProps extends GlyphA11y {
  status: TaskStatus
  /** A run for this task is running: the in-progress fill turns live. */
  live?: boolean
  /** Agent work awaits you: the review glyph turns attn. */
  attention?: boolean
  size?: number
  className?: string
}

/** Task squares (10px in a 12px box): backlog, to do, in progress, review, done, cancelled. */
export function TaskGlyph({ status, live, attention, size = 12, label, decorative, className }: TaskGlyphProps) {
  const spec = taskGlyph(status, { live, attention })
  const clip = `tg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const inset = spec.stroke / 2 + 1
  const side = 12 - inset * 2
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      className={cn('inline-block shrink-0', TONE_TEXT[spec.tone], className)}
      {...a11y({ label, decorative }, spec.word)}
    >
      {spec.fill === 'lower' && (
        <>
          <clipPath id={clip}>
            <rect x={inset} y={inset} width={side} height={side} rx="2" />
          </clipPath>
          <rect x="0" y="6" width="12" height="6" fill="currentColor" clipPath={`url(#${clip})`} />
        </>
      )}
      <rect
        x={inset}
        y={inset}
        width={side}
        height={side}
        rx="2"
        fill={spec.fill === 'full' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={spec.stroke}
      />
      {spec.fill === 'dot' && <circle cx="6" cy="6" r="1.6" fill="currentColor" />}
      {spec.slash && <path d="M3.2 8.8 8.8 3.2" stroke="currentColor" strokeWidth={spec.stroke} strokeLinecap="round" />}
    </svg>
  )
}

export interface PriorityGlyphProps extends GlyphA11y {
  priority: Priority
  size?: number
  className?: string
}

/** Three ascending bars, filled 0–3 for none/low/medium/high; urgent is 3 bars in ink plus "!". Never colored. */
export function PriorityGlyph({ priority, size = 12, label, decorative, className }: PriorityGlyphProps) {
  const spec = PRIORITY_META[priority]
  const bars = [
    { x: 1.25, h: 4 },
    { x: 5, h: 6.5 },
    { x: 8.75, h: 9 },
  ]
  return (
    <span className={cn('inline-flex shrink-0 items-center', spec.urgent ? 'text-ink' : 'text-ink-2', className)} {...a11y({ label, decorative }, spec.word)}>
      <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden className="shrink-0">
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={10.5 - b.h} width="2" height={b.h} rx="0.6" fill={i < spec.bars ? 'currentColor' : 'var(--line-strong)'} />
        ))}
      </svg>
      {spec.urgent && (
        <span aria-hidden className="-ml-px text-[11px] leading-none font-bold">
          !
        </span>
      )}
    </span>
  )
}

// ------------------------------------------------------------------ dots

const DOT_FILL: Record<SignalTone | 'sim', string> = {
  live: 'bg-live',
  attn: 'bg-attn',
  done: 'bg-done',
  fail: 'bg-fail',
  neutral: 'bg-ink-4',
  sim: 'border border-dashed border-line-input bg-transparent',
}

export interface StatusDotProps {
  tone: SignalTone | 'sim'
  className?: string
}

/** A 6px signal dot (rows, legends). Pair it with a word: color is never the only signal. */
export function StatusDot({ tone, className }: StatusDotProps) {
  return <span aria-hidden className={cn('inline-block size-1.5 shrink-0 rounded-full', DOT_FILL[tone], className)} />
}

export interface LiveIndicatorProps {
  tone?: SignalTone
  size?: 'xs' | 'sm' | 'md'
  /** Breathing halo (only meaningful for live work). Default true for live. */
  pulsing?: boolean
  /** Makes it a polite status with this accessible name. */
  label?: string
  className?: string
}

const LIVE_SIZE = { xs: 6, sm: 8, md: 10 } as const

/** A dot that breathes while something is happening right now (the halo overflows; layout stays the dot's size). */
export function LiveIndicator({ tone = 'live', size = 'sm', pulsing, label, className }: LiveIndicatorProps) {
  const px = LIVE_SIZE[size]
  const breathe = (pulsing ?? tone === 'live') && tone === 'live'
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('relative inline-block shrink-0', className)}
      style={{ width: px, height: px }}
    >
      {breathe && <span className="sig-halo sig-breathe absolute -inset-[3px] rounded-full bg-(--live-glow)" />}
      {breathe && <span className="sig-rm-ring absolute -inset-[2px] rounded-full border border-live" />}
      <span className={cn('absolute inset-0 rounded-full', DOT_FILL[tone])} />
    </span>
  )
}
