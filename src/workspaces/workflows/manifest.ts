import { Workflow } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'workflows',
  label: 'Workflows',
  description: 'Design and monitor automations across your tools.',
  icon: Workflow,
  group: 'delegate',
  path: '/workflows',
  chord: ['g', 'w'],
}
