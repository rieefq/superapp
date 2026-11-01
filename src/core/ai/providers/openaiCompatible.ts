import { db } from '@/core/db'
import { getSecret } from '@/core/secrets'
import { estimateTokens } from '../models'
import type { ChatTurn, GenerateRequest, ModelInfo, ModelProvider, StreamEvent } from '../types'
import { createSseParser } from './sse'

export { createSseParser, type SseEvent, type SseParser } from './sse'

/**
 * Live provider for any OpenAI-compatible chat endpoint (Ollama, LM Studio, vLLM,
 * OpenRouter…). Configuration lives in the `openai-compatible` connection (base URL + model);
 * the optional API key lives in the local secrets vault.
 */

export const OAI_CONNECTION_ID = 'openai-compatible'
export const OAI_MODEL_PREFIX = 'oai:'
export const OAI_NEEDS_CONFIG = 'Connect an OpenAI-compatible endpoint (base URL and model) in Integrations'

export interface OaiConfig {
  baseUrl: string
  model: string
  apiKey?: string
}

/** The configured endpoint, or undefined when it is missing, incomplete or disconnected. */
export function readOaiConfig(): OaiConfig | undefined {
  const conn = db.get('connections', OAI_CONNECTION_ID)
  if (!conn || conn.status === 'disconnected') return undefined
  const baseUrl = conn.config.baseUrl?.trim()
  const model = conn.config.model?.trim()
  if (!baseUrl || !model) return undefined
  return { baseUrl, model, apiKey: getSecret(OAI_CONNECTION_ID, 'apiKey') }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Model info for an `oai:<model>` id (resolvable even when the endpoint is not configured). */
export function oaiModelInfo(model: string, baseUrl?: string): ModelInfo {
  return {
    id: `${OAI_MODEL_PREFIX}${model}`,
    providerId: 'openai-compatible',
    label: `${model} · custom endpoint`,
    description: baseUrl ? `Your OpenAI-compatible endpoint at ${hostOf(baseUrl)}.` : 'Your OpenAI-compatible endpoint.',
    contextWindow: 128_000,
    maxOutput: 8_192,
    pricing: { input: 0, output: 0 },
    capabilities: ['text'],
    simulated: false,
  }
}

/** `${baseUrl}/chat/completions`, tolerating trailing slashes or a full completions URL. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`
}

// ---------------------------------------------------------------- request

type OaiContent = string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
interface OaiMessage {
  role: 'system' | 'user' | 'assistant'
  content: OaiContent
}

function toOaiContent(content: ChatTurn['content']): OaiContent {
  if (typeof content === 'string') return content
  return content.map((p) =>
    p.type === 'text' ? { type: 'text' as const, text: p.text } : { type: 'image_url' as const, image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } },
  )
}

/** System prompt first, then the conversation; empty turns are dropped. */
export function toOpenAiMessages(req: GenerateRequest): OaiMessage[] {
  const out: OaiMessage[] = []
  if (req.system?.trim()) out.push({ role: 'system', content: req.system })
  for (const turn of req.messages) {
    const content = toOaiContent(turn.content)
    if (typeof content === 'string' ? !content.trim() : !content.length) continue
    out.push({ role: turn.role, content })
  }
  return out
}

// ---------------------------------------------------------------- response parsing

export interface OaiChunk {
  text?: string
  reasoning?: string
  usage?: { inputTokens: number; outputTokens: number }
  finishReason?: string
  error?: string
}

interface RawChunk {
  error?: { message?: unknown } | string
  choices?: Array<{
    delta?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    message?: { content?: unknown; reasoning_content?: unknown; reasoning?: unknown }
    finish_reason?: unknown
  }>
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length ? v : undefined)
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Interpret one SSE `data:` payload (or a whole non-streamed completion).
 * Returns 'done' for `[DONE]`, undefined for malformed or empty payloads.
 */
export function parseOpenAiChunk(data: string): OaiChunk | 'done' | undefined {
  const trimmed = data.trim()
  if (!trimmed) return undefined
  if (trimmed === '[DONE]') return 'done'
  let raw: RawChunk
  try {
    raw = JSON.parse(trimmed) as RawChunk
  } catch {
    return undefined
  }
  if (!raw || typeof raw !== 'object') return undefined
  if (raw.error) {
    return { error: typeof raw.error === 'string' ? raw.error : (str(raw.error.message) ?? 'The endpoint reported an error.') }
  }
  const out: OaiChunk = {}
  const choice = raw.choices?.[0]
  const delta = choice?.delta ?? choice?.message
  const text = str(delta?.content)
  const reasoning = str(delta?.reasoning_content) ?? str(delta?.reasoning)
  if (text) out.text = text
  if (reasoning) out.reasoning = reasoning
  const finish = str(choice?.finish_reason)
  if (finish) out.finishReason = finish
  if (raw.usage) out.usage = { inputTokens: num(raw.usage.prompt_tokens), outputTokens: num(raw.usage.completion_tokens) }
  return out
}

// ---------------------------------------------------------------- errors

type ErrorEvent = Extract<StreamEvent, { type: 'error' }>

/** Map an HTTP failure from the endpoint to a stream error. */
export function mapHttpError(status: number, detail: string, url: string): ErrorEvent {
  const suffix = detail ? ` ${detail}` : ''
  if (status === 401 || status === 403) {
    return { type: 'error', code: 'auth', retryable: false, error: `The endpoint rejected the request (HTTP ${status}). Check the API key in Integrations.${suffix}` }
  }
  if (status === 429) return { type: 'error', code: 'rate_limit', retryable: true, error: `The endpoint is rate limiting requests. Wait a moment and try again.${suffix}` }
  if (status >= 500) {
    return { type: 'error', code: 'overloaded', retryable: true, error: `The endpoint returned HTTP ${status}; it may be overloaded or the model may not be loaded.${suffix}` }
  }
  if (status === 404) {
    return { type: 'error', code: 'bad_request', retryable: false, error: `Nothing found at ${url} (HTTP 404). Check the base URL (it usually ends in /v1) and the model name.` }
  }
  if (status === 400 || status === 422) return { type: 'error', code: 'bad_request', retryable: false, error: detail || `The endpoint rejected the request (HTTP ${status}).` }
  return { type: 'error', code: 'unknown', retryable: false, error: `The endpoint returned HTTP ${status}.${suffix}` }
}

/** The actionable message for a fetch that never reached the server. */
export function unreachableMessage(baseUrl: string): string {
  return `Could not reach ${baseUrl}. Is the server running and allowing CORS from this origin?`
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.text()).slice(0, 2000)
    const parsed = parseOpenAiChunk(body)
    const message = parsed && parsed !== 'done' ? parsed.error : undefined
    return (message ?? body).replace(/\s+/g, ' ').trim().slice(0, 300)
  } catch {
    return ''
  }
}

const isAbortError = (err: unknown): boolean => typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'

function stopReasonOf(finish: string | undefined): 'end' | 'max_tokens' | 'refusal' {
  if (finish === 'length') return 'max_tokens'
  if (finish === 'content_filter') return 'refusal'
  return 'end'
}

// ---------------------------------------------------------------- streaming

async function* streamOpenAiCompatible(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const zeroUsage: StreamEvent = { type: 'usage', inputTokens: 0, outputTokens: 0 }
  const cfg = readOaiConfig()
  if (!cfg) {
    yield zeroUsage
    yield { type: 'error', code: 'auth', retryable: false, error: `${OAI_NEEDS_CONFIG}.` }
    return
  }
  if (req.modelId !== `${OAI_MODEL_PREFIX}${cfg.model}`) {
    yield zeroUsage
    yield { type: 'error', code: 'bad_request', retryable: false, error: `The custom endpoint is configured for “${cfg.model}”, not “${req.modelId.replace(OAI_MODEL_PREFIX, '')}”.` }
    return
  }

  const url = chatCompletionsUrl(cfg.baseUrl)
  const messages = toOpenAiMessages(req)
  const promptTokens = estimateTokens(messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n'))).join('\n'))
  const body = {
    model: cfg.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`

  let text = ''
  let usage: { inputTokens: number; outputTokens: number } | undefined
  let finish: string | undefined
  const usageEvent = (): StreamEvent => ({
    type: 'usage',
    inputTokens: usage?.inputTokens || promptTokens,
    outputTokens: usage?.outputTokens || (text ? estimateTokens(text) : 0),
  })

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (err) {
    yield zeroUsage
    if (signal.aborted || isAbortError(err)) yield { type: 'done', stopReason: 'stopped' }
    else yield { type: 'error', code: 'network', retryable: true, error: unreachableMessage(cfg.baseUrl) }
    return
  }
  if (!res.ok) {
    const detail = await errorDetail(res)
    yield zeroUsage
    yield mapHttpError(res.status, detail, url)
    return
  }

  // Some servers ignore `stream: true` and answer with one JSON completion.
  const contentType = res.headers.get('content-type') ?? ''
  if (!res.body || contentType.includes('application/json')) {
    let parsed: ReturnType<typeof parseOpenAiChunk>
    try {
      parsed = parseOpenAiChunk(await res.text())
    } catch (err) {
      yield zeroUsage
      if (signal.aborted || isAbortError(err)) yield { type: 'done', stopReason: 'stopped' }
      else yield { type: 'error', code: 'network', retryable: true, error: 'The connection to the endpoint dropped before the response finished.' }
      return
    }
    if (parsed && parsed !== 'done' && parsed.error) {
      yield zeroUsage
      yield { type: 'error', code: 'unknown', retryable: false, error: parsed.error }
      return
    }
    if (parsed && parsed !== 'done') {
      if (parsed.reasoning) yield { type: 'reasoning', delta: parsed.reasoning }
      if (parsed.text) {
        text = parsed.text
        yield { type: 'text', delta: parsed.text }
      }
      usage = parsed.usage
      finish = parsed.finishReason
    }
    yield usageEvent()
    yield { type: 'done', stopReason: stopReasonOf(finish) }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let finished = false
  let exhausted = false
  let streamError: string | undefined
  try {
    while (!finished) {
      const { value, done } = await reader.read()
      if (done) exhausted = true
      const events = done ? [...parser.push(decoder.decode()), ...parser.flush()] : parser.push(decoder.decode(value, { stream: true }))
      for (const ev of events) {
        const chunk = parseOpenAiChunk(ev.data)
        if (chunk === 'done') {
          finished = true
          break
        }
        if (!chunk) continue
        if (chunk.error) {
          streamError = chunk.error
          finished = true
          break
        }
        if (chunk.reasoning) yield { type: 'reasoning', delta: chunk.reasoning }
        if (chunk.text) {
          text += chunk.text
          yield { type: 'text', delta: chunk.text }
        }
        if (chunk.usage) usage = chunk.usage
        if (chunk.finishReason) finish = chunk.finishReason
      }
      if (done) break
    }
  } catch (err) {
    yield usageEvent()
    if (signal.aborted || isAbortError(err)) yield { type: 'done', stopReason: 'stopped' }
    else yield { type: 'error', code: 'network', retryable: true, error: 'The connection to the endpoint dropped mid-response.' }
    return
  } finally {
    // Stop the download when we stop early ([DONE], an error, or the consumer went away).
    if (!exhausted) reader.cancel().catch(() => undefined)
  }

  yield usageEvent()
  if (streamError) yield { type: 'error', code: 'unknown', retryable: false, error: streamError }
  else yield { type: 'done', stopReason: signal.aborted ? 'stopped' : stopReasonOf(finish) }
}

export const openAiCompatibleProvider: ModelProvider = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible endpoint',
  kind: 'live',
  status: () => {
    const conn = db.get('connections', OAI_CONNECTION_ID)
    if (conn?.status === 'error' && conn.error) return { state: 'error', message: conn.error }
    return readOaiConfig() ? { state: 'ready' } : { state: 'needs_key', message: OAI_NEEDS_CONFIG }
  },
  models: () => {
    const cfg = readOaiConfig()
    return cfg ? [oaiModelInfo(cfg.model, cfg.baseUrl)] : []
  },
  stream: (req, signal) => streamOpenAiCompatible(req, signal),
}
