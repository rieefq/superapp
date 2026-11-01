import type { EntityRef, ID, Run } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export function runAgent(agentId: ID, input: { instruction: string; projectId?: ID | null; taskId?: ID; origin?: EntityRef }): Run {
  void agentId
  void input
  throw new Error('runAgent not implemented yet')
}
