import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { MessagesSquare } from 'lucide-react'
import { useComposerContext } from '@/app/components'
import { useRegisterCommands } from '@/app/commands/registry'
import { useShellStore } from '@/app/shell/store'
import { Stage, StageHeader, WorkspaceScreen } from '@/app/templates'
import { regenerate, setThreadModel, setThreadProject, stopGeneration } from '@/core/ai'
import { useScope } from '@/core/context'
import { db, useDB, useRow, type Tables } from '@/core/db'
import { useSettings } from '@/core/settings'
import type { EntityRef, ID } from '@/core/types'
import { Button, EmptyState, ErrorState, toast, useHotkey } from '@/ui'
import type { Command } from '@/app/types'
import { Archive, Download, GitFork, ListChecks, NotebookPen, PencilLine, RotateCcw, Square, Trash2 } from 'lucide-react'
import { deleteWithConfirm, exportMarkdown, forkWhole, setArchived, syncThreadContext, turnInto } from './actions'
import { ChatComposer } from './composer/ChatComposer'
import { EmptyThread } from './empty/EmptyThread'
import { ChatHeader } from './header/ChatHeader'
import { ThreadList } from './list/ThreadList'
import type { Suggestion } from './logic/suggestions'
import { ActionItemsSheet } from './sheets/ActionItemsSheet'
import { draftKey, useChatUi } from './state'
import { Transcript } from './transcript/Transcript'
import { parseChatPath, useLiveLocation } from './useLiveLocation'

/**
 * Chat (§6.2) on the Session template: the conversation list, the stage (header, transcript or the
 * empty conversation) and the docked composer. One instance serves /chat, /chat/new and /chat/:id so
 * the list keeps its scroll and search while you move between conversations.
 */
export function ChatScreen() {
  // The live location, not the route context: see useLiveLocation (navigations would lag while answers stream).
  const { route, threadId } = parseChatPath(useLiveLocation().pathname)
  const thread = useRow('threads', threadId)
  const navigate = useNavigate()
  const scope = useScope()
  const defaultModel = useSettings((s) => s.ai.defaultModelId)
  const stageRef = useRef<HTMLDivElement>(null)
  const [actionItemsOpen, setActionItemsOpen] = useState(false)

  // A new conversation is filed into the current scope unless you pick another project in the header.
  const [newProject, setNewProject] = useState<{ id: ID | null } | null>(null)
  const [newModel, setNewModel] = useState<string | null>(null)
  useEffect(() => setNewProject(null), [scope])
  const projectId = thread ? thread.projectId : newProject ? newProject.id : scope
  const modelId = thread?.modelId ?? newModel ?? defaultModel

  const key = draftKey(threadId)
  const context = useComposerContext({
    projectId,
    attached: thread ? thread.contextRefs : undefined,
    onAttachedChange: useCallback((refs: EntityRef[]) => threadId && syncThreadContext(threadId, refs), [threadId]),
    label: thread ? `Chat · ${thread.title}` : 'Chat · New conversation',
    modelId,
  })
  // Per-action switches, files and likely matches belong to one conversation: start fresh on switch.
  const reset = context.reset
  useEffect(() => {
    reset()
    context.setDraft(useChatUi.getState().drafts[key] ?? '')
    useChatUi.getState().setEditing(null)
    // A message or source selected in the last conversation does not follow you into this one.
    if (useShellStore.getState().selection) useShellStore.getState().setSelection(null)
    setActionItemsOpen(false)
    // Only on a conversation switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  // Leaving /chat/new for a fresh new conversation starts from the defaults again.
  useEffect(() => {
    if (route !== 'thread') return
    setNewModel(null)
    setNewProject(null)
  }, [route])

  const contextCount = context.entries.filter((e) => e.on && e.exists).length

  const onProjectChange = useCallback(
    (id: ID | null) => {
      if (!threadId) {
        setNewProject({ id })
        return
      }
      const before = db.get('threads', threadId)?.projectId ?? null
      if (before === id) return
      setThreadProject(threadId, id)
      const name = id ? (db.get('projects', id)?.name ?? 'the project') : null
      toast({
        title: name ? `Moved to ${name}` : 'Removed from its project',
        duration: 8000,
        action: { label: 'Undo', onClick: () => setThreadProject(threadId, before) },
      })
    },
    [threadId],
  )
  const onModelChange = useCallback(
    (id: string) => {
      if (threadId) setThreadModel(threadId, id)
      else setNewModel(id)
    },
    [threadId],
  )
  const openActionItems = useCallback(() => setActionItemsOpen(true), [])

  // ⌘⇧O: a new conversation from anywhere in Chat.
  useHotkey('mod+shift+o', () => {
    navigate('/chat/new')
    requestAnimationFrame(() => document.querySelector<HTMLElement>('#main [data-composer-input]')?.focus())
  })

  useThreadCommands(threadId, openActionItems)

  const applySuggestion = useCallback(
    (s: Suggestion) => {
      for (const ref of s.refs) context.attach(ref)
      useChatUi.getState().setDraft(key, s.prompt)
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLTextAreaElement>('#main [data-composer-input]')
        input?.focus()
        input?.setSelectionRange(input.value.length, input.value.length)
      })
    },
    [context, key],
  )

  const missing = route === 'thread' && !thread
  const list = useMemo(() => <ThreadList activeId={threadId} />, [threadId])
  const empty = !thread || thread.messageIds.length === 0

  return (
    // The Session template (list pane + stage), composed from its parts so the transcript gets the full
    // 712px reading column (§6.2: a 72px gutter + 640px text) — the same width as the docked composer.
    <WorkspaceScreen list={list} phoneView={route === 'root' ? 'list' : 'stage'}>
      <Stage
        primary={thread ? { kind: 'thread', id: thread.id } : null}
        measure="chat"
        bodyClassName="flex min-h-full max-w-[760px] flex-col"
        header={
          missing ? (
            <StageHeader title="Conversation not found" />
          ) : (
            <ChatHeader
              thread={thread}
              projectId={projectId}
              onProjectChange={onProjectChange}
              modelId={modelId}
              onModelChange={onModelChange}
              contextCount={contextCount}
              onActionItems={openActionItems}
            />
          )
        }
        composer={missing ? undefined : <ChatComposer thread={thread} context={context} modelId={modelId} onModelChange={onModelChange} dropTarget={stageRef} />}
      >
        <div ref={stageRef} className="flex min-h-0 flex-1 flex-col">
          {missing ? (
            <EmptyState
              icon={MessagesSquare}
              title="This conversation isn’t here"
              description="It may have been deleted, or the link is from another device. Conversations are stored in this browser."
              actions={
                <Button variant="primary" onClick={() => navigate('/chat/new')}>
                  New conversation
                </Button>
              }
            />
          ) : empty ? (
            <EmptyThread projectId={projectId} modelId={modelId} onUse={applySuggestion} onAttach={context.attach} />
          ) : (
            <TranscriptBoundary key={thread.id}>
              <Transcript threadId={thread.id} />
            </TranscriptBoundary>
          )}
        </div>
        {thread && <ActionItemsSheet thread={thread} open={actionItemsOpen} onOpenChange={setActionItemsOpen} />}
      </Stage>
    </WorkspaceScreen>
  )
}

/** ⌘K "Actions for this view" while a conversation is open. */
function useThreadCommands(threadId: ID | undefined, openActionItems: () => void) {
  const navigate = useNavigate()
  const thread = useRow('threads', threadId)
  const streamingId = useDB((s: Tables) => {
    const ids = threadId ? s.threads[threadId]?.messageIds : undefined
    if (!ids) return undefined
    for (let i = ids.length - 1; i >= 0; i--) if (s.messages[ids[i]]?.status === 'streaming') return ids[i]
    return undefined
  })
  const lastAnswer = useDB((s: Tables) => {
    const ids = threadId ? s.threads[threadId]?.messageIds : undefined
    if (!ids) return undefined
    for (let i = ids.length - 1; i >= 0; i--) if (s.messages[ids[i]]?.role === 'assistant') return ids[i]
    return undefined
  })
  const commands: Command[] = []
  if (thread) {
    const id = thread.id
    if (streamingId)
      commands.push({ id: 'chat.stop', title: 'Stop the answer', icon: Square, group: 'Chat', shortcut: 'mod+.', run: (c) => (c.close(), stopGeneration(streamingId)) })
    else if (lastAnswer)
      commands.push({
        id: 'chat.retry',
        title: 'Retry the last answer',
        icon: RotateCcw,
        group: 'Chat',
        keywords: ['regenerate', 'again'],
        run: (c) => {
          c.close()
          if (db.get('messages', lastAnswer)?.derived?.length) {
            toast({ title: 'This answer has work made from it', description: 'Use Retry under the answer to retry it in a fork.' })
            return
          }
          void regenerate(lastAnswer).catch((err) => toast({ tone: 'error', title: 'Couldn’t retry', description: String(err) }))
        },
      })
    commands.push(
      {
        id: 'chat.rename',
        title: 'Rename conversation',
        icon: PencilLine,
        group: 'Chat',
        run: (c) => {
          c.close()
          setTimeout(() => document.querySelector<HTMLButtonElement>('[data-region="stage"] header h1 button')?.click(), 60)
        },
      },
      { id: 'chat.tasks', title: 'Tasks from action items…', icon: ListChecks, group: 'Chat', keywords: ['turn into', 'todo', 'tasks'], run: (c) => (c.close(), openActionItems()) },
      {
        id: 'chat.note',
        title: 'Save conversation as a note…',
        icon: NotebookPen,
        group: 'Chat',
        keywords: ['knowledge', 'save', 'note'],
        run: (c) => (c.close(), turnInto('note', { kind: 'thread', id }, { title: thread.title })),
      },
      { id: 'chat.fork', title: 'Fork conversation', icon: GitFork, group: 'Chat', run: (c) => (c.close(), forkWhole(id, navigate)) },
      { id: 'chat.export', title: 'Export as Markdown', icon: Download, group: 'Chat', keywords: ['download', 'md'], run: (c) => (c.close(), exportMarkdown(id)) },
      { id: 'chat.archive', title: thread.archived ? 'Unarchive conversation' : 'Archive conversation', icon: Archive, group: 'Chat', run: (c) => (c.close(), setArchived(id, !thread.archived)) },
      { id: 'chat.delete', title: 'Delete conversation…', icon: Trash2, group: 'Chat', run: (c) => (c.close(), void deleteWithConfirm(id, { navigate, isOpen: true })) },
    )
  }
  useRegisterCommands('chat.thread', commands)
}

/** The transcript fails alone: an ErrorState with Retry; the list and composer keep working. */
class TranscriptBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[chat] transcript failed', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="Couldn’t show this conversation"
          message="Something in the transcript failed to draw. Your messages are safe; Retry draws it again."
          details={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          retryLabel="Retry"
        />
      )
    }
    return this.props.children
  }
}
