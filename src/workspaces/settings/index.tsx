import { WorkspacePlaceholder } from '@/app/WorkspacePlaceholder'
import { manifest } from './manifest'

export default function SettingsWorkspace() {
  return <WorkspacePlaceholder manifest={manifest} />
}
