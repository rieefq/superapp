import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables, useDB } from '@/core/db'
import { getSecret, setSecret, useSecretsStore } from '@/core/secrets'
import {
  connect,
  diagnoseConnection,
  disconnect,
  disconnectImpactIn,
  forgetSecrets,
  scopesFor,
  storedSecretLabels,
  testConnection,
  useConnectionTest,
  useIntegrationUsage,
  validateConnectionValues,
} from '@/core/services/integrations'
import { fx } from '@/core/services/testFixtures'

/*
 * The enriched integrations service (validation, diagnoses with the provider's words and the fix,
 * forgetting keys, the disconnect ReadBack, narrow usage subscriptions). The original behaviour is
 * covered by src/core/services/integrations.test.ts, which still passes unchanged.
 */

const sdk = vi.hoisted(() => ({ list: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number
    error?: unknown
    constructor(status?: number, error?: unknown, message?: string) {
      super(message ?? String(status))
      this.status = status
      this.error = error
    }
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionError extends APIError {}
  class Anthropic {
    static APIError = APIError
    static AuthenticationError = AuthenticationError
    static PermissionDeniedError = PermissionDeniedError
    static RateLimitError = RateLimitError
    static APIConnectionError = APIConnectionError
    models = { list: sdk.list }
  }
  return { default: Anthropic }
})

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: '', headers: new Headers(), json: async () => body } as unknown as Response
}

beforeEach(() => {
  db.replaceAll(emptyTables())
  useSecretsStore.setState({ secrets: {} })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('validateConnectionValues', () => {
  it('rejects a malformed Anthropic key, accepts a stored one, and checks URLs', () => {
    expect(validateConnectionValues('anthropic', { apiKey: 'abc' })).toEqual([
      { key: 'apiKey', message: 'Anthropic API keys start with “sk-ant-”. Copy the whole key from console.anthropic.com.' },
    ])
    expect(validateConnectionValues('anthropic', { apiKey: 'sk-ant-has space' })[0].message).toMatch(/can’t contain spaces/)
    expect(validateConnectionValues('anthropic', { apiKey: '' })).toEqual([{ key: 'apiKey', message: 'API key is required.' }])
    setSecret('anthropic', 'apiKey', 'sk-ant-stored-1234')
    expect(validateConnectionValues('anthropic', { apiKey: '' })).toEqual([])
    expect(validateConnectionValues('openai-compatible', { baseUrl: 'ftp://x', model: 'm' })[0]).toEqual({
      key: 'baseUrl',
      message: 'Enter a valid base URL, e.g. http://localhost:11434/v1',
    })
    expect(validateConnectionValues('github', {})).toEqual([])
  })

  it('connect never stores a malformed key', async () => {
    await expect(connect('anthropic', { apiKey: 'nope' })).rejects.toThrow(/start with “sk-ant-”/)
    expect(getSecret('anthropic', 'apiKey')).toBeUndefined()
    expect(db.get('connections', 'anthropic')).toBeUndefined()
  })
})

describe('diagnoseConnection', () => {
  it('reports the provider’s own words and the exact fix for a rejected Anthropic key', async () => {
    await connect('anthropic', { apiKey: 'sk-ant-bad-0000' })
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    sdk.list.mockRejectedValueOnce(
      new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, '401 invalid', new Headers()),
    )
    const d = await diagnoseConnection('anthropic')
    expect(d).toMatchObject({
      ok: false,
      live: true,
      problem: 'auth',
      providerMessage: 'invalid x-api-key',
      message: 'Anthropic rejected the API key (401).',
      request: 'GET api.anthropic.com/v1/models',
    })
    expect(d.fix).toMatch(/console\.anthropic\.com/)
    expect(d.durationMs).toBeGreaterThanOrEqual(0)
    expect(db.all('activity').some((e) => e.verb === 'tested' && e.summary.includes('failed'))).toBe(true)
  })

  it('explains a CORS / unreachable endpoint with this origin', async () => {
    await connect('openai-compatible', { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    const d = await diagnoseConnection('openai-compatible')
    expect(d).toMatchObject({ ok: false, live: true, problem: 'cors' })
    expect(d.fix).toContain(`allow this origin in your server settings: ${window.location.origin}`)
    expect(d.fix).toContain('OLLAMA_ORIGINS=')
  })

  it('flags a 404 endpoint with the /v1 hint and a GitHub rate limit with the token hint', async () => {
    await connect('openai-compatible', { baseUrl: 'http://localhost:1234', model: 'qwen3' })
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: { message: 'Not found' } }, 404)))
    const notFound = await diagnoseConnection('openai-compatible')
    expect(notFound).toMatchObject({ problem: 'not_found', providerMessage: 'Not found' })
    expect(notFound.fix).toMatch(/end in \/v1/)

    const limited = { ...response({ message: 'API rate limit exceeded' }, 403), headers: new Headers({ 'x-ratelimit-remaining': '0' }) } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(async () => limited))
    const gh = await diagnoseConnection('github')
    expect(gh).toMatchObject({ ok: false, problem: 'rate_limit', providerMessage: 'API rate limit exceeded' })
    expect(gh.fix).toMatch(/5,000 requests an hour/)
  })

  it('keeps a simulated error honest (no magic fix) and labels the handshake', async () => {
    vi.useFakeTimers()
    db.insert('connections', { id: 'jira', status: 'error', mode: 'simulated', scopes: [], config: {}, usageCount: 0, error: 'Token expired — reconnect to resume syncing' })
    const pending = diagnoseConnection('jira')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({ ok: false, live: false, problem: 'expired', message: 'Token expired — reconnect to resume syncing' })
    expect(db.get('connections', 'jira')?.status).toBe('error')

    const reconnecting = connect('jira')
    await vi.advanceTimersByTimeAsync(1000)
    expect((await reconnecting).status).toBe('connected')
    const test = testConnection('jira')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await test).toEqual({ ok: true, live: false, message: 'Simulated connection is responding' })
  })

  it('keeps the last result per integration and whether a test is running', async () => {
    vi.useFakeTimers()
    db.insert('connections', { id: 'slack', status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0 })
    const { result } = renderHook(() => useConnectionTest('slack'))
    expect(result.current).toEqual({ result: undefined, running: false })
    let pending!: Promise<unknown>
    act(() => {
      pending = diagnoseConnection('slack')
    })
    expect(result.current.running).toBe(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await pending
    })
    expect(result.current.running).toBe(false)
    expect(result.current.result).toMatchObject({ ok: true, live: false, request: 'Simulated handshake — nothing left your browser' })
    act(() => {
      disconnect('slack')
    })
    expect(result.current.result).toBeUndefined()
  })
})

describe('forgetSecrets', () => {
  it('ends an Anthropic connection (the key is required) but keeps GitHub on public access', async () => {
    await connect('anthropic', { apiKey: 'sk-ant-xyz-9999' })
    expect(storedSecretLabels('anthropic')).toEqual(['API key'])
    expect(forgetSecrets('anthropic')?.status).toBe('disconnected')
    expect(getSecret('anthropic', 'apiKey')).toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => response({ resources: { core: { remaining: 4999, limit: 5000 } } })))
    await connect('github', { token: 'ghp_secret1234' })
    expect(db.get('connections', 'github')?.account).toBe('Personal access token …1234')
    expect(forgetSecrets('github')).toMatchObject({ status: 'connected', account: 'Public access' })
    expect(db.all('activity').map((e) => e.summary)).toContain('Forgot the GitHub personal access token stored in this browser')
  })
})

describe('disconnectImpactIn', () => {
  it('lists the agents (with blocked capabilities), workflows and stored secrets that disconnecting affects', () => {
    db.insertMany('agents', [
      fx.agent({ id: 'a_herald', name: 'Herald', capabilities: [{ capability: 'messages.send', mode: 'ask', integrationId: 'slack' }] }),
      fx.agent({ id: 'a_other', name: 'Other', capabilities: [{ capability: 'messages.send', mode: 'deny', integrationId: 'slack' }] }),
    ])
    db.insertMany('workflows', [
      fx.workflow({ id: 'w_on', name: 'Digest', nodes: [{ id: 'n1', type: 'action', label: 'Post', position: { x: 0, y: 0 }, config: {}, integrationId: 'slack' }] }),
      fx.workflow({ id: 'w_off', name: 'Assets', enabled: false, trigger: { type: 'event', label: 'Message', integrationId: 'slack' } }),
    ])
    db.insert('connections', { id: 'slack', status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 6 })
    const impact = disconnectImpactIn(useDB.getState(), 'slack')
    expect(impact.agents.map((a) => [a.agent.name, a.capabilities])).toEqual([['Herald', ['messages.send']]])
    expect(impact.workflows.map((w) => [w.workflow.id, w.nodes.length, w.trigger])).toEqual([
      ['w_on', 1, false],
      ['w_off', 0, true],
    ])
    expect(impact).toMatchObject({ repos: [], secrets: [], usageCount: 6 })
  })

  it('fills default scopes for capabilities a row doesn’t list yet', () => {
    expect(scopesFor('github', undefined)).toEqual([
      { capability: 'repo.read', mode: 'allow' },
      { capability: 'repo.write', mode: 'ask' },
      { capability: 'repo.pull_request', mode: 'ask' },
    ])
  })
})

describe('useIntegrationUsage', () => {
  it('re-renders for steps on this integration, not for other run churn', () => {
    db.insert('runs', fx.run({ id: 'r1', projectId: 'prj_1', steps: [{ id: 's1', kind: 'message', title: 'Post', status: 'done', startedAt: 10, integrationId: 'slack' }] }))
    db.insert('runs', fx.run({ id: 'r2', steps: [{ id: 's2', kind: 'think', title: 'Think', status: 'running', startedAt: 20 }] }))
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useIntegrationUsage('slack')
    })
    expect(result.current.recentSteps.map((s) => [s.step.id, s.projectId])).toEqual([['s1', 'prj_1']])
    const before = renders
    act(() => {
      db.update('runs', 'r2', (r) => ({ ...r, steps: r.steps.map((s) => ({ ...s, output: 'token token token' })) }))
    })
    expect(renders).toBe(before)
    act(() => {
      db.update('runs', 'r1', (r) => ({ ...r, steps: [...r.steps, { id: 's3', kind: 'message', title: 'Post again', status: 'running', startedAt: 30, integrationId: 'slack' }] }))
    })
    expect(result.current.recentSteps.map((s) => s.step.id)).toEqual(['s3', 's1'])
  })
})
