import { useCallback, useMemo, useRef, useState } from 'react'
import { useLatest } from './useLatest'

export interface Disclosure {
  open: boolean
  setOpen: (open: boolean) => void
  show: () => void
  hide: () => void
  toggle: () => void
  /** Spread onto overlays: `<Dialog {...d.props}>`. */
  props: { open: boolean; onOpenChange: (open: boolean) => void }
}

/** Open/closed state for overlays and disclosures. */
export function useDisclosure(initial = false, callbacks: { onOpen?: () => void; onClose?: () => void } = {}): Disclosure {
  const [open, setOpenState] = useState(initial)
  const openRef = useRef(open)
  openRef.current = open
  const callbacksRef = useLatest(callbacks)
  const setOpen = useCallback(
    (next: boolean) => {
      if (openRef.current === next) return
      openRef.current = next
      setOpenState(next)
      if (next) callbacksRef.current.onOpen?.()
      else callbacksRef.current.onClose?.()
    },
    [callbacksRef],
  )
  const show = useCallback(() => setOpen(true), [setOpen])
  const hide = useCallback(() => setOpen(false), [setOpen])
  const toggle = useCallback(() => setOpen(!openRef.current), [setOpen])
  return useMemo(
    () => ({ open, setOpen, show, hide, toggle, props: { open, onOpenChange: setOpen } }),
    [open, setOpen, show, hide, toggle],
  )
}
