import { describe, expect, it } from 'vitest'
import { computeDocking, effectiveWidth, formFactorFor, shellMetrics, STAGE_MIN, type DockingInput } from './layout'

const base = (over: Partial<DockingInput> = {}): DockingInput => ({
  formFactor: 'large',
  areaWidth: 1440 - 72 - 12,
  inspectorOpen: true,
  inspectorWidth: 360,
  listPresent: true,
  listOpen: true,
  listWidth: 280,
  bezel: 6,
  ...over,
})

describe('formFactorFor', () => {
  it('maps widths to the §3.12 ranges', () => {
    expect(formFactorFor(360)).toBe('phone')
    expect(formFactorFor(767)).toBe('phone')
    expect(formFactorFor(768)).toBe('tablet')
    expect(formFactorFor(1023)).toBe('tablet')
    expect(formFactorFor(1024)).toBe('laptop')
    expect(formFactorFor(1280)).toBe('desktop')
    expect(formFactorFor(1440)).toBe('large')
    expect(formFactorFor(1920)).toBe('wide')
    expect(formFactorFor(2560)).toBe('wide')
  })
})

describe('shellMetrics', () => {
  it('uses a labeled 72px rail from 1280, compact 56px below, none on phones', () => {
    expect(shellMetrics('desktop')).toMatchObject({ rail: 72, railLabeled: true, bezel: 6, pills: 4 })
    expect(shellMetrics('large')).toMatchObject({ rail: 72, pills: 5, wideLabels: true })
    expect(shellMetrics('laptop')).toMatchObject({ rail: 56, railLabeled: false, bezel: 6, pills: 3 })
    expect(shellMetrics('tablet')).toMatchObject({ rail: 56, bezel: 0, pills: 3, commandField: false })
    expect(shellMetrics('phone')).toMatchObject({ rail: 0, bezel: 0, pills: 0 })
  })
  it('widens the panes at ≥1920', () => {
    expect(shellMetrics('wide')).toMatchObject({ listDefault: 300, inspectorDefault: 420 })
    expect(effectiveWidth(280, 280, 300)).toBe(300)
    expect(effectiveWidth(320, 280, 300)).toBe(320)
  })
})

describe('computeDocking (§3.4)', () => {
  it('docks the Inspector beside the list when the stage keeps ≥640px', () => {
    const r = computeDocking(base())
    expect(r.inspector).toBe('docked')
    expect(r.list).toBe('docked')
    expect(r.stageWidth).toBeGreaterThanOrEqual(STAGE_MIN)
  })

  it('collapses the list pane first when the stage would drop under 640px', () => {
    const r = computeDocking(base({ formFactor: 'desktop', areaWidth: 1280 - 72 - 12 }))
    expect(r.inspector).toBe('docked')
    expect(r.list).toBe('collapsed')
    expect(r.listAutoCollapsed).toBe(true)
  })

  it('keeps a list the user asked for and floats the Inspector instead', () => {
    const r = computeDocking(base({ formFactor: 'desktop', areaWidth: 1280 - 72 - 12, listForced: true }))
    expect(r).toMatchObject({ inspector: 'floating', list: 'docked', listAutoCollapsed: false })
  })

  it('floats the Inspector when even a collapsed list leaves too little room', () => {
    const r = computeDocking(base({ formFactor: 'desktop', areaWidth: 900, inspectorWidth: 520 }))
    expect(r.inspector).toBe('floating')
    expect(r.list).toBe('docked')
  })

  it('always floats on laptops, uses overlays on tablets and phones', () => {
    expect(computeDocking(base({ formFactor: 'laptop', areaWidth: 1200 })).inspector).toBe('floating')
    expect(computeDocking(base({ formFactor: 'tablet', areaWidth: 900 }))).toMatchObject({ inspector: 'sheet', list: 'drawer' })
    expect(computeDocking(base({ formFactor: 'phone', areaWidth: 390 }))).toMatchObject({ inspector: 'bottom', list: 'stack' })
  })

  it('keeps the user’s list state when the Inspector is closed or there is no list', () => {
    expect(computeDocking(base({ inspectorOpen: false, listOpen: false }))).toMatchObject({ inspector: 'closed', list: 'collapsed' })
    expect(computeDocking(base({ listPresent: false }))).toMatchObject({ list: 'none', inspector: 'docked' })
  })
})
