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
  deriveBackReferences(tables)
  return tables
}

/**
 * The seed is written in two independent parts; back-references that point from an
 * entity to the runs executed for it are derived here from each run's origin.
 */
function deriveBackReferences(t: Tables): void {
  const runs = Object.values(t.runs).sort((a, b) => a.createdAt - b.createdAt)
  for (const run of runs) {
    const o = run.origin
    if (!o) continue
    if (o.kind === 'investigation' && t.investigations[o.id]) {
      const inv = t.investigations[o.id]
      if (!inv.runIds.includes(run.id)) inv.runIds = [...inv.runIds, run.id]
    } else if (o.kind === 'task' && t.tasks[o.id]) {
      const task = t.tasks[o.id]
      if (!task.runIds.includes(run.id)) task.runIds = [...task.runIds, run.id]
    } else if (o.kind === 'asset' && t.assets[o.id]) {
      t.assets[o.id].runId = run.id
    } else if (o.kind === 'message' && t.messages[o.id]) {
      t.messages[o.id].runId = run.id
    } else if (o.kind === 'workflow' && t.workflows[o.id]) {
      const wf = t.workflows[o.id]
      if (!wf.lastRunAt || (run.startedAt ?? run.createdAt) > wf.lastRunAt) wf.lastRunAt = run.startedAt ?? run.createdAt
    }
  }
}
