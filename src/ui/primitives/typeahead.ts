import { useCallback, useEffect, useRef } from 'react'

/**
 * Find the next item whose label starts with `query` (case-insensitive), wrapping around.
 * - Repeating one character ('ddd') cycles through items starting with it, beginning after `current`.
 * - A longer query keeps the current item when it still matches, otherwise searches forward.
 * Returns -1 when nothing matches.
 */
export function findTypeaheadMatch(
  labels: readonly string[],
  query: string,
  current: number,
  isDisabled: (index: number) => boolean = () => false,
): number {
  const n = labels.length
  const q = query.toLowerCase()
  if (!q || n === 0) return -1
  const repeated = q.length > 1 && [...q].every((c) => c === q[0])
  const search = repeated ? q[0] : q
  const start = q.length === 1 || repeated ? current + 1 : Math.max(current, 0)
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n
    if (isDisabled(i)) continue
    if (labels[i].trim().toLowerCase().startsWith(search)) return i
  }
  return -1
}

/** Is this key press a typeahead character (printable, no command modifiers)? */
export function isTypeaheadKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
}

/** Accumulates typed characters; the buffer resets after `timeout` ms of silence. */
export function useTypeahead(timeout = 600) {
  const buffer = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const push = useCallback(
    (char: string) => {
      buffer.current += char
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        buffer.current = ''
      }, timeout)
      return buffer.current
    },
    [timeout],
  )
  const active = useCallback(() => buffer.current.length > 0, [])
  const reset = useCallback(() => {
    buffer.current = ''
    clearTimeout(timer.current)
  }, [])
  return { push, active, reset }
}
