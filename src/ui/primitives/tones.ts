/**
 * Static class maps for semantic tones and identity hues (Tailwind needs literal class names).
 * Semantic (DESIGN §4.3): live = AI working, attn = needs a human, done = success, fail = failed/destructive,
 * sim = simulated (hatched), accent = ink (selection, checked controls, links), neutral = everything else.
 *
 * Solid fills behind text are limited to the contrast-verified pairs: inverse/inverse-ink, live/live-on and
 * fail/fail-on. Other tones asked for 'solid' fall back to their tint (never text on solid attn).
 */
import type { Hue } from '@/core/types'

export type SignalTone = 'neutral' | 'accent' | 'live' | 'attn' | 'done' | 'fail' | 'sim'
export type HueTone = `hue:${Hue}`
export type Tone = SignalTone | HueTone

export const HUE_SUBTLE: Record<Hue, string> = {
  volt: 'bg-hue-volt/15 text-hue-volt',
  sky: 'bg-hue-sky/15 text-hue-sky',
  violet: 'bg-hue-violet/15 text-hue-violet',
  coral: 'bg-hue-coral/15 text-hue-coral',
  amber: 'bg-hue-amber/15 text-hue-amber',
  mint: 'bg-hue-mint/15 text-hue-mint',
  rose: 'bg-hue-rose/15 text-hue-rose',
  cyan: 'bg-hue-cyan/15 text-hue-cyan',
}

export const HUE_OUTLINE: Record<Hue, string> = {
  volt: 'border border-hue-volt/45 text-hue-volt',
  sky: 'border border-hue-sky/45 text-hue-sky',
  violet: 'border border-hue-violet/45 text-hue-violet',
  coral: 'border border-hue-coral/45 text-hue-coral',
  amber: 'border border-hue-amber/45 text-hue-amber',
  mint: 'border border-hue-mint/45 text-hue-mint',
  rose: 'border border-hue-rose/45 text-hue-rose',
  cyan: 'border border-hue-cyan/45 text-hue-cyan',
}

/** Text color only. */
export const HUE_TEXT: Record<Hue, string> = {
  volt: 'text-hue-volt',
  sky: 'text-hue-sky',
  violet: 'text-hue-violet',
  coral: 'text-hue-coral',
  amber: 'text-hue-amber',
  mint: 'text-hue-mint',
  rose: 'text-hue-rose',
  cyan: 'text-hue-cyan',
}

/** Solid fill only (dots, chart keys). */
export const HUE_FILL: Record<Hue, string> = {
  volt: 'bg-hue-volt',
  sky: 'bg-hue-sky',
  violet: 'bg-hue-violet',
  coral: 'bg-hue-coral',
  amber: 'bg-hue-amber',
  mint: 'bg-hue-mint',
  rose: 'bg-hue-rose',
  cyan: 'bg-hue-cyan',
}

export const SIGNAL_SUBTLE: Record<SignalTone, string> = {
  neutral: 'bg-hover text-ink-2',
  accent: 'bg-accent-tint text-accent-ink',
  live: 'bg-live-tint text-live-ink',
  attn: 'bg-attn-tint text-attn-ink',
  done: 'bg-done-tint text-done-ink',
  fail: 'bg-fail-tint text-fail-ink',
  sim: 'sim-hatch text-sim-ink',
}

export const SIGNAL_SOLID: Record<SignalTone, string> = {
  neutral: 'bg-inverse text-inverse-ink',
  accent: 'bg-inverse text-inverse-ink',
  live: 'bg-live text-live-on',
  // No text on solid attn/done (contrast): these stay tinted, with a firmer edge.
  attn: 'bg-attn-tint text-attn-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--attn)_45%,transparent)]',
  done: 'bg-done-tint text-done-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--done)_45%,transparent)]',
  fail: 'bg-fail text-fail-on',
  sim: 'sim-hatch text-ink shadow-[inset_0_0_0_1px_var(--line-input)]',
}

export const SIGNAL_OUTLINE: Record<SignalTone, string> = {
  neutral: 'border border-line-strong text-ink-2',
  accent: 'border border-accent/45 text-accent-ink',
  live: 'border border-live/45 text-live-ink',
  attn: 'border border-attn/50 text-attn-ink',
  done: 'border border-done/45 text-done-ink',
  fail: 'border border-fail/45 text-fail-ink',
  sim: 'sim-hatch border border-dashed border-line-input text-sim-ink',
}

/** Dot/mark fill for each signal. */
export const SIGNAL_FILL: Record<SignalTone, string> = {
  neutral: 'bg-ink-4',
  accent: 'bg-accent',
  live: 'bg-live',
  attn: 'bg-attn',
  done: 'bg-done',
  fail: 'bg-fail',
  sim: 'bg-sim-hatch',
}

export const SIGNAL_TEXT: Record<SignalTone, string> = {
  neutral: 'text-ink-3',
  accent: 'text-accent-ink',
  live: 'text-live-ink',
  attn: 'text-attn-ink',
  done: 'text-done-ink',
  fail: 'text-fail-ink',
  sim: 'text-sim-ink',
}

export function isHueTone(tone: Tone): tone is HueTone {
  return tone.startsWith('hue:')
}

export function hueOf(tone: HueTone): Hue {
  return tone.slice(4) as Hue
}

export type ToneVariant = 'subtle' | 'solid' | 'outline'

/** Background + text classes for a tone in a variant. */
export function toneClasses(tone: Tone, variant: ToneVariant = 'subtle'): string {
  if (isHueTone(tone)) {
    // Identity hues never fill behind text: 'solid' renders as the 15% tint.
    const hue = hueOf(tone)
    return variant === 'outline' ? HUE_OUTLINE[hue] : HUE_SUBTLE[hue]
  }
  return variant === 'solid' ? SIGNAL_SOLID[tone] : variant === 'outline' ? SIGNAL_OUTLINE[tone] : SIGNAL_SUBTLE[tone]
}

/** Fill class for a dot in this tone. */
export function toneFill(tone: Tone): string {
  return isHueTone(tone) ? HUE_FILL[hueOf(tone)] : SIGNAL_FILL[tone]
}
