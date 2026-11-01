import { createRng, type Rng } from '@/lib/rng'
import { estimateTokens, MODEL_CATALOG } from '../models'
import { composeAnswer } from '../simulator/compose'
import type { ChatTurn, GenerateRequest, ModelProvider, StreamEvent } from '../types'

/**
 * Local simulator provider: composes a grounded markdown answer with the template engine
 * in `../simulator` and streams it in word chunks. Never leaves the browser; every message it
 * produces is marked `simulated` by chat orchestration.
 */

export interface SimulatorOptions {
  /** Delay before each streamed chunk, in ms. Default: seeded 12–35ms. */
  chunkDelayMs?: (rng: Rng) => number
  /** Pause before the first token ("thinking"), in ms. Default: seeded 120–320ms. */
  firstTokenDelayMs?: (rng: Rng) => number
}

/** Resolve after `ms`, or immediately with `false` when the signal aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, Math.max(0, ms))
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Split text into streaming chunks of 1–3 words. Concatenating the chunks reproduces the
 * input exactly (whitespace and newlines included).
 */
export function chunkWords(text: string, rng: Rng): string[] {
  const tokens = text.match(/\s*\S+\s*/g) ?? (text ? [text] : [])
  const out: string[] = []
  for (let i = 0; i < tokens.length; ) {
    const take = rng.int(1, 3)
    out.push(tokens.slice(i, i + take).join(''))
    i += take
  }
  const joined = out.join('')
  if (joined.length < text.length) out.push(text.slice(joined.length))
  return out
}

function turnText(turn: ChatTurn): string {
  return typeof turn.content === 'string' ? turn.content : turn.content.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
}

async function* streamSimulated(req: GenerateRequest, signal: AbortSignal, opts: Required<SimulatorOptions>): AsyncGenerator<StreamEvent> {
  const model = MODEL_CATALOG.find((m) => m.id === req.modelId && m.providerId === 'simulator')
  if (!model) {
    yield { type: 'usage', inputTokens: 0, outputTokens: 0 }
    yield { type: 'error', error: `“${req.modelId}” is not a simulator model.`, retryable: false, code: 'bad_request' }
    return
  }
  const inputTokens = estimateTokens([req.system ?? '', ...req.messages.map(turnText)].join('\n'))
  const answer = composeAnswer({ modelId: model.id, system: req.system, messages: req.messages, seed: req.seed, reasoning: req.reasoning !== false })
  const rng = createRng(answer.seed ^ 0x9e3779b9)

  // Respect the output limit like a real model would.
  const limit = Math.min(req.maxTokens ?? model.maxOutput, model.maxOutput)
  let content = answer.content
  let stopReason: 'end' | 'max_tokens' = 'end'
  if (estimateTokens(content) > limit) {
    content = content.slice(0, Math.max(0, limit * 4))
    stopReason = 'max_tokens'
  }

  let emitted = ''
  const finish = function* (reason: 'end' | 'max_tokens' | 'stopped'): Generator<StreamEvent> {
    yield { type: 'usage', inputTokens, outputTokens: emitted ? estimateTokens(emitted) : 0 }
    yield { type: 'done', stopReason: reason }
  }

  if (!(await abortableSleep(opts.firstTokenDelayMs(rng), signal))) return yield* finish('stopped')
  const phases: Array<['reasoning' | 'text', string | undefined]> = [
    ['reasoning', answer.reasoning],
    ['text', content],
  ]
  for (const [type, text] of phases) {
    if (!text) continue
    for (const delta of chunkWords(text, rng)) {
      if (!(await abortableSleep(opts.chunkDelayMs(rng), signal))) return yield* finish('stopped')
      emitted += delta
      yield { type, delta }
    }
  }
  yield* finish(stopReason)
}

export function createSimulatorProvider(options: SimulatorOptions = {}): ModelProvider {
  const opts: Required<SimulatorOptions> = {
    chunkDelayMs: options.chunkDelayMs ?? ((rng) => rng.int(12, 35)),
    firstTokenDelayMs: options.firstTokenDelayMs ?? ((rng) => rng.int(120, 320)),
  }
  return {
    id: 'simulator',
    label: 'Simulator',
    kind: 'simulated',
    status: () => ({ state: 'ready' }),
    models: () => MODEL_CATALOG.filter((m) => m.providerId === 'simulator'),
    stream: (req, signal) => streamSimulated(req, signal, opts),
  }
}

export const simulatorProvider: ModelProvider = createSimulatorProvider()
