/**
 * Overlay infrastructure shared by menus, popovers, selects, dialogs and sheets.
 *
 * - A stack of open layers: Escape and outside-presses go to the TOP layer only, so a menu inside a dialog
 *   closes before the dialog does.
 * - Focus: capture where focus was on open, move it in, trap it for modals, hand it back on close.
 * - Scroll lock for modals (reference counted, scrollbar-width compensated).
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { useLatest } from '@/ui/hooks/useLatest'

/** Elements inside this attribute never count as "outside" (e.g. the toast region). */
export const IGNORE_OUTSIDE_ATTR = 'data-layer-ignore-outside'

interface Layer {
  id: number
  modal: boolean
  contains: (node: Node) => boolean
  onEscape?: (e: KeyboardEvent) => void
  onOutside?: (e: PointerEvent) => void
}

const stack: Layer[] = []
let nextId = 1
let listening = false

function topLayer(): Layer | undefined {
  return stack[stack.length - 1]
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  const top = topLayer()
  if (!top?.onEscape) return
  e.preventDefault()
  e.stopPropagation()
  top.onEscape(e)
}

function onPointerDown(e: PointerEvent) {
  const top = topLayer()
  const target = e.target as Node | null
  if (!top || !target || !target.isConnected) return
  if (top.contains(target)) return
  if (target instanceof Element && target.closest(`[${IGNORE_OUTSIDE_ATTR}]`)) return
  top.onOutside?.(e)
}

function ensureListeners() {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('pointerdown', onPointerDown, true)
}

/** Is `node` inside any layer stacked above the layer with `id`? */
function insideLayerAbove(id: number, node: Node): boolean {
  const index = stack.findIndex((l) => l.id === id)
  return stack.slice(index + 1).some((l) => l.contains(node))
}

/** Public: is `node` inside an overlay opened on top of layer `id` (e.g. a menu inside a popover)? */
export function isInsideLayerAbove(id: number, node: Node): boolean {
  return insideLayerAbove(id, node)
}

export function isTopLayer(id: number): boolean {
  return topLayer()?.id === id
}

export function hasOpenLayers(): boolean {
  return stack.length > 0
}

type ElementSource = RefObject<Element | null> | (() => Element | null | undefined)

function resolve(source: ElementSource): Element | null | undefined {
  return typeof source === 'function' ? source() : source.current
}

export interface LayerOptions {
  open: boolean
  modal?: boolean
  /** Elements that count as inside (content, trigger/anchor). */
  inside: ElementSource[]
  onEscape?: (e: KeyboardEvent) => void
  onOutside?: (e: PointerEvent) => void
}

/** Register an open overlay on the layer stack. Returns the layer id (0 while closed). */
export function useLayer({ open, modal = false, inside, onEscape, onOutside }: LayerOptions): RefObject<number> {
  const idRef = useRef(0)
  const insideRef = useLatest(inside)
  const escapeRef = useLatest(onEscape)
  const outsideRef = useLatest(onOutside)
  useLayoutEffect(() => {
    if (!open) return
    ensureListeners()
    const layer: Layer = {
      id: nextId++,
      modal,
      contains: (node) => insideRef.current.some((s) => !!resolve(s)?.contains(node)),
      onEscape: (e) => escapeRef.current?.(e),
      onOutside: (e) => outsideRef.current?.(e),
    }
    idRef.current = layer.id
    stack.push(layer)
    return () => {
      const i = stack.indexOf(layer)
      if (i >= 0) stack.splice(i, 1)
      idRef.current = 0
    }
  }, [open, modal, insideRef, escapeRef, outsideRef])
  return idRef
}

// ---------------------------------------------------------------------------------------------- focus

const TABBABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

/** Keyboard-reachable elements inside a container, in DOM order. */
export function getTabbables(container: Element): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => {
    if (el.tabIndex < 0) return false
    if (el.hasAttribute('inert') || el.closest('[inert]')) return false
    if (el.getAttribute('aria-hidden') === 'true') return false
    return el.getClientRects().length > 0
  })
}

let tooltipsSuppressedUntil = 0

/** Tooltips stay quiet briefly after an overlay hands focus back (no tooltip flash on the trigger). */
export function suppressTooltips(ms = 400): void {
  tooltipsSuppressedUntil = Date.now() + ms
}

export function tooltipsSuppressed(): boolean {
  return Date.now() < tooltipsSuppressedUntil
}

/** Where each open overlay will return focus — lets a dialog opened from a menu item return to the menu's trigger. */
const returnTargets = new WeakMap<Element, HTMLElement | null>()

/** Record where an overlay container will return focus (for overlays that manage focus themselves). */
export function registerReturnTarget(container: Element | null, target: HTMLElement | null): void {
  if (container) returnTargets.set(container, target)
}

export function focusElement(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected) return false
  el.focus({ preventScroll: true })
  return document.activeElement === el
}

export interface FocusOptions {
  open: boolean
  container: RefObject<HTMLElement | null>
  /** Element to focus on open. Default: first [data-autofocus], else first tabbable, else the container. */
  initialFocus?: RefObject<HTMLElement | null> | false
  /** Return focus to where it was when the overlay opened. Default true. */
  restoreFocus?: boolean | RefObject<HTMLElement | null>
  /** Trap Tab inside the container (modals). */
  trap?: boolean
  /** Layer id from useLayer (focus trap yields to layers above it). */
  layerId?: RefObject<number>
}

/**
 * Focus management for overlays: move focus in on open, optionally trap it, restore on close.
 * Restoring only happens when focus is still inside the overlay (or nowhere), so it never steals focus
 * from an overlay that opened in the same moment.
 */
export function useOverlayFocus({ open, container, initialFocus, restoreFocus = true, trap = false, layerId }: FocusOptions): void {
  const initialRef = useLatest(initialFocus)
  const restoreRef = useLatest(restoreFocus)

  useEffect(() => {
    if (!open) return
    const active = document.activeElement as HTMLElement | null
    const activeLayer = active?.closest?.('[data-layer]')
    const fallback = activeLayer ? (returnTargets.get(activeLayer) ?? null) : null
    const node = container.current
    if (node) returnTargets.set(node, active)

    // Move focus in (after the frame so motion/portal content is laid out).
    const frame = requestAnimationFrame(() => {
      const el = container.current
      if (!el) return
      const init = initialRef.current
      if (init === false) return
      if (init && focusElement(init.current)) return
      const auto = el.querySelector<HTMLElement>('[data-autofocus]')
      if (auto && focusElement(auto)) return
      const first = getTabbables(el)[0]
      if (first && focusElement(first)) return
      focusElement(el)
    })

    return () => {
      cancelAnimationFrame(frame)
      const restore = restoreRef.current
      if (!restore) return
      const el = container.current
      const current = document.activeElement
      const focusIsInside = !current || current === document.body || (el ? el.contains(current) : false)
      if (!focusIsInside) return
      const explicit = typeof restore === 'object' ? restore.current : null
      const target = explicit ?? (active?.isConnected ? active : fallback)
      if (target) {
        suppressTooltips()
        focusElement(target)
      }
    }
  }, [open, container, initialRef, restoreRef])

  // Trap: keep Tab cycling inside; pull focus back if it escapes (unless into a layer stacked above).
  useEffect(() => {
    if (!open || !trap) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const el = container.current
      if (!el) return
      if (layerId && layerId.current && !isTopLayer(layerId.current)) return
      const target = e.target as Node | null
      if (target && !el.contains(target) && target !== document.body) return
      const tabbables = getTabbables(el)
      if (tabbables.length === 0) {
        e.preventDefault()
        focusElement(el)
        return
      }
      const first = tabbables[0]
      const last = tabbables[tabbables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === el || !el.contains(active))) {
        e.preventDefault()
        focusElement(last)
      } else if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault()
        focusElement(first)
      }
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = container.current
      const target = e.target as Node | null
      if (!el || !target || el.contains(target)) return
      if (layerId?.current && insideLayerAbove(layerId.current, target)) return
      if (target instanceof Element && target.closest(`[${IGNORE_OUTSIDE_ATTR}]`)) return
      if (layerId?.current && !isTopLayer(layerId.current)) return
      const first = getTabbables(el)[0]
      if (!focusElement(first)) focusElement(el)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open, trap, container, layerId])
}

// ---------------------------------------------------------------------------------------------- scroll lock

let lockCount = 0
let saved: { overflow: string; paddingRight: string } | null = null

function lockScroll() {
  if (lockCount++ > 0) return
  const html = document.documentElement
  const scrollbar = window.innerWidth - html.clientWidth
  saved = { overflow: html.style.overflow, paddingRight: document.body.style.paddingRight }
  html.style.overflow = 'hidden'
  if (scrollbar > 0) document.body.style.paddingRight = `${scrollbar}px`
}

function unlockScroll() {
  if (--lockCount > 0) return
  lockCount = 0
  if (!saved) return
  document.documentElement.style.overflow = saved.overflow
  document.body.style.paddingRight = saved.paddingRight
  saved = null
}

/** Lock page scroll while `active` (nested locks are reference counted). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    lockScroll()
    return unlockScroll
  }, [active])
}
