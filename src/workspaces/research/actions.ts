import { useSyncExternalStore } from 'react'
import { openStartSheet } from '@/app/shell/store'
import { createThread } from '@/core/ai'
import { db, useDB } from '@/core/db'
import { activeResearchRun, askFollowUp, deleteInvestigation, isInvestigationSimulated, link, logActivity } from '@/core/services'
import { getSettings } from '@/core/settings'
import { ME, type EntityRef, type Finding, type ID, type Investigation } from '@/core/types'
import { shortCode } from '@/lib/id'
import { confirm, toast } from '@/ui'
import { exportFileName, findingsBrief, reportMarkdown } from './logic'

/**
 * Research hand-offs and file actions. Every hand-off goes through a service or the Start sheet, so
 * origins, `derived_from` links and activity are recorded (§7.1).
 */

const invRef = (id: ID): EntityRef => ({ kind: 'investigation', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

/**
 * Discuss in Chat: a new conversation in the investigation's project with the report attached as
 * context (it rides along in every turn). An empty discussion started earlier is reused.
 */
export function discussInChat(id: ID): ID | undefined {
  const inv = db.get('investigations', id)
  if (!inv) return undefined
  const ref = invRef(id)
  const existing = db
    .filter('threads', (t) => t.messageIds.length === 0 && !t.archived && t.contextRefs.some((r) => r.kind === 'investigation' && r.id === id))
    .sort((a, b) => b.createdAt - a.createdAt)[0]
  if (existing) return existing.id
  const thread = createThread({ projectId: inv.projectId, title: `Discuss: ${inv.title}`, contextRefs: [ref] })
  link({ kind: 'thread', id: thread.id }, ref, 'derived_from')
  logActivity({ actor: ME, verb: 'handed_off', target: { kind: 'thread', id: thread.id }, summary: `Started a conversation about ${quoted(inv.title)}`, projectId: inv.projectId, meta: { from: ref } })
  return thread.id
}

/** "Send to Code": the Start sheet (Coding session) with the findings quoted in the prompt. */
export function sendFindingsToCode(inv: Investigation, findings: readonly Finding[]): void {
  const picked = findings.length ? findings : inv.findings
  const sources = inv.sourceIds.flatMap((sid) => db.get('sources', sid) ?? [])
  openStartSheet('session', {
    source: invRef(inv.id),
    prefill: {
      title: picked.length === 1 ? picked[0].text.slice(0, 72) : `Apply findings: ${inv.title}`,
      brief: findingsBrief(inv, picked, sources),
    },
  })
}

/** "Make a deck": the Start sheet (Studio · Deck) from the report. */
export function makeDeck(inv: Investigation): void {
  openStartSheet('studio', {
    source: invRef(inv.id),
    prefill: {
      studioKind: 'presentation',
      title: `${inv.title} — deck`,
      brief: `A short deck from the report “${inv.title}”: the question, the key findings with their confidence, recommendations and open questions. Cite the report.`,
    },
  })
}

/** A task from one finding, reviewed in the Start sheet (assignee, priority, due). */
export function taskFromFinding(inv: Investigation, finding: Finding): void {
  const sources = inv.sourceIds.flatMap((sid) => db.get('sources', sid) ?? [])
  const title = finding.text.length > 90 ? `${finding.text.slice(0, finding.text.lastIndexOf(' ', 88)).trimEnd()}…` : finding.text
  openStartSheet('task', {
    source: invRef(inv.id),
    prefill: { title, brief: findingsBrief(inv, [finding], sources), projectId: inv.projectId },
  })
}

/** Download the report as Markdown (with the simulated-content notice when it applies). */
export function exportReport(inv: Investigation): { fileName: string } {
  const sources = inv.sourceIds.flatMap((sid) => db.get('sources', sid) ?? [])
  const lastRun = inv.runIds.length ? db.get('runs', inv.runIds[inv.runIds.length - 1]) : undefined
  const text = reportMarkdown({
    inv,
    sources,
    generatedAt: lastRun?.startedAt ?? lastRun?.createdAt ?? inv.updatedAt,
    simulated: isInvestigationSimulated(inv),
    handle: shortCode(inv.id),
  })
  const fileName = exportFileName(inv.title)
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
  logActivity({ actor: ME, verb: 'exported', target: invRef(inv.id), summary: `Exported the report of ${quoted(inv.title)} as Markdown`, projectId: inv.projectId })
  return { fileName }
}

/** Delete with a confirm (when Settings › Safety asks before destructive actions). Resolves true when deleted. */
export async function confirmDelete(inv: Investigation): Promise<boolean> {
  if (getSettings().safety.confirmDestructive) {
    const sources = inv.sourceIds.length
    const ok = await confirm({
      title: `Delete “${inv.title}”?`,
      description: `Its report, ${inv.findings.length} finding${inv.findings.length === 1 ? '' : 's'} and ${sources} source${sources === 1 ? '' : 's'} are removed from this device. Runs stay in Agents › Runs, and anything saved to Knowledge stays there.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return false
  }
  deleteInvestigation(inv.id)
  toast({ title: 'Investigation deleted' })
  return true
}

// ------------------------------------------------------------------------------------------------ follow-up queue

/**
 * Follow-ups asked while a run works are queued — no steering mid-run (§8.1) — and start, in order,
 * when the investigation's run ends. The queue lives for this session; it survives moving around
 * Atrium but not a reload (the composer says so).
 */
export interface QueuedFollowUp {
  question: string
  context: EntityRef[]
  memory: boolean
}

const queues = new Map<ID, QueuedFollowUp[]>()
const queueListeners = new Set<() => void>()
const NONE: QueuedFollowUp[] = []
let unwatch: (() => void) | null = null

function emitQueue() {
  queueListeners.forEach((l) => l())
}

function pump(id: ID): void {
  const list = queues.get(id)
  if (!list?.length) return
  const inv = db.get('investigations', id)
  if (!inv) {
    queues.delete(id)
    emitQueue()
    return
  }
  if (activeResearchRun(inv)) return
  const [next, ...rest] = list
  if (rest.length) queues.set(id, rest)
  else queues.delete(id)
  emitQueue()
  askFollowUp(id, next.question, { context: next.context, memory: next.memory })
}

function watch(): void {
  if (unwatch) return
  unwatch = useDB.subscribe((s, prev) => {
    if (s.runs === prev.runs && s.investigations === prev.investigations) return
    for (const id of [...queues.keys()]) pump(id)
    if (!queues.size && unwatch) {
      unwatch()
      unwatch = null
    }
  })
}

/** Queue a follow-up (it starts right away when nothing is running). */
export function queueFollowUp(id: ID, item: QueuedFollowUp): void {
  queues.set(id, [...(queues.get(id) ?? []), item])
  emitQueue()
  watch()
  pump(id)
}

export function cancelQueuedFollowUp(id: ID, index: number): QueuedFollowUp | undefined {
  const list = queues.get(id)
  if (!list?.[index]) return undefined
  const removed = list[index]
  const rest = list.filter((_, i) => i !== index)
  if (rest.length) queues.set(id, rest)
  else queues.delete(id)
  emitQueue()
  return removed
}

/** Follow-ups waiting for the investigation's run to end (live). */
export function useQueuedFollowUps(id: ID): QueuedFollowUp[] {
  return useSyncExternalStore(
    (l) => {
      queueListeners.add(l)
      return () => queueListeners.delete(l)
    },
    () => queues.get(id) ?? NONE,
    () => NONE,
  )
}
