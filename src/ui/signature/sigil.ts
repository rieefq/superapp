import { createRng, type Rng } from '@/lib/rng'

/**
 * Deterministic agent sigils (docs/DESIGN.md §5.4.7): 3–5 radial strokes, arcs and dots drawn
 * inside the AgentMark circle. Geometry is in unit space: radii are fractions of the mark's
 * radius (kept ≤ 0.66 so the 1px ring stays clear) and angles are degrees clockwise from 12 o'clock.
 */
export type SigilElement =
  | { type: 'stroke'; angle: number; from: number; to: number }
  | { type: 'arc'; angle: number; span: number; r: number }
  | { type: 'dot'; angle: number; r: number }

export const SIGIL_MAX_RADIUS = 0.66

type Family = (rng: Rng) => SigilElement[]

const snap = (deg: number, step = 15) => (((Math.round(deg / step) * step) % 360) + 360) % 360
const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng.next() * items.length)]
const round = (n: number) => Math.round(n * 1000) / 1000

/** Evenly spaced rays with one shortened beat; sometimes a center dot. */
const rays: Family = (rng) => {
  const n = pick(rng, [3, 3, 4, 4, 5] as const)
  const base = snap(rng.int(0, 359))
  const from = pick(rng, [0.14, 0.2, 0.28])
  const short = rng.int(0, n - 1)
  const out: SigilElement[] = []
  for (let i = 0; i < n; i++) {
    const to = i === short ? from + 0.2 : pick(rng, [0.56, 0.62, SIGIL_MAX_RADIUS])
    out.push({ type: 'stroke', angle: snap(base + (360 / n) * i, 5), from, to })
  }
  if (n < 5 && from >= 0.2 && rng.chance(0.5)) out.push({ type: 'dot', angle: 0, r: 0 })
  return out
}

/** One orbit arc, a radial stroke reaching toward it, and a satellite dot. */
const orbit: Family = (rng) => {
  const a = snap(rng.int(0, 359))
  const r = pick(rng, [0.5, 0.56, 0.62])
  const span = pick(rng, [90, 120, 150])
  const out: SigilElement[] = [
    { type: 'arc', angle: a, span, r },
    { type: 'stroke', angle: snap(a + 180), from: 0, to: pick(rng, [0.32, 0.4]) },
    { type: 'dot', angle: snap(a + 180), r: pick(rng, [0.56, 0.62]) },
  ]
  if (rng.chance(0.45)) out.push({ type: 'dot', angle: 0, r: 0 })
  return out
}

/** Scattered stars joined by short radial ticks. */
const constellation: Family = (rng) => {
  const base = snap(rng.int(0, 359), 30)
  const dots = pick(rng, [2, 3] as const)
  const out: SigilElement[] = []
  for (let i = 0; i < dots; i++) {
    out.push({ type: 'dot', angle: snap(base + i * (360 / dots) + rng.int(-20, 20), 5), r: pick(rng, [0.3, 0.46, 0.58]) })
  }
  const strokes = dots === 3 ? pick(rng, [1, 2] as const) : 2
  for (let i = 0; i < strokes; i++) {
    const angle = snap(base + 180 / dots + i * (360 / dots), 5)
    out.push({ type: 'stroke', angle, from: pick(rng, [0.12, 0.22]), to: pick(rng, [0.5, 0.6]) })
  }
  return out
}

/** A long axis, a short cross-beat and a marker dot. */
const compass: Family = (rng) => {
  const a = snap(rng.int(0, 359), 45)
  const out: SigilElement[] = [
    { type: 'stroke', angle: a, from: 0.1, to: SIGIL_MAX_RADIUS },
    { type: 'stroke', angle: snap(a + 180), from: 0.1, to: pick(rng, [0.42, 0.5]) },
    { type: 'stroke', angle: snap(a + pick(rng, [90, 270])), from: 0.24, to: 0.46 },
    { type: 'dot', angle: snap(a + pick(rng, [135, 225])), r: 0.5 },
  ]
  if (rng.chance(0.35)) out.push({ type: 'dot', angle: 0, r: 0 })
  return out
}

/** Two facing arcs (brackets) around a core. */
const brackets: Family = (rng) => {
  const a = snap(rng.int(0, 179), 45)
  const r = pick(rng, [0.5, 0.58])
  const span = pick(rng, [70, 90, 110])
  const out: SigilElement[] = [
    { type: 'arc', angle: a, span, r },
    { type: 'arc', angle: snap(a + 180), span, r },
  ]
  if (rng.chance(0.5)) out.push({ type: 'dot', angle: 0, r: 0 })
  else out.push({ type: 'stroke', angle: snap(a + 90), from: 0, to: 0.3 })
  if (rng.chance(0.5)) out.push({ type: 'dot', angle: snap(a + 90), r: r })
  return out
}

/** A spiral-ish pair: arc plus two rays of different reach. */
const sweep: Family = (rng) => {
  const a = snap(rng.int(0, 359))
  const out: SigilElement[] = [
    { type: 'arc', angle: a, span: pick(rng, [120, 160, 200]), r: pick(rng, [0.42, 0.5]) },
    { type: 'stroke', angle: snap(a + 120), from: 0.18, to: SIGIL_MAX_RADIUS },
    { type: 'stroke', angle: snap(a + 240), from: 0.18, to: 0.44 },
  ]
  if (rng.chance(0.55)) out.push({ type: 'dot', angle: snap(a + 120), r: 0.28 })
  return out
}

const FAMILIES: readonly Family[] = [rays, orbit, constellation, compass, brackets, sweep]

/** The sigil for an agent's `sigil` seed: 3–5 elements, identical for the same seed. */
export function sigilElements(seed: number): SigilElement[] {
  const rng = createRng(Math.trunc(Number.isFinite(seed) ? seed : 0) >>> 0)
  const family = FAMILIES[Math.floor(rng.next() * FAMILIES.length)]
  const raw = family(rng).slice(0, 5)
  const out = raw.map((e): SigilElement => {
    if (e.type === 'stroke') return { ...e, from: round(e.from), to: round(Math.min(e.to, SIGIL_MAX_RADIUS)) }
    if (e.type === 'arc') return { ...e, r: round(Math.min(e.r, SIGIL_MAX_RADIUS)) }
    return { ...e, r: round(Math.min(e.r, SIGIL_MAX_RADIUS)) }
  })
  while (out.length < 3) out.push({ type: 'dot', angle: 0, r: 0 })
  return out
}

// ------------------------------------------------------------------ SVG geometry

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const rad = ((deg - 90) * Math.PI) / 180
  return [round(cx + r * Math.cos(rad)), round(cy + r * Math.sin(rad))]
}

export interface SigilPaths {
  /** Stroked path data (strokes and arcs). */
  stroke: string
  /** Dot centers. */
  dots: [number, number][]
}

/** Path data for a sigil inside a circle of radius `R` centered at (`c`, `c`). */
export function sigilPaths(elements: readonly SigilElement[], c: number, R: number): SigilPaths {
  const parts: string[] = []
  const dots: [number, number][] = []
  for (const e of elements) {
    if (e.type === 'stroke') {
      const [x1, y1] = polar(c, c, e.from * R, e.angle)
      const [x2, y2] = polar(c, c, e.to * R, e.angle)
      parts.push(`M${x1} ${y1}L${x2} ${y2}`)
    } else if (e.type === 'arc') {
      const r = e.r * R
      const [x1, y1] = polar(c, c, r, e.angle - e.span / 2)
      const [x2, y2] = polar(c, c, r, e.angle + e.span / 2)
      parts.push(`M${x1} ${y1}A${round(r)} ${round(r)} 0 ${e.span > 180 ? 1 : 0} 1 ${x2} ${y2}`)
    } else {
      dots.push(polar(c, c, e.r * R, e.angle))
    }
  }
  return { stroke: parts.join(''), dots }
}
