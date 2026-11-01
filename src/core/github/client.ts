import { getSecret } from '@/core/secrets'
import type { RepoFile } from '@/core/types'
import { LruCache } from './cache'

/**
 * Minimal GitHub REST client (live, read-only). Runs in the browser:
 * - repository metadata and trees come from api.github.com,
 * - file contents from raw.githubusercontent.com (falling back to the contents API),
 * - a personal access token from the secrets vault (`github` / `token`) is sent as a
 *   Bearer token when present (private repositories, higher rate limits).
 * Every call resolves to a typed result; nothing throws for HTTP or network failures.
 */

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_RAW = 'https://raw.githubusercontent.com'
/** Files above this size are not downloaded (a placeholder is returned instead). */
export const MAX_FILE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 20_000

export interface RepoCoords {
  owner: string
  name: string
}

export type GithubErrorKind = 'not_found' | 'rate_limited' | 'unauthorized' | 'forbidden' | 'empty' | 'network' | 'http'

export interface GithubError {
  kind: GithubErrorKind
  /** Friendly, user-facing message. */
  message: string
  status?: number
  /** Epoch ms when the rate limit resets (rate_limited only). */
  resetAt?: number
}

export type GithubResult<T> = { ok: true; data: T } | { ok: false; error: GithubError }

export interface GithubRepoInfo {
  owner: string
  name: string
  fullName: string
  defaultBranch: string
  description?: string
  language?: string
  stars: number
  htmlUrl: string
  private: boolean
}

export interface GithubTree {
  files: RepoFile[]
  /** True when GitHub truncated the recursive listing (very large repositories). */
  truncated: boolean
  sha?: string
}

export interface GithubFile {
  path: string
  /** File text, or a human-readable placeholder when `skipped` is set. */
  content: string
  /** Size in bytes. */
  size: number
  skipped?: 'binary' | 'too_large'
  source: 'raw' | 'api' | 'cache'
}

/** Friendly error for rejected `connectGithubRepo` / `getRepoFile` promises. */
export class GithubRequestError extends Error {
  readonly kind: GithubErrorKind
  readonly status?: number
  readonly resetAt?: number

  constructor(error: GithubError) {
    super(error.message)
    this.name = 'GithubRequestError'
    this.kind = error.kind
    this.status = error.status
    this.resetAt = error.resetAt
  }
}

// ---------------------------------------------------------------- input parsing

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/

/**
 * Parse "owner/name", "owner/name.git", "github.com/owner/name", "https://github.com/owner/name/tree/main/src"
 * or "git@github.com:owner/name.git". Returns null for anything else.
 */
export function parseRepoInput(input: string): RepoCoords | null {
  let s = input.trim()
  if (!s) return null
  const ssh = /^git@github\.com:(.+)$/i.exec(s)
  if (ssh) s = ssh[1]
  else if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(s)) s = s.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
  else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^[^/]+\.[a-z]{2,}\//i.test(s)) return null
  s = s.replace(/[?#].*$/, '')
  const parts = s.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]
  const name = parts[1].replace(/\.git$/i, '')
  if (!OWNER_RE.test(owner) || !NAME_RE.test(name) || name === '.' || name === '..') return null
  return { owner, name }
}

// ---------------------------------------------------------------- binary detection

const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|avif|bmp|ico|icns|tiff?|psd|ai|sketch|fig|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|exe|dll|so|dylib|bin|o|a|class|wasm|woff2?|ttf|otf|eot|mp3|mp4|m4a|mov|avi|mkv|webm|ogg|wav|flac|sqlite|db|pyc|lockb)$/i

export function isBinaryPath(path: string): boolean {
  return BINARY_EXT.test(path)
}

/** NUL bytes in the first 8 KB are a reliable "binary" signal. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true
  return false
}

function placeholder(path: string, reason: 'binary' | 'too_large', size: number): GithubFile {
  const kb = Math.round(size / 1024)
  return {
    path,
    content:
      reason === 'binary'
        ? `[Binary file not shown: ${path}]`
        : `[File not loaded: ${path} is ${kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`}, above the 1 MB preview limit]`,
    size,
    skipped: reason,
    source: 'api',
  }
}

// ---------------------------------------------------------------- cache

const fileCache = new LruCache<GithubFile>(200, 8_000_000, (f) => f.content.length + 64)

function repoKey(owner: string, name: string): string {
  return `${owner.toLowerCase()}/${name.toLowerCase()}`
}

function fileKey(owner: string, name: string, ref: string, path: string): string {
  return `${repoKey(owner, name)}@${ref}:${path}`
}

/** Synchronous cache read (no network). */
export function peekFile(owner: string, name: string, ref: string, path: string): GithubFile | undefined {
  const hit = fileCache.get(fileKey(owner, name, ref, path))
  return hit ? { ...hit, source: 'cache' } : undefined
}

/** Forget cached file contents for one repository (e.g. after a refresh). */
export function invalidateRepoCache(owner: string, name: string): void {
  fileCache.deletePrefix(`${repoKey(owner, name)}@`)
}

export function clearGithubCache(): void {
  fileCache.clear()
}

// ---------------------------------------------------------------- transport

function authHeaders(): Record<string, string> {
  const token = getSecret('github', 'token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** "14:05" in local time. */
export function formatResetTime(resetAtMs: number): string {
  const d = new Date(resetAtMs)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

type ErrorContext = 'repo' | 'file'

function httpError(res: Response, context: ErrorContext, path?: string): GithubError {
  const status = res.status
  const remaining = res.headers.get('x-ratelimit-remaining')
  if ((status === 403 || status === 429) && remaining === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    const resetAt = Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined
    return {
      kind: 'rate_limited',
      status,
      resetAt,
      message: `GitHub rate limit reached — resets at ${resetAt ? formatResetTime(resetAt) : 'the top of the hour'}. Add a token in Integrations for higher limits.`,
    }
  }
  if (status === 429) {
    return { kind: 'rate_limited', status, message: 'GitHub is limiting requests right now — wait a minute and try again. Add a token in Integrations for higher limits.' }
  }
  if (status === 404) {
    return context === 'file'
      ? { kind: 'not_found', status, message: `File not found: ${path ?? 'unknown path'}` }
      : { kind: 'not_found', status, message: 'Repository not found (private repositories need a token)' }
  }
  if (status === 401) return { kind: 'unauthorized', status, message: 'GitHub rejected the token — update or remove it in Integrations.' }
  if (status === 403) return { kind: 'forbidden', status, message: 'GitHub denied access to this repository. Check the token’s permissions in Integrations.' }
  if (status === 409) return { kind: 'empty', status, message: 'This repository is empty.' }
  return { kind: 'http', status, message: `GitHub returned an unexpected error (${status}). Try again shortly.` }
}

const NETWORK_ERROR: GithubError = { kind: 'network', message: 'Could not reach GitHub.' }

async function request(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Response | null> {
  const controller = typeof AbortController === 'function' ? new AbortController() : undefined
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : undefined
  const onAbort = () => controller?.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    return await fetch(url, { headers, signal: controller?.signal ?? signal })
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function apiJson<T>(path: string, context: ErrorContext, signal?: AbortSignal, filePath?: string): Promise<GithubResult<T>> {
  const res = await request(`${GITHUB_API}${path}`, { Accept: 'application/vnd.github+json', ...authHeaders() }, signal)
  if (!res) return { ok: false, error: NETWORK_ERROR }
  if (!res.ok) return { ok: false, error: httpError(res, context, filePath) }
  try {
    return { ok: true, data: (await res.json()) as T }
  } catch {
    return { ok: false, error: { kind: 'http', status: res.status, message: 'GitHub sent a response that could not be read.' } }
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

// ---------------------------------------------------------------- API

interface RepoResponse {
  name: string
  full_name: string
  owner: { login: string }
  default_branch: string
  description: string | null
  language: string | null
  stargazers_count: number
  html_url: string
  private: boolean
}

export async function getRepo(owner: string, name: string, opts: { signal?: AbortSignal } = {}): Promise<GithubResult<GithubRepoInfo>> {
  const res = await apiJson<RepoResponse>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, 'repo', opts.signal)
  if (!res.ok) return res
  const r = res.data
  return {
    ok: true,
    data: {
      owner: r.owner?.login ?? owner,
      name: r.name ?? name,
      fullName: r.full_name ?? `${owner}/${name}`,
      defaultBranch: r.default_branch || 'main',
      description: r.description ?? undefined,
      language: r.language ?? undefined,
      stars: r.stargazers_count ?? 0,
      htmlUrl: r.html_url ?? `https://github.com/${owner}/${name}`,
      private: !!r.private,
    },
  }
}

interface TreeResponse {
  sha?: string
  truncated?: boolean
  tree: Array<{ path: string; type: 'blob' | 'tree' | 'commit'; size?: number; sha?: string }>
}

/** Recursive file tree of a branch (submodules are skipped). */
export async function getTree(owner: string, name: string, branch: string, opts: { signal?: AbortSignal } = {}): Promise<GithubResult<GithubTree>> {
  const res = await apiJson<TreeResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodePath(branch)}?recursive=1`,
    'repo',
    opts.signal,
  )
  if (!res.ok) return res
  const files: RepoFile[] = []
  for (const entry of res.data.tree ?? []) {
    if (entry.type === 'blob') files.push({ path: entry.path, type: 'file', size: entry.size, sha: entry.sha })
    else if (entry.type === 'tree') files.push({ path: entry.path, type: 'dir', sha: entry.sha })
  }
  return { ok: true, data: { files, truncated: !!res.data.truncated, sha: res.data.sha } }
}

interface ContentResponse {
  type: string
  size: number
  encoding?: string
  content?: string
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function toFile(path: string, bytes: Uint8Array, source: 'raw' | 'api'): GithubFile {
  if (bytes.length > MAX_FILE_BYTES) return { ...placeholder(path, 'too_large', bytes.length), source }
  if (looksBinary(bytes)) return { ...placeholder(path, 'binary', bytes.length), source }
  return { path, content: new TextDecoder('utf-8').decode(bytes), size: bytes.length, source }
}

/**
 * Text contents of a file at `ref` (branch, tag or sha). Large (> 1 MB) and binary files
 * resolve to a placeholder with `skipped` set. Results are cached in memory.
 */
export async function getFile(
  owner: string,
  name: string,
  path: string,
  ref: string,
  opts: { signal?: AbortSignal; size?: number } = {},
): Promise<GithubResult<GithubFile>> {
  const key = fileKey(owner, name, ref, path)
  const cached = fileCache.get(key)
  if (cached) return { ok: true, data: { ...cached, source: 'cache' } }

  const remember = (file: GithubFile): GithubResult<GithubFile> => {
    fileCache.set(key, file)
    return { ok: true, data: file }
  }
  if (isBinaryPath(path)) return remember(placeholder(path, 'binary', opts.size ?? 0))
  if (opts.size !== undefined && opts.size > MAX_FILE_BYTES) return remember(placeholder(path, 'too_large', opts.size))

  // 1) raw.githubusercontent.com (no API rate limit for public repositories).
  const rawUrl = `${GITHUB_RAW}/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/${encodePath(ref)}/${encodePath(path)}`
  const raw = await request(rawUrl, authHeaders(), opts.signal)
  if (raw?.ok) {
    const declared = Number(raw.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
      void raw.body?.cancel().catch(() => undefined)
      return remember({ ...placeholder(path, 'too_large', declared), source: 'raw' })
    }
    try {
      return remember(toFile(path, new Uint8Array(await raw.arrayBuffer()), 'raw'))
    } catch {
      // fall through to the contents API
    }
  }
  if (raw && (raw.status === 403 || raw.status === 429) && raw.headers.get('x-ratelimit-remaining') === '0') {
    return { ok: false, error: httpError(raw, 'file', path) }
  }

  // 2) Contents API (private repositories, CORS or raw-host failures).
  const api = await apiJson<ContentResponse | ContentResponse[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
    'file',
    opts.signal,
    path,
  )
  if (!api.ok) return api
  const data = api.data
  if (Array.isArray(data) || data.type !== 'file') {
    return { ok: false, error: { kind: 'http', message: `${path} is not a file.` } }
  }
  if (data.size > MAX_FILE_BYTES || data.encoding === 'none' || !data.content) return remember(placeholder(path, 'too_large', data.size))
  try {
    return remember(toFile(path, decodeBase64(data.content), 'api'))
  } catch {
    return { ok: false, error: { kind: 'http', message: `Could not decode ${path}.` } }
  }
}
