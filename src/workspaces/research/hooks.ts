import { useCallback } from 'react'
import { useSearchParams } from 'react-router'
import { setSelection, useShellStore } from '@/app/shell/store'
import { useShellLayout } from '@/app/templates'
import { useRow } from '@/core/db'
import { useSettings } from '@/core/settings'
import { isRunActive, type ID, type Investigation, type Run } from '@/core/types'

/** The investigation's latest run (live; re-renders only when that run changes). */
export function useLatestRun(inv: Pick<Investigation, 'runIds'> | undefined): Run | undefined {
  return useRow('runs', inv?.runIds[inv.runIds.length - 1])
}

/** The latest run when it is still in progress (queued, running, waiting or paused). */
export function useActiveRun(inv: Pick<Investigation, 'runIds'> | undefined): Run | undefined {
  const run = useLatestRun(inv)
  return run && isRunActive(run.status) ? run : undefined
}

export const SOURCE_PARAM = 'source'

/**
 * Select a source: Inspector › Item shows its lens panel (content summary and honest notes), and
 * `?source=` keeps the selection in the URL (§2.6). Any open peek is closed so the source is on top.
 */
export function useSelectSource(): (sourceId: ID) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (sourceId: ID) => {
      const st = useShellStore.getState()
      st.clearInspect()
      setSelection({ kind: 'source', id: sourceId })
      st.setInspector('research', { open: true, tab: 'item' })
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.set(SOURCE_PARAM, sourceId)
          next.delete('inspect')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )
}

/** The selected source (only while the selection belongs to Research). */
export function useSelectedSourceId(): ID | null {
  return useShellStore((s) => (s.selectionPath === 'research' && s.selection?.kind === 'source' ? s.selection.id : null))
}

/** Simulation speed (Settings › Simulator): expectations are shown at the current speed. */
export function useSimSpeed(): number {
  return useSettings((s) => s.simulation?.speed ?? 1)
}

/** The stage is wide enough for the three-column board (Plan · Sources · Findings): their minimums need ~1040px. */
export function useBoardColumns(): boolean {
  const layout = useShellLayout()
  return layout.formFactor !== 'phone' && layout.docking.stageWidth >= 1040
}
