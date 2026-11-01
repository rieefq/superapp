import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSecrets, setSecret } from '@/core/secrets'
import { LruCache } from './cache'
import { clearGithubCache, formatResetTime, getFile, getRepo, getTree, parseRepoInput, peekFile } from './client'

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function text(body: string | Uint8Array, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers })
}

let fetchMock: ReturnType<typeof vi.fn>

function route(handler: Route) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init))
  vi.stubGlobal('fetch', fetchMock)
}

function headerOf(call: number, name: string): string | undefined {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined
  return (init?.headers as Record<string, string> | undefined)?.[name]
}

beforeEach(() => {
  clearGithubCache()
  clearSecrets('github')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseRepoInput', () => {
  it.each([
    ['vercel/next.js', { owner: 'vercel', name: 'next.js' }],
    ['  octocat/Hello-World  ', { owner: 'octocat', name: 'Hello-World' }],
    ['octocat/hello.git', { owner: 'octocat', name: 'hello' }],
    ['https://github.com/octocat/hello', { owner: 'octocat', name: 'hello' }],
    ['http://www.github.com/octocat/hello/', { owner: 'octocat', name: 'hello' }],
    ['github.com/octocat/hello/tree/main/src?x=1#readme', { owner: 'octocat', name: 'hello' }],
    ['git@github.com:octocat/hello.git', { owner: 'octocat', name: 'hello' }],
  ])('parses %s', (input, expected) => {
    expect(parseRepoInput(input)).toEqual(expected)
  })

  it.each(['', 'octocat', 'https://gitlab.com/a/b', 'example.com/a/b', 'octo cat/hello', '-bad/name', 'owner/..'])(
    'rejects %s',
    (input) => {
      expect(parseRepoInput(input)).toBeNull()
    },
  )
})

describe('getRepo', () => {
  const body = {
    name: 'hello',
    full_name: 'octocat/hello',
    owner: { login: 'octocat' },
    default_branch: 'trunk',
    description: 'Hi',
    language: 'TypeScript',
    stargazers_count: 42,
    html_url: 'https://github.com/octocat/hello',
    private: false,
  }

  it('maps the repository and sends no token when none is stored', async () => {
    route(() => json(body))
    const res = await getRepo('octocat', 'hello')
    expect(res).toEqual({
      ok: true,
      data: {
        owner: 'octocat',
        name: 'hello',
        fullName: 'octocat/hello',
        defaultBranch: 'trunk',
        description: 'Hi',
        language: 'TypeScript',
        stars: 42,
        htmlUrl: 'https://github.com/octocat/hello',
        private: false,
      },
    })
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/octocat/hello')
    expect(headerOf(0, 'Authorization')).toBeUndefined()
  })

  it('sends the stored token as a Bearer token', async () => {
    setSecret('github', 'token', ' ghp_secret ')
    route(() => json(body))
    await getRepo('octocat', 'hello')
    expect(headerOf(0, 'Authorization')).toBe('Bearer ghp_secret')
  })

  it('explains 404s', async () => {
    route(() => json({ message: 'Not Found' }, 404))
    const res = await getRepo('octocat', 'missing')
    expect(res).toEqual({
      ok: false,
      error: { kind: 'not_found', status: 404, message: 'Repository not found (private repositories need a token)' },
    })
  })

  it('explains rate limits with the reset time', async () => {
    const reset = Math.floor(new Date(2026, 10, 1, 14, 5).getTime() / 1000)
    route(() => json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) }))
    const res = await getRepo('octocat', 'hello')
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('rate_limited')
    expect(res.error.resetAt).toBe(reset * 1000)
    expect(res.error.message).toBe('GitHub rate limit reached — resets at 14:05. Add a token in Integrations for higher limits.')
    expect(formatResetTime(reset * 1000)).toBe('14:05')
  })

  it('treats a 403 with remaining quota as an access problem', async () => {
    route(() => json({}, 403, { 'x-ratelimit-remaining': '12' }))
    const res = await getRepo('octocat', 'hello')
    expect(!res.ok && res.error.kind).toBe('forbidden')
  })

  it('reports network failures', async () => {
    route(() => {
      throw new TypeError('Failed to fetch')
    })
    const res = await getRepo('octocat', 'hello')
    expect(res).toEqual({ ok: false, error: { kind: 'network', message: 'Could not reach GitHub.' } })
  })
})

describe('getTree', () => {
  it('lists files and directories recursively and flags truncation', async () => {
    route(() =>
      json({
        sha: 'abc',
        truncated: true,
        tree: [
          { path: 'src', type: 'tree', sha: 't1' },
          { path: 'src/index.ts', type: 'blob', size: 120, sha: 'b1' },
          { path: 'vendor/lib', type: 'commit', sha: 'c1' },
        ],
      }),
    )
    const res = await getTree('octocat', 'hello', 'feature/x')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/octocat/hello/git/trees/feature/x?recursive=1')
    expect(res).toEqual({
      ok: true,
      data: {
        sha: 'abc',
        truncated: true,
        files: [
          { path: 'src', type: 'dir', sha: 't1' },
          { path: 'src/index.ts', type: 'file', size: 120, sha: 'b1' },
        ],
      },
    })
  })

  it('recognizes empty repositories', async () => {
    route(() => json({ message: 'Git Repository is empty.' }, 409))
    const res = await getTree('octocat', 'empty', 'main')
    expect(!res.ok && res.error.kind).toBe('empty')
  })
})

describe('getFile', () => {
  it('reads from raw.githubusercontent.com and caches the result', async () => {
    route(() => text('export const a = 1\n'))
    const first = await getFile('octocat', 'hello', 'src/a.ts', 'main')
    expect(first).toEqual({ ok: true, data: { path: 'src/a.ts', content: 'export const a = 1\n', size: 19, source: 'raw' } })
    expect(fetchMock.mock.calls[0][0]).toBe('https://raw.githubusercontent.com/octocat/hello/main/src/a.ts')

    const second = await getFile('octocat', 'hello', 'src/a.ts', 'main')
    expect(second.ok && second.data.source).toBe('cache')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(peekFile('octocat', 'hello', 'main', 'src/a.ts')?.content).toBe('export const a = 1\n')
  })

  it('falls back to the contents API and decodes UTF-8 base64', async () => {
    const content = 'héllo ✓\n'
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(content)))
    route((url) =>
      url.startsWith('https://raw.githubusercontent.com')
        ? text('404: Not Found', 404)
        : json({ type: 'file', size: 11, encoding: 'base64', content: `${b64.slice(0, 4)}\n${b64.slice(4)}` }),
    )
    const res = await getFile('octocat', 'private', 'README.md', 'main')
    expect(res).toEqual({ ok: true, data: { path: 'README.md', content, size: 11, source: 'api' } })
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/octocat/private/contents/README.md?ref=main')
  })

  it('reports missing files', async () => {
    route(() => text('nope', 404))
    const res = await getFile('octocat', 'hello', 'nope.ts', 'main')
    expect(res).toEqual({ ok: false, error: { kind: 'not_found', status: 404, message: 'File not found: nope.ts' } })
  })

  it('returns a placeholder for binary-looking content', async () => {
    route(() => text(new Uint8Array([0x89, 0x50, 0x00, 0x01])))
    const res = await getFile('octocat', 'hello', 'data/blob.dat', 'main')
    expect(res.ok && res.data.skipped).toBe('binary')
    expect(res.ok && res.data.content).toContain('Binary file not shown')
  })

  it('skips binary paths and large files without downloading them', async () => {
    route(() => text('should not be called'))
    const img = await getFile('octocat', 'hello', 'logo.png', 'main')
    const big = await getFile('octocat', 'hello', 'dump.sql', 'main', { size: 5_000_000 })
    expect(img.ok && img.data.skipped).toBe('binary')
    expect(big.ok && big.data.skipped).toBe('too_large')
    expect(big.ok && big.data.content).toContain('above the 1 MB preview limit')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not hit the contents API when the raw host reports a rate limit', async () => {
    route(() => text('', 429, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' }))
    const res = await getFile('octocat', 'hello', 'src/a.ts', 'main')
    expect(!res.ok && res.error.kind).toBe('rate_limited')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('LruCache', () => {
  it('evicts the least recently used entries by count and weight', () => {
    const cache = new LruCache<string>(3, 10, (v) => v.length)
    cache.set('a', 'aaa')
    cache.set('b', 'bbb')
    cache.set('c', 'ccc')
    expect(cache.get('a')).toBe('aaa') // a is now most recent
    cache.set('d', 'dd') // weight 11 > 10 → evict b (LRU)
    expect(cache.has('b')).toBe(false)
    expect(cache.has('a')).toBe(true)
    cache.set('e', 'e') // count 4 > 3 → evict c
    expect(cache.has('c')).toBe(false)
    cache.deletePrefix('a')
    expect(cache.size).toBe(2)
  })
})
