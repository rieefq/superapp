import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearGithubCache, getLastRateLimit, getRateLimit, getRepo, resetRateLimit, subscribeRateLimit } from './client'

/** The GitHub REST quota the Code workspace shows ("52/60 requests left this hour"). */

const reset = Math.floor(new Date('2026-11-01T11:00:00Z').getTime() / 1000)
const quota = (remaining: number, resource = 'core') => ({
  'x-ratelimit-limit': '60',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(reset),
  'x-ratelimit-resource': resource,
})

beforeEach(() => {
  clearGithubCache()
  resetRateLimit()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rate limit', () => {
  it('records the core quota from API response headers and notifies listeners', async () => {
    const seen: (number | undefined)[] = []
    const off = subscribeRateLimit(() => seen.push(getLastRateLimit()?.remaining))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { name: 'w', full_name: 'o/w', owner: { login: 'o' }, default_branch: 'main', description: null, language: null, stargazers_count: 0, html_url: 'https://github.com/o/w', private: false },
          { headers: quota(52) },
        ),
      ),
    )
    expect(getLastRateLimit()).toBeNull()
    await getRepo('o', 'w')
    expect(getLastRateLimit()).toMatchObject({ limit: 60, remaining: 52, resetAt: reset * 1000 })
    off()
    expect(seen).toEqual([52])
  })

  it('ignores other resources (search, graphql) and responses without quota headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { headers: quota(3, 'search') })))
    await getRepo('o', 'w')
    expect(getLastRateLimit()).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({})))
    await getRepo('o', 'w')
    expect(getLastRateLimit()).toBeNull()
  })

  it('reads /rate_limit (which does not count against the quota)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.github.com/rate_limit')
      return Response.json({ resources: { core: { limit: 5000, remaining: 4990, reset } } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await getRateLimit()
    expect(res).toMatchObject({ ok: true, data: { limit: 5000, remaining: 4990, resetAt: reset * 1000 } })
    expect(getLastRateLimit()?.remaining).toBe(4990)
  })

  it('reports an unreadable quota and a network failure as errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nope: true })))
    expect(await getRateLimit()).toMatchObject({ ok: false, error: { kind: 'http' } })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await getRateLimit()).toMatchObject({ ok: false, error: { kind: 'network' } })
  })
})
