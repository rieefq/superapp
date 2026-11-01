import { Bell, Eraser, FileUp, Gauge, Hand, Lightbulb, Library, Settings2, ShieldCheck, Trash2, Wallet } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'
import { getSettings, updateSettings } from '@/core/settings'
import type { Autonomy, Effort } from '@/core/types'
import { SECTIONS, sectionPath } from './sections'

const GROUP = 'Settings'

const AUTONOMY: [Autonomy, string][] = [
  ['supervised', 'Supervised'],
  ['balanced', 'Balanced'],
  ['autonomous', 'Autonomous'],
]
const EFFORT: [Effort, string][] = [
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
]

/**
 * ⌘K commands for Settings (§6.12: "every setting is also reachable from ⌘K"). Theme, density,
 * motion, focus mode, single keys, toasts, default model, export and reset are shell built-ins;
 * these add the sections and every other setting. Kept light: this module loads eagerly.
 */
function settingsCommands(): Command[] {
  const s = getSettings()
  const current = (on: boolean) => (on ? 'Current' : undefined)
  const sections: Command[] = SECTIONS.map((section, i) => ({
    id: `settings.open.${section.id}`,
    title: `${section.label} settings`,
    subtitle: section.lead,
    icon: section.icon,
    group: GROUP,
    keywords: ['settings', 'preferences', section.label, ...section.keywords, ...section.settings.map((x) => x.label)],
    priority: 40 - i,
    run: (ctx) => ctx.navigate(sectionPath(section.id)),
  }))
  const toggle = (id: string, on: boolean, what: string, icon: Command['icon'], keywords: string[], apply: (next: boolean) => void): Command => ({
    id,
    title: `${on ? 'Turn off' : 'Turn on'} ${what}`,
    icon,
    group: GROUP,
    keywords,
    run: () => apply(!on),
  })
  return [
    ...sections,
    ...EFFORT.map(([value, label]): Command => ({
      id: `settings.effort.${value}`,
      title: `Effort: ${label}`,
      subtitle: current(s.ai.effort === value) ?? 'How much reasoning models think before answering',
      icon: Lightbulb,
      group: GROUP,
      keywords: ['effort', 'reasoning', 'thinking', value],
      run: () => updateSettings('ai', { effort: value }),
    })),
    toggle('settings.reasoning', s.ai.showReasoning, 'reasoning summaries', Lightbulb, ['show reasoning', 'thinking', 'trace'], (showReasoning) =>
      updateSettings('ai', { showReasoning }),
    ),
    toggle('settings.auto-retrieve', s.ai.autoRetrieve, 'auto-retrieve knowledge', Library, ['retrieval', 'likely', 'knowledge', 'rag', 'context'], (autoRetrieve) =>
      updateSettings('ai', { autoRetrieve }),
    ),
    ...AUTONOMY.map(([value, label]): Command => ({
      id: `settings.autonomy.${value}`,
      title: `Default autonomy: ${label}`,
      subtitle: current(s.safety.defaultAutonomy === value) ?? 'How much runs may do before they ask you',
      icon: Hand,
      group: GROUP,
      keywords: ['autonomy', 'approvals', 'safety', 'permissions', value],
      run: () => updateSettings('safety', { defaultAutonomy: value }),
    })),
    toggle(
      'settings.confirm-destructive',
      s.safety.confirmDestructive,
      'confirm before deleting',
      Trash2,
      ['confirm destructive actions', 'delete', 'safety'],
      (confirmDestructive) => updateSettings('safety', { confirmDestructive }),
    ),
    toggle(
      'settings.count-simulated',
      s.safety.countSimulatedSpend,
      'counting simulated estimates',
      Wallet,
      ['budget', 'spend', 'estimate', 'simulated cost'],
      (countSimulatedSpend) => updateSettings('safety', { countSimulatedSpend }),
    ),
    {
      id: 'settings.budget',
      title: 'Set the monthly budget…',
      subtitle: s.safety.monthlyBudgetUsd > 0 ? `Now $${s.safety.monthlyBudgetUsd}` : 'No budget set',
      icon: Wallet,
      group: GROUP,
      keywords: ['budget', 'spend', 'limit', 'cost', 'money'],
      run: (ctx) => ctx.navigate(sectionPath('budgets', 'monthly-budget')),
    },
    ...[1, 2, 4].map(
      (speed): Command => ({
        id: `settings.speed.${speed}`,
        title: `Simulation speed: ${speed}×`,
        subtitle: current(s.simulation.speed === speed) ?? (speed === 1 ? 'Realistic pacing' : 'Faster simulated runs'),
        icon: Gauge,
        group: GROUP,
        keywords: ['simulator', 'simulation', 'speed', 'fast', 'pacing', `${speed}x`],
        run: () => updateSettings('simulation', { speed }),
      }),
    ),
    toggle('settings.notify-approvals', s.notifications.approvals, 'approval notifications', Bell, ['notifications', 'approvals', 'needs you'], (approvals) =>
      updateSettings('notifications', { approvals }),
    ),
    toggle('settings.notify-completed', s.notifications.runCompleted, 'updates for finished runs', Bell, ['notifications', 'completed', 'done', 'landed'], (runCompleted) =>
      updateSettings('notifications', { runCompleted }),
    ),
    toggle('settings.notify-failed', s.notifications.runFailed, 'updates for failed runs', Bell, ['notifications', 'failed', 'errors'], (runFailed) =>
      updateSettings('notifications', { runFailed }),
    ),
    {
      id: 'settings.always-allow',
      title: 'Review always-allow permissions',
      subtitle: 'Revoke what agents may do without asking',
      icon: ShieldCheck,
      group: GROUP,
      keywords: ['always allow', 'grants', 'revoke', 'permissions', 'agents'],
      run: (ctx) => ctx.navigate(sectionPath('permissions', 'always-allow')),
    },
    {
      id: 'settings.import',
      title: 'Import data…',
      subtitle: 'Replace this browser’s data with an Atrium export',
      icon: FileUp,
      group: 'Data',
      keywords: ['import', 'restore', 'upload', 'json', 'backup'],
      run: (ctx) => ctx.navigate(sectionPath('data', 'import')),
    },
    {
      id: 'settings.erase',
      title: 'Erase everything…',
      subtitle: 'Delete all data, settings and API keys from this browser',
      icon: Eraser,
      group: 'Data',
      keywords: ['erase', 'clear', 'wipe', 'delete all', 'reset'],
      run: async (ctx) => {
        const { runErase } = await import('./actions')
        await runErase(ctx.navigate)
      },
    },
  ]
}

export const manifest: WorkspaceManifest = {
  id: 'settings',
  label: 'Settings',
  description: 'Profile, appearance, models, safety and data.',
  icon: Settings2,
  group: 'system',
  path: '/settings',
  chord: ['g', ','],
  inspectorDefaultOpen: false,
  commands: () => settingsCommands(),
  shortcuts: [
    { keys: '/', label: 'Find a setting' },
    { keys: 'arrowdown', label: 'Move between sections (↑ ↓, J K); ⏎ opens one' },
  ],
}
