/**
 * Minimal color math for generative art: parse CSS color strings from asset palettes,
 * mix and shift lightness in OKLab (perceptually even), format as hex for portable SVG.
 */

export interface RGB {
  r: number
  g: number
  b: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

function hexToRgb(hex: string): RGB | null {
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(h)) return null
  return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: f(0), g: f(8), b: f(4) }
}

/* sRGB ⇄ linear ⇄ OKLab */
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLin = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function rgbToOklab({ r, g, b }: RGB): [number, number, number] {
  const lr = toLin(r)
  const lg = toLin(g)
  const lb = toLin(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToRgb([L, A, B]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return {
    r: clamp01(fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  }
}

export function oklchToRgb(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180
  return oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)])
}

export function rgbToOklch(c: RGB): [number, number, number] {
  const [L, A, B] = rgbToOklab(c)
  const C = Math.hypot(A, B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return [L, C, h]
}

/** Parse #hex, rgb(a)(), hsl(a)() or oklch(); null for anything else (incl. CSS vars). */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase()
  if (s.startsWith('#')) return hexToRgb(s)
  const nums = (body: string) =>
    body
      .replace(/[,/]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t)))
  let m = /^rgba?\((.+)\)$/.exec(s)
  if (m) {
    const raw = m[1].replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean)
    const v = raw.slice(0, 3).map((t) => (t.endsWith('%') ? (parseFloat(t) / 100) * 255 : parseFloat(t)))
    if (v.some((x) => Number.isNaN(x))) return null
    return { r: clamp01(v[0] / 255), g: clamp01(v[1] / 255), b: clamp01(v[2] / 255) }
  }
  m = /^hsla?\((.+)\)$/.exec(s)
  if (m) {
    const raw = m[1].replace(/deg/g, '').replace(/[,/]/g, ' ').split(/\s+/).filter(Boolean)
    const h = parseFloat(raw[0])
    const sat = parseFloat(raw[1]) / 100
    const l = parseFloat(raw[2]) / 100
    if ([h, sat, l].some((x) => Number.isNaN(x))) return null
    return hslToRgb(((h % 360) + 360) % 360, clamp01(sat), clamp01(l))
  }
  m = /^oklch\((.+)\)$/.exec(s)
  if (m) {
    const v = nums(m[1])
    if (v.length < 3 || v.some((x) => Number.isNaN(x))) return null
    return oklchToRgb(v[0] > 1 ? v[0] / 100 : v[0], v[1], v[2])
  }
  return null
}

export function toHex({ r, g, b }: RGB): string {
  const h = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Perceptual mix (OKLab) — t = 0 → a, 1 → b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const A = rgbToOklab(a)
  const B = rgbToOklab(b)
  return oklabToRgb([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t])
}

/** Shift OKLab lightness by `dl` (−1…1), keeping hue. */
export function shade(c: RGB, dl: number): RGB {
  const [L, A, B] = rgbToOklab(c)
  return oklabToRgb([Math.min(1, Math.max(0, L + dl)), A, B])
}

/** Scale chroma (saturation) in OKLCh. */
export function saturate(c: RGB, k: number): RGB {
  const [L, C, h] = rgbToOklch(c)
  return oklchToRgb(L, C * k, h)
}

export function lightness(c: RGB): number {
  return rgbToOklab(c)[0]
}

export const WHITE: RGB = { r: 1, g: 1, b: 1 }
export const BLACK: RGB = { r: 0, g: 0, b: 0 }
