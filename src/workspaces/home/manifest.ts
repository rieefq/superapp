import { House } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'home',
  label: 'Home',
  description: 'What needs you, what is moving, and where to pick up.',
  icon: House,
  group: 'home',
  path: '/',
  chord: ['g', 'h'],
}
