import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import type { ID } from '@/core/types'
import { emptyTables, type RowOf, type TableName, type Tables } from './schema'

/**
 * The application database. Components read through the hooks below; all writes go
 * through `db.*` (usually via a domain service in `@/core/services`, which also records
 * activity, links and notifications consistently).
 */
export const useDB = create<Tables>()(() => emptyTables())

type Patch<R> = Partial<R> | ((row: R) => R)

function setTable<T extends TableName>(table: T, next: Tables[T]) {
  useDB.setState({ [table]: next } as Pick<Tables, T>)
}

export const db = {
  get<T extends TableName>(table: T, id: ID | null | undefined): RowOf<T> | undefined {
    if (!id) return undefined
    return useDB.getState()[table][id] as RowOf<T> | undefined
  },

  all<T extends TableName>(table: T): RowOf<T>[] {
    return Object.values(useDB.getState()[table]) as RowOf<T>[]
  },

  filter<T extends TableName>(table: T, pred: (row: RowOf<T>) => boolean): RowOf<T>[] {
    return db.all(table).filter(pred)
  },

  find<T extends TableName>(table: T, pred: (row: RowOf<T>) => boolean): RowOf<T> | undefined {
    return db.all(table).find(pred)
  },

  insert<T extends TableName>(table: T, row: RowOf<T>): RowOf<T> {
    const cur = useDB.getState()[table]
    setTable(table, { ...cur, [row.id]: row } as Tables[T])
    return row
  },

  insertMany<T extends TableName>(table: T, rows: RowOf<T>[]): void {
    if (!rows.length) return
    const next = { ...useDB.getState()[table] } as Record<ID, RowOf<T>>
    for (const r of rows) next[r.id] = r
    setTable(table, next as Tables[T])
  },

  /** Shallow-merge a patch (or apply an updater). Returns the new row, or undefined if missing. */
  update<T extends TableName>(table: T, id: ID, patch: Patch<RowOf<T>>): RowOf<T> | undefined {
    const cur = useDB.getState()[table]
    const row = cur[id] as RowOf<T> | undefined
    if (!row) return undefined
    const next = typeof patch === 'function' ? patch(row) : ({ ...row, ...patch } as RowOf<T>)
    if (next === row) return row
    setTable(table, { ...cur, [id]: next } as Tables[T])
    return next
  },

  upsert<T extends TableName>(table: T, row: RowOf<T>): RowOf<T> {
    return db.insert(table, row)
  },

  remove<T extends TableName>(table: T, id: ID): void {
    const cur = useDB.getState()[table]
    if (!(id in cur)) return
    const next = { ...cur } as Record<ID, unknown>
    delete next[id]
    setTable(table, next as Tables[T])
  },

  removeMany<T extends TableName>(table: T, ids: ID[]): void {
    const cur = useDB.getState()[table]
    const next = { ...cur } as Record<ID, unknown>
    let changed = false
    for (const id of ids) if (id in next) { delete next[id]; changed = true }
    if (changed) setTable(table, next as Tables[T])
  },

  /** Replace the entire database (reset / import). */
  replaceAll(tables: Tables): void {
    useDB.setState(tables, true)
  },
}

// ---------------------------------------------------------------- React hooks

/** Subscribe to one row. Re-renders only when that row changes. */
export function useRow<T extends TableName>(table: T, id: ID | null | undefined): RowOf<T> | undefined {
  return useDB((s) => (id ? (s[table][id] as RowOf<T> | undefined) : undefined))
}

/** Subscribe to a whole table record (id → row). */
export function useTable<T extends TableName>(table: T): Tables[T] {
  return useDB((s) => s[table])
}

/**
 * Subscribe to a filtered/sorted list of rows. The result is shallow-compared,
 * so components only re-render when the selected rows (or their order) change.
 */
export function useRows<T extends TableName>(
  table: T,
  filter?: (row: RowOf<T>) => boolean,
  sort?: (a: RowOf<T>, b: RowOf<T>) => number,
): RowOf<T>[] {
  return useDB(
    useShallow((s) => {
      let rows = Object.values(s[table]) as RowOf<T>[]
      if (filter) rows = rows.filter(filter)
      if (sort) rows.sort(sort)
      return rows
    }),
  )
}

/** Rows for a list of ids, in the given order (missing ids are skipped). */
export function useRowsByIds<T extends TableName>(table: T, ids: readonly ID[] | undefined): RowOf<T>[] {
  return useDB(
    useShallow((s) => {
      if (!ids) return []
      const t = s[table] as Record<ID, RowOf<T>>
      const out: RowOf<T>[] = []
      for (const id of ids) if (t[id]) out.push(t[id])
      return out
    }),
  )
}

/** Count rows matching a predicate (cheap re-render: number compare). */
export function useCount<T extends TableName>(table: T, filter?: (row: RowOf<T>) => boolean): number {
  return useDB((s) => {
    const rows = Object.values(s[table]) as RowOf<T>[]
    return filter ? rows.filter(filter).length : rows.length
  })
}
