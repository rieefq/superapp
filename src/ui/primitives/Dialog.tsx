import {
  createContext,
  useContext,
  useId,
  useRef,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useBreakpointUp } from '@/ui/hooks/useMediaQuery'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { IconButton } from './IconButton'
import { useLayer, useOverlayFocus, useScrollLock } from './layers'
import { dialogMotion, scrimMotion, sheetMotion } from './motion'
import { Portal } from './Portal'

interface DialogIds {
  titleId: string
  descriptionId: string
}
const DialogContext = createContext<DialogIds | null>(null)

/** Title for custom dialog/sheet headers (wired to aria-labelledby). */
export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const ctx = useContext(DialogContext)
  return <h2 id={ctx?.titleId} className={cn('type-title-2 text-ink text-balance', className)} {...props} />
}

/** Description for custom headers (wired to aria-describedby). */
export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const ctx = useContext(DialogContext)
  return <p id={ctx?.descriptionId} className={cn('text-sm text-ink-2 text-pretty', className)} {...props} />
}

interface ModalBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: ReactNode
  description?: ReactNode
  /** Replaces the default title/description header (use DialogTitle inside for labelling). */
  header?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  /** Element to focus on open (default: [data-autofocus], else first focusable). */
  initialFocus?: RefObject<HTMLElement | null>
  /** Escape / click-outside close it. Default true. */
  dismissible?: boolean
  hideClose?: boolean
  /** 'alertdialog' for confirmations that interrupt. */
  role?: 'dialog' | 'alertdialog'
  'aria-label'?: string
  className?: string
  bodyClassName?: string
  /** Called after the exit animation finishes. */
  onClosed?: () => void
}

function useModal(open: boolean, onOpenChange: (open: boolean) => void, dismissible: boolean, initialFocus?: RefObject<HTMLElement | null>) {
  const panelRef = useRef<HTMLDivElement>(null)
  const close = () => onOpenChange(false)
  const layerId = useLayer({
    open,
    modal: true,
    inside: [panelRef],
    onEscape: () => dismissible && close(),
    onOutside: () => dismissible && close(),
  })
  useOverlayFocus({ open, container: panelRef, initialFocus, trap: true, layerId })
  useScrollLock(open)
  const ids = { titleId: useId(), descriptionId: useId() }
  return { panelRef, close, ids }
}

function DefaultHeader({ title, description, padded }: { title?: ReactNode; description?: ReactNode; padded: string }) {
  if (!title && !description) return null
  return (
    <div className={cn('flex flex-col gap-1.5 pt-5 pb-3', padded)}>
      {title && <DialogTitle className="pr-8">{title}</DialogTitle>}
      {description && <DialogDescription>{description}</DialogDescription>}
    </div>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <IconButton
      icon={X}
      label="Close"
      size="sm"
      tooltip={false}
      onClick={onClick}
      className="absolute top-3.5 right-3.5"
    />
  )
}

// ------------------------------------------------------------------------------------------------ Dialog

const DIALOG_SIZE = {
  sm: 'max-w-[400px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[680px]',
  xl: 'max-w-[880px]',
  full: 'max-w-none h-full',
} as const

export interface DialogProps extends ModalBaseProps {
  size?: keyof typeof DIALOG_SIZE
}

/**
 * Modal dialog: focus trap, Escape, scroll lock, title/description wiring, header/body/footer slots,
 * enter = fade + 6px rise + scale .98 (opacity only under reduced motion).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  header,
  children,
  footer,
  initialFocus,
  dismissible = true,
  hideClose,
  role = 'dialog',
  size = 'md',
  className,
  bodyClassName,
  onClosed,
  ...aria
}: DialogProps) {
  const { panelRef, close, ids } = useModal(open, onOpenChange, dismissible, initialFocus)
  const reduced = useReducedMotion()
  const panel = dialogMotion(reduced)
  const scrim = scrimMotion(reduced)
  const pad = 'px-5'

  return (
    <AnimatePresence onExitComplete={onClosed}>
      {open && (
        <Portal>
          <DialogContext.Provider value={ids}>
            <div className="fixed inset-0 z-(--z-overlay) flex items-center justify-center p-4 sm:p-6" data-layer="">
              <motion.div aria-hidden className="absolute inset-0 bg-scrim" {...scrim} />
              <motion.div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-labelledby={title || header ? ids.titleId : undefined}
                aria-describedby={description || header ? ids.descriptionId : undefined}
                aria-label={aria['aria-label']}
                tabIndex={-1}
                initial={panel.initial}
                animate={panel.animate}
                exit={panel.exit}
                transition={panel.transition}
                className={cn(
                  'relative flex max-h-full w-full flex-col overflow-hidden rounded-lg border border-line bg-overlay text-ink shadow-e2 outline-none',
                  DIALOG_SIZE[size],
                  className,
                )}
              >
                {header ?? <DefaultHeader title={title} description={description} padded={pad} />}
                {children != null && (
                  <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain py-2', pad, !title && !header && 'pt-5', !footer && 'pb-5', bodyClassName)}>
                    {children}
                  </div>
                )}
                {footer && (
                  <div className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2 pt-3 pb-4', pad)}>{footer}</div>
                )}
                {!hideClose && <CloseButton onClick={close} />}
              </motion.div>
            </div>
          </DialogContext.Provider>
        </Portal>
      )}
    </AnimatePresence>
  )
}

// ------------------------------------------------------------------------------------------------ Sheet

/** xs 300 (list drawer) · sm 380 (tablet Inspector) · md 480 (Start sheet) · lg 560 · xl 720. */
const SHEET_WIDTH = { xs: 'sm:w-[300px]', sm: 'sm:w-[380px]', md: 'sm:w-[480px]', lg: 'sm:w-[560px]', xl: 'sm:w-[720px]' } as const

export interface SheetProps extends ModalBaseProps {
  /** 'auto' = bottom sheet on small screens, right panel from md up. Default 'right'. */
  side?: 'left' | 'right' | 'bottom' | 'auto'
  size?: keyof typeof SHEET_WIDTH
}

/**
 * Edge-anchored modal panel (inspectors, detail views, mobile actions). Side sheets float inset from the
 * edge; the bottom sheet has a grab handle and can be swiped down to dismiss.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  header,
  children,
  footer,
  initialFocus,
  dismissible = true,
  hideClose,
  role = 'dialog',
  side: sideProp = 'right',
  size = 'md',
  className,
  bodyClassName,
  onClosed,
  ...aria
}: SheetProps) {
  const { panelRef, close, ids } = useModal(open, onOpenChange, dismissible, initialFocus)
  const reduced = useReducedMotion()
  const wide = useBreakpointUp('md')
  const side = sideProp === 'auto' ? (wide ? 'right' : 'bottom') : sideProp
  const panel = sheetMotion(side, reduced)
  const scrim = scrimMotion(reduced)
  const bottom = side === 'bottom'
  const pad = 'px-5'

  return (
    <AnimatePresence onExitComplete={onClosed}>
      {open && (
        <Portal>
          <DialogContext.Provider value={ids}>
            <div className="fixed inset-0 z-(--z-overlay)" data-layer="">
              <motion.div aria-hidden className="absolute inset-0 bg-scrim" {...scrim} />
              <motion.div
                ref={panelRef}
                role={role}
                aria-modal="true"
                aria-labelledby={title || header ? ids.titleId : undefined}
                aria-describedby={description || header ? ids.descriptionId : undefined}
                aria-label={aria['aria-label']}
                tabIndex={-1}
                initial={panel.initial}
                animate={panel.animate}
                exit={panel.exit}
                transition={panel.transition}
                className={cn(
                  'absolute flex flex-col overflow-hidden border border-line bg-overlay text-ink shadow-e2 outline-none',
                  side === 'right' && cn('inset-y-2 right-2 w-[calc(100vw-16px)] rounded-lg', SHEET_WIDTH[size]),
                  side === 'left' && cn('inset-y-2 left-2 w-[calc(100vw-16px)] rounded-lg', SHEET_WIDTH[size]),
                  bottom && 'inset-x-0 bottom-0 mx-auto max-h-[88dvh] w-full max-w-2xl rounded-t-xl border-b-0 pb-[env(safe-area-inset-bottom)]',
                  className,
                )}
              >
                {bottom && <SheetHandle panelRef={panelRef} enabled={dismissible && !reduced} onDismiss={close} />}
                {header ?? <DefaultHeader title={title} description={description} padded={pad} />}
                <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain py-2', pad, !title && !header && 'pt-5', !footer && 'pb-5', bodyClassName)}>
                  {children}
                </div>
                {footer && (
                  <div className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line py-3', pad)}>{footer}</div>
                )}
                {!hideClose && <CloseButton onClick={close} />}
              </motion.div>
            </div>
          </DialogContext.Provider>
        </Portal>
      )}
    </AnimatePresence>
  )
}

/** Grab handle: drag down past a threshold to dismiss (pointer events, works with touch and mouse). */
function SheetHandle({ panelRef, enabled, onDismiss }: { panelRef: RefObject<HTMLDivElement | null>; enabled: boolean; onDismiss: () => void }) {
  const start = useRef<{ y: number; t: number } | null>(null)
  const setOffset = (y: number) => {
    const el = panelRef.current
    if (!el) return
    el.style.translate = y > 0 ? `0 ${y}px` : ''
    el.style.transition = y > 0 ? 'none' : ''
  }
  return (
    <div
      aria-hidden
      className={cn('flex h-5 shrink-0 touch-none items-center justify-center', enabled && 'cursor-grab active:cursor-grabbing')}
      onPointerDown={(e) => {
        if (!enabled) return
        start.current = { y: e.clientY, t: Date.now() }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        setOffset(Math.max(0, e.clientY - start.current.y))
      }}
      onPointerUp={(e) => {
        if (!start.current) return
        const dy = e.clientY - start.current.y
        const v = dy / Math.max(1, Date.now() - start.current.t)
        start.current = null
        if (dy > 100 || v > 0.6) onDismiss()
        else {
          const el = panelRef.current
          if (el) {
            el.style.transition = 'translate var(--dur-2) var(--ease-settle)'
            el.style.translate = ''
          }
        }
      }}
      onPointerCancel={() => {
        start.current = null
        setOffset(0)
      }}
    >
      <span className="h-1 w-9 rounded-full bg-line-strong" />
    </div>
  )
}
