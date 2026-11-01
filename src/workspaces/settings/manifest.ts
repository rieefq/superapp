import { Settings2 } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'settings',
  label: 'Settings',
  description: 'Profile, appearance, models, safety and data.',
  icon: Settings2,
  group: 'system',
  path: '/settings',
  chord: ['g', ','],
}
