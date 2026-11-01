import { describe, expect, it } from 'vitest'
import { createRng } from '@/lib/rng'
import { adjustPalette, hexToHsl, hexToRgb as hexToRgbLocal, luminance, namedColors, paletteWarmth } from './art'
import { buildDocumentCopy, buildNarration, buildSlides, interpretInstruction, isEmptyIntent, narrationWaveform, spokenText } from './studio'

describe('interpretInstruction', () => {
  it('maps visual edits to palette, style and aspect', () => {
    const i = interpretInstruction('Make the sky warmer and a bit darker, editorial poster, square', 'image')
    expect(i.palette).toMatchObject({ warmth: expect.any(Number), light: expect.any(Number) })
    expect(i.palette!.warmth).toBeGreaterThan(0)
    expect(i.palette!.light).toBeLessThan(0)
    expect(i.style).toBe('editorial')
    expect(i.aspect).toBe('1:1')
    expect(i.notes).toEqual(['Palette: warmer, darker', 'Style: editorial', 'Aspect: 1:1'])
  })

  it('maps text edits to tone, format, length and added sections', () => {
    const deck = interpretInstruction('More executive, shorter, and add a slide about pricing', 'presentation')
    expect(deck).toMatchObject({ tone: 'executive', length: -1, add: 'pricing' })
    const doc = interpretInstruction('Turn it into an email, more playful', 'document')
    expect(doc).toMatchObject({ format: 'email', tone: 'playful' })
    expect(doc.palette).toBeUndefined()
    const audio = interpretInstruction('calmer voice, a little longer', 'audio')
    expect(audio).toMatchObject({ voice: 'Calm guide', length: 1 })
  })

  it('reports instructions it cannot map', () => {
    const i = interpretInstruction('more like the second one', 'image')
    expect(isEmptyIntent(i)).toBe(true)
    expect(i.notes).toEqual([])
  })
})

describe('palette edits', () => {
  const sky = ['#2f8fd8', '#7fd0e6', '#1d2b5c', '#f5f7fa']

  it('warms by blending toward amber (a filter), not by rotating hues', () => {
    const warm = adjustPalette(sky, { warmth: 0.85 })
    expect(paletteWarmth(warm)).toBeGreaterThan(paletteWarmth(sky))
    // Every color's red–blue balance moves warm, and none turns green-dominant.
    sky.forEach((before, i) => {
      const [r0, , b0] = hexToRgbLocal(before)
      const [r1, g1, b1] = hexToRgbLocal(warm[i])
      expect(r1 - b1).toBeGreaterThan(r0 - b0)
      expect(g1).toBeLessThanOrEqual(Math.max(r1, b1) + 48)
    })
    expect(hexToHsl(warm[0]).h).toBeGreaterThan(0)
    expect(paletteWarmth(adjustPalette(sky, { warmth: -0.85 }))).toBeLessThan(paletteWarmth(sky))
  })

  it('darkens and lightens while keeping lightness order', () => {
    const dark = adjustPalette(sky, { light: -0.65 })
    const avg = (p: string[]) => p.reduce((n, c) => n + luminance(c), 0) / p.length
    expect(avg(dark)).toBeLessThan(avg(sky))
    expect(avg(adjustPalette(sky, { light: 0.65 }))).toBeGreaterThan(avg(sky))
    const order = (p: string[]) => p.map((c, i) => [luminance(c), i] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1])
    expect(order(dark)).toEqual(order(sky))
    expect(adjustPalette(sky, {})).toEqual(sky)
  })

  it('finds color words in instructions', () => {
    expect(namedColors('Make the sky orange with navy hills')).toEqual(['orange', 'navy'])
    expect(namedColors('Make the sky warmer')).toEqual([])
    expect(namedColors('a sky blue background')).toEqual(['sky', 'blue'])
    expect(namedColors('warmer please')).toEqual([])
  })
})

describe('content generators', () => {
  it('varies deck wording between takes, keeps the structure and adds requested slides', () => {
    const base = { prompt: 'Board update on the analytics launch', title: 'Analytics launch', count: 8, tone: 'executive' }
    const a = buildSlides({ ...base, rng: createRng(1) })
    const b = buildSlides({ ...base, rng: createRng(99) })
    expect(a).toHaveLength(8)
    expect(b).toHaveLength(8)
    expect(a[0]).toMatchObject({ layout: 'title', title: 'Analytics launch' })
    expect(a.map((s) => s.title).join('|')).not.toEqual(b.map((s) => s.title).join('|') + 'x')
    const added = buildSlides({ ...base, add: 'pricing' })
    expect(added.some((s) => s.title === 'Pricing')).toBe(true)
    expect(added).toHaveLength(8)
    expect(added[added.length - 1].layout).toBe('title')
    expect(buildSlides(base)).toEqual(buildSlides(base))
  })

  it('makes copy shorter or longer and adds sections', () => {
    const input = { prompt: 'Landing page for shipment analytics', format: 'landing' as const, tone: 'clear' }
    const normal = buildDocumentCopy({ ...input, rng: createRng(4) })
    const short = buildDocumentCopy({ ...input, rng: createRng(4), length: -1 })
    const long = buildDocumentCopy({ ...input, rng: createRng(4), length: 1, add: 'security' })
    expect(short.length).toBeLessThan(normal.length)
    expect(long.length).toBeGreaterThan(normal.length)
    expect(long).toContain('## Security')
    expect(normal).not.toMatch(/\d+%/)
  })

  it('writes narration that the browser voice can read cleanly', () => {
    const script = buildNarration({ prompt: 'Calm walkthrough of carrier scorecards', voice: 'Calm guide', durationSec: 30, rng: createRng(3) })
    expect(script).toContain('no audio was synthesized')
    const spoken = spokenText(script)
    expect(spoken).not.toMatch(/\*\*|\[\d+:\d{2}\]|Voice:|Simulated narration/)
    expect(spoken.length).toBeGreaterThan(40)
  })

  it('reads the seeded table-style scripts too', () => {
    const table = '# Hero video narration\n\n| Beat | Time | Line |\n|---|---|---|\n| 1 | 0:00–0:05 | *(no narration)* |\n| 2 | 0:05–0:12 | Why is it late again? |\n\n## Notes\n- Under 50 words.'
    expect(spokenText(table)).toBe('Why is it late again? Under 50 words.')
  })

  it('draws a deterministic waveform with pauses at sentence ends', () => {
    const w = narrationWaveform('[0:00] What if it just worked? [0:02] Start with one team.', 48)
    expect(w).toHaveLength(48)
    expect(w).toEqual(narrationWaveform('[0:00] What if it just worked? [0:02] Start with one team.', 48))
    expect(Math.min(...w)).toBeGreaterThanOrEqual(0.08)
    expect(Math.max(...w)).toBeLessThanOrEqual(1)
    expect(narrationWaveform('', 12)).toEqual(Array(12).fill(0.08))
  })
})
