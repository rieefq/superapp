import { describe, expect, it } from 'vitest'
import { availableSpace, computePosition, parsePlacement, pointRect, type Rect } from './positioning'

const VIEWPORT = { width: 1000, height: 800 }
const MENU = { width: 200, height: 300 }
const anchorAt = (x: number, y: number, width = 100, height = 32): Rect => ({ x, y, width, height })

describe('parsePlacement', () => {
  it('defaults the alignment to center', () => {
    expect(parsePlacement('top')).toEqual({ side: 'top', align: 'center' })
    expect(parsePlacement('bottom-start')).toEqual({ side: 'bottom', align: 'start' })
    expect(parsePlacement('left-end')).toEqual({ side: 'left', align: 'end' })
  })
})

describe('computePosition — placement', () => {
  it('places bottom-start below the anchor, left edges aligned, offset applied', () => {
    const r = computePosition(anchorAt(100, 100), MENU, VIEWPORT, { placement: 'bottom-start', offset: 6 })
    expect(r).toMatchObject({ x: 100, y: 138, side: 'bottom', placement: 'bottom-start' })
  })

  it('aligns center and end on the cross axis', () => {
    const center = computePosition(anchorAt(400, 100), MENU, VIEWPORT, { placement: 'bottom', offset: 0 })
    expect(center.x).toBe(400 + 50 - 100)
    const end = computePosition(anchorAt(400, 100), MENU, VIEWPORT, { placement: 'bottom-end', offset: 0 })
    expect(end.x).toBe(500 - 200)
  })

  it('places top above the anchor', () => {
    const r = computePosition(anchorAt(100, 500), MENU, VIEWPORT, { placement: 'top-start', offset: 4 })
    expect(r).toMatchObject({ side: 'top', y: 500 - 4 - 300, x: 100 })
  })

  it('places left/right beside the anchor with vertical alignment', () => {
    const right = computePosition(anchorAt(100, 100), MENU, VIEWPORT, { placement: 'right-start', offset: 8 })
    expect(right).toMatchObject({ side: 'right', x: 208, y: 100 })
    const left = computePosition(anchorAt(500, 300), MENU, VIEWPORT, { placement: 'left-end', offset: 8 })
    expect(left).toMatchObject({ side: 'left', x: 500 - 8 - 200, y: 332 - 300 })
  })
})

describe('computePosition — flip', () => {
  it('flips bottom → top when there is no room below but room above', () => {
    const r = computePosition(anchorAt(100, 700), MENU, VIEWPORT, { placement: 'bottom-start', offset: 6 })
    expect(r.side).toBe('top')
    expect(r.placement).toBe('top-start')
    expect(r.y).toBe(700 - 6 - 300)
  })

  it('flips top → bottom when there is no room above', () => {
    const r = computePosition(anchorAt(100, 20), MENU, VIEWPORT, { placement: 'top', offset: 6 })
    expect(r.side).toBe('bottom')
    expect(r.y).toBe(20 + 32 + 6)
  })

  it('flips right → left near the right edge (context menus)', () => {
    const r = computePosition(pointRect(950, 200), MENU, VIEWPORT, { placement: 'right-start', offset: 2 })
    expect(r.side).toBe('left')
    expect(r.x).toBe(950 - 2 - 200)
  })

  it('stays on the preferred side when neither side fits and the preferred has more room', () => {
    const tall = { width: 200, height: 900 }
    const r = computePosition(anchorAt(100, 300), tall, VIEWPORT, { placement: 'bottom-start', offset: 6, padding: 8 })
    // below: 800-332-6-8 = 454, above: 300-6-8 = 286 → keep bottom, constrained to 454
    expect(r.side).toBe('bottom')
    expect(r.maxHeight).toBe(454)
  })

  it('picks the side with more space when neither fits', () => {
    const tall = { width: 200, height: 900 }
    const r = computePosition(anchorAt(100, 600), tall, VIEWPORT, { placement: 'bottom-start', offset: 6, padding: 8 })
    expect(r.side).toBe('top')
    expect(r.maxHeight).toBe(600 - 6 - 8)
    // constrained height is used for the y position, so the box stays on screen
    expect(r.y).toBe(8)
  })

  it('does not flip when flip is disabled', () => {
    const r = computePosition(anchorAt(100, 700), MENU, VIEWPORT, { placement: 'bottom-start', flip: false })
    expect(r.side).toBe('bottom')
  })
})

describe('computePosition — shift', () => {
  it('shifts left to stay inside the right edge', () => {
    const r = computePosition(anchorAt(900, 100), MENU, VIEWPORT, { placement: 'bottom-start', padding: 8 })
    expect(r.x).toBe(1000 - 8 - 200)
  })

  it('shifts right to stay inside the left edge', () => {
    const r = computePosition(anchorAt(2, 100, 20), MENU, VIEWPORT, { placement: 'bottom', padding: 8 })
    expect(r.x).toBe(8)
  })

  it('shifts vertically for left/right placements', () => {
    const r = computePosition(anchorAt(100, 750), MENU, VIEWPORT, { placement: 'right-start', padding: 8 })
    expect(r.y).toBe(800 - 8 - 300)
  })

  it('pins to the padding when the box is wider than the viewport', () => {
    const r = computePosition(anchorAt(100, 100), { width: 1200, height: 100 }, VIEWPORT, { placement: 'bottom-start', padding: 8 })
    expect(r.x).toBe(8)
    expect(r.maxWidth).toBe(1000 - 16)
  })

  it('does not shift when shift is disabled', () => {
    const r = computePosition(anchorAt(900, 100), MENU, VIEWPORT, { placement: 'bottom-start', shift: false })
    expect(r.x).toBe(900)
  })

  it('applies crossOffset before shifting', () => {
    const r = computePosition(anchorAt(100, 100), MENU, VIEWPORT, { placement: 'bottom-start', crossOffset: 12 })
    expect(r.x).toBe(112)
  })
})

describe('computePosition — metadata', () => {
  it('reports available space and a transform origin pointing at the anchor', () => {
    const r = computePosition(anchorAt(100, 100), MENU, VIEWPORT, { placement: 'bottom-start', offset: 6, padding: 8 })
    expect(r.maxHeight).toBe(800 - 132 - 6 - 8)
    expect(r.transformOrigin).toBe('50px top')
    const top = computePosition(anchorAt(100, 700), MENU, VIEWPORT, { placement: 'bottom-start' })
    expect(top.transformOrigin.endsWith('bottom')).toBe(true)
  })

  it('flags an anchor scrolled out of the viewport', () => {
    expect(computePosition(anchorAt(100, -100), MENU, VIEWPORT).anchorHidden).toBe(true)
    expect(computePosition(anchorAt(100, 100), MENU, VIEWPORT).anchorHidden).toBe(false)
  })

  it('computes free space per side', () => {
    expect(availableSpace(anchorAt(100, 100), VIEWPORT, 0, 0)).toEqual({ top: 100, bottom: 668, left: 100, right: 800 })
  })
})
