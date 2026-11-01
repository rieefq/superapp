import { beforeEach, describe, expect, it } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { useSecretsStore } from '@/core/secrets'
import { ANTHROPIC_NEEDS_KEY } from './providers/anthropic'
import { OAI_NEEDS_CONFIG } from './providers/openaiCompatible'
import { checkModel, getModelInfo, getProvider, listModels, listProviders, OAI_PLACEHOLDER_ID, providerFor, unavailableMessage } from './registry'

function connectEndpoint(model = 'llama3.2') {
  db.insert('connections', { id: 'openai-compatible', status: 'connected', mode: 'live', scopes: [], config: { baseUrl: 'http://localhost:11434/v1', model }, usageCount: 0 })
}

describe('model registry', () => {
  beforeEach(() => {
    db.replaceAll(emptyTables())
    useSecretsStore.setState({ secrets: {} })
  })

  it('knows the three providers', () => {
    expect(listProviders().map((p) => p.id)).toEqual(['simulator', 'anthropic', 'openai-compatible'])
    expect(getProvider('anthropic')?.kind).toBe('live')
    expect(getProvider('nope')).toBeUndefined()
  })

  it('resolves catalog and dynamic oai:* models', () => {
    expect(getModelInfo('claude-sonnet-5-5')?.providerId).toBe('anthropic')
    expect(getModelInfo('oai:qwen2.5')).toMatchObject({ id: 'oai:qwen2.5', label: 'qwen2.5 · custom endpoint', providerId: 'openai-compatible' })
    expect(getModelInfo('gpt-unknown')).toBeUndefined()
    expect(providerFor('sim-deep')?.id).toBe('simulator')
    expect(providerFor('oai:anything')?.id).toBe('openai-compatible')
    expect(providerFor('claude-opus-5-5')?.id).toBe('anthropic')
  })

  it('reports availability with actionable reasons and never falls back silently', () => {
    const byId = () => Object.fromEntries(listModels().map((m) => [m.model.id, m]))
    let models = byId()
    expect(models['sim-swift']).toMatchObject({ available: true })
    expect(models['sim-deep']).toMatchObject({ available: true })
    expect(models['claude-opus-5-5']).toMatchObject({ available: false, reason: ANTHROPIC_NEEDS_KEY })
    expect(models[OAI_PLACEHOLDER_ID]).toMatchObject({ available: false, reason: OAI_NEEDS_CONFIG })
    expect(unavailableMessage('claude-opus-5-5')).toBe('Add your Anthropic API key in Integrations to use Claude Opus 5.5.')

    useSecretsStore.setState({ secrets: { anthropic: { apiKey: 'sk-ant-x' } } })
    connectEndpoint()
    models = byId()
    expect(models['claude-opus-5-5']).toMatchObject({ available: true })
    expect(models['oai:llama3.2']).toMatchObject({ available: true })
    expect(models[OAI_PLACEHOLDER_ID]).toBeUndefined()
    expect(unavailableMessage('claude-opus-5-5')).toBeUndefined()
  })

  it('flags models of a reconfigured endpoint and unknown ids', () => {
    connectEndpoint('qwen2.5')
    expect(checkModel('oai:llama3.2')).toMatchObject({ available: false })
    expect(checkModel('oai:llama3.2').reason).toContain('qwen2.5')
    expect(checkModel('gpt-unknown')).toMatchObject({ available: false })
    expect(checkModel('gpt-unknown').model).toBeUndefined()
    expect(unavailableMessage('gpt-unknown')).toMatch(/Unknown model/)
  })
})
