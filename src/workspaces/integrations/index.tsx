import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function IntegrationsWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
