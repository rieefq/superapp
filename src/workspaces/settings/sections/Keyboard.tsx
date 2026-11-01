import { useMemo, useState, type ReactNode } from 'react'
import { Keyboard as KeyboardIcon } from 'lucide-react'
import { MANIFESTS } from '@/app/registry'
import { useShellStore } from '@/app/shell/store'
import { CONTEXTUAL_SHORTCUTS, GLOBAL_SHORTCUTS, LIST_SHORTCUTS, SINGLE_KEY_SHORTCUTS, chordShortcuts, type ShortcutDef } from '@/app/shortcuts'
import { useSettings } from '@/core/settings'
import { Button, EmptyState, Kbd, KbdCombo, SearchField, Switch } from '@/ui'
import { Group, SectionBody, SettingRow, useSaveSetting } from '../parts'
import { getSection } from '../sections'

interface ShortcutItem {
  id: string
  label: string
  keys: ReactNode
  /** Text matched by the filter (label + key names). */
  text: string
}

interface ShortcutGroup {
  id: string
  title: string
  /** Single-key groups stop working when single keys are off. */
  single?: boolean
  items: ShortcutItem[]
}

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

const item = (d: ShortcutDef): ShortcutItem => ({ id: d.id, label: d.label, keys: <Keys def={d} />, text: `${d.label} ${d.display ?? d.keys.join(' ')}`.toLowerCase() })

/** Every shortcut, generated from the registry (src/app/shortcuts.ts) and the workspace manifests. */
function useShortcutGroups(): ShortcutGroup[] {
  return useMemo(() => {
    const groups: ShortcutGroup[] = [
      { id: 'global', title: 'Global · work in text fields too', items: GLOBAL_SHORTCUTS.map(item) },
      { id: 'single', title: 'Single keys', single: true, items: SINGLE_KEY_SHORTCUTS.map(item) },
      {
        id: 'go',
        title: 'Go to',
        single: true,
        items: chordShortcuts(MANIFESTS).map((c) => ({
          id: c.id,
          label: c.label,
          keys: <KbdCombo combo={c.keys[0]} />,
          text: `${c.label} ${c.keys[0]}`.toLowerCase(),
        })),
      },
      { id: 'lists', title: 'Lists', items: LIST_SHORTCUTS.map(item) },
      ...['Focused approval', 'Command center'].map((section) => ({
        id: section,
        title: section,
        items: CONTEXTUAL_SHORTCUTS.filter((c) => c.section === section).map(item),
      })),
      ...MANIFESTS.filter((m) => m.shortcuts?.length).map((m) => ({
        id: `ws-${m.id}`,
        title: m.label,
        items: (m.shortcuts ?? []).map((s, i) => ({
          id: `${m.id}-${i}`,
          label: s.label,
          keys: <KbdCombo combo={s.keys} />,
          text: `${s.label} ${s.keys} ${m.label}`.toLowerCase(),
        })),
      })),
    ]
    return groups.filter((g) => g.items.length > 0)
  }, [])
}

/** Keyboard (§6.12, §3.11): single keys on/off and the full shortcut reference. */
export default function KeyboardSection() {
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  const save = useSaveSetting()
  const openSheet = useShellStore((s) => s.setShortcutsOpen)
  const groups = useShortcutGroups()
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () =>
      q
        ? groups
            .map((g) => ({ ...g, items: g.items.filter((i) => q.split(/\s+/).every((t) => i.text.includes(t) || g.title.toLowerCase().includes(t))) }))
            .filter((g) => g.items.length > 0)
        : groups,
    [groups, q],
  )

  return (
    <SectionBody lead={getSection('keyboard')!.lead}>
      <Group label="Single keys">
        <SettingRow
          id="single-keys"
          label="Single-key shortcuts"
          hint="G then a letter, N, P, !, [ and ] work outside text fields. Turn them off if keys fire by accident; every action stays a button and a ⌘K command."
        >
          <Switch
            checked={singleKeys}
            onCheckedChange={(singleKeyShortcuts) => save('single-keys', 'Single-key shortcuts', 'appearance', { singleKeyShortcuts })}
          />
        </SettingRow>
      </Group>

      <section aria-labelledby="settings-all-shortcuts" id="setting-shortcuts" data-setting="shortcuts" className="flex scroll-mt-6 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-0.5">
          <h2 id="settings-all-shortcuts" className="type-label text-ink-3">
            All shortcuts
          </h2>
          <Button size="sm" variant="ghost" leadingIcon={KeyboardIcon} kbd="?" onClick={() => openSheet(true)}>
            Open the shortcut sheet
          </Button>
        </div>
        <SearchField value={query} onValueChange={setQuery} placeholder="Filter shortcuts" aria-label="Filter shortcuts" size="md" />
        <p className="type-caption -mt-1 px-0.5 text-ink-3">⌘ means Ctrl on Windows and Linux.</p>
        {shown.length === 0 ? (
          <EmptyState
            compact
            bordered
            icon={KeyboardIcon}
            title="No shortcut matches"
            description={`Nothing is bound for “${query.trim()}”. Every action is also in ⌘K.`}
            actions={
              <Button size="sm" variant="secondary" onClick={() => setQuery('')}>
                Clear the filter
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-6">
            {shown.map((g) => (
              <section key={g.id} aria-label={g.title} className="flex flex-col gap-2">
                <h3 className="type-label flex items-center gap-2 px-0.5 text-ink-3">
                  {g.title}
                  {g.single && !singleKeys && <span className="type-meta-caps rounded-xs border border-line px-1 text-ink-3">Off</span>}
                </h3>
                <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex min-h-9 items-center justify-between gap-4 px-4 py-1.5">
                      <span className="type-body-sm text-ink-2">{i.label}</span>
                      <span className="shrink-0">{i.keys}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </SectionBody>
  )
}
