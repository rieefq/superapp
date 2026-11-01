/**
 * The global command registry. Commands come from four places:
 * 1. built-ins (navigation, creation, view, settings, data) — `builtInCommands`;
 * 2. every workspace manifest's `commands(ctx)` and `newAction`;
 * 3. views that register contextual commands while mounted — `useRegisterCommands`;
 * 4. settings commands (`> theme light`).
 * The command center lists the current workspace's (2) and (3) under "Actions for this view".
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  Bell, BookOpen, CirclePlus, Code, Cpu, Download, FolderKanban, FolderPlus, Keyboard, Layers, LayoutPanelLeft, ListTodo,
  MessageSquarePlus, MonitorCog, Orbit, Palette, PanelRight, RotateCcw, Rows3, ScanEye, SunMoon, Telescope, Waves, Workflow,
} from 'lucide-react'
import { updateSettings, getSettings } from '@/core/settings'
import { listModels } from '@/core/ai'
import type { Command, CommandContext, WorkspaceManifest } from '../types'
import { MANIFESTS } from '../registry'
import { chordCombo } from '../shortcuts'
import { openStartSheet, useShellStore } from '../shell/store'
import { releaseAll, switchScope } from '../shell/scope'
import { runExport, runResetDemo } from '../shell/UserMenu'

// ------------------------------------------------------------------------------------------------ dynamic registrations

interface Registration {
  id: string
  /** 'view' commands are listed under "Actions for this view" while their view is mounted. */
  scope: 'view' | 'global'
  commands: Command[]
}

const registrations = new Map<string, Registration>()
const listeners = new Set<() => void>()
let version = 0

function emit() {
  version++
  listeners.forEach((l) => l())
}

/** Register commands under an id (re-registering replaces). Returns the unregister function. */
export function registerCommands(id: string, commands: Command[], opts: { scope?: 'view' | 'global' } = {}): () => void {
  registrations.set(id, { id, scope: opts.scope ?? 'view', commands })
  emit()
  return () => {
    if (registrations.get(id)?.commands === commands) {
      registrations.delete(id)
      emit()
    }
  }
}

/**
 * Contribute commands while a component is mounted, e.g. a session view's "Accept all changes".
 * `commands` may change between renders; the latest list is always the one registered.
 */
export function useRegisterCommands(id: string, commands: Command[], opts: { scope?: 'view' | 'global' } = {}): void {
  const latest = useRef(commands)
  latest.current = commands
  const key = commands.map((c) => `${c.id}:${c.title}`).join('|')
  const scope = opts.scope ?? 'view'
  useEffect(() => registerCommands(id, latest.current, { scope }), [id, key, scope])
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Re-render when registrations change. */
export function useCommandRegistryVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version)
}

export function registeredCommands(scope?: 'view' | 'global'): Command[] {
  return [...registrations.values()].filter((r) => !scope || r.scope === scope).flatMap((r) => r.commands)
}

// ------------------------------------------------------------------------------------------------ built-ins

const GO = 'Go to'

/** Navigation to every workspace, with its chord. */
export function goToCommands(): Command[] {
  return MANIFESTS.map((m) => ({
    id: `go:${m.id}`,
    title: m.label,
    subtitle: m.description,
    icon: m.icon,
    group: GO,
    keywords: ['go', 'open', 'workspace', m.group],
    shortcut: chordCombo(m.chord),
    run: (ctx: CommandContext) => ctx.navigate(m.path),
  }))
}

function settingsCommands(): Command[] {
  const s = getSettings()
  const appearance: Command[] = (
    [
      ['dark', 'Dark'],
      ['light', 'Light'],
      ['system', 'System'],
    ] as const
  ).map(([value, label]) => ({
    id: `set:theme:${value}`,
    title: `Theme: ${label}`,
    subtitle: s.appearance.theme === value ? 'Current' : undefined,
    icon: SunMoon,
    group: 'Settings',
    keywords: ['theme', value, 'appearance', 'color', 'mode'],
    run: () => updateSettings('appearance', { theme: value }),
  }))
  const density: Command[] = (
    [
      ['comfortable', 'Comfortable'],
      ['compact', 'Compact'],
    ] as const
  ).map(([value, label]) => ({
    id: `set:density:${value}`,
    title: `Density: ${label}`,
    subtitle: s.appearance.density === value ? 'Current' : undefined,
    icon: Rows3,
    group: 'Settings',
    keywords: ['density', value, 'rows'],
    run: () => updateSettings('appearance', { density: value }),
  }))
  const motion: Command[] = (
    [
      ['system', 'System'],
      ['reduce', 'Reduce'],
      ['full', 'Full'],
    ] as const
  ).map(([value, label]) => ({
    id: `set:motion:${value}`,
    title: `Motion: ${label}`,
    subtitle: s.appearance.reduceMotion === value ? 'Current' : undefined,
    icon: Waves,
    group: 'Settings',
    keywords: ['motion', 'animation', value, 'reduce motion'],
    run: () => updateSettings('appearance', { reduceMotion: value }),
  }))
  const toggles: Command[] = [
    {
      id: 'set:focus',
      title: s.notifications.focusMode ? 'Turn off focus mode' : 'Turn on focus mode',
      icon: ScanEye,
      group: 'Settings',
      keywords: ['focus', 'mode', 'quiet', 'do not disturb', 'toasts'],
      run: () => updateSettings('notifications', { focusMode: !getSettings().notifications.focusMode }),
    },
    {
      id: 'set:single-keys',
      title: s.appearance.singleKeyShortcuts ? 'Turn off single-key shortcuts' : 'Turn on single-key shortcuts',
      icon: Keyboard,
      group: 'Settings',
      keywords: ['keyboard', 'single key', 'shortcuts', 'accessibility'],
      run: () => updateSettings('appearance', { singleKeyShortcuts: !getSettings().appearance.singleKeyShortcuts }),
    },
    {
      id: 'set:toasts',
      title: s.notifications.toasts ? 'Turn off toasts' : 'Turn on toasts',
      icon: Bell,
      group: 'Settings',
      keywords: ['notifications', 'toasts', 'popups'],
      run: () => updateSettings('notifications', { toasts: !getSettings().notifications.toasts }),
    },
  ]
  const models: Command[] = listModels()
    .filter((m) => m.available)
    .map((m) => ({
      id: `set:model:${m.model.id}`,
      title: `Default model: ${m.model.label}`,
      subtitle: s.ai.defaultModelId === m.model.id ? 'Current' : m.model.simulated ? 'Simulated · no model is called' : m.model.description,
      icon: Cpu,
      group: 'Settings',
      keywords: ['model', 'default', 'provider', m.model.label, m.model.simulated ? 'simulator sim' : 'live'],
      run: () => updateSettings('ai', { defaultModelId: m.model.id }),
    }))
  return [...appearance, ...density, ...motion, ...toggles, ...models]
}

/** Shell-level commands available everywhere. */
export function builtInCommands(): Command[] {
  const create: Command[] = [
    { id: 'new:chat', title: 'New conversation', icon: MessageSquarePlus, group: 'Create', keywords: ['chat', 'ask', 'thread'], run: (ctx) => ctx.navigate('/chat') },
    { id: 'new:research', title: 'Start research…', icon: Telescope, group: 'Create', keywords: ['investigate', 'investigation', 'sources'], run: () => openStartSheet('research') },
    { id: 'new:session', title: 'New coding session…', icon: Code, group: 'Create', keywords: ['code', 'forge', 'repository', 'fix', 'build'], run: () => openStartSheet('session') },
    { id: 'new:agent', title: 'Assign an agent…', icon: Orbit, group: 'Create', keywords: ['delegate', 'agent', 'run'], run: () => openStartSheet('agent') },
    { id: 'new:task', title: 'New task…', icon: ListTodo, group: 'Create', keywords: ['todo', 'organize', 'task'], run: () => openStartSheet('task') },
    { id: 'new:note', title: 'New note…', icon: BookOpen, group: 'Create', keywords: ['knowledge', 'note', 'save'], run: () => openStartSheet('note') },
    { id: 'new:studio', title: 'Create in Studio…', icon: Palette, group: 'Create', keywords: ['image', 'deck', 'video', 'doc', 'create'], run: () => openStartSheet('studio') },
    { id: 'new:workflow-run', title: 'Run a workflow…', icon: Workflow, group: 'Create', keywords: ['workflow', 'automation', 'run'], run: () => openStartSheet('workflow') },
    { id: 'new:workflow', title: 'New workflow', icon: CirclePlus, group: 'Create', keywords: ['automate', 'automation', 'workflow'], run: (ctx) => ctx.navigate('/workflows/new') },
  ]
  const scope: Command[] = [
    {
      id: 'scope:switch',
      title: 'Switch project…',
      icon: FolderKanban,
      group: 'Projects',
      shortcut: 'p',
      keywords: ['scope', 'project', 'working directory', '#'],
      run: () => useShellStore.getState().setProjectSwitcherOpen(true),
    },
    {
      id: 'scope:all',
      title: 'Show all work',
      subtitle: 'Clear the project scope',
      icon: LayoutPanelLeft,
      group: 'Projects',
      keywords: ['scope', 'all', 'unscope', 'clear'],
      run: () => switchScope(null),
    },
    {
      id: 'project:new',
      title: 'New project',
      icon: FolderPlus,
      group: 'Projects',
      keywords: ['create', 'project'],
      run: () => useShellStore.getState().setProjectSwitcherOpen(true),
    },
  ]
  const view: Command[] = [
    { id: 'view:inspector', title: 'Toggle the Inspector', icon: PanelRight, group: 'View', shortcut: 'mod+\\', keywords: ['panel', 'details', 'inspect'], run: () => toggleInspectorForPath() },
    { id: 'view:shortcuts', title: 'Keyboard shortcuts', icon: Keyboard, group: 'View', shortcut: '?', keywords: ['keys', 'help', 'hotkeys'], run: () => useShellStore.getState().setShortcutsOpen(true) },
    { id: 'view:whats-real', title: 'What’s real in this build', icon: MonitorCog, group: 'View', keywords: ['simulated', 'live', 'honest', 'about'], run: () => useShellStore.getState().setWhatsRealOpen(true) },
    {
      id: 'view:needs-you',
      title: 'Needs you',
      icon: Bell,
      group: 'View',
      shortcut: '!',
      keywords: ['approvals', 'inbox', 'reviews', 'updates', 'notifications'],
      run: () => {
        const st = useShellStore.getState()
        st.setNeedsYouTab('needs')
        st.setNeedsYouOpen(true)
      },
    },
    {
      id: 'hold:release-all',
      title: 'Release all held items',
      icon: Layers,
      group: 'View',
      keywords: ['hold', 'release', 'context', 'clear'],
      run: () => releaseAll(),
    },
  ]
  const data: Command[] = [
    { id: 'data:export', title: 'Export data', subtitle: 'Download everything as JSON (API keys excluded)', icon: Download, group: 'Data', keywords: ['backup', 'download', 'json'], run: () => runExport() },
    { id: 'data:reset', title: 'Reset demo world…', icon: RotateCcw, group: 'Data', keywords: ['reset', 'demo', 'seed', 'start over'], run: (ctx) => void runResetDemo(ctx.navigate) },
  ]
  return [...create, ...scope, ...view, ...data, ...settingsCommands()]
}

function toggleInspectorForPath() {
  const path = typeof window === 'undefined' ? '/' : window.location.pathname
  const m = MANIFESTS.filter((x) => x.path !== '/' && (path === x.path || path.startsWith(`${x.path}/`))).sort((a, b) => b.path.length - a.path.length)[0] ?? MANIFESTS[0]
  useShellStore.getState().toggleInspector(m.id)
}

/** Commands contributed by a manifest (its `commands` plus its `newAction`). */
export function manifestCommands(m: WorkspaceManifest, ctx: CommandContext): Command[] {
  const out: Command[] = []
  if (m.newAction) {
    const action = m.newAction
    out.push({ id: `${m.id}:new`, title: action.label, icon: m.icon, group: m.label, shortcut: 'n', priority: 100, run: (c) => action.run(c) })
  }
  try {
    out.push(...(m.commands?.(ctx) ?? []))
  } catch (err) {
    console.warn(`[commands] ${m.id} commands failed`, err)
  }
  return out
}

export interface CommandSet {
  /** The current workspace's commands (its manifest + mounted views). */
  view: Command[]
  /** Everything else (built-ins, other workspaces, global registrations). */
  global: Command[]
  goTo: Command[]
}

/** Every command for the current context. */
export function collectCommands(ctx: CommandContext, workspace: WorkspaceManifest): CommandSet {
  const view = [...manifestCommands(workspace, ctx), ...registeredCommands('view')]
  const others = MANIFESTS.filter((m) => m.id !== workspace.id).flatMap((m) => manifestCommands(m, ctx))
  return { view, global: [...builtInCommands(), ...others, ...registeredCommands('global')], goTo: goToCommands() }
}
