import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { ContextLine, useComposerContext } from '@/app/components'
import { announce } from '@/app/shell/Announcer'
import { useDB, type Tables } from '@/core/db'
import { generateAsset } from '@/core/services/studio'
import type { Asset, AssetKind, EntityRef, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, SegmentedControl, Select, toast, useBreakpointUp, useLocalStorageState } from '@/ui'
import { GeneratorChip } from './honesty'
import {
  ASPECT_OPTIONS, AUDIO_DURATIONS, FORMAT_OPTIONS, KIND_ORDER, KINDS, SLIDE_COUNTS, STYLE_OPTIONS, TONE_OPTIONS, VIDEO_DURATIONS, VOICE_OPTIONS,
  type Option,
} from './kinds'
import { boardsInScope } from './logic'

/**
 * The generation bar (§6.8 "sticky prompt bar"): kind tabs, the prompt, kind-specific params
 * (aspect, style, duration, slides, tone, format, voice), takes 1–4, the board, the generator chip
 * (SIM procedural / SIM Studio writer) and Generate ⏎. The asset appears at once in a generating state.
 * Text kinds show the Context Line: exactly what their writer is grounded in.
 */

const AUTO = 'auto'
type ParamDraft = Record<string, string>

const DEFAULT_PARAMS: Record<AssetKind, ParamDraft> = {
  image: { aspect: AUTO, style: AUTO },
  video: { aspect: '16:9', durationSec: '30', style: AUTO },
  presentation: { slideCount: '8', tone: AUTO },
  document: { format: AUTO, tone: AUTO },
  audio: { voice: AUTO, durationSec: '45' },
}

const TEXT_KINDS = new Set<AssetKind>(['presentation', 'document', 'audio'])

/** Params as stored on the asset: numbers as numbers, 'auto' left to the generator's inference. */
export function toAssetParams(kind: AssetKind, draft: ParamDraft): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) {
    if (!v || v === AUTO) continue
    out[k] = k === 'durationSec' || k === 'slideCount' ? Number(v) : v
  }
  if (kind === 'video' && typeof out.durationSec === 'number') out.shots = Math.min(12, Math.max(3, Math.round(out.durationSec / 5)))
  return out
}

export interface PromptBarHandle {
  focus: () => void
  setKind: (kind: AssetKind) => void
}

export interface PromptBarProps {
  /** The kind to start on (the contact sheet's kind facet, or ?compose=). */
  initialKind?: AssetKind | null
  /** Default board (the board on screen). */
  boardId: ID | null
  /** The active scope. */
  scope: ID | null
  /** Called right after the asset is created (it is already generating). */
  onGenerated: (asset: Asset) => void
  /** Imperative focus / kind (⌘K "Generate an image…", N). */
  handleRef?: (handle: PromptBarHandle | null) => void
  /** Draft prefill (examples on empty boards). */
  prefill?: { text: string; nonce: number } | null
  className?: string
}

export function PromptBar({ initialKind, boardId, scope, onGenerated, handleRef, prefill, className }: PromptBarProps) {
  const [kind, setKind] = useLocalStorageState<AssetKind>('atrium.studio.kind', initialKind ?? 'image')
  const [allParams, setAllParams] = useLocalStorageState<Record<AssetKind, ParamDraft>>('atrium.studio.params', DEFAULT_PARAMS)
  const [takes, setTakes] = useLocalStorageState<string>('atrium.studio.takes', '1')
  const [text, setText] = useState('')
  const [board, setBoard] = useState<ID | null>(boardId)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const wide = useBreakpointUp('sm')
  const safeKind: AssetKind = KIND_ORDER.includes(kind) ? kind : 'image'
  const params = { ...DEFAULT_PARAMS[safeKind], ...(allParams?.[safeKind] ?? {}) }
  const textKind = TEXT_KINDS.has(safeKind)

  // The board on screen is the default target; following it when the view changes.
  useEffect(() => setBoard(boardId), [boardId])
  useEffect(() => {
    if (initialKind) setKind(initialKind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKind])
  useEffect(() => {
    if (!prefill) return
    setText(prefill.text)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(prefill.text.length, prefill.text.length)
    })
  }, [prefill])

  const boards = useDB((s: Tables) => s.boards)
  const boardList = useMemo(() => boardsInScope(Object.values(boards), scope), [boards, scope])
  const targetBoard = board ? boards[board] : undefined
  const projectId = targetBoard ? targetBoard.projectId ?? scope : scope

  const ctx = useComposerContext({ label: 'Studio · generation bar', projectId, autoPublish: false })
  useEffect(() => ctx.setDraft(text), [ctx.setDraft, text])

  useEffect(() => {
    handleRef?.({
      focus: () => inputRef.current?.focus(),
      setKind: (k) => setKind(k),
    })
    return () => handleRef?.(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRef])

  // Auto-grow the prompt (44px → --composer-max).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(44, el.scrollHeight)}px`
  }, [text])

  const setParam = (key: string, value: string) => setAllParams((cur) => ({ ...DEFAULT_PARAMS, ...cur, [safeKind]: { ...params, [key]: value } }))

  const contextRefs = (): EntityRef[] | undefined => {
    if (!textKind) return undefined
    const r = ctx.refs
    const memory: EntityRef[] = r.projectMemory && r.projectId ? [{ kind: 'project', id: r.projectId }, ...r.memoryRefs] : []
    return [...memory, ...r.all]
  }

  const submit = () => {
    const prompt = text.trim()
    if (!prompt) {
      inputRef.current?.focus()
      return
    }
    try {
      const asset = generateAsset({
        kind: safeKind,
        prompt,
        params: toAssetParams(safeKind, params),
        takes: Number(takes) || 1,
        boardId: targetBoard ? targetBoard.id : null,
        projectId,
        contextRefs: contextRefs(),
      })
      setText('')
      ctx.reset()
      announce(`Generating “${asset.title}”. It appears first in the contact sheet.`)
      onGenerated(asset)
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t start generating', description: err instanceof Error ? err.message : String(err) })
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    } else if (e.key === 'Escape') {
      inputRef.current?.blur()
    }
  }

  const info = KINDS[safeKind]
  const select = (key: string, label: string, options: readonly Option[], auto?: boolean) => (
    <ParamSelect key={key} label={label} value={params[key] ?? (auto ? AUTO : options[0]?.value)} onChange={(v) => setParam(key, v)} options={auto ? [{ value: AUTO, label: 'Auto' }, ...options] : options} />
  )

  return (
    <div
      className={cn(
        'relative flex w-full min-w-0 flex-col rounded-md border border-line-input bg-raised p-3 transition-[outline-color] duration-(--dur-1)',
        'has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-(--focus-ring)',
        className,
      )}
      role="group"
      aria-label="Generate"
      data-studio-prompt-bar=""
    >
      <div className="-mx-0.5 mb-2 flex min-w-0 items-center gap-2">
        <SegmentedControl<AssetKind>
          size="sm"
          aria-label="Kind"
          value={safeKind}
          onValueChange={(k) => {
            setKind(k)
            inputRef.current?.focus()
          }}
          options={KIND_ORDER.map((k) => ({ value: k, label: KINDS[k].label, icon: KINDS[k].icon, iconOnly: !wide }))}
        />
      </div>
      {textKind && ctx.entries.length > 0 && <ContextLine context={ctx} className="mb-1" />}
      <textarea
        ref={inputRef}
        data-composer-input=""
        value={text}
        rows={1}
        placeholder={info.placeholder}
        aria-label={`Prompt: ${info.label.toLowerCase()}`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={ctx.activate}
        className="type-body-lg block max-h-(--composer-max) min-h-11 w-full resize-none overflow-y-auto bg-transparent px-0.5 py-1 text-ink outline-none placeholder:text-ink-3 pointer-coarse:text-[16px]"
      />
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Options" role="group">
        {safeKind === 'image' && (
          <>
            {select('aspect', 'Aspect', ASPECT_OPTIONS.image, true)}
            {select('style', 'Style', STYLE_OPTIONS, true)}
          </>
        )}
        {safeKind === 'video' && (
          <>
            {select('aspect', 'Aspect', ASPECT_OPTIONS.video)}
            {select('durationSec', 'Length', VIDEO_DURATIONS)}
            {select('style', 'Style', STYLE_OPTIONS, true)}
          </>
        )}
        {safeKind === 'presentation' && (
          <>
            {select('slideCount', 'Slides', SLIDE_COUNTS)}
            {select('tone', 'Tone', TONE_OPTIONS, true)}
          </>
        )}
        {safeKind === 'document' && (
          <>
            {select('format', 'Format', FORMAT_OPTIONS, true)}
            {select('tone', 'Tone', TONE_OPTIONS, true)}
          </>
        )}
        {safeKind === 'audio' && (
          <>
            {select('voice', 'Voice', VOICE_OPTIONS, true)}
            {select('durationSec', 'Length', AUDIO_DURATIONS)}
          </>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="type-caption text-ink-3" id="studio-takes-label">
            Takes
          </span>
          <SegmentedControl<string>
            size="sm"
            aria-label="Takes"
            value={takes}
            onValueChange={setTakes}
            options={['1', '2', '3', '4'].map((n) => ({ value: n, label: n }))}
          />
        </span>
        <ParamSelect
          label="Board"
          value={targetBoard ? targetBoard.id : '__none__'}
          onChange={(v) => setBoard(v === '__none__' ? null : v)}
          options={[{ value: '__none__', label: 'No board' }, ...boardList.map((b) => ({ value: b.id, label: b.name }))]}
          wide
        />
      </div>
      <div className="mt-2 flex h-9 min-w-0 items-center gap-2 border-t border-line pt-2">
        <GeneratorChip kind={safeKind} projectId={projectId} className="-ml-1.5" />
        <span className="flex-1" />
        <Button size="sm" variant="primary" trailingIcon={ArrowUp} kbd="enter" onClick={submit} disabled={!text.trim()} aria-label={`Generate ${info.label.toLowerCase()}`}>
          Generate
        </Button>
      </div>
    </div>
  )
}

function ParamSelect({ label, value, onChange, options, wide }: { label: string; value: string; onChange: (v: string) => void; options: readonly Option[]; wide?: boolean }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="type-caption shrink-0 text-ink-3" aria-hidden>
        {label}
      </span>
      <Select
        size="sm"
        variant="ghost"
        aria-label={label}
        value={value}
        onValueChange={onChange}
        options={options}
        className={cn('min-w-0 font-medium text-ink-2', wide ? 'max-w-[220px]' : 'max-w-[160px]')}
      />
    </span>
  )
}
