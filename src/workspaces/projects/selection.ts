import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useShellStore } from '@/app/shell/store'
import { TASK_PARAM } from './parts'

/**
 * `?task=<id>` is the selected task (§2.6: selections are query parameters). While it is set the task
 * is the shell selection, so Inspector › Item shows it (the task drawer). Clearing it — Back, or Esc,
 * which clears the shell selection — closes the Inspector again when it was showing the item.
 */
export function useTaskSelectionSync(): void {
  const [params, setParams] = useSearchParams()
  const taskId = params.get(TASK_PARAM)
  const previous = useRef<string | null>(null)
  const setParamsRef = useRef(setParams)
  setParamsRef.current = setParams

  useEffect(() => {
    const st = useShellStore.getState()
    const was = previous.current
    previous.current = taskId
    if (taskId) {
      st.setSelection({ kind: 'task', id: taskId })
      st.setInspector('projects', { open: true, tab: 'item' })
      return
    }
    if (!was) return
    const sel = st.selection
    if (sel?.kind === 'task' && sel.id === was) st.setSelection(null)
    if ((st.inspector.projects?.tab ?? 'item') === 'item' && !st.inspectStack.length) st.setInspector('projects', { open: false })
  }, [taskId])

  // Esc clears the shell selection: drop `?task=` with it (replace, so Back doesn't reopen it).
  useEffect(
    () =>
      useShellStore.subscribe((s, prev) => {
        const was = prev.selection
        if (!was || was.kind !== 'task' || s.selection) return
        const current = new URLSearchParams(window.location.search).get(TASK_PARAM)
        if (current !== was.id) return
        setParamsRef.current(
          (p) => {
            const next = new URLSearchParams(p)
            next.delete(TASK_PARAM)
            return next
          },
          { replace: true },
        )
      }),
    [],
  )

  // Leaving the view drops the task selection (a selection never outlives its view).
  useEffect(
    () => () => {
      const st = useShellStore.getState()
      if (st.selection?.kind === 'task') st.setSelection(null)
    },
    [],
  )
}
