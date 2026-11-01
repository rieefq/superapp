import { memo, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { ArrowDown, Check, Copy } from 'lucide-react'
import { cn } from '@/lib/cn'
import { classifyLogLine, splitTimestamp, type LogTone } from './logic'
import { Caret, SimTag, ToolButton, useCopy } from './internal'

export interface TerminalLine {
  id?: string
  /** `command` lines get the prompt glyph; `output` is colored heuristically. */
  kind?: 'command' | 'output' | 'info'
  text: string
  /** Optional timestamp (epoch ms or preformatted). */
  ts?: number | string
  /** Override the heuristic tone. */
  tone?: LogTone
}

export type TerminalHeight = 'sm' | 'md' | 'lg' | 'auto' | number

const HEIGHTS: Record<Exclude<TerminalHeight, number>, number | undefined> = { sm: 168, md: 288, lg: 448, auto: undefined }

const TONE_CLASS: Record<LogTone, string> = {
  done: 'text-done-ink',
  fail: 'text-fail-ink',
  attn: 'text-attn-ink',
  dim: 'text-ink-4',
  plain: 'text-ink-2',
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export interface TerminalProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Lines, or raw text (split on newlines, all output). */
  lines: readonly TerminalLine[] | string
  /** Prompt glyph for command lines. */
  prompt?: string
  /** Working directory shown before the prompt. */
  cwd?: string
  /** Header title, e.g. "zsh — atrium". */
  title?: ReactNode
  /** Label slot; a string renders as the hatched "simulated" badge. */
  label?: ReactNode
  height?: TerminalHeight
  /** Streaming: shows a caret and follows new output (pauses when the user scrolls up). */
  streaming?: boolean
  showTimestamps?: boolean
  /** Heuristic coloring of output lines (✓ PASS → done, ✗ FAIL Error → fail, warn → attn). */
  colorize?: boolean
  /** Soft-wrap long lines (default on). */
  wrap?: boolean
  /** Announce new lines to assistive tech (role=log live region). Off by default. */
  announce?: boolean
  hideHeader?: boolean
  emptyText?: ReactNode
  /** `log` variant: no prompt, timestamps on by default. */
  variant?: 'terminal' | 'log'
}

interface Row {
  key: string
  kind: 'command' | 'output' | 'info'
  text: string
  ts?: string
  tone: LogTone
}

function formatTs(ts: number | string): string {
  if (typeof ts === 'string') return ts
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function toRows(lines: TerminalProps['lines'], colorize: boolean, showTs: boolean): Row[] {
  const list: TerminalLine[] = typeof lines === 'string' ? lines.replace(/\n$/, '').split('\n').map((text) => ({ text })) : [...lines]
  const out: Row[] = []
  list.forEach((line, li) => {
    const kind = line.kind ?? 'output'
    const parts = line.text.replace(ANSI_RE, '').replace(/\r/g, '').split('\n')
    parts.forEach((raw, pi) => {
      let text = raw
      let ts = line.ts !== undefined && pi === 0 ? formatTs(line.ts) : undefined
      if (kind === 'output' && ts === undefined) {
        const split = splitTimestamp(raw)
        if (split.ts) {
          ts = split.ts.replace(/^\[|\]$/g, '')
          text = split.rest
        }
      }
      const tone: LogTone = line.tone ?? (kind === 'output' && colorize ? classifyLogLine(text) : kind === 'info' ? 'dim' : 'plain')
      out.push({ key: `${line.id ?? li}:${pi}`, kind, text, ts: showTs ? ts : undefined, tone })
    })
  })
  return out
}

const LineRow = memo(function LineRow({ row, prompt, cwd, wrap, lazy }: { row: Row; prompt: string; cwd?: string; wrap: boolean; lazy: boolean }) {
  return (
    <div className={cn('flex gap-3 px-3', lazy && '[contain-intrinsic-size:auto_20px] [content-visibility:auto]')}>
      {row.ts !== undefined && <span className="shrink-0 text-ink-4 tabular select-none">{row.ts}</span>}
      <span className={cn('min-w-0 flex-1', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>
        {row.kind === 'command' ? (
          <>
            {cwd && <span className="mr-2 text-ink-4 select-none">{cwd}</span>}
            <span className="mr-2 text-accent-ink select-none" aria-hidden>
              {prompt}
            </span>
            <span className="text-ink">{row.text}</span>
          </>
        ) : (
          <span className={TONE_CLASS[row.tone]}>{row.text || '​'}</span>
        )}
      </span>
    </div>
  )
})

/**
 * Monospace terminal / log output: prompt + command lines, heuristic coloring, timestamps,
 * follow-mode autoscroll that pauses on scroll-up ("Jump to latest"), copy all, height presets.
 */
export function Terminal({
  lines,
  prompt = '❯',
  cwd,
  title,
  label,
  height = 'md',
  streaming = false,
  showTimestamps,
  colorize = true,
  wrap = true,
  announce = false,
  hideHeader = false,
  emptyText = 'No output yet.',
  variant = 'terminal',
  className,
  ...props
}: TerminalProps) {
  const showTs = showTimestamps ?? variant === 'log'
  const rows = useMemo(() => toRows(lines, colorize, showTs), [lines, colorize, showTs])
  const bodyRef = useRef<HTMLDivElement>(null)
  // Follow the tail while streaming (and for logs); static output starts at the top.
  const [following, setFollowing] = useState(streaming || variant === 'log')
  const [unseen, setUnseen] = useState(0)
  const prevCount = useRef(rows.length)
  const { copied, copy } = useCopy()
  const maxH = typeof height === 'number' ? height : HEIGHTS[height]

  const [atBottom, setAtBottom] = useState(true)
  // A stream that (re)starts follows the tail again.
  const [prevStreaming, setPrevStreaming] = useState(streaming)
  if (prevStreaming !== streaming) {
    setPrevStreaming(streaming)
    if (streaming) {
      setFollowing(true)
      setUnseen(0)
    }
  }

  useLayoutEffect(() => {
    const el = bodyRef.current
    const added = rows.length - prevCount.current
    prevCount.current = rows.length
    if (!el) return
    if (following) el.scrollTop = el.scrollHeight
    else if (added > 0) setUnseen((u) => u + added)
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 12)
  }, [rows, following])

  const onScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12
    setAtBottom(bottom)
    if (bottom) {
      setFollowing(true)
      setUnseen(0)
    } else if (following) setFollowing(false)
  }

  const jump = () => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    setFollowing(true)
    setUnseen(0)
  }
  const showJump = !atBottom && (streaming || variant === 'log' || unseen > 0)

  const plain = () =>
    rows.map((r) => `${r.ts ? `${r.ts} ` : ''}${r.kind === 'command' ? `${prompt} ` : ''}${r.text}`).join('\n')

  const labelNode = typeof label === 'string' ? <SimTag>{label}</SimTag> : label
  const lazy = rows.length > 400

  return (
    <div className={cn('relative overflow-hidden rounded-md border border-line bg-sunken text-ink', className)} {...props}>
      {!hideHeader && (
        <div className="flex h-9 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <span className="flex min-w-0 items-center gap-2">
            {title && <span className="truncate font-mono text-xs text-ink-3">{title}</span>}
            {labelNode}
          </span>
          <span className="flex-1" />
          {streaming && (
            <span className="flex items-center gap-1.5 font-mono text-2xs text-live-ink">
              <span className="size-1.5 rounded-full bg-live shadow-[0_0_0_3px_var(--live-glow)]" aria-hidden />
              Running
            </span>
          )}
          <ToolButton
            icon={copied ? <Check className="text-done-ink" /> : <Copy />}
            label={copied ? 'Copied' : 'Copy all'}
            onClick={() => void copy(plain())}
            disabled={rows.length === 0}
          />
        </div>
      )}
      <div
        ref={bodyRef}
        onScroll={onScroll}
        role="log"
        aria-live={announce ? 'polite' : 'off'}
        aria-label={typeof title === 'string' ? title : variant === 'log' ? 'Log output' : 'Terminal output'}
        tabIndex={0}
        className="overflow-auto py-2.5 font-mono text-xs leading-5 [font-variant-ligatures:none] focus-visible:outline-offset-[-2px]"
        style={{ maxHeight: maxH, height: typeof height === 'number' ? height : undefined }}
      >
        {rows.length === 0 && !streaming ? (
          <p className="px-3 text-ink-4">{emptyText}</p>
        ) : (
          rows.map((r) => <LineRow key={r.key} row={r} prompt={prompt} cwd={cwd} wrap={wrap} lazy={lazy} />)
        )}
        {streaming && (
          <div className="px-3">
            <Caret />
          </div>
        )}
      </div>
      {showJump && (
        <button
          type="button"
          onClick={jump}
          className="atr-rise absolute right-3 bottom-3 inline-flex h-7 items-center gap-1.5 rounded-sm border border-line-strong bg-overlay px-2.5 font-sans text-xs text-ink shadow-e1 transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11"
        >
          <ArrowDown aria-hidden className="size-3.5" />
          {unseen > 0 ? `${unseen} new ${unseen === 1 ? 'line' : 'lines'}` : 'Jump to latest'}
        </button>
      )}
    </div>
  )
}

/** Log viewer: Terminal without prompts, timestamps on. */
export function LogView(props: Omit<TerminalProps, 'variant'>) {
  return <Terminal variant="log" {...props} />
}
