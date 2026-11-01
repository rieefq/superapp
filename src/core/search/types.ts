import type { EntityKind, EntityRef, ID, KnowledgeItem } from '@/core/types'

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
  /**
   * The more specific entity the snippet comes from, when there is one — the best-matching
   * message of a thread (navigate with `/chat/:threadId?m=<anchor.id>`).
   */
  anchor?: EntityRef
}

export interface SearchOptions {
  kinds?: EntityKind[]
  /** When set (not null), only entities belonging to this project. */
  projectId?: ID | null
  /** Default 20. */
  limit?: number
}

export interface RetrievedPassage {
  item: KnowledgeItem
  /** The most relevant passage of the item's content. */
  passage: string
  score: number
}

export interface RetrieveOptions {
  /**
   * Prefer this project's knowledge: items in the project rank normally, items without a
   * project rank lower, items of other projects are excluded (unless listed in `ids`).
   */
  projectId?: ID | null
  /** Restrict to these knowledge ids (e.g. pinned context). */
  ids?: ID[]
  /** Default 5. */
  limit?: number
}
