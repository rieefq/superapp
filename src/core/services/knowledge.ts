import type { ActorRef, ID, KnowledgeItem, KnowledgeKind } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export interface CreateKnowledgeInput {
  title: string
  content: string
  kind?: KnowledgeKind
  collectionId?: ID | null
  projectIds?: ID[]
  tags?: string[]
  source?: KnowledgeItem['source']
  author?: ActorRef
  summary?: string
}

export function createKnowledge(input: CreateKnowledgeInput): KnowledgeItem {
  void input
  throw new Error('createKnowledge not implemented yet')
}
