import { createContext, useContext, useEffect, useRef } from 'react'
import type { WorkspaceManifest } from '../types'
import { getManifest } from '../registry'
import { shellMetrics, type DockingResult, type FormFactor, type ShellMetrics } from './layout'

/**
 * What the shell decided about geometry for the current workspace. Templates read it to place the
 * list pane (docked, collapsed, drawer or push stack) and to know whether the Inspector is docked.
 */
export interface ShellLayout {
  formFactor: FormFactor
  metrics: ShellMetrics
  workspace: WorkspaceManifest
  docking: DockingResult
  /** Effective widths (the wide range uses larger defaults until the user resizes). */
  listWidth: number
  inspectorWidth: number
  /** Tablet drawer state. */
  listDrawerOpen: boolean
  /** Templates call this while they render a list pane (returns the unregister function). */
  registerListPane: () => () => void
  toggleListPane: () => void
  setListPaneOpen: (open: boolean) => void
  setListPaneWidth: (w: number) => void
  resetListPaneWidth: () => void
  inspectorOpen: boolean
  toggleInspector: () => void
}

const noop = () => {}

/** Outside the shell (gallery, tests): a desktop layout with no Inspector. */
const FALLBACK: ShellLayout = {
  formFactor: 'large',
  metrics: shellMetrics('large'),
  workspace: getManifest('home'),
  docking: { inspector: 'closed', list: 'docked', listAutoCollapsed: false, stageWidth: 960 },
  listWidth: 280,
  inspectorWidth: 360,
  listDrawerOpen: false,
  registerListPane: () => noop,
  toggleListPane: noop,
  setListPaneOpen: noop,
  setListPaneWidth: noop,
  resetListPaneWidth: noop,
  inspectorOpen: false,
  toggleInspector: noop,
}

export const ShellLayoutContext = createContext<ShellLayout>(FALLBACK)

export function useShellLayout(): ShellLayout {
  return useContext(ShellLayoutContext)
}

/** Register a list pane with the shell for as long as the calling component is mounted. */
export function useRegisterListPane(enabled = true): void {
  const { registerListPane } = useShellLayout()
  const ref = useRef(registerListPane)
  ref.current = registerListPane
  useEffect(() => {
    if (!enabled) return
    return ref.current()
  }, [enabled])
}
