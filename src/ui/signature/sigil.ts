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

/*
 * Composition rules (so sigils read as instruments, never as faces or punctuation):
 * dots sit only at the hub or at the end of a spoke or arc; spokes start at or near the hub;
 * arcs are concentric orbits; nothing is mirrored around the vertical axis.
 */

/** Spokes from a hub, one reaching further; sometimes a terminal on the longest. */
const spokes: Family = (rng) => {
  const n = pick(rng, [3, 3, 4] as const)
  const rot = snap(rng.int(0, 359), 15) + 7.5
  const hub = pick(rng, [0, 0.16, 0.22])
  const reach = rng.shuffle([SIGIL_MAX_RADIUS, 0.58, 0.48, 0.62]).slice(0, n)
  const out: SigilElement[] = reach.map((to, i) => ({ type: 'stroke', angle: snap(rot + (360 / n) * i + (i === 1 ? 12 : 0), 2.5), from: hub, to }))
  const longest = reach.indexOf(Math.max(...reach))
  if (rng.chance(0.55)) out.push({ type: 'dot', angle: (out[longest] as { angle: number }).angle, r: reach[longest] })
  else if (hub > 0 && n === 3) out.push({ type: 'dot', angle: 0, r: 0 })
  return out
}

/** A radar sector: two radii and the arc between them, sometimes with a sweep line inside. */
const sector: Family = (rng) => {
  const a = snap(rng.int(0, 359), 15)
  const span = pick(rng, [70, 90, 110])
  const r = pick(rng, [0.58, SIGIL_MAX_RADIUS])
  const out: SigilElement[] = [
    { type: 'stroke', angle: snap(a - span / 2, 2.5), from: 0.08, to: r },
    { type: 'stroke', angle: snap(a + span / 2, 2.5), from: 0.08, to: r },
    { type: 'arc', angle: a, span, r },
  ]
  if (rng.chance(0.5)) out.push({ type: 'stroke', angle: snap(a + span / 6, 2.5), from: 0.16, to: r - 0.16 })
  else out.push({ type: 'dot', angle: snap(a + 180, 5), r: 0.36 })
  return out
}

/** A dial: an open arc, a needle and its pivot. */
const gauge: Family = (rng) => {
  const open = snap(rng.int(0, 359), 45)
  const span = pick(rng, [240, 270])
  const needle = snap(open + 180 + rng.int(-70, 70), 15)
  const out: SigilElement[] = [
    { type: 'arc', angle: snap(open + 180), span, r: 0.58 },
    { type: 'stroke', angle: needle, from: 0, to: 0.42 },
    { type: 'dot', angle: 0, r: 0 },
  ]
  if (rng.chance(0.5)) out.push({ type: 'stroke', angle: open, from: 0.46, to: SIGIL_MAX_RADIUS })
  return out
}

/** Ticks on a ring around a hub (a reticle), rotated off-axis; one tick reaches in further. */
const reticle: Family = (rng) => {
  const n = pick(rng, [3, 4] as const)
  const rot = snap(rng.int(8, 82), 7.5)
  const long = rng.int(0, n - 1)
  const inner = pick(rng, [0.32, 0.38])
  const out: SigilElement[] = []
  for (let i = 0; i < n; i++) out.push({ type: 'stroke', angle: snap(rot + (360 / n) * i, 2.5), from: i === long ? 0.18 : inner, to: SIGIL_MAX_RADIUS })
  if (n === 3 || rng.chance(0.6)) out.push({ type: 'dot', angle: 0, r: 0 })
  return out
}

/** Two facing orbit segments joined by a line through the hub. */
const brackets: Family = (rng) => {
  const a = snap(rng.int(0, 179), 15) + 15
  const span = pick(rng, [70, 90, 110])
  const r = pick(rng, [0.52, 0.58])
  return [
    { type: 'arc', angle: a, span, r },
    { type: 'arc', angle: snap(a + 180), span, r },
    { type: 'stroke', angle: snap(a + 90), from: 0, to: 0.3 },
    { type: 'stroke', angle: snap(a + 270), from: 0, to: 0.3 },
  ]
}

/** Uneven branches with terminals, like a small network. */
const branches: Family = (rng) => {
  const rot = snap(rng.int(0, 359), 15)
  const gaps = rng.shuffle([105, 125, 130])
  const reach = rng.shuffle([0.62, 0.5, 0.4])
  const out: SigilElement[] = []
  let angle = rot
  for (let i = 0; i < 3; i++) {
    out.push({ type: 'stroke', angle: snap(angle, 2.5), from: 0.1, to: reach[i] })
    angle += gaps[i]
  }
  const ends = rng.shuffle([0, 1, 2]).slice(0, 2)
  for (const i of ends) out.push({ type: 'dot', angle: (out[i] as { angle: number }).angle, r: reach[i] })
  return out
}

const FAMILIES: readonly Family[] = [spokes, sector, gauge, reticle, brackets, branches]

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
