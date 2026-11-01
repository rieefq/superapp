import { useMemo } from 'react'
import { create } from 'zustand'
import { db, useDB, useRow, useTable, type Tables } from '@/core/db'
import { getIntegration, INTEGRATIONS } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { clearSecrets, getSecret, setSecret } from '@/core/secrets'
import { getSettings } from '@/core/settings'
import {
  ME,
  type Agent,
  type Capability,
  type EntityRef,
  type GrantMode,
  type ID,
  type IntegrationConnection,
  type IntegrationDef,
  type Repo,
  type RunStep,
  type Workflow,
  type WorkflowNode,
} from '@/core/types'
import { logActivity } from './activity'
import { notify } from './notifications'

const integrationRef = (id: string): EntityRef => ({ kind: 'integration', id })
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const between = (min: number, max: number) => Math.round(min + Math.random() * (max - min))
const last4 = (secret: string) => secret.slice(-4)

function requireDef(id: string): IntegrationDef {
  const def = getIntegration(id)
  if (!def) throw new Error(`Unknown integration “${id}”.`)
  return def
}

/** Default policy per capability: low risk is allowed, medium/high risk asks first. */
export function defaultScopes(def: IntegrationDef): IntegrationConnection['scopes'] {
  return def.capabilities.map((capability) => ({ capability, mode: CAPABILITIES[capability].risk === 'low' ? 'allow' : 'ask' }))
}

function mergeScopes(def: IntegrationDef, existing: IntegrationConnection['scopes'] | undefined): IntegrationConnection['scopes'] {
  return defaultScopes(def).map((s) => existing?.find((e) => e.capability === s.capability) ?? s)
}

/** Insert or patch a connection row (new rows start disconnected with default scopes). */
function writeConnection(def: IntegrationDef, patch: Partial<IntegrationConnection>): IntegrationConnection {
  const cur = db.get('connections', def.id)
  const base: IntegrationConnection = cur ?? {
    id: def.id,
    status: 'disconnected',
    mode: def.support === 'live' ? 'live' : 'simulated',
    scopes: defaultScopes(def),
    config: {},
    usageCount: 0,
  }
  const next: IntegrationConnection = { ...base, ...patch }
  db.upsert('connections', next)
  return next
}

/** A plausible, clearly fictional account for simulated connections (.example domains only). */
function simulatedAccount(def: IntegrationDef): string {
  const name = getSettings().profile.name.trim().toLowerCase()
  const slug = name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace'
  const local = name.replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'me'
  switch (def.category) {
    case 'communication':
      return def.id === 'slack' ? `${slug}.slack.example` : `${local}@mail.example`
    case 'data':
      return `analytics@${slug}-${def.id}.example`
    default:
      return `${slug}.${def.id}.example`
  }
}

// ---------------------------------------------------------------- validation

/** Every Anthropic API key starts with this prefix. */
export const ANTHROPIC_KEY_PREFIX = 'sk-ant-'

export interface FieldIssue {
  /** The catalog field key (`apiKey`, `baseUrl`…). */
  key: string
  message: string
}

const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Problems with the values typed into a connect form, in field order. An empty value is fine when
 * the field is optional or a value is already stored (secrets in the vault, the rest in config).
 * `connect` runs the same checks, so nothing malformed is ever stored or sent.
 */
export function validateConnectionValues(id: string, values: Record<string, string>): FieldIssue[] {
  const def = requireDef(id)
  const issues: FieldIssue[] = []
  for (const field of def.fields ?? []) {
    const value = values[field.key]?.trim() ?? ''
    const stored = field.secret ? getSecret(id, field.key) : db.get('connections', id)?.config[field.key]
    if (!value) {
      if (!field.optional && !stored) issues.push({ key: field.key, message: `${field.label} is required.` })
      continue
    }
    if (field.secret && /\s/.test(value)) {
      issues.push({ key: field.key, message: `${field.label} can’t contain spaces or line breaks. Copy it again.` })
    } else if (id === 'anthropic' && field.key === 'apiKey' && !value.startsWith(ANTHROPIC_KEY_PREFIX)) {
      issues.push({ key: field.key, message: `Anthropic API keys start with “${ANTHROPIC_KEY_PREFIX}”. Copy the whole key from console.anthropic.com.` })
    } else if (field.type === 'url' && !isHttpUrl(value)) {
      issues.push({ key: field.key, message: `Enter a valid ${lowerFirst(field.label)}, e.g. ${field.placeholder ?? 'https://example.com'}` })
    }
  }
  return issues
}

// ---------------------------------------------------------------- live checks

/** What went wrong, so the UI can offer the exact fix. */
export type ConnectionProblem =
  | 'auth'
  | 'permission'
  | 'rate_limit'
  | 'network'
  | 'cors'
  | 'not_found'
  | 'http'
  | 'config'
  | 'expired'
  | 'not_connected'

interface CheckResult {
  ok: boolean
  message: string
  /** The provider's own words, verbatim (e.g. "invalid x-api-key"). */
  providerMessage?: string
  /** The exact next step. */
  fix?: string
  problem?: ConnectionProblem
  /** What was requested, e.g. "GET api.github.com/rate_limit". */
  request?: string
}

const appOrigin = () => (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'this page’s address')

/** The error message from a provider's JSON error body ({ error: { message } } or { message }). */
function messageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as { error?: unknown; message?: unknown }
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim()
  if (typeof b.error === 'string' && b.error.trim()) return b.error.trim()
  if (b.error && typeof b.error === 'object') {
    const m = (b.error as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  return undefined
}

async function readBodyMessage(res: Response): Promise<string | undefined> {
  try {
    return messageFromBody(await res.json())
  } catch {
    return undefined
  }
}

/** The provider's message inside an SDK error (`401 {"type":"error","error":{"message":"invalid x-api-key"}}`). */
function sdkErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined
  const fromBody = messageFromBody((err as { error?: unknown }).error)
  if (fromBody) return fromBody
  const json = /\{[\s\S]*\}$/.exec(err.message)?.[0]
  if (json) {
    try {
      const parsed = messageFromBody(JSON.parse(json))
      if (parsed) return parsed
    } catch {
      /* not JSON */
    }
  }
  const text = err.message.trim()
  return text && !/^\d{3}$/.test(text) ? text : undefined
}

async function checkGitHub(token?: string): Promise<CheckResult & { remaining?: number; limit?: number }> {
  const request = 'GET api.github.com/rate_limit'
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (res.status === 401) {
      return {
        ok: false,
        request,
        problem: 'auth',
        message: 'GitHub rejected the token (401 Bad credentials).',
        providerMessage: await readBodyMessage(res),
        fix: 'Create a new token at github.com/settings/tokens (read-only access is enough), or forget the token to use public access.',
      }
    }
    if (!res.ok) {
      const limited = res.status === 429 || (res.status === 403 && res.headers?.get?.('x-ratelimit-remaining') === '0')
      return {
        ok: false,
        request,
        problem: limited ? 'rate_limit' : res.status === 403 ? 'permission' : 'http',
        message: `GitHub responded with ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.`,
        providerMessage: await readBodyMessage(res),
        fix: limited
          ? 'You reached GitHub’s hourly limit. Add a token to raise it to 5,000 requests an hour, or wait for the limit to reset.'
          : res.status === 403
            ? 'Check the token’s permissions at github.com/settings/tokens, or forget the token to use public access.'
            : 'GitHub may be having trouble. Test again in a minute; githubstatus.com shows incidents.',
      }
    }
    const body = (await res.json()) as { resources?: { core?: { remaining?: number; limit?: number } }; rate?: { remaining?: number; limit?: number } }
    const core = body.resources?.core ?? body.rate
    const remaining = core?.remaining
    const limit = core?.limit
    const quota = remaining !== undefined && limit !== undefined ? ` · ${remaining}/${limit} requests left this hour` : ''
    return { ok: true, request, message: `GitHub API reachable${token ? ' with your token' : ' (public access)'}${quota}`, remaining, limit }
  } catch (err) {
    return {
      ok: false,
      request,
      problem: 'network',
      message: `Couldn’t reach api.github.com${err instanceof Error && err.message ? ` (${err.message})` : ''}.`,
      fix: 'Check your connection. A browser extension or a network policy may be blocking api.github.com.',
    }
  }
}

async function checkAnthropic(apiKey: string): Promise<CheckResult> {
  const request = 'GET api.anthropic.com/v1/models'
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15_000 })
  try {
    const page = await client.models.list({ limit: 1 })
    const model = page.data[0]
    return { ok: true, request, message: `Anthropic API key works${model ? ` · latest model: ${model.display_name}` : ''}` }
  } catch (err) {
    const providerMessage = sdkErrorMessage(err)
    if (err instanceof Anthropic.AuthenticationError) {
      return {
        ok: false,
        request,
        problem: 'auth',
        providerMessage,
        message: 'Anthropic rejected the API key (401).',
        fix: 'Copy the whole key again from console.anthropic.com → API keys (or create a new one), then save it here.',
      }
    }
    if (err instanceof Anthropic.PermissionDeniedError) {
      return {
        ok: false,
        request,
        problem: 'permission',
        providerMessage,
        message: 'The API key does not have permission to list models (403).',
        fix: 'Use a key from a workspace with API access, or ask your organization’s admin to enable it.',
      }
    }
    if (err instanceof Anthropic.RateLimitError) {
      return {
        ok: false,
        request,
        problem: 'rate_limit',
        providerMessage,
        message: 'Rate limited by Anthropic (429). Try again in a minute.',
        fix: 'Wait a minute, then test again. If it keeps happening, check the key’s rate limits in the Anthropic console.',
      }
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return {
        ok: false,
        request,
        problem: 'network',
        message: 'Couldn’t reach api.anthropic.com (network or browser blocked the request).',
        fix: 'Check your connection. A browser extension or a network policy may be blocking api.anthropic.com.',
      }
    }
    if (err instanceof Anthropic.APIError) {
      return {
        ok: false,
        request,
        problem: 'http',
        providerMessage,
        message: `Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}`,
        fix: 'Anthropic may be having trouble. Test again in a minute; status.anthropic.com shows incidents.',
      }
    }
    return { ok: false, request, problem: 'http', message: err instanceof Error ? err.message : 'Unknown error contacting Anthropic.' }
  }
}

function normalizeBaseUrl(raw: string): URL {
  try {
    const url = new URL(raw.trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol')
    return url
  } catch {
    throw new Error('Enter a valid base URL, e.g. http://localhost:11434/v1')
  }
}

async function checkOpenAiCompatible(baseUrl: string, model: string | undefined, apiKey: string | undefined): Promise<CheckResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const request = `GET ${url}`
  try {
    const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        request,
        problem: 'auth',
        providerMessage: await readBodyMessage(res),
        message: `The endpoint rejected the request (${res.status}). Check the API key.`,
        fix: apiKey ? 'Check the API key, or remove it if your server doesn’t need one.' : 'This server needs an API key. Add it, then save again.',
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        request,
        problem: res.status === 404 ? 'not_found' : 'http',
        providerMessage: await readBodyMessage(res),
        message: `GET ${url} responded with ${res.status}.`,
        fix:
          res.status === 404
            ? 'Check the base URL: most servers expect it to end in /v1, for example http://localhost:11434/v1.'
            : 'The server answered with an error. Check its logs, then test again.',
      }
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> }
    const ids = (body.data ?? body.models ?? []).map((m) => ('id' in m && m.id) || ('name' in m && m.name) || '').filter(Boolean)
    const found = model ? (ids.includes(model) ? ` · “${model}” is available` : ` · “${model}” was not listed`) : ''
    return { ok: true, request, message: `Endpoint reachable · ${ids.length} model${ids.length === 1 ? '' : 's'}${found}` }
  } catch (err) {
    const origin = appOrigin()
    return {
      ok: false,
      request,
      problem: 'cors',
      message: `Couldn’t reach ${url}${err instanceof Error && err.message ? ` (${err.message})` : ''}. Local servers must allow CORS from this page.`,
      fix: `Make sure the server is running. If it is, allow this origin in your server settings: ${origin} (for Ollama, start it with OLLAMA_ORIGINS=${origin}).`,
    }
  }
}

// ---------------------------------------------------------------- connection tests (last result per integration)

export interface ConnectionTestResult {
  ok: boolean
  message: string
  /** True when a real network request was made. */
  live: boolean
}

/** A connection test with everything the UI needs to explain it: the provider's words and the fix. */
export interface ConnectionDiagnosis extends ConnectionTestResult {
  providerMessage?: string
  fix?: string
  problem?: ConnectionProblem
  /** What was requested ("GET api.github.com/rate_limit"); simulated handshakes say so. */
  request?: string
  /** When the test finished (epoch ms). */
  at: number
  durationMs: number
}

interface TestStore {
  results: Record<string, ConnectionDiagnosis>
  running: Record<string, boolean>
}

/** Last test per integration, for this browser session (history lives in the activity log). */
const useTestStore = create<TestStore>(() => ({ results: {}, running: {} }))

function setRunning(id: string, running: boolean) {
  useTestStore.setState((s) => ({ running: { ...s.running, [id]: running } }))
}

function forgetTest(id: string) {
  if (!useTestStore.getState().results[id]) return
  useTestStore.setState((s) => {
    const results = { ...s.results }
    delete results[id]
    return { results }
  })
}

/** The last test of a connection and whether one is running now (re-renders on change). */
export function useConnectionTest(id: string | null | undefined): { result: ConnectionDiagnosis | undefined; running: boolean } {
  const result = useTestStore((s) => (id ? s.results[id] : undefined))
  const running = useTestStore((s) => (id ? !!s.running[id] : false))
  return { result, running }
}

async function runCheck(def: IntegrationDef, cur: IntegrationConnection | undefined): Promise<Omit<ConnectionDiagnosis, 'at' | 'durationMs'>> {
  const id = def.id
  const live = (check: CheckResult) => ({ ...check, live: true })
  if (id === 'anthropic') {
    const key = getSecret(id, 'apiKey')
    return key
      ? live(await checkAnthropic(key))
      : { ok: false, live: false, problem: 'config', message: 'Add an Anthropic API key first.', fix: 'Paste a key that starts with “sk-ant-”, then save it.' }
  }
  if (id === 'github') {
    const check = await checkGitHub(getSecret(id, 'token'))
    return live({ ok: check.ok, message: check.message, providerMessage: check.providerMessage, fix: check.fix, problem: check.problem, request: check.request })
  }
  if (id === 'openai-compatible') {
    const baseUrl = cur?.config.baseUrl
    return baseUrl
      ? live(await checkOpenAiCompatible(baseUrl, cur?.config.model, getSecret(id, 'apiKey')))
      : { ok: false, live: false, problem: 'config', message: 'Add a base URL first.', fix: 'Enter the server’s base URL and model name, then save.' }
  }
  if (cur?.status === 'connected') {
    await sleep(between(300, 600))
    return { ok: true, live: false, message: 'Simulated connection is responding', request: 'Simulated handshake — nothing left your browser' }
  }
  if (cur?.status === 'error') {
    await sleep(between(300, 600))
    return {
      ok: false,
      live: false,
      problem: 'expired',
      message: cur.error ?? `The simulated ${def.name} connection reported an error.`,
      request: 'Simulated handshake — nothing left your browser',
      fix: `Reconnect ${def.name} to get a new simulated token.`,
    }
  }
  return { ok: false, live: false, problem: 'not_connected', message: `Connect ${def.name} first.` }
}

/**
 * Test a connection and explain the result. Live integrations make one small real request
 * (Anthropic: list models · OpenAI-compatible: GET /models · GitHub: the rate-limit endpoint);
 * simulated ones answer with a local, labeled handshake. A live failure flags the connection
 * (Update + error state); a later success clears it. The result is kept for this session and
 * the test is recorded in the integration's activity.
 */
export async function diagnoseConnection(id: string): Promise<ConnectionDiagnosis> {
  const def = requireDef(id)
  const cur = db.get('connections', id)
  const started = Date.now()
  setRunning(id, true)
  let result: ConnectionDiagnosis
  try {
    const check = await runCheck(def, cur)
    result = { ...check, at: Date.now(), durationMs: Date.now() - started }
  } finally {
    setRunning(id, false)
  }

  const now = db.get('connections', id)
  if (now && now.status !== 'disconnected' && now.status !== 'connecting') {
    if (result.ok && now.status === 'error') writeConnection(def, { status: 'connected', error: undefined })
    if (!result.ok && now.status === 'connected' && result.live) {
      writeConnection(def, { status: 'error', error: result.message })
      notify({ kind: 'integration.error', title: `${def.name} connection failed`, body: result.message, ref: integrationRef(id), tone: 'danger' })
    }
  }
  useTestStore.setState((s) => ({ results: { ...s.results, [id]: result } }))
  if (result.problem !== 'not_connected' && result.problem !== 'config') {
    logActivity({
      actor: ME,
      verb: 'tested',
      target: integrationRef(id),
      summary: `Tested ${def.name}${result.live ? '' : ' (simulated)'}: ${result.ok ? 'working' : 'failed'} · ${result.message}`,
      meta: { ok: result.ok, live: result.live, problem: result.problem },
    })
  }
  return result
}

/** Test a connection. Live integrations make a small real request; simulated ones answer locally. */
export async function testConnection(id: string): Promise<ConnectionTestResult> {
  const { ok, message, live } = await diagnoseConnection(id)
  return { ok, message, live }
}

// ---------------------------------------------------------------- connect / disconnect

/**
 * Connect an integration. Values are validated first (`validateConnectionValues`). Secret fields go
 * to the local secrets vault, the rest to config. Model providers connect immediately (their models
 * become available in every model picker); GitHub is verified with a real request; simulated
 * services connect after a short local handshake and are labeled simulated.
 */
export async function connect(id: string, values: Record<string, string> = {}): Promise<IntegrationConnection> {
  const def = requireDef(id)
  const fields = def.fields ?? []
  const issues = validateConnectionValues(id, values)
  if (issues.length) throw new Error(issues[0].message)
  const prev = db.get('connections', id)
  const config: Record<string, string> = { ...(prev?.config ?? {}) }
  for (const [key, raw] of Object.entries(values)) {
    const value = raw.trim()
    const field = fields.find((f) => f.key === key)
    if (field?.secret) {
      if (value) setSecret(id, key, value)
    } else if (value) config[key] = value
    else delete config[key]
  }
  const scopes = mergeScopes(def, prev?.scopes)
  const now = Date.now()
  forgetTest(id)

  let conn: IntegrationConnection
  if (id === 'anthropic') {
    const key = getSecret(id, 'apiKey') ?? ''
    conn = writeConnection(def, { status: 'connected', mode: 'live', account: `API key …${last4(key)}`, config, scopes, connectedAt: now, error: undefined })
  } else if (id === 'openai-compatible') {
    const url = normalizeBaseUrl(config.baseUrl ?? '')
    conn = writeConnection(def, { status: 'connected', mode: 'live', account: url.host, config, scopes, connectedAt: now, error: undefined })
  } else if (id === 'github') {
    writeConnection(def, { status: 'connecting', mode: 'live', config, scopes, error: undefined })
    const token = getSecret(id, 'token')
    const check = await checkGitHub(token)
    conn = check.ok
      ? writeConnection(def, {
          status: 'connected',
          account: token ? `Personal access token …${last4(token)}` : 'Public access',
          connectedAt: now,
          error: undefined,
        })
      : writeConnection(def, { status: 'error', error: check.message })
  } else {
    writeConnection(def, { status: 'connecting', mode: 'simulated', config, scopes, error: undefined })
    // A short local handshake: nothing leaves the browser.
    await sleep(between(350, 650))
    // Respect a disconnect that happened while we were "connecting".
    if (db.get('connections', id)?.status !== 'connecting') return db.get('connections', id) ?? writeConnection(def, {})
    conn = writeConnection(def, { status: 'connected', account: simulatedAccount(def), connectedAt: Date.now(), error: undefined })
  }

  if (conn.status === 'error') {
    notify({ kind: 'integration.error', title: `${def.name} couldn’t connect`, body: conn.error, ref: integrationRef(id), tone: 'danger' })
    logActivity({ actor: ME, verb: 'failed', target: integrationRef(id), summary: `Connecting ${def.name} failed`, meta: { error: conn.error } })
  } else {
    logActivity({
      actor: ME,
      verb: 'connected',
      target: integrationRef(id),
      summary: `Connected ${def.name}${conn.mode === 'simulated' ? ' (simulated)' : ''}${conn.account ? ` as ${conn.account}` : ''}`,
      meta: { mode: conn.mode },
    })
  }
  return conn
}

/** Disconnect: forget secrets and mark disconnected. Usage history and permissions are kept. */
export function disconnect(id: string): IntegrationConnection | undefined {
  const def = requireDef(id)
  const cur = db.get('connections', id)
  clearSecrets(id)
  forgetTest(id)
  if (!cur) return undefined
  const next = writeConnection(def, { status: 'disconnected', error: undefined })
  logActivity({ actor: ME, verb: 'disconnected', target: integrationRef(id), summary: `Disconnected ${def.name}` })
  return next
}

/** Labels of the secrets stored in this browser for an integration ("API key", "Personal access token"). */
export function storedSecretLabels(id: string): string[] {
  const def = getIntegration(id)
  return (def?.fields ?? []).filter((f) => f.secret && getSecret(id, f.key)).map((f) => f.label)
}

/**
 * Forget the secrets stored in this browser. When a secret is required (the Anthropic key) the
 * connection ends; optional secrets fall back (GitHub reads continue with public access).
 */
export function forgetSecrets(id: string): IntegrationConnection | undefined {
  const def = requireDef(id)
  const labels = storedSecretLabels(id)
  if (!labels.length) return db.get('connections', id)
  const required = (def.fields ?? []).some((f) => f.secret && !f.optional)
  clearSecrets(id)
  forgetTest(id)
  const cur = db.get('connections', id)
  let next = cur
  if (cur && required) next = writeConnection(def, { status: 'disconnected', error: undefined })
  else if (cur && id === 'github' && (cur.status === 'connected' || cur.status === 'error')) {
    next = writeConnection(def, { status: 'connected', error: undefined, account: 'Public access' })
  }
  logActivity({
    actor: ME,
    verb: 'updated',
    target: integrationRef(id),
    summary: `Forgot the ${def.name} ${labels.map(lowerFirst).join(' and ')} stored in this browser`,
  })
  return next
}

const MODE_LABEL: Record<GrantMode, string> = { allow: 'Allow', ask: 'Ask first', deny: 'Deny' }

/** Set the policy for one capability of an integration. */
export function updateScope(id: string, capability: Capability, mode: GrantMode): IntegrationConnection {
  const def = requireDef(id)
  if (!def.capabilities.includes(capability)) throw new Error(`${def.name} does not provide “${CAPABILITIES[capability].label}”.`)
  const cur = db.get('connections', id)
  const scopes = mergeScopes(def, cur?.scopes).map((s) => (s.capability === capability ? { capability, mode } : s))
  const next = writeConnection(def, { scopes })
  logActivity({
    actor: ME,
    verb: 'updated',
    target: integrationRef(id),
    summary: `${def.name}: set “${CAPABILITIES[capability].label}” to ${MODE_LABEL[mode]}`,
    meta: { capability, mode },
  })
  return next
}

/** The effective policy for each capability (defaults fill in capabilities the row doesn't list yet). */
export function scopesFor(id: string, connection: IntegrationConnection | undefined): IntegrationConnection['scopes'] {
  const def = getIntegration(id)
  return def ? mergeScopes(def, connection?.scopes) : []
}

/** Count one use of an integration (called when a run step uses it). */
export function recordUsage(id: string): void {
  db.update('connections', id, (c) => ({ ...c, usageCount: c.usageCount + 1, lastUsedAt: Date.now() }))
}

// ---------------------------------------------------------------- hooks

export type IntegrationStatus = 'connected' | 'error' | 'disconnected' | 'connecting' | 'available'

export interface IntegrationListItem {
  def: IntegrationDef
  connection: IntegrationConnection | undefined
  status: IntegrationStatus
}

export function useConnection(id: string | null | undefined): IntegrationConnection | undefined {
  return useRow('connections', id)
}

/** The catalog joined with connection rows (status 'available' = never connected). */
export function useConnectionsList(): IntegrationListItem[] {
  const connections = useTable('connections')
  return useMemo(
    () =>
      INTEGRATIONS.map((def) => {
        const connection = connections[def.id]
        return { def, connection, status: connection?.status ?? 'available' }
      }),
    [connections],
  )
}

/** Integration ids that provide a capability. */
export function providersOf(capability: Capability): string[] {
  return INTEGRATIONS.filter((i) => i.capabilities.includes(capability)).map((i) => i.id)
}

/** True when an agent's grants use this integration (explicitly, or via a capability only it provides). */
export function agentUsesIntegration(agent: Agent, integrationId: string): boolean {
  return agent.capabilities.some((g) => {
    if (g.mode === 'deny') return false
    if (g.integrationId) return g.integrationId === integrationId
    const providers = providersOf(g.capability)
    return providers.length === 1 && providers[0] === integrationId
  })
}

export function workflowUsesIntegration(workflow: Workflow, integrationId: string): boolean {
  return workflow.trigger.integrationId === integrationId || workflow.nodes.some((n) => n.integrationId === integrationId)
}

/** The capabilities an agent uses through this integration (granted, not denied). */
export function agentCapabilitiesVia(agent: Agent, integrationId: string): Capability[] {
  const out: Capability[] = []
  for (const g of agent.capabilities) {
    if (g.mode === 'deny' || out.includes(g.capability)) continue
    if (g.integrationId ? g.integrationId === integrationId : providersOf(g.capability).length === 1 && providersOf(g.capability)[0] === integrationId) {
      out.push(g.capability)
    }
  }
  return out
}

export interface IntegrationStepUse {
  run: EntityRef
  runTitle: string
  step: RunStep
  at: number
  simulated: boolean
  /** The run's project (for scope filtering). */
  projectId?: ID | null
}

export interface IntegrationUsage {
  agents: Agent[]
  workflows: Workflow[]
  /** The 20 most recent run steps that used this integration. */
  recentSteps: IntegrationStepUse[]
  usageCount: number
  lastUsedAt?: number
}

/**
 * A primitive key of the steps that used an integration (run, step, status), so usage hooks
 * re-render when those steps change — not on every token of every running run.
 */
function stepKeyIn(s: Tables, id: string): string {
  const parts: string[] = []
  for (const run of Object.values(s.runs)) {
    for (const step of run.steps) {
      if (step.integrationId === id) parts.push(`${run.id}|${step.id}|${step.status}|${step.startedAt ?? ''}`)
    }
  }
  return parts.join(',')
}

/** Steps that used an integration, newest first. */
export function integrationStepsIn(s: Tables, id: string): IntegrationStepUse[] {
  const steps: IntegrationStepUse[] = []
  for (const run of Object.values(s.runs)) {
    for (const step of run.steps) {
      if (step.integrationId !== id) continue
      steps.push({
        run: { kind: 'run', id: run.id },
        runTitle: run.title,
        step,
        at: step.startedAt ?? run.startedAt ?? run.createdAt,
        simulated: run.simulated,
        projectId: run.projectId,
      })
    }
  }
  return steps.sort((a, b) => b.at - a.at)
}

export function useIntegrationUsage(id: string): IntegrationUsage {
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const stepKey = useDB((s) => stepKeyIn(s, id))
  const connection = useRow('connections', id)
  return useMemo(() => {
    const steps = integrationStepsIn(useDB.getState(), id)
    const lastStepAt = steps[0]?.at
    const lastUsedAt = Math.max(connection?.lastUsedAt ?? 0, lastStepAt ?? 0) || undefined
    return {
      agents: Object.values(agents).filter((a) => agentUsesIntegration(a, id)).sort((a, b) => a.name.localeCompare(b.name)),
      workflows: Object.values(workflows).filter((w) => workflowUsesIntegration(w, id)).sort((a, b) => a.name.localeCompare(b.name)),
      recentSteps: steps.slice(0, 20),
      usageCount: Math.max(connection?.usageCount ?? 0, steps.length),
      lastUsedAt,
    }
    // stepKey stands in for the runs table (it changes whenever a relevant step does).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agents, workflows, stepKey, connection, id])
}

// ---------------------------------------------------------------- disconnect impact (for the ReadBack)

export interface DisconnectImpact {
  /** Agents that use this integration, with the capabilities that would be blocked. */
  agents: { agent: Agent; capabilities: Capability[] }[]
  /** Workflows with a trigger or nodes on this integration. */
  workflows: { workflow: Workflow; nodes: WorkflowNode[]; trigger: boolean }[]
  /** Repositories read through this integration (GitHub). */
  repos: Repo[]
  /** Labels of secrets that would be removed from this browser. */
  secrets: string[]
  usageCount: number
}

/** What disconnecting an integration affects, from a database snapshot (pure apart from the secrets vault). */
export function disconnectImpactIn(s: Tables, id: string): DisconnectImpact {
  const agents = Object.values(s.agents)
    .filter((a) => a.status !== 'archived' && agentUsesIntegration(a, id))
    .map((agent) => ({ agent, capabilities: agentCapabilitiesVia(agent, id) }))
    .sort((a, b) => a.agent.name.localeCompare(b.agent.name))
  const workflows = Object.values(s.workflows)
    .filter((w) => workflowUsesIntegration(w, id))
    .map((workflow) => ({
      workflow,
      nodes: workflow.nodes.filter((n) => n.integrationId === id && n.type !== 'trigger'),
      trigger: workflow.trigger.integrationId === id,
    }))
    .sort((a, b) => Number(b.workflow.enabled) - Number(a.workflow.enabled) || a.workflow.name.localeCompare(b.workflow.name))
  const repos = id === 'github' ? Object.values(s.repos).filter((r) => r.provider === 'github') : []
  return { agents, workflows, repos, secrets: storedSecretLabels(id), usageCount: s.connections[id]?.usageCount ?? 0 }
}
