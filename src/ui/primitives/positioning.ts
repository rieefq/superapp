/**
 * Floating-element positioning (menus, popovers, tooltips, listboxes) — pure geometry, no DOM.
 *
 * Coordinates are viewport (client) pixels, suited to `position: fixed`. Steps:
 *   1. place on the requested side + alignment, `offset` px away from the anchor
 *   2. flip to the opposite side when the floating box does not fit but fits (or fits better) there
 *   3. shift along the cross axis so the box stays `padding` px inside the viewport
 *   4. report the space available on the resolved side (`maxHeight`/`maxWidth`) so long lists can scroll
 */

export type Side = 'top' | 'bottom' | 'left' | 'right'
export type Align = 'start' | 'center' | 'end'
export type Placement = Side | `${Side}-start` | `${Side}-end`

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface PositionOptions {
  /** Preferred placement. Default 'bottom-start'. */
  placement?: Placement
  /** Gap between anchor and floating box on the main axis. Default 6. */
  offset?: number
  /** Nudge along the cross axis. Default 0. */
  crossOffset?: number
  /** Minimum distance from the viewport edges. Default 8. */
  padding?: number
  /** Flip to the opposite side when there is not enough room. Default true. */
  flip?: boolean
  /** Slide along the cross axis to stay inside the viewport. Default true. */
  shift?: boolean
  /**
   * The floating box will be constrained to the available space (max-height / max-width), so place it using
   * the constrained size. Default true.
   */
  constrain?: boolean
}

export interface PositionResult {
  x: number
  y: number
  placement: Placement
  side: Side
  align: Align
  /** Space available on the resolved side's main axis (for top/bottom: height). */
  maxHeight: number
  maxWidth: number
  /** CSS transform-origin pointing at the anchor — for scale-in animations. */
  transformOrigin: string
  /** True when the anchor is completely outside the viewport (hide or close the floating box). */
  anchorHidden: boolean
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }

export function parsePlacement(placement: Placement): { side: Side; align: Align } {
  const [side, align] = placement.split('-') as [Side, Align | undefined]
  return { side, align: align ?? 'center' }
}

export function toPlacement(side: Side, align: Align): Placement {
  return align === 'center' ? side : (`${side}-${align}` as Placement)
}

/** Free space between the anchor and the viewport edge on each side (after offset and padding). */
export function availableSpace(anchor: Rect, viewport: Size, offset: number, padding: number): Record<Side, number> {
  return {
    top: anchor.y - offset - padding,
    bottom: viewport.height - (anchor.y + anchor.height) - offset - padding,
    left: anchor.x - offset - padding,
    right: viewport.width - (anchor.x + anchor.width) - offset - padding,
  }
}

const isVertical = (side: Side) => side === 'top' || side === 'bottom'

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

function crossStart(anchorStart: number, anchorSize: number, floatingSize: number, align: Align): number {
  if (align === 'start') return anchorStart
  if (align === 'end') return anchorStart + anchorSize - floatingSize
  return anchorStart + anchorSize / 2 - floatingSize / 2
}

export function computePosition(anchor: Rect, floating: Size, viewport: Size, options: PositionOptions = {}): PositionResult {
  const {
    placement = 'bottom-start',
    offset = 6,
    crossOffset = 0,
    padding = 8,
    flip = true,
    shift = true,
    constrain = true,
  } = options
  const { side: preferred, align } = parsePlacement(placement)
  const space = availableSpace(anchor, viewport, offset, padding)
  const need = (s: Side) => (isVertical(s) ? floating.height : floating.width)

  let side = preferred
  if (flip && need(preferred) > space[preferred]) {
    const opposite = OPPOSITE[preferred]
    if (need(opposite) <= space[opposite] || space[opposite] > space[preferred]) side = opposite
  }

  const vertical = isVertical(side)
  const mainSpace = Math.max(0, space[side])
  const crossViewport = vertical ? viewport.width : viewport.height
  const maxCross = Math.max(0, crossViewport - padding * 2)

  // Size actually rendered once max-height/max-width are applied.
  const height = vertical && constrain ? Math.min(floating.height, mainSpace) : floating.height
  const width = !vertical && constrain ? Math.min(floating.width, mainSpace) : floating.width

  let x: number
  let y: number
  if (vertical) {
    y = side === 'bottom' ? anchor.y + anchor.height + offset : anchor.y - offset - height
    x = crossStart(anchor.x, anchor.width, width, align) + crossOffset
    if (shift) x = clamp(x, padding, viewport.width - padding - width)
  } else {
    x = side === 'right' ? anchor.x + anchor.width + offset : anchor.x - offset - width
    y = crossStart(anchor.y, anchor.height, height, align) + crossOffset
    if (shift) y = clamp(y, padding, viewport.height - padding - height)
  }

  const originCross = (() => {
    // Point the origin at the anchor's centre along the cross axis (relative to the floating box).
    if (vertical) {
      const cx = anchor.x + anchor.width / 2 - x
      return `${Math.round(clamp(cx, 0, width))}px`
    }
    const cy = anchor.y + anchor.height / 2 - y
    return `${Math.round(clamp(cy, 0, height))}px`
  })()
  const transformOrigin =
    side === 'bottom' ? `${originCross} top` : side === 'top' ? `${originCross} bottom` : side === 'right' ? `left ${originCross}` : `right ${originCross}`

  const anchorHidden =
    anchor.y + anchor.height < 0 || anchor.y > viewport.height || anchor.x + anchor.width < 0 || anchor.x > viewport.width

  return {
    x: Math.round(x),
    y: Math.round(y),
    placement: toPlacement(side, align),
    side,
    align,
    maxHeight: vertical ? Math.floor(mainSpace) : Math.floor(viewport.height - padding * 2),
    maxWidth: vertical ? Math.floor(maxCross) : Math.floor(mainSpace),
    transformOrigin,
    anchorHidden,
  }
}

/** A zero-size anchor at a point (context menus, cursors). */
export function pointRect(x: number, y: number): Rect {
  return { x, y, width: 0, height: 0 }
}

/** DOMRect → Rect. */
export function toRect(r: { left: number; top: number; width: number; height: number }): Rect {
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}
