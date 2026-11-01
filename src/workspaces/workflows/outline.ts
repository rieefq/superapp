import { reachableFrom, topologicalOrder } from '@/core/sim/workflow'
import type { WorkflowEdge, WorkflowNode } from '@/core/types'

/**
 * The Outline (docs/DESIGN.md §6.6): the graph as numbered sentences with indented branches —
 * "1. When knowledge is added", "3. Check “Urgent?”", "3a. Yes → Alert #support-urgent". A step sits
 * inside a branch when every way to it goes through that branch; steps where branches meet return
 * to the outer level. Steps the trigger can't reach are listed at the end as "Not connected".
 */

export interface OutlineItem {
  node: WorkflowNode
  /** "1", "3a", "3a.2", "3b". */
  number: string
  depth: number
  /** For the first step of a condition branch: which branch it starts. */
  branch?: 'true' | 'false'
  /** The condition this step's branch belongs to. */
  conditionId?: string
}

export interface Outline {
  items: OutlineItem[]
  /** Steps the trigger can't reach (they never run). */
  orphans: WorkflowNode[]
}

type Branch = 'true' | 'false'

export function buildOutline(nodes: readonly WorkflowNode[], edges: readonly WorkflowEdge[]): Outline {
  const ids = new Set(nodes.map((n) => n.id))
  const valid = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const trigger = nodes.find((n) => n.type === 'trigger')
  const { order, blocked } = topologicalOrder(nodes, valid)
  const topo = [...order, ...blocked]
  const pos = new Map(topo.map((id, i) => [id, i]))
  const reachable = trigger ? reachableFrom(trigger.id, valid) : new Set<string>()

  /** Reachable from the trigger when `without` is removed from the graph. */
  const reachWithout = (without: string) => {
    if (!trigger || trigger.id === without) return new Set<string>()
    return reachableFrom(trigger.id, valid.filter((e) => e.source !== without && e.target !== without))
  }
  const branchReach = (c: string, h: Branch) => {
    const starts = valid.filter((e) => e.source === c && (e.sourceHandle ?? 'true') === h).map((e) => e.target)
    const out = new Set<string>()
    for (const s of starts) for (const id of reachableFrom(s, valid)) if (id !== c) out.add(id)
    return out
  }

  // Innermost branch for each step: the latest condition (in flow order) whose branch owns it exclusively.
  const owner = new Map<string, { c: string; h: Branch }>()
  const conditions = topo.map((id) => byId.get(id)!).filter((n) => n.type === 'condition' && reachable.has(n.id))
  for (const c of conditions) {
    const yes = branchReach(c.id, 'true')
    const no = branchReach(c.id, 'false')
    const around = reachWithout(c.id)
    for (const [h, set, other] of [['true', yes, no], ['false', no, yes]] as const) {
      for (const id of set) {
        if (other.has(id) || around.has(id)) continue
        const cur = owner.get(id)
        if (!cur || (pos.get(c.id) ?? 0) > (pos.get(cur.c) ?? 0)) owner.set(id, { c: c.id, h })
      }
    }
  }

  const items: OutlineItem[] = []
  const placed = new Set<string>()
  const childrenOf = (c: string | null, h?: Branch) =>
    topo.filter((id) => reachable.has(id) && !placed.has(id) && (c === null ? !owner.has(id) : owner.get(id)?.c === c && owner.get(id)?.h === h))

  const walk = (c: string | null, h: Branch | undefined, prefix: string, depth: number) => {
    const seq = childrenOf(c, h)
    seq.forEach((id, i) => {
      if (placed.has(id)) return
      placed.add(id)
      const node = byId.get(id)!
      const number = c === null ? `${i + 1}` : i === 0 ? prefix : `${prefix}.${i + 1}`
      items.push({ node, number, depth, ...(c !== null && i === 0 ? { branch: h, conditionId: c } : c !== null ? { conditionId: c } : {}) })
      if (node.type === 'condition') {
        walk(id, 'true', `${number}a`, depth + 1)
        walk(id, 'false', `${number}b`, depth + 1)
      }
    })
  }
  walk(null, undefined, '', 0)
  const orphans = topo.filter((id) => !placed.has(id)).map((id) => byId.get(id)!)
  return { items, orphans }
}
