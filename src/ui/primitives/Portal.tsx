import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface PortalProps {
  children: ReactNode
  /** Defaults to document.body. */
  container?: Element | null
}

/** Render children into document.body (or a given container), outside clipping/stacking contexts. */
export function Portal({ children, container }: PortalProps) {
  if (typeof document === 'undefined') return null
  return createPortal(children, container ?? document.body)
}
