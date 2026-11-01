import type { ID, Timestamp } from './common'

export type AssetKind = 'image' | 'video' | 'presentation' | 'document' | 'audio'

/**
 * Previews are either procedural (deterministic generative art rendered by the
 * simulator — clearly labeled) or real image data from a connected generator.
 */
export type AssetPreview =
  | { type: 'procedural'; seed: number; palette: string[]; style: string }
  | { type: 'image'; url: string }

export interface AssetVersion {
  id: ID
  prompt: string
  preview: AssetPreview
  note?: string
  createdAt: Timestamp
}

export interface Slide {
  id: ID
  title: string
  body: string
  layout: 'title' | 'bullets' | 'quote' | 'image' | 'split'
  notes?: string
}

export interface Asset {
  id: ID
  kind: AssetKind
  title: string
  prompt: string
  projectId: ID | null
  boardId: ID | null
  status: 'generating' | 'ready' | 'failed'
  generator: { id: string; label: string; simulated: boolean }
  /** Kind-specific parameters: aspect, style, durationSec, voice, slideCount… */
  params: Record<string, unknown>
  versions: AssetVersion[]
  currentVersion: number
  /** Markdown for documents/copy. */
  content?: string
  slides?: Slide[]
  tags: string[]
  favorite?: boolean
  runId?: ID
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface Board {
  id: ID
  name: string
  description?: string
  projectId: ID | null
  createdAt: Timestamp
}
