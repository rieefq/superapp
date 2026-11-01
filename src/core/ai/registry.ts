import { useMemo } from 'react'
import { useRow } from '@/core/db'
import { useSecretsStore } from '@/core/secrets'
import { getModel, MODEL_CATALOG } from './models'
import { anthropicProvider, ANTHROPIC_NEEDS_KEY } from './providers/anthropic'
import { OAI_MODEL_PREFIX, OAI_NEEDS_CONFIG, oaiModelInfo, openAiCompatibleProvider, readOaiConfig } from './providers/openaiCompatible'
import { simulatorProvider } from './providers/simulator'
import type { ModelInfo, ModelProvider, ProviderId } from './types'

/**
 * Model/provider registry. Availability is computed live from the secrets vault and the
 * `openai-compatible` connection. There is deliberately NO silent fallback to the simulator:
 * an unavailable live model produces an actionable reason instead.
 */

const PROVIDERS: Record<ProviderId, ModelProvider> = {
  simulator: simulatorProvider,
  anthropic: anthropicProvider,
  'openai-compatible': openAiCompatibleProvider,
}

/** Placeholder listed when no custom endpoint is configured, so pickers can show how to add one. */
export const OAI_PLACEHOLDER_ID = `${OAI_MODEL_PREFIX}custom`

export function getProvider(id: ProviderId | string | undefined): ModelProvider | undefined {
  return id && id in PROVIDERS ? PROVIDERS[id as ProviderId] : undefined
}

export function listProviders(): ModelProvider[] {
  return Object.values(PROVIDERS)
}

/** Catalog models (including hidden ones) plus dynamic `oai:*` models. */
export function getModelInfo(id: string | undefined): ModelInfo | undefined {
  if (!id) return undefined
  const known = getModel(id)
  if (known) return known
  if (id.startsWith(OAI_MODEL_PREFIX) && id.length > OAI_MODEL_PREFIX.length) {
    const cfg = readOaiConfig()
    const model = id.slice(OAI_MODEL_PREFIX.length)
    return oaiModelInfo(model, cfg?.model === model ? cfg.baseUrl : undefined)
  }
  return undefined
}

export function providerFor(modelId: string | undefined): ModelProvider | undefined {
  if (modelId?.startsWith(OAI_MODEL_PREFIX)) return PROVIDERS['openai-compatible']
  return getProvider(getModelInfo(modelId)?.providerId)
}

export interface ModelAvailability {
  model: ModelInfo
  available: boolean
  /** Short, actionable reason when unavailable (for pickers and tooltips). */
  reason?: string
}

export interface ModelCheck {
  /** Undefined for an unknown model id. */
  model?: ModelInfo
  provider?: ModelProvider
  available: boolean
  reason?: string
}

/** Availability of one model id, with a reason when it cannot be used right now. */
export function checkModel(modelId: string | undefined): ModelCheck {
  const model = getModelInfo(modelId)
  if (!model) return { available: false, reason: `Unknown model “${modelId ?? ''}”. Pick another model in the model menu.` }
  const provider = getProvider(model.providerId)
  if (model.providerId === 'simulator') return { model, provider, available: true }
  if (model.providerId === 'anthropic') {
    const status = anthropicProvider.status()
    return status.state === 'ready' ? { model, provider, available: true } : { model, provider, available: false, reason: ANTHROPIC_NEEDS_KEY }
  }
  const cfg = readOaiConfig()
  if (!cfg) return { model, provider, available: false, reason: OAI_NEEDS_CONFIG }
  if (model.id !== `${OAI_MODEL_PREFIX}${cfg.model}`) {
    return { model, provider, available: false, reason: `The custom endpoint now serves “${cfg.model}”. Switch to it or update the endpoint in Integrations` }
  }
  return { model, provider, available: true }
}

/**
 * Full sentence for chat errors: "Add your Anthropic API key in Integrations to use Claude Opus 5.5."
 */
export function unavailableMessage(modelId: string | undefined): string | undefined {
  const check = checkModel(modelId)
  if (check.available) return undefined
  const reason = check.reason ?? 'This model is unavailable'
  return reason.endsWith('.') || !check.model ? reason : `${reason} to use ${check.model.label}.`
}

/** Every selectable model with its availability (simulator models are always available). */
export function listModels(): ModelAvailability[] {
  const out: ModelAvailability[] = []
  for (const model of MODEL_CATALOG) {
    if (model.hidden) continue
    const { available, reason } = checkModel(model.id)
    out.push(reason ? { model, available, reason } : { model, available })
  }
  const cfg = readOaiConfig()
  if (cfg) {
    out.push({ model: oaiModelInfo(cfg.model, cfg.baseUrl), available: true })
  } else {
    out.push({
      model: { ...oaiModelInfo('custom'), id: OAI_PLACEHOLDER_ID, label: 'Custom endpoint', description: 'Any OpenAI-compatible server: Ollama, LM Studio, vLLM, OpenRouter.' },
      available: false,
      reason: OAI_NEEDS_CONFIG,
    })
  }
  return out
}

/** Values availability depends on; hooks recompute when any of them changes. */
function useAvailabilityInputs(): readonly unknown[] {
  const anthropicKey = useSecretsStore((s) => s.secrets.anthropic?.apiKey ?? '')
  const oaiKey = useSecretsStore((s) => s.secrets['openai-compatible']?.apiKey ?? '')
  const oaiConnection = useRow('connections', 'openai-compatible')
  return [anthropicKey, oaiKey, oaiConnection]
}

/** Models with availability; re-renders when API keys or the custom endpoint change. */
export function useModels(): ModelAvailability[] {
  const inputs = useAvailabilityInputs()
  // Recompute only when one of the store inputs changes.
  return useMemo(() => listModels(), inputs)
}

/** Availability for one model id (for composer warnings before sending). */
export function useModelAvailability(modelId: string | undefined): ModelCheck {
  const inputs = useAvailabilityInputs()
  // Recompute only when one of the store inputs changes.
  return useMemo(() => checkModel(modelId), [modelId, ...inputs])
}
