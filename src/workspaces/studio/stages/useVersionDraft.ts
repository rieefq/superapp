import { useCallback, useRef, useState } from 'react'

/**
 * A local draft of one version's text or slides that writes through to the database on every
 * change — always to the version it was read from, so a version switch mid-edit never lands in the
 * wrong one. The database batches its own persistence and flushes it when the page unloads, so an
 * edit followed by a reload is never lost. Mount editors keyed by the version id.
 */
export function useVersionDraft<T>(initial: T, write: (value: T) => void): [T, (next: T) => void] {
  const [draft, setDraft] = useState<T>(initial)
  const writeRef = useRef(write)
  writeRef.current = write
  const change = useCallback((next: T) => {
    setDraft(next)
    writeRef.current(next)
  }, [])
  return [draft, change]
}
