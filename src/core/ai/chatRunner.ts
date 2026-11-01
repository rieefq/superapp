import { db } from '@/core/db'
import { addUsage, appendStep, cancelRun, completeRun, failRun, updateStep } from '@/core/runs/service'
import { link } from '@/core/services/links'
import { getSettings } from '@/core/settings'
import type { EntityRef, ID, Message, ToolTrace, Usage } from '@/core/types'
import { truncate } from '@/lib/format'
import { hashString } from '@/lib/rng'
import { newId } from '@/lib/id'
import {
  buildTurns,
  citedIndexes,
  gatherKnowledge,
  LENGTH_NOTE,
  REFUSAL_NOTE,
  systemPromptFor,
  toCitations,
  toKnowledgeDocs,
  type ContextSelection,
} from './chatContext'
import { estimateCost } from './models'
import { checkModel, unavailableMessage } from './registry'
import type { ModelProvider, StreamEvent } from './types'

/**
 * The generation engine behind chat: streams a provider into an assistant message, keeps the
 * run timeline in sync and finalizes the message exactly once (complete, stopped, error).
 */

/** Database writes for streaming deltas happen at most this often. */
export const FLUSH_INTERVAL_MS = 50

type ErrorCode = NonNullable<Extract<StreamEvent, { type: 'error' }>['code']>

interface Generation {
  controller: AbortController
  done: Promise<void>
}

const generations = new Map<ID, Generation>()

export function isGenerating(messageId: ID): boolean {
  return generations.has(messageId)
}

/** Abort an in-flight generation. Returns false when nothing was running for the message. */
export function abortGeneration(messageId: ID): boolean {
  const gen = generations.get(messageId)
  if (!gen) return false
  gen.controller.abort()
  return true
}

/** Resolves when the message's current generation has finished (immediately if none). */
export function awaitGeneration(messageId: ID): Promise<void> {
  return generations.get(messageId)?.done ?? Promise.resolve()
}

/** Run-service calls must never break chat: failures are logged and ignored. */
function safely<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn()
  } catch (err) {
    console.warn(`[chat] ${label} failed`, err)
    return undefined
  }
}

function providerLabel(provider: ModelProvider | undefined): string {
  if (!provider) return 'The model provider'
  if (provider.id === 'openai-compatible') return 'The custom endpoint'
  if (provider.id === 'simulator') return 'The simulator'
  return provider.label
}

/** Friendly, actionable error text per error code; provider detail is kept when it helps. */
export function friendlyError(code: ErrorCode | undefined, detail: string | undefined, provider: ModelProvider | undefined): string {
  const p = providerLabel(provider)
  const d = detail?.trim()
  switch (code) {
    case 'auth':
      return d || `${p} rejected the credentials. Check your API key in Integrations.`
    case 'rate_limit':
      return `${p} is rate limiting requests right now. Wait a moment, then retry.`
    case 'network':
      return d || `Couldn't reach ${p.replace(/^The /, 'the ')}. Check your connection and try again.`
    case 'overloaded':
      return `${p} is overloaded or temporarily unavailable. Try again in a minute.`
    case 'bad_request':
      return `${p} couldn't process this request${d ? `: ${d}` : '.'}`
    default:
      return `Something went wrong while generating${d ? `: ${d}` : '.'}`
  }
}

function runSummary(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('```')) ?? content
  return truncate(firstLine.replace(/[*_`>#]/g, '').trim(), 160)
}

export interface GenerationInput {
  threadId: ID
  messageId: ID
  modelId: string
  runId?: ID
  /** The Context Line selection for this turn (exclusions + the exact retrieved set). */
  selection?: ContextSelection
}

/**
 * Start generating into an existing assistant placeholder. Registers the abort controller
 * synchronously (so stop works immediately) and does the work in the background.
 */
export function startGeneration(input: GenerationInput): Promise<void> {
  generations.get(input.messageId)?.controller.abort()
  const controller = new AbortController()
  const gen: Generation = { controller, done: Promise.resolve() }
  generations.set(input.messageId, gen)
  gen.done = generate(input, gen).finally(() => {
    if (generations.get(input.messageId) === gen) generations.delete(input.messageId)
  })
  return gen.done
}

async function generate(input: GenerationInput, gen: Generation): Promise<void> {
  // Let the caller render the user message and placeholder before any work happens.
  await Promise.resolve()
  const { threadId, messageId, modelId, runId } = input
  const signal = gen.controller.signal
  const isCurrent = () => generations.get(messageId) === gen
  const patchMessage = (patch: Partial<Message> | ((m: Message) => Message)) => {
    if (isCurrent()) db.update('messages', messageId, patch)
  }
  const touchThread = () =>
    isCurrent() && db.update('threads', threadId, (t) => ({ ...t, updatedAt: Date.now(), modelId }))

  const check = checkModel(modelId)
  const provider = check.provider
  if (!check.available || !check.model || !provider) {
    const error = unavailableMessage(modelId) ?? 'This model is unavailable.'
    patchMessage({ status: 'error', error })
    if (runId) safely('failRun', () => failRun(runId, error))
    touchThread()
    return
  }
  const model = check.model
  const thread = db.get('threads', threadId)
  const message = db.get('messages', messageId)
  if (!thread || !message) {
    // Deleted before generation started: close the run so it does not stay "running".
    if (runId) safely('cancelRun', () => cancelRun(runId, 'The conversation was deleted.'))
    return
  }
  const settings = getSettings()

  // --- Retrieval ------------------------------------------------------------
  const idx = thread.messageIds.indexOf(messageId)
  const prevUser = thread.messageIds
    .slice(0, idx === -1 ? undefined : idx)
    .map((id) => db.get('messages', id))
    .filter((m): m is Message => !!m && m.role === 'user')
    .pop()
  const query = prevUser?.content.trim() ?? ''
  const searchStartedAt = Date.now()
  const { docs, searched } = gatherKnowledge(thread, query, settings.ai.autoRetrieve, input.selection)
  const refs: EntityRef[] = docs.map((d) => ({ kind: 'knowledge', id: d.item.id }))
  const citations = toCitations(docs)
  const tools: ToolTrace[] = []
  if (searched || docs.length) {
    const n = docs.length
    const label = searched ? 'Searched knowledge' : 'Read pinned context'
    tools.push({
      id: newId('tool'),
      name: 'knowledge.search',
      label,
      detail: `${n} result${n === 1 ? '' : 's'}`,
      status: 'done',
      results: refs,
    })
    if (runId) {
      safely('appendStep(search)', () =>
        appendStep(runId, {
          kind: 'search',
          title: label,
          status: 'done',
          tool: 'knowledge.search',
          capability: 'knowledge.read',
          input: query,
          output: n ? docs.map((d, i) => `[${i + 1}] ${d.item.title}`).join('\n') : 'No matching knowledge.',
          refs,
          startedAt: searchStartedAt,
          endedAt: Date.now(),
        }),
      )
    }
  }
  patchMessage((m) => ({ ...m, ...(citations.length ? { citations } : {}), ...(tools.length ? { tools } : {}) }))

  // --- Request --------------------------------------------------------------
  const request = {
    modelId,
    system: systemPromptFor(thread, toKnowledgeDocs(docs), settings.profile.name, Date.now(), input.selection),
    messages: buildTurns(thread, messageId, model),
    effort: settings.ai.effort,
    reasoning: settings.ai.showReasoning,
    seed: hashString(runId ?? messageId),
  }
  const stepId = runId
    ? safely('appendStep(message)', () => appendStep(runId, { kind: 'message', title: 'Generated response', status: 'running', startedAt: Date.now(), tool: model.label }))?.id
    : undefined

  // --- Stream ---------------------------------------------------------------
  let content = ''
  let reasoning = ''
  let usage: Usage | undefined
  let outcome: { kind: 'done'; stopReason: 'end' | 'max_tokens' | 'refusal' | 'stopped' } | { kind: 'error'; code?: ErrorCode; error: string } | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    flushTimer = undefined
    patchMessage((m) => ({ ...m, content, ...(settings.ai.showReasoning && reasoning ? { reasoning } : {}) }))
  }
  const scheduleFlush = () => {
    flushTimer ??= setTimeout(flush, FLUSH_INTERVAL_MS)
  }

  try {
    for await (const ev of provider.stream(request, signal)) {
      if (ev.type === 'text') {
        content += ev.delta
        scheduleFlush()
      } else if (ev.type === 'reasoning') {
        reasoning += ev.delta
        if (settings.ai.showReasoning) scheduleFlush()
      } else if (ev.type === 'usage') {
        usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: estimateCost(modelId, ev.inputTokens, ev.outputTokens) }
      } else if (ev.type === 'done') {
        outcome = { kind: 'done', stopReason: ev.stopReason }
        break
      } else {
        outcome = { kind: 'error', code: ev.code, error: ev.error }
        break
      }
    }
  } catch (err) {
    outcome = signal.aborted ? { kind: 'done', stopReason: 'stopped' } : { kind: 'error', code: 'unknown', error: err instanceof Error ? err.message : String(err) }
  }
  if (flushTimer) clearTimeout(flushTimer)
  if (!outcome) {
    outcome = signal.aborted
      ? { kind: 'done', stopReason: 'stopped' }
      : content.trim()
        ? { kind: 'done', stopReason: 'end' }
        : { kind: 'error', code: 'unknown', error: 'The model returned an empty response.' }
  }

  // --- Finalize ---------------------------------------------------------------
  if (usage) {
    const u = usage
    if (runId && (u.inputTokens || u.outputTokens)) safely('addUsage', () => addUsage(runId, u))
  }
  const base = { ...(settings.ai.showReasoning && reasoning ? { reasoning } : {}), ...(usage ? { usage } : {}) }
  const endedAt = Date.now()
  const finishStep = (patch: Parameters<typeof updateStep>[2]) => {
    if (runId && stepId) safely('updateStep', () => updateStep(runId, stepId, { endedAt, tokens: usage?.outputTokens, ...patch }))
  }

  if (outcome.kind === 'error') {
    const error = friendlyError(outcome.code, outcome.error, provider)
    patchMessage((m) => ({ ...m, ...base, content, status: 'error', error }))
    finishStep({ status: 'failed', error, output: content ? truncate(content, 4000) : undefined })
    if (runId) safely('failRun', () => failRun(runId, error))
  } else if (outcome.stopReason === 'stopped') {
    patchMessage((m) => ({ ...m, ...base, content, status: 'stopped' }))
    finishStep({ status: 'done', detail: 'Stopped by the user before it finished.', output: content ? truncate(content, 4000) : undefined })
    if (runId) safely('cancelRun', () => cancelRun(runId, 'Stopped by the user'))
  } else if (outcome.stopReason === 'refusal') {
    const final = content.trim() ? `${content.trimEnd()}\n\n${REFUSAL_NOTE}` : REFUSAL_NOTE
    patchMessage((m) => ({ ...m, ...base, content: final, status: 'complete', error: 'refusal' }))
    finishStep({ status: 'done', detail: 'The model declined this request.', output: truncate(final, 4000) })
    if (runId) safely('completeRun', () => completeRun(runId, { summary: 'The model declined this request.' }))
  } else {
    const final = outcome.stopReason === 'max_tokens' ? `${content.trimEnd()}\n\n${LENGTH_NOTE}` : content
    patchMessage((m) => {
      const { error: _drop, ...rest } = m
      void _drop
      return { ...rest, ...base, content: final, status: 'complete' }
    })
    finishStep({ status: 'done', output: truncate(final, 4000) })
    if (runId) safely('completeRun', () => completeRun(runId, { summary: runSummary(final) }))
    if (isCurrent()) linkCitations(messageId, refs, final)
  }
  touchThread()
}

/** message —cites→ knowledge for the documents the answer actually cites, so backlinks work. */
function linkCitations(messageId: ID, refs: readonly EntityRef[], content: string): void {
  const cited = citedIndexes(content)
  refs.forEach((ref, i) => {
    if (cited.has(i + 1)) safely('link', () => link({ kind: 'message', id: messageId }, ref, 'cites'))
  })
}

/** Ids of messages with a live generation (for recovery bookkeeping and tests). */
export function activeGenerationIds(): ID[] {
  return [...generations.keys()]
}
