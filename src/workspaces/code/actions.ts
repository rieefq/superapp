import { db } from '@/core/db'
import {
  archiveSession, deleteSession, disconnectRepo, refreshRepo, restoreSession, sessionPatch,
} from '@/core/services'
import { getSettings } from '@/core/settings'
import type { ID } from '@/core/types'
import { confirm, copyText, toast } from '@/ui'
import { connectErrorMessage } from './ConnectRepo'
import { patchFilename } from './logic'

/**
 * Session and repository actions shared by the stage header, the review bar, list menus and ⌘K.
 * Each one gives feedback (a toast, Undo where it can be undone) and never throws.
 */

const quote = (s: string) => `“${s.length > 60 ? `${s.slice(0, 59)}…` : s}”`

/** Download the change set as a .patch file. Accepted changes when any, otherwise every proposed change. */
export function exportPatch(sessionId: ID): void {
  const session = db.get('sessions', sessionId)
  if (!session) return
  const accepted = session.changes.some((c) => c.review === 'accepted')
  const patch = sessionPatch(sessionId, accepted ? 'accepted' : 'proposed')
  if (!patch) {
    toast({ title: 'Nothing to export', description: 'This session has no changes yet.' })
    return
  }
  const blob = new Blob([patch], { type: 'text/x-diff' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = patchFilename(session.branch)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast({ tone: 'success', title: `Exported ${a.download}`, description: accepted ? 'The accepted changes, as a unified diff.' : 'Every proposed change (none accepted yet), as a unified diff.' })
}

/** Copy the change set as a unified diff. */
export async function copyDiff(sessionId: ID): Promise<void> {
  const session = db.get('sessions', sessionId)
  if (!session) return
  const accepted = session.changes.some((c) => c.review === 'accepted')
  const patch = sessionPatch(sessionId, accepted ? 'accepted' : 'proposed')
  if (!patch) {
    toast({ title: 'Nothing to copy', description: 'This session has no changes yet.' })
    return
  }
  const ok = await copyText(patch)
  toast(ok ? { tone: 'success', title: 'Diff copied', description: accepted ? 'The accepted changes, as a unified diff.' : 'Every proposed change, as a unified diff.' } : { tone: 'error', title: 'Couldn’t copy the diff', description: 'The browser blocked clipboard access.' })
}

/** Archive with an Undo toast (§3.10: archive uses Undo, not a confirm). */
export function archiveWithUndo(sessionId: ID): void {
  const session = db.get('sessions', sessionId)
  if (!session || session.status === 'archived') return
  archiveSession(sessionId)
  toast({
    title: `Archived ${quote(session.title)}`,
    description: 'Read-only now. Any turn in flight was stopped.',
    duration: 8000,
    action: { label: 'Undo', onClick: () => restoreSession(sessionId) },
  })
}

export function restoreWithToast(sessionId: ID): void {
  const session = restoreSession(sessionId)
  if (session) toast({ title: `Restored ${quote(session.title)}` })
}

/** Delete after a plain confirm (when Settings › Safety asks for one). Resolves true when deleted. */
export async function deleteWithConfirm(sessionId: ID): Promise<boolean> {
  const session = db.get('sessions', sessionId)
  if (!session) return false
  if (getSettings().safety.confirmDestructive) {
    const ok = await confirm({
      title: `Delete ${quote(session.title)}?`,
      description: `The session, its ${session.turns.length === 1 ? 'turn' : `${session.turns.length} turns`} and its proposed changes are removed from this device. Runs stay in Agents › Runs.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return false
  }
  deleteSession(sessionId)
  toast({ title: `Deleted ${quote(session.title)}` })
  return true
}

/** Disconnect after a plain confirm. Resolves true when disconnected. */
export async function disconnectWithConfirm(repoId: ID): Promise<boolean> {
  const repo = db.get('repos', repoId)
  if (!repo) return false
  const sessions = db.filter('sessions', (s) => s.repoId === repoId).length
  const ok = await confirm({
    title: `Disconnect ${repo.fullName}?`,
    description:
      sessions > 0
        ? `Agents can no longer read its files. Its ${sessions === 1 ? 'session keeps its' : `${sessions} sessions keep their`} proposed changes. You can connect it again any time.`
        : 'Agents can no longer read its files. You can connect it again any time.',
    confirmLabel: 'Disconnect',
    tone: 'danger',
  })
  if (!ok) return false
  disconnectRepo(repoId)
  toast({ title: `Disconnected ${repo.fullName}` })
  return true
}

/** Re-read a repository (live from GitHub, or rebuild the demo tree), with the outcome as a toast. */
export async function refreshWithToast(repoId: ID): Promise<void> {
  const repo = db.get('repos', repoId)
  if (!repo) return
  const id = `refresh-${repoId}`
  toast({ id, tone: 'loading', title: repo.provider === 'github' ? `Refreshing ${repo.fullName} from GitHub…` : `Refreshing ${repo.fullName}…`, duration: Infinity, dismissible: false })
  try {
    const next = await refreshRepo(repoId)
    const files = next.tree?.filter((f) => f.type === 'file').length ?? 0
    toast({ id, tone: 'success', title: `Refreshed ${next.fullName}`, description: `${files.toLocaleString('en-US')} files${next.mode === 'live' ? ', read live from GitHub' : ''}.${next.treeTruncated ? ' The tree is partial.' : ''}`, duration: 6000, dismissible: true })
  } catch (err) {
    toast({ id, tone: 'error', title: `Couldn’t refresh ${repo.fullName}`, description: connectErrorMessage(err), duration: 8000, dismissible: true, action: { label: 'Retry', onClick: () => void refreshWithToast(repoId) } })
  }
}
