import { AudioLines, Clapperboard, FileText, FolderPlus, Image, LayoutGrid, Palette, Presentation, Star } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'

/** ⌘K "Generate …" commands: open the contact sheet with the generation bar on that kind, focused. */
const GENERATE: { kind: string; title: string; icon: typeof Image; keywords: string[] }[] = [
  { kind: 'image', title: 'Generate an image', icon: Image, keywords: ['picture', 'visual', 'art', 'illustration', 'photo'] },
  { kind: 'video', title: 'Storyboard a video', icon: Clapperboard, keywords: ['video', 'storyboard', 'shots', 'clip'] },
  { kind: 'presentation', title: 'Draft a deck', icon: Presentation, keywords: ['slides', 'presentation', 'keynote', 'deck'] },
  { kind: 'document', title: 'Write copy', icon: FileText, keywords: ['doc', 'copy', 'landing page', 'email', 'blog', 'social'] },
  { kind: 'audio', title: 'Write a narration', icon: AudioLines, keywords: ['audio', 'voice', 'voice-over', 'narration', 'script'] },
]

export const manifest: WorkspaceManifest = {
  id: 'studio',
  label: 'Studio',
  description: 'Create images, video, decks and copy with generative tools.',
  icon: Palette,
  group: 'make',
  path: '/studio',
  chord: ['g', 's'],
  newAction: { label: 'Generate something new', run: (ctx) => ctx.navigate('/studio?compose=1') },
  commands: (): Command[] => [
    ...GENERATE.map(
      (g, i): Command => ({
        id: `studio.generate.${g.kind}`,
        title: g.title,
        subtitle: 'Studio · simulated generator',
        icon: g.icon,
        group: 'Studio',
        keywords: ['studio', 'create', 'generate', 'new', ...g.keywords],
        priority: 40 - i,
        run: (ctx) => {
          ctx.close()
          ctx.navigate(`/studio?compose=${g.kind}`)
        },
      }),
    ),
    {
      id: 'studio.board.new',
      title: 'New board',
      subtitle: 'Studio · group assets on the contact sheet',
      icon: FolderPlus,
      group: 'Studio',
      keywords: ['studio', 'board', 'collection', 'folder', 'create'],
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/studio?newboard=1')
      },
    },
    {
      id: 'studio.favorites',
      title: 'Studio favorites',
      icon: Star,
      group: 'Studio',
      keywords: ['studio', 'favorite', 'starred'],
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/studio?filter=favorites')
      },
    },
    {
      id: 'studio.sheet',
      title: 'Studio contact sheet',
      subtitle: 'Every asset in scope',
      icon: LayoutGrid,
      group: 'Studio',
      keywords: ['studio', 'assets', 'contact sheet', 'grid'],
      shortcut: 'G S',
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/studio')
      },
    },
  ],
  shortcuts: [
    { keys: '/', label: 'Focus the generation bar (or the Iterate composer on an asset)' },
    { keys: 'enter', label: 'Generate · Iterate (⇧⏎ adds a line)' },
    { keys: 'arrowleft', label: 'Previous version (→ next) on an asset' },
    { keys: '1', label: 'Pick version 1–9 on an asset' },
    { keys: 'space', label: 'Inspect the focused tile · play or pause a storyboard' },
    { keys: '.', label: 'Actions for the focused tile' },
    { keys: 'h', label: 'Hold the focused tile' },
    { keys: 'n', label: 'Show or hide speaker notes while presenting' },
  ],
}
