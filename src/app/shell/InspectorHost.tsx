import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Portal, useLayer, useOverlayFocus, useReducedMotion, useScrollLock } from '@/ui'
import { cn } from '@/lib/cn'
import { Inspector } from '../inspector/Inspector'
import { INSPECTOR_MAX, INSPECTOR_MIN, useShellStore } from './store'
import { useShellLayout } from './context'
import { ResizeHandle } from './ResizeHandle'

const EASE_STANDARD = [0.2, 0, 0, 1] as const
const EASE_SETTLE = [0.22, 1, 0.36, 1] as const

/** Docked Inspector: an inset screen beside the stage; its width animates at --dur-3 (§8.2). */
export function DockedInspector() {
  const { docking, inspectorWidth, metrics } = useShellLayout()
  const setWidth = useShellStore((s) => s.setInspectorWidth)
  const reduced = useReducedMotion()
  const [dragging, setDragging] = useState(false)
  const open = docking.inspector === 'docked'
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="docked-inspector"
          initial={reduced ? { opacity: 0, width: inspectorWidth + metrics.bezel } : { width: 0, opacity: 0 }}
          animate={{ width: inspectorWidth + metrics.bezel, opacity: 1 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { width: 0, opacity: 0, transition: { duration: 0.24, ease: EASE_STANDARD } }}
          transition={{ duration: reduced || dragging ? (dragging ? 0 : 0.12) : 0.24, ease: EASE_STANDARD }}
          className="relative flex h-full shrink-0 overflow-hidden"
          style={{ paddingLeft: metrics.bezel }}
        >
          <aside
            data-region="inspector"
            aria-label="Inspector"
            className="relative h-full shrink-0 overflow-hidden rounded-md border border-line bg-canvas"
            style={{ width: inspectorWidth }}
          >
            <ResizeHandle
              edge="left"
              width={inspectorWidth}
              min={INSPECTOR_MIN}
              max={INSPECTOR_MAX}
              onResize={setWidth}
              onReset={() => setWidth(metrics.inspectorDefault)}
              onDragChange={setDragging}
              label="Resize the Inspector"
            />
            <Inspector />
          </aside>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Floating Inspector (laptops, or when docking would squeeze the stage under 640px): e2, no scrim. */
export function FloatingInspector() {
  const { docking, inspectorWidth, metrics } = useShellLayout()
  const setWidth = useShellStore((s) => s.setInspectorWidth)
  const reduced = useReducedMotion()
  const open = docking.inspector === 'floating'
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="floating-inspector"
          data-region="inspector"
          aria-label="Inspector"
          initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: 24, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
          transition={{ duration: reduced ? 0.12 : 0.24, ease: EASE_SETTLE }}
          className="absolute z-(--z-panel) overflow-hidden rounded-md border border-line bg-overlay shadow-e2"
          style={{ top: metrics.bezel, bottom: metrics.bezel, right: metrics.bezel, width: inspectorWidth }}
        >
          <ResizeHandle
            edge="left"
            width={inspectorWidth}
            min={INSPECTOR_MIN}
            max={INSPECTOR_MAX}
            onResize={setWidth}
            onReset={() => setWidth(metrics.inspectorDefault)}
            label="Resize the Inspector"
          />
          <Inspector />
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

/** Tablet: an overlay sheet (380px) over the workspace with a light 16% scrim (§3.12). */
export function SheetInspector() {
  const { docking, workspace } = useShellLayout()
  const setInspector = useShellStore((s) => s.setInspector)
  const open = docking.inspector === 'sheet'
  const panelRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const close = useCallback(() => setInspector(workspace.id, { open: false }), [setInspector, workspace.id])
  const layerId = useLayer({ open, modal: true, inside: [panelRef], onEscape: close, onOutside: close })
  // Focus lands on the sheet itself (no focus ring flashing on the first tab); Tab moves in from there.
  useOverlayFocus({ open, container: panelRef, initialFocus: panelRef, trap: true, layerId })
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="inspector-scrim"
            aria-hidden
            className="absolute inset-0 z-(--z-panel) bg-scrim/32"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.24 }}
          />
          <motion.aside
            key="inspector-sheet"
            ref={panelRef}
            data-region="inspector"
            data-layer=""
            role="dialog"
            aria-modal="true"
            aria-label="Inspector"
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: 24, transition: { duration: 0.18 } }}
            transition={{ duration: reduced ? 0.12 : 0.24, ease: EASE_SETTLE }}
            className="absolute inset-y-0 right-0 z-(--z-panel) w-[380px] max-w-full overflow-hidden border-l border-line bg-overlay shadow-e2 outline-none"
          >
            <Inspector onClose={close} />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

const SNAP = { half: 0.5, full: 0.92 } as const

/** Phone: a bottom sheet snapping at 50% and 92% of the viewport; drag the handle down to close. */
export function BottomSheetInspector() {
  const { docking, workspace } = useShellLayout()
  const setInspector = useShellStore((s) => s.setInspector)
  const open = docking.inspector === 'bottom'
  const panelRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const [snap, setSnap] = useState<keyof typeof SNAP>('half')
  const [drag, setDrag] = useState(0)
  const start = useRef<{ y: number; t: number } | null>(null)
  const close = useCallback(() => {
    setInspector(workspace.id, { open: false })
    setSnap('half')
  }, [setInspector, workspace.id])
  const layerId = useLayer({ open, modal: true, inside: [panelRef], onEscape: close, onOutside: close })
  useOverlayFocus({ open, container: panelRef, initialFocus: panelRef, trap: true, layerId })
  useScrollLock(open)

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    start.current = { y: e.clientY, t: Date.now() }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (start.current) setDrag(e.clientY - start.current.y)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dy = e.clientY - start.current.y
    const v = dy / Math.max(1, Date.now() - start.current.t)
    start.current = null
    setDrag(0)
    if (Math.abs(dy) < 6) {
      setSnap((s) => (s === 'half' ? 'full' : 'half'))
      return
    }
    if (dy < -40 || v < -0.5) setSnap('full')
    else if (dy > 40 || v > 0.5) {
      if (snap === 'full') setSnap('half')
      else close()
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <motion.div
            key="bs-scrim"
            aria-hidden
            className="fixed inset-0 z-(--z-overlay) bg-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.24 }}
          />
          <motion.aside
            key="bs-panel"
            ref={panelRef}
            data-region="inspector"
            data-layer=""
            role="dialog"
            aria-modal="true"
            aria-label="Inspector"
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { y: '100%' }}
            animate={reduced ? { opacity: 1 } : { y: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { y: '100%', transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
            transition={{ duration: reduced ? 0.12 : 0.28, ease: EASE_SETTLE }}
            className={cn(
              'fixed inset-x-0 bottom-0 z-(--z-overlay) flex flex-col overflow-hidden rounded-t-xl border border-b-0 border-line bg-overlay shadow-e2 outline-none',
              'pb-[env(safe-area-inset-bottom)]',
              !drag && 'transition-[height] duration-(--dur-3) ease-standard',
            )}
            style={{ height: `calc(${SNAP[snap] * 100}dvh - ${drag}px)` }}
          >
            <div
              className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => {
                start.current = null
                setDrag(0)
              }}
            >
              <button
                type="button"
                aria-label={snap === 'half' ? 'Expand the Inspector' : 'Shrink the Inspector'}
                onClick={() => setSnap((s) => (s === 'half' ? 'full' : 'half'))}
                className="h-1 w-10 rounded-full bg-line-strong"
              />
            </div>
            <div className="min-h-0 flex-1">
              <Inspector onClose={close} />
            </div>
          </motion.aside>
        </Portal>
      )}
    </AnimatePresence>
  )
}
