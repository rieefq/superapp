import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { getSecret, useSecretsStore } from '@/core/secrets'
import type { RunStep } from '@/core/types'
import {
  agentUsesIntegration,
  connect,
  disconnect,
  recordUsage,
  testConnection,
  updateScope,
  useConnectionsList,
  useIntegrationUsage,
} from './integrations'
import { fx } from './testFixtures'

const sdk = vi.hoisted(() => ({ list: vi.fn(), options: [] as unknown[] }))

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number
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
    constructor(options: unknown) {
      sdk.options.push(options)
    }
  }
  return { default: Anthropic }
})

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 401 ? 'Unauthorized' : 'OK', json: async () => body } as Response
}

beforeEach(() => {
  db.replaceAll(emptyTables())
  useSecretsStore.setState({ secrets: {} })
  sdk.options.length = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('connect', () => {
  it('connects simulated integrations after a short delay, with default scopes', async () => {
    vi.useFakeTimers()
    const pending = connect('slack')
    expect(db.get('connections', 'slack')).toMatchObject({ status: 'connecting', mode: 'simulated' })
    await vi.advanceTimersByTimeAsync(1500)
    const conn = await pending
    expect(conn).toMatchObject({ status: 'connected', mode: 'simulated', usageCount: 0, scopes: [{ capability: 'messages.send', mode: 'ask' }] })
    expect(conn.account).toMatch(/\.example$/)
    expect(db.all('activity')[0]).toMatchObject({ verb: 'connected', summary: expect.stringContaining('Slack (simulated)') })
  })

  it('does not resurrect a connection that was disconnected while connecting', async () => {
    vi.useFakeTimers()
    const pending = connect('notion')
    disconnect('notion')
    await vi.advanceTimersByTimeAsync(1500)
    expect((await pending).status).toBe('disconnected')
  })

  it('stores the Anthropic key in the vault and shows only its last 4 characters', async () => {
    const conn = await connect('anthropic', { apiKey: ' sk-ant-test-abcd ' })
    expect(conn).toMatchObject({ status: 'connected', mode: 'live', account: 'API key …abcd', config: {} })
    expect(getSecret('anthropic', 'apiKey')).toBe('sk-ant-test-abcd')
    expect(JSON.stringify(db.all('connections'))).not.toContain('sk-ant')
  })

  it('requires non-optional fields and validates endpoint URLs', async () => {
    await expect(connect('anthropic', {})).rejects.toThrow('API key is required.')
    await expect(connect('openai-compatible', { baseUrl: 'not a url', model: 'llama3.2' })).rejects.toThrow(/valid base URL/)
    const conn = await connect('openai-compatible', { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', apiKey: '' })
    expect(conn).toMatchObject({ status: 'connected', mode: 'live', account: 'localhost:11434', config: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' } })
  })

  it('verifies GitHub with a real rate_limit request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ resources: { core: { remaining: 59, limit: 60 } } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await connect('github')).toMatchObject({ status: 'connected', mode: 'live', account: 'Public access' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/rate_limit', { headers: { Accept: 'application/vnd.github+json' } })

    const conn = await connect('github', { token: 'ghp_secret1234' })
    expect(conn.account).toBe('Personal access token …1234')
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.github.com/rate_limit', {
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ghp_secret1234' },
    })
    expect(conn.scopes).toEqual([
      { capability: 'repo.read', mode: 'allow' },
      { capability: 'repo.write', mode: 'ask' },
      { capability: 'repo.pull_request', mode: 'ask' },
    ])
  })

  it('marks GitHub as errored when verification fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Bad credentials' }, 401)))
    const conn = await connect('github', { token: 'ghp_bad' })
    expect(conn).toMatchObject({ status: 'error', error: 'GitHub rejected the token (401 Bad credentials).' })
    expect(db.all('notifications')[0]).toMatchObject({ kind: 'integration.error', tone: 'danger' })

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect((await connect('github')).error).toBe('Couldn’t reach api.github.com (Failed to fetch).')
  })
})

describe('disconnect, scopes and usage', () => {
  it('disconnects, clears secrets and keeps history', async () => {
    await connect('anthropic', { apiKey: 'sk-ant-xyz-9999' })
    recordUsage('anthropic')
    recordUsage('anthropic')
    const conn = disconnect('anthropic')!
    expect(conn).toMatchObject({ status: 'disconnected', usageCount: 2 })
    expect(conn.lastUsedAt).toBeTypeOf('number')
    expect(getSecret('anthropic', 'apiKey')).toBeUndefined()
    expect(db.all('activity').map((e) => e.verb)).toEqual(['connected', 'disconnected'])
  })

  it('updates one capability scope', () => {
    expect(updateScope('slack', 'messages.send', 'allow').scopes).toEqual([{ capability: 'messages.send', mode: 'allow' }])
    expect(() => updateScope('slack', 'repo.read', 'allow')).toThrow(/does not provide/)
  })
})

describe('testConnection', () => {
  it('lists Anthropic models through the SDK', async () => {
    await connect('anthropic', { apiKey: 'sk-ant-live-0000' })
    sdk.list.mockResolvedValueOnce({ data: [{ display_name: 'Claude Opus 5.5' }] })
    expect(await testConnection('anthropic')).toEqual({ ok: true, live: true, message: 'Anthropic API key works · latest model: Claude Opus 5.5' })
    expect(sdk.list).toHaveBeenCalledWith({ limit: 1 })
    expect(sdk.options[0]).toMatchObject({ apiKey: 'sk-ant-live-0000', dangerouslyAllowBrowser: true })
  })

  it('reports a rejected Anthropic key and flags the connection', async () => {
    await connect('anthropic', { apiKey: 'sk-ant-bad-0000' })
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    sdk.list.mockRejectedValueOnce(new Anthropic.AuthenticationError(401, undefined, 'invalid x-api-key', new Headers()))
    expect(await testConnection('anthropic')).toEqual({ ok: false, live: true, message: 'Anthropic rejected the API key (401).' })
    expect(db.get('connections', 'anthropic')).toMatchObject({ status: 'error', error: 'Anthropic rejected the API key (401).' })
  })

  it('checks GitHub quota and OpenAI-compatible model lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ resources: { core: { remaining: 4999, limit: 5000 } } })))
    expect(await testConnection('github')).toEqual({ ok: true, live: true, message: 'GitHub API reachable (public access) · 4999/5000 requests left this hour' })

    await connect('openai-compatible', { baseUrl: 'http://localhost:11434/v1/', model: 'llama3.2' })
    const fetchMock = vi.fn(async () => jsonResponse({ data: [{ id: 'llama3.2' }, { id: 'qwen3' }] }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await testConnection('openai-compatible')).toMatchObject({ ok: true, message: 'Endpoint reachable · 2 models · “llama3.2” is available' })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/v1/models', { headers: {} })
  })

  it('answers locally for simulated integrations', async () => {
    vi.useFakeTimers()
    const notConnected = testConnection('slack')
    expect(await notConnected).toEqual({ ok: false, live: false, message: 'Connect Slack first.' })
    const pending = connect('slack')
    await vi.advanceTimersByTimeAsync(1500)
    await pending
    const test = testConnection('slack')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await test).toEqual({ ok: true, live: false, message: 'Simulated connection is responding' })
  })
})

describe('hooks', () => {
  it('joins the catalog with connection rows', () => {
    const { result } = renderHook(() => useConnectionsList())
    expect(result.current.find((i) => i.def.id === 'slack')).toMatchObject({ status: 'available', connection: undefined })
    act(() => db.insert('connections', { id: 'slack', status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0 }))
    expect(result.current.find((i) => i.def.id === 'slack')?.status).toBe('connected')
  })

  it('derives agents, workflows and recent steps that use an integration', () => {
    const step = (id: string, startedAt: number, integrationId?: string): RunStep => ({ id, kind: 'tool', title: id, status: 'done', startedAt, integrationId })
    db.insertMany('agents', [
      fx.agent({ id: 'a_explicit', name: 'B', capabilities: [{ capability: 'web.search', mode: 'allow', integrationId: 'web-search' }] }),
      fx.agent({ id: 'a_sole', name: 'A', capabilities: [{ capability: 'web.browse', mode: 'allow' }] }),
      fx.agent({ id: 'a_denied', capabilities: [{ capability: 'web.search', mode: 'deny', integrationId: 'web-search' }] }),
      fx.agent({ id: 'a_other', capabilities: [{ capability: 'messages.send', mode: 'allow' }] }),
    ])
    db.insert('workflows', fx.workflow({ id: 'w1', nodes: [{ id: 'n1', type: 'action', label: 'Search', position: { x: 0, y: 0 }, config: {}, integrationId: 'web-search' }] }))
    db.insert('runs', fx.run({ id: 'r1', steps: [step('s1', 10, 'web-search'), step('s2', 30, 'web-search'), step('s3', 20, 'slack')] }))
    db.insert('connections', { id: 'web-search', status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 1, lastUsedAt: 5 })

    const { result } = renderHook(() => useIntegrationUsage('web-search'))
    expect(result.current.agents.map((a) => a.id)).toEqual(['a_sole', 'a_explicit'])
    expect(result.current.workflows.map((w) => w.id)).toEqual(['w1'])
    expect(result.current.recentSteps.map((s) => s.step.id)).toEqual(['s2', 's1'])
    expect(result.current.recentSteps[0]).toMatchObject({ run: { kind: 'run', id: 'r1' }, simulated: true, at: 30 })
    expect(result.current).toMatchObject({ usageCount: 2, lastUsedAt: 30 })
    expect(agentUsesIntegration(db.get('agents', 'a_other')!, 'slack')).toBe(false)
  })
})
