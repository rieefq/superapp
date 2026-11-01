import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function WorkflowsWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
