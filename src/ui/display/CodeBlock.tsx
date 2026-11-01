import { useId, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, TextWrap } from 'lucide-react'
import { cn } from '@/lib/cn'
import { highlightLines, languageFromPath, languageLabel, type CodeLine } from './highlight'
import { Caret, ToolButton, useCopy } from './internal'
import { FileIcon } from './FileIcon'

/** "3-5,9" | [3, 4, 5, 9] → Set of 1-based line numbers. */
export function parseLineSpec(spec?: string | readonly number[]): Set<number> {
  const out = new Set<number>()
  if (!spec) return out
  if (Array.isArray(spec)) {
    spec.forEach((n) => out.add(n))
    return out
  }
  for (const part of String(spec).split(',')) {
    const [a, b] = part.split('-').map((s) => parseInt(s.trim(), 10))
    if (Number.isNaN(a)) continue
    const end = Number.isNaN(b) ? a : b
    for (let i = Math.min(a, end); i <= Math.max(a, end); i++) out.add(i)
  }
  return out
}

/** Renders highlighted tokens for one line (shared with DiffView). */
export function TokenLine({ tokens, markClass }: { tokens: CodeLine; markClass?: string }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.mark ? (
          <mark key={i} className={cn('text-inherit', markClass)} style={{ color: t.color, fontStyle: t.italic ? 'italic' : undefined }}>
            {t.text}
          </mark>
        ) : (
          <span key={i} style={{ color: t.color, fontStyle: t.italic ? 'italic' : undefined }}>
            {t.text}
          </span>
        ),
      )}
    </>
  )
}

export interface CodeBlockProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  code: string
  /** Fence name, alias or extension ('ts', 'tsx', 'python', 'sh'…). Inferred from `filename` when absent. */
  language?: string
  filename?: string
  /** Show line numbers (default: on for 4+ lines with a filename, otherwise off). */
  lineNumbers?: boolean
  /** Lines to emphasize: "3-5,9" or [3, 4, 5, 9]. */
  highlight?: string | readonly number[]
  /** First line number (for excerpts). */
  startLine?: number
  /** Collapse taller blocks to this height (px) with a "Show all" control. */
  maxHeight?: number
  /** Initial soft-wrap state (user can toggle). */
  wrap?: boolean
  /** Extra header actions (e.g. "Open in editor"). */
  actions?: ReactNode
  /** Hide the header entirely (copy stays available on hover). */
  bare?: boolean
  /** Show a streaming caret after the last character. */
  streaming?: boolean
}

/**
 * Syntax-highlighted code with a quiet header (language · filename · wrap · copy),
 * optional line numbers and highlighted ranges, collapse-to-height and soft wrap.
 */
export function CodeBlock({
  code,
  language,
  filename,
  lineNumbers,
  highlight,
  startLine = 1,
  maxHeight,
  wrap: wrapInitial = false,
  actions,
  bare = false,
  streaming = false,
  className,
  ...props
}: CodeBlockProps) {
  const lang = language ?? languageFromPath(filename)
  const lines = useMemo(() => {
    const out = highlightLines(code.replace(/\n$/, ''), lang)
    return out.length ? out : [[]]
  }, [code, lang])
  const marked = useMemo(() => parseLineSpec(highlight), [highlight])
  const [wrap, setWrap] = useState(wrapInitial)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { copied, copy } = useCopy()
  const regionId = useId()
  const showNumbers = lineNumbers ?? (!!filename && lines.length > 3)
  const gutterCh = String(startLine + lines.length - 1).length

  useLayoutEffect(() => {
    if (!maxHeight || !scrollRef.current) return setOverflowing(false)
    setOverflowing(scrollRef.current.scrollHeight > maxHeight + 24)
  }, [maxHeight, lines, wrap])

  const collapsed = !!maxHeight && overflowing && !expanded
  const label = filename ?? languageLabel(lang)

  return (
    <div
      className={cn('group/code relative overflow-hidden rounded-md border border-line bg-sunken text-ink', className)}
      {...props}
    >
      {!bare && (
        <div className="flex h-9 items-center gap-2 border-b border-line pr-1.5 pl-3">
          {filename ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <FileIcon name={filename} className="size-3.5" />
              <span className="truncate font-mono text-xs text-ink-2" title={filename}>
                {filename}
              </span>
            </span>
          ) : null}
          <span className={cn('font-mono text-2xs tracking-[0.08em] text-ink-3 uppercase', filename && 'hidden xs:inline')}>
            {languageLabel(lang)}
          </span>
          <span className="flex-1" />
          {actions}
          <ToolButton
            icon={<TextWrap />}
            label={wrap ? 'Disable soft wrap' : 'Soft wrap long lines'}
            iconOnly
            pressed={wrap}
            onClick={() => setWrap((w) => !w)}
          />
          <ToolButton
            icon={copied ? <Check className="text-done-ink" /> : <Copy />}
            label={copied ? 'Copied' : 'Copy'}
            onClick={() => void copy(code)}
            aria-live="polite"
          />
        </div>
      )}
      {bare && (
        <ToolButton
          icon={copied ? <Check className="text-done-ink" /> : <Copy />}
          label={copied ? 'Copied' : 'Copy code'}
          iconOnly
          onClick={() => void copy(code)}
          className="absolute top-1.5 right-1.5 z-10 bg-sunken opacity-0 group-focus-within/code:opacity-100 group-hover/code:opacity-100 pointer-coarse:opacity-100"
        />
      )}
      <div className="relative">
        <div
          ref={scrollRef}
          id={regionId}
          role="region"
          aria-label={`${label} code`}
          tabIndex={0}
          className={cn('overflow-x-auto focus-visible:outline-offset-[-2px]', collapsed ? 'overflow-y-hidden' : 'overflow-y-auto')}
          style={collapsed ? { maxHeight } : undefined}
        >
          <pre className={cn('m-0 py-3 font-mono text-xs leading-5 [font-variant-ligatures:none]', wrap ? 'min-w-0' : 'w-max min-w-full')}>
            <code className="block">
              {lines.map((tokens, i) => {
                const n = startLine + i
                const isMarked = marked.has(n)
                const last = i === lines.length - 1
                return (
                  <span
                    key={i}
                    className={cn(
                      'flex',
                      isMarked && 'bg-accent-tint shadow-[inset_2px_0_0_var(--accent)]',
                    )}
                  >
                    {showNumbers && (
                      <span
                        aria-hidden
                        className={cn(
                          'sticky left-0 shrink-0 bg-sunken pr-3 pl-3 text-right text-ink-4 tabular select-none',
                          isMarked && 'bg-accent-tint text-ink-3',
                        )}
                        style={{ width: `calc(${gutterCh}ch + 1.5rem)` }}
                      >
                        {n}
                      </span>
                    )}
                    <span className={cn('min-w-0 flex-1 pr-4', !showNumbers && 'pl-3.5', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>
                      <TokenLine tokens={tokens} />
                      {last && streaming && <Caret />}
                      {tokens.length === 0 && !(last && streaming) && '​'}
                    </span>
                  </span>
                )
              })}
            </code>
          </pre>
        </div>
        {collapsed && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center bg-linear-to-b from-transparent to-sunken pb-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              aria-controls={regionId}
              aria-expanded={false}
              className="pointer-events-auto inline-flex h-7 items-center gap-1 rounded-sm border border-line-strong bg-raised px-2.5 text-xs text-ink-2 shadow-e1 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
            >
              <ChevronDown className="size-3.5" />
              Show all {lines.length} lines
            </button>
          </div>
        )}
        {!!maxHeight && overflowing && expanded && (
          <div className="flex justify-center border-t border-line py-1.5">
            <button
              type="button"
              onClick={() => {
                setExpanded(false)
                scrollRef.current?.scrollTo({ top: 0 })
              }}
              aria-controls={regionId}
              aria-expanded
              className="inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-xs text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
            >
              <ChevronUp className="size-3.5" />
              Show less
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** Inline `code` in running text. */
export function InlineCode({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        'rounded-xs border border-line bg-sunken px-[0.3em] py-[0.05em] font-mono text-[0.86em] text-ink not-italic [font-variant-ligatures:none] [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  )
}
