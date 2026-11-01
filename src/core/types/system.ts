import type { ActorRef, EntityRef, Hue, ID, Timestamp, Tone } from './common'
import type { Autonomy, Capability } from './permissions'

export type NotificationKind =
  | 'run.completed'
  | 'run.failed'
  | 'approval.requested'
  | 'approval.resolved'
  | 'task.assigned'
  | 'task.due'
  | 'integration.error'
  | 'knowledge.added'
  | 'system'

export interface Notification {
  id: ID
  kind: NotificationKind
  title: string
  body?: string
  ref?: EntityRef
  tone: Tone
  createdAt: Timestamp
  readAt?: Timestamp
}

/** Append-only audit log: the transparent execution history of humans and agents. */
export interface ActivityEvent {
  id: ID
  at: Timestamp
  actor: ActorRef
  /** Past-tense verb: created, updated, completed, approved, rejected, ran, connected… */
  verb: string
  target: EntityRef
  /** One-line human summary, e.g. "Created task “Fix login redirect”". */
  summary: string
  projectId: ID | null
  meta?: Record<string, unknown>
}

export type LinkRel = 'derived_from' | 'produced' | 'references' | 'assigned_to' | 'related' | 'cites' | 'part_of'

/** Edge in the entity graph. `from` → `to`, e.g. task —derived_from→ message. */
export interface Link {
  id: ID
  from: EntityRef
  to: EntityRef
  rel: LinkRel
  createdAt: Timestamp
}

export interface ContextItem {
  ref: EntityRef
  addedAt: Timestamp
  /** 'user' when pinned explicitly, 'auto' when suggested by the current view. */
  source: 'user' | 'auto'
}

export type ThemePreference = 'dark' | 'light' | 'system'
export type Effort = 'low' | 'medium' | 'high'

export interface Settings {
  profile: { name: string; email?: string; hue: Hue }
  appearance: {
    theme: ThemePreference
    density: 'comfortable' | 'compact'
    reduceMotion: 'system' | 'reduce' | 'full'
    /** Single-key shortcuts (G-chords, N, P, !, [, ] …) outside text fields. */
    singleKeyShortcuts: boolean
  }
  ai: {
    defaultModelId: string
    effort: Effort
    showReasoning: boolean
    /** Automatically retrieve relevant knowledge for chat turns. */
    autoRetrieve: boolean
  }
  safety: {
    defaultAutonomy: Autonomy
    /** Capabilities that always require approval regardless of agent autonomy. */
    alwaysAsk: Capability[]
    confirmDestructive: boolean
    monthlyBudgetUsd: number
    /** Count simulated estimates toward spend and budget (default off). */
    countSimulatedSpend: boolean
  }
  notifications: {
    runCompleted: boolean
    runFailed: boolean
    approvals: boolean
    toasts: boolean
    /** Focus mode: no toasts for approvals (badges still update). */
    focusMode: boolean
    /** Browser notifications for approvals while the tab is hidden. */
    browser: boolean
  }
  simulation: {
    /** Multiplier on simulated step durations (1 = realistic, 4 = fast). */
    speed: number
  }
  onboarded: boolean
}
