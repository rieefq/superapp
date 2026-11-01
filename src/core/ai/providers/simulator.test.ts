import { describe, expect, it } from 'vitest'
import { createRng } from '@/lib/rng'
import { composeAnswer } from '../simulator/compose'
import type { GenerateRequest, StreamEvent } from '../types'
import { abortableSleep, chunkWords, createSimulatorProvider } from './simulator'

const fast = createSimulatorProvider({ chunkDelayMs: () => 0, firstTokenDelayMs: () => 0 })

async function collect(iter: AsyncIterable<StreamEvent>, onEvent?: (ev: StreamEvent, i: number) => void): Promise<StreamEvent[]> {
  const out: StreamEvent[] = []
  for await (const ev of iter) {
    onEvent?.(ev, out.length)
    out.push(ev)
  }
  return out
}

const req = (content: string, modelId = 'sim-swift', extra: Partial<GenerateRequest> = {}): GenerateRequest => ({
  modelId,
  messages: [{ role: 'user', content }],
  ...extra,
})

describe('simulator provider', () => {
  it('streams the composed answer in chunks, then exactly one usage and one done{end}', async () => {
    const r = req('How do I set up SSO for our portal?', 'sim-swift', { seed: 3 })
    const events = await collect(fast.stream(r, new AbortController().signal))
    const text = events.filter((e) => e.type === 'text').map((e) => (e.type === 'text' ? e.delta : '')).join('')
    expect(text).toBe(composeAnswer({ modelId: 'sim-swift', messages: r.messages, seed: 3 }).content)
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(20)
    const tail = events.slice(-2)
    expect(tail[0]).toMatchObject({ type: 'usage' })
    expect(tail[1]).toEqual({ type: 'done', stopReason: 'end' })
    expect(events.filter((e) => e.type === 'usage')).toHaveLength(1)
    const usage = tail[0]
    if (usage.type === 'usage') {
      expect(usage.inputTokens).toBeGreaterThan(0)
      expect(usage.outputTokens).toBeGreaterThan(50)
    }
  })

  it('streams a reasoning trace before the answer for sim-deep', async () => {
    const events = await collect(fast.stream(req('Compare Postgres vs MongoDB', 'sim-deep', { reasoning: true }), new AbortController().signal))
    const firstText = events.findIndex((e) => e.type === 'text')
    const lastReasoning = events.map((e) => e.type).lastIndexOf('reasoning')
    expect(lastReasoning).toBeGreaterThanOrEqual(0)
    expect(lastReasoning).toBeLessThan(firstText)
  })

  it('omits the reasoning trace when reasoning is not requested', async () => {
    const events = await collect(fast.stream(req('Compare Postgres vs MongoDB', 'sim-deep', { reasoning: false }), new AbortController().signal))
    expect(events.some((e) => e.type === 'reasoning')).toBe(false)
  })

  it('stops promptly on abort and ends with usage + done{stopped}', async () => {
    const slow = createSimulatorProvider({ chunkDelayMs: () => 20, firstTokenDelayMs: () => 0 })
    const controller = new AbortController()
    const started = Date.now()
    const events = await collect(slow.stream(req('Brainstorm ideas for our onboarding'), controller.signal), (ev) => {
      if (ev.type === 'text') controller.abort()
    })
    expect(Date.now() - started).toBeLessThan(500)
    expect(events.filter((e) => e.type === 'text')).toHaveLength(1)
    expect(events.at(-2)).toMatchObject({ type: 'usage' })
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'stopped' })
  })

  it('returns immediately when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const events = await collect(createSimulatorProvider().stream(req('hello there, what can you do?'), controller.signal))
    expect(events).toEqual([
      { type: 'usage', inputTokens: expect.any(Number), outputTokens: 0 },
      { type: 'done', stopReason: 'stopped' },
    ])
  })

  it('honors maxTokens with done{max_tokens}', async () => {
    const events = await collect(fast.stream(req('Plan a product launch', 'sim-swift', { maxTokens: 20 }), new AbortController().signal))
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'max_tokens' })
    const text = events.map((e) => (e.type === 'text' ? e.delta : '')).join('')
    expect(text.length).toBeLessThanOrEqual(80)
  })

  it('rejects non-simulator models', async () => {
    const events = await collect(fast.stream(req('hi', 'claude-opus-5-5'), new AbortController().signal))
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'bad_request', retryable: false })
  })

  it('reports ready status and the simulator models', () => {
    expect(fast.status()).toEqual({ state: 'ready' })
    expect(fast.models().map((m) => m.id)).toEqual(['sim-swift', 'sim-deep'])
    expect(fast.kind).toBe('simulated')
  })
})

describe('chunkWords / abortableSleep', () => {
  it('splits into 1–3 word chunks that reassemble exactly', () => {
    const text = '## Title\n\n- one two  three\n- four\n\n```ts\nconst x = 1\n```\n  trailing  '
    const chunks = chunkWords(text, createRng(42))
    expect(chunks.join('')).toBe(text)
    for (const c of chunks) expect(c.trim().split(/\s+/).length).toBeLessThanOrEqual(3)
    expect(chunkWords('', createRng(1))).toEqual([])
  })

  it('resolves false as soon as the signal aborts', async () => {
    const controller = new AbortController()
    const pending = abortableSleep(10_000, controller.signal)
    controller.abort()
    await expect(pending).resolves.toBe(false)
    await expect(abortableSleep(1, new AbortController().signal)).resolves.toBe(true)
  })
})
