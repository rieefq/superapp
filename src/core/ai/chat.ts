import { db, ID_PREFIX, useDB, useRowsByIds } from '@/core/db'
import { useContextStore } from '@/core/context'
import { createRun, cancelRun } from '@/core/runs/service'
import { logActivity } from '@/core/services/activity'
import { link, unlinkAll } from '@/core/services/links'
import { getSettings } from '@/core/settings'
import { isRunActive, ME, sameRef } from '@/core/types'
import type { Attachment, EntityRef, ID, Message, Thread } from '@/core/types'
import { truncate } from '@/lib/format'
import { newId } from '@/lib/id'
import { abortGeneration, activeGenerationIds, startGeneration } from './chatRunner'
import type { ContextSelection } from './chatContext'
import { getModelInfo } from './registry'

/**
 * Chat orchestration used by Chat, Home and the command center. Threads and messages are
 * written here; generation runs in the background (see ./chatRunner) and every turn is a
 * `chat` run so it shows up in the run timeline and analytics.
 */

export const NEW_THREAD_TITLE = 'New conversation'

export { awaitGeneration, isGenerating } from './chatRunner'

// ---------------------------------------------------------------- helpers

const LEAD_IN = [
  /^(?:hey|hi|hello|ok(?:ay)?|so)\b[\s,!.:-]*/i,
  /^(?:please|pls)\b[\s,]*/i,
  /^(?:can|could|would|will) you(?: please)?\s+/i,
  /^(?:i(?:'d| would) like(?: you)? to|i (?:need|want)(?: you)? to|help me(?: to)?)\s+/i,
]
const TRAILING_FILLER = /\s+(?:a|an|the|of|for|to|and|or|with|in|on|at|by|from|about|that|my|our|your)$/i

/**
 * Thread title from a first message: polite lead-ins dropped, first ~7 words, sentence case,
 * no trailing punctuation or dangling filler words.
 */
export function titleFromText(text: string, maxWords = 7): string {
  let s = text
    .replace(/```[\s\S]*?```/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? ''
  s = s.replace(/^[#>\s]+/, '').replace(/[*`~[\]]/g, '').replace(/\s+/g, ' ').trim()
  for (let pass = 0; pass < 3; pass++) {
    const before = s
    for (const re of LEAD_IN) {
      const next = s.replace(re, '')
      if (next.split(' ').length >= 2) s = next
    }
    if (s === before) break
  }
  let words = s.split(' ').filter(Boolean).slice(0, maxWords).join(' ')
  for (let i = 0; i < 3; i++) words = words.replace(/[\s.,!?;:…—–-]+$/u, '').replace(TRAILING_FILLER, '')
  const letters = words.replace(/[^\p{L}]/gu, '')
  const base = letters.length > 3 && letters === letters.toUpperCase() ? words.toLowerCase() : words
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : ''
}

function threadRef(id: ID): EntityRef {
  return { kind: 'thread', id }
}

function newAssistantMessage(threadId: ID, modelId: string, createdAt: number): Message {
  const info = getModelInfo(modelId)
  return {
    id: newId(ID_PREFIX.messages),
    threadId,
    role: 'assistant',
    content: '',
    status: 'streaming',
    createdAt,
    modelId,
    ...(info ? { providerId: info.providerId } : {}),
    simulated: info?.simulated ?? false,
  }
}

/** Create the turn's `chat` run, attach it to the message and start generating in the background. */
function startTurn(threadId: ID, messageId: ID, modelId: string, selection?: ContextSelection): void {
  const thread = db.get('threads', threadId)
  const info = getModelInfo(modelId)
  let runId: ID | undefined
  try {
    runId = createRun({
      kind: 'chat',
      title: thread?.title ?? NEW_THREAD_TITLE,
      simulated: info?.simulated ?? false,
      origin: { kind: 'message', id: messageId },
      projectId: thread?.projectId ?? null,
      modelId,
      initiator: ME,
    }).id
    db.update('messages', messageId, { runId })
  } catch (err) {
    console.warn('[chat] createRun failed', err)
  }
  void startGeneration({ threadId, messageId, modelId, runId, selection })
}

function stopThreadGenerations(thread: Thread): void {
  for (const id of thread.messageIds) abortGeneration(id)
}

// ---------------------------------------------------------------- threads

export interface CreateThreadInput {
  projectId?: ID | null
  title?: string
  modelId?: string
  contextRefs?: EntityRef[]
}

export function createThread(input: CreateThreadInput = {}): Thread {
  const now = Date.now()
  const thread: Thread = {
    id: newId(ID_PREFIX.threads),
    title: input.title?.trim() || NEW_THREAD_TITLE,
    projectId: input.projectId ?? null,
    modelId: input.modelId ?? getSettings().ai.defaultModelId,
    messageIds: [],
    contextRefs: dedupeRefs(input.contextRefs ?? []),
    createdAt: now,
    updatedAt: now,
  }
  db.insert('threads', thread)
  logActivity({ actor: ME, verb: 'started', target: threadRef(thread.id), summary: 'Started a conversation', projectId: thread.projectId })
  return thread
}

function dedupeRefs(refs: readonly EntityRef[]): EntityRef[] {
  const out: EntityRef[] = []
  for (const r of refs) if (!out.some((x) => sameRef(x, r))) out.push({ kind: r.kind, id: r.id })
  return out
}

export function renameThread(threadId: ID, title: string): void {
  const next = title.replace(/\s+/g, ' ').trim()
  const thread = db.get('threads', threadId)
  if (!thread || !next || next === thread.title) return
  db.update('threads', threadId, { title: next, updatedAt: Date.now() })
  logActivity({ actor: ME, verb: 'renamed', target: threadRef(threadId), summary: `Renamed a conversation to “${truncate(next, 60)}”`, projectId: thread.projectId })
}

export function deleteThread(threadId: ID): void {
  const thread = db.get('threads', threadId)
  if (!thread) return
  stopThreadGenerations(thread)
  const messageIds = new Set([...thread.messageIds, ...db.filter('messages', (m) => m.threadId === threadId).map((m) => m.id)])
  for (const id of messageIds) unlinkAll({ kind: 'message', id })
  db.removeMany('messages', [...messageIds])
  unlinkAll(threadRef(threadId))
  db.remove('threads', threadId)
  useContextStore.getState().unpin(threadRef(threadId))
  logActivity({ actor: ME, verb: 'deleted', target: threadRef(threadId), summary: `Deleted the conversation “${truncate(thread.title, 60)}”`, projectId: thread.projectId })
}

export function setThreadPinned(threadId: ID, pinned: boolean): void {
  db.update('threads', threadId, (t) => {
    const { pinned: _p, ...rest } = t
    void _p
    return pinned ? { ...t, pinned: true } : rest
  })
}

export function setThreadArchived(threadId: ID, archived: boolean): void {
  db.update('threads', threadId, (t) => {
    const { archived: _a, ...rest } = t
    void _a
    return archived ? { ...t, archived: true } : rest
  })
}

export function setThreadModel(threadId: ID, modelId: string): void {
  db.update('threads', threadId, { modelId })
}

export function setThreadProject(threadId: ID, projectId: ID | null): void {
  const thread = db.get('threads', threadId)
  if (!thread || thread.projectId === projectId) return
  db.update('threads', threadId, { projectId, updatedAt: Date.now() })
  const project = db.get('projects', projectId)
  logActivity({
    actor: ME,
    verb: 'moved',
    target: threadRef(threadId),
    summary: project ? `Moved “${truncate(thread.title, 60)}” to ${project.name}` : `Removed “${truncate(thread.title, 60)}” from its project`,
    projectId: projectId ?? thread.projectId,
  })
}

export function addThreadContext(threadId: ID, ref: EntityRef): void {
  db.update('threads', threadId, (t) => (t.contextRefs.some((r) => sameRef(r, ref)) ? t : { ...t, contextRefs: [...t.contextRefs, { kind: ref.kind, id: ref.id }] }))
}

export function removeThreadContext(threadId: ID, ref: EntityRef): void {
  db.update('threads', threadId, (t) => (t.contextRefs.some((r) => sameRef(r, ref)) ? { ...t, contextRefs: t.contextRefs.filter((r) => !sameRef(r, ref)) } : t))
}

/** Copy a thread up to and including `uptoMessageId` into a new thread. */
export function forkThread(threadId: ID, uptoMessageId: ID): Thread {
  const thread = db.get('threads', threadId)
  if (!thread) throw new Error('Conversation not found.')
  const idx = thread.messageIds.indexOf(uptoMessageId)
  if (idx === -1) throw new Error('That message is not part of this conversation.')
  const now = Date.now()
  const forkId = newId(ID_PREFIX.threads)
  const copies: Message[] = []
  for (const id of thread.messageIds.slice(0, idx + 1)) {
    const m = db.get('messages', id)
    if (!m) continue
    const { runId: _r, feedback: _f, derived: _d, ...rest } = m
    void _r
    void _f
    void _d
    copies.push({ ...rest, id: newId(ID_PREFIX.messages), threadId: forkId, status: m.status === 'streaming' ? 'stopped' : m.status })
  }
  db.insertMany('messages', copies)
  const fork: Thread = {
    id: forkId,
    title: `${thread.title} (fork)`,
    projectId: thread.projectId,
    modelId: thread.modelId,
    messageIds: copies.map((m) => m.id),
    contextRefs: thread.contextRefs.map((r) => ({ kind: r.kind, id: r.id })),
    forkedFrom: { threadId, messageId: uptoMessageId },
    createdAt: now,
    updatedAt: now,
  }
  db.insert('threads', fork)
  link(threadRef(forkId), threadRef(threadId), 'derived_from')
  logActivity({ actor: ME, verb: 'forked', target: threadRef(forkId), summary: `Forked “${truncate(thread.title, 60)}” into a new conversation`, projectId: thread.projectId })
  return fork
}

// ---------------------------------------------------------------- messages

export interface SendMessageInput {
  /** Omit (or pass an unknown id) to start a new conversation. */
  threadId?: ID
  text: string
  attachments?: Attachment[]
  modelId?: string
  /** Used only when a new thread is created. */
  projectId?: ID | null
  /** Added to the thread's context. */
  contextRefs?: EntityRef[]
  /** Context Line chips the user switched off for this message — never sent to the model. */
  excludeRefs?: EntityRef[]
  /**
   * The exact auto-retrieved ("Likely") knowledge the composer showed. When provided, automatic
   * retrieval is restricted to these items so nothing unseen reaches the model.
   */
  retrievedRefs?: EntityRef[]
}

export interface SendMessageResult {
  threadId: ID
  userMessageId: ID
  assistantMessageId: ID
}

/**
 * Add a user message and a streaming assistant placeholder, then generate in the background.
 * Resolves as soon as both messages exist.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const text = input.text.trim()
  const attachments = input.attachments?.length ? input.attachments : undefined
  if (!text && !attachments) throw new Error('Cannot send an empty message.')

  let thread = input.threadId ? db.get('threads', input.threadId) : undefined
  if (!thread) {
    thread = createThread({ projectId: input.projectId, modelId: input.modelId, contextRefs: input.contextRefs })
  } else {
    stopThreadGenerations(thread)
    for (const ref of input.contextRefs ?? []) addThreadContext(thread.id, ref)
  }
  const modelId = input.modelId ?? thread.modelId ?? getSettings().ai.defaultModelId
  const now = Date.now()
  const title = thread.title === NEW_THREAD_TITLE ? titleFromText(text || attachments?.[0]?.name || '') || NEW_THREAD_TITLE : thread.title

  const userMessage: Message = {
    id: newId(ID_PREFIX.messages),
    threadId: thread.id,
    role: 'user',
    content: text,
    status: 'complete',
    createdAt: now,
    ...(attachments ? { attachments } : {}),
  }
  const assistant = newAssistantMessage(thread.id, modelId, now + 1)
  db.insertMany('messages', [userMessage, assistant])
  db.update('threads', thread.id, (t) => ({ ...t, title, modelId, messageIds: [...t.messageIds, userMessage.id, assistant.id], updatedAt: now }))
  const selection: ContextSelection | undefined =
    input.excludeRefs || input.retrievedRefs ? { exclude: input.excludeRefs, retrieved: input.retrievedRefs } : undefined
  startTurn(thread.id, assistant.id, modelId, selection)
  return { threadId: thread.id, userMessageId: userMessage.id, assistantMessageId: assistant.id }
}

/**
 * Stop a streaming answer, keeping the partial content. Messages left streaming without a
 * live generation (e.g. after a reload) are marked stopped directly.
 */
export function stopGeneration(messageId: ID): void {
  if (abortGeneration(messageId)) return
  const m = db.get('messages', messageId)
  if (m?.status === 'streaming') db.update('messages', messageId, { status: 'stopped' })
}

/** Re-run the answer for the preceding user message, replacing content, reasoning, citations, usage and tools. */
export async function regenerate(assistantMessageId: ID, opts: { modelId?: string } = {}): Promise<void> {
  const message = db.get('messages', assistantMessageId)
  if (!message || message.role !== 'assistant') throw new Error('Only assistant messages can be regenerated.')
  const thread = db.get('threads', message.threadId)
  if (!thread) throw new Error('Conversation not found.')
  const idx = thread.messageIds.indexOf(assistantMessageId)
  const hasPrompt = thread.messageIds.slice(0, idx).some((id) => db.get('messages', id)?.role === 'user')
  if (!hasPrompt) throw new Error('There is no message to answer.')

  abortGeneration(assistantMessageId)
  unlinkAll({ kind: 'message', id: assistantMessageId })
  const modelId = opts.modelId ?? thread.modelId ?? message.modelId ?? getSettings().ai.defaultModelId
  const fresh = newAssistantMessage(thread.id, modelId, message.createdAt)
  db.update('messages', assistantMessageId, () => ({ ...fresh, id: assistantMessageId }))
  db.update('threads', thread.id, { modelId, updatedAt: Date.now() })
  startTurn(thread.id, assistantMessageId, modelId)
}

/** Replace a user message's text, drop everything after it and answer again. */
export async function editAndResend(userMessageId: ID, newText: string): Promise<{ assistantMessageId: ID }> {
  const message = db.get('messages', userMessageId)
  if (!message || message.role !== 'user') throw new Error('Only your own messages can be edited.')
  const text = newText.trim()
  if (!text && !message.attachments?.length) throw new Error('Cannot send an empty message.')
  const thread = db.get('threads', message.threadId)
  if (!thread) throw new Error('Conversation not found.')
  const idx = thread.messageIds.indexOf(userMessageId)
  const following = thread.messageIds.slice(idx + 1)
  for (const id of following) {
    abortGeneration(id)
    unlinkAll({ kind: 'message', id })
  }
  db.removeMany('messages', following)
  db.update('messages', userMessageId, { content: text })
  const assistant = newAssistantMessage(thread.id, thread.modelId, Date.now())
  db.insert('messages', assistant)
  db.update('threads', thread.id, (t) => ({ ...t, messageIds: [...t.messageIds.slice(0, idx + 1), assistant.id], updatedAt: Date.now() }))
  startTurn(thread.id, assistant.id, thread.modelId)
  return { assistantMessageId: assistant.id }
}

export function setFeedback(messageId: ID, feedback: 'up' | 'down' | null): void {
  db.update('messages', messageId, (m) => {
    const { feedback: _f, ...rest } = m
    void _f
    return feedback ? { ...m, feedback } : rest
  })
}

/**
 * Call once at startup: messages left `streaming` by a reload become `stopped` (partial
 * content kept) and their still-active chat runs are cancelled. Returns how many were fixed.
 */
export function recoverInterruptedMessages(): number {
  const live = new Set(activeGenerationIds())
  let recovered = 0
  for (const m of db.filter('messages', (x) => x.status === 'streaming' && !live.has(x.id))) {
    db.update('messages', m.id, { status: 'stopped' })
    recovered++
    const run = m.runId ? db.get('runs', m.runId) : undefined
    if (run && isRunActive(run.status)) {
      try {
        cancelRun(run.id, 'Interrupted: the page was reloaded while the answer was streaming.')
      } catch (err) {
        console.warn('[chat] cancelRun failed', err)
      }
    }
  }
  return recovered
}

// ---------------------------------------------------------------- hooks

/** Messages of a thread in conversation order. */
export function useThreadMessages(threadId: ID | null | undefined): Message[] {
  const ids = useDB((s) => (threadId ? s.threads[threadId]?.messageIds : undefined))
  return useRowsByIds('messages', ids)
}

/** True while any message in the thread is streaming. */
export function useIsGenerating(threadId: ID | null | undefined): boolean {
  return useDB((s) => {
    const t = threadId ? s.threads[threadId] : undefined
    return !!t && t.messageIds.some((id) => s.messages[id]?.status === 'streaming')
  })
}
