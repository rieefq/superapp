import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, AtSign, ChevronDown, Gauge, Paperclip, Square } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { workspaceForPath } from '@/app/registry'
import type { SlashCommand } from '@/app/types'
import { estimateTokens, getModelInfo, useModelAvailability } from '@/core/ai'
import { updateSettings, useSettings } from '@/core/settings'
import type { Attachment, Effort } from '@/core/types'
import { cn } from '@/lib/cn'
import {
  Button,
  IconButton,
  Menu,
  Portal,
  Tooltip,
  floatingMotion,
  mergeRefs,
  toast,
  useBreakpointUp,
  useFloating,
  useLayer,
  useReducedMotion,
} from '@/ui'
import { ContextLine } from '../context/ContextLine'
import { ContextMeter, meterLevel, OVER_WINDOW_REASON } from '../context/ContextMeter'
import { useComposerContext, type ComposerContext, type ComposerContextOptions, type ComposerContextRefs } from '../context/useComposerContext'
import { ModelLabel, ModelPicker } from '../pickers/pickers'
import { filesToAttachments, useStageDrop } from './attachments'
import { MentionList, SlashList, useMentionOptions, type MentionOption } from './MentionMenu'
import { completeTrigger, detectTrigger, filterCommands, parseSlash, type Trigger } from './text'

export interface ComposerSubmitMeta {
  /** ⌘⏎ in a navigating composer: start in the background and stay here. */
  background: boolean
  /** File attachments that are switched on. */
  attachments: Attachment[]
  /** Exactly the context that will be sent (from the Context Line). */
  context: ComposerContextRefs
  modelId: string
  effort: Effort
}

export interface ComposerProps {
  placeholder?: string
  /** hero (Home): 64px input · default: 44px · compact: 36px with a collapsed Context Line. */
  size?: 'hero' | 'default' | 'compact'
  /** Label of the submit control. Default "Send" (in place) or "Run" (navigating). */
  submitLabel?: string
  /** A navigating composer: split "Run ▾ / Run in background ⌘⏎" (§8.1). In-place composers just send. */
  backgroundable?: boolean
  slashCommands?: SlashCommand[]
  /** Handle a `/command args` submit. Return false to send the text as a normal message instead. */
  onSlashCommand?: (command: SlashCommand, args: string, meta: ComposerSubmitMeta) => void | boolean | Promise<void | boolean>
  /** A ReadBack line (§5.4.11) shown above the toolbar in composers that start delegated runs. */
  readBack?: ReactNode
  onSubmit: (text: string, meta: ComposerSubmitMeta) => void | Promise<unknown>
  /** A reply is streaming: the submit control becomes "Stop ⌘." and new messages queue. */
  streaming?: boolean
  onStop?: () => void
  disabled?: boolean
  /** Why the composer is disabled (or a warning to show under the input). */
  reason?: ReactNode
  /** ↑ in an empty composer (Chat: edit your last message). */
  onEditLast?: () => void
  /** Context controller from useComposerContext() (host-owned); otherwise the composer owns one. */
  context?: ComposerContext
  /** Options for the composer-owned context controller. */
  contextOptions?: ComposerContextOptions
  showContextLine?: boolean
  /** Replaces the project chip in the Context Line. */
  projectSlot?: ReactNode
  /** Extra control in the toolbar after the model chip (e.g. an AgentPicker). */
  agentSlot?: ReactNode
  /** Controlled model; defaults to settings.ai.defaultModelId. */
  modelId?: string
  onModelChange?: (modelId: string) => void
  showModel?: boolean
  /** Inside the composer, at the top — above the Context Line and the input (Home's verb chips). */
  above?: ReactNode
  /** Inside the composer, under the input (Home's router reason). */
  below?: ReactNode
  /** Controlled draft. */
  value?: string
  onValueChange?: (text: string) => void
  /** Runs before the composer's own key handling; call preventDefault() to take over a key. */
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  autoFocus?: boolean
  /** Element that accepts dropped files (the stage). Default: the composer itself. */
  dropTarget?: RefObject<HTMLElement | null>
  textareaRef?: Ref<HTMLTextAreaElement>
  'aria-label'?: string
  className?: string
}

const MIN_HEIGHT = { hero: 64, default: 44, compact: 36 } as const

interface Queued {
  text: string
  meta: ComposerSubmitMeta
}

/**
 * The Composer (§5.4.10): Context Line, auto-growing input, toolbar (attach, @ mention, model chip,
 * effort), ContextMeter and the submit control. ⏎ sends, ⇧⏎ adds a line, ⌘⏎ runs in the background
 * (navigating composers), ⌘. stops a streaming reply, ↑ in an empty composer edits your last message.
 * Typing while a reply streams queues the message.
 */
export function Composer(props: ComposerProps) {
  const {
    placeholder = 'Ask anything — @ to add context, / for actions',
    size = 'default',
    backgroundable = false,
    slashCommands,
    onSlashCommand,
    readBack,
    onSubmit,
    streaming = false,
    onStop,
    disabled = false,
    reason,
    onEditLast,
    showContextLine = true,
    projectSlot,
    agentSlot,
    showModel = true,
    above,
    below,
    autoFocus,
    dropTarget,
    textareaRef,
    className,
  } = props
  const submitLabel = props.submitLabel ?? (backgroundable ? 'Run' : 'Send')
  const { pathname } = useLocation()
  const owned = useComposerContext({ label: workspaceForPath(pathname).label, ...props.contextOptions })
  const ctx = props.context ?? owned
  const phone = !useBreakpointUp('md')
  const reduced = useReducedMotion()

  // ---- draft
  const [internalText, setInternalText] = useState('')
  const text = props.value ?? internalText
  const setText = useCallback(
    (next: string) => {
      if (props.value === undefined) setInternalText(next)
      props.onValueChange?.(next)
      ctx.setDraft(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.value, props.onValueChange, ctx.setDraft],
  )
  useEffect(() => {
    if (props.value !== undefined) ctx.setDraft(props.value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value])

  // ---- model & effort
  const defaultModel = useSettings((s) => s.ai.defaultModelId)
  const [internalModel, setInternalModel] = useState<string | undefined>(undefined)
  const modelId = props.modelId ?? internalModel ?? defaultModel
  const setModel = (id: string) => {
    if (props.modelId === undefined) setInternalModel(id)
    props.onModelChange?.(id)
  }
  const model = getModelInfo(modelId)
  const availability = useModelAvailability(modelId)
  const effort = useSettings((s) => s.ai.effort)
  const reasoning = !!model?.capabilities.includes('reasoning')
  useEffect(() => ctx.setModel(modelId), [ctx.setModel, modelId])

  // ---- tokens & limits
  const draftTokens = text.trim() ? estimateTokens(text) : 0
  const totalTokens = ctx.tokens + draftTokens
  const windowSize = model?.contextWindow ?? 200_000
  const over = meterLevel(totalTokens, windowSize) === 'over'

  // ---- elements
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  // Auto-grow: min height per size; max is --composer-max (scrolls beyond).
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(MIN_HEIGHT[size], el.scrollHeight)}px`
  }, [text, size])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  // ---- menus (@ mention, / commands)
  const [caret, setCaret] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)
  const rawTrigger = disabled ? null : detectTrigger(text, caret)
  const trigger: Trigger | null =
    rawTrigger && rawTrigger.start !== dismissedAt && (rawTrigger.kind === '@' || (slashCommands?.length && onSlashCommand)) ? rawTrigger : null
  const mentionOpen = trigger?.kind === '@'
  const slashOpen = trigger?.kind === '/'
  const mentions = useMentionOptions(mentionOpen ? trigger.query : '', ctx.projectId, mentionOpen)
  const commands = slashOpen ? filterCommands(slashCommands ?? [], trigger.query) : []
  const [active, setActive] = useState(0)
  const menuCount = mentionOpen ? mentions.length : commands.length
  useEffect(() => setActive(0), [trigger?.kind, trigger?.query])
  const menuOpen = !!trigger

  const syncCaret = () => {
    const el = inputRef.current
    if (el) setCaret(el.selectionStart ?? el.value.length)
  }

  const placeCaret = (pos: number) => {
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      el.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const pickMention = (o: MentionOption) => {
    if (!trigger) return
    const next = completeTrigger(text, trigger, o.insert ?? '')
    setText(next.text)
    ctx.attach(o.ref)
    placeCaret(next.caret)
  }

  const pickCommand = (c: SlashCommand) => {
    if (!trigger) return
    const next = completeTrigger(text, trigger, `/${c.name} `)
    setText(next.text)
    setDismissedAt(0)
    placeCaret(next.caret)
  }

  // ---- files
  const addFiles = async (files: File[]) => {
    if (!files.length || disabled) return
    const { attachments, failed } = await filesToAttachments(files)
    ctx.addFiles(attachments)
    if (failed.length) toast({ tone: 'error', title: `Couldn’t read ${failed.join(', ')}`, description: 'The file could not be read in this browser.' })
  }
  const { dragging } = useStageDrop(dropTarget ?? rootRef, (files) => void addFiles(files), !disabled)

  // ---- submit & queue
  const [queued, setQueued] = useState<Queued | null>(null)
  const [busy, setBusy] = useState(false)
  const modelBlocked = !availability.available
  const canSubmit = !disabled && !busy && !over && !modelBlocked && (!!text.trim() || ctx.refs.attachments.length > 0)

  const deliver = useCallback(
    async (draft: string, meta: ComposerSubmitMeta) => {
      setBusy(true)
      try {
        const slash = slashCommands?.length && onSlashCommand ? parseSlash(draft, slashCommands) : null
        if (slash) {
          const handled = await onSlashCommand!(slash.command, slash.args, meta)
          if (handled !== false) return
        }
        await onSubmit(draft, meta)
      } catch (err) {
        // Give the draft back so nothing typed is lost.
        setText(draft)
        if (meta.attachments.length) ctx.addFiles(meta.attachments)
        toast({ tone: 'error', title: 'Couldn’t send', description: err instanceof Error ? err.message : String(err) })
      } finally {
        setBusy(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slashCommands, onSlashCommand, onSubmit, setText, ctx.addFiles],
  )

  const submit = (background: boolean) => {
    if (!canSubmit) return
    const draft = text.trim()
    const meta: ComposerSubmitMeta = { background, attachments: ctx.refs.attachments, context: ctx.refs, modelId, effort }
    setText('')
    setDismissedAt(null)
    ctx.reset()
    if (streaming && !backgroundable) {
      setQueued({ text: draft, meta })
      return
    }
    void deliver(draft, meta)
  }

  // Send the queued message once the current answer finishes.
  useEffect(() => {
    if (streaming || !queued) return
    const q = queued
    setQueued(null)
    void deliver(q.text, q.meta)
  }, [streaming, queued, deliver])

  const sendQueuedNow = () => {
    if (!queued) return
    onStop?.()
    const q = queued
    setQueued(null)
    // Let the stopped reply settle before sending.
    setTimeout(() => void deliver(q.text, q.meta), 0)
  }
  const cancelQueued = () => {
    if (!queued) return
    if (!text.trim()) setText(queued.text)
    setQueued(null)
    inputRef.current?.focus()
  }

  // ---- keys
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    props.onKeyDown?.(e)
    if (e.defaultPrevented || e.nativeEvent.isComposing) return
    const mod = e.metaKey || e.ctrlKey
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (menuCount) setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + menuCount) % menuCount)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey && !mod) || e.key === 'Tab') {
        if (menuCount) {
          e.preventDefault()
          if (mentionOpen) pickMention(mentions[Math.min(active, mentions.length - 1)])
          else pickCommand(commands[Math.min(active, commands.length - 1)])
          return
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setDismissedAt(trigger.start)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit(mod && backgroundable)
      return
    }
    if (mod && e.key === '.' && streaming) {
      e.preventDefault()
      onStop?.()
      return
    }
    if (e.key === 'ArrowUp' && !text && onEditLast) {
      e.preventDefault()
      onEditLast()
      return
    }
    if (e.key === 'Escape' && !menuOpen) {
      inputRef.current?.blur()
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? [])
    if (!files.length) return
    if (!e.clipboardData.getData('text')) e.preventDefault()
    void addFiles(files)
  }

  // ⌘. stops the streaming reply even when focus is elsewhere in the composer.
  useEffect(() => {
    if (!streaming || !onStop) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.' && !e.defaultPrevented && rootRef.current?.contains(document.activeElement)) {
        e.preventDefault()
        onStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [streaming, onStop])

  const showLine = showContextLine && (ctx.entries.length > 0 || !!projectSlot)
  const collapsed = size === 'compact' || phone
  const blockReason = over ? OVER_WINDOW_REASON : modelBlocked ? availability.reason : undefined

  return (
    <div
      ref={rootRef}
      data-composer=""
      data-size={size}
      className={cn(
        'relative flex w-full min-w-0 flex-col rounded-md border bg-raised p-3 transition-[border-color,outline-color] duration-(--dur-1) ease-standard',
        'border-line-input has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-(--focus-ring)',
        disabled && 'opacity-70',
        className,
      )}
    >
      {above}
      {showLine && <ContextLine context={ctx} collapsed={collapsed} projectSlot={projectSlot} className="mb-1" />}
      <AnimatePresence initial={false}>
        {queued && (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 rounded-sm border border-line-strong bg-canvas py-1 pr-1 pl-2.5" role="status">
              <span className="type-caption min-w-0 flex-1 truncate text-ink-2">
                <span className="text-ink">Queued</span> — sends when this answer finishes · <span className="text-ink-3">“{queued.text}”</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button size="xs" variant="secondary" onClick={sendQueuedNow}>
                  Send now
                </Button>
                <Button size="xs" variant="ghost" onClick={cancelQueued}>
                  Cancel
                </Button>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <textarea
        ref={mergeRefs(inputRef, textareaRef)}
        data-composer-input=""
        value={text}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={props['aria-label'] ?? placeholder.split(' — ')[0]}
        aria-describedby={blockReason || reason ? `${listId}-reason` : undefined}
        role={menuOpen ? 'combobox' : undefined}
        aria-expanded={menuOpen ? true : undefined}
        aria-controls={menuOpen ? `${listId}-list` : undefined}
        aria-autocomplete={menuOpen ? 'list' : undefined}
        aria-activedescendant={menuOpen && menuCount ? `${listId}-list-${Math.min(active, menuCount - 1)}` : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setCaret(e.target.selectionStart ?? e.target.value.length)
          if (dismissedAt !== null && !detectTrigger(e.target.value, e.target.selectionStart ?? 0)) setDismissedAt(null)
        }}
        onSelect={syncCaret}
        onClick={syncCaret}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') syncCaret()
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={ctx.activate}
        style={{ minHeight: MIN_HEIGHT[size] }}
        className={cn(
          'type-body-lg block max-h-(--composer-max) w-full resize-none bg-transparent px-0.5 py-1 text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed pointer-coarse:text-[16px]',
          'overflow-y-auto',
        )}
      />
      {below}
      {(blockReason || reason) && (
        <p id={`${listId}-reason`} className={cn('type-caption mt-1 px-0.5', over ? 'text-fail-ink' : 'text-ink-3')} role={over ? 'alert' : undefined}>
          {blockReason ?? reason}
          {modelBlocked && !over && (
            <>
              {' '}
              <Link to="/integrations/anthropic" className="text-ink underline decoration-line-input underline-offset-2 hover:decoration-ink">
                Open Integrations
              </Link>
            </>
          )}
        </p>
      )}
      {readBack && <div className="mt-1.5 min-w-0 px-0.5">{readBack}</div>}
      <div className="mt-1.5 flex h-9 min-w-0 items-center gap-1">
        <div className="-ml-1.5 flex min-w-0 flex-1 items-center gap-0.5">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <IconButton icon={Paperclip} label="Attach files" size="sm" disabled={disabled} onClick={() => fileRef.current?.click()} />
          <IconButton
            icon={AtSign}
            label="Add context"
            shortcut="@"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const el = inputRef.current
              const at = el?.selectionStart ?? text.length
              const needsSpace = at > 0 && !/\s/.test(text[at - 1] ?? '')
              const insert = `${needsSpace ? ' ' : ''}@`
              setText(text.slice(0, at) + insert + text.slice(at))
              setDismissedAt(null)
              placeCaret(at + insert.length)
            }}
          />
          {showModel && (
            <ModelPicker
              value={modelId}
              onChange={setModel}
              trigger={(p) => (
                <button
                  type="button"
                  {...p}
                  ref={p.ref as Ref<HTMLButtonElement>}
                  disabled={disabled}
                  aria-label={`Model: ${model?.label ?? modelId}. Change model`}
                  className={cn(
                    'inline-flex h-7 min-w-0 shrink items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press data-[state=open]:text-ink',
                    modelBlocked && 'text-fail-ink',
                  )}
                >
                  <ModelLabel model={model} className="min-w-0" />
                  <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
                </button>
              )}
            />
          )}
          {showModel && reasoning && (
            <Menu
              aria-label="Effort"
              items={(['low', 'medium', 'high'] as Effort[]).map((v) => ({
                type: 'radio' as const,
                label: v === 'low' ? 'Low — faster' : v === 'medium' ? 'Medium' : 'High — thinks longer',
                checked: effort === v,
                onSelect: () => updateSettings('ai', { effort: v }),
              }))}
              trigger={
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Effort: ${effort}. Change effort`}
                  className="hidden h-7 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink data-[state=open]:bg-press sm:inline-flex"
                >
                  <Gauge aria-hidden className="size-3.5 text-ink-3" strokeWidth={1.75} />
                  <span className="capitalize">{effort}</span>
                  <ChevronDown aria-hidden className="size-3 text-ink-3" strokeWidth={2} />
                </button>
              }
            />
          )}
          {agentSlot}
        </div>
        <ContextMeter tokens={totalTokens} window={windowSize} modelLabel={model?.label} className={cn(phone && 'hidden')} />
        <SubmitControl
          label={submitLabel}
          backgroundable={backgroundable}
          streaming={streaming && !backgroundable}
          disabled={!canSubmit}
          busy={busy}
          size={size}
          onSubmit={submit}
          onStop={onStop}
        />
      </div>

      {dragging && <DropOverlay target={dropTarget ?? rootRef} />}

      <MenuPanel open={menuOpen} anchor={rootRef} placement={size === 'hero' ? 'bottom-start' : 'top-start'} onClose={() => trigger && setDismissedAt(trigger.start)}>
        {mentionOpen ? (
          <MentionList id={`${listId}-list`} options={mentions} active={Math.min(active, Math.max(0, mentions.length - 1))} onPick={pickMention} onHover={setActive} />
        ) : slashOpen ? (
          <SlashList id={`${listId}-list`} commands={commands} active={Math.min(active, Math.max(0, commands.length - 1))} onPick={pickCommand} onHover={setActive} />
        ) : null}
      </MenuPanel>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ submit control

function SubmitControl({ label, backgroundable, streaming, disabled, busy, size, onSubmit, onStop }: {
  label: string
  backgroundable: boolean
  streaming: boolean
  disabled: boolean
  busy: boolean
  size: ComposerProps['size']
  onSubmit: (background: boolean) => void
  onStop?: () => void
}) {
  const btn = size === 'hero' ? 'md' : 'sm'
  if (streaming) {
    return (
      <Button size={btn} variant="secondary" leadingIcon={Square} kbd="mod+." onClick={onStop} aria-label="Stop the reply">
        Stop
      </Button>
    )
  }
  if (!backgroundable) {
    return (
      <Tooltip content={label} shortcut="enter">
        <Button size={btn} variant="primary" trailingIcon={ArrowUp} disabled={disabled} loading={busy} onClick={() => onSubmit(false)}>
          {label}
        </Button>
      </Tooltip>
    )
  }
  return (
    <span className="inline-flex shrink-0 items-stretch">
      <Button
        size={btn}
        variant="primary"
        disabled={disabled}
        loading={busy}
        kbd="enter"
        onClick={() => onSubmit(false)}
        className="rounded-r-none"
      >
        {label}
      </Button>
      <Menu
        placement="bottom-end"
        aria-label={`${label} options`}
        items={[
          { label: `${label} and open`, shortcut: 'enter', disabled, onSelect: () => onSubmit(false) },
          { label: `${label} in background`, shortcut: 'mod+enter', disabled, onSelect: () => onSubmit(true) },
        ]}
        trigger={
          <button
            type="button"
            aria-label={`More ${label.toLowerCase()} options`}
            className={cn(
              'relative inline-grid place-items-center rounded-r-sm border-l border-inverse-ink/15 bg-inverse text-inverse-ink transition-colors duration-(--dur-1) hover:bg-inverse/88',
              btn === 'md' ? 'h-8 w-7' : 'h-7 w-6',
              "pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']",
            )}
          >
            <ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        }
      />
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ overlays

/** The floating `@` / `/` list, anchored to the composer; focus stays in the textarea. */
function MenuPanel({ open, anchor, placement, onClose, children }: {
  open: boolean
  anchor: RefObject<HTMLDivElement | null>
  placement: 'top-start' | 'bottom-start'
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const reduced = useReducedMotion()
  useLayer({ open, inside: [panelRef, anchor], onOutside: onClose })
  const floating = useFloating({ open, anchor: anchor.current, placement, offset: 6 })
  const preset = floatingMotion(floating.side, reduced)
  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <motion.div
            ref={mergeRefs(panelRef, floating.setFloating)}
            data-layer=""
            initial={preset.initial}
            animate={preset.animate}
            exit={preset.exit}
            transition={preset.transition}
            className="fixed top-0 left-0 z-(--z-popover) max-h-[min(360px,50vh)] w-[min(420px,calc(100vw-16px))] overflow-y-auto overscroll-contain rounded-md border border-line bg-overlay shadow-e1"
          >
            {children}
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  )
}

/** Solid 1px ink outline on --accent-tint over the drop target (drop zones are never dashed). */
export function DropOverlay({ target, label = 'Drop to attach — read locally, never uploaded' }: { target: RefObject<HTMLElement | null>; label?: string }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const el = target.current
    if (!el) return
    const update = () => setRect(el.getBoundingClientRect())
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [target])
  if (!rect) return null
  return (
    <Portal>
      <div
        aria-hidden
        className="pointer-events-none fixed z-(--z-overlay) grid place-items-center rounded-md border border-ink bg-accent-tint/85"
        style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      >
        <span className="type-body-sm rounded-sm bg-overlay px-3 py-1.5 text-ink shadow-e1">{label}</span>
      </div>
    </Portal>
  )
}
