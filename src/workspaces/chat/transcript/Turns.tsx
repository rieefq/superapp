import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { DerivedList, type DerivedItem } from '@/app/components'
import { attachRun } from '@/app/shell/store'
import { awaitGeneration, editAndResend, forkThread, getModelInfo, regenerate, setThreadModel } from '@/core/ai'
import { db, useRow } from '@/core/db'
import { getSettings, useSettings } from '@/core/settings'
import type { ID, Message } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, Markdown, ProvenanceLine, Textarea, toast, type Citation as MarkdownCitation } from '@/ui'
import { inspectNow, threadRoute } from '../actions'
import { useChatUi } from '../state'
import { Attachments, DerivedItemView, ErrorNote, Gutter, Reasoning, Sources, speakerOf, ToolTraces, TurnHeaderLine } from './parts'
import { AnswerActions, PromptActions, useRetry } from './TurnActions'

/*
 * One turn of the transcript (§6.2), drawn as a ledger rather than bubbles: a 72px gutter with the
 * speaker, time and run handle joined by the thread spine (a hatched band for simulated replies), and a
 * 640px text column. Each turn subscribes to its own message, so streaming re-renders only that turn.
 */

export interface TurnProps {
  id: ID
  threadId: ID
  /** The latest answer (Retry, actions always visible). */
  isLastAnswer: boolean
  /** The latest message you wrote (Edit resends in place). */
  isLastPrompt: boolean
  /** The conversation is generating. */
  busy: boolean
  /** Items made from the conversation itself, placed after this turn. */
  after?: readonly DerivedItem[]
}

export const Turn = memo(function Turn(props: TurnProps) {
  const message = useRow('messages', props.id)
  const highlighted = useChatUi((s) => s.highlightId === props.id)
  if (!message) return null
  return (
    <>
      {message.role === 'user' ? (
        <PromptTurn message={message} highlighted={highlighted} {...props} />
      ) : (
        <AnswerTurn message={message} highlighted={highlighted} {...props} />
      )}
      {props.after?.length ? <MadeHere items={props.after} /> : null}
    </>
  )
})

const ARTICLE =
  'group/turn relative isolate grid grid-cols-1 outline-none @min-[600px]:grid-cols-[72px_minmax(0,1fr)] ' +
  'before:pointer-events-none before:absolute before:-inset-x-3 before:-top-2 before:bottom-4 before:-z-10 before:rounded-md before:bg-highlight before:opacity-0 before:transition-opacity before:duration-700 ' +
  'data-[highlight=true]:before:opacity-100 focus-visible:before:opacity-100 focus-visible:before:bg-transparent focus-visible:before:outline-2 focus-visible:before:outline-(--focus-ring) focus-visible:before:transition-none'

// ------------------------------------------------------------------------------------------------ answer

function AnswerTurn({ message, highlighted, threadId, isLastAnswer, busy }: TurnProps & { message: Message; highlighted: boolean }) {
  const navigate = useNavigate()
  const ref = useRef<HTMLElement>(null)
  const run = useRow('runs', message.runId)
  const showReasoning = useSettings((s) => s.ai.showReasoning)
  const retry = useRetry(message, navigate)
  const { label, simulated } = speakerOf(message)
  const model = getModelInfo(message.modelId)
  const streaming = message.status === 'streaming'
  const failed = message.status === 'error' && message.error !== 'refusal'
  const stopped = message.status === 'stopped'

  const citations = message.citations
  const markers = useMemo<MarkdownCitation[]>(
    () => (citations ?? []).map((c, i) => ({ index: i + 1, title: c.title, onClick: () => inspectNow(c.ref) })),
    [citations],
  )
  const duration = run?.startedAt !== undefined && run.endedAt !== undefined ? run.endedAt - run.startedAt : undefined

  const answerWithSimulator = () => {
    const before = db.get('threads', threadId)?.modelId
    const sim = simulatorModel()
    void regenerate(message.id, { modelId: sim })
      .then(() => awaitGeneration(message.id))
      .then(() => {
        // "For this turn": the conversation keeps its own model for the next message.
        if (before && before !== sim) setThreadModel(threadId, before)
      })
      .catch((err) => toast({ tone: 'error', title: 'Couldn’t retry with the Simulator', description: err instanceof Error ? err.message : String(err) }))
  }

  return (
    <article
      ref={ref}
      data-message-id={message.id}
      data-highlight={highlighted || undefined}
      tabIndex={-1}
      aria-label={`${label}${simulated ? ' (simulated)' : ''}${streaming ? ', writing' : ''}`}
      aria-busy={streaming || undefined}
      className={ARTICLE}
    >
      <Gutter speaker={label} simulated={simulated} at={message.createdAt} runId={message.runId} writing={streaming} failed={failed} stopped={stopped} spine={simulated ? 'sim' : 'line'} />
      <div className={cn('relative flex min-w-0 flex-col gap-3 pb-11', simulated && '@max-[599px]:pl-3.5')}>
        {simulated && <span aria-hidden className="sim-band absolute inset-y-0 left-0 mb-11 @min-[600px]:hidden" />}
        <TurnHeaderLine speaker={label} simulated={simulated} at={message.createdAt} runId={message.runId} writing={streaming} failed={failed} stopped={stopped} />
        {(message.tools?.length || (showReasoning && message.reasoning)) && (
          <div className="-my-1 flex flex-col">
            {message.tools?.length ? <ToolTraces tools={message.tools} messageSimulated={!!message.simulated} /> : null}
            {showReasoning && message.reasoning ? <Reasoning text={message.reasoning} streaming={streaming && !message.content} /> : null}
          </div>
        )}
        {message.content ? (
          <Markdown
            citations={markers}
            className={cn(
              'type-body-lg text-ink [&>*]:transition-colors [&>*]:duration-200 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
              streaming && '[&>*:last-child]:text-ink-2',
            )}
          >
            {message.content}
          </Markdown>
        ) : streaming ? (
          <p className="type-body-lg text-ink-3" aria-hidden>
            &nbsp;
          </p>
        ) : null}
        {failed && message.error && (
          <ErrorNote error={message.error} modelId={message.modelId} canRetry={isLastAnswer && !busy} onRetry={() => retry()} onSimulator={answerWithSimulator} />
        )}
        {citations?.length ? <Sources citations={citations} /> : null}
        <ProvenanceLine
          modelLabel={model?.label ?? (simulated ? 'Simulator' : undefined)}
          simulated={simulated}
          usage={message.usage}
          durationMs={duration}
          stopped={stopped}
          onViewRun={run ? () => attachRun(run.id, 'chat') : undefined}
        />
        {message.derived?.length ? <DerivedList source={{ kind: 'message', id: message.id }} /> : null}
        {/* The action row sits in the turn's bottom padding, so revealing it on hover never moves anything. */}
        {!streaming && !(failed && !message.content) && (
          <div className={cn('absolute bottom-2 left-0', simulated && '@max-[599px]:left-3.5')}>
            <AnswerActions message={message} isLast={isLastAnswer} busy={busy} scope={ref} />
          </div>
        )}
      </div>
    </article>
  )
}

/** The simulator model used for "Use Simulator for this turn": the default when it is simulated, else Swift. */
function simulatorModel(): string {
  const def = getSettings().ai.defaultModelId
  return getModelInfo(def)?.simulated ? def : 'sim-swift'
}

// ------------------------------------------------------------------------------------------------ prompt

const LONG_PROMPT = 1400

function PromptTurn({ message, highlighted, threadId, isLastPrompt }: TurnProps & { message: Message; highlighted: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const editing = useChatUi((s) => s.editingId === message.id)
  const [expanded, setExpanded] = useState(false)
  const long = message.content.length > LONG_PROMPT || message.content.split('\n').length > 16
  return (
    <article
      ref={ref}
      data-message-id={message.id}
      data-highlight={highlighted || undefined}
      tabIndex={-1}
      aria-label="You"
      className={ARTICLE}
    >
      <Gutter speaker="You" simulated={false} at={message.createdAt} spine="line" />
      <div className="relative flex min-w-0 flex-col gap-2.5 pb-11">
        <TurnHeaderLine speaker="You" simulated={false} at={message.createdAt} />
        {editing ? (
          <EditPrompt message={message} threadId={threadId} inPlace={isLastPrompt} />
        ) : (
          message.content && (
            <div className="flex flex-col items-start gap-1">
              <p className={cn('type-body-lg break-words whitespace-pre-wrap text-ink', long && !expanded && 'line-clamp-[12]')}>{message.content}</p>
              {long && (
                <button type="button" onClick={() => setExpanded((e) => !e)} className="type-caption rounded-xs font-medium text-ink-3 hover:text-ink">
                  {expanded ? 'Show less' : 'Show all'}
                </button>
              )}
            </div>
          )
        )}
        {message.attachments?.length ? <Attachments items={message.attachments} /> : null}
        {message.derived?.length ? <DerivedList source={{ kind: 'message', id: message.id }} /> : null}
        {!editing && (
          <div className="absolute bottom-2 left-0">
            <PromptActions message={message} threadId={threadId} scope={ref} />
          </div>
        )}
      </div>
    </article>
  )
}

/**
 * Edit your message (§6.2): the latest one resends in place (the answers after it are replaced);
 * an earlier one forks the conversation, so history is never overwritten silently.
 */
function EditPrompt({ message, threadId, inPlace }: { message: Message; threadId: ID; inPlace: boolean }) {
  const navigate = useNavigate()
  const setEditing = useChatUi((s) => s.setEditing)
  const [value, setValue] = useState(message.content)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  // Replacing the answers in place would orphan work made from them: fork instead.
  const derivedAfter = useMemo(() => {
    const thread = db.get('threads', threadId)
    if (!thread) return false
    const at = thread.messageIds.indexOf(message.id)
    return thread.messageIds.slice(at + 1).some((id) => !!db.get('messages', id)?.derived?.length)
  }, [threadId, message.id])
  const replaceInPlace = inPlace && !derivedAfter

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const cancel = () => {
    setEditing(null)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(message.id)}"]`)?.focus())
  }

  const save = async () => {
    const text = value.trim()
    if (!text && !message.attachments?.length) return
    if (text === message.content.trim()) {
      cancel()
      return
    }
    setBusy(true)
    try {
      if (replaceInPlace) {
        await editAndResend(message.id, text)
      } else {
        const fork = forkThread(threadId, message.id)
        const copyId = fork.messageIds[fork.messageIds.length - 1]
        await editAndResend(copyId, text)
        navigate(threadRoute(fork.id))
        toast({ title: 'Edited in a fork', description: 'The original conversation stays as it was.', action: { label: 'Back to the original', onClick: () => navigate(threadRoute(threadId)) } })
      }
      setEditing(null)
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t send the edit', description: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line-input bg-raised p-3 has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-(--focus-ring)">
      <Textarea
        ref={inputRef}
        value={value}
        onValueChange={setValue}
        autosize
        minRows={2}
        maxRows={14}
        aria-label="Edit your message"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void save()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            cancel()
          }
        }}
        className="type-body-lg border-0 bg-transparent p-0 shadow-none focus-visible:outline-none"
      />
      <div className="flex flex-wrap items-center gap-2">
        <p className="type-caption min-w-0 flex-1 text-ink-3">
          {replaceInPlace ? 'Sends again from here. The answer after it is replaced.' : 'Sends in a fork. The original conversation stays as it was.'}
        </p>
        <Button size="sm" variant="ghost" onClick={cancel} kbd="escape">
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!value.trim() && !message.attachments?.length} onClick={() => void save()} kbd="enter">
          {replaceInPlace ? 'Send' : 'Send in a fork'}
        </Button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ made from the conversation

/** Work made from the conversation itself (thread-level Turn into, slash commands, forks), in time order. */
function MadeHere({ items }: { items: readonly DerivedItem[] }) {
  return (
    <div className="grid grid-cols-1 @min-[600px]:grid-cols-[72px_minmax(0,1fr)]">
      <div className="hidden @min-[600px]:flex" aria-hidden>
        <span className="ml-px w-px bg-line-strong" />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 pb-11" aria-label="Made from this conversation" role="group">
        {items.map((item) => (
          <DerivedItemView key={`${item.ref.kind}:${item.ref.id}`} item={item} />
        ))}
      </div>
    </div>
  )
}
