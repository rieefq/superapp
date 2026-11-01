import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronLeft, ChevronRight, Download, Keyboard, MonitorCog, Rows3, RotateCcw, ScanEye, Settings2, SunMoon, Waves, type LucideIcon } from 'lucide-react'
import { updateSettings, useSettings } from '@/core/settings'
import type { Settings } from '@/core/types'
import { Avatar, KbdCombo, Popover, SegmentedControl, Switch, confirm, toast } from '@/ui'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { resetDemoData } from '../boot'
import { useShellStore } from './store'
import { ShellPopover } from './overlays'
import { downloadExport } from './exportData'

type Appearance = Settings['appearance']

const THEME: { value: Appearance['theme']; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
]
const DENSITY: { value: Appearance['density']; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
]
const MOTION: { value: Appearance['reduceMotion']; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'reduce', label: 'Reduce' },
  { value: 'full', label: 'Full' },
]

/** Export the database as a JSON file (real download; secrets excluded). */
export function runExport(): void {
  try {
    const { fileName, bytes } = downloadExport()
    toast.success('Export downloaded', { description: `${fileName} · ${formatBytes(bytes)}. API keys are not included.` })
  } catch (err) {
    toast.error('Couldn’t export your data', { description: err instanceof Error ? err.message : String(err) })
  }
}

/** Reset the demo world after a typed confirmation ('reset'). Settings and API keys are kept. */
export async function runResetDemo(navigate: (to: string) => void): Promise<void> {
  const ok = await confirm({
    title: 'Reset the demo world?',
    description:
      'This replaces every project, conversation, run, task and note with a fresh copy of the demo world. Your settings and API keys are kept. This can’t be undone.',
    tone: 'danger',
    confirmLabel: 'Reset demo world',
    requireText: 'reset',
  })
  if (!ok) return
  try {
    resetDemoData()
    const shell = useShellStore.getState()
    shell.attachRun(null)
    shell.clearInspect()
    useShellStore.setState({ recents: [], stagePrimary: null, selection: null })
    navigate('/')
    toast.success('Demo world reset', { description: 'A fresh copy of Northwind Labs is ready.' })
  } catch (err) {
    toast.error('Couldn’t reset the demo world', { description: err instanceof Error ? err.message : String(err) })
  }
}

/** Avatar → user menu (§3.9): appearance submenus that apply live, focus mode, and data actions. */
export function UserMenu() {
  const [open, setOpen] = useState(false)
  const profile = useSettings((s) => s.profile)
  return (
    <ShellPopover
      open={open}
      onOpenChange={setOpen}
      title={profile.name}
      width={240}
      trigger={(props, state) => (
        <button
          type="button"
          {...(props as object)}
          aria-label={`Account: ${profile.name}`}
          className={cn(
            'grid size-8 place-items-center rounded-full transition-colors duration-(--dur-1)',
            'hover:bg-hover active:bg-press',
            state.open && 'bg-hover',
          )}
        >
          <Avatar name={profile.name} hue={profile.hue} size="md" decorative className="size-7 text-[11px]" />
        </button>
      )}
    >
      {({ close, phone }) => (phone ? <PhoneUserMenu close={close} /> : <UserMenuPanel close={close} />)}
    </ShellPopover>
  )
}

function useAccountActions(close: () => void) {
  const navigate = useNavigate()
  const setShortcuts = useShellStore((s) => s.setShortcutsOpen)
  const setWhatsReal = useShellStore((s) => s.setWhatsRealOpen)
  return {
    shortcuts: () => {
      close()
      setShortcuts(true)
    },
    whatsReal: () => {
      close()
      setWhatsReal(true)
    },
    settings: () => {
      close()
      navigate('/settings')
    },
    exportData: () => {
      close()
      runExport()
    },
    reset: () => {
      close()
      void runResetDemo(navigate)
    },
  }
}

function UserMenuPanel({ close }: { close: () => void }) {
  const profile = useSettings((s) => s.profile)
  const appearance = useSettings((s) => s.appearance)
  const focusMode = useSettings((s) => s.notifications.focusMode)
  const actions = useAccountActions(close)
  const panelRef = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const rows = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-row]') ?? [])
    if (!rows.length) return
    if (!panelRef.current?.contains(document.activeElement)) return
    e.preventDefault()
    const i = rows.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : e.key === 'ArrowDown' ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length
    rows[next]?.focus()
  }

  return (
    <div ref={panelRef} onKeyDown={onKeyDown} className="flex min-h-0 flex-col overflow-y-auto overscroll-contain py-1.5">
      <div className="flex items-center gap-2.5 px-3 pt-1.5 pb-2.5">
        <Avatar name={profile.name} hue={profile.hue} size="lg" decorative />
        <div className="flex min-w-0 flex-col">
          <span className="type-body-sm truncate font-semibold text-ink">{profile.name}</span>
          <span className="type-caption text-ink-3">Stored on this device</span>
        </div>
      </div>
      <Separator />
      <SubmenuRow icon={SunMoon} label="Theme" options={THEME} value={appearance.theme} onChange={(theme) => updateSettings('appearance', { theme })} />
      <SubmenuRow icon={Rows3} label="Density" options={DENSITY} value={appearance.density} onChange={(density) => updateSettings('appearance', { density })} />
      <SubmenuRow icon={Waves} label="Motion" options={MOTION} value={appearance.reduceMotion} onChange={(reduceMotion) => updateSettings('appearance', { reduceMotion })} />
      <Separator />
      <div className="px-1.5">
        <button
          type="button"
          data-menu-row
          role="switch"
          aria-checked={focusMode}
          onClick={() => updateSettings('notifications', { focusMode: !focusMode })}
          className={ROW}
        >
          <ScanEye aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          <span className="flex-1 text-left">Focus mode</span>
          <SwitchGlyph on={focusMode} />
        </button>
      </div>
      <Separator />
      <div className="flex flex-col px-1.5">
        <MenuRow icon={Keyboard} label="Keyboard shortcuts" hint="?" onSelect={actions.shortcuts} />
        <MenuRow icon={MonitorCog} label="What’s real in this build" onSelect={actions.whatsReal} />
        <MenuRow icon={Settings2} label="Settings" hint="g ," onSelect={actions.settings} />
        <MenuRow icon={Download} label="Export data" onSelect={actions.exportData} />
      </div>
      <Separator />
      <div className="px-1.5">
        <MenuRow icon={RotateCcw} label="Reset demo world…" onSelect={actions.reset} />
      </div>
    </div>
  )
}

const ROW =
  'type-body-sm flex h-8 w-full items-center gap-2.5 rounded-sm px-2 text-ink-2 outline-none transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink focus-visible:bg-hover focus-visible:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring) aria-expanded:bg-hover aria-expanded:text-ink'

function Separator() {
  return <div role="separator" className="mx-3 my-1.5 h-px bg-line" />
}

function SwitchGlyph({ on }: { on: boolean }) {
  return (
    <span aria-hidden className={cn('relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-xs p-0.5 transition-colors duration-(--dur-2)', on ? 'bg-inverse' : 'bg-press shadow-[inset_0_0_0_1px_var(--line-strong)]')}>
      <span className={cn('size-2.5 rounded-[2px] transition-transform duration-(--dur-2) ease-settle', on ? 'translate-x-2.5 bg-inverse-ink' : 'bg-ink-3')} />
    </span>
  )
}

function MenuRow({ icon: Icon, label, hint, onSelect }: { icon: LucideIcon; label: string; hint?: string; onSelect: () => void }) {
  return (
    <button type="button" data-menu-row onClick={onSelect} className={ROW}>
      <Icon aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
      <span className="flex-1 truncate text-left">{label}</span>
      {hint && <KbdCombo combo={hint} variant="plain" className="pointer-coarse:hidden" />}
    </button>
  )
}

/**
 * A row that opens a flyout of radio choices to its left (the menu sits at the window's right edge).
 * Opens on hover (120ms), click, Enter, Space or →; ← or Esc closes it and returns focus to the row.
 * Choices apply immediately so the effect is visible while the flyout stays open.
 */
function SubmenuRow<T extends string>({
  icon: Icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: LucideIcon
  label: string
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [viaKeyboard, setViaKeyboard] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const rowRef = useRef<HTMLButtonElement | null>(null)
  const current = options.find((o) => o.value === value)?.label

  useEffect(
    () => () => {
      clearTimeout(hoverTimer.current)
      clearTimeout(leaveTimer.current)
    },
    [],
  )

  const show = (keyboard: boolean) => {
    clearTimeout(leaveTimer.current)
    setViaKeyboard(keyboard)
    setOpen(true)
  }
  const scheduleClose = () => {
    clearTimeout(hoverTimer.current)
    clearTimeout(leaveTimer.current)
    leaveTimer.current = setTimeout(() => setOpen(false), 160)
  }

  return (
    <div className="px-1.5">
      <Popover
        open={open}
        onOpenChange={setOpen}
        placement="left-start"
        offset={4}
        aria-label={label}
        initialFocus={viaKeyboard ? undefined : false}
        className="w-[184px] rounded-md p-1"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            ref={(el) => {
              rowRef.current = el
              const r = props.ref
              if (typeof r === 'function') r(el)
              else if (r && typeof r === 'object') (r as { current: HTMLElement | null }).current = el
            }}
            data-menu-row
            aria-haspopup="menu"
            onClick={(e) => {
              if (open) setOpen(false)
              else show(e.detail === 0)
            }}
            onPointerEnter={() => {
              clearTimeout(leaveTimer.current)
              clearTimeout(hoverTimer.current)
              hoverTimer.current = setTimeout(() => show(false), 120)
            }}
            onPointerLeave={scheduleClose}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                // The flyout opens toward the left; accept either arrow as "open".
                e.preventDefault()
                show(true)
              }
            }}
            className={ROW}
          >
            <Icon aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
            <span className="flex-1 text-left">{label}</span>
            <span className="type-caption text-ink-3">{current}</span>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
          </button>
        )}
      >
        <div
          role="menu"
          aria-label={label}
          onPointerEnter={() => clearTimeout(leaveTimer.current)}
          onPointerLeave={scheduleClose}
          onKeyDown={(e) => {
            const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'))
            const i = items.indexOf(document.activeElement as HTMLElement)
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
              items[next]?.focus()
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault()
              setOpen(false)
              rowRef.current?.focus()
            }
          }}
        >
          <div className="type-label flex items-center gap-1 px-2 pt-1.5 pb-1 text-ink-3">
            <ChevronLeft aria-hidden className="size-3 opacity-0" />
            {label}
          </div>
          {options.map((o) => {
            const checked = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                data-autofocus={checked || undefined}
                onClick={() => onChange(o.value)}
                className={cn(ROW, 'h-8')}
              >
                <span aria-hidden className="grid size-4 shrink-0 place-items-center text-ink">
                  {checked && <Check className="size-3.5" strokeWidth={2} />}
                </span>
                <span className={cn('flex-1 text-left', checked && 'text-ink')}>{o.label}</span>
              </button>
            )
          })}
        </div>
      </Popover>
    </div>
  )
}

/** Phone: the same menu as a full-screen sheet; submenus become inline segmented controls. */
function PhoneUserMenu({ close }: { close: () => void }) {
  const profile = useSettings((s) => s.profile)
  const appearance = useSettings((s) => s.appearance)
  const focusMode = useSettings((s) => s.notifications.focusMode)
  const actions = useAccountActions(close)
  return (
    <div className="flex flex-col gap-6 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={profile.name} hue={profile.hue} size="xl" decorative />
        <div className="flex flex-col">
          <span className="type-title-3">{profile.name}</span>
          <span className="type-caption text-ink-3">Stored on this device</span>
        </div>
      </div>
      <Section label="Theme">
        <SegmentedControl fullWidth aria-label="Theme" options={THEME} value={appearance.theme} onValueChange={(theme) => updateSettings('appearance', { theme })} />
      </Section>
      <Section label="Density">
        <SegmentedControl fullWidth aria-label="Density" options={DENSITY} value={appearance.density} onValueChange={(density) => updateSettings('appearance', { density })} />
      </Section>
      <Section label="Motion">
        <SegmentedControl fullWidth aria-label="Motion" options={MOTION} value={appearance.reduceMotion} onValueChange={(reduceMotion) => updateSettings('appearance', { reduceMotion })} />
      </Section>
      <Switch label="Focus mode" description="No approval toasts. Badges still update." labelPosition="start" checked={focusMode} onCheckedChange={(v) => updateSettings('notifications', { focusMode: v })} />
      <div className="-mx-2 flex flex-col">
        <PhoneRow icon={MonitorCog} label="What’s real in this build" onSelect={actions.whatsReal} />
        <PhoneRow icon={Settings2} label="Settings" onSelect={actions.settings} />
        <PhoneRow icon={Download} label="Export data" onSelect={actions.exportData} />
        <PhoneRow icon={RotateCcw} label="Reset demo world…" onSelect={actions.reset} />
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="type-label text-ink-3">{label}</span>
      {children}
    </div>
  )
}

function PhoneRow({ icon: Icon, label, onSelect }: { icon: LucideIcon; label: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className="type-body flex h-12 items-center gap-3 rounded-sm px-2 text-ink-2 hover:bg-hover active:bg-press">
      <Icon aria-hidden className="size-[18px] text-ink-3" strokeWidth={1.75} />
      <span className="flex-1 text-left">{label}</span>
      <ChevronRight aria-hidden className="size-4 text-ink-4" strokeWidth={1.75} />
    </button>
  )
}
