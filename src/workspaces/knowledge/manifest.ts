import { Library } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'knowledge',
  label: 'Knowledge',
  description: 'The shared memory every AI action can draw from.',
  icon: Library,
  group: 'organize',
  path: '/knowledge',
  chord: ['g', 'k'],
}
