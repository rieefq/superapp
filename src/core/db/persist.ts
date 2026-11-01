import { createEmitter } from '@/lib/emitter'
import { emptyTables, TABLE_NAMES, type TableName, type Tables } from './schema'
import { useDB } from './store'

/**
 * Per-table persistence to localStorage.
 * - Only tables whose reference changed are written (streaming updates to `messages`
 *   don't re-serialize `knowledge`).
 * - Writes are debounced (400ms, max 2s) and flushed on tab hide/unload.
 * - Bump SCHEMA_VERSION when a breaking change to the stored shape is made; older
 *   data is then discarded and the app re-seeds.
 */
export const SCHEMA_VERSION = 1
const KEY_PREFIX = 'atrium.db.'
const META_KEY = 'atrium.db.meta'

export const persistEvents = createEmitter<{ error: { table: TableName; error: unknown } }>()

interface Meta {
  version: number
  createdAt: number
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Load persisted tables into the store. Returns false when there is nothing (valid) to load. */
export function hydrate(): boolean {
  const metaRaw = safeGet(META_KEY)
  if (!metaRaw) return false
  let meta: Meta
  try {
    meta = JSON.parse(metaRaw) as Meta
  } catch {
    return false
  }
  if (meta.version !== SCHEMA_VERSION) return false
  const tables = emptyTables()
  for (const t of TABLE_NAMES) {
    const raw = safeGet(KEY_PREFIX + t)
    if (!raw) continue
    try {
      ;(tables as unknown as Record<string, unknown>)[t] = JSON.parse(raw)
    } catch {
      // Corrupt table: start it empty rather than failing the whole app.
    }
  }
  useDB.setState(tables, true)
  return true
}

export function writeAll(tables: Tables): void {
  for (const t of TABLE_NAMES) writeTable(t, tables[t])
  try {
    localStorage.setItem(META_KEY, JSON.stringify({ version: SCHEMA_VERSION, createdAt: Date.now() } satisfies Meta))
  } catch {
    /* ignore */
  }
}

function writeTable(table: TableName, data: unknown) {
  try {
    localStorage.setItem(KEY_PREFIX + table, JSON.stringify(data))
  } catch (error) {
    persistEvents.emit('error', { table, error })
  }
}

let started = false

/** Begin syncing store changes to localStorage. Idempotent. */
export function startPersistence(): () => void {
  if (started) return () => {}
  started = true
  let prev = useDB.getState()
  const dirty = new Set<TableName>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstDirtyAt = 0

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    firstDirtyAt = 0
    const state = useDB.getState()
    for (const t of dirty) writeTable(t, state[t])
    dirty.clear()
  }

  const unsub = useDB.subscribe((state) => {
    for (const t of TABLE_NAMES) if (state[t] !== prev[t]) dirty.add(t)
    prev = state
    if (!dirty.size) return
    const now = Date.now()
    if (!firstDirtyAt) firstDirtyAt = now
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, now - firstDirtyAt > 2000 ? 0 : 400)
  })

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush()
  }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('beforeunload', flush)

  return () => {
    flush()
    unsub()
    document.removeEventListener('visibilitychange', onHide)
    window.removeEventListener('beforeunload', flush)
    started = false
  }
}

/** Remove all persisted database tables (settings/secrets are separate). */
export function clearPersisted(): void {
  for (const t of TABLE_NAMES) {
    try {
      localStorage.removeItem(KEY_PREFIX + t)
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(META_KEY)
  } catch {
    /* ignore */
  }
}

/** Approximate bytes used by the persisted database. */
export function storageUsage(): { bytes: number; byTable: Record<TableName, number> } {
  const byTable = {} as Record<TableName, number>
  let bytes = 0
  for (const t of TABLE_NAMES) {
    const n = (safeGet(KEY_PREFIX + t)?.length ?? 0) * 2
    byTable[t] = n
    bytes += n
  }
  return { bytes, byTable }
}
