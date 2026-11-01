import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A local draft of one version's text or slides, written back after a short pause (and on unmount),
 * always to the version it was read from — so a version switch mid-edit never lands in the wrong one.
 * Mount editors keyed by the version id.
 */
export function useVersionDraft<T>(initial: T, write: (value: T) => void, delay = 350): [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useState<T>(initial)
  const pending = useRef<{ value: T } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const writeRef = useRef(write)
  writeRef.current = write

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pending.current
    pending.current = null
    if (p) writeRef.current(p.value)
  }, [])

  const change = useCallback(
    (next: T) => {
      setDraft(next)
      pending.current = { value: next }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, delay)
    },
    [flush, delay],
  )

  useEffect(() => () => flush(), [flush])
  return [draft, change, flush]
}
