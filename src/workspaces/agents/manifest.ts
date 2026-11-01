import { CircleAlert, Diamond, LayoutGrid, Orbit, Plus, Rows3 } from 'lucide-react'
import { openStartSheet } from '@/app/shell/store'
import type { Command, WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'agents',
  label: 'Agents',
  description: 'Command center for autonomous agents and every run.',
  icon: Orbit,
  group: 'delegate',
  path: '/agents',
  chord: ['g', 'a'],
  newAction: { label: 'New agent', run: (ctx) => ctx.navigate('/agents/new') },
  defaultInspectorTab: 'run',
  commands: (): Command[] => [
    {
      id: 'agents.new',
      title: 'New agent',
      subtitle: 'Start from a template: research, coding, support, writing, data and more',
      icon: Plus,
      group: 'Agents',
      keywords: ['create', 'agent', 'template', 'hire'],
      priority: 50,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/agents/new')
      },
    },
    {
      id: 'agents.give-work',
      title: 'Give an agent work',
      subtitle: 'Opens the Start sheet',
      icon: Orbit,
      group: 'Agents',
      keywords: ['delegate', 'assign', 'run', 'agent'],
      priority: 45,
      run: (ctx) => {
        ctx.close()
        openStartSheet('agent')
      },
    },
    {
      id: 'agents.runs',
      title: 'All runs',
      subtitle: 'Every run in Atrium, by what it needs',
      icon: Rows3,
      group: 'Agents',
      keywords: ['runs', 'history', 'executions', 'board'],
      shortcut: 'G A',
      priority: 40,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/agents')
      },
    },
    {
      id: 'agents.waiting',
      title: 'Runs that need you',
      subtitle: 'Waiting on an approval',
      icon: Diamond,
      group: 'Agents',
      keywords: ['approval', 'waiting', 'needs you', 'pending'],
      priority: 35,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/agents?status=waiting')
      },
    },
    {
      id: 'agents.failed',
      title: 'Failed runs',
      subtitle: 'Last 7 days',
      icon: CircleAlert,
      group: 'Agents',
      keywords: ['errors', 'failures', 'broken'],
      priority: 30,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/agents?status=failed&since=7d')
      },
    },
    {
      id: 'agents.roster',
      title: 'Agent roster',
      subtitle: 'The fleet: who is working, waiting, idle or paused',
      icon: LayoutGrid,
      group: 'Agents',
      keywords: ['agents', 'fleet', 'team', 'roster'],
      priority: 25,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/agents/roster')
      },
    },
  ],
  shortcuts: [
    { keys: 'j', label: 'Next run (or ↓)' },
    { keys: 'k', label: 'Previous run (or ↑)' },
    { keys: 'enter', label: 'Attach the run to the Inspector' },
    { keys: 'mod+enter', label: 'Open the run' },
    { keys: 'space', label: 'Inspect the run' },
    { keys: 'x', label: 'Select runs for Stop, Retry or Approve low-risk' },
    { keys: 'escape', label: 'Clear the selection' },
  ],
}
