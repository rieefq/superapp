import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router'
import { X } from 'lucide-react'
import type { InspectorTab } from '../types'
import { IconButton, Tabs } from '@/ui'
import { useShellStore } from '../shell/store'
import { useShellLayout } from '../shell/context'
import { INSPECT_PARAM } from './inspect'
import { RunTab } from './RunTab'
import { ItemTab } from './ItemTab'
import { ContextTab } from './ContextTab'

const TABS: { value: InspectorTab; label: string }[] = [
  { value: 'run', label: 'Run' },
  { value: 'item', label: 'Item' },
  { value: 'context', label: 'Context' },
]

/** The tab the Inspector shows for the current workspace (remembered per workspace). */
export function useInspectorTab(): InspectorTab {
  const { workspace } = useShellLayout()
  return useShellStore((s) => s.inspector[workspace.id]?.tab) ?? workspace.defaultInspectorTab ?? 'item'
}

/**
 * The Inspector (§3.5): Run · Item · Context, always in that order, plus close. The frame is the
 * same in every placement (docked, floating, tablet sheet, phone bottom sheet); the Shell decides
 * the placement with the docking rule.
 */
export function Inspector({ onClose, headerExtra }: { onClose?: () => void; headerExtra?: ReactNode }) {
  const { workspace } = useShellLayout()
  const tab = useInspectorTab()
  const setInspector = useShellStore((s) => s.setInspector)
  const [params, setParams] = useSearchParams()

  const close = () => {
    setInspector(workspace.id, { open: false })
    if (params.has(INSPECT_PARAM)) {
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete(INSPECT_PARAM)
          return next
        },
        { replace: true },
      )
    }
    onClose?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-inspector-tab={tab}>
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-3">
        {headerExtra}
        <Tabs
          items={TABS}
          value={tab}
          size="md"
          onValueChange={(v) => setInspector(workspace.id, { tab: v as InspectorTab, open: true })}
          aria-label="Inspector"
          className="min-w-0 flex-1 gap-4 border-b-0"
        />
        <IconButton icon={X} label="Close Inspector" shortcut="mod+\" size="sm" onClick={close} tooltipPlacement="bottom" />
      </header>
      <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'run' ? <RunTab /> : tab === 'item' ? <ItemTab /> : <ContextTab />}
      </div>
    </div>
  )
}
