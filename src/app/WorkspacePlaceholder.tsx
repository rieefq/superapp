import type { WorkspaceManifest } from './types'

/** Temporary placeholder rendered until a workspace is implemented. */
export function WorkspacePlaceholder({ manifest }: { manifest: WorkspaceManifest }) {
  const Icon = manifest.icon
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Icon aria-hidden className="size-8 opacity-60" />
      <h1 className="text-xl font-semibold">{manifest.label}</h1>
      <p className="max-w-sm text-sm opacity-70">{manifest.description}</p>
    </div>
  )
}
