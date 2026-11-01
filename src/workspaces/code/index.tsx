import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function CodeWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
