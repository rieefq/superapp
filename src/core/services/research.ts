import type { EntityRef, ID, Investigation, ResearchDepth } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export interface CreateInvestigationInput {
  question: string
  title?: string
  projectId?: ID | null
  depth?: ResearchDepth
  angles?: string[]
  origin?: EntityRef
  /** Start the research run immediately (default true). */
  start?: boolean
}

export function createInvestigation(input: CreateInvestigationInput): Investigation {
  void input
  throw new Error('createInvestigation not implemented yet')
}
