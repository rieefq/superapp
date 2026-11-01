import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { refKey, sameRef, type EntityRef, type Run } from '@/core/types'

/**
 * What was made from a source (a message, finding, task…): `Message.derived` for messages, otherwise
 * the entities linked `derived_from` the source, plus runs whose origin is the source. Each item
 * carries the run that works on it, so the source can show a DerivedRow while it works and a
 * LandedCard when it ends (§5.4.12, §7.1).
 */
export interface DerivedItem {
  /** The derived entity (task, investigation, session, run, asset, knowledge…). */
  ref: EntityRef
  /** The latest run producing it (the run itself for run refs); absent for things that do not run. */
  run?: Run
}

const NONE: EntityRef[] = []
const NO_KEYS: string[] = []

const parseKey = (key: string): EntityRef => {
  const at = key.indexOf(':')
  return { kind: key.slice(0, at) as EntityRef['kind'], id: key.slice(at + 1) }
}

/** Entities derived from `source`, in creation order. */
export function derivedRefsIn(s: Tables, source: EntityRef): EntityRef[] {
  const out: EntityRef[] = []
  const add = (r: EntityRef) => {
    if (!sameRef(r, source) && !out.some((x) => sameRef(x, r))) out.push(r)
  }
  if (source.kind === 'message') for (const r of s.messages[source.id]?.derived ?? NONE) add(r)
  const links = Object.values(s.links)
    .filter((l) => l.rel === 'derived_from' && l.to.kind === source.kind && l.to.id === source.id)
    .sort((a, b) => a.createdAt - b.createdAt)
  for (const l of links) add(l.from)
  for (const r of Object.values(s.runs)) {
    if (r.origin && r.origin.kind === source.kind && r.origin.id === source.id && r.kind !== 'chat') add({ kind: 'run', id: r.id })
  }
  return out
}

/** The run working on a derived entity (latest), if any. */
export function runForIn(s: Tables, ref: EntityRef): Run | undefined {
  const last = (ids: readonly string[] | undefined) => (ids?.length ? s.runs[ids[ids.length - 1]] : undefined)
  switch (ref.kind) {
    case 'run':
      return s.runs[ref.id]
    case 'investigation':
      return last(s.investigations[ref.id]?.runIds)
    case 'session': {
      const turns = s.sessions[ref.id]?.turns ?? []
      for (let i = turns.length - 1; i >= 0; i--) if (turns[i].runId) return s.runs[turns[i].runId as string]
      return undefined
    }
    case 'asset': {
      const id = s.assets[ref.id]?.runId
      return id ? s.runs[id] : undefined
    }
    case 'task':
      return last(s.tasks[ref.id]?.runIds)
    default:
      return undefined
  }
}

/** Derived items for a source, live. Re-renders only when an item or its run changes. */
export function useDerived(source: EntityRef | null | undefined): DerivedItem[] {
  // Select keys (strings), not new objects, so the selection is stable between store updates.
  const keys = useDB(useShallow((s: Tables) => (source ? derivedRefsIn(s, source).map(refKey) : NO_KEYS)))
  const refs = useMemo(() => keys.map(parseKey), [keys])
  const runs = useDB(useShallow((s: Tables) => refs.map((r) => runForIn(s, r))))
  // A run that is itself derived and also the run of another derived entity is shown once.
  const seenRuns = new Set<string>()
  const items: DerivedItem[] = []
  refs.forEach((ref, i) => {
    const run = runs[i]
    if (ref.kind === 'run' && seenRuns.has(ref.id)) return
    if (run) {
      if (seenRuns.has(run.id)) return
      seenRuns.add(run.id)
    }
    items.push(run ? { ref, run } : { ref })
  })
  return items
}

export const derivedKey = (item: DerivedItem) => refKey(item.ref)
