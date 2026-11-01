import type { Rng } from '@/lib/rng'
import type { ChatTurn } from '../types'
import type { KnowledgeDoc, ParsedFile, ParsedNote, PromptFacts } from '../prompt'
import type { Evidence } from './evidence'
import type { Subject } from './subject'

export type Depth = 'swift' | 'deep'

/** Everything a shape composer may draw on. All of it comes from the request itself. */
export interface ComposeContext {
  /** The user's typed request (attachments removed). */
  text: string
  subject: Subject
  rng: Rng
  depth: Depth
  /** Knowledge passages from the system prompt's <knowledge> block. */
  docs: KnowledgeDoc[]
  /** The most relevant sentences from docs and attached files. */
  evidence: Evidence[]
  files: ParsedFile[]
  notes: ParsedNote[]
  facts: PromptFacts
  /** Earlier turns of the conversation (excluding the request). */
  history: ChatTurn[]
}

export interface Block {
  md: string
  /** Lower priority blocks are dropped first when an answer runs long; Infinity is never dropped. */
  priority: number
  /** Closing lines stay last; padding is inserted before them. */
  closing?: boolean
}

/** Facts the reasoning trace reports about how the answer was built. */
export interface ApproachNotes {
  /** e.g. "a side-by-side table is the clearest format". */
  format: string
  /** e.g. "lead with the short answer, then the criteria, then a next step". */
  structure: string
}

export interface ComposedParts {
  blocks: Block[]
  /** Optional sections used when the answer is shorter than the target range. */
  extras?: Block[]
  approach: ApproachNotes
  /** Skip minimum-length padding (a summary should never be longer than needed). */
  noPadding?: boolean
}
