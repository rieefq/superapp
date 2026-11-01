import type { ActorRef, EntityRef, Hue, ID, Timestamp } from './common'

export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived'

export interface Milestone {
  id: ID
  title: string
  description?: string
  dueAt?: Timestamp
  status: 'upcoming' | 'active' | 'done'
}

export interface Project {
  id: ID
  name: string
  description: string
  /** The outcome this project exists to achieve; shown prominently and fed to AI as context. */
  goal?: string
  /** Project-level instructions prepended to every AI request made inside this project. */
  instructions?: string
  hue: Hue
  /** Lucide icon name. */
  icon: string
  status: ProjectStatus
  starred?: boolean
  milestones: Milestone[]
  /** Project memory: entities that are always in context while this project is in scope. */
  pinnedRefs: EntityRef[]
  repoIds: ID[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'cancelled'
export type Priority = 'urgent' | 'high' | 'medium' | 'low' | 'none'

export interface Subtask {
  id: ID
  title: string
  done: boolean
}

export interface Task {
  id: ID
  projectId: ID | null
  title: string
  /** Markdown. */
  description?: string
  status: TaskStatus
  priority: Priority
  /** A human (the user) or an agent. Agents execute assigned tasks as runs. */
  assignee: ActorRef | null
  milestoneId?: ID
  dueAt?: Timestamp
  labels: string[]
  subtasks: Subtask[]
  /** Where this task came from (a message, report, run, …). */
  origin?: EntityRef
  /** Runs executed for this task, most recent last. */
  runIds: ID[]
  /** Sort order within its status column. */
  order: number
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt?: Timestamp
}
