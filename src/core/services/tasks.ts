import type { ActorRef, EntityRef, ID, Priority, Task, TaskStatus } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export interface CreateTaskInput {
  title: string
  projectId?: ID | null
  description?: string
  priority?: Priority
  status?: TaskStatus
  assignee?: ActorRef | null
  dueAt?: number
  labels?: string[]
  origin?: EntityRef
  milestoneId?: ID
}

export function createTask(input: CreateTaskInput): Task {
  void input
  throw new Error('createTask not implemented yet')
}
