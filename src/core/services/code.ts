import type { CodeSession, EntityRef, ID } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signature is a contract). */
export interface CreateSessionInput {
  repoId: ID
  prompt: string
  title?: string
  projectId?: ID | null
  taskId?: ID
  agentId?: ID
  origin?: EntityRef
}

export function createSession(input: CreateSessionInput): CodeSession {
  void input
  throw new Error('createSession not implemented yet')
}
