/**
 * The keyboard map (docs/DESIGN.md §3.11) — one source for the shell's handler and the `?` sheet.
 *
 * Combo syntax follows `@/ui` hotkeys: 'mod+k' (⌘ on macOS, Ctrl elsewhere), 'shift+f6', '?'.
 * Two-key sequences are written with a space: 'g c'.
 *
 * - `global` shortcuts work everywhere, including inside text fields.
 * - `single` keys work outside editable fields only and can be turned off
 *   (settings.appearance.singleKeyShortcuts, WCAG 2.1.4).
 * - `contextual` entries are listed in the sheet; their owners bind them (cards, editors, lists).
 */
import { parseCombo } from '@/ui'
import type { WorkspaceManifest } from './types'

export type ShortcutScope = 'global' | 'single' | 'contextual'

export interface ShortcutDef {
  id: string
  /** Bound combos; the first one is shown in hints. */
  keys: string[]
  label: string
  scope: ShortcutScope
  /** Heading in the shortcut sheet. */
  section: string
  /** Shown instead of rendering `keys` (e.g. "J K ↓ ↑"). */
  display?: string
}

export const GLOBAL_SHORTCUTS: ShortcutDef[] = [
  { id: 'command', keys: ['mod+k'], label: 'Open or close the command center', scope: 'global', section: 'Global' },
  { id: 'stop', keys: ['mod+.'], label: 'Stop the current run', scope: 'global', section: 'Global' },
  { id: 'background', keys: ['mod+enter'], label: 'Start in the background (navigating composers) · send (in-place composers)', scope: 'contextual', section: 'Global' },
  { id: 'inspector', keys: ['mod+\\'], label: 'Toggle the Inspector', scope: 'global', section: 'Global' },
  { id: 'sheet', keys: ['mod+/'], label: 'Keyboard shortcuts', scope: 'global', section: 'Global' },
  { id: 'escape', keys: ['escape'], label: 'Close the top layer · leave the field · clear the selection', scope: 'global', section: 'Global' },
  { id: 'region-next', keys: ['f6'], label: 'Next region', scope: 'global', section: 'Global' },
  { id: 'region-prev', keys: ['shift+f6'], label: 'Previous region', scope: 'global', section: 'Global' },
]

export const SINGLE_KEY_SHORTCUTS: ShortcutDef[] = [
  { id: 'focus-composer', keys: ['/'], label: 'Focus the composer (or the search field)', scope: 'single', section: 'Single keys' },
  { id: 'new', keys: ['n'], label: 'New item in this workspace', scope: 'single', section: 'Single keys' },
  { id: 'projects', keys: ['p'], label: 'Switch project', scope: 'single', section: 'Single keys' },
  { id: 'needs-you', keys: ['!'], label: 'Needs you', scope: 'single', section: 'Single keys' },
  { id: 'list-pane', keys: ['['], label: 'Toggle the list pane', scope: 'single', section: 'Single keys' },
  { id: 'inspector-key', keys: [']'], label: 'Toggle the Inspector', scope: 'single', section: 'Single keys' },
  { id: 'turn-into', keys: ['t'], label: 'Turn into…', scope: 'single', section: 'Single keys' },
  { id: 'hold', keys: ['h'], label: 'Hold or release the current item', scope: 'single', section: 'Single keys' },
  { id: 'save', keys: ['s'], label: 'Save to Knowledge', scope: 'contextual', section: 'Single keys' },
  { id: 'fork', keys: ['f'], label: 'Fork from here (messages)', scope: 'contextual', section: 'Single keys' },
  { id: 'edit', keys: ['e'], label: 'Edit', scope: 'contextual', section: 'Single keys' },
  { id: 'more', keys: ['.'], label: 'More actions', scope: 'contextual', section: 'Single keys' },
  { id: 'sheet-key', keys: ['?'], label: 'Keyboard shortcuts', scope: 'single', section: 'Single keys' },
]

export const LIST_SHORTCUTS: ShortcutDef[] = [
  { id: 'list-move', keys: ['j', 'k'], display: 'J K ↓ ↑', label: 'Move through lists', scope: 'contextual', section: 'Lists' },
  { id: 'list-open', keys: ['enter'], label: 'Open', scope: 'contextual', section: 'Lists' },
  { id: 'list-inspect', keys: ['space'], label: 'Inspect (Inspector › Item)', scope: 'contextual', section: 'Lists' },
  { id: 'list-select', keys: ['x'], label: 'Select', scope: 'contextual', section: 'Lists' },
]

export const CONTEXTUAL_SHORTCUTS: ShortcutDef[] = [
  { id: 'approve', keys: ['y'], label: 'Approve once (high risk: press again within 3s)', scope: 'contextual', section: 'Focused approval' },
  { id: 'deny', keys: ['d'], label: 'Deny (focuses the reason field)', scope: 'contextual', section: 'Focused approval' },
  { id: 'approval-edit', keys: ['e'], label: 'Edit the payload', scope: 'contextual', section: 'Focused approval' },
  { id: 'cc-move', keys: ['arrowdown'], display: '↑ ↓', label: 'Move', scope: 'contextual', section: 'Command center' },
  { id: 'cc-open', keys: ['enter'], label: 'Open or run', scope: 'contextual', section: 'Command center' },
  { id: 'cc-background', keys: ['mod+enter'], label: 'Run in the background', scope: 'contextual', section: 'Command center' },
  { id: 'cc-verb', keys: ['tab'], label: 'Cycle the verb', scope: 'contextual', section: 'Command center' },
]

/** Combos Atrium never binds (browser and OS reserved; §3.11). */
export const FORBIDDEN_COMBOS: readonly string[] = [
  ...['t', 'w', 'n', 'r', 'l', 'd', 'o', 's', 'j', 'f'].map((k) => `mod+${k}`),
  ...Array.from({ length: 9 }, (_, i) => `mod+${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `alt+${i + 1}`),
  ...['c', 'i', 'j', 'n', 'p', 't', 'b'].map((k) => `mod+shift+${k}`),
  'f5',
  'f11',
  'f12',
]

function comboKey(combo: string): string {
  const c = parseCombo(combo)
  return [c.mod || c.meta || c.ctrl ? 'mod' : '', c.alt ? 'alt' : '', c.shift ? 'shift' : '', c.key].filter(Boolean).join('+')
}

const FORBIDDEN_KEYS = new Set(FORBIDDEN_COMBOS.map(comboKey))

/** True when a combo is reserved and must never be bound. Sequences ('g c') are never reserved. */
export function isForbiddenCombo(combo: string): boolean {
  if (/\s/.test(combo.trim())) return false
  return FORBIDDEN_KEYS.has(comboKey(combo))
}

/** `G` chords from the workspace manifests ('g c' → Chat). */
export function chordShortcuts(manifests: readonly WorkspaceManifest[]): (ShortcutDef & { path: string })[] {
  return manifests
    .filter((m) => m.chord)
    .map((m) => ({
      id: `go-${m.id}`,
      keys: [m.chord!.join(' ')],
      label: `Go to ${m.label}`,
      scope: 'single' as const,
      section: 'Go to',
      path: m.path,
    }))
}

/** Display string for a manifest chord: ['g', 'c'] → 'g c' (KbdCombo renders “G then C”). */
export function chordCombo(chord: readonly string[] | undefined): string | undefined {
  return chord?.join(' ')
}

export function shortcutById(id: string): ShortcutDef | undefined {
  return [...GLOBAL_SHORTCUTS, ...SINGLE_KEY_SHORTCUTS, ...LIST_SHORTCUTS, ...CONTEXTUAL_SHORTCUTS].find((s) => s.id === id)
}

/** Combos the shell binds for a shortcut id (empty when unknown). */
export function keysFor(id: string): string[] {
  return shortcutById(id)?.keys ?? []
}

/** Every combo the shell binds itself (checked against FORBIDDEN_COMBOS in tests). */
export function boundCombos(): string[] {
  return [...GLOBAL_SHORTCUTS, ...SINGLE_KEY_SHORTCUTS]
    .filter((s) => s.scope !== 'contextual')
    .flatMap((s) => s.keys)
}
