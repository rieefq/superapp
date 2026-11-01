import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function AgentsWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
