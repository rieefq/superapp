import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSecretsStore } from '@/core/secrets'
import type { GenerateRequest, StreamEvent } from '../types'

/**
 * The SDK is replaced by a fake with the same surface the provider uses:
 * `new Anthropic(opts).beta.messages.stream(params, { signal })` returning an async-iterable
 * stream with `finalMessage()`, plus the static error classes.
 */
const sdk = vi.hoisted(() => {
  class APIError extends Error {
    readonly status: number | undefined
    constructor(status?: number, message = 'API error') {
      super(message)
      this.status = status
    }
  }
  class APIUserAbortError extends APIError {
    constructor() {
      super(undefined, 'Request was aborted.')
    }
  }
  class APIConnectionError extends APIError {
    constructor() {
      super(undefined, 'Connection error.')
    }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}

  const state = {
    clientOptions: undefined as unknown,
    params: undefined as Record<string, unknown> | undefined,
    options: undefined as { signal?: AbortSignal } | undefined,
    events: [] as unknown[],
    final: { stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } } as Record<string, unknown>,
    error: undefined as unknown,
    /** Throw the error after this many events (default: before the first). */
    errorAfter: 0,
  }

  class FakeAnthropic {
    static APIError = APIError
    static APIUserAbortError = APIUserAbortError
    static APIConnectionError = APIConnectionError
    static AuthenticationError = AuthenticationError
    static PermissionDeniedError = PermissionDeniedError
    static RateLimitError = RateLimitError
    static BadRequestError = BadRequestError
    beta = {
      messages: {
        stream: (params: Record<string, unknown>, options: { signal?: AbortSignal }) => {
          state.params = params
          state.options = options
          return {
            async *[Symbol.asyncIterator]() {
              let i = 0
              for (const ev of state.events) {
                if (state.error && i === state.errorAfter) throw state.error
                yield ev
                i++
              }
              if (state.error) throw state.error
            },
            finalMessage: async () => state.final,
          }
        },
      },
    }
    constructor(opts: unknown) {
      state.clientOptions = opts
    }
  }

  const reset = () => {
    state.clientOptions = undefined
    state.params = undefined
    state.options = undefined
    state.events = []
    state.final = { stop_reason: 'end_turn', usage: { input_tokens: 0, output_tokens: 0 } }
    state.error = undefined
    state.errorAfter = 0
  }

  return {
    state,
    reset,
    FakeAnthropic,
    errors: { APIError, APIUserAbortError, APIConnectionError, AuthenticationError, PermissionDeniedError, RateLimitError, BadRequestError },
  }
})

vi.mock('@anthropic-ai/sdk', () => ({ default: sdk.FakeAnthropic }))

const { anthropicProvider, ANTHROPIC_NEEDS_KEY } = await import('./anthropic')

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const ev of iter) out.push(ev)
  return out
}

const req = (extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  modelId: 'claude-opus-5-5',
  system: 'You are Atrium.',
  messages: [{ role: 'user', content: 'Explain adaptive thinking.' }],
  ...extra,
})

const textDelta = (text: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
const thinkingDelta = (thinking: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking, estimated_tokens: null } })

describe('anthropic provider', () => {
  beforeEach(() => {
    sdk.reset()
    useSecretsStore.setState({ secrets: { anthropic: { apiKey: 'sk-ant-test' } } })
  })

  it('asks for a key when none is stored, without calling the API', async () => {
    useSecretsStore.setState({ secrets: {} })
    expect(anthropicProvider.status()).toEqual({ state: 'needs_key', message: ANTHROPIC_NEEDS_KEY })
    const events = await collect(anthropicProvider.stream(req(), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'auth', error: `${ANTHROPIC_NEEDS_KEY} to use Claude Opus 5.5.` })
    expect(sdk.state.params).toBeUndefined()
  })

  it('builds the request: adaptive thinking, effort, max tokens, fallbacks, browser key, no sampling params', async () => {
    const controller = new AbortController()
    await collect(anthropicProvider.stream(req({ reasoning: true, effort: 'high' }), controller.signal))
    expect(sdk.state.clientOptions).toEqual({ apiKey: 'sk-ant-test', dangerouslyAllowBrowser: true })
    expect(sdk.state.options?.signal).toBe(controller.signal)
    const p = sdk.state.params ?? {}
    expect(p).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      system: 'You are Atrium.',
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: 'high' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages: [{ role: 'user', content: 'Explain adaptive thinking.' }],
    })
    for (const key of ['temperature', 'top_p', 'top_k']) expect(p).not.toHaveProperty(key)
  })

  it('defaults effort to medium, hides reasoning when not requested and caps max_tokens at the model limit', async () => {
    await collect(anthropicProvider.stream(req({ maxTokens: 500_000 }), new AbortController().signal))
    expect(sdk.state.params).toMatchObject({ max_tokens: 128000, thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'medium' } })
  })

  it('only sends fallbacks for fallback-capable models', async () => {
    for (const model of ['claude-sonnet-5-5', 'claude-fable-5-1']) {
      await collect(anthropicProvider.stream(req({ modelId: model }), new AbortController().signal))
      expect(sdk.state.params, model).toMatchObject({ fallbacks: 'default', betas: ['server-side-fallback-2026-07-01'] })
    }
    await collect(anthropicProvider.stream(req({ modelId: 'claude-haiku-5-5' }), new AbortController().signal))
    expect(sdk.state.params).not.toHaveProperty('fallbacks')
    expect(sdk.state.params).not.toHaveProperty('betas')
  })

  it('starts with a user turn, never ends with an assistant turn and maps images', async () => {
    await collect(
      anthropicProvider.stream(
        req({
          messages: [
            { role: 'assistant', content: 'Welcome!' },
            { role: 'user', content: [{ type: 'image', mediaType: 'image/png', dataBase64: 'AAAA' }, { type: 'text', text: 'What is this?' }] },
            { role: 'assistant', content: '' },
            { role: 'assistant', content: 'Partial prefill' },
          ],
        }),
        new AbortController().signal,
      ),
    )
    expect(sdk.state.params?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          { type: 'text', text: 'What is this?' },
        ],
      },
    ])
  })

  it('streams text and reasoning deltas, then usage (incl. cache tokens) and done', async () => {
    sdk.state.events = [
      { type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 2 } } },
      thinkingDelta('Considering the question. '),
      thinkingDelta(''),
      textDelta('Adaptive thinking '),
      textDelta('lets Claude decide.'),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    ]
    sdk.state.final = { stop_reason: 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 2, output_tokens: 9 } }
    const events = await collect(anthropicProvider.stream(req({ reasoning: true }), new AbortController().signal))
    expect(events).toEqual([
      { type: 'reasoning', delta: 'Considering the question. ' },
      { type: 'text', delta: 'Adaptive thinking ' },
      { type: 'text', delta: 'lets Claude decide.' },
      { type: 'usage', inputTokens: 17, outputTokens: 9 },
      { type: 'done', stopReason: 'end' },
    ])
  })

  it('maps stop reasons, checking refusal first', async () => {
    const cases: Array<[string, string]> = [
      ['refusal', 'refusal'],
      ['max_tokens', 'max_tokens'],
      ['end_turn', 'end'],
      ['stop_sequence', 'end'],
    ]
    for (const [stop, expected] of cases) {
      sdk.state.final = { stop_reason: stop, usage: { input_tokens: 1, output_tokens: 1 } }
      const events = await collect(anthropicProvider.stream(req(), new AbortController().signal))
      expect(events.at(-1), stop).toEqual({ type: 'done', stopReason: expected })
    }
  })

  it('maps SDK errors to codes, most specific first', async () => {
    const E = sdk.errors
    const cases: Array<[Error, string, boolean]> = [
      [new E.AuthenticationError(401, 'invalid x-api-key'), 'auth', false],
      [new E.PermissionDeniedError(403, 'no access'), 'auth', false],
      [new E.RateLimitError(429, 'slow down'), 'rate_limit', true],
      [new E.APIConnectionError(), 'network', true],
      [new E.BadRequestError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens too large"}}'), 'bad_request', false],
      [new E.APIError(529, 'Overloaded'), 'overloaded', true],
      [new E.APIError(503, 'Unavailable'), 'overloaded', true],
      [new E.APIError(404, 'Not found'), 'unknown', false],
      [new Error('weird'), 'unknown', false],
    ]
    for (const [error, code, retryable] of cases) {
      sdk.state.error = error
      const events = await collect(anthropicProvider.stream(req(), new AbortController().signal))
      expect(events.at(-2)).toMatchObject({ type: 'usage' })
      expect(events.at(-1), error.constructor.name).toMatchObject({ type: 'error', code, retryable })
    }
    sdk.state.error = new E.BadRequestError(400, '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens too large"}}')
    const events = await collect(anthropicProvider.stream(req(), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ error: 'max_tokens too large' })
  })

  it('treats user aborts as done{stopped}, keeping partial usage', async () => {
    sdk.state.events = [{ type: 'message_start', message: { usage: { input_tokens: 40 } } }, textDelta('Partial answer')]
    sdk.state.error = new sdk.errors.APIUserAbortError()
    sdk.state.errorAfter = 2
    const events = await collect(anthropicProvider.stream(req(), new AbortController().signal))
    expect(events.map((e) => e.type)).toEqual(['text', 'usage', 'done'])
    expect(events.at(-2)).toMatchObject({ type: 'usage', inputTokens: 40 })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'stopped' })

    // Any error after the signal aborted is also a stop, not a failure.
    const controller = new AbortController()
    sdk.state.error = new Error('socket closed')
    sdk.state.errorAfter = 0
    controller.abort()
    const aborted = await collect(anthropicProvider.stream(req(), controller.signal))
    expect(aborted.at(-1)).toEqual({ type: 'done', stopReason: 'stopped' })
  })

  it('lists the catalog Claude models', () => {
    expect(anthropicProvider.models().map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'])
    expect(anthropicProvider.kind).toBe('live')
  })
})
