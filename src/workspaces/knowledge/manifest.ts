import { FolderPlus, Layers, Library, Link2, ScanSearch, Upload } from 'lucide-react'
import type { Command, WorkspaceManifest } from '@/app/types'
import { newNoteHref, pickFiles } from './nav'

export const manifest: WorkspaceManifest = {
  id: 'knowledge',
  label: 'Knowledge',
  description: 'The shared memory every AI action can draw from.',
  icon: Library,
  group: 'organize',
  path: '/knowledge',
  chord: ['g', 'k'],
  newAction: {
    label: 'New note',
    run: (ctx) => {
      ctx.close()
      ctx.navigate(newNoteHref())
    },
  },
  defaultInspectorTab: 'item',
  // `newAction` already gives ⌘K its "New note" (N); these are the other ways in.
  commands: (): Command[] => [
    {
      id: 'knowledge.upload',
      title: 'Upload files to Knowledge',
      subtitle: 'Read locally in your browser — never uploaded',
      icon: Upload,
      group: 'Knowledge',
      keywords: ['knowledge', 'import', 'file', 'add', 'markdown', 'csv', 'pdf', 'image'],
      priority: 39,
      run: (ctx) => {
        ctx.close()
        // The picker opens inside this click; the import starts once files are chosen.
        pickFiles((files) => {
          void import('./uploads').then((m) => m.uploadFiles(files, { projectId: ctx.scopeProjectId }))
          ctx.navigate('/knowledge')
        })
      },
    },
    {
      id: 'knowledge.add-link',
      title: 'Add a link to Knowledge',
      subtitle: 'Saves the address and your notes — the page isn’t fetched',
      icon: Link2,
      group: 'Knowledge',
      keywords: ['knowledge', 'url', 'bookmark', 'web', 'save'],
      priority: 38,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/knowledge?add=link')
      },
    },
    {
      id: 'knowledge.lab',
      title: 'What would the AI retrieve?',
      subtitle: 'The retrieval lab: passages and scores for a question — no model is called',
      icon: ScanSearch,
      group: 'Knowledge',
      keywords: ['knowledge', 'retrieval', 'rag', 'context', 'search', 'lab', 'score'],
      priority: 37,
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/knowledge/retrieval')
      },
    },
    {
      id: 'knowledge.held',
      title: 'Show held knowledge',
      subtitle: 'Items that ride along in every new AI action',
      icon: Layers,
      group: 'Knowledge',
      keywords: ['knowledge', 'hold', 'holding', 'context'],
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/knowledge?filter=held')
      },
    },
    {
      id: 'knowledge.new-collection',
      title: 'New knowledge collection',
      subtitle: 'Group related items',
      icon: FolderPlus,
      group: 'Knowledge',
      keywords: ['knowledge', 'collection', 'folder', 'group'],
      run: (ctx) => {
        ctx.close()
        ctx.navigate('/knowledge?new=collection')
      },
    },
  ],
  shortcuts: [
    { keys: '/', label: 'Search Knowledge' },
    { keys: 'n', label: 'New note' },
    { keys: 'x', label: 'Select the focused item (⇧X selects a range)' },
    { keys: 'space', label: 'Inspect the focused item' },
    { keys: 'e', label: 'Edit the item' },
    { keys: 'h', label: 'Hold or release the item' },
    { keys: 't', label: 'Turn the item into…' },
    { keys: 'escape', label: 'Done editing · clear the selection' },
  ],
}
