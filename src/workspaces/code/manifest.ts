import { SquareCode } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'code',
  label: 'Code',
  description: 'Delegate software work to coding agents and review their changes.',
  icon: SquareCode,
  group: 'make',
  path: '/code',
  chord: ['g', 'x'],
}
