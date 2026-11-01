import type { ActorRef, EntityRef, Hue, ID, Timestamp } from './common'

export type KnowledgeKind = 'note' | 'doc' | 'file' | 'link' | 'report' | 'snippet' | 'transcript' | 'dataset'

export type KnowledgeSourceType =
  | 'manual'
  | 'upload'
  | 'web'
  | 'research'
  | 'chat'
  | 'agent'
  | 'integration'
  | 'studio'
  | 'code'

export interface KnowledgeItem {
  id: ID
  kind: KnowledgeKind
  title: string
  /** Markdown or extracted plain text. Indexed for search and retrieval. */
  content: string
  summary?: string
  tags: string[]
  collectionId: ID | null
  projectIds: ID[]
  source: {
    type: KnowledgeSourceType
    ref?: EntityRef
    url?: string
    integrationId?: string
  }
  file?: { name: string; mime: string; size: number; blobKey?: string }
  author: ActorRef
  pinned?: boolean
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Collection {
  id: ID
  name: string
  description?: string
  hue: Hue
  icon: string
  createdAt: Timestamp
}
