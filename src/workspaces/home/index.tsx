import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function HomeWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
