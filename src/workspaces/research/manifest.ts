import { Telescope } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'research',
  label: 'Research',
  description: 'Investigate questions, gather sources, synthesize reports.',
  icon: Telescope,
  group: 'think',
  path: '/research',
  chord: ['g', 'r'],
}
