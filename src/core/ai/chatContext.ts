import { db } from '@/core/db'
import { getContext } from '@/core/context'
import { getIntegration } from '@/core/integrations/catalog'
import { retrieveKnowledge, type RetrievedPassage, type RetrieveOptions } from '@/core/search'
import type { Attachment, Citation, EntityRef, ID, KnowledgeItem, Message, Thread } from '@/core/types'
import { refKey } from '@/core/types'
import { truncate } from '@/lib/format'
import { newId } from '@/lib/id'
import { estimateTokens } from './models'
import { buildSystemPrompt, formatAttachmentBlock, formatAttachmentNote, type KnowledgeDoc } from './prompt'
import type { ChatTurn, ContentPart, ModelInfo } from './types'

/**
 * Context assembly for a chat turn: knowledge retrieval (automatic + explicitly attached),
 * pinned-context summaries, the system prompt and the conversation turns.
 */

export const MAX_CONTEXT_DOCS = 6
const MAX_CONTEXT_LINES = 8
const LEAD_PASSAGE_CHARS = 700

export const REFUSAL_NOTE = '*The model declined this request.*'
export const LENGTH_NOTE = '_The response reached the length limit and may be cut off._'

export interface ContextDoc {
  item: KnowledgeItem
  passage: string
}

function safeRetrieve(query: string, opts: RetrieveOptions): RetrievedPassage[] {
  try {
    return retrieveKnowledge(query, opts)
  } catch (err) {
    console.warn('[chat] knowledge retrieval failed', err)
    return []
  }
}

function dedupeRefs(refs: readonly EntityRef[]): EntityRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const k = refKey(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * What the user chose in the Context Line for this action. "No context reaches a model unless it
 * appears in the Context Line": switched-off chips are excluded, and when the composer reports the
 * exact "Likely" set it showed, automatic retrieval is limited to it.
 */
export interface ContextSelection {
  /** Refs switched off for this action (never sent). Excluding the project drops project memory. */
  exclude?: readonly EntityRef[]
  /** The auto-retrieved knowledge the composer displayed; when set, retrieval is restricted to these. */
  retrieved?: readonly EntityRef[]
}

function excludedKeys(sel: ContextSelection | undefined): Set<string> {
  return new Set((sel?.exclude ?? []).map(refKey))
}

/** Thread context + globally pinned (held) context + the project's pinned memory, minus exclusions. */
export function explicitContextRefs(thread: Thread, sel?: ContextSelection): EntityRef[] {
  const excluded = excludedKeys(sel)
  const projectExcluded = !!thread.projectId && excluded.has(refKey({ kind: 'project', id: thread.projectId }))
  const project = projectExcluded ? undefined : db.get('projects', thread.projectId)
  return dedupeRefs([...thread.contextRefs, ...getContext().pinned.map((p) => p.ref), ...(project?.pinnedRefs ?? [])]).filter(
    (r) => !excluded.has(refKey(r)),
  )
}

/** The opening of an item, cut at a sentence boundary, for items retrieval did not match. */
export function leadPassage(item: KnowledgeItem): string {
  const body = item.content
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  const text = [item.summary?.trim(), body].filter(Boolean).join('\n')
  if (text.length <= LEAD_PASSAGE_CHARS) return text
  const cut = text.slice(0, LEAD_PASSAGE_CHARS)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'))
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`
}

/**
 * Knowledge for a turn: explicitly attached/pinned items first (always included), then
 * automatic retrieval when enabled. Deduped and capped at MAX_CONTEXT_DOCS.
 */
export function gatherKnowledge(
  thread: Thread,
  query: string,
  autoRetrieve: boolean,
  sel?: ContextSelection,
): { docs: ContextDoc[]; searched: boolean } {
  const out = new Map<ID, ContextDoc>()
  const excluded = excludedKeys(sel)
  const explicitIds = explicitContextRefs(thread, sel)
    .filter((r) => r.kind === 'knowledge')
    .map((r) => r.id)
  if (explicitIds.length) {
    const hits = query.trim() ? safeRetrieve(query, { ids: explicitIds, limit: explicitIds.length }) : []
    for (const id of explicitIds) {
      const hit = hits.find((h) => h.item.id === id)
      const item = hit?.item ?? db.get('knowledge', id)
      if (item) out.set(id, { item, passage: hit?.passage?.trim() || leadPassage(item) })
    }
  }
  const allowlist = sel?.retrieved?.filter((r) => r.kind === 'knowledge').map((r) => r.id)
  const searched = autoRetrieve && query.trim().length > 0 && (allowlist === undefined || allowlist.length > 0)
  if (searched) {
    const opts: RetrieveOptions = allowlist ? { ids: allowlist, limit: MAX_CONTEXT_DOCS } : { projectId: thread.projectId, limit: MAX_CONTEXT_DOCS }
    for (const hit of safeRetrieve(query, opts)) {
      if (excluded.has(refKey({ kind: 'knowledge', id: hit.item.id }))) continue
      if (!out.has(hit.item.id) && hit.passage.trim()) out.set(hit.item.id, { item: hit.item, passage: hit.passage.trim() })
    }
  }
  return { docs: [...out.values()].slice(0, MAX_CONTEXT_DOCS), searched }
}

export function toKnowledgeDocs(docs: readonly ContextDoc[]): KnowledgeDoc[] {
  return docs.map((d, i) => ({ index: i + 1, title: d.item.title, passage: d.passage }))
}

export function toCitations(docs: readonly ContextDoc[]): Citation[] {
  return docs.map((d) => ({
    id: newId('cit'),
    ref: { kind: 'knowledge', id: d.item.id },
    title: d.item.title,
    snippet: truncate(d.passage.replace(/\s+/g, ' ').trim(), 280),
    ...(d.item.source.url ? { url: d.item.source.url } : {}),
  }))
}

/** Indexes ([n]) cited in an answer. */
export function citedIndexes(content: string): Set<number> {
  const out = new Set<number>()
  for (const m of content.matchAll(/\[(\d{1,2})\]/g)) out.add(Number(m[1]))
  return out
}

// ---------------------------------------------------------------- pinned context summaries

const q = (s: string) => `“${truncate(s.replace(/\s+/g, ' ').trim(), 90)}”`

/** One-line description of a non-knowledge entity, resolved from the database. */
export function describeRef(ref: EntityRef): string | undefined {
  switch (ref.kind) {
    case 'project': {
      const p = db.get('projects', ref.id)
      return p && `Project: ${q(p.name)}${p.goal ? ` — goal: ${truncate(p.goal, 120)}` : ''}`
    }
    case 'task': {
      const t = db.get('tasks', ref.id)
      return t && `Task: ${q(t.title)} (${t.status.replace('_', ' ')}${t.priority !== 'none' ? `, ${t.priority} priority` : ''})${t.description ? ` — ${truncate(t.description.replace(/\s+/g, ' '), 140)}` : ''}`
    }
    case 'thread': {
      const t = db.get('threads', ref.id)
      return t && `Conversation: ${q(t.title)}`
    }
    case 'message': {
      const m = db.get('messages', ref.id)
      return m && `${m.role === 'user' ? 'User message' : 'Assistant message'}: ${q(m.content)}`
    }
    case 'run': {
      const r = db.get('runs', ref.id)
      return r && `Run: ${q(r.title)} (${r.status})${r.summary ? ` — ${truncate(r.summary, 140)}` : ''}`
    }
    case 'approval': {
      const a = db.get('approvals', ref.id)
      return a && `Approval: ${q(a.title)} (${a.status})`
    }
    case 'agent': {
      const a = db.get('agents', ref.id)
      return a && `Agent: ${a.name} — ${a.role}`
    }
    case 'workflow': {
      const w = db.get('workflows', ref.id)
      return w && `Workflow: ${q(w.name)}${w.description ? ` — ${truncate(w.description, 120)}` : ''}`
    }
    case 'collection': {
      const c = db.get('collections', ref.id)
      return c && `Knowledge collection: ${q(c.name)}`
    }
    case 'investigation': {
      const i = db.get('investigations', ref.id)
      return i && `Research: ${q(i.title)} (${i.status}) — question: ${truncate(i.question, 140)}`
    }
    case 'source': {
      const s = db.get('sources', ref.id)
      return s && `Source: ${q(s.title)}${s.domain ? ` (${s.domain}${s.simulated ? ', simulated' : ''})` : ''}`
    }
    case 'repo': {
      const r = db.get('repos', ref.id)
      return r && `Repository: ${r.fullName}${r.description ? ` — ${truncate(r.description, 120)}` : ''}`
    }
    case 'session': {
      const s = db.get('sessions', ref.id)
      return s && `Coding session: ${q(s.title)} (${s.status.replace('_', ' ')}, branch ${s.branch})`
    }
    case 'asset': {
      const a = db.get('assets', ref.id)
      return a && `Studio asset: ${q(a.title)} (${a.kind})`
    }
    case 'board': {
      const b = db.get('boards', ref.id)
      return b && `Studio board: ${q(b.name)}`
    }
    case 'integration': {
      const def = getIntegration(ref.id)
      const conn = db.get('connections', ref.id)
      return def && `Integration: ${def.name} (${conn?.status ?? 'not connected'})`
    }
    case 'knowledge':
      return undefined
  }
}

/** Summaries of pinned non-knowledge context (the project itself is described separately). */
export function contextSummaries(thread: Thread, sel?: ContextSelection): string[] {
  return explicitContextRefs(thread, sel)
    .filter((r) => r.kind !== 'knowledge' && !(r.kind === 'thread' && r.id === thread.id) && !(r.kind === 'project' && r.id === thread.projectId))
    .map(describeRef)
    .filter((s): s is string => !!s)
    .slice(0, MAX_CONTEXT_LINES)
}

export function systemPromptFor(
  thread: Thread,
  docs: readonly KnowledgeDoc[],
  userName: string,
  now = Date.now(),
  sel?: ContextSelection,
): string {
  const projectExcluded = !!thread.projectId && excludedKeys(sel).has(refKey({ kind: 'project', id: thread.projectId }))
  const project = projectExcluded ? undefined : db.get('projects', thread.projectId)
  return buildSystemPrompt({
    now,
    userName,
    project: project ? { name: project.name, goal: project.goal, instructions: project.instructions } : null,
    context: contextSummaries(thread, sel),
    docs: [...docs],
  })
}

// ---------------------------------------------------------------- conversation turns

const DATA_URL = /^data:([^;,]+);base64,(.+)$/

function imagePart(att: Attachment): ContentPart | undefined {
  const m = att.previewUrl ? DATA_URL.exec(att.previewUrl) : null
  return m ? { type: 'image', mediaType: m[1], dataBase64: m[2] } : undefined
}

/** User turn: typed text + text attachments as labeled fenced blocks; images as parts for vision models. */
export function userTurnContent(message: Message, model: ModelInfo | undefined): ChatTurn['content'] {
  const textParts = [message.content.trim()]
  const images: ContentPart[] = []
  const vision = !!model?.capabilities.includes('vision')
  for (const att of message.attachments ?? []) {
    if (att.text?.trim() && att.kind !== 'image') {
      textParts.push(formatAttachmentBlock(att.name, att.text))
      continue
    }
    const part = att.kind === 'image' && vision ? imagePart(att) : undefined
    if (part) images.push(part)
    else textParts.push(formatAttachmentNote(att.name, att.kind === 'image' ? 'image' : 'file'))
  }
  const text = textParts.filter(Boolean).join('\n\n')
  if (!images.length) return text
  return [...images, ...(text ? [{ type: 'text' as const, text }] : [])]
}

function assistantText(message: Message): string {
  return message.content.replace(`\n\n${REFUSAL_NOTE}`, '').replace(REFUSAL_NOTE, '').replace(`\n\n${LENGTH_NOTE}`, '').trim()
}

function turnTokens(turn: ChatTurn): number {
  return typeof turn.content === 'string'
    ? estimateTokens(turn.content)
    : turn.content.reduce((n, p) => n + (p.type === 'text' ? estimateTokens(p.text) : 1600), 0)
}

/**
 * Conversation turns preceding `assistantMessageId`: completed or stopped messages only
 * (errors and in-flight placeholders are skipped), trimmed from the oldest to fit the model.
 */
export function buildTurns(thread: Thread, assistantMessageId: ID, model: ModelInfo | undefined): ChatTurn[] {
  const end = thread.messageIds.indexOf(assistantMessageId)
  const ids = end === -1 ? thread.messageIds : thread.messageIds.slice(0, end)
  const turns: ChatTurn[] = []
  for (const id of ids) {
    const m = db.get('messages', id)
    if (!m) continue
    if (m.role === 'user') {
      turns.push({ role: 'user', content: userTurnContent(m, model) })
    } else if ((m.status === 'complete' || m.status === 'stopped') && assistantText(m)) {
      turns.push({ role: 'assistant', content: assistantText(m) })
    }
  }
  const budget = Math.floor((model?.contextWindow ?? 128_000) * 0.6)
  let total = turns.reduce((n, t) => n + turnTokens(t), 0)
  while (turns.length > 1 && total > budget) total -= turnTokens(turns.shift() as ChatTurn)
  return turns
}
