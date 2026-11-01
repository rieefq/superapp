import { useMemo } from 'react'
import { db, useRow, useTable } from '@/core/db'
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
  type IntegrationConnection,
  type IntegrationDef,
  type RunStep,
  type Workflow,
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

// ---------------------------------------------------------------- live checks

interface CheckResult {
  ok: boolean
  message: string
}

async function checkGitHub(token?: string): Promise<CheckResult & { remaining?: number; limit?: number }> {
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    if (res.status === 401) return { ok: false, message: 'GitHub rejected the token (401 Bad credentials).' }
    if (!res.ok) return { ok: false, message: `GitHub responded with ${res.status}${res.statusText ? ` ${res.statusText}` : ''}.` }
    const body = (await res.json()) as { resources?: { core?: { remaining?: number; limit?: number } }; rate?: { remaining?: number; limit?: number } }
    const core = body.resources?.core ?? body.rate
    const remaining = core?.remaining
    const limit = core?.limit
    const quota = remaining !== undefined && limit !== undefined ? ` · ${remaining}/${limit} requests left this hour` : ''
    return { ok: true, message: `GitHub API reachable${token ? ' with your token' : ' (public access)'}${quota}`, remaining, limit }
  } catch (err) {
    return { ok: false, message: `Couldn’t reach api.github.com${err instanceof Error && err.message ? ` (${err.message})` : ''}.` }
  }
}

async function checkAnthropic(apiKey: string): Promise<CheckResult> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 15_000 })
  try {
    const page = await client.models.list({ limit: 1 })
    const model = page.data[0]
    return { ok: true, message: `Anthropic API key works${model ? ` · latest model: ${model.display_name}` : ''}` }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Anthropic rejected the API key (401).' }
    if (err instanceof Anthropic.PermissionDeniedError) return { ok: false, message: 'The API key does not have permission to list models (403).' }
    if (err instanceof Anthropic.RateLimitError) return { ok: false, message: 'Rate limited by Anthropic (429). Try again in a minute.' }
    if (err instanceof Anthropic.APIConnectionError) return { ok: false, message: 'Couldn’t reach api.anthropic.com (network or browser blocked the request).' }
    if (err instanceof Anthropic.APIError) return { ok: false, message: `Anthropic API error${err.status ? ` ${err.status}` : ''}: ${err.message}` }
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown error contacting Anthropic.' }
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
  try {
    const res = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} })
    if (res.status === 401 || res.status === 403) return { ok: false, message: `The endpoint rejected the request (${res.status}). Check the API key.` }
    if (!res.ok) return { ok: false, message: `GET ${url} responded with ${res.status}.` }
    const body = (await res.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> }
    const ids = (body.data ?? body.models ?? []).map((m) => ('id' in m && m.id) || ('name' in m && m.name) || '').filter(Boolean)
    const found = model ? (ids.includes(model) ? ` · “${model}” is available` : ` · “${model}” was not listed`) : ''
    return { ok: true, message: `Endpoint reachable · ${ids.length} model${ids.length === 1 ? '' : 's'}${found}` }
  } catch (err) {
    return {
      ok: false,
      message: `Couldn’t reach ${url}${err instanceof Error && err.message ? ` (${err.message})` : ''}. Local servers must allow CORS from this page.`,
    }
  }
}

// ---------------------------------------------------------------- connect / disconnect

/**
 * Connect an integration. Secret fields go to the local secrets vault, the rest to config.
 * Live integrations are verified for real where the brief allows (GitHub); simulated ones
 * “connect” after a short delay and are labeled simulated.
 */
export async function connect(id: string, values: Record<string, string> = {}): Promise<IntegrationConnection> {
  const def = requireDef(id)
  const fields = def.fields ?? []
  for (const field of fields) {
    const value = values[field.key]?.trim()
    const stored = field.secret ? getSecret(id, field.key) : db.get('connections', id)?.config[field.key]
    if (!field.optional && !value && !stored) throw new Error(`${field.label} is required.`)
  }
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
    await sleep(between(900, 1400))
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

/** Disconnect: forget secrets and mark disconnected. Usage history is kept. */
export function disconnect(id: string): IntegrationConnection | undefined {
  const def = requireDef(id)
  const cur = db.get('connections', id)
  clearSecrets(id)
  if (!cur) return undefined
  const next = writeConnection(def, { status: 'disconnected', error: undefined })
  logActivity({ actor: ME, verb: 'disconnected', target: integrationRef(id), summary: `Disconnected ${def.name}` })
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

export interface ConnectionTestResult {
  ok: boolean
  message: string
  /** True when a real network request was made. */
  live: boolean
}

/** Test a connection. Live integrations make a small real request; simulated ones answer locally. */
export async function testConnection(id: string): Promise<ConnectionTestResult> {
  const def = requireDef(id)
  const cur = db.get('connections', id)
  let result: ConnectionTestResult
  if (id === 'anthropic') {
    const key = getSecret(id, 'apiKey')
    result = key ? { ...(await checkAnthropic(key)), live: true } : { ok: false, message: 'Add an Anthropic API key first.', live: false }
  } else if (id === 'github') {
    result = { ...(await checkGitHub(getSecret(id, 'token'))), live: true }
  } else if (id === 'openai-compatible') {
    const baseUrl = cur?.config.baseUrl
    result = baseUrl
      ? { ...(await checkOpenAiCompatible(baseUrl, cur?.config.model, getSecret(id, 'apiKey'))), live: true }
      : { ok: false, message: 'Add a base URL first.', live: false }
  } else if (cur?.status === 'connected' || cur?.status === 'error') {
    await sleep(between(500, 900))
    result = { ok: true, message: 'Simulated connection is responding', live: false }
  } else {
    result = { ok: false, message: `Connect ${def.name} first.`, live: false }
  }

  if (cur && cur.status !== 'disconnected' && cur.status !== 'connecting') {
    if (result.ok && cur.status === 'error') writeConnection(def, { status: 'connected', error: undefined })
    if (!result.ok && cur.status === 'connected' && result.live) {
      writeConnection(def, { status: 'error', error: result.message })
      notify({ kind: 'integration.error', title: `${def.name} connection failed`, body: result.message, ref: integrationRef(id), tone: 'danger' })
    }
  }
  return result
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

export interface IntegrationStepUse {
  run: EntityRef
  runTitle: string
  step: RunStep
  at: number
  simulated: boolean
}

export interface IntegrationUsage {
  agents: Agent[]
  workflows: Workflow[]
  /** The 20 most recent run steps that used this integration. */
  recentSteps: IntegrationStepUse[]
  usageCount: number
  lastUsedAt?: number
}

export function useIntegrationUsage(id: string): IntegrationUsage {
  const agents = useTable('agents')
  const workflows = useTable('workflows')
  const runs = useTable('runs')
  const connection = useRow('connections', id)
  return useMemo(() => {
    const steps: IntegrationStepUse[] = []
    for (const run of Object.values(runs)) {
      for (const step of run.steps) {
        if (step.integrationId !== id) continue
        steps.push({
          run: { kind: 'run', id: run.id },
          runTitle: run.title,
          step,
          at: step.startedAt ?? run.startedAt ?? run.createdAt,
          simulated: run.simulated,
        })
      }
    }
    steps.sort((a, b) => b.at - a.at)
    const lastStepAt = steps[0]?.at
    const lastUsedAt = Math.max(connection?.lastUsedAt ?? 0, lastStepAt ?? 0) || undefined
    return {
      agents: Object.values(agents).filter((a) => agentUsesIntegration(a, id)).sort((a, b) => a.name.localeCompare(b.name)),
      workflows: Object.values(workflows).filter((w) => workflowUsesIntegration(w, id)).sort((a, b) => a.name.localeCompare(b.name)),
      recentSteps: steps.slice(0, 20),
      usageCount: Math.max(connection?.usageCount ?? 0, steps.length),
      lastUsedAt,
    }
  }, [agents, workflows, runs, connection, id])
}
