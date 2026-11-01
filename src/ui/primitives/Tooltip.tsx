import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { KbdCombo } from './Kbd'
import { tooltipsSuppressed } from './layers'
import { tooltipMotion } from './motion'
import { Portal } from './Portal'
import type { Placement } from './positioning'
import { slot } from './slot'
import { useFloating } from './useFloating'

/** Moving between tooltips within this window skips the open delay. */
const SKIP_DELAY_MS = 300
let lastClosedAt = 0
/** The open tooltip's close function; a neighbour opening calls it with instant=true (no cross-fade). */
let closeActive: ((instant?: boolean) => void) | null = null

export interface TooltipProps {
  content: ReactNode
  /** Shortcut shown after the content, e.g. 'mod+k'. */
  shortcut?: string
  /** The trigger: one element that forwards ref and DOM handlers. */
  children: ReactElement
  placement?: Placement
  /** Hover delay before opening, ms. Default 400. */
  delay?: number
  disabled?: boolean
  /** The trigger's accessible name already says this (icon buttons) — skip aria-describedby. */
  asLabel?: boolean
  /** Controlled open state (demos). */
  open?: boolean
  className?: string
}

/**
 * Hover/focus hint. ~400ms delay (instant when moving between tooltips), keyboard focus opens it,
 * Escape/pointer-down dismiss it, and touch never opens it. Linked via aria-describedby.
 */
export function Tooltip({
  content,
  shortcut,
  children,
  placement = 'top',
  delay = 400,
  disabled,
  asLabel,
  open: controlledOpen,
  className,
}: TooltipProps) {
  const [openState, setOpenState] = useState(false)
  const [instantExit, setInstantExit] = useState(false)
  const open = !disabled && (controlledOpen ?? openState) && content != null && content !== ''
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const blockedUntilLeave = useRef(false)
  const id = useId()
  const reduced = useReducedMotion()

  const close = useCallback((instant = false) => {
    clearTimeout(timer.current)
    setInstantExit(instant)
    setOpenState((was) => {
      if (was) lastClosedAt = Date.now()
      return false
    })
  }, [])

  const show = useCallback(() => {
    clearTimeout(timer.current)
    if (closeActive && closeActive !== close) closeActive(true)
    closeActive = close
    setInstantExit(false)
    setOpenState(true)
  }, [close])

  const scheduleOpen = useCallback(() => {
    clearTimeout(timer.current)
    if (Date.now() - lastClosedAt < SKIP_DELAY_MS) show()
    else timer.current = setTimeout(show, delay)
  }, [delay, show])

  useEffect(() => () => {
    clearTimeout(timer.current)
    if (closeActive === close) closeActive = null
  }, [close])

  // Escape dismisses without moving focus (WCAG 1.4.13). Does not stop propagation.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, close])

  const floating = useFloating({ open, anchor, placement, offset: 6, padding: 6, constrain: false })
  const preset = tooltipMotion(floating.side, reduced)

  const trigger = slot(children, {
    ref: setAnchor,
    'aria-describedby': open && !asLabel ? id : undefined,
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType === 'touch' || blockedUntilLeave.current) return
      scheduleOpen()
    },
    onPointerLeave: () => {
      blockedUntilLeave.current = false
      close()
    },
    onPointerDown: () => {
      blockedUntilLeave.current = true
      close(true)
    },
    onFocus: (e: ReactFocusEvent<HTMLElement>) => {
      if (tooltipsSuppressed() || blockedUntilLeave.current) return
      let keyboard = true
      try {
        keyboard = e.currentTarget.matches(':focus-visible')
      } catch {
        /* older engines */
      }
      if (keyboard && e.currentTarget.getAttribute('aria-expanded') !== 'true') show()
    },
    onBlur: () => close(),
  })

  return (
    <>
      {trigger}
      <AnimatePresence>
        {open && (
          <Portal>
            <motion.div
              ref={floating.setFloating}
              id={id}
              role="tooltip"
              initial={preset.initial}
              animate={preset.animate}
              exit={instantExit ? { opacity: 0, transition: { duration: 0 } } : preset.exit}
              transition={preset.transition}
              className={cn(
                'pointer-events-none fixed top-0 left-0 z-(--z-tooltip) flex max-w-[280px] items-center gap-2 rounded-xs bg-inverse px-2 py-1',
                'text-xs leading-4 font-medium text-inverse-ink shadow-e1',
                className,
              )}
            >
              <span className="text-pretty">{content}</span>
              {shortcut && <KbdCombo aria-hidden combo={shortcut} variant="plain" tone="inverse" />}
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </>
  )
}
