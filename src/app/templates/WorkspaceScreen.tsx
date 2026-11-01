import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLayer, useOverlayFocus, useReducedMotion } from '@/ui'
import { cn } from '@/lib/cn'
import { useRegisterListPane, useShellLayout } from '../shell/context'
import type { ListPaneMode } from '../shell/layout'
import { LIST_PANE_MAX, LIST_PANE_MIN } from '../shell/store'
import { ResizeHandle } from '../shell/ResizeHandle'

export interface WorkspaceScreenContextValue {
  /** The screen renders a list pane. */
  hasList: boolean
  /** Where the list pane is right now (docked · collapsed · drawer · stack · none). */
  listMode: ListPaneMode
  /** Phones: which pane fills the screen. */
  phoneView: 'list' | 'stage'
  /** The list pane is visible beside the stage. */
  listVisible: boolean
  toggleList: () => void
}

const WorkspaceScreenContext = createContext<WorkspaceScreenContextValue>({
  hasList: false,
  listMode: 'none',
  phoneView: 'stage',
  listVisible: false,
  toggleList: () => {},
})

export function useWorkspaceScreen(): WorkspaceScreenContextValue {
  return useContext(WorkspaceScreenContext)
}

export interface WorkspaceScreenProps {
  /** The list pane (usually a `<ListPane>`). Omit for templates without one (Page, Board). */
  list?: ReactNode
  /** The stage (usually a `<Stage>`). */
  children: ReactNode
  /**
   * Phones show one pane at a time (push navigation): 'list' at the workspace root, 'stage' once an
   * item is open. Default: 'list' when there is a list, else 'stage'.
   */
  phoneView?: 'list' | 'stage'
  className?: string
}

const EASE_STANDARD = [0.2, 0, 0, 1] as const

/**
 * The inside of the workspace screen: list pane | stage. Implements the list half of the docking
 * rule (§3.4) with the shell: docked (resizable 240–360, double-click resets), auto-collapsed when
 * the Inspector needs the room, an overlay drawer on tablets (300px, 16% scrim), and single-pane push
 * navigation on phones. `[` toggles the pane.
 */
export function WorkspaceScreen({ list, children, phoneView, className }: WorkspaceScreenProps) {
  const layout = useShellLayout()
  const hasList = list != null
  useRegisterListPane(hasList)
  const mode: ListPaneMode = hasList ? layout.docking.list : 'none'
  const view = phoneView ?? (hasList ? 'list' : 'stage')
  const reduced = useReducedMotion()
  const docked = mode === 'docked'
  const [dragging, setDragging] = useState(false)

  const ctx: WorkspaceScreenContextValue = {
    hasList,
    listMode: mode,
    phoneView: view,
    listVisible: docked || (mode === 'stack' && view === 'list') || (mode === 'drawer' && layout.listDrawerOpen),
    toggleList: layout.toggleListPane,
  }

  if (mode === 'stack') {
    return (
      <WorkspaceScreenContext.Provider value={ctx}>
        <div className={cn('flex h-full min-h-0 flex-col', className)}>
          {view === 'list' ? (
            <div data-region="list" aria-label="List" className="flex min-h-0 flex-1 flex-col">
              {list}
            </div>
          ) : (
            children
          )}
        </div>
      </WorkspaceScreenContext.Provider>
    )
  }

  return (
    <WorkspaceScreenContext.Provider value={ctx}>
      <div className={cn('relative flex h-full min-h-0', className)}>
        <AnimatePresence initial={false}>
          {docked && (
            <motion.div
              key="list-pane"
              initial={reduced ? { opacity: 0 } : { width: 0, opacity: 0 }}
              animate={{ width: layout.listWidth, opacity: 1 }}
              exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { width: 0, opacity: 0, transition: { duration: 0.24, ease: EASE_STANDARD } }}
              transition={{ duration: dragging ? 0 : reduced ? 0.12 : 0.24, ease: EASE_STANDARD }}
              className="relative flex h-full shrink-0 overflow-hidden border-r border-line"
            >
              <aside data-region="list" aria-label="List" className="flex h-full min-h-0 shrink-0 flex-col" style={{ width: layout.listWidth }}>
                {list}
              </aside>
              <ResizeHandle
                edge="right"
                width={layout.listWidth}
                min={LIST_PANE_MIN}
                max={LIST_PANE_MAX}
                onResize={layout.setListPaneWidth}
                onReset={layout.resetListPaneWidth}
                onDragChange={setDragging}
                label="Resize the list"
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        {mode === 'drawer' && <ListDrawer open={layout.listDrawerOpen} onClose={() => layout.setListPaneOpen(false)}>{list}</ListDrawer>}
      </div>
    </WorkspaceScreenContext.Provider>
  )
}

/** Tablet: the list pane as an overlay drawer (300px, 16% scrim) inside the screen (§3.12). */
function ListDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const close = useCallback(() => onClose(), [onClose])
  const layerId = useLayer({ open, modal: true, inside: [panelRef], onEscape: close, onOutside: close })
  useOverlayFocus({ open, container: panelRef, trap: true, layerId })
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="drawer-scrim"
            aria-hidden
            className="absolute inset-0 z-(--z-panel) bg-scrim/32"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.24 }}
          />
          <motion.aside
            key="drawer"
            ref={panelRef}
            data-region="list"
            data-layer=""
            role="dialog"
            aria-modal="true"
            aria-label="List"
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: -24, transition: { duration: 0.18 } }}
            transition={{ duration: reduced ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-y-0 left-0 z-(--z-panel) flex w-[300px] max-w-[85%] flex-col border-r border-line bg-overlay shadow-e2 outline-none"
          >
            {children}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
