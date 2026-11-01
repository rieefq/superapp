/**
 * Product wording for the Integrations workspace (§6.11, §8.3, §8.4) in one place: hints, the key
 * warning, the honest "what's real" notes and toasts. Pure — unit-tested in logic.test.ts.
 */
import { MODEL_CATALOG } from '@/core/ai/models'
import type { IntegrationConnection, IntegrationDef } from '@/core/types'

type FieldDef = NonNullable<IntegrationDef['fields']>[number]

/** §8.4: the exact simulated-integration line. */
export const SIMULATED_LINE = 'Simulated — nothing leaves your browser.'

const HINTS: Record<string, string> = {
  'anthropic.apiKey': 'Starts with sk-ant-. Create one at console.anthropic.com → API keys.',
  'openai-compatible.baseUrl': 'The server’s OpenAI-compatible base URL, usually ending in /v1.',
  'openai-compatible.model': 'Exactly as the server lists it, e.g. llama3.2 or qwen3.',
  'openai-compatible.apiKey': 'Only if your server needs one (OpenRouter does; a local Ollama doesn’t).',
  'github.token': 'Public repositories work without one; a token reads private repositories and raises the limit to 5,000 requests an hour.',
}

export function fieldHint(def: IntegrationDef, field: FieldDef): string | undefined {
  return HINTS[`${def.id}.${field.key}`]
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}

/**
 * The key warning (§6.11): "Your key is stored only in this browser and sent directly to {provider}.
 * Anyone with access to this browser profile can use it. Use a key with a spending limit."
 */
export function keyWarning(def: IntegrationDef, baseUrl?: string): string | undefined {
  if (!(def.fields ?? []).some((f) => f.secret)) return undefined
  if (def.id === 'github') {
    return 'Your token is stored only in this browser and sent directly to GitHub. Anyone with access to this browser profile can use it. Use a fine-grained token with read-only access.'
  }
  const provider = def.id === 'openai-compatible' ? (hostOf(baseUrl) ?? 'your endpoint') : def.name
  return `Your key is stored only in this browser and sent directly to ${provider}. Anyone with access to this browser profile can use it. Use a key with a spending limit.`
}

/** The honest note at the top of a detail page (`supportNote`, or the simulated default). */
export function whatsReal(def: IntegrationDef): string {
  if (def.supportNote) return def.supportNote
  return def.support === 'simulated'
    ? `Simulated. Atrium emulates ${def.name} locally so agents and workflows can use it in this build. Connecting creates a fictional account on an .example domain; everything it sends or reads is generated here and labeled simulated.`
    : `Live. Atrium makes real requests to ${def.name} from your browser.`
}

/** The note's body when the SIMULATED line or badge is already shown next to it (no "Simulated." twice). */
export function whatsRealBody(def: IntegrationDef): string {
  const note = whatsReal(def)
  return def.support === 'simulated' ? note.replace(/^Simulated\.\s*/, '') : note
}

/** What "Test connection" will do, before it runs (§6.11). */
export function testDescription(def: IntegrationDef): string {
  switch (def.id) {
    case 'anthropic':
      return 'Makes one real, free request: lists your available models.'
    case 'openai-compatible':
      return 'Makes one real request: GET /models on your endpoint.'
    case 'github':
      return 'Makes one real request to GitHub’s rate-limit endpoint.'
    default:
      return 'A simulated handshake — labeled simulated, nothing leaves your browser.'
  }
}

export function submitLabel(def: IntegrationDef, connected: boolean): string {
  if (!connected) return def.category === 'models' ? (def.id === 'anthropic' ? 'Save key and connect' : 'Save and connect') : `Connect ${def.name}`
  return def.id === 'anthropic' ? 'Replace key' : 'Save changes'
}

/** The button that unfolds the form on a connected integration. */
export function editLabel(def: IntegrationDef, hasSecret: boolean): string {
  if (def.id === 'anthropic') return 'Replace key'
  if (def.id === 'openai-compatible') return 'Edit endpoint'
  if (def.id === 'github') return hasSecret ? 'Replace token' : 'Add a token'
  return 'Edit connection'
}

export function connectedToast(def: IntegrationDef, conn: IntegrationConnection): { title: string; description: string } {
  if (def.id === 'anthropic') return { title: 'Anthropic connected', description: 'Claude models are now available in every model picker.' }
  if (def.id === 'openai-compatible') {
    const model = conn.config.model
    return {
      title: 'Endpoint connected',
      description: model ? `“${model} · custom endpoint” is now available in every model picker.` : 'Its model is now available in every model picker.',
    }
  }
  if (def.support === 'simulated') return { title: `${def.name} connected (simulated)`, description: SIMULATED_LINE }
  return { title: `${def.name} connected`, description: conn.account ? `Connected as ${conn.account}.` : 'Connected.' }
}

/** Short config labels for the "Connection" key/value list (`defaultChannel` → "Default channel"). */
export function configLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What connecting a model provider adds (shown while it isn't connected). */
export function modelsFact(def: IntegrationDef): string {
  if (def.id === 'anthropic') {
    const n = MODEL_CATALOG.filter((m) => m.providerId === 'anthropic' && !m.hidden).length
    return `Adds ${n} Claude models to every model picker`
  }
  return 'Adds your endpoint’s model to every model picker'
}
