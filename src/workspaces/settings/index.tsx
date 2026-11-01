import { memo, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { Copy, RotateCcw, SearchX } from 'lucide-react'
import { LibraryTemplate, ListGroup, ListPane, ListRow, ListRows, StageHeader, useShellLayout } from '@/app/templates'
import { getModelInfo } from '@/core/ai'
import { useDB } from '@/core/db'
import { DEFAULT_SETTINGS, getSettings, updateSettings, useSettings } from '@/core/settings'
import type { Settings } from '@/core/types'
import { Avatar, Button, EmptyState, copyText, toast, useReducedMotion, type MenuItem } from '@/ui'
import { cn } from '@/lib/cn'
import { formatBytes } from '@/lib/format'
import { storageReport } from './data'
import { AUTONOMY_LABEL, formatBudget, speedLabel } from './logic'
import { SavedProvider } from './parts'
import { DEFAULT_SECTION, getSection, SECTION_ALIASES, SECTIONS, searchSettings, sectionPath, type SectionDef, type SectionId } from './sections'
import AboutSection from './sections/About'
import AppearanceSection from './sections/Appearance'
import BudgetsSection from './sections/Budgets'
import DataSection from './sections/Data'
import KeyboardSection from './sections/Keyboard'
import ModelsSection from './sections/Models'
import NotificationsSection from './sections/Notifications'
import PermissionsSection from './sections/Permissions'
import ProfileSection from './sections/Profile'
import SimulatorSection from './sections/Simulator'

/**
 * Settings (docs/DESIGN.md §6.12): the Library template with the sections in the list pane and one
 * form (max 720) in the stage; no Inspector. `/settings/:section`, `#setting` scrolls to one setting.
 * Every change saves at once with an inline "✓ Saved". Every setting is also a ⌘K command (manifest).
 */
export default function SettingsWorkspace() {
  return (
    <Routes>
      <Route index element={<SettingsScreen />} />
      <Route path=":section" element={<SettingsScreen />} />
      <Route path="*" element={<SettingsScreen />} />
    </Routes>
  )
}

const BODY: Record<SectionId, ComponentType> = {
  profile: ProfileSection,
  appearance: AppearanceSection,
  models: ModelsSection,
  permissions: PermissionsSection,
  budgets: BudgetsSection,
  notifications: NotificationsSection,
  keyboard: KeyboardSection,
  simulator: SimulatorSection,
  data: DataSection,
  about: AboutSection,
}

function SettingsScreen() {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { formFactor } = useShellLayout()
  const raw = params.section ?? (params['*'] ? params['*'] : undefined)
  const section = getSection(raw)
  const alias = !section && raw ? SECTION_ALIASES[raw.toLowerCase()] : undefined
  if (alias) return <Navigate replace to={`${sectionPath(alias)}${location.hash}`} />

  const unknown = !!raw && !section
  const current: SectionDef = section ?? getSection(DEFAULT_SECTION)!
  const Body = BODY[current.id]
  // Phones show the list alone at /settings: nothing is open, so nothing is selected.
  const selected = unknown || (!raw && formFactor === 'phone') ? null : current.id

  return (
    <LibraryTemplate
      list={<SectionsPane current={selected} />}
      header={
        <StageHeader
          title={unknown ? 'Settings' : current.label}
          leading={unknown ? undefined : <current.icon aria-hidden className="mr-0.5 size-4 shrink-0 text-ink-3" strokeWidth={1.75} />}
          menu={unknown ? undefined : headerMenu(current)}
          hideInspectorToggle
          backTo="/settings"
        />
      }
      phoneView={raw ? 'stage' : 'list'}
      measure={768}
    >
      {unknown ? (
        <EmptyState
          icon={SearchX}
          title="No such settings section"
          description={`“${raw}” isn’t a part of Settings. Pick a section from the list, or start with your profile.`}
          actions={
            <Button variant="primary" onClick={() => navigate(sectionPath(DEFAULT_SECTION))}>
              Open Profile
            </Button>
          }
        />
      ) : (
        <SavedProvider key={current.id}>
          <AnchorFocus section={current.id} />
          <Body />
        </SavedProvider>
      )}
    </LibraryTemplate>
  )
}

// ------------------------------------------------------------------------------------------------ anchors

const FOCUSABLE = 'input:not([type="hidden"]):not([tabindex="-1"]), button:not([tabindex="-1"]), select, textarea, a[href], [tabindex="0"]'

/**
 * `#setting` (from Find a setting or ⌘K): scroll that setting into view, flash its row, and put
 * focus on its control so the keyboard can act at once.
 */
function AnchorFocus({ section }: { section: SectionId }) {
  const { hash, key } = useLocation()
  const reduced = useReducedMotion()
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`setting-${id}`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
      el.setAttribute('data-flash', '')
      timer = setTimeout(() => el.removeAttribute('data-flash'), 1400)
      const target = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
        (n) => !n.hasAttribute('disabled') && n.getAttribute('aria-hidden') !== 'true' && n.offsetParent !== null,
      )
      target?.focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [hash, key, section, reduced])
  return null
}

// ------------------------------------------------------------------------------------------------ header menu

type RestorableSection = 'appearance' | 'ai' | 'safety' | 'notifications' | 'simulation'

/** Put some keys of a settings section back to their defaults; returns an undo. */
function restoreKeys<K extends RestorableSection>(section: K, keys: readonly (keyof Settings[K])[]): (() => void) | null {
  const current = getSettings()[section]
  const prev: Partial<Settings[K]> = {}
  const next: Partial<Settings[K]> = {}
  let changed = false
  for (const k of keys) {
    prev[k] = current[k]
    next[k] = DEFAULT_SETTINGS[section][k]
    if (JSON.stringify(current[k]) !== JSON.stringify(DEFAULT_SETTINGS[section][k])) changed = true
  }
  if (!changed) return null
  updateSettings(section, next as never)
  return () => updateSettings(section, prev as never)
}

const RESTORE: Partial<Record<SectionId, () => (() => void) | null>> = {
  appearance: () => restoreKeys('appearance', ['theme', 'density', 'reduceMotion']),
  models: () => restoreKeys('ai', ['defaultModelId', 'effort', 'showReasoning', 'autoRetrieve']),
  permissions: () => restoreKeys('safety', ['defaultAutonomy', 'alwaysAsk', 'confirmDestructive']),
  budgets: () => restoreKeys('safety', ['monthlyBudgetUsd', 'countSimulatedSpend']),
  notifications: () => restoreKeys('notifications', ['toasts', 'focusMode', 'approvals', 'runCompleted', 'runFailed']),
  keyboard: () => restoreKeys('appearance', ['singleKeyShortcuts']),
  simulator: () => restoreKeys('simulation', ['speed']),
}

function headerMenu(section: SectionDef): MenuItem[] {
  const items: MenuItem[] = []
  const restore = RESTORE[section.id]
  if (restore) {
    items.push({
      id: 'restore',
      label: 'Restore defaults',
      description: `Put ${section.label} back the way Atrium ships`,
      icon: RotateCcw,
      onSelect: () => {
        const undo = restore()
        if (!undo) {
          toast(`${section.label} already uses the defaults`)
          return
        }
        toast.success(`Restored ${section.label} defaults`, { duration: 8000, action: { label: 'Undo', onClick: undo } })
      },
    })
  }
  items.push({
    id: 'copy-link',
    label: 'Copy link',
    icon: Copy,
    onSelect: () => {
      void copyText(`${window.location.origin}${sectionPath(section.id)}`).then(
        () => toast.success('Link copied', { description: sectionPath(section.id) }),
        () => toast.error('Couldn’t copy the link'),
      )
    },
  })
  return items
}

// ------------------------------------------------------------------------------------------------ list pane

/** The sections (or, while searching, the matching settings) with a quiet live value on each row. */
function SectionsPane({ current }: { current: SectionId | null }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const hits = useMemo(() => searchSettings(query), [query])
  const searching = query.trim().length > 0
  return (
    <ListPane title="Settings" search={{ value: query, onChange: setQuery, placeholder: 'Find a setting' }}>
      {searching ? (
        hits.length > 0 ? (
          <ListRows label="Matching settings">
            <ListGroup label="Matches" count={hits.length}>
              {hits.map((h) => {
                const Icon = h.section.icon
                return (
                  <ListRow
                    key={`${h.section.id}:${h.setting?.id ?? ''}`}
                    onClick={() => navigate(sectionPath(h.section.id, h.setting?.id))}
                    leading={<Icon aria-hidden className="size-4 text-ink-3" strokeWidth={1.75} />}
                    title={h.setting?.label ?? h.section.label}
                    meta={h.setting ? h.section.label : 'Section'}
                  />
                )
              })}
            </ListGroup>
          </ListRows>
        ) : (
          <div className="flex flex-col gap-1 px-4 py-6">
            <p className="type-body-sm text-ink-2">No setting matches “{query.trim()}”.</p>
            <p className="type-caption text-ink-3">Try a word like theme, budget, key or export. ⌘K finds actions too.</p>
          </div>
        )
      ) : (
        <ListRows label="Settings sections" className="pt-2">
          {SECTIONS.map((s) => (
            <SectionRow key={s.id} section={s} selected={s.id === current} />
          ))}
        </ListRows>
      )}
    </ListPane>
  )
}

const SectionRow = memo(function SectionRow({ section, selected }: { section: SectionDef; selected: boolean }) {
  const Icon = section.icon
  const profile = useSettings((s) => s.profile)
  return (
    <ListRow
      to={sectionPath(section.id)}
      selected={selected}
      aria-label={section.label}
      leading={
        section.id === 'profile' ? (
          <Avatar name={profile.name} hue={profile.hue} size="sm" decorative />
        ) : (
          <Icon aria-hidden className={cn('size-4', selected ? 'text-ink' : 'text-ink-3')} strokeWidth={1.75} />
        )
      }
      title={section.label}
      meta={<SectionMeta id={section.id} />}
    />
  )
})

/** The quiet value a section row shows (theme, model, autonomy, budget…). */
function SectionMeta({ id }: { id: SectionId }) {
  const s = useSettings((x) => x)
  switch (id) {
    case 'appearance':
      return <>{s.appearance.theme === 'system' ? 'System' : s.appearance.theme === 'light' ? 'Light' : 'Dark'}</>
    case 'models':
      return <>{getModelInfo(s.ai.defaultModelId)?.label.replace(/^Simulator · /, 'Sim · ') ?? 'Unknown'}</>
    case 'permissions':
      return <>{AUTONOMY_LABEL[s.safety.defaultAutonomy]}</>
    case 'budgets':
      return <>{formatBudget(s.safety.monthlyBudgetUsd)}</>
    case 'notifications':
      return s.notifications.focusMode ? <>Focus</> : !s.notifications.toasts ? <>Quiet</> : null
    case 'keyboard':
      return s.appearance.singleKeyShortcuts ? null : <>Keys off</>
    case 'simulator':
      return <>{speedLabel(s.simulation.speed)}</>
    case 'data':
      return <StorageMeta />
    default:
      return null
  }
}

/** Total stored size, re-measured at most every few seconds while the database changes. */
function StorageMeta() {
  const [bytes, setBytes] = useState(() => storageReport(useDB.getState()).totalBytes)
  const last = useRef(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const measure = () => {
      last.current = Date.now()
      setBytes(storageReport(useDB.getState()).totalBytes)
    }
    const unsub = useDB.subscribe(() => {
      if (timer) return
      // Persistence writes are debounced; measure after them, and at most every 3s.
      timer = setTimeout(() => {
        timer = undefined
        measure()
      }, Math.max(1200, 3000 - (Date.now() - last.current)))
    })
    return () => {
      clearTimeout(timer)
      unsub()
    }
  }, [])
  return <>{formatBytes(bytes)}</>
}
