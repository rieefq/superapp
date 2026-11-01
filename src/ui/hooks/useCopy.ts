import { useCallback, useEffect, useRef, useState } from 'react'

/** Copy text to the clipboard (async API with a textarea fallback). Resolves true on success. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    const prev = document.activeElement as HTMLElement | null
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    prev?.focus?.({ preventScroll: true })
    return ok
  } catch {
    return false
  }
}

/** `const { copy, copied } = useCopy()` — `copied` stays true for `resetMs` after a successful copy. */
export function useCopy(resetMs = 1600) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(
    async (text: string) => {
      const ok = await copyText(text)
      setCopied(ok)
      setError(!ok)
      clearTimeout(timer.current)
      if (ok) timer.current = setTimeout(() => setCopied(false), resetMs)
      return ok
    },
    [resetMs],
  )
  return { copy, copied, error }
}
