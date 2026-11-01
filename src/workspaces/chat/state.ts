import { create } from 'zustand'
import type { ID } from '@/core/types'

/**
 * Chat's view state that is not data: which message is being edited, which one is highlighted
 * (`?m=`), and unsent drafts per conversation (kept in memory while you switch threads).
 */
interface ChatUiState {
  /** The user message open in the inline editor. */
  editingId: ID | null
  /** A message to scroll to and highlight once. */
  highlightId: ID | null
  /** Unsent composer drafts by thread id ('new' for a new conversation). */
  drafts: Record<string, string>
  setEditing: (id: ID | null) => void
  setHighlight: (id: ID | null) => void
  setDraft: (key: string, text: string) => void
}

export const useChatUi = create<ChatUiState>()((set) => ({
  editingId: null,
  highlightId: null,
  drafts: {},
  setEditing: (id) => set((s) => (s.editingId === id ? s : { editingId: id })),
  setHighlight: (id) => set((s) => (s.highlightId === id ? s : { highlightId: id })),
  setDraft: (key, text) =>
    set((s) => {
      if ((s.drafts[key] ?? '') === text) return s
      const drafts = { ...s.drafts }
      if (text) drafts[key] = text
      else delete drafts[key]
      return { drafts }
    }),
}))

export const draftKey = (threadId: ID | null | undefined) => threadId ?? 'new'
