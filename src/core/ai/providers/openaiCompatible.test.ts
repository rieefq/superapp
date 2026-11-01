import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useSecretsStore } from '@/core/secrets'
import type { IntegrationConnection } from '@/core/types'
import type { GenerateRequest, StreamEvent } from '../types'
import { chatCompletionsUrl, mapHttpError, openAiCompatibleProvider, unreachableMessage } from './openaiCompatible'

const BASE = 'http://localhost:11434/v1/'

function connect(config: Record<string, string> = { baseUrl: BASE, model: 'llama3.2' }, status: IntegrationConnection['status'] = 'connected') {
  db.insert('connections', { id: 'openai-compatible', status, mode: 'live', scopes: [], config, usageCount: 0 })
}

function sseResponse(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' }, ...init })
}

async function collect(iter: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const ev of iter) out.push(ev)
  return out
}

const req = (extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  modelId: 'oai:llama3.2',
  system: 'You are Atrium.',
  messages: [
    { role: 'user', content: 'Hi' },
    { role: 'assistant', content: 'Hello!' },
    { role: 'user', content: 'Explain SSE.' },
  ],
  ...extra,
})

const text = (events: StreamEvent[]) => events.map((e) => (e.type === 'text' ? e.delta : '')).join('')

describe('openai-compatible provider', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db.replaceAll(emptyTables())
    useSecretsStore.setState({ secrets: {} })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('needs a base URL and model before it is ready', async () => {
    expect(openAiCompatibleProvider.status().state).toBe('needs_key')
    expect(openAiCompatibleProvider.models()).toEqual([])
    const events = await collect(openAiCompatibleProvider.stream(req(), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'auth' })
    expect(fetchMock).not.toHaveBeenCalled()

    connect({ baseUrl: BASE, model: '' })
    expect(openAiCompatibleProvider.status().state).toBe('needs_key')
    connect({ baseUrl: BASE, model: 'llama3.2' }, 'disconnected')
    expect(openAiCompatibleProvider.status().state).toBe('needs_key')
  })

  it('exposes one model for the configured endpoint', () => {
    connect()
    expect(openAiCompatibleProvider.status()).toEqual({ state: 'ready' })
    expect(openAiCompatibleProvider.models()).toEqual([
      expect.objectContaining({
        id: 'oai:llama3.2',
        label: 'llama3.2 · custom endpoint',
        providerId: 'openai-compatible',
        pricing: { input: 0, output: 0 },
        simulated: false,
        contextWindow: 128000,
        maxOutput: 8192,
        capabilities: ['text'],
      }),
    ])
  })

  it('streams SSE deltas split across network chunks, then usage and done', async () => {
    connect()
    useSecretsStore.setState({ secrets: { 'openai-compatible': { apiKey: 'sk-local' } } })
    fetchMock.mockResolvedValue(
      sseResponse([
        ': ping\n\ndata: {"choices":[{"delta":{"reasoning_content":"Let me think. "}}]}\n\nda',
        'ta: {"choices":[{"delta":{"content":"Server-Sent "}}]}\n\ndata: {"choices":[{"delta":{"content":"Events',
        ' stream text."},"finish_reason":"stop"}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":21,"completion_tokens":5}}\n\ndata: [DONE]\n\n',
      ]),
    )
    const events = await collect(openAiCompatibleProvider.stream(req(), new AbortController().signal))
    expect(events.filter((e) => e.type === 'reasoning')).toEqual([{ type: 'reasoning', delta: 'Let me think. ' }])
    expect(text(events)).toBe('Server-Sent Events stream text.')
    expect(events.slice(-2)).toEqual([
      { type: 'usage', inputTokens: 21, outputTokens: 5 },
      { type: 'done', stopReason: 'end' },
    ])

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-local')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'llama3.2', stream: true, stream_options: { include_usage: true } })
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
  })

  it('omits the Authorization header without a key and estimates usage when the server sends none', async () => {
    connect()
    fetchMock.mockResolvedValue(sseResponse(['data: {"choices":[{"delta":{"content":"Hello there"},"finish_reason":"length"}]}\n\n']))
    const events = await collect(openAiCompatibleProvider.stream(req(), new AbortController().signal))
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
    expect(events.at(-2)).toMatchObject({ type: 'usage', outputTokens: expect.any(Number) })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' })
  })

  it('accepts a non-streamed JSON completion', async () => {
    connect()
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'Whole answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    const events = await collect(openAiCompatibleProvider.stream(req(), new AbortController().signal))
    expect(text(events)).toBe('Whole answer')
    expect(events.slice(-2)).toEqual([
      { type: 'usage', inputTokens: 3, outputTokens: 2 },
      { type: 'done', stopReason: 'end' },
    ])
  })

  it('maps HTTP failures to error codes', async () => {
    connect()
    const cases: Array<[number, string, boolean]> = [
      [401, 'auth', false],
      [403, 'auth', false],
      [429, 'rate_limit', true],
      [503, 'overloaded', true],
      [404, 'bad_request', false],
      [400, 'bad_request', false],
    ]
    for (const [status, code, retryable] of cases) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: `failure ${status}` } }), { status }))
      const events = await collect(openAiCompatibleProvider.stream(req(), new AbortController().signal))
      expect(events.at(-1), String(status)).toMatchObject({ type: 'error', code, retryable })
    }
    expect(mapHttpError(400, 'model "x" not found', 'u').error).toBe('model "x" not found')
    expect(mapHttpError(418, '', 'u')).toMatchObject({ code: 'unknown' })
  })

  it('explains unreachable endpoints (network/CORS) with an actionable hint', async () => {
    connect()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const events = await collect(openAiCompatibleProvider.stream(req(), new AbortController().signal))
    expect(events.at(-1)).toEqual({ type: 'error', code: 'network', retryable: true, error: unreachableMessage(BASE) })
    expect(unreachableMessage(BASE)).toContain('allowing CORS from this origin')
  })

  it('stops on abort mid-stream', async () => {
    connect()
    const controller = new AbortController()
    const encoder = new TextEncoder()
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial "}}]}\n\n'))
          init.signal?.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')))
        },
      })
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    })
    const events: StreamEvent[] = []
    for await (const ev of openAiCompatibleProvider.stream(req(), controller.signal)) {
      events.push(ev)
      if (ev.type === 'text') controller.abort()
    }
    expect(text(events)).toBe('partial ')
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'stopped' })
  })

  it('rejects a model id that does not match the configured endpoint', async () => {
    connect()
    const events = await collect(openAiCompatibleProvider.stream(req({ modelId: 'oai:qwen' }), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'bad_request' })
  })

  it('builds the completions URL from common base URL shapes', () => {
    expect(chatCompletionsUrl('http://localhost:1234/v1')).toBe('http://localhost:1234/v1/chat/completions')
    expect(chatCompletionsUrl('https://openrouter.ai/api/v1/')).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(chatCompletionsUrl('http://host/v1/chat/completions')).toBe('http://host/v1/chat/completions')
  })
})
