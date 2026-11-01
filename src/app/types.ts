import type { ComponentType, LazyExoticComponent } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ID } from '@/core/types'

export type WorkspaceId =
  | 'home'
  | 'chat'
  | 'research'
  | 'code'
  | 'studio'
  | 'agents'
  | 'workflows'
  | 'projects'
  | 'knowledge'
  | 'insights'
  | 'integrations'
  | 'settings'

/** Navigation groups (see docs/DESIGN.md for labels and order). */
export type NavGroup = 'home' | 'think' | 'make' | 'delegate' | 'organize' | 'system'

export interface CommandContext {
  navigate: (to: string) => void
  /** Active project scope (null = all work). */
  scopeProjectId: ID | null
  /** Current pathname. */
  pathname: string
  /** Close the command center. */
  close: () => void
}

export interface Command {
  id: string
  title: string
  subtitle?: string
  icon?: LucideIcon
  /** Section heading in the command center, e.g. "Create", "Navigate", "Chat". */
  group: string
  keywords?: string[]
  /** Display-only shortcut hint, e.g. "G C" or "⌘N". */
  shortcut?: string
  /** Higher sorts first within the group when the query is empty. */
  priority?: number
  run: (ctx: CommandContext) => void | Promise<void>
}

export interface WorkspaceManifest {
  id: WorkspaceId
  label: string
  /** One-line purpose, shown in the rail flyout and command center. */
  description: string
  icon: LucideIcon
  group: NavGroup
  /** Route prefix, e.g. "/chat". */
  path: string
  /** Two-key "go to" chord, e.g. ['g', 'c']. */
  chord?: [string, string]
  /** Static commands contributed to the command center (keep this module light — it loads eagerly). */
  commands?: (ctx: CommandContext) => Command[]
}

export interface WorkspaceModule {
  manifest: WorkspaceManifest
  Component: LazyExoticComponent<ComponentType>
}
