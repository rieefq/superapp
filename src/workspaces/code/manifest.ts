import { FileDiff, FolderGit2, Plug, SquareCode, SquareTerminal } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'
import { db } from '@/core/db'

/** Sessions waiting for review, newest first (for ⌘K: "Review changes: …"). Read at call time, never subscribed. */
function reviewCommands(scope: string | null): Command[] {
  return db
    .filter('sessions', (s) => s.status === 'needs_review' && (!scope || s.projectId === scope))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
    .map((s, i): Command => ({
      id: `code.review.${s.id}`,
      title: `Review changes: ${s.title}`,
      subtitle: `${s.changes.length} ${s.changes.length === 1 ? 'file' : 'files'} · ${s.branch}`,
      icon: FileDiff,
      group: 'Code',
      keywords: ['review', 'diff', 'session', s.branch],
      priority: 40 - i,
      run: (ctx) => {
        ctx.close()
        ctx.navigate(`/code/${encodeURIComponent(s.id)}/changes`)
      },
    }))
}

export const manifest: WorkspaceManifest = {
  id: 'code',
  label: 'Code',
  description: 'Delegate software work to coding agents and review their changes.',
  icon: SquareCode,
  group: 'make',
  path: '/code',
  chord: ['g', 'x'],
  newAction: { label: 'New coding session', run: (ctx) => ctx.navigate('/code/new') },
  composer: { placeholder: 'Instruct Forge…' },
  defaultInspectorTab: 'item',
  inspectorDefaultOpen: false,
  commands: (ctx): Command[] => [
    {
      id: 'code.new',
      title: 'New coding session',
      subtitle: 'Repository, instruction, agent and approval policy',
      icon: SquareTerminal,
      group: 'Code',
      keywords: ['code', 'session', 'build', 'fix', 'forge', 'start'],
      shortcut: 'N',
      priority: 60,
      run: (c) => {
        c.close()
        c.navigate('/code/new')
      },
    },
    {
      id: 'code.connect',
      title: 'Connect a repository',
      subtitle: 'GitHub (read live) or the demo repository',
      icon: Plug,
      group: 'Code',
      keywords: ['github', 'repo', 'repository', 'connect', 'import'],
      priority: 50,
      run: (c) => {
        c.close()
        c.navigate('/code?connect=1')
      },
    },
    {
      id: 'code.repos',
      title: 'Open the repositories',
      subtitle: 'Code home: sessions and connected repositories',
      icon: FolderGit2,
      group: 'Code',
      keywords: ['repositories', 'repos', 'files', 'explorer'],
      priority: 30,
      run: (c) => {
        c.close()
        c.navigate('/code')
      },
    },
    ...reviewCommands(ctx.scopeProjectId),
  ],
  shortcuts: [
    { keys: 'n', label: 'New coding session' },
    { keys: 'j', label: 'Changes: next file' },
    { keys: 'k', label: 'Changes: previous file' },
    { keys: 'a', label: 'Changes: accept the file' },
    { keys: 'r', label: 'Changes: reject the file' },
    { keys: 'u', label: 'Changes: clear the decision' },
    { keys: 'v', label: 'Changes: unified or split diff' },
    { keys: 'mod+.', label: 'Stop the running turn' },
  ],
}
