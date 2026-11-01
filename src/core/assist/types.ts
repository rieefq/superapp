import type { Tables } from '@/core/db'
import type {
  Agent, AssetKind, Capability, EntityRef, ID, IntegrationConnection, Run, Tone, WorkflowEdge, WorkflowNode, WorkflowTrigger,
} from '@/core/types'

/**
 * Assist heuristics are deterministic rules over workspace state — not AI. The UI labels
 * everything produced here as a suggestion derived from workspace state.
 */

// ---------------------------------------------------------------- next actions

export type NextActionKind = 'review' | 'approve' | 'retry' | 'reconnect' | 'due' | 'resume' | 'idle-agent'

export interface NextAction {
  /** Stable id (rule + entity), usable as a React key and for dismissals. */
  id: string
  title: string
  /** One line explaining why this is suggested, built from workspace state. */
  reason: string
  /** The entity the action is about (absent for aggregates such as “Decide on 3 approvals”). */
  ref?: EntityRef
  /** Short button text, e.g. "Review changes". */
  actionLabel: string
  /** Where the action happens in the app. */
  route: string
  /** 0..100, higher first. Results are already sorted by it. */
  priority: number
  kind: NextActionKind
}

export interface NextActionsState {
  tables: Tables
  /** Epoch ms used for every time comparison (pass a fixed value for determinism). */
  now: number
  /** Active project scope; null = all work. */
  scopeProjectId: ID | null
}

export interface NextActionsOptions {
  /** Maximum number of suggestions (default 10). */
  limit?: number
}

export interface NextActionKindMeta {
  label: string
  /** lucide-react icon name (all present in the `@/ui` DynamicIcon map). */
  icon: string
  tone: Tone
}

// ---------------------------------------------------------------- agents & repos

export interface AgentPick {
  agentId: ID
  /** Heuristic match score (higher is better; ≥ 2 to be returned). */
  score: number
  /** Human-readable explanation, e.g. "Scout (Research analyst) can search the web — fits “research”." */
  reason: string
  /** The main capability that matched, when one did (useful for workflow agent steps). */
  capability?: Capability
}

export interface PickAgentOptions {
  /** Run history; ties are broken by each agent's success rate over its last 10 finished runs. */
  runs?: readonly Run[]
  /** Surrounding text (e.g. the whole workflow description); its cues count at half weight. */
  context?: string
}

// ---------------------------------------------------------------- studio

export interface CreateKind {
  kind: AssetKind
  /** The request with the lead-in ("Make an image of …") removed, capitalized. */
  prompt: string
  /** The word that decided the kind; absent when the image default applied. */
  cue?: string
}

// ---------------------------------------------------------------- workflows

export interface WorkflowDraftContext {
  agents: readonly Agent[]
  connections: readonly IntegrationConnection[]
  /** Optional run history for agent tie-breaks. */
  runs?: readonly Run[]
  /** Prefix for node and edge ids (default: derived from the text, so drafts are deterministic). */
  idPrefix?: string
}

export interface WorkflowDraft {
  name: string
  description: string
  trigger: WorkflowTrigger
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  /** Why each choice was made (agent picks, integration defaults, assumptions). Show these next to the draft. */
  notes: string[]
}

export interface TriggerEventInfo {
  event: string
  integrationId?: string
  /** Human text, e.g. "When a Gmail message arrives". */
  label: string
}
