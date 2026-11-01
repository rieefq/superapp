import { ChartNoAxesCombined, CircleX, Gauge, History, ScrollText, Wallet } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'

/** Insights commands for ⌘K (kept light: this module loads eagerly). */
const COMMANDS: { id: string; title: string; subtitle: string; to: string; icon: Command['icon']; keywords: string[] }[] = [
  { id: 'overview', title: 'Insights overview', subtitle: 'Runs, spend, tokens and reliability', to: '/insights', icon: Gauge, keywords: ['analytics', 'dashboard', 'metrics', 'usage'] },
  { id: 'history', title: 'Execution history', subtitle: 'Every run, searchable and sortable', to: '/insights/history', icon: History, keywords: ['runs', 'executions', 'log', 'history'] },
  { id: 'failed', title: 'Show failed runs', subtitle: 'Insights › History · last 7 days', to: '/insights/history?status=failed', icon: CircleX, keywords: ['failures', 'errors', 'reliability', 'broken'] },
  { id: 'journal', title: 'Activity journal', subtitle: 'Who did what, with Export JSON', to: '/insights/journal', icon: ScrollText, keywords: ['activity', 'audit', 'journal', 'export'] },
  { id: 'spend', title: 'Spend by model', subtitle: 'Insights · this month against your budget', to: '/insights?range=30d', icon: Wallet, keywords: ['cost', 'budget', 'money', 'tokens', 'spend'] },
]

export const manifest: WorkspaceManifest = {
  id: 'insights',
  label: 'Insights',
  description: 'Runs, spend, model usage and reliability at a glance.',
  icon: ChartNoAxesCombined,
  group: 'system',
  path: '/insights',
  chord: ['g', 'i'],
  commands: (): Command[] =>
    COMMANDS.map((c, i) => ({
      id: `insights.${c.id}`,
      title: c.title,
      subtitle: c.subtitle,
      icon: c.icon,
      group: 'Insights',
      keywords: ['insights', ...c.keywords],
      priority: 40 - i,
      run: (ctx) => {
        ctx.close()
        ctx.navigate(c.to)
      },
    })),
  shortcuts: [
    { keys: '/', label: 'Search the history or the journal' },
    { keys: 'enter', label: 'Open the focused run where it lives' },
  ],
  inspectorDefaultOpen: false,
  defaultInspectorTab: 'run',
}
