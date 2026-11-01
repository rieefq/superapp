import type { EntityKind, EntityRef, ID, KnowledgeItem } from '@/core/types'

/** STUB — replaced by the search implementation (signatures are a contract). */
export interface SearchResult {
  ref: EntityRef
  kind: EntityKind
  title: string
  /** Plain-text excerpt around the best match. */
  snippet: string
  /** [start, end) character ranges in `snippet` that matched the query. */
  highlights: Array<[number, number]>
  score: number
  projectId: ID | null
  updatedAt?: number
}

export interface SearchOptions {
  kinds?: EntityKind[]
  projectId?: ID | null
  limit?: number
}

export function search(query: string, opts?: SearchOptions): SearchResult[] {
  void query
  void opts
  return []
}

export interface RetrievedPassage {
  item: KnowledgeItem
  /** The most relevant passage of the item's content. */
  passage: string
  score: number
}

export interface RetrieveOptions {
  projectId?: ID | null
  /** Restrict to these knowledge ids (e.g. pinned context). */
  ids?: ID[]
  limit?: number
}

export function retrieveKnowledge(query: string, opts?: RetrieveOptions): RetrievedPassage[] {
  void query
  void opts
  return []
}
