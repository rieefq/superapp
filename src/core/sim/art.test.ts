import { describe, expect, it } from 'vitest'
import { colorName, describeArt, hexToRgb, luminance, paletteFromPrompt } from './art'

const avgLuminance = (palette: string[]) => palette.reduce((a, c) => a + luminance(c), 0) / palette.length

describe('paletteFromPrompt', () => {
  it('is deterministic and returns 4–5 hex colors', () => {
    for (const prompt of ['A calm harbor at dawn', 'quarterly report cover', 'Bold neon poster in magenta and cyan', '']) {
      const palette = paletteFromPrompt(prompt)
      expect(palette).toEqual(paletteFromPrompt(prompt))
      expect(palette.length).toBeGreaterThanOrEqual(4)
      expect(palette.length).toBeLessThanOrEqual(5)
      for (const c of palette) expect(c).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('follows color words', () => {
    const [r, g, b] = hexToRgb(paletteFromPrompt('a red bicycle against a plain wall')[0])
    expect(r).toBeGreaterThan(g + 40)
    expect(r).toBeGreaterThan(b + 40)
    const [, , blue] = hexToRgb(paletteFromPrompt('deep blue ocean')[0])
    expect(blue).toBeGreaterThan(hexToRgb(paletteFromPrompt('deep blue ocean')[0])[0])
    expect(paletteFromPrompt('navy and gold')).toHaveLength(5)
  })

  it('follows mood families', () => {
    expect(avgLuminance(paletteFromPrompt('dark moody night city'))).toBeLessThan(avgLuminance(paletteFromPrompt('soft pastel dreamy clouds')))
    const minimal = paletteFromPrompt('minimal clean product shot')
    const spread = minimal.map(luminance)
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(0.5)
  })

  it('gives related but different palettes for variations', () => {
    const base = paletteFromPrompt('A calm harbor at dawn')
    const v1 = paletteFromPrompt('A calm harbor at dawn', 1)
    expect(v1).not.toEqual(base)
    expect(v1).toEqual(paletteFromPrompt('A calm harbor at dawn', 1))
    expect(v1).toHaveLength(base.length)
  })
})

describe('describeArt', () => {
  it('describes the preview honestly and deterministically', () => {
    const spec = { palette: ['#1d2b5c', '#f0705a', '#f5f7fa'], style: 'illustration', seed: 42, kind: 'image' as const, aspect: '16:9' }
    const d = describeArt(spec)
    expect(d).toEqual(describeArt(spec))
    expect(d.composition).toBe('flow')
    expect(d.colorNames).toEqual(['navy', 'coral', 'white'])
    expect(d.summary).toBe('Procedural illustration artwork · flow composition · 3 colors: navy, coral, white · 16:9')
    expect(d.alt).toContain('simulated preview, not a model-generated image')
    expect(colorName('#2f6fde')).toBe('blue')
  })
})
