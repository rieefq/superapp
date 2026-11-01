/**
 * Procedural art generator. Pure: (spec, aspect, idPrefix) → an SVG node tree that renders
 * identically on screen (React) and in exports (string → SVG / PNG). Deterministic per seed.
 *
 * Canonical space: the shorter side is 1000 units, the longer side scales with the aspect,
 * so compositions re-flow for any frame instead of being stretched or cropped.
 */
import { createRng, type Rng } from '@/lib/rng'
import { BLACK, WHITE, lightness, mix, oklabToRgb, oklchToRgb, parseColor, rgbToOklab, rgbToOklch, saturate, shade, toHex, type RGB } from './color'

export type ArtStyle = 'photographic' | 'illustration' | '3d' | 'abstract' | 'editorial'
export const ART_STYLES: readonly ArtStyle[] = ['photographic', 'illustration', '3d', 'abstract', 'editorial']

export interface ProceduralSpec {
  seed: number
  palette: readonly string[]
  style: string
}

type AttrValue = string | number | undefined
export interface SvgNode {
  tag: string
  attrs: Record<string, AttrValue>
  children: (SvgNode | string)[]
}

const TAU = Math.PI * 2
const r1 = (x: number) => Math.round(x * 10) / 10

function n(tag: string, attrs: Record<string, AttrValue> = {}, ...children: (SvgNode | string | null | false | undefined)[]): SvgNode {
  return { tag, attrs, children: children.filter((c): c is SvgNode | string => !!c || c === '') }
}

/** Map loose style names onto the five renderers. */
export function normalizeStyle(style: string): ArtStyle {
  const s = style.toLowerCase()
  if ((ART_STYLES as readonly string[]).includes(s)) return s as ArtStyle
  if (s.includes('photo') || s.includes('cinem') || s.includes('film')) return 'photographic'
  if (s.includes('illus') || s.includes('flat') || s.includes('vector')) return 'illustration'
  if (s.includes('3d') || s.includes('render') || s.includes('clay')) return '3d'
  if (s.includes('edit') || s.includes('poster') || s.includes('type') || s.includes('print')) return 'editorial'
  return 'abstract'
}

/* ------------------------------------------------------------------------------------------ */
/* Palette                                                                                    */
/* ------------------------------------------------------------------------------------------ */

interface Pal {
  colors: RGB[]
  /** Sorted dark → light. */
  byL: RGB[]
  dark: RGB
  mid: RGB
  light: RGB
  accent: RGB
  second: RGB
}

function preparePalette(palette: readonly string[], rng: Rng): Pal {
  const parsed: RGB[] = []
  for (const p of palette) {
    const c = parseColor(p)
    if (c && !parsed.some((q) => Math.abs(q.r - c.r) + Math.abs(q.g - c.g) + Math.abs(q.b - c.b) < 0.04)) parsed.push(c)
  }
  let colors = parsed
  if (colors.length < 2) {
    // Seeded harmony: a hue family + its complement, spread in lightness.
    const h = colors.length ? rgbToOklch(colors[0])[2] : rng.float(0, 360)
    colors = [
      oklchToRgb(0.28, 0.07, h + 10),
      oklchToRgb(0.5, 0.13, h),
      oklchToRgb(0.7, 0.14, h + 30),
      oklchToRgb(0.74, 0.16, h + 170),
      oklchToRgb(0.93, 0.03, h + 50),
    ]
  } else if (colors.length < 4) {
    const extra: RGB[] = []
    const darkest = [...colors].sort((a, b) => lightness(a) - lightness(b))[0]
    const lightest = [...colors].sort((a, b) => lightness(b) - lightness(a))[0]
    if (lightness(darkest) > 0.32) extra.push(shade(darkest, -0.3))
    if (lightness(lightest) < 0.82) extra.push(mix(lightest, WHITE, 0.6))
    colors = [...colors, ...extra]
  }
  const byL = [...colors].sort((a, b) => lightness(a) - lightness(b))
  const chroma = (c: RGB) => rgbToOklch(c)[1]
  const byC = [...colors].sort((a, b) => chroma(b) - chroma(a))
  const accent = byC[0]
  const second = byC.find((c) => c !== accent && Math.abs(rgbToOklch(c)[2] - rgbToOklch(accent)[2]) > 25) ?? byC[1] ?? shade(accent, 0.15)
  return {
    colors,
    byL,
    dark: lightness(byL[0]) > 0.3 ? shade(byL[0], 0.24 - lightness(byL[0])) : byL[0],
    mid: byL[Math.floor(byL.length / 2)],
    light: lightness(byL[byL.length - 1]) < 0.8 ? mix(byL[byL.length - 1], WHITE, 0.45) : byL[byL.length - 1],
    accent,
    second,
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Context + defs helpers                                                                     */
/* ------------------------------------------------------------------------------------------ */

interface Ctx {
  W: number
  H: number
  S: number
  rng: Rng
  pal: Pal
  seed: number
  defs: SvgNode[]
  id: (name: string) => string
  blurCache: Map<number, string>
}

const hex = toHex

/** Same hue, explicit OKLab lightness — gives compositions a controlled value structure. */
function withL(c: RGB, L: number): RGB {
  const [, a, b] = rgbToOklab(c)
  return oklabToRgb([L, a, b])
}

type Stop = [number, RGB, number?]

function linear(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, stops: Stop[], units: 'bbox' | 'user' = 'bbox'): string {
  const id = ctx.id(`lg${ctx.defs.length}`)
  ctx.defs.push(
    n(
      'linearGradient',
      { id, x1, y1, x2, y2, gradientUnits: units === 'user' ? 'userSpaceOnUse' : undefined },
      ...stops.map(([o, c, a]) => n('stop', { offset: o, 'stop-color': hex(c), 'stop-opacity': a ?? 1 })),
    ),
  )
  return `url(#${id})`
}

function radial(ctx: Ctx, stops: Stop[], opts: { cx?: number; cy?: number; r?: number; fx?: number; fy?: number; user?: boolean } = {}): string {
  const id = ctx.id(`rg${ctx.defs.length}`)
  ctx.defs.push(
    n(
      'radialGradient',
      { id, cx: opts.cx ?? 0.5, cy: opts.cy ?? 0.5, r: opts.r ?? 0.5, fx: opts.fx, fy: opts.fy, gradientUnits: opts.user ? 'userSpaceOnUse' : undefined },
      ...stops.map(([o, c, a]) => n('stop', { offset: o, 'stop-color': hex(c), 'stop-opacity': a ?? 1 })),
    ),
  )
  return `url(#${id})`
}

function blur(ctx: Ctx, std: number): string {
  const key = Math.round(std)
  const cached = ctx.blurCache.get(key)
  if (cached) return cached
  const id = ctx.id(`b${key}`)
  ctx.defs.push(n('filter', { id, x: '-60%', y: '-60%', width: '220%', height: '220%', 'color-interpolation-filters': 'sRGB' }, n('feGaussianBlur', { stdDeviation: key })))
  const url = `url(#${id})`
  ctx.blurCache.set(key, url)
  return url
}

/** Film grain overlay. */
function grain(ctx: Ctx, opacity: number, freq = 0.75, blend = 'overlay'): SvgNode {
  const id = ctx.id('grain')
  ctx.defs.push(
    n(
      'filter',
      { id, x: 0, y: 0, width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB' },
      n('feTurbulence', { type: 'fractalNoise', baseFrequency: freq, numOctaves: 2, seed: ctx.seed % 997, stitchTiles: 'stitch', result: 'n' }),
      n('feColorMatrix', { in: 'n', type: 'matrix', values: '0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1' }),
    ),
  )
  return n('rect', { width: ctx.W, height: ctx.H, filter: `url(#${id})`, opacity, blend })
}

function vignette(ctx: Ctx, strength: number, color: RGB = BLACK): SvgNode {
  const fill = radial(ctx, [
    [0.45, color, 0],
    [0.8, color, strength * 0.55],
    [1, color, strength],
  ], { r: 0.75 })
  return n('rect', { width: ctx.W, height: ctx.H, fill })
}

/* ------------------------------------------------------------------------------------------ */
/* Geometry                                                                                   */
/* ------------------------------------------------------------------------------------------ */

type Pt = [number, number]

function smoothClosed(pts: Pt[]): string {
  const k = pts.length
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`
  for (let i = 0; i < k; i++) {
    const p0 = pts[(i - 1 + k) % k]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % k]
    const p3 = pts[(i + 2) % k]
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])},${r1(p2[1])}`
  }
  return `${d}Z`
}

function smoothOpen(pts: Pt[]): string {
  let d = `M${r1(pts[0][0])},${r1(pts[0][1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    d += `C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${r1(p2[0])},${r1(p2[1])}`
  }
  return d
}

function blobPath(rng: Rng, cx: number, cy: number, r: number, irregular = 0.28, points = rng.int(6, 9)): string {
  const pts: Pt[] = []
  const rot = rng.float(0, TAU)
  for (let i = 0; i < points; i++) {
    const a = rot + (i / points) * TAU
    const rr = r * (1 + (rng.next() - 0.5) * 2 * irregular)
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr])
  }
  return smoothClosed(pts)
}

/** Analytic rolling ridge so objects can sit exactly on it. */
function makeRidge(rng: Rng, W: number, baseY: number, amp: number, freq: number) {
  const ph = [rng.float(0, TAU), rng.float(0, TAU), rng.float(0, TAU)]
  const f = [freq, freq * rng.float(2.1, 2.6), freq * rng.float(4.6, 5.4)]
  const y = (x: number) => {
    const t = x / W
    return baseY - amp * (0.6 * Math.sin(t * f[0] * TAU + ph[0]) + 0.28 * Math.sin(t * f[1] * TAU + ph[1]) + 0.12 * Math.sin(t * f[2] * TAU + ph[2]))
  }
  return y
}

function ridgePath(y: (x: number) => number, W: number, H: number, steps = 24): string {
  const pts: Pt[] = []
  for (let i = -1; i <= steps + 1; i++) {
    const x = (i / steps) * W
    pts.push([x, y(x)])
  }
  return `${smoothOpen(pts)}L${r1(W * (1 + 1 / steps))},${H + 20}L${r1(-W / steps)},${H + 20}Z`
}

/** Jagged mountain silhouette by midpoint displacement. */
function mountainPath(rng: Rng, W: number, H: number, baseY: number, amp: number, rough = 0.55): string {
  let pts: Pt[] = [
    [-40, baseY - amp * rng.float(0.1, 0.5)],
    [W + 40, baseY - amp * rng.float(0.1, 0.5)],
  ]
  let disp = amp
  for (let it = 0; it < 7; it++) {
    const next: Pt[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      next.push(a, [(a[0] + b[0]) / 2 + (rng.next() - 0.5) * disp * 0.2, (a[1] + b[1]) / 2 - (rng.next() - 0.42) * disp])
    }
    next.push(pts[pts.length - 1])
    pts = next
    disp *= rough
  }
  return `M${pts.map((p) => `${r1(p[0])},${r1(Math.min(p[1], baseY + amp * 0.2))}`).join('L')}L${W + 40},${H + 20}L-40,${H + 20}Z`
}

/* ------------------------------------------------------------------------------------------ */
/* Photographic                                                                               */
/* ------------------------------------------------------------------------------------------ */

function photographic(ctx: Ctx): SvgNode[] {
  const pick = ctx.rng.next()
  const layers = pick < 0.4 ? photoDusk(ctx) : pick < 0.7 ? photoBokeh(ctx) : photoSea(ctx)
  const { W, H, S, rng, pal } = ctx
  // Light leak — warm, screen-blended, off one corner.
  const lx = rng.chance(0.5) ? -W * 0.1 : W * 1.1
  layers.push(
    n('ellipse', {
      cx: lx,
      cy: rng.float(-0.1, 0.4) * H,
      rx: S * 0.55,
      ry: S * 0.35,
      fill: hex(mix(pal.accent, WHITE, 0.25)),
      opacity: 0.22,
      filter: blur(ctx, S * 0.12),
      blend: 'screen',
    }),
  )
  layers.push(vignette(ctx, 0.58))
  layers.push(grain(ctx, 0.3, 0.92, 'overlay'))
  return layers
}

function photoDusk(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const horizon = H * rng.float(0.5, 0.62)
  const skyTop = shade(mix(pal.dark, pal.accent, 0.18), -0.06)
  const skyMid = mix(mix(pal.mid, pal.accent, 0.3), pal.dark, 0.25)
  const glow = mix(pal.light, pal.accent, 0.38)
  const out: SvgNode[] = []
  out.push(n('rect', { width: W, height: H, fill: linear(ctx, 0, 0, 0, 1, [[0, skyTop], [0.5, skyMid], [0.9, glow], [1, mix(glow, WHITE, 0.2)]]) }))
  const sx = W * rng.float(0.22, 0.78)
  const sy = horizon - H * rng.float(0.04, 0.16)
  const sr = S * rng.float(0.045, 0.075)
  out.push(n('circle', { cx: sx, cy: sy, r: sr * 6.5, fill: hex(mix(glow, pal.accent, 0.3)), opacity: 0.55, filter: blur(ctx, S * 0.09), blend: 'screen' }))
  out.push(n('circle', { cx: sx, cy: sy, r: sr * 2.2, fill: hex(mix(glow, WHITE, 0.5)), opacity: 0.6, filter: blur(ctx, S * 0.03), blend: 'screen' }))
  out.push(n('circle', { cx: sx, cy: sy, r: sr, fill: hex(mix(WHITE, glow, 0.12)) }))
  // Cloud banks lit from below
  for (let i = 0; i < rng.int(3, 6); i++) {
    const cy = rng.float(0.12, 0.85) * horizon
    out.push(
      n('ellipse', {
        cx: rng.float(0, W),
        cy,
        rx: W * rng.float(0.25, 0.55),
        ry: S * rng.float(0.012, 0.04),
        fill: hex(mix(glow, skyMid, cy / horizon < 0.5 ? 0.6 : 0.15)),
        opacity: rng.float(0.35, 0.7),
        filter: blur(ctx, S * 0.018),
      }),
    )
  }
  // Ridges: atmospheric perspective (far = light + blurred haze, near = dark + DOF blur)
  const lake = rng.chance(0.5)
  const bases = [0.02, 0.15, 0.32, 0.62]
  const amps = [0.19, 0.14, 0.11, 0.08]
  const count = lake ? 3 : 4
  for (let i = 0; i < count; i++) {
    const d = i / 3
    const baseY = horizon + (H - horizon) * bases[i]
    const amp = H * amps[i] * rng.float(0.8, 1.15)
    const col = mix(mix(glow, skyMid, 0.35), shade(pal.dark, -0.04), Math.pow(d, 0.8))
    const fill = linear(ctx, 0, 0, 0, 1, [[0, mix(col, glow, 0.18 * (1 - d * 0.6))], [0.45, col], [1, shade(col, -0.08)]])
    out.push(n('path', { d: mountainPath(rng, W, H, baseY, amp, 0.52 + d * 0.06), fill, filter: i === 0 ? blur(ctx, 2) : i === 3 ? blur(ctx, 4) : undefined }))
    if (i < count - 1) {
      out.push(n('rect', { x: 0, y: baseY - amp * 0.3, width: W, height: amp * 0.55, fill: linear(ctx, 0, 0, 0, 1, [[0, glow, 0], [1, mix(glow, skyMid, 0.3), 0.5]]) }))
    }
  }
  if (lake) {
    const lakeY = horizon + (H - horizon) * 0.42
    out.push(n('rect', { y: lakeY, width: W, height: H - lakeY, fill: linear(ctx, 0, 0, 0, 1, [[0, mix(glow, skyMid, 0.45)], [0.5, mix(skyMid, pal.dark, 0.55)], [1, shade(pal.dark, -0.06)]]) }))
    out.push(n('rect', { x: sx - sr * 1.2, y: lakeY, width: sr * 2.4, height: (H - lakeY) * 0.8, fill: hex(mix(glow, WHITE, 0.3)), opacity: 0.35, filter: blur(ctx, S * 0.02), blend: 'screen' }))
    const ripples: SvgNode[] = []
    for (let i = 0; i < 28; i++) {
      const t = Math.pow(rng.next(), 1.5)
      const y = lakeY + 4 + t * (H - lakeY)
      ripples.push(n('rect', { x: sx - S * (0.03 + t * 0.12) * rng.float(0.5, 1), y, width: S * (0.06 + t * 0.24) * rng.float(0.5, 1), height: 1 + t * 2, fill: hex(mix(glow, WHITE, 0.35)), opacity: 0.5 * (1 - t) + 0.08 }))
    }
    out.push(n('g', { filter: blur(ctx, 1.2) }, ...ripples))
    const shore = makeRidge(rng, W, H * 0.98, H * 0.04, rng.float(0.8, 1.6))
    out.push(n('path', { d: ridgePath(shore, W, H), fill: hex(shade(pal.dark, -0.08)), filter: blur(ctx, 3) }))
  }
  return out
}

function photoBokeh(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const out: SvgNode[] = []
  out.push(n('rect', { width: W, height: H, fill: linear(ctx, 0, 0, 1, 1, [[0, shade(pal.dark, -0.08)], [1, mix(pal.dark, pal.mid, 0.35)]]) }))
  for (let i = 0; i < 5; i++) {
    const c = saturate(pal.colors[i % pal.colors.length], 1.15)
    out.push(
      n('circle', {
        cx: rng.float(-0.1, 1.1) * W,
        cy: rng.float(-0.1, 1.1) * H,
        r: S * rng.float(0.22, 0.42),
        fill: hex(lightness(c) < 0.35 ? shade(c, 0.2) : c),
        opacity: rng.float(0.45, 0.8),
        filter: blur(ctx, S * 0.13),
        blend: 'screen',
      }),
    )
  }
  const count = rng.int(16, 28)
  const discs: SvgNode[] = []
  for (let i = 0; i < count; i++) {
    const z = Math.pow(rng.next(), 1.4)
    const r = S * (0.012 + z * 0.075)
    const c = mix(pal.colors[rng.int(0, pal.colors.length - 1)], WHITE, rng.float(0.3, 0.65))
    const fill = radial(ctx, [[0, c, 0.42], [0.82, c, 0.6], [0.94, mix(c, WHITE, 0.3), 0.95], [1, c, 0]])
    discs.push(
      n('circle', {
        cx: rng.float(0, W),
        cy: rng.float(0.05, 0.95) * H,
        r,
        fill,
        opacity: 0.25 + (1 - z) * 0.5,
        filter: z > 0.3 ? blur(ctx, z * 9) : undefined,
        blend: 'screen',
      }),
    )
  }
  out.push(...discs)
  const fy = rng.float(0.3, 0.7) * H
  out.push(n('ellipse', { cx: W / 2, cy: fy, rx: W * 0.7, ry: S * 0.004, fill: hex(mix(pal.light, WHITE, 0.4)), opacity: 0.55, filter: blur(ctx, 3), blend: 'screen' }))
  out.push(n('ellipse', { cx: W / 2, cy: fy, rx: W * 0.4, ry: S * 0.03, fill: hex(mix(pal.accent, WHITE, 0.4)), opacity: 0.25, filter: blur(ctx, S * 0.03), blend: 'screen' }))
  return out
}

function photoSea(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const horizon = H * rng.float(0.46, 0.6)
  const glow = mix(pal.light, pal.accent, 0.42)
  const skyTop = shade(mix(pal.dark, pal.second, 0.25), -0.05)
  const out: SvgNode[] = []
  out.push(n('rect', { width: W, height: horizon + 2, fill: linear(ctx, 0, 0, 0, 1, [[0, skyTop], [0.65, mix(pal.mid, pal.accent, 0.35)], [1, glow]]) }))
  const sx = W * rng.float(0.3, 0.7)
  const sr = S * rng.float(0.04, 0.065)
  out.push(n('circle', { cx: sx, cy: horizon - sr * 0.4, r: sr * 7, fill: hex(glow), opacity: 0.5, filter: blur(ctx, S * 0.1), blend: 'screen' }))
  out.push(n('circle', { cx: sx, cy: horizon - sr * 0.4, r: sr, fill: hex(mix(WHITE, glow, 0.15)) }))
  // Clouds: long strata, darker on top, lit underneath
  for (let i = 0; i < rng.int(4, 7); i++) {
    const cy = horizon * rng.float(0.1, 0.8)
    const rx = W * rng.float(0.18, 0.45)
    const ry = S * rng.float(0.015, 0.05)
    out.push(
      n('ellipse', {
        cx: rng.float(0, W),
        cy,
        rx,
        ry,
        fill: linear(ctx, 0, 0, 0, 1, [[0, mix(skyTop, pal.mid, 0.4), 0.9], [1, mix(glow, WHITE, 0.15), 0.9]]),
        filter: blur(ctx, S * 0.012),
        opacity: rng.float(0.5, 0.85),
      }),
    )
  }
  // Sea
  out.push(n('rect', { y: horizon, width: W, height: H - horizon, fill: linear(ctx, 0, 0, 0, 1, [[0, mix(glow, pal.mid, 0.45)], [0.3, mix(pal.mid, pal.dark, 0.5)], [1, shade(pal.dark, -0.06)]]) }))
  // Glitter path under the sun (perspective: wider + sparser toward the viewer)
  const sparkles: SvgNode[] = []
  for (let i = 0; i < 70; i++) {
    const t = Math.pow(rng.next(), 1.6)
    const y = horizon + 3 + t * (H - horizon)
    const spread = S * (0.02 + t * 0.22)
    const w = S * (0.01 + t * 0.06) * rng.float(0.4, 1.2)
    sparkles.push(n('rect', { x: sx + (rng.next() - 0.5) * 2 * spread - w / 2, y, width: w, height: 1.2 + t * 2.5, fill: hex(mix(glow, WHITE, 0.4)), opacity: (1 - t) * 0.8 + 0.1 }))
  }
  out.push(n('g', { filter: blur(ctx, 1) }, ...sparkles))
  out.push(n('rect', { x: sx - S * 0.06, y: horizon, width: S * 0.12, height: (H - horizon) * 0.7, fill: hex(glow), opacity: 0.18, filter: blur(ctx, S * 0.04), blend: 'screen' }))
  // Swell lines
  const swell: SvgNode[] = []
  for (let i = 0; i < 18; i++) {
    const t = Math.pow((i + rng.next()) / 18, 1.7)
    const y = horizon + 6 + t * (H - horizon)
    swell.push(n('rect', { x: rng.float(-0.2, 0.4) * W, y, width: W * rng.float(0.4, 0.9), height: 1 + t * 2, fill: hex(mix(glow, pal.mid, 0.5)), opacity: 0.1 + t * 0.12 }))
  }
  out.push(n('g', { filter: blur(ctx, 1.5) }, ...swell))
  // Horizon haze
  out.push(n('rect', { y: horizon - S * 0.02, width: W, height: S * 0.04, fill: hex(glow), opacity: 0.45, filter: blur(ctx, S * 0.015) }))
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* Illustration                                                                               */
/* ------------------------------------------------------------------------------------------ */

function illustration(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const night = rng.chance(0.25)
  const hues = rng.shuffle(pal.colors.filter((c) => rgbToOklch(c)[1] > 0.02).concat(pal.colors)).slice(0, 4)
  const sunBase = pal.accent
  const bg = night ? withL(mix(pal.dark, pal.second, 0.3), 0.2) : withL(mix(pal.light, sunBase, 0.12), 0.93)
  const out: SvgNode[] = [n('rect', { width: W, height: H, fill: linear(ctx, 0, 0, 0, 1, [[0, night ? withL(bg, 0.16) : withL(bg, 0.9)], [1, bg]]) })]
  const hillL = night ? [0.42, 0.34, 0.26, 0.18] : [0.84, 0.72, 0.58, 0.42]
  const hillCols = hues.map((h, i) => withL(saturate(h, night ? 0.8 : 1.05), hillL[i]))
  if (!night) out.push(n('rect', { y: H * rng.float(0.4, 0.5), width: W, height: H, fill: hex(mix(bg, hillCols[0], 0.55)) }))
  if (night) {
    for (let i = 0; i < 46; i++) {
      out.push(n('circle', { cx: rng.float(0, W), cy: rng.float(0, H * 0.55), r: S * rng.float(0.0015, 0.0042), fill: hex(withL(pal.light, 0.95)), opacity: rng.float(0.35, 1) }))
    }
  }
  // Sun / moon
  const sx = W * rng.float(0.22, 0.78)
  const sy = H * rng.float(0.16, 0.3)
  const sr = S * rng.float(0.085, 0.12)
  const sunCol = night ? withL(pal.light, 0.94) : withL(saturate(sunBase, 1.1), Math.max(0.6, Math.min(0.78, lightness(sunBase))))
  out.push(n('circle', { cx: sx, cy: sy, r: sr * 1.55, fill: hex(mix(bg, sunCol, night ? 0.12 : 0.22)) }))
  if (rng.chance(0.6)) out.push(n('circle', { cx: sx, cy: sy, r: sr * 2.05, fill: 'none', stroke: hex(mix(bg, sunCol, 0.45)), 'stroke-width': S * 0.003 }))
  out.push(n('circle', { cx: sx, cy: sy, r: sr, fill: hex(sunCol) }))
  if (night) out.push(n('circle', { cx: sx + sr * 0.4, cy: sy - sr * 0.24, r: sr * 0.86, fill: hex(mix(bg, sunCol, 0.12)) }))
  // Clouds: flat pills that stay clear of the sun
  for (let i = 0; i < rng.int(1, 3); i++) {
    let cx = 0
    let cy = 0
    for (let t = 0; t < 8; t++) {
      cx = rng.float(0.08, 0.92) * W
      cy = rng.float(0.1, 0.36) * H
      if (Math.hypot(cx - sx, cy - sy) > sr * 3.2) break
    }
    const k = S * rng.float(0.03, 0.05)
    const col = hex(night ? withL(pal.second, 0.32) : withL(mix(WHITE, bg, 0.2), 0.98))
    out.push(
      n(
        'g',
        { fill: col },
        n('rect', { x: cx - k * 3, y: cy, width: k * 6, height: k * 1.6, rx: k * 0.8 }),
        n('circle', { cx: cx - k * 1.2, cy: cy + k * 0.2, r: k * 1.2 }),
        n('circle', { cx: cx + k * 0.6, cy: cy - k * 0.2, r: k * 1.55 }),
      ),
    )
  }
  // Birds
  if (!night) {
    const bx = rng.float(0.15, 0.7) * W
    const by = rng.float(0.1, 0.32) * H
    const ink = hex(withL(pal.dark, 0.25))
    for (let i = 0; i < rng.int(2, 4); i++) {
      const x = bx + i * S * rng.float(0.035, 0.06)
      const y = by + (rng.next() - 0.5) * S * 0.05
      const w = S * rng.float(0.011, 0.018)
      out.push(n('path', { d: `M${r1(x - w)},${r1(y)}q${r1(w / 2)},${r1(-w * 0.6)} ${r1(w)},0q${r1(w / 2)},${r1(-w * 0.6)} ${r1(w)},0`, fill: 'none', stroke: ink, 'stroke-width': S * 0.0038, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
    }
  }
  // Layered hills with a controlled value ramp (far = light, near = dark)
  const hills = 4
  const ridges: ((x: number) => number)[] = []
  for (let i = 0; i < hills; i++) {
    const baseY = H * (0.55 + 0.135 * i)
    const y = makeRidge(rng, W, baseY, H * (0.075 - 0.012 * i) * rng.float(0.8, 1.3), rng.float(0.6, 1.4))
    ridges.push(y)
    out.push(n('path', { d: ridgePath(y, W, H), fill: hex(hillCols[i]) }))
    if (i === 1) {
      const pid = ctx.id('dots')
      ctx.defs.push(n('pattern', { id: pid, width: S * 0.02, height: S * 0.02, patternUnits: 'userSpaceOnUse' }, n('circle', { cx: S * 0.01, cy: S * 0.01, r: S * 0.0032, fill: hex(withL(hillCols[i], hillL[i] - 0.1)) })))
      out.push(n('path', { d: ridgePath(y, W, H), fill: `url(#${pid})`, opacity: 0.85 }))
    }
  }
  // Winding path across the near hills
  if (rng.chance(0.7)) {
    const rx0 = rng.float(0.25, 0.75) * W
    const river: Pt[] = []
    for (let i = 0; i <= 6; i++) {
      const t = i / 6
      river.push([rx0 + Math.sin(t * Math.PI * 1.6 + rng.float(0, 1)) * W * 0.1 * (1 + t * 1.6), ridges[2](rx0) + 6 + t * (H - ridges[2](rx0))])
    }
    out.push(n('path', { d: smoothOpen(river), fill: 'none', stroke: hex(night ? withL(pal.second, 0.5) : withL(bg, 0.96)), 'stroke-width': S * 0.026, 'stroke-linecap': 'round' }))
    out.push(n('path', { d: smoothOpen(river), fill: 'none', stroke: hex(night ? withL(pal.light, 0.8) : withL(sunCol, 0.6)), 'stroke-width': S * 0.0035, 'stroke-dasharray': `${S * 0.012} ${S * 0.016}`, 'stroke-linecap': 'round' }))
  }
  // Trees / bushes sitting exactly on the two nearest ridges
  for (let layer = 2; layer < hills; layer++) {
    const yfn = ridges[layer]
    const count = rng.int(2, 4)
    const base = hillCols[layer]
    for (let i = 0; i < count; i++) {
      const x = rng.float(0.05, 0.95) * W
      const gy = yfn(x) + S * 0.008
      const scale = (layer === hills - 1 ? 1.2 : 0.8) * rng.float(0.8, 1.25)
      const col = withL(rng.pick([...hues, pal.dark]), Math.max(0.12, hillL[layer] - (night ? 0.08 : 0.16)))
      const kind = rng.int(0, 2)
      const h = S * 0.12 * scale
      if (kind === 0) {
        out.push(n('rect', { x: x - S * 0.004 * scale, y: gy - h * 0.6, width: S * 0.008 * scale, height: h * 0.6, fill: hex(withL(base, hillL[layer] - 0.2)) }))
        out.push(n('path', { d: blobPath(rng, x, gy - h * 0.72, h * 0.3, 0.16), fill: hex(col) }))
      } else if (kind === 1) {
        const w = h * 0.34
        out.push(n('path', { d: `M${r1(x)},${r1(gy - h)}L${r1(x + w)},${r1(gy - h * 0.1)}L${r1(x - w)},${r1(gy - h * 0.1)}Z`, fill: hex(col), stroke: hex(col), 'stroke-width': S * 0.006, 'stroke-linejoin': 'round' }))
      } else {
        out.push(n('path', { d: blobPath(rng, x, gy - h * 0.14, h * 0.24, 0.2), fill: hex(col) }))
      }
    }
  }
  out.push(grain(ctx, 0.14, 0.95, 'multiply'))
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* 3D                                                                                         */
/* ------------------------------------------------------------------------------------------ */

type Obj = { kind: 'sphere' | 'torus' | 'box' | 'pill'; x: number; base: number; size: number; color: RGB; lift: number }

function threeD(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const floorY = H * rng.float(0.6, 0.7)
  const wallTop = shade(mix(pal.dark, pal.mid, 0.35), -0.06)
  const wallLow = mix(pal.mid, pal.light, 0.45)
  const out: SvgNode[] = []
  out.push(n('rect', { width: W, height: H, fill: linear(ctx, 0, 0, 0, 1, [[0, wallTop], [floorY / H, wallLow], [1, shade(mix(pal.mid, pal.dark, 0.35), -0.04)]]) }))
  // Seamless sweep: soft horizon + floor light pool
  out.push(n('rect', { y: floorY - S * 0.04, width: W, height: S * 0.08, fill: hex(mix(wallLow, WHITE, 0.15)), opacity: 0.55, filter: blur(ctx, S * 0.03) }))
  out.push(n('ellipse', { cx: W * rng.float(0.35, 0.65), cy: floorY + (H - floorY) * 0.35, rx: W * 0.45, ry: (H - floorY) * 0.45, fill: hex(mix(wallLow, WHITE, 0.25)), opacity: 0.35, filter: blur(ctx, S * 0.06) }))

  const kinds: Obj['kind'][] = rng.shuffle(['sphere', 'torus', 'box', 'pill', 'sphere'])
  const count = Math.min(kinds.length, W > H * 1.3 ? rng.int(3, 4) : H > W * 1.3 ? 2 : 3)
  const objs: Obj[] = []
  const cols = rng.shuffle(pal.colors.filter((c) => lightness(c) > 0.25 && lightness(c) < 0.92))
  for (let i = 0; i < count; i++) {
    const slot = (i + 0.5) / count
    const depth = rng.float(0, 1)
    objs.push({
      kind: kinds[i],
      x: W * (0.12 + slot * 0.76) + (rng.next() - 0.5) * W * 0.06,
      base: floorY + (H - floorY) * (0.12 + depth * 0.38),
      size: S * (0.15 + depth * 0.06) * rng.float(0.85, 1.12) * (count > 3 ? 0.88 : 1) * (H > W * 1.3 ? 1.15 : 1),
      color: cols.length ? cols[i % cols.length] : pal.accent,
      lift: kinds[i] === 'sphere' && rng.chance(0.3) ? S * rng.float(0.08, 0.16) : 0,
    })
  }
  objs.sort((a, b) => a.base - b.base)

  const fadeId = ctx.id('fade')
  ctx.defs.push(
    n(
      'linearGradient',
      { id: `${fadeId}-g`, x1: 0, y1: 0, x2: 0, y2: 1 },
      n('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.5 }),
      n('stop', { offset: 0.55, 'stop-color': '#fff', 'stop-opacity': 0 }),
    ),
  )
  ctx.defs.push(n('mask', { id: fadeId, maskContentUnits: 'objectBoundingBox' }, n('rect', { width: 1, height: 1, fill: `url(#${fadeId}-g)` })))

  for (const o of objs) {
    const w = objWidth(o)
    // Contact + ambient shadows on the floor
    out.push(n('ellipse', { cx: o.x, cy: o.base, rx: w * 0.75, ry: w * 0.16, fill: '#000', opacity: o.lift ? 0.16 : 0.24, filter: blur(ctx, S * 0.03) }))
    if (!o.lift) out.push(n('ellipse', { cx: o.x, cy: o.base, rx: w * 0.42, ry: w * 0.06, fill: '#000', opacity: 0.45, filter: blur(ctx, S * 0.008) }))
    // Reflection
    const body = drawObj(ctx, o)
    out.push(n('g', { mask: `url(#${fadeId})`, opacity: 0.55 }, n('g', { transform: `translate(0 ${r1(2 * o.base)}) scale(1 -1)`, filter: blur(ctx, 2.5) }, ...body)))
    out.push(...drawObj(ctx, o))
  }
  out.push(vignette(ctx, 0.35))
  out.push(grain(ctx, 0.22, 0.85, 'overlay'))
  return out
}

function objWidth(o: Obj): number {
  switch (o.kind) {
    case 'sphere':
      return o.size * 1.6
    case 'torus':
      return o.size * 2.1
    case 'box':
      return o.size * 1.7
    case 'pill':
      return o.size * 0.95
  }
}

function drawObj(ctx: Ctx, o: Obj): SvgNode[] {
  const { S } = ctx
  const c = o.color
  const hi = mix(c, WHITE, 0.6)
  const lo = shade(c, -0.24)
  switch (o.kind) {
    case 'sphere': {
      const r = o.size * 0.8
      const cy = o.base - r - o.lift
      const fill = radial(ctx, [[0, hi], [0.22, mix(c, WHITE, 0.18)], [0.6, c], [0.9, lo], [1, shade(c, -0.12)]], { fx: 0.34, fy: 0.3, r: 0.56 })
      return [
        n('circle', { cx: o.x, cy, r, fill }),
        n('ellipse', { cx: o.x - r * 0.34, cy: cy - r * 0.42, rx: r * 0.2, ry: r * 0.12, transform: `rotate(-32 ${r1(o.x - r * 0.34)} ${r1(cy - r * 0.42)})`, fill: '#fff', opacity: 0.7, filter: blur(ctx, Math.max(1, r * 0.05)) }),
        n('circle', { cx: o.x, cy, r: r * 0.985, fill: 'none', stroke: hex(mix(c, WHITE, 0.3)), 'stroke-width': r * 0.03, opacity: 0.35, 'stroke-dasharray': `${r1(r * 1.1)} ${r1(r * 5.2)}`, 'stroke-dashoffset': r1(-r * 0.4) }),
      ]
    }
    case 'torus': {
      const R = o.size * 0.72
      const t = o.size * 0.3
      const outer = R + t
      const cy = o.base - outer
      const fill = radial(
        ctx,
        [
          [(R - t) / outer, shade(c, -0.3)],
          [(R - t * 0.35) / outer, mix(c, WHITE, 0.08)],
          [(R + t * 0.1) / outer, mix(c, WHITE, 0.32)],
          [(R + t * 0.55) / outer, c],
          [1, shade(c, -0.26)],
        ],
        { cx: o.x, cy, r: outer, user: true },
      )
      const light = linear(ctx, 0, 0, 1, 1, [[0, WHITE, 0.38], [0.5, WHITE, 0], [1, BLACK, 0.28]])
      const ring = `M${r1(o.x - outer)},${r1(cy)}a${r1(outer)},${r1(outer)} 0 1 0 ${r1(outer * 2)},0a${r1(outer)},${r1(outer)} 0 1 0 ${r1(-outer * 2)},0ZM${r1(o.x - (R - t))},${r1(cy)}a${r1(R - t)},${r1(R - t)} 0 1 1 ${r1((R - t) * 2)},0a${r1(R - t)},${r1(R - t)} 0 1 1 ${r1(-(R - t) * 2)},0Z`
      return [
        n('path', { d: ring, fill, 'fill-rule': 'evenodd' }),
        n('path', { d: ring, fill: light, 'fill-rule': 'evenodd' }),
        n('path', { d: `M${r1(o.x - R * 0.85)},${r1(cy - R * 0.55)}A${r1(R * 1.05)},${r1(R * 1.05)} 0 0 1 ${r1(o.x + R * 0.1)},${r1(cy - R * 1.05)}`, fill: 'none', stroke: '#fff', 'stroke-width': t * 0.16, 'stroke-linecap': 'round', opacity: 0.55, filter: blur(ctx, Math.max(1, t * 0.08)) }),
      ]
    }
    case 'box': {
      const a = o.size * 0.95
      const dx = a * 0.866
      const dy = a * 0.5
      const h = a * 0.9
      const { x } = o
      const y = o.base
      const left = `M${r1(x - dx)},${r1(y - dy)}L${r1(x)},${r1(y)}L${r1(x)},${r1(y - h)}L${r1(x - dx)},${r1(y - dy - h)}Z`
      const right = `M${r1(x)},${r1(y)}L${r1(x + dx)},${r1(y - dy)}L${r1(x + dx)},${r1(y - dy - h)}L${r1(x)},${r1(y - h)}Z`
      const top = `M${r1(x - dx)},${r1(y - dy - h)}L${r1(x)},${r1(y - h)}L${r1(x + dx)},${r1(y - dy - h)}L${r1(x)},${r1(y - 2 * dy - h)}Z`
      const lf = linear(ctx, 0, 0, 0, 1, [[0, mix(c, WHITE, 0.1)], [1, shade(c, -0.06)]])
      const rf = linear(ctx, 0, 0, 1, 1, [[0, shade(c, -0.2)], [1, shade(c, -0.3)]])
      const tf = linear(ctx, 0, 0, 1, 1, [[0, mix(c, WHITE, 0.5)], [1, mix(c, WHITE, 0.25)]])
      const bevel = S * 0.012
      return [
        n('path', { d: left, fill: lf, stroke: hex(mix(c, WHITE, 0.05)), 'stroke-width': bevel, 'stroke-linejoin': 'round' }),
        n('path', { d: right, fill: rf, stroke: hex(shade(c, -0.22)), 'stroke-width': bevel, 'stroke-linejoin': 'round' }),
        n('path', { d: top, fill: tf, stroke: hex(mix(c, WHITE, 0.38)), 'stroke-width': bevel, 'stroke-linejoin': 'round' }),
        n('path', { d: `M${r1(x - dx)},${r1(y - dy - h)}L${r1(x)},${r1(y - h)}L${r1(x + dx)},${r1(y - dy - h)}`, fill: 'none', stroke: '#fff', 'stroke-width': bevel * 0.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: 0.6 }),
      ]
    }
    case 'pill': {
      const w = o.size * 0.95
      const h = o.size * 2.3
      const x0 = o.x - w / 2
      const y0 = o.base - h
      const fill = linear(ctx, 0, 0, 1, 0, [[0, shade(c, -0.22)], [0.28, mix(c, WHITE, 0.3)], [0.5, c], [0.85, shade(c, -0.2)], [1, shade(c, -0.1)]])
      return [
        n('rect', { x: x0, y: y0, width: w, height: h, rx: w / 2, fill }),
        n('rect', { x: x0 + w * 0.2, y: y0 + w * 0.3, width: w * 0.1, height: h - w * 0.6, rx: w * 0.05, fill: '#fff', opacity: 0.55, filter: blur(ctx, Math.max(1, w * 0.04)) }),
        n('ellipse', { cx: o.x, cy: y0 + w * 0.42, rx: w * 0.3, ry: w * 0.16, fill: '#fff', opacity: 0.25, filter: blur(ctx, Math.max(1, w * 0.06)) }),
      ]
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Abstract (Bauhaus)                                                                         */
/* ------------------------------------------------------------------------------------------ */

function abstract(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const darkMode = rng.chance(0.3)
  const paper = darkMode ? shade(pal.dark, -0.06) : mix(mix(pal.light, WHITE, 0.55), { r: 0.96, g: 0.93, b: 0.86 }, 0.35)
  const ink = darkMode ? mix(pal.light, WHITE, 0.6) : shade(pal.dark, -0.2)
  const colors = rng.shuffle(pal.colors.filter((c) => Math.abs(lightness(c) - lightness(paper)) > 0.12))
  const palette = colors.length >= 2 ? colors : [pal.accent, pal.second, pal.mid]
  const out: SvgNode[] = [n('rect', { width: W, height: H, fill: hex(paper) })]
  const m = S * 0.07
  const target = S * 0.27
  const cols = Math.max(2, Math.round((W - 2 * m) / target))
  const rows = Math.max(2, Math.round((H - 2 * m) / target))
  const cell = Math.min((W - 2 * m) / cols, (H - 2 * m) / rows)
  const ox = (W - cols * cell) / 2
  const oy = (H - rows * cell) / 2
  const used = new Set<string>()
  const pickC = (avoid?: RGB) => {
    const opts = [...palette, ink].filter((c) => c !== avoid)
    return rng.pick(opts)
  }
  const cellShape = (x: number, y: number, s: number, motif: string, col: RGB, bgCol?: RGB): SvgNode[] => {
    const res: SvgNode[] = []
    if (bgCol) res.push(n('rect', { x, y, width: s, height: s, fill: hex(bgCol) }))
    const fill = hex(col)
    const rot = rng.int(0, 3) * 90
    const cx = x + s / 2
    const cy = y + s / 2
    const tr = `rotate(${rot} ${r1(cx)} ${r1(cy)})`
    switch (motif) {
      case 'quarter':
        res.push(n('path', { d: `M${r1(x)},${r1(y + s)}V${r1(y)}A${r1(s)},${r1(s)} 0 0 1 ${r1(x + s)},${r1(y + s)}Z`, fill, transform: tr }))
        break
      case 'half':
        res.push(n('path', { d: `M${r1(x)},${r1(cy)}A${r1(s / 2)},${r1(s / 2)} 0 0 1 ${r1(x + s)},${r1(cy)}Z`, fill, transform: tr }))
        break
      case 'circle':
        res.push(n('circle', { cx, cy, r: s * 0.38, fill }))
        break
      case 'ring':
        res.push(n('circle', { cx, cy, r: s * 0.32, fill: 'none', stroke: fill, 'stroke-width': s * 0.12 }))
        break
      case 'square':
        res.push(n('rect', { x: cx - s * 0.28, y: cy - s * 0.28, width: s * 0.56, height: s * 0.56, fill, transform: rng.chance(0.4) ? `rotate(45 ${r1(cx)} ${r1(cy)})` : undefined }))
        break
      case 'stripes': {
        const k = rng.int(3, 5)
        const g: SvgNode[] = []
        for (let i = 0; i < k; i++) g.push(n('rect', { x: x + (i * s) / k + s / k / 4, y: y + s * 0.1, width: s / k / 2, height: s * 0.8, fill }))
        res.push(n('g', { transform: tr }, ...g))
        break
      }
      case 'triangle':
        res.push(n('path', { d: `M${r1(x)},${r1(y + s)}L${r1(x + s)},${r1(y + s)}L${r1(x)},${r1(y)}Z`, fill, transform: tr }))
        break
      case 'dots': {
        const g: SvgNode[] = []
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) g.push(n('circle', { cx: x + s * (0.2 + i * 0.3), cy: y + s * (0.2 + j * 0.3), r: s * 0.07, fill }))
        res.push(...g)
        break
      }
      case 'arch':
        res.push(n('path', { d: `M${r1(x + s * 0.18)},${r1(y + s)}V${r1(cy)}A${r1(s * 0.32)},${r1(s * 0.32)} 0 0 1 ${r1(x + s * 0.82)},${r1(cy)}V${r1(y + s)}Z`, fill, transform: tr }))
        break
      case 'concentric':
        for (let i = 3; i >= 1; i--) res.push(n('circle', { cx, cy, r: (s * 0.42 * i) / 3, fill: hex(i % 2 ? col : bgCol ?? paper) }))
        break
    }
    return res
  }
  // Big 2×2 anchors
  const bigCount = cols >= 3 && rows >= 3 ? rng.int(1, 2) : cols >= 2 && rows >= 2 ? 1 : 0
  const big: SvgNode[] = []
  for (let b = 0; b < bigCount; b++) {
    for (let tries = 0; tries < 12; tries++) {
      const c = rng.int(0, cols - 2)
      const r = rng.int(0, rows - 2)
      const keys = [`${c},${r}`, `${c + 1},${r}`, `${c},${r + 1}`, `${c + 1},${r + 1}`]
      if (keys.some((k) => used.has(k))) continue
      keys.forEach((k) => used.add(k))
      const x = ox + c * cell
      const y = oy + r * cell
      const motif = rng.pick(['quarter', 'circle', 'half', 'concentric'])
      big.push(...cellShape(x, y, cell * 2, motif, b === 0 ? pal.accent : pickC(pal.accent), rng.chance(0.5) ? pickC(pal.accent) : undefined))
      break
    }
  }
  const motifs = ['quarter', 'quarter', 'half', 'circle', 'ring', 'square', 'stripes', 'triangle', 'dots', 'arch', 'blank', 'blank']
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (used.has(`${c},${r}`)) continue
      const motif = rng.pick(motifs)
      if (motif === 'blank') continue
      const col = pickC()
      const bgCol = rng.chance(0.28) ? pickC(col) : undefined
      out.push(...cellShape(ox + c * cell, oy + r * cell, cell, motif, col, bgCol))
    }
  out.push(...big)
  // Ink rules + a single dot accent
  const lineY = oy + rng.int(1, rows - 1) * cell
  out.push(n('rect', { x: ox - m * 0.4, y: lineY - S * 0.002, width: cols * cell + m * 0.8, height: S * 0.004, fill: hex(ink) }))
  if (rng.chance(0.6)) {
    const lineX = ox + rng.int(1, cols - 1) * cell
    out.push(n('rect', { x: lineX - S * 0.002, y: oy - m * 0.4, width: S * 0.004, height: rows * cell + m * 0.8, fill: hex(ink) }))
  }
  out.push(n('circle', { cx: ox + rng.int(0, cols) * cell, cy: oy + rng.int(0, rows) * cell, r: S * 0.018, fill: hex(pal.accent), stroke: hex(paper), 'stroke-width': S * 0.006 }))
  out.push(grain(ctx, 0.16, 0.95, 'multiply'))
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* Editorial                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const GLYPHS = ['A', 'R', '&', 'Q', 'M', 'S', 'O', 'G', 'N', 'K', '7', '3', '8']
const KICKERS = ['FIELD NOTES', 'QUIET HOURS', 'THE INDEX', 'SIGNAL', 'ATLAS', 'LONG READ', 'DISPATCH', 'ESSAYS']
const SERIF = "Newsreader, 'Newsreader Variable', 'Iowan Old Style', Georgia, 'Times New Roman', serif"
const MONO = "'JetBrains Mono', 'JetBrains Mono Variable', ui-monospace, Menlo, monospace"

function editorial(ctx: Ctx): SvgNode[] {
  const { W, H, S, rng, pal } = ctx
  const dark = rng.chance(0.4)
  let paper = dark ? shade(pal.dark, -0.1) : mix(pal.light, WHITE, 0.55)
  let ink = dark ? mix(pal.light, WHITE, 0.75) : shade(pal.dark, -0.22)
  if (Math.abs(lightness(paper) - lightness(ink)) < 0.55) {
    paper = dark ? { r: 0.07, g: 0.07, b: 0.07 } : { r: 0.96, g: 0.95, b: 0.92 }
    ink = dark ? { r: 0.95, g: 0.94, b: 0.9 } : { r: 0.08, g: 0.08, b: 0.08 }
  }
  const accent = saturate(pal.accent, 1.1)
  const out: SvgNode[] = [n('rect', { width: W, height: H, fill: hex(paper) })]
  const m = S * 0.065
  const colW = (W - 2 * m) / 12
  const wide = W / H > 1.2
  const tall = H / W > 1.2

  // Accent block (strong contrast field)
  const blockCols = rng.int(4, 7)
  const blockOnRight = rng.chance(0.5)
  const blockX = blockOnRight ? m + colW * (12 - blockCols) : m
  const blockTop = rng.float(0.18, 0.4) * H
  out.push(n('rect', { x: blockX, y: blockTop, width: colW * blockCols, height: H - blockTop - m * 1.6, fill: hex(accent) }))

  // Halftone disc (dot size follows tone)
  const hx = blockX + colW * blockCols * rng.float(0.3, 0.7)
  const hy = blockTop + (H - blockTop) * rng.float(0.3, 0.55)
  const hr = S * rng.float(0.24, 0.34)
  const spacing = Math.max(S * 0.018, Math.sqrt((Math.PI * hr * hr) / 900))
  const dots: SvgNode[] = []
  const lightAngle = rng.float(0, TAU)
  for (let gy = hy - hr; gy <= hy + hr; gy += spacing) {
    for (let gx = hx - hr; gx <= hx + hr; gx += spacing) {
      const dx = gx - hx
      const dy = gy - hy
      const dist = Math.hypot(dx, dy) / hr
      if (dist > 1) continue
      // Sphere shading: tone from the lit side to the terminator
      const lit = 0.5 + 0.5 * ((dx * Math.cos(lightAngle) + dy * Math.sin(lightAngle)) / hr)
      const tone = Math.min(1, Math.max(0.06, lit * 0.85 + dist * 0.25))
      dots.push(n('circle', { cx: r1(gx), cy: r1(gy), r: r1((spacing / 2) * Math.sqrt(tone) * 0.95) }))
    }
  }
  out.push(n('g', { fill: hex(ink) }, ...dots))

  // Giant glyph, cropped by the frame
  const glyph = rng.pick(GLYPHS)
  const gSize = (tall ? W * 1.1 : H) * rng.float(0.75, 0.95)
  const gx = rng.chance(0.5) ? W - m * 0.5 : m * 0.4
  out.push(
    n(
      'text',
      {
        x: gx,
        y: H - m * 0.6 + gSize * 0.08,
        'font-family': SERIF,
        'font-size': gSize,
        'font-style': rng.chance(0.4) ? 'italic' : undefined,
        'text-anchor': gx > W / 2 ? 'end' : 'start',
        fill: hex(dark ? mix(ink, paper, 0.08) : ink),
        opacity: 0.92,
        blend: dark ? 'screen' : 'multiply',
      },
      glyph,
    ),
  )

  // Kicker + headline bars + body columns
  const kicker = `${rng.pick(KICKERS)} · ${String(rng.int(1, 48)).padStart(2, '0')}`
  const fs = S * 0.024
  out.push(n('rect', { x: m, y: m, width: W - 2 * m, height: S * 0.003, fill: hex(ink) }))
  out.push(n('text', { x: m, y: m + fs * 1.9, 'font-family': MONO, 'font-size': fs, 'letter-spacing': fs * 0.18, fill: hex(ink), 'font-weight': 600 }, kicker))
  out.push(n('text', { x: W - m, y: m + fs * 1.9, 'font-family': MONO, 'font-size': fs, 'letter-spacing': fs * 0.18, fill: hex(ink), 'text-anchor': 'end', opacity: 0.6 }, `NO. ${rng.int(100, 999)}`))
  const headTop = m + fs * 3.6
  const barH = S * (wide ? 0.05 : 0.042)
  const headCols = wide ? 6 : 9
  const lines = rng.int(2, 3)
  for (let i = 0; i < lines; i++) {
    const w = colW * headCols * (i === lines - 1 ? rng.float(0.45, 0.75) : rng.float(0.82, 1))
    out.push(n('rect', { x: m, y: headTop + i * barH * 1.32, width: w, height: barH, fill: hex(ink) }))
  }
  const bodyTop = headTop + lines * barH * 1.32 + S * 0.035
  const blockRight = blockOnRight
  const freeStart = blockRight ? m : blockX + colW * blockCols + colW * 0.5
  const freeEnd = blockRight ? blockX - colW * 0.5 : W - m
  const bodyCols = freeEnd - freeStart > colW * 5.5 ? 2 : 1
  const colWidth = (freeEnd - freeStart - (bodyCols - 1) * colW * 0.4) / bodyCols
  const lineGap = S * 0.026
  const bodyEnd = H - m * 1.7
  for (let bc = 0; bc < bodyCols && colWidth > colW; bc++) {
    const x0 = freeStart + bc * (colWidth + colW * 0.4)
    for (let y = bodyTop; y < bodyEnd; y += lineGap) {
      const para = rng.chance(0.12)
      const last = y + lineGap >= bodyEnd
      out.push(n('rect', { x: x0, y, width: colWidth * (last || para ? rng.float(0.3, 0.65) : rng.float(0.86, 1)), height: S * 0.009, rx: S * 0.002, fill: hex(ink), opacity: 0.4 }))
      if (para) y += lineGap * 0.6
    }
  }
  // Folio rule
  out.push(n('rect', { x: m, y: H - m, width: W - 2 * m, height: S * 0.002, fill: hex(ink), opacity: 0.7 }))
  out.push(grain(ctx, dark ? 0.2 : 0.24, 0.95, dark ? 'screen' : 'multiply'))
  return out
}

/* ------------------------------------------------------------------------------------------ */
/* Entry                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/** Canonical drawing size for an aspect ratio (shorter side = 1000). */
export function canvasSize(aspect: number): { W: number; H: number } {
  const a = Number.isFinite(aspect) && aspect > 0 ? Math.min(6, Math.max(1 / 6, aspect)) : 1
  return a >= 1 ? { W: Math.round(1000 * a), H: 1000 } : { W: 1000, H: Math.round(1000 / a) }
}

/** Build the SVG tree for a spec at an aspect ratio (width / height). */
export function buildArt(spec: ProceduralSpec, aspect: number, idPrefix: string): SvgNode {
  const { W, H } = canvasSize(aspect)
  const style = normalizeStyle(spec.style)
  const seed = Math.abs(Math.floor(spec.seed)) || 1
  const rng = createRng(`${seed}:${style}`)
  const pal = preparePalette(spec.palette, createRng(`${seed}:palette`))
  const safe = idPrefix.replace(/[^a-zA-Z0-9_-]/g, '')
  const ctx: Ctx = { W, H, S: Math.min(W, H), rng, pal, seed, defs: [], id: (name) => `${safe}-${name}`, blurCache: new Map() }
  const layers =
    style === 'photographic'
      ? photographic(ctx)
      : style === 'illustration'
        ? illustration(ctx)
        : style === '3d'
          ? threeD(ctx)
          : style === 'editorial'
            ? editorial(ctx)
            : abstract(ctx)
  const clipId = ctx.id('frame')
  ctx.defs.push(n('clipPath', { id: clipId }, n('rect', { width: W, height: H })))
  return n(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid slice' },
    n('defs', {}, ...ctx.defs),
    n('g', { 'clip-path': `url(#${clipId})` }, ...layers),
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Serialization                                                                              */
/* ------------------------------------------------------------------------------------------ */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Serialize a node tree to SVG markup. `blend` becomes a mix-blend-mode style. */
export function toSvgString(node: SvgNode): string {
  const attrs = Object.entries(node.attrs)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => (k === 'blend' ? `style="mix-blend-mode:${esc(String(v))}"` : `${k}="${esc(String(v))}"`))
    .join(' ')
  const open = attrs ? `<${node.tag} ${attrs}` : `<${node.tag}`
  if (!node.children.length) return `${open}/>`
  return `${open}>${node.children.map((c) => (typeof c === 'string' ? esc(c) : toSvgString(c))).join('')}</${node.tag}>`
}
