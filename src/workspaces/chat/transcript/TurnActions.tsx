import { type RefObject } from 'react'
import { useNavigate } from 'react-router'
import { Check, ChevronDown, Copy, CornerUpRight, Ellipsis, GitFork, PencilLine, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { HoldButton, SaveToKnowledgeButton, START_KIND_META, START_KINDS, TurnIntoMenu, useScopedKey } from '@/app/components'
import { openStartSheet } from '@/app/shell/store'
import { forkThread, getModelInfo, listModels, regenerate, setFeedback } from '@/core/ai'
import { useContextStore } from '@/core/context'
import { toKnowledge } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { EntityRef, ID, Message } from '@/core/types'
import { cn } from '@/lib/cn'
import { IconButton, Menu, toast, useCoarsePointer, useCopy, type MenuItem } from '@/ui'
import { forkAndOpen, threadRoute } from '../actions'
import { useChatUi } from '../state'

/**
 * Turn actions (§6.2): Copy · Retry ▾ (same model / another model) · Fork from here (F) · Hold (H) ·
 * Save to Knowledge (S) · Turn into… (T) · 👍/👎 for answers; Copy · Edit (E) · Fork · Hold · Turn into
 * for your messages. Revealed on hover and focus (always for the latest answer); one ⋯ menu on touch.
 */

const ROW = 'flex h-7 items-center gap-0.5 transition-opacity duration-(--dur-1) ease-standard'
const HIDDEN_UNTIL_HOVER = 'opacity-0 group-hover/turn:opacity-100 group-focus-within/turn:opacity-100 focus-within:opacity-100'

/** Single-key shortcuts while focus is inside the turn; respects Settings › Keyboard (§3.11). */
function useTurnKey(scope: RefObject<HTMLElement | null>, key: string, handler: () => void, enabled = true) {
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  useScopedKey(scope, key, handler, enabled && singleKeys)
}

function useCopyMessage(content: string) {
  const { copy, copied } = useCopy(1400)
  return {
    copied,
    run: () =>
      void copy(content).then((ok) => {
        if (!ok) toast({ tone: 'error', title: 'Couldn’t copy the message' })
      }),
  }
}

/** Retry in place, or "Fork and retry" when things were already made from this answer (§6.2). */
export function useRetry(message: Message, navigate: ReturnType<typeof useNavigate>) {
  const forkFirst = !!message.derived?.length
  return (modelId?: string) => {
    if (forkFirst) {
      try {
        const fork = forkThread(message.threadId, message.id)
        const copyId = fork.messageIds[fork.messageIds.length - 1]
        void regenerate(copyId, modelId ? { modelId } : {}).catch(reportRetryError)
        navigate(threadRoute(fork.id))
        toast({ title: 'Retrying in a fork', description: 'This answer has work made from it, so the original stays as it is.' })
      } catch (err) {
        reportRetryError(err)
      }
      return
    }
    void regenerate(message.id, modelId ? { modelId } : {}).catch(reportRetryError)
  }
}

function reportRetryError(err: unknown) {
  toast({ tone: 'error', title: 'Couldn’t retry', description: err instanceof Error ? err.message : String(err) })
}

function retryModelItems(current: string | undefined, onPick: (id: string) => void): MenuItem[] {
  const models = listModels()
  return [
    { type: 'label', label: 'Retry with' },
    ...models.map(
      (m): MenuItem => ({
        type: 'radio',
        id: m.model.id,
        label: m.model.label,
        description: m.available ? (m.model.simulated ? 'Simulated · no model is called' : m.model.description) : m.reason,
        checked: m.model.id === current,
        disabled: !m.available,
        onSelect: () => onPick(m.model.id),
      }),
    ),
  ]
}

// ------------------------------------------------------------------------------------------------ assistant

export function AnswerActions({
  message,
  isLast,
  busy,
  scope,
}: {
  message: Message
  /** The latest answer: Retry is offered and the row stays visible. */
  isLast: boolean
  /** The conversation is generating (no retry or fork mid-answer). */
  busy: boolean
  scope: RefObject<HTMLElement | null>
}) {
  const navigate = useNavigate()
  const coarse = useCoarsePointer()
  const ref: EntityRef = { kind: 'message', id: message.id }
  const copy = useCopyMessage(message.content)
  const retry = useRetry(message, navigate)
  const canRetry = isLast && !busy && message.status !== 'streaming'
  const forkFirst = !!message.derived?.length
  const fork = () => forkAndOpen(message.threadId, message.id, navigate)
  const feedback = (v: 'up' | 'down') => setFeedback(message.id, message.feedback === v ? null : v)
  const done = message.status !== 'streaming'
  const model = getModelInfo(message.modelId)

  useTurnKey(scope, 'f', fork, done)
  useTurnKey(scope, 'c', copy.run)

  if (coarse) {
    return (
      <div className={ROW}>
        <TurnIntoMenu entity={ref} trigger={<IconButton icon={CornerUpRight} label="Turn into…" size="sm" />} />
        <Menu
          aria-label="Answer actions"
          placement="bottom-start"
          items={touchItems({
            ref,
            copy: copy.run,
            retry: canRetry ? () => retry() : undefined,
            retryLabel: forkFirst ? 'Fork and retry' : 'Retry',
            fork: done ? fork : undefined,
            feedback: { value: message.feedback, set: feedback },
          })}
          trigger={<IconButton icon={Ellipsis} label="More actions" size="sm" />}
        />
      </div>
    )
  }

  return (
    <div className={cn(ROW, !isLast && HIDDEN_UNTIL_HOVER)} role="toolbar" aria-label="Answer actions">
      <IconButton icon={copy.copied ? Check : Copy} label={copy.copied ? 'Copied' : 'Copy'} shortcut="c" size="sm" onClick={copy.run} />
      {isLast && (
        <span className="inline-flex items-center">
          <IconButton
            icon={RotateCcw}
            label={forkFirst ? `Fork and retry with ${model?.label ?? 'the same model'}` : `Retry with ${model?.label ?? 'the same model'}`}
            size="sm"
            disabled={!canRetry}
            onClick={() => retry()}
          />
          <Menu
            aria-label="Retry with another model"
            placement="bottom-start"
            items={retryModelItems(message.modelId, (id) => retry(id))}
            trigger={<IconButton icon={ChevronDown} label="Retry with another model" size="xs" disabled={!canRetry} className="-ml-1 w-5" />}
          />
        </span>
      )}
      <IconButton icon={GitFork} label="Fork from here" shortcut="f" size="sm" disabled={!done} onClick={fork} />
      <HoldButton entity={ref} iconOnly size="sm" hotkeyScope={scope} />
      <SaveToKnowledgeButton entity={ref} iconOnly size="sm" hotkeyScope={done ? scope : undefined} />
      <TurnIntoMenu entity={ref} hotkeyScope={done ? scope : undefined} trigger={<IconButton icon={CornerUpRight} label="Turn into…" shortcut="t" size="sm" disabled={!done} />} />
      <span aria-hidden className="mx-1 h-4 w-px bg-line" />
      <IconButton icon={ThumbsUp} label="Helpful" size="sm" active={message.feedback === 'up'} disabled={!done} onClick={() => feedback('up')} />
      <IconButton icon={ThumbsDown} label="Not helpful" size="sm" active={message.feedback === 'down'} disabled={!done} onClick={() => feedback('down')} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ user

export function PromptActions({ message, threadId, scope }: { message: Message; threadId: ID; scope: RefObject<HTMLElement | null> }) {
  const navigate = useNavigate()
  const coarse = useCoarsePointer()
  const setEditing = useChatUi((s) => s.setEditing)
  const ref: EntityRef = { kind: 'message', id: message.id }
  const copy = useCopyMessage(message.content)
  const edit = () => setEditing(message.id)
  const fork = () => forkAndOpen(threadId, message.id, navigate)

  useTurnKey(scope, 'e', edit)
  useTurnKey(scope, 'f', fork)
  useTurnKey(scope, 'c', copy.run)

  if (coarse) {
    return (
      <div className={ROW}>
        <IconButton icon={PencilLine} label="Edit" size="sm" onClick={edit} />
        <Menu
          aria-label="Message actions"
          placement="bottom-start"
          items={touchItems({ ref, copy: copy.run, fork })}
          trigger={<IconButton icon={Ellipsis} label="More actions" size="sm" />}
        />
      </div>
    )
  }
  return (
    <div className={cn(ROW, HIDDEN_UNTIL_HOVER)} role="toolbar" aria-label="Message actions">
      <IconButton icon={copy.copied ? Check : Copy} label={copy.copied ? 'Copied' : 'Copy'} shortcut="c" size="sm" onClick={copy.run} />
      <IconButton icon={PencilLine} label="Edit" shortcut="e" size="sm" onClick={edit} />
      <IconButton icon={GitFork} label="Fork from here" shortcut="f" size="sm" onClick={fork} />
      <HoldButton entity={ref} iconOnly size="sm" hotkeyScope={scope} />
      <TurnIntoMenu entity={ref} hotkeyScope={scope} trigger={<IconButton icon={CornerUpRight} label="Turn into…" shortcut="t" size="sm" />} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ touch menu

/** The same actions as one ⋯ menu for touch (§3.12: hover actions become ⋯ and a long-press menu). */
function touchItems(o: {
  ref: EntityRef
  copy: () => void
  retry?: () => void
  retryLabel?: string
  fork?: () => void
  feedback?: { value?: 'up' | 'down'; set: (v: 'up' | 'down') => void }
}): MenuItem[] {
  const held = useContextStore.getState().pinned.some((p) => p.ref.kind === o.ref.kind && p.ref.id === o.ref.id)
  const items: MenuItem[] = [{ id: 'copy', label: 'Copy', icon: Copy, onSelect: o.copy }]
  if (o.retry) items.push({ id: 'retry', label: o.retryLabel ?? 'Retry', icon: RotateCcw, onSelect: o.retry })
  if (o.fork) items.push({ id: 'fork', label: 'Fork from here', icon: GitFork, onSelect: o.fork })
  items.push({
    id: 'hold',
    label: held ? 'Release' : 'Hold',
    description: held ? undefined : 'Rides along in new AI actions',
    onSelect: () => useContextStore.getState().toggle(o.ref),
  })
  items.push({
    id: 'save',
    label: 'Save to Knowledge',
    onSelect: () => {
      try {
        toKnowledge(o.ref)
        toast({ tone: 'success', title: 'Saved to Knowledge' })
      } catch (err) {
        toast({ tone: 'error', title: 'Couldn’t save to Knowledge', description: err instanceof Error ? err.message : String(err) })
      }
    },
  })
  items.push({ type: 'separator' }, { type: 'label', label: 'Turn into' })
  for (const k of START_KINDS) items.push({ id: `into:${k}`, label: START_KIND_META[k].label, icon: START_KIND_META[k].icon, onSelect: () => openStartSheet(k, { source: o.ref }) })
  if (o.feedback) {
    const f = o.feedback
    items.push(
      { type: 'separator' },
      { type: 'checkbox', id: 'up', label: 'Helpful', checked: f.value === 'up', onCheckedChange: () => f.set('up') },
      { type: 'checkbox', id: 'down', label: 'Not helpful', checked: f.value === 'down', onCheckedChange: () => f.set('down') },
    )
  }
  return items
}
