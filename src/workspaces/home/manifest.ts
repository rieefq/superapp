import { CornerUpRight, House, Info, ListChecks, NotebookPen, Orbit, Palette, SquareTerminal, Telescope, Workflow } from 'lucide-react'
import { openStartSheet, type StartKind } from '@/app/shell/store'
import type { Command, WorkspaceManifest } from '@/app/types'
import { updateSettings } from '@/core/settings'

const START: { kind: StartKind; title: string; icon: typeof ListChecks; keywords: string[] }[] = [
  { kind: 'task', title: 'New task', icon: ListChecks, keywords: ['todo', 'organize'] },
  { kind: 'research', title: 'New research', icon: Telescope, keywords: ['investigate', 'sources', 'report'] },
  { kind: 'session', title: 'New coding session', icon: SquareTerminal, keywords: ['code', 'build', 'fix', 'forge'] },
  { kind: 'agent', title: 'Give an agent work', icon: Orbit, keywords: ['delegate', 'assign'] },
  { kind: 'workflow', title: 'Run a workflow', icon: Workflow, keywords: ['automation'] },
  { kind: 'note', title: 'New note', icon: NotebookPen, keywords: ['knowledge', 'write'] },
  { kind: 'studio', title: 'New studio draft', icon: Palette, keywords: ['create', 'doc', 'deck', 'image'] },
]

export const manifest: WorkspaceManifest = {
  id: 'home',
  label: 'Home',
  description: 'What needs you, what is moving, and where to pick up.',
  icon: House,
  group: 'home',
  path: '/',
  chord: ['g', 'h'],
  newAction: { label: 'Start something', run: () => openStartSheet('task') },
  commands: (): Command[] => [
    ...START.map((s, i): Command => ({
      id: `home.start.${s.kind}`,
      title: s.title,
      subtitle: 'Opens the Start sheet',
      icon: s.icon,
      group: 'Start',
      keywords: ['start', 'new', ...s.keywords],
      priority: 50 - i,
      run: (ctx) => {
        ctx.close()
        openStartSheet(s.kind)
      },
    })),
    {
      id: 'home.composer',
      title: 'Start anything from Home',
      subtitle: 'Ask, research, build, delegate, create or automate',
      icon: CornerUpRight,
      group: 'Home',
      keywords: ['home', 'composer', 'ask'],
      shortcut: 'G H',
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/')
        // Focus the hero composer once Home is on screen.
        setTimeout(() => document.querySelector<HTMLElement>('#main [data-composer-input]')?.focus(), 60)
      },
    },
    {
      id: 'home.welcome',
      title: 'Show the welcome again',
      subtitle: 'The first-run boot log and primers on Home',
      icon: Info,
      group: 'Home',
      keywords: ['onboarding', 'intro', 'help', 'primer'],
      run: (ctx) => {
        updateSettings('onboarded', false)
        ctx.close()
        ctx.navigate('/')
      },
    },
  ],
  shortcuts: [
    { keys: '/', label: 'Focus the composer' },
    { keys: 'tab', label: 'Change the verb while there is a draft (⇧⇥ goes back)' },
    { keys: 'enter', label: 'Start it here: you go to the work' },
    { keys: 'mod+enter', label: 'Start it in the background: you stay on Home' },
  ],
}
