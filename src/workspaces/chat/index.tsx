import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function ChatWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
