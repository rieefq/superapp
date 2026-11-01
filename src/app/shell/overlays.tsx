import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { IconButton, Popover, Portal, useLayer, useOverlayFocus, useReducedMotion, useScrollLock, type PopoverTriggerProps, type Placement } from '@/ui'
import { cn } from '@/lib/cn'
import { formFactorFor, type FormFactor } from './layout'

// ------------------------------------------------------------------------------------------------ viewport

function subscribeResize(onChange: () => void): () => void {
  window.addEventListener('resize', onChange)
  return () => window.removeEventListener('resize', onChange)
}
const getWidth = () => (typeof window === 'undefined' ? 1440 : window.innerWidth)
const getHeight = () => (typeof window === 'undefined' ? 900 : window.innerHeight)

/** Live viewport width (CSS px). */
export function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, getWidth, () => 1440)
}

/** Live viewport height (CSS px). */
export function useViewportHeight(): number {
  return useSyncExternalStore(subscribeResize, getHeight, () => 900)
}

/** phone · tablet · laptop · desktop · large · wide (§3.12). */
export function useFormFactor(): FormFactor {
  return formFactorFor(useViewportWidth())
}

// ------------------------------------------------------------------------------------------------ phone sheet

export interface PhoneSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  /** Accessible name when the title is not a string. */
  label?: string
  children: ReactNode
  footer?: ReactNode
  className?: string
}

/** Full-screen sheet for phones (§3.12: every popover becomes a full-screen sheet). */
export function PhoneSheet({ open, onOpenChange, title, label, children, footer, className }: PhoneSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  const layerId = useLayer({ open, modal: true, inside: [panelRef], onEscape: close })
  useOverlayFocus({ open, container: panelRef, trap: true, layerId })
  useScrollLock(open)
  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={label ?? (typeof title === 'string' ? title : undefined)}
            tabIndex={-1}
            data-layer=""
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, y: 24, transition: { duration: 0.18 } }}
            transition={{ duration: reduced ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'fixed inset-0 z-(--z-overlay) flex flex-col bg-overlay text-ink outline-none',
              'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
              className,
            )}
          >
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-2 pl-4">
              <h2 className="type-title-3 min-w-0 flex-1 truncate">{title}</h2>
              <IconButton icon={X} label="Close" onClick={close} tooltip={false} />
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && <footer className="shrink-0 border-t border-line">{footer}</footer>}
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  )
}

// ------------------------------------------------------------------------------------------------ shell popover

const WIDTH: Record<number, string> = {
  240: 'w-[240px]',
  320: 'w-[320px]',
  360: 'w-[360px]',
  420: 'w-[420px]',
}

export interface ShellPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Spread the props onto the trigger button. */
  trigger: (props: PopoverTriggerProps | PhoneTriggerProps, state: { open: boolean }) => ReactNode
  title: string
  width: 240 | 320 | 360 | 420
  placement?: Placement
  /** Content; receives `close`. */
  children: (api: { close: () => void; phone: boolean }) => ReactNode
  phoneFooter?: ReactNode
  initialFocus?: false
}

export interface PhoneTriggerProps {
  ref?: Ref<HTMLElement>
  'aria-haspopup': 'dialog'
  'aria-expanded': boolean
  onClick: () => void
}

/**
 * A top-bar popover: an anchored panel (e1, radius 14 for ≥360px panels) on tablets and up, a
 * full-screen sheet on phones. Max height 70vh; the content manages its own scrolling regions.
 */
export function ShellPopover({ open, onOpenChange, trigger, title, width, placement = 'bottom-end', children, phoneFooter, initialFocus }: ShellPopoverProps) {
  const ff = useFormFactor()
  const close = useCallback(() => onOpenChange(false), [onOpenChange])
  if (ff === 'phone') {
    return (
      <>
        {trigger({ 'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: () => onOpenChange(!open) }, { open })}
        <PhoneSheet open={open} onOpenChange={onOpenChange} title={title} footer={phoneFooter}>
          {children({ close, phone: true })}
        </PhoneSheet>
      </>
    )
  }
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      placement={placement}
      offset={6}
      aria-label={title}
      initialFocus={initialFocus}
      trigger={(props, state) => trigger(props, state)}
      className={cn('flex max-h-[70vh] flex-col overflow-hidden p-0', WIDTH[width], width >= 360 ? 'rounded-lg' : 'rounded-md')}
    >
      {children({ close, phone: false })}
    </Popover>
  )
}

/** Delay a boolean turning true (hover intents) — false applies immediately. */
export function useDelayedTrue(value: boolean, delay: number): boolean {
  const [out, setOut] = useState(false)
  useEffect(() => {
    if (!value) {
      setOut(false)
      return
    }
    const t = setTimeout(() => setOut(true), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return out
}
