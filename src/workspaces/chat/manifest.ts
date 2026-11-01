import { Archive, History, ImagePlus, ListChecks, MessagesSquare, NotebookPen, Orbit, Search, SquareTerminal, Telescope } from 'lucide-react'
import type { Command, CommandContext, SlashCommand, WorkspaceManifest } from '@/app/types'
import { db } from '@/core/db'

/** `/` commands of the Chat composer (§6.2). Each opens the Start sheet; the result lands back in the thread. */
export const CHAT_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'research', args: '<question>', description: 'Research a question with sources', icon: Telescope },
  { name: 'task', args: '<title>', description: 'Make a task from this conversation', icon: ListChecks },
  { name: 'agent', args: '<name> <instruction>', description: 'Give an agent work', icon: Orbit },
  { name: 'code', args: '<instruction>', description: 'Start a coding session', icon: SquareTerminal },
  { name: 'image', args: '<prompt>', description: 'Make an image in Studio', icon: ImagePlus },
  { name: 'note', args: '[text]', description: 'Save a note to Knowledge (empty: this conversation)', icon: NotebookPen },
]

function newConversation(ctx: CommandContext): void {
  ctx.close()
  ctx.navigate('/chat/new')
  focusLater('#main [data-composer-input]')
}

function focusLater(selector: string): void {
  // The stage renders after navigation; focus once it is on screen.
  let tries = 0
  const tick = () => {
    const el = document.querySelector<HTMLElement>(selector)
    if (el) el.focus()
    else if (tries++ < 10) setTimeout(tick, 40)
  }
  setTimeout(tick, 30)
}

/** The newest conversation in scope (all work when unscoped). */
function latestThreadId(scope: string | null): string | undefined {
  let best: { id: string; at: number } | undefined
  for (const t of db.all('threads')) {
    if (t.archived || (scope && t.projectId !== scope)) continue
    if (!best || t.updatedAt > best.at) best = { id: t.id, at: t.updatedAt }
  }
  return best?.id
}

export const manifest: WorkspaceManifest = {
  id: 'chat',
  label: 'Chat',
  description: 'Think out loud with AI and turn conversations into action.',
  icon: MessagesSquare,
  group: 'think',
  path: '/chat',
  chord: ['g', 'c'],
  newAction: { label: 'New conversation', run: newConversation },
  composer: { placeholder: 'Ask anything — @ to add context, / for actions', slashCommands: CHAT_SLASH_COMMANDS },
  commands: (ctx): Command[] => [
    {
      id: 'chat.resume',
      title: 'Continue the latest conversation',
      subtitle: ctx.scopeProjectId ? 'The newest thread in this project' : 'The newest thread in all work',
      icon: History,
      group: 'Chat',
      keywords: ['resume', 'last', 'recent', 'continue', 'thread'],
      priority: 40,
      run: (c) => {
        const id = latestThreadId(c.scopeProjectId)
        c.close()
        c.navigate(id ? `/chat/${encodeURIComponent(id)}` : '/chat/new')
        focusLater('#main [data-composer-input]')
      },
    },
    {
      id: 'chat.search',
      title: 'Search conversations',
      subtitle: 'Titles and every message',
      icon: Search,
      group: 'Chat',
      keywords: ['find', 'search', 'history', 'messages'],
      priority: 30,
      run: (c) => {
        c.close()
        if (!c.pathname.startsWith('/chat')) c.navigate('/chat')
        focusLater('[data-region="list"] [data-search-input]')
      },
    },
    {
      id: 'chat.archived',
      title: 'Archived conversations',
      icon: Archive,
      group: 'Chat',
      keywords: ['archive', 'archived', 'hidden', 'old'],
      priority: 10,
      run: (c) => {
        c.close()
        c.navigate('/chat?view=archived')
      },
    },
  ],
  shortcuts: [
    { keys: 'mod+shift+o', label: 'New conversation' },
    { keys: 'enter', label: 'Send (⇧⏎ adds a line)' },
    { keys: 'arrowup', label: 'Edit your last message (in an empty composer)' },
    { keys: 'mod+.', label: 'Stop the answer' },
    { keys: 'j', label: 'Next message (K: previous) while a message is focused' },
    { keys: 'f', label: 'Fork from the focused message' },
    { keys: 'e', label: 'Edit the focused message' },
    { keys: 'c', label: 'Copy the focused message' },
    { keys: 'f2', label: 'Rename the focused conversation in the list' },
    { keys: 'shift+f10', label: 'Actions for the focused conversation in the list' },
  ],
}
