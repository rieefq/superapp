import { useShellStore } from '@/app/shell/store'
import { StartSheet } from './StartSheet'

/**
 * The Start sheet bound to `useShellStore().startSheet` — mounted once by the shell.
 * Open it from anywhere with `openStartSheet(kind, { source, prefill, background })`.
 */
export function StartSheetHost() {
  const sheet = useShellStore((s) => s.startSheet)
  const closeStart = useShellStore((s) => s.closeStart)
  return (
    <StartSheet
      open={sheet.open}
      onOpenChange={(open) => !open && closeStart()}
      kind={sheet.kind}
      source={sheet.source}
      prefill={sheet.prefill}
      background={sheet.background}
    />
  )
}
