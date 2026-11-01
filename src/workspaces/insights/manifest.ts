import { ChartNoAxesCombined } from 'lucide-react'
import type { WorkspaceManifest } from '@/app/types'

export const manifest: WorkspaceManifest = {
  id: 'insights',
  label: 'Insights',
  description: 'Runs, spend, model usage and reliability at a glance.',
  icon: ChartNoAxesCombined,
  group: 'system',
  path: '/insights',
  chord: ['g', 'i'],
}
