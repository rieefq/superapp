import type { EntityRef, ID, Run } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export function runWorkflow(workflowId: ID, input?: { trigger?: string; origin?: EntityRef }): Run {
  void workflowId
  void input
  throw new Error('runWorkflow not implemented yet')
}
