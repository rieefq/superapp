import type { ModelInfo } from './types'

/**
 * Model catalog. Claude pricing/context from Anthropic's published model table
 * (USD per million tokens). Simulator models are free and clearly marked simulated.
 */
export const MODEL_CATALOG: ModelInfo[] = [
  {
    id: 'sim-swift',
    providerId: 'simulator',
    label: 'Simulator · Swift',
    description: 'Local template engine. Instant, offline, not a real model.',
    contextWindow: 200_000,
    maxOutput: 8_000,
    pricing: { input: 0, output: 0 },
    capabilities: ['text', 'tools'],
    simulated: true,
  },
  {
    id: 'sim-deep',
    providerId: 'simulator',
    label: 'Simulator · Deep',
    description: 'Local template engine with longer, structured answers and a reasoning trace.',
    contextWindow: 200_000,
    maxOutput: 16_000,
    pricing: { input: 0, output: 0 },
    capabilities: ['text', 'reasoning', 'tools'],
    simulated: true,
  },
  {
    id: 'claude-opus-5-5',
    providerId: 'anthropic',
    label: 'Claude Opus 5.5',
    description: 'Anthropic’s default frontier model for complex reasoning, coding and agents.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 4, output: 20 },
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    simulated: false,
  },
  {
    id: 'claude-sonnet-5-5',
    providerId: 'anthropic',
    label: 'Claude Sonnet 5.5',
    description: 'Fast and capable for everyday writing, coding and agent work.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 2, output: 10 },
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    simulated: false,
  },
  {
    id: 'claude-haiku-5-5',
    providerId: 'anthropic',
    label: 'Claude Haiku 5.5',
    description: 'Lowest latency and cost for quick tasks.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 0.1, output: 0.5 },
    capabilities: ['text', 'vision', 'reasoning'],
    simulated: false,
  },
  {
    id: 'claude-fable-5-1',
    providerId: 'anthropic',
    label: 'Claude Fable 5.1',
    description: 'Anthropic’s most capable model for the hardest, long-horizon work.',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    pricing: { input: 10, output: 50 },
    capabilities: ['text', 'vision', 'reasoning', 'tools'],
    simulated: false,
  },
]

export const DEFAULT_MODEL_ID = 'sim-swift'

export function getModel(id: string | undefined): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.id === id)
}

/** Estimated USD cost for a token count on a model (0 for unknown/simulated models). */
export function estimateCost(modelId: string | undefined, inputTokens: number, outputTokens: number): number {
  const m = getModel(modelId)
  if (!m) return 0
  return (inputTokens * m.pricing.input + outputTokens * m.pricing.output) / 1_000_000
}

/**
 * Reference pricing used to *estimate* what simulated work would have cost on a real
 * model (shown with an "estimate" label in analytics). Defaults to Claude Sonnet 5.5.
 */
export function estimateReferenceCost(inputTokens: number, outputTokens: number, refModelId = 'claude-sonnet-5-5'): number {
  return estimateCost(refModelId, inputTokens, outputTokens)
}

/** Rough token estimate for text when a provider does not report usage (~4 chars/token). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}
