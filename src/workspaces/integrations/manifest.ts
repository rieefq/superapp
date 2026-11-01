import { Plug } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'integrations',
  label: 'Integrations',
  description: 'Connect services and control what agents may do with them.',
  icon: Plug,
  group: 'system',
  path: '/integrations',
  chord: ['g', 'n'],
}
