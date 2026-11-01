import { MessagesSquare } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'chat',
  label: 'Chat',
  description: 'Think out loud with AI — and turn conversations into action.',
  icon: MessagesSquare,
  group: 'think',
  path: '/chat',
  chord: ['g', 'c'],
}
