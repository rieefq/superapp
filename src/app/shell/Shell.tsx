import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { StartSheetHost } from '@/app/components/start'
import { EntityCardProvider } from '@/ui'
import { cn } from '@/lib/cn'
import { workspaceForPath } from '../registry'
import { useInspectParamSync } from '../inspector/inspect'
import { computeDocking, effectiveWidth, formFactorFor, shellMetrics } from './layout'
import { ShellLayoutContext, type ShellLayout } from './context'
import { INSPECTOR_DEFAULT, LIST_PANE_DEFAULT, useShellStore } from './store'
import { useViewportWidth } from './overlays'
import { PhoneTopBar, TopBar } from './TopBar'
import { Rail } from './Rail'
import { RunLine } from './RunLine'
import { BottomSheetInspector, DockedInspector, FloatingInspector, SheetInspector } from './InspectorHost'
import { useRunTransitions } from './runTracker'
import { SigStyles } from './sig'
import { LiveStrip, PhoneBottomBar, MoreSheet } from './PhoneBars'
import { CommandCenter } from '../commands/CommandCenter'
import { ShortcutSheet } from './ShortcutSheet'
import { WhatsRealDialog } from './WhatsReal'
import { ShellShortcuts } from './ShellShortcuts'
import { ToastRouter } from './ToastRouter'
import { TabPresence } from './TabPresence'
import { Announcer } from './Announcer'
import { renderLensCard } from './lensCards'

/**
 * The global shell (§3): a fixed frame of chrome — top bar, rail, Run Line — around inset screens
 * (the workspace screen and the Inspector). Geometry never rearranges itself; scope and selection
 * change content, not layout. Below 1024px the screens sit flush; on phones the frame becomes a top
 * bar, a live strip, a single pane and a bottom tab bar.
 */
export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const workspace = workspaceForPath(location.pathname)
  const viewport = useViewportWidth()
  const formFactor = formFactorFor(viewport)
  const metrics = shellMetrics(formFactor)

  const inspectorState = useShellStore((s) => s.inspector[workspace.id])
  const inspectorOpen = inspectorState?.open ?? workspace.inspectorDefaultOpen ?? false
  const listOpen = useShellStore((s) => s.listPane[workspace.id]?.open ?? true)
  const storedInspectorWidth = useShellStore((s) => s.inspectorWidth)
  const storedListWidth = useShellStore((s) => s.listPaneWidth)
  const listDrawerOpen = useShellStore((s) => s.listDrawerOpen)
  const inspectorWidth = effectiveWidth(storedInspectorWidth, INSPECTOR_DEFAULT, metrics.inspectorDefault)
  const listWidth = effectiveWidth(storedListWidth, LIST_PANE_DEFAULT, metrics.listDefault)

  // Asking for the list while the docking rule collapsed it keeps the list and floats the Inspector instead.
  const [listForced, setListForced] = useState(false)
  useEffect(() => setListForced(false), [workspace.id, inspectorOpen])

  // Templates register their list pane so the docking rule knows whether one is present.
  const [listPanes, setListPanes] = useState(0)
  const registerListPane = useCallback(() => {
    setListPanes((n) => n + 1)
    return () => setListPanes((n) => Math.max(0, n - 1))
  }, [])

  // The width available to the screens (inside the bezel).
  const areaRef = useRef<HTMLDivElement>(null)
  const [areaWidth, setAreaWidth] = useState(() => Math.max(0, viewport - metrics.rail - 2 * metrics.bezel))
  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const measure = () => setAreaWidth(Math.max(0, el.clientWidth - 2 * metrics.bezel))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [metrics.bezel])

  const docking = computeDocking({
    formFactor,
    areaWidth,
    inspectorOpen,
    inspectorWidth,
    listPresent: listPanes > 0,
    listOpen,
    listWidth,
    bezel: metrics.bezel,
    listForced,
  })

  // Overlay Inspectors never reopen by themselves on load below the docking range (§3.5).
  const startedSmall = useRef(viewport < 1024)
  useEffect(() => {
    if (startedSmall.current) useShellStore.getState().closeAllInspectors()
  }, [])

  // Navigating closes the tablet list drawer and the phone More sheet.
  useEffect(() => {
    const st = useShellStore.getState()
    st.setListDrawerOpen(false)
    st.setMoreOpen(false)
  }, [location.pathname])

  // Toasts sit 16px above the Run Line — or above the bottom bar on phones (§3.8).
  useEffect(() => {
    const root = document.documentElement
    if (formFactor === 'phone') root.style.setProperty('--runline-h', 'calc(56px + env(safe-area-inset-bottom))')
    else root.style.removeProperty('--runline-h')
  }, [formFactor])

  useRunTransitions()
  useInspectParamSync()

  const layout = useMemo<ShellLayout>(
    () => ({
      formFactor,
      metrics,
      workspace,
      docking,
      listWidth,
      inspectorWidth,
      listDrawerOpen,
      registerListPane,
      toggleListPane: () => {
        const st = useShellStore.getState()
        if (formFactor === 'tablet') st.setListDrawerOpen(!st.listDrawerOpen)
        else if (docking.listAutoCollapsed) setListForced(true)
        else {
          setListForced(false)
          st.toggleListPane(workspace.id)
        }
      },
      setListPaneOpen: (open: boolean) => {
        const st = useShellStore.getState()
        if (formFactor === 'tablet') st.setListDrawerOpen(open)
        else if (open && docking.listAutoCollapsed) setListForced(true)
        else {
          if (!open) setListForced(false)
          st.setListPane(workspace.id, open)
        }
      },
      setListPaneWidth: (w: number) => useShellStore.getState().setListPaneWidth(w),
      resetListPaneWidth: () => useShellStore.getState().setListPaneWidth(LIST_PANE_DEFAULT),
      inspectorOpen,
      toggleInspector: () => useShellStore.getState().setInspector(workspace.id, { open: !inspectorOpen }),
    }),
    // docking is derived from the inputs below; listing them keeps the object stable between renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [formFactor, workspace, docking.inspector, docking.list, docking.listAutoCollapsed, Math.round(docking.stageWidth / 8), listWidth, inspectorWidth, listDrawerOpen, registerListPane, inspectorOpen],
  )

  const phone = formFactor === 'phone'
  const flush = metrics.bezel === 0

  return (
    <ShellLayoutContext.Provider value={layout}>
      <EntityCardProvider render={renderLensCard}>
        <SigStyles />
        <div data-app-ready="true" data-form-factor={formFactor} className="flex h-dvh w-full flex-col overflow-hidden bg-chrome text-ink">
          <a
            href="#main"
            className="type-body-sm fixed top-2 left-2 z-(--z-tooltip) -translate-y-20 rounded-sm bg-inverse px-3 py-2 text-inverse-ink transition-transform focus:translate-y-0"
            onClick={(e) => {
              e.preventDefault()
              document.getElementById('main')?.focus()
            }}
          >
            Skip to main content
          </a>
          {phone ? <PhoneTopBar /> : <TopBar />}
          {phone && <LiveStrip />}
          <div className="flex min-h-0 flex-1">
            {!phone && <Rail />}
            <div ref={areaRef} className="relative flex min-h-0 min-w-0 flex-1" style={{ padding: metrics.bezel }}>
              <main
                id="main"
                tabIndex={-1}
                data-region="workspace"
                aria-label={workspace.label}
                className={cn(
                  'relative min-h-0 min-w-0 flex-1 overflow-hidden bg-canvas outline-none',
                  flush ? (phone ? '' : 'border-l border-line') : 'rounded-md border border-line',
                )}
              >
                {children}
              </main>
              {formFactor !== 'phone' && formFactor !== 'tablet' && <DockedInspector />}
              <FloatingInspector />
              <SheetInspector />
            </div>
          </div>
          {phone ? <PhoneBottomBar /> : <RunLine />}
        </div>
        <BottomSheetInspector />
        <MoreSheet />
        <CommandCenter />
        <ShortcutSheet />
        <WhatsRealDialog />
        <StartSheetHost />
        <ShellShortcuts />
        <ToastRouter />
        <TabPresence />
        <Announcer />
      </EntityCardProvider>
    </ShellLayoutContext.Provider>
  )
}
