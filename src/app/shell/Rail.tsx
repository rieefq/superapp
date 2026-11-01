import type { Ref } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { Settings2 } from 'lucide-react'
import { Menu, Tooltip } from '@/ui'
import { cn } from '@/lib/cn'
import { MANIFESTS, NAV_GROUPS } from '../registry'
import type { WorkspaceManifest } from '../types'
import { chordCombo } from '../shortcuts'
import { useShellLayout } from './context'
import { useViewportHeight } from './overlays'
import { useRailBadges, type RailBadge } from './signals'

function badgeWords(b: RailBadge | undefined): string {
  if (!b) return ''
  return [b.live && 'running', b.attn && 'needs you'].filter(Boolean).join(', ')
}

/** Live dot (6px) and attention ◆ (7px) at the icon's top-right, ringed in the item's surface. */
function Badges({ badge }: { badge?: RailBadge }) {
  if (!badge || (!badge.live && !badge.attn)) return null
  return (
    <span aria-hidden className="pointer-events-none absolute -top-1 -right-1.5 flex items-center gap-0.5">
      {badge.attn && <span className="size-[7px] rotate-45 rounded-[1px] bg-attn shadow-[0_0_0_2px_var(--badge-ring)]" />}
      {badge.live && <span className="atrium-mark-breathe size-1.5 rounded-full bg-live shadow-[0_0_0_2px_var(--badge-ring)]" />}
    </span>
  )
}

function RailItem({ manifest, labeled, badge }: { manifest: WorkspaceManifest; labeled: boolean; badge?: RailBadge }) {
  const Icon = manifest.icon
  const words = badgeWords(badge)
  const chord = chordCombo(manifest.chord)
  return (
    <li className="relative flex justify-center">
      <Tooltip content={manifest.label} shortcut={chord} placement="right" asLabel={false}>
        <NavLink
          to={manifest.path}
          end={manifest.path === '/'}
          aria-label={words ? `${manifest.label}, ${words}` : manifest.label}
          className={({ isActive }) =>
            cn(
              'group relative flex flex-col items-center justify-center rounded-sm text-ink-3 outline-none',
              'transition-colors duration-(--dur-1) ease-standard [--badge-ring:var(--surface-chrome)]',
              'hover:bg-hover hover:text-ink-2 hover:[--badge-ring:var(--surface-hover)]',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
              labeled ? 'h-[52px] w-16 gap-1' : 'size-10',
              isActive && 'bg-raised text-ink [--badge-ring:var(--surface-raised)] hover:bg-raised hover:text-ink hover:[--badge-ring:var(--surface-raised)]',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span
                  aria-hidden
                  className={cn('absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-[2px] bg-ink', labeled ? '-left-1' : '-left-2')}
                />
              )}
              <span className="relative">
                <Icon aria-hidden className="size-5" strokeWidth={1.5} />
                <Badges badge={badge} />
              </span>
              {labeled && <span className="type-micro max-w-full truncate tracking-[-0.01em]">{manifest.label}</span>}
            </>
          )}
        </NavLink>
      </Tooltip>
    </li>
  )
}

function SystemItem({ manifest, badge }: { manifest: WorkspaceManifest; badge?: RailBadge }) {
  const Icon = manifest.icon
  const words = badgeWords(badge)
  return (
    <li className="relative flex justify-center">
      <Tooltip content={manifest.label} shortcut={chordCombo(manifest.chord)} placement="right" asLabel={false}>
        <NavLink
          to={manifest.path}
          aria-label={words ? `${manifest.label}, ${words}` : manifest.label}
          className={({ isActive }) =>
            cn(
              'relative grid size-10 place-items-center rounded-sm text-ink-3 outline-none [--badge-ring:var(--surface-chrome)]',
              'transition-colors duration-(--dur-1) ease-standard hover:bg-hover hover:text-ink-2 hover:[--badge-ring:var(--surface-hover)]',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
              isActive && 'bg-raised text-ink [--badge-ring:var(--surface-raised)] hover:bg-raised',
            )
          }
        >
          <span className="relative">
            <Icon aria-hidden className="size-[18px]" strokeWidth={1.5} />
            <Badges badge={badge} />
          </span>
        </NavLink>
      </Tooltip>
    </li>
  )
}

/** Under 700px of height the system items fold into one "System" menu (§3.3). */
function SystemMenu({ items }: { items: WorkspaceManifest[] }) {
  const navigate = useNavigate()
  return (
    <Menu
      placement="right-end"
      aria-label="System"
      items={items.map((m) => ({ id: m.id, label: m.label, icon: m.icon, shortcut: chordCombo(m.chord), onSelect: () => navigate(m.path) }))}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          ref={props.ref as Ref<HTMLButtonElement>}
          aria-label="System"
          className="grid size-10 place-items-center rounded-sm text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)"
        >
          <Settings2 aria-hidden className="size-[18px]" strokeWidth={1.5} />
        </button>
      )}
    />
  )
}

/** The rail (§3.3): labeled at ≥1280 (72px), icon-only at 768–1279 (56px); system items at the bottom. */
export function Rail() {
  const { metrics } = useShellLayout()
  const badges = useRailBadges()
  const height = useViewportHeight()
  const labeled = metrics.railLabeled
  const groups = NAV_GROUPS.filter((g) => g.id !== 'system')
    .map((g) => ({ id: g.id, items: MANIFESTS.filter((m) => m.group === g.id) }))
    .filter((g) => g.items.length)
  const system = MANIFESTS.filter((m) => m.group === 'system')

  return (
    <nav
      data-region="rail"
      aria-label="Workspaces"
      style={{ width: metrics.rail }}
      className="relative z-(--z-rail) flex shrink-0 flex-col items-center overflow-x-hidden overflow-y-auto bg-chrome pt-1.5 pb-2 no-scrollbar"
    >
      <ul className="flex w-full flex-col items-stretch gap-0.5">
        {groups.map((g, gi) => (
          <li key={g.id} className="contents">
            {gi > 0 && (
              <span role="separator" aria-hidden className="my-1 flex justify-center">
                <span className="h-px w-6 bg-line" />
              </span>
            )}
            <ul className="flex flex-col gap-0.5" aria-label={NAV_GROUPS.find((x) => x.id === g.id)?.label || 'Home'}>
              {g.items.map((m) => (
                <RailItem key={m.id} manifest={m} labeled={labeled} badge={badges[m.id]} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="min-h-3 flex-1" />
      {height < 700 ? (
        <SystemMenu items={system} />
      ) : (
        <ul className="flex flex-col gap-0.5" aria-label="System">
          {system.map((m) => (
            <SystemItem key={m.id} manifest={m} badge={badges[m.id]} />
          ))}
        </ul>
      )}
    </nav>
  )
}
