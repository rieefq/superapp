import { Archive, ArchiveRestore, Copy, Layers, Link2, ListChecks, Pause, Play, Settings2, Trash2 } from 'lucide-react'
import { toggleHold } from '@/app/shell/scope'
import { getContext } from '@/core/context'
import { db } from '@/core/db'
import { deleteAgent, duplicateAgent, pauseAgent, resumeAgent, setAgentStatus } from '@/core/services'
import { getSettings } from '@/core/settings'
import type { Agent, ID } from '@/core/types'
import { shortCode } from '@/lib/id'
import { confirm, toast, type MenuItem } from '@/ui'
import { openGiveWork } from './GiveWork'
import { count } from './logic'

/* Agent lifecycle actions with their feedback (§8.1: archive uses an Undo toast; delete confirms). */

type Navigate = (to: string) => void

const agentPath = (id: ID) => `/agents/${encodeURIComponent(id)}`

export function pauseWithFeedback(agent: Pick<Agent, 'id' | 'name'>): void {
  const paused = pauseAgent(agent.id)
  toast({
    title: `Paused ${agent.name}`,
    description: paused ? `${count(paused, 'run')} paused with it. Nothing new starts until you resume.` : 'It takes no new work until you resume it.',
    action: { label: 'Undo', onClick: () => resumeAgent(agent.id) },
  })
}

export function resumeWithFeedback(agent: Pick<Agent, 'id' | 'name'>): void {
  const resumed = resumeAgent(agent.id)
  toast({ title: `Resumed ${agent.name}`, description: resumed ? `${count(resumed, 'run')} picked up where it stopped.` : 'It can take new work again.' })
}

export function duplicateWithFeedback(agent: Pick<Agent, 'id' | 'name'>, navigate: Navigate): void {
  const copy = duplicateAgent(agent.id)
  if (!copy) return
  toast({ title: `Duplicated ${agent.name}`, description: `“${copy.name}” has the same instructions and abilities. Its schedule starts off.`, action: { label: 'Open', onClick: () => navigate(agentPath(copy.id)) } })
}

export function archiveWithUndo(agent: Pick<Agent, 'id' | 'name'>, navigate?: Navigate): void {
  const active = db.filter('runs', (r) => r.agentId === agent.id && ['queued', 'running', 'waiting', 'paused'].includes(r.status)).length
  setAgentStatus(agent.id, 'archived')
  toast({
    title: `Archived ${agent.name}`,
    description: active ? `It takes no new work. ${count(active, 'run')} in flight finish as planned.` : 'It takes no new work. Its runs and notes stay.',
    duration: 8000,
    action: { label: 'Undo', onClick: () => setAgentStatus(agent.id, 'active') },
  })
  navigate?.('/agents/roster')
}

export function restoreWithFeedback(agent: Pick<Agent, 'id' | 'name'>): void {
  setAgentStatus(agent.id, 'active')
  toast({ title: `Restored ${agent.name}`, description: 'It can take new work again.' })
}

export async function deleteWithConfirm(agent: Pick<Agent, 'id' | 'name'>, navigate?: Navigate): Promise<boolean> {
  const active = db.filter('runs', (r) => r.agentId === agent.id && ['queued', 'running', 'waiting', 'paused'].includes(r.status)).length
  const tasks = db.filter('tasks', (t) => t.assignee?.type === 'agent' && t.assignee.id === agent.id).length
  if (getSettings().safety.confirmDestructive) {
    const ok = await confirm({
      title: `Delete ${agent.name}?`,
      description: [
        active ? `${count(active, 'run')} in flight will be stopped.` : undefined,
        tasks ? `${count(tasks, 'task')} assigned to ${agent.name} will be unassigned.` : undefined,
        'Its run history and the notes it saved stay. This can’t be undone; archive it instead to keep it around.',
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: 'Delete agent',
      tone: 'danger',
      icon: Trash2,
    })
    if (!ok) return false
  }
  deleteAgent(agent.id)
  toast({ title: `Deleted ${agent.name}` })
  navigate?.('/agents/roster')
  return true
}

async function copyText(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error(`Couldn’t copy the ${what.toLowerCase()}`)
  }
}

/** The ⋯ menu for an agent (roster cards, the agent page header). */
export function agentMenuItems(agent: Agent, navigate: Navigate, opts: { onPage?: boolean } = {}): MenuItem[] {
  const held = getContext().pinned.some((p) => p.ref.kind === 'agent' && p.ref.id === agent.id)
  const items: MenuItem[] = []
  if (agent.status === 'archived') {
    items.push({ id: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => restoreWithFeedback(agent) })
  } else {
    if (!opts.onPage) items.push({ id: 'assign', label: 'Assign a task…', icon: ListChecks, disabled: agent.status !== 'active', onSelect: () => openGiveWork(agent.id, 'task') })
    items.push(
      agent.status === 'paused'
        ? { id: 'resume', label: 'Resume agent', icon: Play, onSelect: () => resumeWithFeedback(agent) }
        : { id: 'pause', label: 'Pause agent', icon: Pause, description: 'Takes no new work; running work pauses', onSelect: () => pauseWithFeedback(agent) },
    )
  }
  if (!opts.onPage) items.push({ id: 'configure', label: 'Configure', icon: Settings2, onSelect: () => navigate(`${agentPath(agent.id)}/configure`) })
  items.push(
    { id: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => duplicateWithFeedback(agent, navigate) },
    { id: 'hold', label: held ? 'Release' : 'Hold', icon: Layers, shortcut: opts.onPage ? 'h' : undefined, onSelect: () => toggleHold({ kind: 'agent', id: agent.id }) },
    { type: 'separator' },
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copyText(`${window.location.origin}${agentPath(agent.id)}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => void copyText(shortCode(agent.id), 'Handle') },
    { type: 'separator' },
  )
  if (agent.status !== 'archived') items.push({ id: 'archive', label: 'Archive', icon: Archive, onSelect: () => archiveWithUndo(agent, opts.onPage ? navigate : undefined) })
  items.push({ id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void deleteWithConfirm(agent, navigate) })
  return items
}
