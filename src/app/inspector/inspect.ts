/**
 * `?inspect=<kind>:<id>` — the one global URL parameter (§2.6). It opens the entity in
 * Inspector › Item; chips inside the panel push onto the peek stack; browser Back pops it and,
 * once the parameter is gone, closes the Inspector.
 */
import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { KIND_META } from '@/core/services'
import type { EntityKind, EntityRef } from '@/core/types'
import { useShellStore } from '../shell/store'
import { workspaceForPath } from '../registry'
import type { WorkspaceId } from '../types'

export const INSPECT_PARAM = 'inspect'

/** Parse "knowledge:kno_lumen_prd" → { kind, id } (unknown kinds and empty ids → null). */
export function parseInspectParam(value: string | null | undefined): EntityRef | null {
  if (!value) return null
  const i = value.indexOf(':')
  if (i <= 0 || i === value.length - 1) return null
  const kind = value.slice(0, i) as EntityKind
  const id = value.slice(i + 1)
  if (!(kind in KIND_META)) return null
  return { kind, id }
}

export function formatInspectParam(ref: EntityRef): string {
  return `${ref.kind}:${ref.id}`
}

const same = (a: EntityRef | undefined | null, b: EntityRef | undefined | null) => !!a && !!b && a.kind === b.kind && a.id === b.id

/**
 * Keep the Inspector in sync with `?inspect=` (mount once, in the Shell):
 * - a new value opens Inspector › Item and pushes it onto the peek stack;
 * - going back to the previous value pops the stack;
 * - the parameter disappearing (Back) clears the stack and closes the Inspector when it was showing Item.
 */
export function useInspectParamSync(): void {
  const [params] = useSearchParams()
  const location = useLocation()
  const value = params.get(INSPECT_PARAM)
  const lastValue = useRef<string | null>(null)
  /** The workspace whose Inspector the parameter opened (Back closes that one, never another). */
  const openedIn = useRef<WorkspaceId | null>(null)

  useEffect(() => {
    const prev = lastValue.current
    lastValue.current = value
    const ws = workspaceForPath(location.pathname).id
    const st = useShellStore.getState()
    const ref = parseInspectParam(value)
    if (!ref) {
      if (prev && st.inspectStack.length) {
        st.clearInspect()
        const owner = openedIn.current ?? ws
        if ((st.inspector[owner]?.tab ?? 'item') === 'item') st.setInspector(owner, { open: false })
      }
      openedIn.current = null
      return
    }
    openedIn.current = ws
    const stack = st.inspectStack
    if (same(stack[stack.length - 1], ref)) {
      st.setInspector(ws, { open: true, tab: 'item' })
      return
    }
    if (same(stack[stack.length - 2], ref)) st.popInspect()
    else if (prev) st.pushInspect(ref)
    else {
      st.clearInspect()
      st.pushInspect(ref)
    }
    st.setInspector(ws, { open: true, tab: 'item' })
    // Only the parameter drives this effect; the pathname is read for the workspace id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
}

/** Open an entity in Inspector › Item from code (Space on a list row, "Inspect" actions). */
export function useInspectEntity(): (ref: EntityRef) => void {
  const [, setParams] = useSearchParams()
  return useCallback(
    (ref: EntityRef) => {
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.set(INSPECT_PARAM, formatInspectParam(ref))
        return next
      })
    },
    [setParams],
  )
}
