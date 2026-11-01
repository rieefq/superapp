import { lazy } from 'react'
import type { NavGroup, WorkspaceId, WorkspaceManifest, WorkspaceModule } from './types'
import { manifest as homeManifest } from '@/workspaces/home/manifest'
import { manifest as chatManifest } from '@/workspaces/chat/manifest'
import { manifest as researchManifest } from '@/workspaces/research/manifest'
import { manifest as codeManifest } from '@/workspaces/code/manifest'
import { manifest as studioManifest } from '@/workspaces/studio/manifest'
import { manifest as agentsManifest } from '@/workspaces/agents/manifest'
import { manifest as workflowsManifest } from '@/workspaces/workflows/manifest'
import { manifest as projectsManifest } from '@/workspaces/projects/manifest'
import { manifest as knowledgeManifest } from '@/workspaces/knowledge/manifest'
import { manifest as insightsManifest } from '@/workspaces/insights/manifest'
import { manifest as integrationsManifest } from '@/workspaces/integrations/manifest'
import { manifest as settingsManifest } from '@/workspaces/settings/manifest'

/** Every workspace. Manifests load eagerly (light); UIs load lazily per route. */
export const WORKSPACES: WorkspaceModule[] = [
  { manifest: homeManifest, Component: lazy(() => import('@/workspaces/home')) },
  { manifest: chatManifest, Component: lazy(() => import('@/workspaces/chat')) },
  { manifest: researchManifest, Component: lazy(() => import('@/workspaces/research')) },
  { manifest: codeManifest, Component: lazy(() => import('@/workspaces/code')) },
  { manifest: studioManifest, Component: lazy(() => import('@/workspaces/studio')) },
  { manifest: agentsManifest, Component: lazy(() => import('@/workspaces/agents')) },
  { manifest: workflowsManifest, Component: lazy(() => import('@/workspaces/workflows')) },
  { manifest: projectsManifest, Component: lazy(() => import('@/workspaces/projects')) },
  { manifest: knowledgeManifest, Component: lazy(() => import('@/workspaces/knowledge')) },
  { manifest: insightsManifest, Component: lazy(() => import('@/workspaces/insights')) },
  { manifest: integrationsManifest, Component: lazy(() => import('@/workspaces/integrations')) },
  { manifest: settingsManifest, Component: lazy(() => import('@/workspaces/settings')) },
]

export const MANIFESTS: WorkspaceManifest[] = WORKSPACES.map((w) => w.manifest)

export function getManifest(id: WorkspaceId): WorkspaceManifest {
  return MANIFESTS.find((m) => m.id === id)!
}

/** The workspace that owns a pathname (longest matching prefix). */
export function workspaceForPath(pathname: string): WorkspaceManifest {
  const match = MANIFESTS.filter((m) => m.path !== '/' && (pathname === m.path || pathname.startsWith(m.path + '/')))
    .sort((a, b) => b.path.length - a.path.length)[0]
  return match ?? getManifest('home')
}

export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: 'home', label: '' },
  { id: 'think', label: 'Think' },
  { id: 'make', label: 'Make' },
  { id: 'delegate', label: 'Delegate' },
  { id: 'organize', label: 'Organize' },
  { id: 'system', label: 'System' },
]
