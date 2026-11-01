import { useEffect } from 'react'
import { useDB } from '@/core/db'
import { resolveIn } from '@/core/services'
import { useShellStore } from './store'
import { useShellLayout } from './context'
import { useNeedsYouCount } from './signals'
import { useActivityState, useFavicon } from '@/ui'

/** `(n) {Item} — {Workspace} · Atrium` (§3.8); (n) is the needs-you count, shown only when > 0. */
export function documentTitle(count: number, item: string | undefined, workspace: string): string {
  const prefix = count > 0 ? `(${count}) ` : ''
  return `${prefix}${item ? `${item} — ` : ''}${workspace} · Atrium`
}

/** Keeps the tab title and favicon (idle · working · waiting) in step with the app (§3.8, §5.4.1). */
export function TabPresence() {
  const { workspace } = useShellLayout()
  const count = useNeedsYouCount()
  const state = useActivityState()
  const primary = useShellStore((s) => s.stagePrimary)
  const item = useDB((s) => {
    if (!primary) return undefined
    const resolved = resolveIn(s, primary)
    return resolved.exists ? resolved.title : undefined
  })

  useEffect(() => {
    document.title = documentTitle(count, item, workspace.label)
  }, [count, item, workspace.label])

  useFavicon(state)

  return null
}
