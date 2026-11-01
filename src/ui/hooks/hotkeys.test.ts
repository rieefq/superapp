import { describe, expect, it } from 'vitest'
import {
  createSequenceMatcher,
  eventKey,
  formatCombo,
  formatShortcut,
  hasCommandModifier,
  matchesCombo,
  parseCombo,
  toAriaKeyShortcuts,
  type KeyEventLike,
} from './hotkeys'

const ev = (key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike => ({
  key,
  code: mods.code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
})

describe('parseCombo', () => {
  it('parses modifiers and normalizes aliases', () => {
    expect(parseCombo('mod+shift+K')).toEqual({ key: 'k', mod: true, shift: true, ctrl: false, meta: false, alt: false })
    expect(parseCombo('Esc').key).toBe('escape')
    expect(parseCombo('ctrl+alt+up')).toMatchObject({ key: 'arrowup', ctrl: true, alt: true })
    expect(parseCombo('space').key).toBe(' ')
  })

  it('handles the plus key', () => {
    expect(parseCombo('+').key).toBe('+')
    expect(parseCombo('mod++')).toMatchObject({ key: '+', mod: true })
    expect(parseCombo('mod+plus')).toMatchObject({ key: '+', mod: true })
  })
})

describe('matchesCombo — mod', () => {
  it('mod is ⌘ on macOS', () => {
    expect(matchesCombo(ev('k', { metaKey: true }), 'mod+k', true)).toBe(true)
    expect(matchesCombo(ev('k', { ctrlKey: true }), 'mod+k', true)).toBe(false)
  })

  it('mod is Ctrl elsewhere', () => {
    expect(matchesCombo(ev('k', { ctrlKey: true }), 'mod+k', false)).toBe(true)
    expect(matchesCombo(ev('k', { metaKey: true }), 'mod+k', false)).toBe(false)
  })

  it('requires modifiers to match exactly', () => {
    expect(matchesCombo(ev('k'), 'mod+k', true)).toBe(false)
    expect(matchesCombo(ev('k', { metaKey: true, altKey: true }), 'mod+k', true)).toBe(false)
    expect(matchesCombo(ev('k', { metaKey: true }), 'k', true)).toBe(false)
  })

  it('explicit ctrl on macOS means the Control key', () => {
    expect(matchesCombo(ev('c', { ctrlKey: true }), 'ctrl+c', true)).toBe(true)
    expect(matchesCombo(ev('c', { metaKey: true }), 'ctrl+c', true)).toBe(false)
  })
})

describe('matchesCombo — shift', () => {
  it('letters: shift must match', () => {
    expect(matchesCombo(ev('K', { metaKey: true, shiftKey: true }), 'mod+shift+k', true)).toBe(true)
    expect(matchesCombo(ev('K', { metaKey: true, shiftKey: true }), 'mod+k', true)).toBe(false)
    expect(matchesCombo(ev('k', { metaKey: true }), 'mod+shift+k', true)).toBe(false)
  })

  it('symbols imply shift: "?" matches shift+/', () => {
    expect(matchesCombo(ev('?', { shiftKey: true }), '?')).toBe(true)
    expect(matchesCombo(ev('?', { shiftKey: true }), 'shift+?')).toBe(true)
    expect(matchesCombo(ev('/'), '?')).toBe(false)
    expect(matchesCombo(ev('/'), '/')).toBe(true)
  })

  it('named keys: shift must match', () => {
    expect(matchesCombo(ev('Enter', { shiftKey: true }), 'enter')).toBe(false)
    expect(matchesCombo(ev('Enter', { shiftKey: true }), 'shift+enter')).toBe(true)
    expect(matchesCombo(ev('Enter', { metaKey: true }), 'mod+enter', true)).toBe(true)
  })
})

describe('matchesCombo — keys', () => {
  it('matches named and function keys', () => {
    expect(matchesCombo(ev('Escape'), 'esc')).toBe(true)
    expect(matchesCombo(ev('F8'), 'f8')).toBe(true)
    expect(matchesCombo(ev('ArrowUp'), 'up')).toBe(true)
    expect(matchesCombo(ev(' '), 'space')).toBe(true)
  })

  it('falls back to the physical key for non-Latin layouts', () => {
    expect(eventKey(ev('л', { code: 'KeyK' }))).toBe('k')
    expect(matchesCombo(ev('л', { code: 'KeyK', ctrlKey: true }), 'mod+k', false)).toBe(true)
  })

  it('matches ⌥-modified characters on macOS by physical key', () => {
    expect(matchesCombo(ev('˚', { code: 'KeyK', altKey: true }), 'alt+k', true)).toBe(true)
    expect(matchesCombo(ev('Dead', { code: 'KeyE', altKey: true }), 'alt+e', true)).toBe(true)
  })
})

describe('formatCombo', () => {
  it('uses symbols on macOS in ⌃⌥⇧⌘ order', () => {
    expect(formatCombo('mod+k', true)).toEqual(['⌘', 'K'])
    expect(formatCombo('mod+shift+p', true)).toEqual(['⇧', '⌘', 'P'])
    expect(formatCombo('ctrl+alt+delete', true)).toEqual(['⌃', '⌥', '⌦'])
  })

  it('uses words elsewhere', () => {
    expect(formatCombo('mod+k', false)).toEqual(['Ctrl', 'K'])
    expect(formatCombo('mod+shift+p', false)).toEqual(['Ctrl', 'Shift', 'P'])
    expect(formatCombo('escape', false)).toEqual(['Esc'])
  })

  it('formats sequences', () => {
    expect(formatShortcut('g c', true)).toBe('G then C')
    expect(formatShortcut('mod+k', false)).toBe('Ctrl+K')
  })

  it('knows which combos are safe while typing', () => {
    expect(hasCommandModifier('mod+k')).toBe(true)
    expect(hasCommandModifier('f8')).toBe(true)
    expect(hasCommandModifier('/')).toBe(false)
    expect(hasCommandModifier('shift+?')).toBe(false)
  })
})

describe('toAriaKeyShortcuts', () => {
  it('maps combos to ARIA key names per platform', () => {
    expect(toAriaKeyShortcuts('mod+k', true)).toBe('Meta+K')
    expect(toAriaKeyShortcuts('mod+shift+k', false)).toBe('Control+Shift+K')
    expect(toAriaKeyShortcuts('mod+backspace', true)).toBe('Meta+Backspace')
    expect(toAriaKeyShortcuts('escape')).toBe('Escape')
    expect(toAriaKeyShortcuts('f8')).toBe('F8')
  })

  it('omits sequences (ARIA treats spaces as alternatives)', () => {
    expect(toAriaKeyShortcuts('g c')).toBeUndefined()
  })
})

describe('createSequenceMatcher (chords)', () => {
  it('completes a two-key sequence within the window', () => {
    const m = createSequenceMatcher(['g', 'c'], 1000)
    expect(m.feed('g', 0)).toBe(false)
    expect(m.pending(500)).toBe(true)
    expect(m.feed('c', 500)).toBe(true)
    expect(m.pending(600)).toBe(false)
  })

  it('expires after the timeout', () => {
    const m = createSequenceMatcher(['g', 'c'], 1000)
    m.feed('g', 0)
    expect(m.feed('c', 1500)).toBe(false)
  })

  it('restarts on a wrong key, which may itself start the sequence', () => {
    const m = createSequenceMatcher(['g', 'c'], 1000)
    m.feed('g', 0)
    expect(m.feed('x', 100)).toBe(false)
    expect(m.feed('c', 200)).toBe(false)
    m.feed('g', 300)
    expect(m.feed('g', 400)).toBe(false) // still pending: second g restarts
    expect(m.feed('c', 500)).toBe(true)
  })

  it('handles repeated keys like g g', () => {
    const m = createSequenceMatcher(['g', 'g'], 1000)
    expect(m.feed('g', 0)).toBe(false)
    expect(m.feed('g', 100)).toBe(true)
  })
})
