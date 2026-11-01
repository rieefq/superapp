import { emptyTables, TABLE_NAMES, type Tables } from '@/core/db/schema'
import { buildContent } from './content'
import { buildOps } from './ops'

/**
 * Build the first-run demo world. Deterministic for a given `now` (all timestamps are
 * relative to it so the data always looks fresh on first open).
 */
export function buildSeed(now: number): Tables {
  const tables = emptyTables()
  for (const part of [buildContent(now), buildOps(now)]) {
    for (const t of TABLE_NAMES) {
      const rows = part[t]
      if (rows) Object.assign(tables[t], rows)
    }
  }
  return tables
}
