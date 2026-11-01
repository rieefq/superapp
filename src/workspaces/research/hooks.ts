import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { setSelection, useShellStore } from '@/app/shell/store'
import { useShellLayout } from '@/app/templates'
import { useDB, useRow } from '@/core/db'
import { useSettings } from '@/core/settings'
import { isRunActive, type ID, type Investigation, type Run, type Source } from '@/core/types'
import { readingSourceIds } from './logic'

/** The investigation's latest run (live; re-renders only when that run changes). */
export function useLatestRun(inv: Pick<Investigation, 'runIds'> | undefined): Run | undefined {
  return useRow('runs', inv?.runIds[inv.runIds.length - 1])
}

/** The latest run when it is still in progress (queued, running, waiting or paused). */
export function useActiveRun(inv: Pick<Investigation, 'runIds'> | undefined): Run | undefined {
  const run = useLatestRun(inv)
  return run && isRunActive(run.status) ? run : undefined
}

const NO_IDS: ReadonlySet<ID> = new Set()

/**
 * Sources being read right now (the running browse step's pages). Subscribes to that step only, so
 * the many small updates of a running run don't re-render source lists.
 */
export function useReadingIds(runId: ID | undefined, sources: readonly Source[]): ReadonlySet<ID> {
  const key = useDB((s) => {
    const run = runId ? s.runs[runId] : undefined
    if (!run || !isRunActive(run.status)) return ''
    const step = run.steps.find((x) => x.status === 'running' && (x.tool === 'web.browse' || x.kind === 'browse'))
    return step ? `${step.id}\n${step.input ?? ''}` : ''
  })
  return useMemo(() => {
    if (!key) return NO_IDS
    const input = key.slice(key.indexOf('\n') + 1)
    return readingSourceIds({ steps: [{ id: 'reading', kind: 'browse', tool: 'web.browse', title: '', status: 'running', input }] }, sources)
  }, [key, sources])
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
