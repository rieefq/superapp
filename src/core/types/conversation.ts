import type { EntityRef, ID, Timestamp, Usage } from './common'

export interface Thread {
  id: ID
  title: string
  projectId: ID | null
  /** Model used for the latest turn; new turns default to it. */
  modelId: string
  /** Ordered message ids. */
  messageIds: ID[]
  /** Context explicitly attached to this conversation (knowledge, files, sources, repos…). */
  contextRefs: EntityRef[]
  pinned?: boolean
  archived?: boolean
  forkedFrom?: { threadId: ID; messageId: ID }
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'complete' | 'error' | 'stopped'

export interface Attachment {
  id: ID
  name: string
  mime: string
  size: number
  kind: 'text' | 'image' | 'pdf' | 'other'
  /** Extracted text (truncated) for text-like files. */
  text?: string
  /** Small preview data URL for images. */
  previewUrl?: string
  /** If the file was also saved to Knowledge. */
  knowledgeId?: ID
}

export interface Citation {
  id: ID
  ref: EntityRef
  title: string
  snippet?: string
  url?: string
}

/** A visible trace of a tool the model used while answering (retrieval, web search…). */
export interface ToolTrace {
  id: ID
  name: string
  label: string
  status: 'running' | 'done' | 'error'
  detail?: string
  results?: EntityRef[]
  simulated?: boolean
}

export interface Message {
  id: ID
  threadId: ID
  role: MessageRole
  /** Markdown. */
  content: string
  status: MessageStatus
  createdAt: Timestamp
  modelId?: string
  providerId?: string
  /** True when produced by the local simulator rather than a real model. */
  simulated?: boolean
  attachments?: Attachment[]
  citations?: Citation[]
  /** Model reasoning summary, when the provider returns one. */
  reasoning?: string
  tools?: ToolTrace[]
  usage?: Usage
  error?: string
  runId?: ID
  feedback?: 'up' | 'down'
  /** Entities created from this message (tasks, investigations, notes…), for backlinks. */
  derived?: EntityRef[]
}
