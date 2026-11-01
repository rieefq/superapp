import { FolderKanban } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'projects',
  label: 'Projects',
  description: 'Goals, tasks and milestones — for you and your agents.',
  icon: FolderKanban,
  group: 'organize',
  path: '/projects',
  chord: ['g', 'p'],
}
