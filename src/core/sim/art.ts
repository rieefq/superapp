import type { AssetKind } from '@/core/types'
import { createRng, hashString } from '@/lib/rng'

/**
 * Procedural art helpers for Studio's simulated previews. Pure and deterministic:
 * the same prompt (and variant) always yields the same palette. Rendering is the UI's job.
 */

interface Hsl {
  h: number
  s: number
  l: number
}

/** Color words → hue (and optional fixed saturation/lightness). */
const COLOR_WORDS: Record<string, { h: number; s?: number; l?: number }> = {
  red: { h: 2 }, crimson: { h: 348 }, scarlet: { h: 8 }, orange: { h: 28 }, amber: { h: 40 }, gold: { h: 45, s: 0.75, l: 0.52 },
  golden: { h: 44, s: 0.75, l: 0.52 }, yellow: { h: 54 }, lime: { h: 85 }, green: { h: 130 }, emerald: { h: 150 },
  mint: { h: 160, s: 0.5, l: 0.72 }, teal: { h: 178 }, turquoise: { h: 174 }, cyan: { h: 190 }, aqua: { h: 185 },
  sky: { h: 202, l: 0.68 }, blue: { h: 218 }, navy: { h: 225, s: 0.6, l: 0.24 }, cobalt: { h: 222 }, indigo: { h: 245 },
  violet: { h: 270 }, purple: { h: 282 }, lavender: { h: 268, s: 0.5, l: 0.78 }, magenta: { h: 305 }, pink: { h: 335, l: 0.72 },
  rose: { h: 345 }, coral: { h: 12, l: 0.66 }, peach: { h: 24, s: 0.7, l: 0.78 }, brown: { h: 25, s: 0.45, l: 0.32 },
  terracotta: { h: 16, s: 0.55, l: 0.48 }, sand: { h: 38, s: 0.35, l: 0.74 }, beige: { h: 36, s: 0.3, l: 0.8 },
  cream: { h: 42, s: 0.5, l: 0.9 }, ivory: { h: 48, s: 0.4, l: 0.93 }, black: { h: 220, s: 0.1, l: 0.08 },
  charcoal: { h: 215, s: 0.12, l: 0.2 }, gray: { h: 215, s: 0.08, l: 0.5 }, grey: { h: 215, s: 0.08, l: 0.5 },
  silver: { h: 210, s: 0.08, l: 0.75 }, white: { h: 210, s: 0.15, l: 0.97 },
}

type Scheme = 'analogous' | 'complementary' | 'triadic' | 'split' | 'mono'

interface Mood {
  name: string
  re: RegExp
  hue?: number
  sat: readonly [number, number]
  light: readonly [number, number]
  scheme?: Scheme
}

/** Mood words → color families. The first match wins. */
const MOODS: readonly Mood[] = [
  { name: 'neon', re: /\b(neon|cyber\w*|synthwave|electric)\b/, hue: 300, sat: [0.85, 1], light: [0.45, 0.6], scheme: 'complementary' },
  { name: 'dark', re: /\b(dark|moody|noir|night|midnight|mysterious|cinematic)\b/, hue: 235, sat: [0.35, 0.6], light: [0.1, 0.38], scheme: 'analogous' },
  { name: 'sunset', re: /\b(sunset|dusk|golden hour|sunrise|dawn)\b/, hue: 18, sat: [0.65, 0.9], light: [0.45, 0.68], scheme: 'analogous' },
  { name: 'pastel', re: /\b(pastel|dreamy|airy|whimsical)\b/, hue: 300, sat: [0.35, 0.55], light: [0.78, 0.9], scheme: 'triadic' },
  { name: 'calm', re: /\b(calm|serene|peaceful|tranquil|soft|gentle|quiet)\b/, hue: 200, sat: [0.25, 0.45], light: [0.55, 0.85], scheme: 'analogous' },
  { name: 'energetic', re: /\b(energetic|bold|vibrant|vivid|loud|playful|fun|dynamic)\b/, hue: 15, sat: [0.75, 0.95], light: [0.45, 0.6], scheme: 'triadic' },
  { name: 'vintage', re: /\b(vintage|retro|nostalgic|film|analog)\b/, hue: 30, sat: [0.3, 0.5], light: [0.45, 0.72], scheme: 'split' },
  { name: 'earthy', re: /\b(earthy|natural|organic|rustic|warm)\b/, hue: 30, sat: [0.3, 0.55], light: [0.3, 0.62], scheme: 'analogous' },
  { name: 'luxury', re: /\b(luxury|luxurious|elegant|premium|refined)\b/, hue: 45, sat: [0.4, 0.6], light: [0.14, 0.55], scheme: 'complementary' },
  { name: 'minimal', re: /\b(minimal|minimalist|clean|simple|monochrome)\b/, hue: 215, sat: [0.05, 0.2], light: [0.15, 0.95], scheme: 'mono' },
  { name: 'ocean', re: /\b(ocean|sea|marine|coastal|harbou?r|water|port)\b/, hue: 200, sat: [0.5, 0.75], light: [0.3, 0.7], scheme: 'analogous' },
  { name: 'forest', re: /\b(forest|jungle|leaf|leaves|garden|botanical)\b/, hue: 130, sat: [0.4, 0.65], light: [0.25, 0.55], scheme: 'analogous' },
  { name: 'desert', re: /\b(desert|dunes?|canyon|arid)\b/, hue: 30, sat: [0.45, 0.65], light: [0.5, 0.78], scheme: 'analogous' },
  { name: 'winter', re: /\b(winter|ice|icy|snow|frost|arctic|cold)\b/, hue: 200, sat: [0.25, 0.5], light: [0.72, 0.95], scheme: 'analogous' },
  { name: 'autumn', re: /\b(autumn|fall|harvest)\b/, hue: 25, sat: [0.6, 0.8], light: [0.35, 0.55], scheme: 'analogous' },
  { name: 'trust', re: /\b(corporate|professional|trust\w*|enterprise|logistics|freight|finance)\b/, hue: 215, sat: [0.45, 0.65], light: [0.28, 0.62], scheme: 'split' },
]

const DEFAULT_MOOD: Mood = { name: 'balanced', re: /$^/, sat: [0.5, 0.75], light: [0.32, 0.72] }

const SCHEME_OFFSETS: Record<Scheme, readonly number[]> = {
  analogous: [0, 24, -24, 48, -48],
  complementary: [0, 180, 20, 200, -20],
  triadic: [0, 120, 240, 30, 150],
  split: [0, 150, 210, 20, 330],
  mono: [0, 0, 0, 0, 0],
}

function wrap(h: number): number {
  return ((h % 360) + 360) % 360
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

export function hslToHex({ h, s, l }: Hsl): string {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(clamp01(c) * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Relative luminance (0 dark … 1 light), WCAG formula. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Color words mentioned in the prompt, in order of appearance. */
function colorWordsIn(text: string): Array<{ word: string; h: number; s?: number; l?: number }> {
  const found: Array<{ word: string; at: number; h: number; s?: number; l?: number }> = []
  for (const [word, spec] of Object.entries(COLOR_WORDS)) {
    const m = new RegExp(`\\b${word}\\b`).exec(text)
    if (m) found.push({ word, at: m.index, ...spec })
  }
  return found.sort((a, b) => a.at - b.at)
}

/**
 * 4–5 hex colors for a prompt: named colors set the hues, mood words set the family
 * (saturation/lightness/scheme). `variant` > 0 gives related but distinct palettes for variations.
 * Order: primary, supporting colors, then the darkest and lightest tones.
 */
export function paletteFromPrompt(prompt: string, variant = 0): string[] {
  const text = prompt.toLowerCase()
  const seed = (hashString(text) ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0
  const rng = createRng(seed)
  const named = colorWordsIn(text)
  const mood = MOODS.find((m) => m.re.test(text)) ?? DEFAULT_MOOD
  const count = named.length >= 2 || mood !== DEFAULT_MOOD ? 5 : 4
  const scheme: Scheme = mood.scheme ?? rng.pick<Scheme>(['analogous', 'complementary', 'triadic', 'split'])
  const shift = variant ? rng.int(10, 28) * (rng.chance(0.5) ? 1 : -1) * Math.min(variant, 3) : 0
  const baseHue = wrap((named[0]?.h ?? mood.hue ?? hashString(text) % 360) + shift)
  const [sMin, sMax] = mood.sat
  const [lMin, lMax] = mood.light
  const colors: Hsl[] = []
  for (let i = 0; i < count; i++) {
    const word = named[i]
    const offset = SCHEME_OFFSETS[scheme][i] ?? i * 37
    const h = word ? wrap(word.h + (i === 0 ? shift : shift / 2)) : wrap(baseHue + offset + rng.int(-6, 6))
    // Spread lightness so the palette always has contrast: mid, mid, mid… then dark and light at the end.
    const levels = count === 5 ? [0.5, 0.42, 0.62, 0.05, 0.95] : [0.5, 0.65, 0.05, 0.95]
    const l = word?.l ?? lMin + (lMax - lMin) * levels[i] + rng.float(-0.03, 0.03)
    const s = word?.s ?? rng.float(sMin, sMax) * (scheme === 'mono' && i >= count - 2 ? 0.5 : 1)
    colors.push({ h, s: clamp01(s), l: clamp01(l) })
  }
  return colors.map(hslToHex)
}

const NAMED: ReadonlyArray<[string, string]> = [
  ['black', '#111318'], ['charcoal', '#2c3138'], ['slate', '#5b6573'], ['gray', '#8a929c'], ['silver', '#c4cad1'], ['white', '#f5f7fa'],
  ['navy', '#1d2b5c'], ['blue', '#2f6fde'], ['sky blue', '#7fb8ec'], ['teal', '#1a9c95'], ['cyan', '#2ec4d6'], ['mint', '#8fdcc0'],
  ['green', '#2e9d4a'], ['olive', '#7a7d33'], ['lime', '#9ccc3d'], ['yellow', '#f2d43a'], ['gold', '#d6a72c'], ['amber', '#e89a23'],
  ['orange', '#ee7a2b'], ['coral', '#f0705a'], ['red', '#d8352f'], ['crimson', '#b51d45'], ['pink', '#ee8fb4'], ['rose', '#d9466f'],
  ['magenta', '#cc39b5'], ['purple', '#8b3fcf'], ['violet', '#6e55e0'], ['indigo', '#3f3aa8'], ['lavender', '#b9a8ec'],
  ['brown', '#7a4b2a'], ['terracotta', '#c0603c'], ['sand', '#d9c39a'], ['beige', '#e6d9bf'], ['cream', '#f6efd9'],
]

/** Nearest friendly color name for a hex value. */
export function colorName(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  let best = NAMED[0][0]
  let dist = Infinity
  for (const [name, ref] of NAMED) {
    const [R, G, B] = hexToRgb(ref)
    const d = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2
    if (d < dist) {
      dist = d
      best = name
    }
  }
  return best
}

export type ArtComposition = 'layers' | 'flow' | 'radial' | 'grid' | 'strata' | 'scatter'

export interface ArtSpec {
  palette: readonly string[]
  style: string
  seed: number
  kind?: AssetKind
  aspect?: string
}

export interface ArtDescription {
  composition: ArtComposition
  /** Number of primary shapes the renderer should draw. */
  shapes: number
  colorNames: string[]
  /** "Procedural illustration · flow composition · 5 colors: navy, coral, …" */
  summary: string
  /** Accessible description; says plainly that this is a simulated preview. */
  alt: string
}

const STYLE_COMPOSITION: Record<string, ArtComposition> = { photographic: 'layers', illustration: 'flow', '3d': 'radial', editorial: 'grid' }

/** Describe a procedural preview (deterministic for the spec). */
export function describeArt(spec: ArtSpec): ArtDescription {
  const rng = createRng(spec.seed >>> 0)
  const all: ArtComposition[] = ['layers', 'flow', 'radial', 'grid', 'strata', 'scatter']
  const composition = STYLE_COMPOSITION[spec.style] ?? rng.pick(all)
  const shapes = composition === 'grid' ? rng.int(6, 12) : composition === 'scatter' ? rng.int(14, 28) : rng.int(3, 8)
  const colorNames = [...new Set(spec.palette.map(colorName))]
  const what = spec.kind === 'video' ? 'storyboard frame' : spec.kind === 'presentation' ? 'slide visual' : spec.kind === 'audio' ? 'waveform cover' : 'artwork'
  return {
    composition,
    shapes,
    colorNames,
    summary: `Procedural ${spec.style} ${what} · ${composition} composition · ${spec.palette.length} colors: ${colorNames.join(', ')}${spec.aspect ? ` · ${spec.aspect}` : ''}`,
    alt: `Procedural ${spec.style} ${what} in ${colorNames.join(', ')} (simulated preview, not a model-generated image).`,
  }
}

// ---------------------------------------------------------------- palette edits (Studio "Edit with instruction")

/** Hex → HSL (h 0–360, s and l 0–1). */
export function hexToHsl(hex: string): Hsl {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}

/**
 * A direction for a palette edit, each in −1…1: warmth (cool ↔ warm), light (darker ↔ lighter),
 * saturation (muted ↔ vivid). Produced by `interpretInstruction` in `./studio`.
 */
export interface PaletteAdjust {
  warmth?: number
  light?: number
  saturation?: number
}

/** Reference tints for warmth edits: an amber and a blue, applied like a photo filter. */
const WARM_TINT: [number, number, number] = [232, 150, 62]
const COOL_TINT: [number, number, number] = [72, 122, 212]

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Apply a palette edit, deterministically: warmth blends every color toward amber (or blue), like a
 * warming filter over the whole image; light shifts lightness; saturation scales chroma. The relative
 * order of lightness is kept, so compositions keep their value structure.
 */
export function adjustPalette(palette: readonly string[], adjust: PaletteAdjust): string[] {
  const warmth = Math.max(-1, Math.min(1, adjust.warmth ?? 0))
  const light = Math.max(-1, Math.min(1, adjust.light ?? 0))
  const sat = Math.max(-1, Math.min(1, adjust.saturation ?? 0))
  if (!warmth && !light && !sat) return [...palette]
  return palette.map((hex) => {
    let color = hex
    if (warmth) {
      const tint = warmth > 0 ? WARM_TINT : COOL_TINT
      const f = 0.32 * Math.abs(warmth)
      const rgb = hexToRgb(hex)
      color = rgbToHex([0, 1, 2].map((i) => rgb[i] * (1 - f) + tint[i] * f) as [number, number, number])
    }
    let { h, s, l } = hexToHsl(color)
    if (light) l = clamp01(light > 0 ? l + (1 - l) * light * 0.35 : l + l * light * 0.35)
    if (sat) s = clamp01(sat > 0 ? s + (1 - s) * sat * 0.45 : s * (1 + sat * 0.6))
    if (warmth && !light && !sat) return color
    return hslToHex({ h: wrap(h), s, l })
  })
}

/** Average warmth of a palette, −1 (blue) … 1 (red/amber): the mean red–blue balance. */
export function paletteWarmth(palette: readonly string[]): number {
  if (!palette.length) return 0
  const sum = palette.reduce((n, hex) => {
    const [r, , b] = hexToRgb(hex)
    return n + (r - b) / 255
  }, 0)
  return sum / palette.length
}

/**
 * Color words named in a text ("make the sky orange" → ['orange']), in order of appearance. "Sky" is
 * a color only as "sky blue" — in an edit it is usually the subject ("make the sky warmer").
 */
export function namedColors(text: string): string[] {
  const t = text.toLowerCase()
  return colorWordsIn(t)
    .map((c) => c.word)
    .filter((w) => w !== 'sky' || /\bsky[- ]blue\b/.test(t))
}
