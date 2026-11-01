import type { ReactNode } from 'react'
import { updateSettings, useSettings } from '@/core/settings'
import type { RunStatus } from '@/core/types'
import { Dialog, Kbd, KbdCombo, Switch } from '@/ui'
import { MANIFESTS } from '../registry'
import { CONTEXTUAL_SHORTCUTS, GLOBAL_SHORTCUTS, LIST_SHORTCUTS, SINGLE_KEY_SHORTCUTS, chordShortcuts, type ShortcutDef } from '../shortcuts'
import { useShellStore } from './store'
import { useShellLayout } from './context'
import { RunGlyph, runStatusWord } from './sig'

function Keys({ def }: { def: ShortcutDef }) {
  if (def.display) {
    return (
      <span className="flex items-center gap-1">
        {def.display.split(' ').map((k) => (
          <Kbd key={k}>{k}</Kbd>
        ))}
      </span>
    )
  }
  return <KbdCombo combo={def.keys[0]} />
}

function Group({ title, items, note }: { title: string; items: { id: string; label: string; keys: ReactNode }[]; note?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="type-label text-ink-3">{title}</h3>
      {note}
      <ul className="flex flex-col">
        {items.map((i) => (
          <li key={i.id} className="flex min-h-8 items-center justify-between gap-4 border-b border-line py-1 last:border-b-0">
            <span className="type-body-sm text-ink-2">{i.label}</span>
            <span className="shrink-0">{i.keys}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const STATUSES: RunStatus[] = ['queued', 'running', 'waiting', 'paused', 'succeeded', 'failed', 'cancelled']

/** The `?` / ⌘/ sheet: every global, single-key and workspace shortcut, plus the glyph legend (§3.11, §5.3). */
export function ShortcutSheet() {
  const open = useShellStore((s) => s.shortcutsOpen)
  const setOpen = useShellStore((s) => s.setShortcutsOpen)
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  const { workspace } = useShellLayout()
  const row = (d: ShortcutDef) => ({ id: d.id, label: d.label, keys: <Keys def={d} /> })
  const chords = chordShortcuts(MANIFESTS)
  const wsShortcuts = workspace.shortcuts ?? []

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      size="xl"
      title="Keyboard shortcuts"
      description="⌘ means Ctrl on Windows and Linux. Single keys work outside text fields."
      bodyClassName="pb-6"
    >
      <div className="grid grid-cols-1 gap-x-10 gap-y-7 md:grid-cols-2">
        <div className="flex flex-col gap-7">
          <Group title="Global" items={GLOBAL_SHORTCUTS.map(row)} />
          <Group
            title="Single keys"
            note={
              <div className="mb-1 flex items-center justify-between gap-3 rounded-sm border border-line bg-raised px-3 py-2">
                <span className="type-caption text-ink-2">{singleKeys ? 'On. Turn off if keys fire by accident.' : 'Off. Every action is still a button and a ⌘K command.'}</span>
                <Switch size="sm" checked={singleKeys} onCheckedChange={(v) => updateSettings('appearance', { singleKeyShortcuts: v })} aria-label="Single-key shortcuts" />
              </div>
            }
            items={SINGLE_KEY_SHORTCUTS.map(row)}
          />
        </div>
        <div className="flex flex-col gap-7">
          <Group title="Go to" items={chords.map((c) => ({ id: c.id, label: c.label.replace('Go to ', ''), keys: <KbdCombo combo={c.keys[0]} /> }))} />
          {wsShortcuts.length > 0 && (
            <Group title={workspace.label} items={wsShortcuts.map((s, i) => ({ id: `ws-${i}`, label: s.label, keys: <KbdCombo combo={s.keys} /> }))} />
          )}
          <Group title="Lists" items={LIST_SHORTCUTS.map(row)} />
          {['Focused approval', 'Command center'].map((section) => (
            <Group key={section} title={section} items={CONTEXTUAL_SHORTCUTS.filter((c) => c.section === section).map(row)} />
          ))}
          <section aria-label="Legend" className="flex flex-col gap-2">
            <h3 className="type-label text-ink-3">Legend</h3>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {STATUSES.map((s) => (
                <li key={s} className="type-body-sm flex items-center gap-2 text-ink-2">
                  <RunGlyph status={s} />
                  {runStatusWord(s)}
                </li>
              ))}
            </ul>
            <p className="type-caption text-ink-3">Circles act · Capsules happen · Squares last · Dashed = simulated</p>
          </section>
        </div>
      </div>
    </Dialog>
  )
}
