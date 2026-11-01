import type { ActorRef, ID, KnowledgeItem, KnowledgeKind } from '@/core/types'
import { ME } from '../helpers'

export interface KnowledgeSpec {
  id: ID
  kind: KnowledgeKind
  title: string
  content: string
  summary: string
  tags: string[]
  collectionId: ID | null
  projectIds: ID[]
  source: KnowledgeItem['source']
  author?: ActorRef
  pinned?: boolean
  file?: KnowledgeItem['file']
  createdAt: number
  updatedAt?: number
}

/** Normalize a spec into a KnowledgeItem row (author defaults to the user). */
export function item(spec: KnowledgeSpec): KnowledgeItem {
  return {
    id: spec.id,
    kind: spec.kind,
    title: spec.title,
    content: spec.content.trim(),
    summary: spec.summary,
    tags: spec.tags,
    collectionId: spec.collectionId,
    projectIds: spec.projectIds,
    source: spec.source,
    ...(spec.file ? { file: spec.file } : {}),
    author: spec.author ?? ME,
    ...(spec.pinned ? { pinned: true } : {}),
    createdAt: spec.createdAt,
    updatedAt: spec.updatedAt ?? spec.createdAt,
  }
}
