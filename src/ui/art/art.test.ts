import { describe, expect, it } from 'vitest'
import { mix, parseColor, toHex } from './color'
import { ART_STYLES, buildArt, canvasSize, normalizeStyle, toSvgString } from './generate'
import { exportArtSvg } from './export'
import { parseAspect } from './ProceduralArt'

const PALETTE = ['#1d3557', '#457b9d', '#a8dadc', '#f1faee', '#e63946']

describe('color', () => {
  it('parses hex, rgb, hsl and oklch', () => {
    expect(toHex(parseColor('#e63946')!)).toBe('#e63946')
    expect(toHex(parseColor('#abc')!)).toBe('#aabbcc')
    expect(toHex(parseColor('rgb(230, 57, 70)')!)).toBe('#e63946')
    expect(toHex(parseColor('rgb(230 57 70 / 50%)')!)).toBe('#e63946')
    expect(toHex(parseColor('hsl(0 100% 50%)')!)).toBe('#ff0000')
    expect(parseColor('oklch(0.7 0.1 200)')).not.toBeNull()
    expect(parseColor('var(--hue-sky)')).toBeNull()
    expect(parseColor('nonsense')).toBeNull()
  })
  it('mixes perceptually between endpoints', () => {
    const a = parseColor('#000000')!
    const b = parseColor('#ffffff')!
    expect(toHex(mix(a, b, 0))).toBe('#000000')
    expect(toHex(mix(a, b, 1))).toBe('#ffffff')
  })
})

describe('generator', () => {
  it('is deterministic per seed, style and aspect', () => {
    for (const style of ART_STYLES) {
      const a = toSvgString(buildArt({ seed: 42, palette: PALETTE, style }, 1, 'x'))
      const b = toSvgString(buildArt({ seed: 42, palette: PALETTE, style }, 1, 'x'))
      expect(a).toBe(b)
    }
  })
  it('varies with the seed', () => {
    for (const style of ART_STYLES) {
      const a = toSvgString(buildArt({ seed: 1, palette: PALETTE, style }, 1, 'x'))
      const b = toSvgString(buildArt({ seed: 2, palette: PALETTE, style }, 1, 'x'))
      expect(a).not.toBe(b)
    }
  })
  it('re-flows to the aspect ratio instead of stretching', () => {
    expect(canvasSize(16 / 9)).toEqual({ W: 1778, H: 1000 })
    expect(canvasSize(4 / 5)).toEqual({ W: 1000, H: 1250 })
    const wide = buildArt({ seed: 7, palette: PALETTE, style: 'abstract' }, 16 / 9, 'x')
    expect(wide.attrs.viewBox).toBe('0 0 1778 1000')
  })
  it('prefixes every id so instances never collide', () => {
    const svg = toSvgString(buildArt({ seed: 9, palette: PALETTE, style: 'photographic' }, 1, ':r3:'))
    const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(3)
    for (const id of ids) expect(id.startsWith('r3-')).toBe(true)
    for (const ref of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1])
  })
  it('survives empty or unparseable palettes', () => {
    for (const style of ART_STYLES) {
      const svg = toSvgString(buildArt({ seed: 3, palette: [], style }, 1.5, 'x'))
      expect(svg).toContain('<svg')
      expect(svg).not.toContain('NaN')
      const svg2 = toSvgString(buildArt({ seed: 3, palette: ['var(--x)', 'red'], style }, 0.6, 'x'))
      expect(svg2).not.toContain('NaN')
    }
  })
  it('maps loose style names', () => {
    expect(normalizeStyle('Cinematic photo')).toBe('photographic')
    expect(normalizeStyle('flat illustration')).toBe('illustration')
    expect(normalizeStyle('3D render')).toBe('3d')
    expect(normalizeStyle('poster')).toBe('editorial')
    expect(normalizeStyle('whatever')).toBe('abstract')
  })
})

describe('export', () => {
  it('produces standalone SVG with explicit pixel size', () => {
    const svg = exportArtSvg({ seed: 11, palette: PALETTE, style: 'editorial' }, 1200, 800)
    expect(svg.startsWith('<?xml')).toBe(true)
    expect(svg).toContain('width="1200"')
    expect(svg).toContain('height="800"')
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(svg).not.toContain('var(--')
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
  })
})

describe('parseAspect', () => {
  it('reads ratios in several notations', () => {
    expect(parseAspect('16/9')).toBeCloseTo(16 / 9)
    expect(parseAspect('4:5')).toBeCloseTo(0.8)
    expect(parseAspect(1.5)).toBe(1.5)
    expect(parseAspect('2')).toBe(2)
    expect(parseAspect('nope')).toBeUndefined()
  })
})
