import type { EntityRef, ID, Timestamp } from './common'

export type InvestigationStatus = 'draft' | 'running' | 'review' | 'complete' | 'failed'
export type ResearchDepth = 'quick' | 'standard' | 'deep'

export interface Finding {
  id: ID
  text: string
  sourceIds: ID[]
  confidence: 'low' | 'medium' | 'high'
  pinned?: boolean
}

export interface Investigation {
  id: ID
  title: string
  question: string
  projectId: ID | null
  status: InvestigationStatus
  depth: ResearchDepth
  /** Optional focus areas / sub-questions. */
  angles: string[]
  /** Which source types the research run may use (default: both). Web search is simulated. */
  sources?: { knowledge: boolean; web: boolean }
  sourceIds: ID[]
  findings: Finding[]
  /** Markdown report. */
  report?: string
  runIds: ID[]
  origin?: EntityRef
  /** Knowledge item the report was saved to. */
  knowledgeId?: ID
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type SourceKind = 'web' | 'paper' | 'doc' | 'dataset' | 'video' | 'knowledge'

export interface Source {
  id: ID
  investigationId: ID | null
  kind: SourceKind
  title: string
  url?: string
  domain?: string
  author?: string
  publishedAt?: Timestamp
  snippet: string
  /** Extracted/summarized content. */
  content?: string
  /** 0..1 heuristic credibility. */
  credibility: number
  status: 'queued' | 'reading' | 'read' | 'cited' | 'discarded'
  /** Sources from the simulated web are labeled as such. */
  simulated: boolean
  /** When the source is (or was saved as) a knowledge item. */
  knowledgeId?: ID
  addedAt: Timestamp
}
