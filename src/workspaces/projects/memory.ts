import { useShallow } from 'zustand/react/shallow'
import { estimateRefTokens } from '@/app/components'
import { estimateTokens } from '@/core/ai/models'
import { useDB, type Tables } from '@/core/db'
import type { ID, Project } from '@/core/types'

/**
 * "What the AI sees" (§6.9 › Memory): project memory rides along in every run in the project —
 * the goal, the instructions and every item held in memory. Estimates use the same ~4 characters
 * per token rule as the Context Line, so the numbers match what composers show.
 */
export interface MemoryBreakdown {
  goal: number
  instructions: number
  /** Tokens per held item, in memory order (0 for items that no longer exist). */
  items: number[]
  total: number
}

export function memoryBreakdown(s: Tables, project: Pick<Project, 'name' | 'goal' | 'instructions' | 'pinnedRefs'>): MemoryBreakdown {
  const goal = project.goal ? estimateTokens(`${project.name}\n${project.goal}`) : 0
  const instructions = project.instructions ? estimateTokens(project.instructions) : 0
  const items = project.pinnedRefs.map((ref) => estimateRefTokens(ref, s))
  return { goal, instructions, items, total: goal + instructions + items.reduce((a, b) => a + b, 0) }
}

/** The breakdown for one project, re-selected only when one of its numbers changes. */
export function useMemoryBreakdown(projectId: ID): MemoryBreakdown {
  const flat = useDB(
    useShallow((s: Tables) => {
      const p = s.projects[projectId]
      if (!p) return [0, 0, 0]
      const b = memoryBreakdown(s, p)
      return [b.goal, b.instructions, b.total, ...b.items]
    }),
  )
  const [goal = 0, instructions = 0, total = 0, ...items] = flat
  return { goal, instructions, items, total }
}
