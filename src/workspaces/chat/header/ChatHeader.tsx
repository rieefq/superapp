import { memo, type Ref } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  CornerUpRight,
  Download,
  GitFork,
  Hash,
  Layers,
  Link2,
  ListChecks,
  NotebookPen,
  PencilLine,
  Pin,
  PinOff,
  Telescope,
  Trash2,
} from 'lucide-react'
import { ModelLabel, ModelPicker, ProjectPicker } from '@/app/components'
import { useInspectorTab } from '@/app/inspector/Inspector'
import { openStartSheet, useShellStore } from '@/app/shell/store'
import { switchScope } from '@/app/shell/scope'
import { StageHeader, useShellLayout } from '@/app/templates'
import { getModelInfo, renameThread, useModelAvailability } from '@/core/ai'
import { useScope } from '@/core/context'
import { db, useDB, type Tables } from '@/core/db'
import type { ID, Thread } from '@/core/types'
import { cn } from '@/lib/cn'
import { truncate } from '@/lib/format'
import { Button, HUE_FILL, Menu, Tag, Tooltip, type MenuItem } from '@/ui'
import {
  copyHandle,
  copyThreadLink,
  deleteWithConfirm,
  exportMarkdown,
  forkWhole,
  setArchived,
  threadRoute,
  togglePinned,
  turnInto,
} from '../actions'

/**
 * The stage header (§6.2): title (inline rename) · project chip (change project; "Switch project" when
 * the thread is outside the current scope) · "Forked from" · model chip · Context (Inspector › Context)
 * · thread-level Turn into… · ⋯ (pin, archive, fork, export Markdown, copy link/handle, delete).
 */
export interface ChatHeaderProps {
  thread?: Thread
  projectId: ID | null
  onProjectChange: (projectId: ID | null) => void
  modelId: string
  onModelChange: (modelId: string) => void
  /** Items switched on in the Context Line (what the next message will send). */
  contextCount: number
  onActionItems: () => void
}

export const ChatHeader = memo(function ChatHeader({ thread, projectId, onProjectChange, modelId, onModelChange, contextCount, onActionItems }: ChatHeaderProps) {
  const navigate = useNavigate()
  // Phones keep the title readable: the thread-level Turn into moves into the ⋯ menu.
  const phone = useShellLayout().formFactor === 'phone'
  const menu: MenuItem[] | undefined = thread
    ? [
        ...(phone ? [...turnIntoItems(thread, onActionItems), { type: 'separator' as const }] : []),
        { id: 'rename', label: 'Rename', icon: PencilLine, onSelect: startRename },
        { id: 'pin', label: thread.pinned ? 'Unpin' : 'Pin to the top', icon: thread.pinned ? PinOff : Pin, onSelect: () => togglePinned(thread.id) },
        {
          id: 'archive',
          label: thread.archived ? 'Unarchive' : 'Archive',
          icon: thread.archived ? ArchiveRestore : Archive,
          onSelect: () => setArchived(thread.id, !thread.archived),
        },
        { id: 'fork', label: 'Fork conversation', icon: GitFork, description: 'A copy you can take somewhere else', onSelect: () => forkWhole(thread.id, navigate) },
        { id: 'export', label: 'Export as Markdown', icon: Download, onSelect: () => exportMarkdown(thread.id) },
        { type: 'separator' },
        { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copyThreadLink(thread.id) },
        { id: 'handle', label: 'Copy handle', icon: Hash, onSelect: () => void copyHandle(thread.id) },
        { type: 'separator' },
        { id: 'delete', label: 'Delete…', icon: Trash2, danger: true, onSelect: () => void deleteWithConfirm(thread.id, { navigate, isOpen: true }) },
      ]
    : undefined

  return (
    <StageHeader
      title={thread?.title ?? 'New conversation'}
      onRename={thread ? (t) => renameThread(thread.id, t) : undefined}
      status={
        <span className="flex min-w-0 items-center gap-1.5">
          <ProjectChip projectId={projectId} onChange={onProjectChange} outOfScope={!!thread} />
          {thread?.forkedFrom && <ForkedFrom from={thread.forkedFrom} />}
          {thread?.archived && <Tag size="sm">Archived</Tag>}
        </span>
      }
      actions={
        <>
          <ModelChip value={modelId} onChange={onModelChange} />
          <ContextButton count={contextCount} threadId={thread?.id} />
          {thread && !phone && <ThreadTurnInto thread={thread} onActionItems={onActionItems} />}
        </>
      }
      menu={menu}
      // The shared title button is max-w-full inside a shrink-wrapped h1 with -mx-1.5, which clips its last
      // 12px; give it back the width its negative margins take (reported to the template owner).
      className="[&_h1>button]:max-w-[calc(100%+12px)]"
    />
  )
})

/** Put the header title into its inline editor (the title is a button that opens it). */
function startRename() {
  document.querySelector<HTMLButtonElement>('[data-region="stage"] header h1 button')?.click()
}

// ------------------------------------------------------------------------------------------------ project

function ProjectChip({ projectId, onChange, outOfScope }: { projectId: ID | null; onChange: (id: ID | null) => void; outOfScope: boolean }) {
  const scope = useScope()
  const project = useDB((s: Tables) => (projectId ? s.projects[projectId] : undefined))
  const elsewhere = outOfScope && !!scope && !!projectId && projectId !== scope
  return (
    <span className="flex min-w-0 items-center gap-1">
      <ProjectPicker
        value={projectId}
        onChange={onChange}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            ref={p.ref as Ref<HTMLButtonElement>}
            aria-label={`Project: ${project?.name ?? 'none'}. Move to another project`}
            className="inline-flex h-7 max-w-[200px] min-w-0 items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press data-[state=open]:text-ink"
          >
            {project ? (
              <span aria-hidden className={cn('size-2.5 shrink-0 rounded-[3px]', HUE_FILL[project.hue])} />
            ) : (
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px] border border-line-input" />
            )}
            <span className="truncate @max-[560px]:hidden">{project?.name ?? 'No project'}</span>
            <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
          </button>
        )}
      />
      {elsewhere && project && (
        <Tooltip content={`Make ${project.name} the current project`}>
          <button
            type="button"
            onClick={() => switchScope(project.id)}
            className="type-caption hidden h-7 shrink-0 items-center rounded-sm px-1 text-ink-3 underline decoration-line-input underline-offset-2 transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink @min-[720px]:inline-flex"
          >
            Switch project
          </button>
        </Tooltip>
      )}
    </span>
  )
}

function ForkedFrom({ from }: { from: NonNullable<Thread['forkedFrom']> }) {
  const original = useDB((s: Tables) => s.threads[from.threadId]?.title)
  const label = original ? `Forked from “${truncate(original, 40)}”` : 'Forked from a deleted conversation'
  if (!original) {
    return (
      <span className="type-caption inline-flex shrink-0 items-center gap-1 text-ink-3" title={label}>
        <GitFork aria-hidden className="size-3.5" strokeWidth={1.75} />
        <span className="@max-[880px]:sr-only">Forked</span>
      </span>
    )
  }
  return (
    <Tooltip content={label}>
      <Link
        to={`${threadRoute(from.threadId)}?m=${encodeURIComponent(from.messageId)}`}
        className="type-caption inline-flex h-7 min-w-0 shrink items-center gap-1 rounded-sm px-1 text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
      >
        <GitFork aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
        <span className="max-w-[180px] truncate @max-[880px]:sr-only">{label}</span>
      </Link>
    </Tooltip>
  )
}

// ------------------------------------------------------------------------------------------------ actions

function ModelChip({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const model = getModelInfo(value)
  const availability = useModelAvailability(value)
  return (
    <span className="hidden @min-[920px]:inline-flex">
      <ModelPicker
        value={value}
        onChange={onChange}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            ref={p.ref as Ref<HTMLButtonElement>}
            aria-label={`Model: ${model?.label ?? value}${availability.available ? '' : ` (unavailable: ${availability.reason})`}. Change model`}
            className={cn(
              'inline-flex h-7 max-w-[220px] min-w-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press data-[state=open]:text-ink',
              !availability.available && 'text-fail-ink',
            )}
          >
            <ModelLabel model={model} className="min-w-0" />
            <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
          </button>
        )}
      />
    </span>
  )
}

/** Opens Inspector › Context (and attaches the latest answer's run so its retrieved sources show there). */
function ContextButton({ count, threadId }: { count: number; threadId?: ID }) {
  const layout = useShellLayout()
  const tab = useInspectorTab()
  const open = layout.inspectorOpen && tab === 'context'
  const toggle = () => {
    const st = useShellStore.getState()
    if (open) {
      st.setInspector('chat', { open: false })
      return
    }
    const runId = threadId ? latestAnswerRun(threadId) : undefined
    if (runId) st.attachRun(runId)
    st.setInspector('chat', { open: true, tab: 'context' })
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      leadingIcon={Layers}
      aria-pressed={open}
      aria-label={`Context: ${count} ${count === 1 ? 'item' : 'items'} ride along with your next message. ${open ? 'Hide' : 'Show'} the breakdown`}
      onClick={toggle}
      className={cn(open && 'bg-press text-ink')}
    >
      <span className="inline-flex items-baseline gap-1.5">
        <span className="@max-[520px]:sr-only">Context</span>
        <span className="type-meta text-ink-3 tabular">{count}</span>
      </span>
    </Button>
  )
}

function latestAnswerRun(threadId: ID): ID | undefined {
  const thread = db.get('threads', threadId)
  if (!thread) return undefined
  for (let i = thread.messageIds.length - 1; i >= 0; i--) {
    const m = db.get('messages', thread.messageIds[i])
    if (m?.role === 'assistant' && m.runId) return m.runId
  }
  return undefined
}

/** Thread-level Turn into items (§6.2): Tasks from action items (review sheet) · Knowledge note · Research brief. */
function turnIntoItems(thread: Thread, onActionItems: () => void): MenuItem[] {
  const source = { kind: 'thread' as const, id: thread.id }
  const lastQuestion = () => {
    for (let i = thread.messageIds.length - 1; i >= 0; i--) {
      const m = db.get('messages', thread.messageIds[i])
      if (m?.role === 'user' && m.content.trim()) return truncate(m.content.trim(), 600)
    }
    return ''
  }
  return [
    { type: 'label', label: 'Turn this conversation into' },
    { id: 'tasks', label: 'Tasks from action items…', icon: ListChecks, description: 'Review the items found, then create them', onSelect: onActionItems },
    {
      id: 'note',
      label: 'Knowledge note',
      icon: NotebookPen,
      description: 'Save the conversation to Knowledge',
      onSelect: () => turnInto('note', source, { title: thread.title }),
    },
    {
      id: 'research',
      label: 'Research brief',
      icon: Telescope,
      description: 'Investigate the question with sources',
      onSelect: () => openStartSheet('research', { source, prefill: { brief: lastQuestion(), title: thread.title } }),
    },
  ]
}

function ThreadTurnInto({ thread, onActionItems }: { thread: Thread; onActionItems: () => void }) {
  return (
    <Menu
      items={turnIntoItems(thread, onActionItems)}
      placement="bottom-end"
      aria-label="Turn this conversation into"
      trigger={
        <Button size="sm" variant="ghost" leadingIcon={CornerUpRight} aria-label="Turn this conversation into…">
          <span className="@max-[720px]:hidden">Turn into…</span>
        </Button>
      }
    />
  )
}

