/**
 * Shell geometry (docs/DESIGN.md §3.1, §3.4 docking rule, §3.12 responsive behavior).
 * Pure functions: the Shell measures, these decide. Unit-tested in layout.test.ts.
 */
import {
  INSPECTOR_DEFAULT,
  INSPECTOR_WIDE_DEFAULT,
  LIST_PANE_DEFAULT,
  LIST_PANE_WIDE_DEFAULT,
} from './store'

/** phone <768 · tablet 768–1023 · laptop 1024–1279 · desktop 1280–1439 · large 1440–1919 · wide ≥1920. */
export type FormFactor = 'phone' | 'tablet' | 'laptop' | 'desktop' | 'large' | 'wide'

export function formFactorFor(width: number): FormFactor {
  if (width < 768) return 'phone'
  if (width < 1024) return 'tablet'
  if (width < 1280) return 'laptop'
  if (width < 1440) return 'desktop'
  if (width < 1920) return 'large'
  return 'wide'
}

export interface ShellMetrics {
  /** Rail width in px (0 on phones). */
  rail: number
  /** Labeled rail (icon over label) vs compact icon-only rail. */
  railLabeled: boolean
  /** Inset between chrome and screens (0 below 1024: screens sit flush). */
  bezel: number
  /** Run pills shown before the +N pill (0 on phones: no Run Line). */
  pills: number
  /** Default list pane / Inspector widths for this range. */
  listDefault: number
  inspectorDefault: number
  /** The command field is a full field (≥1024) or a 32px icon button. */
  commandField: boolean
  /** The "Holding" label next to the count (≥1440). */
  wideLabels: boolean
}

export function shellMetrics(ff: FormFactor): ShellMetrics {
  const wide = ff === 'wide'
  return {
    rail: ff === 'phone' ? 0 : ff === 'tablet' || ff === 'laptop' ? 56 : 72,
    railLabeled: ff === 'desktop' || ff === 'large' || ff === 'wide',
    bezel: ff === 'phone' || ff === 'tablet' ? 0 : 6,
    pills: ff === 'phone' ? 0 : ff === 'tablet' || ff === 'laptop' ? 3 : ff === 'desktop' ? 4 : 5,
    listDefault: wide ? LIST_PANE_WIDE_DEFAULT : LIST_PANE_DEFAULT,
    inspectorDefault: wide ? INSPECTOR_WIDE_DEFAULT : INSPECTOR_DEFAULT,
    commandField: ff !== 'phone' && ff !== 'tablet',
    wideLabels: ff === 'large' || ff === 'wide',
  }
}

/** A stored width equal to the base default follows the wide default at ≥1920 (until resized). */
export function effectiveWidth(stored: number, baseDefault: number, rangeDefault: number): number {
  return stored === baseDefault ? rangeDefault : stored
}

export const STAGE_MIN = 640

export type InspectorMode =
  /** Docked beside the stage (an inset screen). */
  | 'docked'
  /** Floats over the stage (shadow e2, no scrim at ≥1024). */
  | 'floating'
  /** Tablet: overlay sheet 380px with a 16% scrim. */
  | 'sheet'
  /** Phone: bottom sheet snapping at 50% and 92%. */
  | 'bottom'
  | 'closed'

export type ListPaneMode =
  /** Docked column at the left of the workspace screen. */
  | 'docked'
  /** Hidden (by the user, or auto-collapsed by the docking rule). */
  | 'collapsed'
  /** Tablet: overlay drawer (300px, 16% scrim), open or closed via `drawerOpen`. */
  | 'drawer'
  /** Phone: single-pane push navigation (list or stage fills the screen). */
  | 'stack'
  /** The workspace renders no list pane. */
  | 'none'

export interface DockingInput {
  formFactor: FormFactor
  /** Width available to the workspace screen + Inspector (inside the bezel), px. */
  areaWidth: number
  inspectorOpen: boolean
  inspectorWidth: number
  /** The current workspace renders a list pane. */
  listPresent: boolean
  /** The user's open state for the list pane. */
  listOpen: boolean
  listWidth: number
  bezel: number
  /** The user asked for the list while the rule had collapsed it: keep it docked, float the Inspector. */
  listForced?: boolean
}

export interface DockingResult {
  inspector: InspectorMode
  list: ListPaneMode
  /** True when the docking rule collapsed the list pane to make room for the Inspector. */
  listAutoCollapsed: boolean
  /** Width left for the stage, px (approximate before the first measurement). */
  stageWidth: number
}

/**
 * The docking rule (§3.4), applied within the responsive ranges (§3.12):
 * 1. Dock the Inspector if the stage stays ≥640px.
 * 2. If not, auto-collapse the list pane first.
 * 3. If it still does not fit, the Inspector floats over the stage (no scrim at ≥1024).
 * Laptops (1024–1279) always float the Inspector; tablets and phones use overlays.
 */
export function computeDocking(input: DockingInput): DockingResult {
  const { formFactor: ff, areaWidth, inspectorOpen, inspectorWidth, listPresent, listOpen, listWidth, bezel } = input
  if (ff === 'phone') {
    return { inspector: inspectorOpen ? 'bottom' : 'closed', list: listPresent ? 'stack' : 'none', listAutoCollapsed: false, stageWidth: areaWidth }
  }
  if (ff === 'tablet') {
    return { inspector: inspectorOpen ? 'sheet' : 'closed', list: listPresent ? 'drawer' : 'none', listAutoCollapsed: false, stageWidth: areaWidth }
  }
  const userList: ListPaneMode = listPresent ? (listOpen ? 'docked' : 'collapsed') : 'none'
  const listSpace = userList === 'docked' ? listWidth : 0
  if (!inspectorOpen) {
    return { inspector: 'closed', list: userList, listAutoCollapsed: false, stageWidth: areaWidth - listSpace }
  }
  if (ff === 'laptop') {
    return { inspector: 'floating', list: userList, listAutoCollapsed: false, stageWidth: areaWidth - listSpace }
  }
  const dockedSpace = inspectorWidth + bezel
  const withList = areaWidth - listSpace - dockedSpace
  if (withList >= STAGE_MIN) {
    return { inspector: 'docked', list: userList, listAutoCollapsed: false, stageWidth: withList }
  }
  if (userList === 'docked' && !input.listForced) {
    const withoutList = areaWidth - dockedSpace
    if (withoutList >= STAGE_MIN) {
      return { inspector: 'docked', list: 'collapsed', listAutoCollapsed: true, stageWidth: withoutList }
    }
  }
  return { inspector: 'floating', list: userList, listAutoCollapsed: false, stageWidth: areaWidth - listSpace }
}
