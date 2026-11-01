import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function StudioWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
