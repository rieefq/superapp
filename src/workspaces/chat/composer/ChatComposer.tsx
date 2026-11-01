import { useEffect, useRef, type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { Composer, START_KIND_META, startEvents, toChatSelection, type ComposerContext, type ComposerSubmitMeta } from '@/app/components'
import { openStartSheet, type StartKind } from '@/app/shell/store'
import type { SlashCommand } from '@/app/types'
import { sendMessage, stopGeneration } from '@/core/ai'
import { db, useDB, type Tables } from '@/core/db'
import { createKnowledge, prepareImport } from '@/core/services'
import type { Attachment, EntityRef, ID, Thread } from '@/core/types'
import { useCoarsePointer } from '@/ui'
import { threadRoute } from '../actions'
import { parseAgentArgs, parseAgentMention } from '../logic/commands'
import { CHAT_SLASH_COMMANDS, manifest } from '../manifest'
import { draftKey, useChatUi } from '../state'

/**
 * The docked Chat composer (§6.2, §5.4.10): the Context Line is the contract — every send passes
 * `toChatSelection(meta.context)` so switched-off chips never reach the model. `@Agent …` at the start
 * opens the Start sheet as an assignment, `/research /task /agent /code /image /note` open it for that
 * kind, and text files are saved to Knowledge as uploads before they are sent.
 */
export interface ChatComposerProps {
  thread?: Thread
  context: ComposerContext
  modelId: string
  onModelChange: (modelId: string) => void
  dropTarget: RefObject<HTMLElement | null>
}

export function ChatComposer({ thread, context, modelId, onModelChange, dropTarget }: ChatComposerProps) {
  const navigate = useNavigate()
  const coarse = useCoarsePointer()
  const threadId = thread?.id
  const key = draftKey(threadId)
  const draft = useChatUi((s) => s.drafts[key] ?? '')
  const setDraft = (text: string) => useChatUi.getState().setDraft(key, text)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const streamingId = useDB((s: Tables) => {
    const ids = threadId ? s.threads[threadId]?.messageIds : undefined
    if (!ids) return undefined
    for (let i = ids.length - 1; i >= 0; i--) if (s.messages[ids[i]]?.status === 'streaming') return ids[i]
    return undefined
  })

  // A draft handed to the Start sheet stays in the composer until the sheet starts the work.
  const handedOff = useRef<string | null>(null)
  useEffect(
    () =>
      startEvents.on('started', () => {
        if (handedOff.current === null) return
        handedOff.current = null
        useChatUi.getState().setDraft(key, '')
      }),
    [key],
  )
  const handOff = (text: string, files: Attachment[]) => {
    setDraft(text)
    handedOff.current = text
    if (files.length) context.addFiles(files)
  }

  // Opening another conversation puts the cursor in its composer (not on first load, where `/` does it,
  // and not on touch, where it would raise the keyboard).
  const firstKey = useRef(key)
  useEffect(() => {
    if (coarse || key === firstKey.current) return
    firstKey.current = ''
    const el = inputRef.current
    if (!el || el.disabled) return
    const active = document.activeElement
    // Don't steal focus from a field the user is typing in (e.g. the list's search).
    if (active && active !== document.body && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') && active !== el) return
    el.focus({ preventScroll: true })
  }, [key, coarse])

  const source: EntityRef | undefined = threadId ? { kind: 'thread', id: threadId } : undefined

  const open = (kind: StartKind, prefill: Record<string, unknown>, text: string, files: Attachment[], background?: boolean) => {
    handOff(text, files)
    // Tasks and notes are created here (toast + chip in the thread); runs keep ⏎ go · ⌘⏎ stay.
    openStartSheet(kind, { source, prefill, background: background ?? !START_KIND_META[kind].runs })
  }

  const onSlashCommand = (command: SlashCommand, args: string, meta: ComposerSubmitMeta): boolean => {
    const base = { projectId: meta.context.projectId, attached: meta.context.attached }
    const text = `/${command.name}${args ? ` ${args}` : ''}`
    switch (command.name) {
      case 'research':
        open('research', { ...base, brief: args }, text, meta.attachments)
        return true
      case 'task':
        open('task', { ...base, title: args, brief: '' }, text, meta.attachments)
        return true
      case 'agent': {
        const { agentId, instruction } = parseAgentArgs(args, db.all('agents'))
        open('agent', { ...base, brief: instruction, ...(agentId ? { agentId } : {}) }, text, meta.attachments)
        return true
      }
      case 'code':
        open('session', { ...base, brief: args }, text, meta.attachments)
        return true
      case 'image':
        open('studio', { ...base, studioKind: 'image', brief: args }, text, meta.attachments)
        return true
      case 'note':
        // Without text, the note is the conversation itself (the Start sheet fills it from the source).
        open('note', args ? { ...base, brief: args, title: args.split('\n')[0].slice(0, 80) } : base, text, meta.attachments)
        return true
      default:
        return false
    }
  }

  const onSubmit = async (text: string, meta: ComposerSubmitMeta) => {
    // "@Scout compare…" is an assignment, not a chat turn (§6.2): the Start sheet reads it back first.
    const mention = parseAgentMention(text, db.all('agents'))
    if (mention) {
      open(
        'agent',
        {
          agentId: mention.agentId,
          brief: mention.instruction,
          projectId: meta.context.projectId,
          attached: meta.context.attached.filter((r) => !(r.kind === 'agent' && r.id === mention.agentId)),
        },
        text,
        meta.attachments,
        // An assignment typed in the conversation keeps you here; its run lands under it.
        !!threadId,
      )
      return
    }
    const attachments = await saveUploads(meta.attachments, meta.context.projectId)
    const result = await sendMessage({
      threadId,
      text,
      attachments,
      modelId: meta.modelId,
      projectId: meta.context.projectId,
      contextRefs: threadId ? undefined : meta.context.attached,
      ...toChatSelection(meta.context),
    })
    if (!threadId) navigate(threadRoute(result.threadId))
  }

  const editLast = () => {
    const ids = threadId ? db.get('threads', threadId)?.messageIds : undefined
    if (!ids) return
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = db.get('messages', ids[i])
      if (m?.role === 'user') {
        useChatUi.getState().setEditing(m.id)
        return
      }
    }
  }

  return (
    <Composer
      context={context}
      // The host owns the context; the Composer's own fallback context must not publish to Inspector › Context.
      contextOptions={{ autoPublish: false }}
      value={draft}
      onValueChange={(t) => {
        setDraft(t)
        if (handedOff.current !== null && t !== handedOff.current) handedOff.current = null
      }}
      textareaRef={inputRef}
      placeholder={manifest.composer?.placeholder}
      aria-label="Ask anything"
      slashCommands={CHAT_SLASH_COMMANDS}
      onSlashCommand={onSlashCommand}
      modelId={modelId}
      onModelChange={onModelChange}
      streaming={!!streamingId}
      onStop={() => streamingId && stopGeneration(streamingId)}
      onEditLast={threadId ? editLast : undefined}
      dropTarget={dropTarget}
      onSubmit={onSubmit}
    />
  )
}

/**
 * Text files sent in Chat are saved to Knowledge as uploads (§6.2 Files, journey 6), so they are
 * retrievable later; the attachment keeps a link to the item. Read locally — nothing is uploaded.
 */
async function saveUploads(attachments: readonly Attachment[], projectId: ID | null): Promise<Attachment[]> {
  return Promise.all(
    attachments.map(async (a) => {
      if (a.kind !== 'text' || !a.text || a.knowledgeId) return a
      try {
        const prepared = await prepareImport(new File([a.text], a.name, { type: a.mime || 'text/plain' }))
        const item = createKnowledge(
          {
            title: prepared.title,
            content: prepared.content,
            kind: prepared.kind,
            summary: prepared.summary,
            file: prepared.file,
            projectIds: projectId ? [projectId] : [],
            source: { type: 'upload' },
          },
          { verb: 'imported' },
        )
        return { ...a, knowledgeId: item.id }
      } catch {
        // Saving is a convenience: the file is still sent with the message.
        return a
      }
    }),
  )
}
