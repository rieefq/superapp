import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'
import { useDB } from '@/core/db'
import { useScope } from '@/core/context'
import { HUE_FILL, IconButton, KbdCombo, Menu, Tooltip, type MenuItem } from '@/ui'
import { cn } from '@/lib/cn'
import { MANIFESTS, NAV_GROUPS } from '../registry'
import type { WorkspaceManifest } from '../types'
import { chordCombo } from '../shortcuts'
import { useShellStore } from './store'
import { useShellLayout } from './context'
import { Mark, type MarkState } from './sig'
import { useActivityState, useNeedsYouCount } from './signals'
import { ProjectSwitcher } from './ProjectSwitcher'
import { HoldingChip } from './Holding'
import { NeedsYouButton } from './NeedsYou'
import { ProviderChip } from './ProviderMenu'
import { UserMenu } from './UserMenu'

const LEGEND = 'Circles act · Capsules happen · Squares last · Dashed = simulated'

function markLabel(state: MarkState): string {
  if (state === 'waiting') return 'Atrium, home. Something needs you'
  if (state === 'working') return 'Atrium, home. Runs are working'
  return 'Atrium, home'
}

/** The mark cell above the rail: the capsule is the activity LED (§3.2, §5.4.1). */
export function MarkButton({ width }: { width?: number }) {
  const navigate = useNavigate()
  const state = useActivityState()
  return (
    <div className="flex h-full shrink-0 items-center justify-center" style={width ? { width } : undefined}>
      <Tooltip content={LEGEND} placement="bottom-start" asLabel={false}>
        <button
          type="button"
          aria-label={markLabel(state)}
          data-state={state}
          onClick={() => navigate('/')}
          className="grid h-8 place-items-center rounded-sm px-1.5 transition-colors duration-(--dur-1) hover:bg-hover active:bg-press"
        >
          <Mark state={state} />
        </button>
      </Tooltip>
    </div>
  )
}

/** Workspaces grouped for menus and sheets (Home first, then Think → Make → Delegate → Organize → System). */
export function groupedManifests(): { group: string; label: string; items: WorkspaceManifest[] }[] {
  return NAV_GROUPS.map((g) => ({ group: g.id, label: g.label, items: MANIFESTS.filter((m) => m.group === g.id) })).filter((g) => g.items.length)
}

function WorkspaceCrumb({ manifest }: { manifest: WorkspaceManifest }) {
  const navigate = useNavigate()
  const items = useMemo<MenuItem[]>(() => {
    const out: MenuItem[] = []
    for (const g of groupedManifests()) {
      if (g.label) out.push({ type: 'label', label: g.label, id: `label-${g.group}` })
      else if (out.length) out.push({ type: 'separator' })
      for (const m of g.items) {
        out.push({ id: m.id, label: m.label, icon: m.icon, shortcut: chordCombo(m.chord), onSelect: () => navigate(m.path) })
      }
    }
    return out
  }, [navigate])
  const Icon = manifest.icon
  return (
    <Menu
      items={items}
      aria-label="Workspaces"
      placement="bottom-start"
      className="w-[240px]"
      trigger={(props, state) => (
        <button
          type="button"
          {...props}
          aria-label={`Workspace: ${manifest.label}. Switch workspace`}
          className={cn(
            'flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-sm px-2 text-ink-2 transition-colors duration-(--dur-1) ease-standard',
            'hover:bg-hover hover:text-ink active:bg-press',
            state.open && 'bg-hover text-ink',
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="type-body-sm truncate font-medium text-ink">{manifest.label}</span>
        </button>
      )}
    />
  )
}

function CommandField() {
  const openCommand = useShellStore((s) => s.openCommand)
  return (
    <button
      type="button"
      onClick={() => openCommand('')}
      aria-label="Search or start"
      aria-keyshortcuts="Meta+K Control+K"
      aria-haspopup="dialog"
      className={cn(
        'group flex h-8 w-[clamp(320px,32vw,560px)] items-center gap-2.5 rounded-sm border border-line-strong bg-raised pr-1.5 pl-2.5 text-left',
        'shadow-inset transition-colors duration-(--dur-1) ease-standard hover:border-line-input hover:bg-hover',
      )}
    >
      <Search aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
      <span className="type-body-sm flex-1 truncate text-ink-3">Search or start…</span>
      <KbdCombo combo="mod+k" aria-hidden />
    </button>
  )
}

function ProjectRule() {
  const scope = useScope()
  const hue = useDB((s) => (scope ? s.projects[scope]?.hue : undefined))
  if (!hue) return null
  return <span aria-hidden data-testid="project-rule" className={cn('pointer-events-none absolute inset-x-0 -bottom-px z-10 h-0.5', HUE_FILL[hue])} />
}

/** Desktop / tablet top bar (§3.2). */
export function TopBar() {
  const { metrics, workspace } = useShellLayout()
  const openCommand = useShellStore((s) => s.openCommand)
  return (
    <header
      data-region="topbar"
      aria-label="Top bar"
      className="relative z-(--z-topbar) grid h-12 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-line bg-chrome"
    >
      <div className="flex min-w-0 items-center">
        <MarkButton width={metrics.rail} />
        <nav aria-label="Breadcrumb" className="ml-3 flex min-w-0 items-center">
          <ProjectSwitcher />
          <ChevronRight aria-hidden className="mx-0.5 size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
          <WorkspaceCrumb manifest={workspace} />
        </nav>
      </div>
      <div className="flex justify-center px-3">{metrics.commandField && <CommandField />}</div>
      <div className="flex min-w-0 items-center justify-end gap-1 pr-3">
        {!metrics.commandField && <IconButton icon={Search} label="Search or start" shortcut="mod+k" onClick={() => openCommand('')} tooltipPlacement="bottom" />}
        <HoldingChip showLabel={metrics.wideLabels} />
        <NeedsYouButton />
        <ProviderChip showLabel={metrics.wideLabels} />
        <UserMenu />
      </div>
      <ProjectRule />
    </header>
  )
}

/** Phone top bar (§3.12): mark · project chip · workspace title ▾ · spacer · ◆ count · avatar. */
export function PhoneTopBar() {
  const { workspace } = useShellLayout()
  const setMore = useShellStore((s) => s.setMoreOpen)
  const count = useNeedsYouCount()
  return (
    <header
      data-region="topbar"
      aria-label="Top bar"
      className="relative z-(--z-topbar) flex h-12 shrink-0 items-center gap-1 border-b border-line bg-chrome pt-[env(safe-area-inset-top)] pr-2 pl-1"
    >
      <MarkButton />
      <div className="flex min-w-0 items-center">
        <ProjectSwitcher compact />
        <button
          type="button"
          onClick={() => setMore(true)}
          aria-label={`Workspace: ${workspace.label}. Switch workspace`}
          className="flex h-8 min-w-0 items-center gap-1 rounded-sm px-2 text-ink hover:bg-hover active:bg-press"
        >
          <span className="type-body-sm truncate font-medium">{workspace.label}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
        </button>
      </div>
      <div className="flex-1" />
      <NeedsYouButton compact />
      {count === 0 && <span className="sr-only">Nothing needs you</span>}
      <UserMenu />
      <ProjectRule />
    </header>
  )
}

