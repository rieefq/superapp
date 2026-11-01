import { db } from '@/core/db'
import {
  addThreadContext,
  deleteThread,
  forkThread,
  getModelInfo,
  removeThreadContext,
  setThreadArchived,
  setThreadPinned,
} from '@/core/ai'
import { getSettings } from '@/core/settings'
import { refKey, type EntityRef, type ID } from '@/core/types'
import { shortCode } from '@/lib/id'
import { truncate } from '@/lib/format'
import { confirm, copyText, toast } from '@/ui'
import { downloadText, markdownFileName, threadToMarkdown } from './logic/exportMarkdown'

/**
 * Conversation actions shared by the list rows, the stage header, the ⌘K commands and the lens.
 * Each goes through the chat service; the UI only adds confirmation, Undo and feedback.
 */

type Navigate = (to: string, opts?: { replace?: boolean }) => void

export const threadRoute = (id: ID) => `/chat/${encodeURIComponent(id)}`

const title = (id: ID) => truncate(db.get('threads', id)?.title ?? 'this conversation', 60)

/** Delete after a plain confirm (when "Confirm destructive actions" is on). Resolves true when deleted. */
export async function deleteWithConfirm(threadId: ID, opts: { navigate?: Navigate; isOpen?: boolean } = {}): Promise<boolean> {
  const thread = db.get('threads', threadId)
  if (!thread) return false
  if (getSettings().safety.confirmDestructive) {
    const ok = await confirm({
      title: `Delete “${truncate(thread.title, 60)}”?`,
      description: 'The conversation and its messages are removed from this device. Tasks, research and notes made from it stay where they are.',
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return false
  }
  const name = title(threadId)
  try {
    deleteThread(threadId)
  } catch (err) {
    toast({ tone: 'error', title: 'Couldn’t delete the conversation', description: err instanceof Error ? err.message : String(err) })
    return false
  }
  if (opts.isOpen) opts.navigate?.('/chat', { replace: true })
  toast({ title: `Deleted “${name}”` })
  return true
}

/** Archive (or bring back) with an Undo toast — archive is never confirmed (§8.1). */
export function setArchived(threadId: ID, archived: boolean): void {
  setThreadArchived(threadId, archived)
  toast({
    title: archived ? `Archived “${title(threadId)}”` : `Moved “${title(threadId)}” back to your conversations`,
    duration: 8000,
    action: { label: 'Undo', onClick: () => setThreadArchived(threadId, !archived) },
  })
}

export function togglePinned(threadId: ID): void {
  const thread = db.get('threads', threadId)
  if (!thread) return
  setThreadPinned(threadId, !thread.pinned)
}

/** Fork up to and including `messageId`, then open the fork. */
export function forkAndOpen(threadId: ID, messageId: ID, navigate: Navigate): ID | undefined {
  try {
    const fork = forkThread(threadId, messageId)
    navigate(threadRoute(fork.id))
    toast({ title: 'Forked into a new conversation', description: 'The original stays as it was.', action: { label: 'Back to the original', onClick: () => navigate(threadRoute(threadId)) } })
    return fork.id
  } catch (err) {
    toast({ tone: 'error', title: 'Couldn’t fork the conversation', description: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

/** Fork the whole conversation (from its last message). */
export function forkWhole(threadId: ID, navigate: Navigate): void {
  const thread = db.get('threads', threadId)
  const last = thread?.messageIds[thread.messageIds.length - 1]
  if (!thread || !last) {
    toast({ title: 'Nothing to fork yet', description: 'Send a message first.' })
    return
  }
  forkAndOpen(threadId, last, navigate)
}

/** A real Markdown file download of the conversation. */
export function exportMarkdown(threadId: ID): void {
  const thread = db.get('threads', threadId)
  if (!thread) return
  const messages = thread.messageIds.flatMap((id) => db.get('messages', id) ?? [])
  const project = thread.projectId ? db.get('projects', thread.projectId) : undefined
  const md = threadToMarkdown({
    thread,
    messages,
    projectName: project?.name,
    modelLabel: (id) => getModelInfo(id)?.label ?? 'Assistant',
  })
  const file = markdownFileName(thread.title)
  try {
    downloadText(file, md)
    toast({ title: `Exported ${file}`, description: messages.some((m) => m.simulated) ? 'It opens with a note that the answers are simulated.' : undefined })
  } catch (err) {
    toast({ tone: 'error', title: 'Couldn’t export the conversation', description: err instanceof Error ? err.message : String(err) })
  }
}

export async function copyThreadLink(threadId: ID): Promise<void> {
  const ok = await copyText(`${window.location.origin}${threadRoute(threadId)}`)
  toast(ok ? { title: 'Link copied' } : { tone: 'error', title: 'Couldn’t copy the link' })
}

export async function copyHandle(id: ID): Promise<void> {
  const handle = shortCode(id)
  const ok = await copyText(handle)
  toast(ok ? { title: `Copied ${handle}` } : { tone: 'error', title: 'Couldn’t copy the handle' })
}

/** Make the thread's attached context equal `refs` (the Context Line's × and @ edit it). */
export function syncThreadContext(threadId: ID, refs: readonly EntityRef[]): void {
  const thread = db.get('threads', threadId)
  if (!thread) return
  const next = new Set(refs.map(refKey))
  const cur = new Set(thread.contextRefs.map(refKey))
  for (const r of thread.contextRefs) if (!next.has(refKey(r))) removeThreadContext(threadId, r)
  for (const r of refs) if (!cur.has(refKey(r))) addThreadContext(threadId, r)
}
