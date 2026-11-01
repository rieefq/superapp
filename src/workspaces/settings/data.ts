import { useShellStore } from '@/app/shell/store'
import { useContextStore } from '@/core/context'
import { db, emptyTables, persistEvents, SCHEMA_VERSION, storageUsage, TABLE_NAMES, writeAll, type TableName, type Tables } from '@/core/db'
import { CAPABILITIES } from '@/core/permissions'
import { runEngine } from '@/core/runs'
import { useSecretsStore } from '@/core/secrets'
import { resolveIn } from '@/core/services'
import { DEFAULT_SETTINGS, useSettingsStore } from '@/core/settings'
import { HUES, type Capability, type EntityKind, type EntityRef, type Settings } from '@/core/types'

/*
 * Settings › Data: reading an export back in (validation, then a full replace), erasing everything,
 * and measuring what this browser stores. Export itself is the shell's `runExport` (a real download
 * of `buildExport()`; API keys are never included).
 */

// ------------------------------------------------------------------------------------------------ names

export const TABLE_LABEL: Record<TableName, string> = {
  projects: 'Projects',
  tasks: 'Tasks',
  threads: 'Conversations',
  messages: 'Messages',
  runs: 'Runs',
  approvals: 'Approvals',
  agents: 'Agents',
  workflows: 'Workflows',
  knowledge: 'Knowledge items',
  collections: 'Collections',
  investigations: 'Investigations',
  sources: 'Sources',
  repos: 'Repositories',
  sessions: 'Coding sessions',
  assets: 'Studio assets',
  boards: 'Boards',
  connections: 'Connections',
  notifications: 'Notifications',
  activity: 'Activity events',
  links: 'Links',
}

// ------------------------------------------------------------------------------------------------ import: validation

export interface ImportPayload {
  tables: Tables
  /** Sanitized settings from the file (undefined when it carried none). */
  settings?: Settings
  context?: { scopeProjectId: string | null; held: EntityRef[] }
}

export interface ImportSummary {
  fileName: string
  bytes: number
  /** ISO time from the file, when present. */
  exportedAt?: string
  counts: Record<TableName, number>
  total: number
  /** Tables the file did not contain (imported as empty). */
  missingTables: TableName[]
  /** Unknown keys under `data` (ignored). */
  ignoredTables: string[]
}

export type ImportCheck =
  | { ok: true; payload: ImportPayload; summary: ImportSummary }
  | { ok: false; error: string; detail?: string }

/** Larger files cannot fit in this browser's local storage anyway. */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Structural checks for the fields the interface reads without guarding (a damaged file must not crash a view). */
const ROW_SHAPE: Partial<Record<TableName, (row: Record<string, unknown>) => boolean>> = {
  projects: (r) => typeof r.name === 'string',
  tasks: (r) => typeof r.title === 'string' && typeof r.status === 'string',
  threads: (r) => typeof r.title === 'string' && Array.isArray(r.messageIds),
  messages: (r) => typeof r.threadId === 'string' && typeof r.role === 'string',
  runs: (r) => typeof r.status === 'string' && Array.isArray(r.steps) && isPlainObject(r.usage),
  approvals: (r) => typeof r.runId === 'string' && typeof r.status === 'string',
  agents: (r) => typeof r.name === 'string' && Array.isArray(r.capabilities),
  workflows: (r) => typeof r.name === 'string' && Array.isArray(r.nodes),
  knowledge: (r) => typeof r.title === 'string',
  links: (r) => isPlainObject(r.from) && isPlainObject(r.to),
  activity: (r) => isPlainObject(r.target) && typeof r.summary === 'string',
}

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/**
 * Check that a file is an Atrium export this build can read. Rejects anything that is not JSON,
 * not an Atrium export, from another data format, or damaged (rows without matching ids or with
 * missing core fields). Nothing is written.
 */
export function checkImport(text: string, fileName: string, bytes = text.length): ImportCheck {
  if (bytes > MAX_IMPORT_BYTES) {
    return { ok: false, error: `This file is too large to import (${formatMb(bytes)}). This browser keeps at most a few megabytes for Atrium.` }
  }
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch (err) {
    return { ok: false, error: 'This file isn’t valid JSON, so it can’t be an Atrium export.', detail: err instanceof Error ? err.message : String(err) }
  }
  if (!isPlainObject(root) || root.app !== 'atrium') {
    return { ok: false, error: 'This isn’t an Atrium export. Choose a file made with Export JSON in Settings › Data.' }
  }
  const version = root.schemaVersion
  if (typeof version !== 'number') return { ok: false, error: 'This export doesn’t say which data format it uses, so it can’t be read safely.' }
  if (version > SCHEMA_VERSION) {
    return { ok: false, error: `This export comes from a newer version of Atrium (data format ${version}). This build reads format ${SCHEMA_VERSION}.` }
  }
  if (version < SCHEMA_VERSION) {
    return { ok: false, error: `This export uses an older data format (${version}) that this build can’t read. It reads format ${SCHEMA_VERSION}.` }
  }
  if (!isPlainObject(root.data)) return { ok: false, error: 'This export has no data section.' }

  const data = root.data
  const tables = emptyTables()
  const counts = {} as Record<TableName, number>
  const missingTables: TableName[] = []
  const damaged: string[] = []
  let total = 0
  for (const t of TABLE_NAMES) {
    const raw = data[t]
    counts[t] = 0
    if (raw === undefined) {
      missingTables.push(t)
      continue
    }
    if (!isPlainObject(raw)) {
      damaged.push(`${TABLE_LABEL[t]} isn’t a table`)
      continue
    }
    let bad = 0
    const shape = ROW_SHAPE[t]
    for (const [key, row] of Object.entries(raw)) {
      if (!isPlainObject(row) || row.id !== key || (shape && !shape(row))) bad++
    }
    if (bad) damaged.push(`${bad} ${bad === 1 ? 'row' : 'rows'} in ${TABLE_LABEL[t]}`)
    ;(tables as unknown as Record<string, unknown>)[t] = raw
    counts[t] = Object.keys(raw).length
    total += counts[t]
  }
  if (damaged.length) {
    return { ok: false, error: 'This export looks damaged, so nothing was imported.', detail: `Unreadable: ${damaged.join('; ')}.` }
  }
  const ignoredTables = Object.keys(data).filter((k) => !(TABLE_NAMES as string[]).includes(k))

  const settings = isPlainObject(root.settings) ? sanitizeSettings(root.settings) : undefined
  const ctx = isPlainObject(root.context) ? root.context : undefined
  const held = Array.isArray(ctx?.held)
    ? ctx.held.filter((r): r is EntityRef => isPlainObject(r) && typeof r.kind === 'string' && typeof r.id === 'string').map((r) => ({ kind: r.kind as EntityKind, id: r.id }))
    : []
  const context = ctx ? { scopeProjectId: typeof ctx.scopeProjectId === 'string' ? ctx.scopeProjectId : null, held } : undefined

  return {
    ok: true,
    payload: { tables, settings, context },
    summary: {
      fileName,
      bytes,
      exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : undefined,
      counts,
      total,
      missingTables,
      ignoredTables,
    },
  }
}

// ------------------------------------------------------------------------------------------------ import: settings

const ENUMS: Record<string, readonly string[]> = {
  'profile.hue': HUES,
  'appearance.theme': ['dark', 'light', 'system'],
  'appearance.density': ['comfortable', 'compact'],
  'appearance.reduceMotion': ['system', 'reduce', 'full'],
  'ai.effort': ['low', 'medium', 'high'],
  'safety.defaultAutonomy': ['supervised', 'balanced', 'autonomous'],
}

function acceptValue(path: string, value: unknown, fallback: unknown): unknown {
  if (path === 'safety.alwaysAsk') {
    return Array.isArray(value) ? value.filter((c): c is Capability => typeof c === 'string' && c in CAPABILITIES) : fallback
  }
  if (path === 'simulation.speed') return typeof value === 'number' && value > 0 && value <= 16 ? value : fallback
  if (path === 'safety.monthlyBudgetUsd') return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
  if (ENUMS[path]) return typeof value === 'string' && ENUMS[path].includes(value) ? value : fallback
  if (typeof fallback === 'string' && path === 'profile.name') return typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback
  return typeof value === typeof fallback ? value : fallback
}

/**
 * Settings from a file, made safe: only known keys, values of the right type and within the allowed
 * choices; anything else keeps its default. (Mirrors the settings store's merge-with-defaults.)
 */
export function sanitizeSettings(raw: Record<string, unknown>, defaults: Settings = DEFAULT_SETTINGS): Settings {
  const out = {} as Record<string, unknown>
  for (const [section, def] of Object.entries(defaults) as [string, unknown][]) {
    const incoming = raw[section]
    if (isPlainObject(def)) {
      const next: Record<string, unknown> = { ...def }
      if (isPlainObject(incoming)) {
        for (const [k, fallback] of Object.entries(def)) {
          if (k in incoming) next[k] = acceptValue(`${section}.${k}`, incoming[k], fallback)
        }
        if (section === 'profile' && typeof incoming.email === 'string' && incoming.email.trim()) next.email = incoming.email.trim().slice(0, 254)
      }
      out[section] = next
    } else {
      out[section] = incoming === undefined ? def : acceptValue(section, incoming, def)
    }
  }
  return out as unknown as Settings
}

// ------------------------------------------------------------------------------------------------ apply

/** Forget per-session interface state that may point at data that no longer exists. */
function resetShellState(): void {
  const shell = useShellStore.getState()
  shell.attachRun(null)
  shell.clearInspect()
  useShellStore.setState({ recents: [], stagePrimary: null, selection: null })
}

/** Replace the database (and persist it), reporting tables this browser could not save. */
function replaceDatabase(tables: Tables): TableName[] {
  const failed: TableName[] = []
  const off = persistEvents.on('error', ({ table }) => failed.push(table))
  try {
    db.replaceAll(tables)
    writeAll(tables)
  } finally {
    off()
  }
  return failed
}

export interface ImportResult {
  /** Tables the browser refused to store (storage full); they are in memory until reload. */
  unsaved: TableName[]
  /** Held items from the file that were restored. */
  held: number
}

/**
 * Replace everything in this browser with an export: every table, the project scope and held items
 * (when they still resolve), and the settings when asked. API keys are untouched (exports never carry
 * them). Runs that were in flight in the file continue.
 */
export function applyImport(payload: ImportPayload, opts: { withSettings: boolean }): ImportResult {
  const unsaved = replaceDatabase(payload.tables)
  if (opts.withSettings && payload.settings) useSettingsStore.setState({ settings: payload.settings })

  const ctx = useContextStore.getState()
  const scope = payload.context?.scopeProjectId
  ctx.setScope(scope && payload.tables.projects[scope] ? scope : null)
  ctx.clear()
  let held = 0
  for (const ref of payload.context?.held ?? []) {
    if (resolveIn(payload.tables, ref).exists) {
      ctx.pin(ref)
      held++
    }
  }
  resetShellState()
  try {
    runEngine.resumeInterrupted()
  } catch {
    // The engine is optional here: an import that cannot resume runs still restores the data.
  }
  return { unsaved, held }
}

/**
 * Erase everything this browser keeps for Atrium: every table (stored as empty, so the demo world
 * does not come back on reload), settings, API keys, the project scope and held items.
 */
export function eraseEverything(): void {
  replaceDatabase(emptyTables())
  useSecretsStore.getState().clearAll()
  useSettingsStore.getState().reset()
  const ctx = useContextStore.getState()
  ctx.setScope(null)
  ctx.clear()
  resetShellState()
}

// ------------------------------------------------------------------------------------------------ storage

export interface StorageRow {
  key: string
  label: string
  rows?: number
  bytes: number
}

export interface StorageReport {
  tables: (StorageRow & { rows: number })[]
  /** Settings, held context, interface state and the API-key vault (size only). */
  other: StorageRow[]
  totalBytes: number
  totalRows: number
}

const OTHER_KEYS: { key: string; label: string }[] = [
  { key: 'atrium.settings', label: 'Settings' },
  { key: 'atrium.context', label: 'Scope and held items' },
  { key: 'atrium.shell', label: 'Interface layout and recents' },
  { key: 'atrium.secrets', label: 'API keys (never exported)' },
]

function storedBytes(key: string): number {
  try {
    return (localStorage.getItem(key)?.length ?? 0) * 2
  } catch {
    return 0
  }
}

/** What this browser stores for Atrium, largest tables first (UTF-16 bytes, as browsers count them). */
export function storageReport(state: Tables): StorageReport {
  const { byTable } = storageUsage()
  const tables = TABLE_NAMES.map((t) => ({ key: t, label: TABLE_LABEL[t], rows: Object.keys(state[t]).length, bytes: byTable[t] ?? 0 })).sort(
    (a, b) => b.bytes - a.bytes || b.rows - a.rows || a.label.localeCompare(b.label),
  )
  const other: StorageRow[] = OTHER_KEYS.map(({ key, label }) => ({ key, label, bytes: storedBytes(key) }))
  // The vault: how many keys it holds (never their values).
  const vault = other.find((o) => o.key === 'atrium.secrets')
  if (vault) vault.rows = Object.values(useSecretsStore.getState().secrets).reduce((n, fields) => n + Object.values(fields).filter((v) => v?.trim()).length, 0)
  const totalBytes = tables.reduce((n, r) => n + r.bytes, 0) + other.reduce((n, r) => n + r.bytes, 0)
  const totalRows = tables.reduce((n, r) => n + r.rows, 0)
  return { tables, other, totalBytes, totalRows }
}
