/**
 * `?` quick ask (§3.7): stream an answer from the default model inline in the command center.
 * The ask is a real Run (kind chat) so it shows in the Run Line, can be stopped and audited, and
 * ends with a receipt. "Continue in Chat" turns the exchange into a conversation.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { db, ID_PREFIX } from '@/core/db'
import { checkModel, createThread, estimateCost, estimateTokens, friendlyError, titleFromText, unavailableMessage } from '@/core/ai'
import { addUsage, appendStep, cancelRun, completeRun, createRun, failRun, updateStep } from '@/core/runs'
import { link } from '@/core/services'
import { getSettings } from '@/core/settings'
import type { ID, Message, Usage } from '@/core/types'
import { newId } from '@/lib/id'

const SYSTEM =
  'You are Atrium’s quick-ask assistant inside a command palette. Answer directly and concisely in Markdown — at most a short paragraph or a few bullets. No preamble.'

export type AskStatus = 'idle' | 'streaming' | 'done' | 'stopped' | 'error'

export interface AskState {
  status: AskStatus
  question: string
  answer: string
  error?: string
  runId?: ID
  modelId?: string
  modelLabel?: string
  simulated?: boolean
  usage?: Usage
  durationMs?: number
}

const IDLE: AskState = { status: 'idle', question: '', answer: '' }

export function useQuickAsk(projectId: ID | null) {
  const [state, setState] = useState<AskState>(IDLE)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const reset = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setState(IDLE)
  }, [])

  const stop = useCallback(() => controller.current?.abort(), [])

  const ask = useCallback(
    async (question: string) => {
      const q = question.trim()
      if (!q) return
      controller.current?.abort()
      const modelId = getSettings().ai.defaultModelId
      const check = checkModel(modelId)
      if (!check.available || !check.model || !check.provider) {
        setState({ status: 'error', question: q, answer: '', error: unavailableMessage(modelId) ?? 'This model is unavailable.', modelId })
        return
      }
      const model = check.model
      const provider = check.provider
      const started = Date.now()
      const run = createRun({ kind: 'chat', title: `Quick ask: ${titleFromText(q) || q.slice(0, 60)}`, projectId, modelId, simulated: model.simulated })
      const step = appendStep(run.id, { kind: 'message', title: 'Generating the answer', status: 'running', startedAt: started, tool: model.label, input: q })
      const ac = new AbortController()
      controller.current = ac
      setState({ status: 'streaming', question: q, answer: '', runId: run.id, modelId, modelLabel: model.label, simulated: model.simulated })

      let text = ''
      let usage: Usage | undefined
      let error: string | undefined
      let stopped = false
      let pending: ReturnType<typeof setTimeout> | undefined
      const flush = () => {
        pending = undefined
        setState((s) => (s.runId === run.id ? { ...s, answer: text } : s))
      }
      try {
        for await (const ev of provider.stream({ modelId, system: SYSTEM, messages: [{ role: 'user', content: q }], maxTokens: 1200, effort: 'low', seed: started }, ac.signal)) {
          if (ev.type === 'text') {
            text += ev.delta
            pending ??= setTimeout(flush, 50)
          } else if (ev.type === 'usage') {
            usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: estimateCost(modelId, ev.inputTokens, ev.outputTokens) }
          } else if (ev.type === 'done') {
            stopped = ev.stopReason === 'stopped'
            break
          } else if (ev.type === 'error') {
            error = friendlyError(ev.code, ev.error, provider)
            break
          }
        }
      } catch (err) {
        if (ac.signal.aborted) stopped = true
        else error = err instanceof Error ? err.message : String(err)
      }
      if (pending) clearTimeout(pending)
      if (ac.signal.aborted) stopped = true
      const endedAt = Date.now()
      const finalUsage = usage ?? { inputTokens: estimateTokens(SYSTEM + q), outputTokens: estimateTokens(text), costUsd: 0 }
      try {
        addUsage(run.id, finalUsage)
        updateStep(run.id, step.id, { status: error ? 'failed' : 'done', title: error ? 'Failed to answer' : 'Generated the answer', endedAt, tokens: finalUsage.outputTokens, output: text.slice(0, 4000), ...(error ? { error } : {}) })
        if (error) failRun(run.id, error)
        else if (stopped) cancelRun(run.id, 'Stopped by you')
        else completeRun(run.id, { summary: text.replace(/[#*_`>]/g, '').split('\n').find((l) => l.trim())?.slice(0, 160) })
      } catch (err) {
        console.warn('[quick ask] could not finalize the run', err)
      }
      if (controller.current === ac) controller.current = null
      setState((s) =>
        s.runId === run.id
          ? { ...s, answer: text, status: error ? 'error' : stopped ? 'stopped' : 'done', error, usage: finalUsage, durationMs: endedAt - started }
          : s,
      )
    },
    [projectId],
  )

  return { state, ask, stop, reset }
}

/** Turn a finished quick ask into a conversation containing the Q&A; returns the new thread id. */
export function continueInChat(state: AskState, projectId: ID | null): ID {
  const modelId = state.modelId ?? getSettings().ai.defaultModelId
  const thread = createThread({ projectId, title: titleFromText(state.question) || 'Quick ask', modelId })
  const now = Date.now()
  const user: Message = { id: newId(ID_PREFIX.messages), threadId: thread.id, role: 'user', content: state.question, status: 'complete', createdAt: now }
  const assistant: Message = {
    id: newId(ID_PREFIX.messages),
    threadId: thread.id,
    role: 'assistant',
    content: state.answer,
    status: state.status === 'stopped' ? 'stopped' : 'complete',
    createdAt: now + 1,
    modelId,
    simulated: !!state.simulated,
    ...(state.usage ? { usage: state.usage } : {}),
    ...(state.runId ? { runId: state.runId } : {}),
  }
  db.insertMany('messages', [user, assistant])
  db.update('threads', thread.id, (t) => ({ ...t, messageIds: [user.id, assistant.id], updatedAt: now }))
  if (state.runId && db.get('runs', state.runId)) link({ kind: 'run', id: state.runId }, { kind: 'message', id: assistant.id }, 'produced')
  return thread.id
}
