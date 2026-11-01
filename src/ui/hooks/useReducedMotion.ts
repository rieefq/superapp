import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** Current reduced-motion state: html[data-motion] ('reduce' | 'full') wins over the OS preference. */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false
  const attr = document.documentElement.getAttribute('data-motion')
  if (attr === 'reduce') return true
  if (attr === 'full') return false
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
}

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia?.(QUERY)
  mql?.addEventListener('change', onChange)
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] })
  return () => {
    mql?.removeEventListener('change', onChange)
    observer.disconnect()
  }
}

/** Live reduced-motion preference (OS setting + the in-app html[data-motion] override). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false)
}
