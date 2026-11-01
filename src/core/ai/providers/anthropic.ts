import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { getSecret } from '@/core/secrets'
import { estimateTokens, getModel, MODEL_CATALOG } from '../models'
import type { ChatTurn, GenerateRequest, ModelInfo, ModelProvider, StreamEvent } from '../types'

/**
 * Live Anthropic provider. Requests go straight from the browser to api.anthropic.com with
 * the user's own key (stored only in this browser — the Integrations UI explains the
 * trade-off). The SDK is loaded with a dynamic import so it stays out of the main bundle.
 */

export const ANTHROPIC_NEEDS_KEY = 'Add your Anthropic API key in Integrations'

/** Models that accept server-side refusal fallbacks (`fallbacks: 'default'`). */
export const FALLBACK_MODELS: ReadonlySet<string> = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1'])

const DEFAULT_MAX_TOKENS = 64_000
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'

type AnthropicModule = typeof import('@anthropic-ai/sdk')
/** The SDK's error classes, read from the client constructor's static members. */
export type AnthropicErrorClasses = Pick<
  typeof Anthropic,
  | 'APIError'
  | 'APIUserAbortError'
  | 'APIConnectionError'
  | 'AuthenticationError'
  | 'PermissionDeniedError'
  | 'RateLimitError'
  | 'BadRequestError'
>

let sdkPromise: Promise<AnthropicModule> | undefined

function loadSdk(): Promise<AnthropicModule> {
  sdkPromise ??= import('@anthropic-ai/sdk').catch((err: unknown) => {
    sdkPromise = undefined // allow a retry after a failed chunk load
    throw err
  })
  return sdkPromise
}

// ---------------------------------------------------------------- request building

function toBlocks(content: ChatTurn['content']): string | BetaContentBlockParam[] {
  if (typeof content === 'string') return content
  const blocks: BetaContentBlockParam[] = []
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text.trim()) blocks.push({ type: 'text', text: part.text })
    } else if (IMAGE_TYPES.has(part.mediaType)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: part.mediaType as ImageMediaType, data: part.dataBase64 } })
    } else {
      blocks.push({ type: 'text', text: `[Attached image in an unsupported format: ${part.mediaType}]` })
    }
  }
  return blocks
}

const isEmpty = (c: string | BetaContentBlockParam[]) => (typeof c === 'string' ? !c.trim() : c.length === 0)

/**
 * Convert chat turns to Messages API params: drops empty turns, starts with a user turn and
 * never ends on an assistant turn (prefill is not supported on current models).
 */
export function toAnthropicMessages(turns: readonly ChatTurn[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = []
  for (const turn of turns) {
    const content = toBlocks(turn.content)
    if (isEmpty(content)) continue
    out.push(turn.role === 'user' ? { role: 'user', content } : { role: 'assistant', content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  while (out.length && out[out.length - 1].role === 'assistant') out.pop()
  return out
}

/** Build the streaming request. Never sends temperature/top_p/top_k (rejected by the API). */
export function buildAnthropicParams(req: GenerateRequest, model: ModelInfo): BetaMessageStreamParams {
  const params: BetaMessageStreamParams = {
    model: model.id,
    max_tokens: Math.min(req.maxTokens ?? DEFAULT_MAX_TOKENS, model.maxOutput),
    messages: toAnthropicMessages(req.messages),
    thinking: { type: 'adaptive', display: req.reasoning ? 'summarized' : 'omitted' },
    output_config: { effort: req.effort ?? 'medium' },
  }
  if (req.system?.trim()) params.system = req.system
  if (FALLBACK_MODELS.has(model.id)) {
    params.betas = ['server-side-fallback-2026-07-01']
    params.fallbacks = 'default'
  }
  return params
}

// ---------------------------------------------------------------- error mapping

type ErrorEvent = Extract<StreamEvent, { type: 'error' }>

function apiMessage(err: Error): string {
  // SDK messages look like `401 {"type":"error","error":{"message":"invalid x-api-key"}}`.
  const json = /\{[\s\S]*\}$/.exec(err.message)?.[0]
  if (json) {
    try {
      const parsed = JSON.parse(json) as { error?: { message?: unknown } }
      if (typeof parsed.error?.message === 'string') return parsed.error.message
    } catch {
      /* fall through to the raw message */
    }
  }
  return err.message
}

/**
 * Map an SDK error to a stream error, most specific class first. Abort errors are not
 * mapped here (the caller turns them into done{stopped}). APIConnectionError is checked
 * before the generic APIError because it is a subclass of it.
 */
export function mapAnthropicError(err: unknown, sdk: AnthropicErrorClasses): ErrorEvent {
  if (err instanceof sdk.AuthenticationError) {
    return { type: 'error', code: 'auth', retryable: false, error: 'Anthropic rejected the API key. Check it in Integrations.' }
  }
  if (err instanceof sdk.PermissionDeniedError) {
    return { type: 'error', code: 'auth', retryable: false, error: `This API key isn't allowed to use that model: ${apiMessage(err)}` }
  }
  if (err instanceof sdk.RateLimitError) {
    return { type: 'error', code: 'rate_limit', retryable: true, error: 'Anthropic rate limit reached. Wait a moment and try again.' }
  }
  if (err instanceof sdk.APIConnectionError) {
    return { type: 'error', code: 'network', retryable: true, error: "Couldn't reach api.anthropic.com. Check your connection and try again." }
  }
  if (err instanceof sdk.BadRequestError) {
    return { type: 'error', code: 'bad_request', retryable: false, error: apiMessage(err) }
  }
  if (err instanceof sdk.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined
    if (status !== undefined && (status === 529 || status >= 500)) {
      return { type: 'error', code: 'overloaded', retryable: true, error: `Anthropic is overloaded or unavailable (HTTP ${status}).` }
    }
    return { type: 'error', code: 'unknown', retryable: false, error: status ? `Anthropic API error ${status}: ${apiMessage(err)}` : apiMessage(err) }
  }
  return { type: 'error', code: 'unknown', retryable: false, error: err instanceof Error ? err.message : String(err) }
}

// ---------------------------------------------------------------- streaming

interface UsageLike {
  input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** Billable input = uncached + cache writes + cache reads. */
export function totalInputTokens(usage: UsageLike): number {
  return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
}

function mapStopReason(reason: string | null | undefined): 'end' | 'max_tokens' | 'refusal' {
  if (reason === 'refusal') return 'refusal' // checked first: a refusal ends the turn early
  if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') return 'max_tokens'
  return 'end'
}

function promptText(req: GenerateRequest): string {
  const parts = req.messages.map((m) => (typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')))
  return [req.system ?? '', ...parts].join('\n')
}

async function* streamAnthropic(req: GenerateRequest, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const apiKey = getSecret('anthropic', 'apiKey')
  const model = getModel(req.modelId)
  const fail = (code: ErrorEvent['code'], error: string): StreamEvent[] => [
    { type: 'usage', inputTokens: 0, outputTokens: 0 },
    { type: 'error', code, error, retryable: false },
  ]
  if (!apiKey) return yield* fail('auth', `${ANTHROPIC_NEEDS_KEY} to use ${model?.label ?? 'Claude'}.`)
  if (!model || model.providerId !== 'anthropic') return yield* fail('bad_request', `Unknown Anthropic model “${req.modelId}”.`)
  const params = buildAnthropicParams(req, model)
  if (!params.messages.length) return yield* fail('bad_request', 'There is no user message to send.')

  const counts = { input: 0, output: 0, text: '' }
  const partialUsage = (): StreamEvent => ({
    type: 'usage',
    inputTokens: counts.input || estimateTokens(promptText(req)),
    outputTokens: counts.output || (counts.text ? estimateTokens(counts.text) : 0),
  })
  if (signal.aborted) {
    yield { type: 'usage', inputTokens: 0, outputTokens: 0 }
    yield { type: 'done', stopReason: 'stopped' }
    return
  }

  let sdk: AnthropicModule
  try {
    sdk = await loadSdk()
  } catch {
    yield { type: 'usage', inputTokens: 0, outputTokens: 0 }
    yield { type: 'error', code: 'network', retryable: true, error: "Couldn't load the Anthropic client. Check your connection and reload the page." }
    return
  }
  const AnthropicClient = sdk.default

  try {
    const client = new AnthropicClient({ apiKey, dangerouslyAllowBrowser: true })
    const stream = client.beta.messages.stream(params, { signal })
    for await (const event of stream) {
      if (event.type === 'message_start') {
        counts.input = totalInputTokens(event.message.usage)
      } else if (event.type === 'message_delta') {
        counts.output = event.usage.output_tokens
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta' && event.delta.text) {
          counts.text += event.delta.text
          yield { type: 'text', delta: event.delta.text }
        } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
          yield { type: 'reasoning', delta: event.delta.thinking }
        }
      }
    }
    const final = await stream.finalMessage()
    yield { type: 'usage', inputTokens: totalInputTokens(final.usage), outputTokens: final.usage.output_tokens }
    yield { type: 'done', stopReason: mapStopReason(final.stop_reason) }
  } catch (err) {
    if (signal.aborted || err instanceof AnthropicClient.APIUserAbortError) {
      yield partialUsage()
      yield { type: 'done', stopReason: 'stopped' }
      return
    }
    yield partialUsage()
    yield mapAnthropicError(err, AnthropicClient)
  }
}

export const anthropicProvider: ModelProvider = {
  id: 'anthropic',
  label: 'Anthropic',
  kind: 'live',
  status: () => (getSecret('anthropic', 'apiKey') ? { state: 'ready' } : { state: 'needs_key', message: ANTHROPIC_NEEDS_KEY }),
  models: () => MODEL_CATALOG.filter((m) => m.providerId === 'anthropic'),
  stream: (req, signal) => streamAnthropic(req, signal),
}
