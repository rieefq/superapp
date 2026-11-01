/**
 * Shared primitives used by every domain type.
 *
 * Conventions:
 * - IDs are prefixed strings (`prj_…`, `tsk_…`) created by `newId(prefix)` in `@/lib/id`.
 * - Timestamps are epoch milliseconds.
 * - Anything AI-generated or connected through a non-live integration carries
 *   `simulated: true` so the UI can label it honestly.
 */

export type ID = string
export type Timestamp = number

/** Eight categorical identity hues, tuned per theme in tokens.css (`--hue-<name>`). */
export const HUES = ['volt', 'sky', 'violet', 'coral', 'amber', 'mint', 'rose', 'cyan'] as const
export type Hue = (typeof HUES)[number]

/** Every first-class object in the system. */
export type EntityKind =
  | 'project'
  | 'task'
  | 'thread'
  | 'message'
  | 'run'
  | 'approval'
  | 'agent'
  | 'workflow'
  | 'knowledge'
  | 'collection'
  | 'investigation'
  | 'source'
  | 'repo'
  | 'session'
  | 'asset'
  | 'board'
  | 'integration'

/** A pointer to any entity. The universal currency of context, links and mentions. */
export interface EntityRef {
  kind: EntityKind
  id: ID
}

export type ActorRef =
  | { type: 'user'; id: ID }
  | { type: 'agent'; id: ID }
  | { type: 'workflow'; id: ID }
  | { type: 'system'; id: 'system' }

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface Usage {
  inputTokens: number
  outputTokens: number
  /** Estimated USD cost computed from the model catalog's public pricing. */
  costUsd: number
}

export const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 }

/** The local single user. Multi-user auth can replace this later. */
export const ME: ActorRef = { type: 'user', id: 'usr_me' }

export function refKey(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`
}

export function sameRef(a: EntityRef | null | undefined, b: EntityRef | null | undefined): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id
}
