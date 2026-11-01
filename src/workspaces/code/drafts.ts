import { create } from 'zustand'
import type { ID } from '@/core/types'

/**
 * The session composer's draft, per session, so other parts of the session view can add to it:
 * "Ask about this file" (Files), a clicked diff line number (`path:line`, Changes). Not persisted.
 */
interface DraftStore {
  drafts: Record<ID, string>
  /** Bumped on every insert so the composer focuses itself (and phones switch to Activity). */
  focusTick: number
  set: (sessionId: ID, text: string) => void
  insert: (sessionId: ID, text: string) => void
}

export const useSessionDrafts = create<DraftStore>((set) => ({
  drafts: {},
  focusTick: 0,
  set: (sessionId, text) => set((s) => (s.drafts[sessionId] === text ? s : { drafts: { ...s.drafts, [sessionId]: text } })),
  insert: (sessionId, text) =>
    set((s) => {
      const cur = s.drafts[sessionId] ?? ''
      const sep = !cur || /\s$/.test(cur) ? '' : ' '
      return { drafts: { ...s.drafts, [sessionId]: `${cur}${sep}${text}` }, focusTick: s.focusTick + 1 }
    }),
}))

export function insertIntoComposer(sessionId: ID, text: string): void {
  useSessionDrafts.getState().insert(sessionId, text)
}
