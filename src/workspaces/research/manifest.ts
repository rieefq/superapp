import { FileText, Telescope } from 'lucide-react'
import type { Command, CommandContext, WorkspaceManifest } from '@/app/types'
import { db } from '@/core/db'

/** The latest investigation with a report, preferring the scoped project. */
function latestReport(ctx: CommandContext) {
  return db
    .filter('investigations', (i) => !!i.report?.trim() && (!ctx.scopeProjectId || i.projectId === ctx.scopeProjectId))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

export const manifest: WorkspaceManifest = {
  id: 'research',
  label: 'Research',
  description: 'Investigate questions, gather sources, synthesize reports.',
  icon: Telescope,
  group: 'think',
  path: '/research',
  chord: ['g', 'r'],
  newAction: {
    label: 'New investigation',
    run: (ctx) => ctx.navigate('/research/new'),
  },
  composer: { placeholder: 'Ask a follow-up — Scout searches again and adds a section' },
  defaultInspectorTab: 'item',
  commands: (ctx): Command[] => {
    const latest = latestReport(ctx)
    return [
      {
        id: 'research.new',
        title: 'New investigation',
        subtitle: 'Ask a question worth a report',
        icon: Telescope,
        group: 'Create',
        keywords: ['research', 'investigate', 'question', 'sources', 'report', 'brief'],
        shortcut: 'N',
        priority: 40,
        run: (c) => {
          c.close()
          c.navigate('/research/new')
        },
      },
      ...(latest
        ? [
            {
              id: 'research.latest',
              title: 'Open the latest report',
              subtitle: latest.title,
              icon: FileText,
              group: 'Research',
              keywords: ['report', 'research', 'findings', 'sources'],
              run: (c: CommandContext) => {
                c.close()
                c.navigate(`/research/${latest.id}`)
              },
            } satisfies Command,
          ]
        : []),
    ]
  },
  shortcuts: [
    { keys: 'n', label: 'New investigation' },
    { keys: 'enter', label: 'Start research from the brief (you go to it)' },
    { keys: 'mod+enter', label: 'Start research in the background' },
    { keys: 't', label: 'Turn the report into a discussion, tasks, a coding session or a deck' },
    { keys: 's', label: 'Save the report to Knowledge (or open the saved copy)' },
    { keys: 'h', label: 'Hold the report, or the selected source' },
    { keys: 'space', label: 'Inspect the focused source' },
  ],
}
