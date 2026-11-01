import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { isInsideLayerAbove, tooltipsSuppressed, useLayer, useOverlayFocus } from './layers'
import { floatingMotion } from './motion'
import { Portal } from './Portal'
import type { Placement } from './positioning'
import { mergeProps, mergeRefs, slot } from './slot'
import { useFloating } from './useFloating'

export interface PopoverTriggerProps {
  ref: Ref<HTMLElement>
  'aria-haspopup': 'dialog'
  'aria-expanded': boolean
  'aria-controls'?: string
  'data-state': 'open' | 'closed'
  onClick: (e: ReactMouseEvent) => void
}

export interface PopoverProps {
  /** Element or render function (spread the props onto your trigger). */
  trigger: ReactElement | ((props: PopoverTriggerProps, state: { open: boolean }) => ReactNode)
  /** Content, or a function receiving `close`. */
  children: ReactNode | ((api: { close: () => void }) => ReactNode)
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  placement?: Placement
  offset?: number
  /** Match the trigger width ('min' = at least as wide). */
  matchWidth?: boolean | 'min'
  /** Trap focus inside (forms that must be completed or dismissed). */
  modal?: boolean
  /** Element to focus on open; false keeps focus on the trigger. Default: first focusable. */
  initialFocus?: RefObject<HTMLElement | null> | false
  /** Accessible name of the popover dialog. */
  'aria-label'?: string
  /** Id of a heading inside the content that names it. */
  'aria-labelledby'?: string
  className?: string
}

/**
 * Anchored, non-modal floating panel (role="dialog"). Click toggles; Escape, click-outside or tabbing
 * away closes; focus moves in on open and returns to the trigger on close.
 */
export function Popover({
  trigger,
  children,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  placement = 'bottom-start',
  offset = 6,
  matchWidth,
  modal = false,
  initialFocus,
  className,
  ...aria
}: PopoverProps) {
  const [open, setOpen] = useControllableState({ value: openProp, defaultValue: defaultOpen, onChange: onOpenChange })
  const triggerRef = useRef<HTMLElement | null>(null)
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const reduced = useReducedMotion()
  const close = useCallback(() => setOpen(false), [setOpen])

  const layerId = useLayer({ open, modal, inside: [panelRef, triggerRef], onEscape: close, onOutside: close })
  useOverlayFocus({ open, container: panelRef, initialFocus, trap: modal, layerId })
  const floating = useFloating({ open, anchor: triggerEl, placement, offset, matchWidth })
  const preset = floatingMotion(floating.side, reduced)

  const triggerProps: PopoverTriggerProps = {
    ref: mergeRefs(triggerRef, setTriggerEl),
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? id : undefined,
    'data-state': open ? 'open' : 'closed',
    onClick: () => setOpen(!open),
  }
  const triggerNode =
    typeof trigger === 'function'
      ? trigger(triggerProps, { open })
      : isValidElement(trigger)
        ? cloneElement(trigger as ReactElement<Record<string, unknown>>, mergeProps(trigger.props as Record<string, unknown>, triggerProps as unknown as Record<string, unknown>))
        : trigger

  const onBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (modal) return
    const next = e.relatedTarget as Node | null
    if (!next) return
    if (panelRef.current?.contains(next) || triggerRef.current?.contains(next)) return
    if (layerId.current && isInsideLayerAbove(layerId.current, next)) return
    close()
  }

  return (
    <>
      {triggerNode}
      <AnimatePresence>
        {open && (
          <Portal>
            <motion.div
              ref={mergeRefs(panelRef, floating.setFloating)}
              id={id}
              role="dialog"
              aria-modal={modal || undefined}
              aria-label={aria['aria-label']}
              aria-labelledby={aria['aria-labelledby']}
              tabIndex={-1}
              data-layer=""
              initial={preset.initial}
              animate={preset.animate}
              exit={preset.exit}
              transition={preset.transition}
              onBlur={onBlur}
              className={cn(
                'fixed top-0 left-0 z-(--z-popover) overflow-auto overscroll-contain rounded-md border border-line bg-overlay p-3 text-sm text-ink shadow-e1 outline-none',
                className,
              )}
            >
              {typeof children === 'function' ? children({ close }) : children}
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </>
  )
}

export interface HoverCardProps {
  /** The trigger (usually a link or mention chip). */
  children: ReactElement
  content: ReactNode
  placement?: Placement
  /** ms before opening. Default 400. */
  openDelay?: number
  /** Grace period (ms) to move the pointer into the card. Default 120. */
  closeDelay?: number
  className?: string
  disabled?: boolean
}

/**
 * Delayed preview on hover or keyboard focus, with a grace period so the pointer can travel into the card.
 * Supplementary only: never put the sole path to an action inside a hover card. Escape closes it.
 */
export function HoverCard({ children, content, placement = 'bottom-start', openDelay = 400, closeDelay = 120, className, disabled }: HoverCardProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reduced = useReducedMotion()
  const floating = useFloating({ open, anchor, placement, offset: 8 })
  const preset = floatingMotion(floating.side, reduced)

  const scheduleOpen = (delay = openDelay) => {
    if (disabled) return
    clearTimeout(closeTimer.current)
    clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => setOpen(true), delay)
  }
  const scheduleClose = () => {
    clearTimeout(openTimer.current)
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), closeDelay)
  }
  const cancelClose = () => clearTimeout(closeTimer.current)

  useEffect(
    () => () => {
      clearTimeout(openTimer.current)
      clearTimeout(closeTimer.current)
    },
    [],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  const trigger = slot(children, {
    ref: setAnchor,
    onPointerEnter: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') scheduleOpen()
    },
    onPointerLeave: scheduleClose,
    onFocus: (e: ReactFocusEvent<HTMLElement>) => {
      let keyboard = true
      try {
        keyboard = e.currentTarget.matches(':focus-visible')
      } catch {
        /* ignore */
      }
      if (keyboard && !tooltipsSuppressed()) scheduleOpen(Math.round(openDelay / 2))
    },
    onBlur: scheduleClose,
  })

  return (
    <>
      {trigger}
      <AnimatePresence>
        {open && (
          <Portal>
            <motion.div
              ref={floating.setFloating}
              initial={preset.initial}
              animate={preset.animate}
              exit={preset.exit}
              transition={preset.transition}
              onPointerEnter={cancelClose}
              onPointerLeave={scheduleClose}
              className={cn(
                'fixed top-0 left-0 z-(--z-popover) w-72 overflow-hidden rounded-md border border-line bg-overlay p-3 text-sm text-ink shadow-e1',
                className,
              )}
            >
              {content}
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </>
  )
}
