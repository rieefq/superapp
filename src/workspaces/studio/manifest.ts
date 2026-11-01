import { Palette } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'studio',
  label: 'Studio',
  description: 'Create images, video, decks and copy with generative tools.',
  icon: Palette,
  group: 'make',
  path: '/studio',
  chord: ['g', 's'],
}
