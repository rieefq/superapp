/**
 * Keyboard shortcut parsing, matching and display — pure functions (no React).
 *
 * Combo syntax: modifiers and a key joined by `+`, case-insensitive.
 *   'mod+k'        ⌘K on macOS, Ctrl+K elsewhere
 *   'mod+shift+p'  ⌘⇧P / Ctrl+Shift+P
 *   'escape', 'enter', 'f8', 'arrowup' (aliases: esc, return, up, down, left, right, del, space, plus)
 *   '?' '/' '['    symbols match the produced character, so '?' works without spelling out shift
 * Sequences (chords) are arrays of single keys: ['g', 'c'].
 */

export interface ParsedCombo {
  /** Normalized key: lowercase letter/digit, symbol, or a named key ('enter', 'arrowup', 'f8', ' '). */
  key: string
  /** Platform primary modifier: ⌘ on macOS, Ctrl elsewhere. */
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

/** The subset of KeyboardEvent the matcher needs (easy to fake in tests). */
export interface KeyEventLike {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  plus: '+',
  comma: ',',
  period: '.',
  slash: '/',
  cmd: 'meta',
  command: 'meta',
  option: 'alt',
  opt: 'alt',
  control: 'ctrl',
}

const MODIFIER_NAMES = new Set(['mod', 'ctrl', 'meta', 'alt', 'shift'])

let macOverride: boolean | null = null

/** Force platform detection (tests, gallery). Pass null to restore auto-detection. */
export function setMacPlatformOverride(value: boolean | null): void {
  macOverride = value
}

/** True on macOS / iOS / iPadOS, where `mod` means ⌘. */
export function isMacPlatform(): boolean {
  if (macOverride !== null) return macOverride
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || ''
  return /mac|iphone|ipad|ipod/i.test(platform)
}

function normalizeKeyName(raw: string): string {
  const lower = raw.toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

/** Parse 'mod+shift+k' → { key: 'k', mod: true, shift: true, … }. */
export function parseCombo(combo: string): ParsedCombo {
  const parsed: ParsedCombo = { key: '', mod: false, ctrl: false, meta: false, alt: false, shift: false }
  const trimmed = combo.trim()
  // A lone '+' (or a combo ending in '++') means the plus key itself.
  const parts = trimmed === '+' ? ['+'] : trimmed.endsWith('++') ? [...trimmed.slice(0, -2).split('+'), '+'] : trimmed.split('+')
  const last = parts.length - 1
  parts.forEach((part, i) => {
    if (!part) return
    const name = normalizeKeyName(part)
    if (i < last && MODIFIER_NAMES.has(name)) {
      parsed[name as 'mod' | 'ctrl' | 'meta' | 'alt' | 'shift'] = true
    } else if (name === 'mod') {
      // A bare 'mod' binds the platform modifier key itself.
      parsed.key = isMacPlatform() ? 'meta' : 'ctrl'
    } else {
      parsed.key = name
    }
  })
  return parsed
}

function isLetterOrDigit(key: string): boolean {
  return /^[a-z0-9]$/.test(key)
}

/** Is this a printable symbol (not a letter, digit or named key)? Shift is implied by the character. */
function isSymbol(key: string): boolean {
  return key.length === 1 && !isLetterOrDigit(key) && key !== ' '
}

/** Normalize a KeyboardEvent's key. Falls back to the physical code for non-Latin layouts and ⌥-modified chars. */
export function eventKey(event: KeyEventLike): string {
  const key = event.key ?? ''
  if (key.length === 1) {
    const lower = key.toLowerCase()
    if (/^[\x20-\x7e]$/.test(lower)) return lower
    const code = event.code ?? ''
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase()
    if (/^Digit\d$/.test(code)) return code.slice(5)
    return lower
  }
  if (key === 'Esc') return 'escape'
  if (key === 'Spacebar') return ' '
  if (key === 'Control') return 'ctrl'
  if (key === 'Meta' || key === 'OS') return 'meta'
  if (key === 'Alt') return 'alt'
  if (key === 'Shift') return 'shift'
  return key.toLowerCase()
}

/** Does this keyboard event trigger the combo? Modifiers must match exactly (shift is implied for symbols). */
export function matchesCombo(event: KeyEventLike, combo: string | ParsedCombo, mac = isMacPlatform()): boolean {
  const c = typeof combo === 'string' ? parseCombo(combo) : combo
  if (!c.key) return false
  if (eventKey(event) !== c.key) {
    // ⌥ on macOS turns some letters into dead keys; match on the physical key instead.
    const code = event.code ?? ''
    const fromCode = /^Key[A-Z]$/.test(code) ? code.slice(3).toLowerCase() : /^Digit\d$/.test(code) ? code.slice(5) : ''
    if (!(event.altKey && fromCode && fromCode === c.key)) return false
  }
  const wantMeta = c.meta || (c.mod && mac)
  const wantCtrl = c.ctrl || (c.mod && !mac)
  if (c.key !== 'meta' && event.metaKey !== wantMeta) return false
  if (c.key !== 'ctrl' && event.ctrlKey !== wantCtrl) return false
  if (c.key !== 'alt' && event.altKey !== c.alt) return false
  if (isSymbol(c.key)) {
    // '?' is already shift+/ — only insist on shift when the combo spells it out.
    if (c.shift && !event.shiftKey) return false
  } else if (c.key !== 'shift' && event.shiftKey !== c.shift) {
    return false
  }
  return true
}

/** True when any of the combos match. */
export function matchesAny(event: KeyEventLike, combos: readonly (string | ParsedCombo)[], mac = isMacPlatform()): boolean {
  return combos.some((c) => matchesCombo(event, c, mac))
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  meta: '⌘',
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  enter: '↵',
  escape: 'Esc',
  backspace: '⌫',
  delete: '⌦',
  tab: '⇥',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  capslock: '⇪',
}

const PC_NAMES: Record<string, string> = {
  mod: 'Ctrl',
  meta: 'Win',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  escape: 'Esc',
  backspace: 'Backspace',
  delete: 'Del',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  ' ': 'Space',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  capslock: 'Caps',
}

function displayKey(key: string, mac: boolean): string {
  const table = mac ? MAC_SYMBOLS : PC_NAMES
  if (table[key]) return table[key]
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase()
  if (key.length === 1) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/**
 * Display parts for a combo: 'mod+shift+k' → ['⌘', '⇧', 'K'] on macOS, ['Ctrl', 'Shift', 'K'] elsewhere.
 * Modifier order follows platform convention (macOS: ⌃⌥⇧⌘, others: Ctrl Alt Shift).
 */
export function formatCombo(combo: string | ParsedCombo, mac = isMacPlatform()): string[] {
  const c = typeof combo === 'string' ? parseCombo(combo) : combo
  const mods: string[] = []
  if (mac) {
    if (c.ctrl) mods.push('ctrl')
    if (c.alt) mods.push('alt')
    if (c.shift) mods.push('shift')
    if (c.meta || c.mod) mods.push('mod')
  } else {
    if (c.ctrl || c.mod) mods.push('ctrl')
    if (c.meta) mods.push('meta')
    if (c.alt) mods.push('alt')
    if (c.shift) mods.push('shift')
  }
  const parts = mods.map((m) => displayKey(m, mac))
  if (c.key) parts.push(displayKey(c.key, mac))
  return parts
}

/** A combo or sequence as one readable string: 'mod+k' → '⌘K' / 'Ctrl+K'; 'g c' → 'G then C'. */
export function formatShortcut(shortcut: string, mac = isMacPlatform()): string {
  const steps = shortcut.trim().split(/\s+/)
  return steps
    .map((step) => formatCombo(step, mac).join(mac ? '' : '+'))
    .join(' then ')
}

/** Does the combo use a modifier that makes it safe to fire while typing in a field? */
export function hasCommandModifier(combo: string | ParsedCombo): boolean {
  const c = typeof combo === 'string' ? parseCombo(combo) : combo
  return c.mod || c.ctrl || c.meta || c.alt || /^f\d{1,2}$/.test(c.key)
}

/**
 * Two-key (or longer) sequence matcher. Feed it every keydown; returns true when the sequence completes
 * within `timeoutMs` between consecutive keys. A mismatching key restarts (and may begin) the sequence.
 */
export function createSequenceMatcher(sequence: readonly string[], timeoutMs = 1000) {
  const steps = sequence.map(normalizeKeyName)
  let index = 0
  let last = 0
  return {
    /** Returns true when this key completes the sequence. */
    feed(key: string, now: number): boolean {
      const k = normalizeKeyName(key)
      if (index > 0 && now - last > timeoutMs) index = 0
      if (k === steps[index]) {
        index += 1
        last = now
        if (index === steps.length) {
          index = 0
          return true
        }
        return false
      }
      index = k === steps[0] ? 1 : 0
      last = now
      return false
    },
    /** Is a sequence partially typed (and not yet expired)? */
    pending(now: number): boolean {
      return index > 0 && now - last <= timeoutMs
    },
    reset(): void {
      index = 0
    },
  }
}
