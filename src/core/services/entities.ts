import type { EntityKind, EntityRef, Hue, ID } from '@/core/types'

/** STUB — replaced by the domain-services implementation (signatures are a contract). */
export type WorkspaceKey =
  | 'home' | 'chat' | 'research' | 'code' | 'studio' | 'agents' | 'workflows'
  | 'projects' | 'knowledge' | 'insights' | 'integrations' | 'settings'

export interface EntityMeta {
  label: string
  plural: string
  /** lucide-react icon name */
  icon: string
  workspace: WorkspaceKey
}

export const KIND_META = {} as Record<EntityKind, EntityMeta>

export interface ResolvedEntity {
  ref: EntityRef
  title: string
  subtitle?: string
  icon: string
  hue?: Hue
  status?: string
  route: string
  updatedAt?: number
  projectId?: ID | null
  exists: boolean
  simulated?: boolean
}

export function resolveEntity(ref: EntityRef): ResolvedEntity {
  return { ref, title: ref.id, icon: 'Circle', route: '/', exists: false }
}

export function entityRoute(ref: EntityRef): string {
  void ref
  return '/'
}

export function useEntity(ref: EntityRef): ResolvedEntity {
  return resolveEntity(ref)
}
