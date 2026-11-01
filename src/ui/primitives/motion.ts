/**
 * Motion presets (motion/react) matching the design tokens:
 * --dur-1 120ms hover/press · --dur-2 180ms popovers · --dur-3 240ms panels · --dur-4 360ms dialogs,
 * easing ease-settle (enter) / ease-exit (exit). Enter = fade + small rise/scale; exit is faster.
 * Reduced motion (DESIGN §8.2): no translation or scaling, fades of 120ms or less.
 */
import type { TargetAndTransition, Transition } from 'motion/react'
import type { Side } from './positioning'

export const EASE_SETTLE = [0.22, 1, 0.36, 1] as const
export const EASE_STANDARD = [0.2, 0, 0, 1] as const
/** --ease-exit: exits accelerate away. */
export const EASE_EXIT = [0.4, 0, 1, 1] as const
export const DUR = { 1: 0.12, 2: 0.18, 3: 0.24, 4: 0.36 } as const

export interface MotionPreset {
  initial: TargetAndTransition
  animate: TargetAndTransition
  exit: TargetAndTransition
  transition: Transition
}
type Preset = MotionPreset

const fade = (duration: number): Preset => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: { duration: Math.min(duration, DUR[1]), ease: EASE_EXIT } },
  transition: { duration, ease: EASE_STANDARD },
})

/** Anchored surfaces (menus, popovers, listboxes): fade + 4px travel away from the anchor + scale .98. */
export function floatingMotion(side: Side, reduced: boolean): Preset {
  if (reduced) return fade(DUR[1])
  const d = 4
  const from = side === 'bottom' ? { y: -d } : side === 'top' ? { y: d } : side === 'right' ? { x: -d } : { x: d }
  return {
    initial: { opacity: 0, scale: 0.98, ...from },
    animate: { opacity: 1, scale: 1, x: 0, y: 0 },
    exit: { opacity: 0, scale: 0.98, transition: { duration: DUR[1], ease: EASE_EXIT } },
    transition: { duration: DUR[2], ease: EASE_SETTLE },
  }
}

/** Tooltips: quick fade + 2px. */
export function tooltipMotion(side: Side, reduced: boolean): Preset {
  if (reduced) return fade(0.08)
  const d = 2
  const from = side === 'bottom' ? { y: -d } : side === 'top' ? { y: d } : side === 'right' ? { x: -d } : { x: d }
  return {
    initial: { opacity: 0, ...from },
    animate: { opacity: 1, x: 0, y: 0 },
    exit: { opacity: 0, transition: { duration: 0.08, ease: EASE_EXIT } },
    transition: { duration: DUR[1], ease: EASE_SETTLE },
  }
}

/** Dialogs: fade + 6px rise + scale .98 over --dur-4. */
export function dialogMotion(reduced: boolean): Preset {
  if (reduced) return fade(DUR[1])
  return {
    initial: { opacity: 0, y: 6, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: 4, scale: 0.985, transition: { duration: DUR[2], ease: EASE_EXIT } },
    transition: { duration: DUR[4], ease: EASE_SETTLE },
  }
}

export function scrimMotion(reduced: boolean): Preset {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0, transition: { duration: reduced ? DUR[1] : DUR[2], ease: EASE_EXIT } },
    transition: { duration: reduced ? DUR[1] : DUR[3], ease: EASE_STANDARD },
  }
}

/** Sheets slide fully in from their edge. */
export function sheetMotion(side: 'left' | 'right' | 'bottom', reduced: boolean): Preset {
  if (reduced) return fade(DUR[1])
  const from = side === 'right' ? { x: 24, opacity: 0 } : side === 'left' ? { x: -24, opacity: 0 } : { y: 32, opacity: 0 }
  return {
    initial: from,
    animate: { x: 0, y: 0, opacity: 1 },
    exit: { ...from, transition: { duration: DUR[2], ease: EASE_EXIT } },
    transition: { duration: DUR[3], ease: EASE_SETTLE },
  }
}
