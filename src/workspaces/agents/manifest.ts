import { Orbit } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'agents',
  label: 'Agents',
  description: 'Command center for autonomous agents and every run.',
  icon: Orbit,
  group: 'delegate',
  path: '/agents',
  chord: ['g', 'a'],
}
