import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function ProjectsWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
