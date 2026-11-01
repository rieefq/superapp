import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { createKnowledge, updateKnowledge, type KnowledgePatch } from '@/core/services'
import { db } from '@/core/db'
import type { ID, KnowledgeItem } from '@/core/types'
import { Button, Markdown, SegmentedControl, Textarea } from '@/ui'
import { cn } from '@/lib/cn'
import { countWords, titleFromContent } from './model'

/**
 * The note editor (§6.7 Edit mode): a Markdown textarea (`mono`) with a Preview toggle, side by side when
 * the stage is wide. Autosaves while you type (and when you leave); one editing session reads as one
 * "Edited" line in History. A draft (`/knowledge/new`) becomes an item on its first words.
 */

export const AUTOSAVE_MS = 700

export type SaveStatus = 'idle' | 'dirty' | 'saved' | 'error'

export interface NoteEditor {
  draft: string
  setDraft: (text: string) => void
  status: SaveStatus
  savedAt: number | null
  /** Save now (Done, leaving, page hide). */
  flush: () => void
  /** Stop syncing the title from the first line (the user renamed it). */
  lockTitle: () => void
}

export interface NoteEditorOptions {
  item: KnowledgeItem | undefined
  /** A draft: nothing exists until the first words. */
  isNew: boolean
  /** Where a draft is filed. */
  collectionId?: ID | null
  projectId?: ID | null
  /** The draft became an item. */
  onCreated?: (id: ID) => void
}

export function useNoteEditor({ item, isNew, collectionId, projectId, onCreated }: NoteEditorOptions): NoteEditor {
  const [draft, setDraftState] = useState(() => item?.content ?? '')
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const draftRef = useRef(draft)
  const idRef = useRef<ID | null>(item?.id ?? null)
  const dirtyRef = useRef(false)
  /** The first save of a session logs "Edited"; the rest are silent. */
  const loggedRef = useRef(false)
  /** A note started here keeps its title in step with its first line until renamed. */
  const autoTitleRef = useRef(isNew)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opts = useRef({ collectionId, projectId, onCreated })
  opts.current = { collectionId, projectId, onCreated }

  const save = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!dirtyRef.current) return
    const text = draftRef.current
    try {
      const id = idRef.current
      if (!id) {
        if (!text.trim()) return
        const { collectionId: col, projectId: prj, onCreated: created } = opts.current
        const note = createKnowledge({
          title: titleFromContent(text) || 'Untitled note',
          content: text,
          kind: 'note',
          collectionId: col ?? null,
          projectIds: prj ? [prj] : [],
        })
        idRef.current = note.id
        loggedRef.current = true // "Added … to Knowledge" opens the session's history
        dirtyRef.current = false
        setStatus('saved')
        setSavedAt(Date.now())
        created?.(note.id)
        return
      }
      const cur = db.get('knowledge', id)
      if (!cur) {
        setStatus('error')
        return
      }
      const patch: KnowledgePatch = {}
      if (cur.content !== text) patch.content = text
      if (autoTitleRef.current) {
        const title = titleFromContent(text)
        if (title && title !== cur.title) patch.title = title
      }
      if (Object.keys(patch).length) {
        updateKnowledge(id, patch, { silent: loggedRef.current })
        loggedRef.current = true
      }
      dirtyRef.current = false
      setStatus('saved')
      setSavedAt(Date.now())
    } catch {
      setStatus('error')
    }
  }, [])

  const setDraft = useCallback(
    (text: string) => {
      draftRef.current = text
      dirtyRef.current = true
      setDraftState(text)
      setStatus('dirty')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(save, AUTOSAVE_MS)
    },
    [save],
  )

  // Adopt outside changes (another tab, a rename that rewrote content) while nothing is pending here.
  const itemContent = item?.content
  useEffect(() => {
    if (itemContent === undefined || dirtyRef.current || itemContent === draftRef.current) return
    draftRef.current = itemContent
    setDraftState(itemContent)
  }, [itemContent])

  // Save when leaving (route change, Done, closing the tab).
  useEffect(() => {
    const onHide = () => save()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      save()
    }
  }, [save])

  return { draft, setDraft, status, savedAt, flush: save, lockTitle: () => (autoTitleRef.current = false) }
}

function statusText(status: SaveStatus, savedAt: number | null, isNew: boolean): string {
  if (status === 'error') return 'Couldn’t save — this item was deleted'
  if (status === 'dirty') return 'Editing…'
  if (status === 'saved' && savedAt) return `Saved ${new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return isNew ? 'Saves as you type' : 'Saved'
}

/** The editor's bar (the stage toolbar row): Write | Preview, words, save state, Done. */
export function EditorBar({
  editor,
  mode,
  onMode,
  sideBySide,
  isNew,
  onDone,
}: {
  editor: NoteEditor
  mode: 'write' | 'preview'
  onMode: (mode: 'write' | 'preview') => void
  sideBySide: boolean
  isNew: boolean
  onDone: () => void
}) {
  const words = countWords(editor.draft)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {!sideBySide && (
        <SegmentedControl
          size="sm"
          aria-label="Editor view"
          value={mode}
          onValueChange={onMode}
          options={[
            { value: 'write', label: 'Write' },
            { value: 'preview', label: 'Preview' },
          ]}
        />
      )}
      {sideBySide && <span className="type-label text-ink-3">Markdown · Preview</span>}
      <span className="type-meta text-ink-3 tabular max-sm:hidden">
        {words.toLocaleString('en-US')} word{words === 1 ? '' : 's'}
      </span>
      <span className="flex-1" />
      <span
        role="status"
        aria-live="polite"
        className={cn('type-meta flex items-center gap-1.5 whitespace-nowrap', editor.status === 'error' ? 'text-fail-ink' : 'text-ink-3')}
        data-save-status={editor.status}
      >
        {editor.status === 'saved' && <Check aria-hidden className="size-3" strokeWidth={2.25} />}
        {statusText(editor.status, editor.savedAt, isNew)}
      </span>
      <Button size="sm" variant="secondary" onClick={onDone} kbd="escape">
        Done
      </Button>
    </div>
  )
}

/** The writing surface: textarea, preview, or both side by side. */
export function EditorBody({
  editor,
  mode,
  sideBySide,
  autoFocus,
  placeholder,
}: {
  editor: NoteEditor
  mode: 'write' | 'preview'
  sideBySide: boolean
  autoFocus?: boolean
  placeholder?: string
}) {
  const showWrite = sideBySide || mode === 'write'
  const showPreview = sideBySide || mode === 'preview'
  return (
    <div className={cn('grid min-h-[60vh] gap-6', sideBySide && 'grid-cols-2 gap-8')}>
      {showWrite && (
        <Textarea
          value={editor.draft}
          onValueChange={editor.setDraft}
          autosize
          minRows={22}
          maxRows={100000}
          autoFocus={autoFocus}
          spellCheck
          placeholder={placeholder ?? 'Write in Markdown — # for headings, - for lists, **bold**'}
          aria-label="Content (Markdown)"
          data-knowledge-editor=""
          className="type-mono rounded-md border-line bg-raised px-4 py-3.5 text-ink placeholder:text-ink-3"
        />
      )}
      {showPreview && (
        <div className={cn('min-w-0', sideBySide && 'border-l border-line pl-8')} aria-label="Preview">
          {editor.draft.trim() ? (
            <Markdown prose="doc">{editor.draft}</Markdown>
          ) : (
            <p className="type-body-sm pt-3 text-ink-3">Nothing to preview yet.</p>
          )}
        </div>
      )}
    </div>
  )
}
