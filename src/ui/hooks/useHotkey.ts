import { useEffect } from 'react'
import { createSequenceMatcher, eventKey, hasCommandModifier, isMacPlatform, matchesCombo, parseCombo } from './hotkeys'
import { isTypingTarget } from './useIsTyping'
import { useLatest } from './useLatest'

export interface HotkeyOptions {
  /** Default true. */
  enabled?: boolean
  /**
   * Fire while focus is in a text field. Defaults to true for combos with ⌘/Ctrl/Alt (or F-keys)
   * and false for plain keys, so typing never triggers single-key shortcuts.
   */
  allowInInputs?: boolean
  /** Call preventDefault() when the shortcut fires. Default true. */
  preventDefault?: boolean
  /** Ignore auto-repeat while the key is held. Default false. */
  ignoreRepeat?: boolean
}

/** Shared: while a chord is half-typed (e.g. after `g`), plain single-key shortcuts stand down. */
let chordPendingUntil = 0

function isComposing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229
}

/**
 * Global keyboard shortcut. `useHotkey('mod+k', open)` or `useHotkey(['mod+k', '/'], open)`.
 * 'mod' is ⌘ on macOS and Ctrl elsewhere. Events already handled (defaultPrevented) are ignored,
 * so menus, inputs and dialogs that consume a key win over global shortcuts.
 */
export function useHotkey(
  combo: string | readonly string[],
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {},
): void {
  const { enabled = true, allowInInputs, preventDefault = true, ignoreRepeat = false } = options
  const handlerRef = useLatest(handler)
  const key = Array.isArray(combo) ? combo.join('|') : (combo as string)

  useEffect(() => {
    if (!enabled) return
    const parsed = key.split('|').map((c) => ({ combo: parseCombo(c), command: hasCommandModifier(c) }))
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposing(e)) return
      if (ignoreRepeat && e.repeat) return
      const mac = isMacPlatform()
      const hit = parsed.find((p) => matchesCombo(e, p.combo, mac))
      if (!hit) return
      const typing = isTypingTarget(e.target)
      if (typing && !(allowInInputs ?? hit.command)) return
      if (!hit.command && Date.now() < chordPendingUntil) return
      if (preventDefault) e.preventDefault()
      handlerRef.current(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, enabled, allowInInputs, preventDefault, ignoreRepeat, handlerRef])
}

export interface ChordOptions {
  enabled?: boolean
  /** Max gap between keys, ms. Default 1000. */
  timeout?: number
}

/**
 * Two-key "go to" sequences: `useChord(['g', 'c'], () => navigate('/chat'))`.
 * Ignored while typing in a field or when a modifier (⌘/Ctrl/Alt) is held.
 */
export function useChord(sequence: readonly string[], handler: (event: KeyboardEvent) => void, options: ChordOptions = {}): void {
  const { enabled = true, timeout = 1000 } = options
  const handlerRef = useLatest(handler)
  const key = sequence.join(' ')

  useEffect(() => {
    if (!enabled) return
    const matcher = createSequenceMatcher(key.split(' '), timeout)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isComposing(e) || e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) {
        matcher.reset()
        return
      }
      if (isTypingTarget(e.target)) {
        matcher.reset()
        return
      }
      const k = eventKey(e)
      if (k === 'shift') return
      const now = Date.now()
      if (matcher.feed(k, now)) {
        chordPendingUntil = 0
        e.preventDefault()
        handlerRef.current(e)
      } else if (matcher.pending(now)) {
        chordPendingUntil = now + timeout
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [key, enabled, timeout, handlerRef])
}
