import { useEffect, useRef, useState, type RefObject } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { DropOverlay } from '@/app/components'
import { useScope } from '@/core/context'
import { toast } from '@/ui'
import { ItemRoute } from './item'
import { RetrievalLab } from './lab'
import { LibraryView } from './library'
import { parseLibraryParams, sectionHref } from './model'
import { uploadFiles } from './uploads'

type DropState = 'none' | 'workspace' | 'composer'

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
const inComposer = (e: DragEvent) => !!(e.target as Element | null)?.closest?.('[data-composer]')

/**
 * Drop files anywhere in the workspace (§6.7). A drop on a composer attaches to that composer instead
 * (the composer handles it), so a file is never both attached and imported.
 */
function useWorkspaceDrop(target: RefObject<HTMLElement | null>, onFiles: (files: File[]) => void): DropState {
  const [state, setState] = useState<DropState>('none')
  const depth = useRef(0)
  const handler = useRef(onFiles)
  handler.current = onFiles
  useEffect(() => {
    const el = target.current
    if (!el) return
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setState(inComposer(e) ? 'composer' : 'workspace')
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
      setState(inComposer(e) ? 'composer' : 'workspace')
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setState('none')
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth.current = 0
      setState('none')
      if (inComposer(e)) return
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length) handler.current(files)
    }
    el.addEventListener('dragenter', onEnter)
    el.addEventListener('dragover', onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop', onDrop)
    return () => {
      el.removeEventListener('dragenter', onEnter)
      el.removeEventListener('dragover', onOver)
      el.removeEventListener('dragleave', onLeave)
      el.removeEventListener('drop', onDrop)
      depth.current = 0
    }
  }, [target])
  return state
}

/**
 * Knowledge (§6.7): the shared memory layer — everything you keep, searchable locally, retrievable by
 * every AI action, with provenance. Library template: `/knowledge` (library), `/knowledge/:id` (reader
 * and editor), `/knowledge/new` (a draft note) and `/knowledge/retrieval` (the retrieval lab).
 */
export default function KnowledgeWorkspace() {
  const rootRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const scope = useScope()

  const drop = useWorkspaceDrop(rootRef, (files) => {
    const onLibrary = location.pathname.replace(/\/+$/, '') === '/knowledge'
    const section = onLibrary ? parseLibraryParams(new URLSearchParams(location.search)).section : null
    const collectionId = section?.type === 'collection' ? section.id : null
    void uploadFiles(files, { collectionId, projectId: scope }).then((items) => {
      // The library shows per-file progress rows; elsewhere a toast says where the files went.
      if (onLibrary || !items.length) return
      const one = items.length === 1
      toast({
        tone: 'success',
        title: one ? `Added “${items[0].title}” to Knowledge` : `Added ${items.length} files to Knowledge`,
        description: 'Read locally in your browser — never uploaded.',
        action: { label: 'Open', onClick: () => navigate(one ? `/knowledge/${encodeURIComponent(items[0].id)}` : sectionHref({ type: 'filter', id: 'uploads' })) },
      })
    })
  })

  return (
    <div ref={rootRef} className="h-full min-h-0" data-knowledge-root="">
      <Routes>
        <Route index element={<LibraryView />} />
        <Route path="retrieval" element={<RetrievalLab />} />
        <Route path=":itemId" element={<ItemRoute />} />
        <Route path="*" element={<LibraryView />} />
      </Routes>
      {drop === 'workspace' && <DropOverlay target={rootRef} label="Drop to add to Knowledge — read locally, never uploaded" />}
    </div>
  )
}
