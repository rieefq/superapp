import { Fragment, useMemo, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import { Columns2, FileDiff, Rows2, UnfoldVertical } from 'lucide-react'
import type { StructuredPatch } from 'diff'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import {
  buildDiffLines,
  collapseContext,
  countLines,
  diffStatCells,
  formatHunkHeader,
  pairLines,
  parseUnifiedDiff,
  patchFileName,
  segmentsFromPatch,
  statsOf,
  unifiedWordRanges,
  wordRanges,
  type DiffLine,
  type DiffSegment,
  type Range,
} from './diff'
import { highlightLines, languageFromPath, overlayRanges, type CodeLine } from './highlight'
import { TokenLine } from './CodeBlock'
import { FileIcon } from './FileIcon'
import { Segmented } from './internal'

/* ------------------------------------------------------------------------------------------ */
/* DiffStat                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export interface DiffStatProps extends HTMLAttributes<HTMLSpanElement> {
  additions: number
  deletions: number
  /** Hide the 5-cell bar. */
  hideBar?: boolean
}

const CELL_CLASS = { add: 'bg-diff-add-ink', del: 'bg-diff-del-ink', neutral: 'bg-line-strong' } as const

/** `+12 −3` with a 5-cell proportional bar. */
export function DiffStat({ additions, deletions, hideBar, className, ...props }: DiffStatProps) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-mono text-xs tabular', className)} {...props}>
      <span className="sr-only">
        {additions} {additions === 1 ? 'addition' : 'additions'}, {deletions} {deletions === 1 ? 'deletion' : 'deletions'}
      </span>
      <span aria-hidden className="text-diff-add-ink">
        +{formatNumber(additions)}
      </span>
      <span aria-hidden className="text-diff-del-ink">
        −{formatNumber(deletions)}
      </span>
      {!hideBar && (
        <span aria-hidden data-bar className="flex gap-0.5">
          {diffStatCells(additions, deletions).map((c, i) => (
            <span key={i} className={cn('size-2 rounded-[1.5px]', CELL_CLASS[c])} />
          ))}
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* DiffView                                                                                   */
/* ------------------------------------------------------------------------------------------ */

export type DiffMode = 'unified' | 'split'

export interface DiffViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  oldText?: string
  newText?: string
  /** Precomputed unified diff (string) or a structured patch — used when texts are absent. */
  patch?: string | StructuredPatch
  path?: string
  /** Previous path when the file was renamed. */
  oldPath?: string
  /** Language for syntax highlighting (inferred from `path`). */
  language?: string
  /** Initial mode; the header toggle switches it. */
  mode?: DiffMode
  /** Controlled mode change callback (keeps internal state in sync). */
  onModeChange?: (mode: DiffMode) => void
  /** Unchanged lines kept around each change. */
  context?: number
  syntax?: boolean
  /** Files longer than this are summarized until the user asks to render them. */
  maxLines?: number
  /** Replaces the default path/stat block in the header. */
  header?: ReactNode
  /** Extra actions at the right of the header. */
  actions?: ReactNode
  hideHeader?: boolean
  /** Cap the body height (px) and scroll inside. */
  maxHeight?: number
}

interface Model {
  segments: DiffSegment[]
  stats: { additions: number; deletions: number }
  maxLineNo: number
  oldHL: CodeLine[] | null
  newHL: CodeLine[] | null
  fileName?: string
  tooComplex?: boolean
  identical?: boolean
  unreadable?: boolean
}

function buildModel(
  oldText: string | undefined,
  newText: string | undefined,
  patch: DiffViewProps['patch'],
  context: number,
  lang: string | undefined,
  syntax: boolean,
): Model {
  if (oldText !== undefined || newText !== undefined) {
    const o = oldText ?? ''
    const n = newText ?? ''
    const lines = buildDiffLines(o, n)
    if (!lines) return { segments: [], stats: { additions: 0, deletions: 0 }, maxLineNo: 0, oldHL: null, newHL: null, tooComplex: true }
    const stats = statsOf(lines)
    return {
      segments: collapseContext(lines, context),
      stats,
      maxLineNo: Math.max(countLines(o), countLines(n)),
      oldHL: syntax && lang ? highlightLines(o, lang) : null,
      newHL: syntax && lang ? highlightLines(n, lang) : null,
      identical: stats.additions === 0 && stats.deletions === 0,
    }
  }
  const p = typeof patch === 'string' ? parseUnifiedDiff(patch)[0] : patch
  if (!p) return { segments: [], stats: { additions: 0, deletions: 0 }, maxLineNo: 0, oldHL: null, newHL: null, unreadable: patch !== undefined }
  const segments = segmentsFromPatch(p)
  const all = segments.flatMap((s) => (s.type === 'lines' ? s.lines : []))
  const maxLineNo = all.reduce((m, l) => Math.max(m, l.oldNo ?? 0, l.newNo ?? 0), 0)
  return { segments, stats: statsOf(all), maxLineNo, oldHL: null, newHL: null, fileName: patchFileName(p), identical: all.length === 0 }
}

function tokensFor(line: DiffLine, model: Model, lang: string | undefined, syntax: boolean): CodeLine {
  const fromDoc = line.kind === 'del' ? model.oldHL?.[line.oldNo! - 1] : model.newHL?.[line.newNo! - 1] ?? model.oldHL?.[line.oldNo! - 1]
  if (fromDoc) return fromDoc
  if (syntax && lang) return highlightLines(line.text, lang)[0] ?? []
  return line.text ? [{ text: line.text }] : []
}

const ROW_BG: Record<DiffLine['kind'], string> = {
  context: '',
  add: 'bg-diff-add-bg',
  del: 'bg-diff-del-bg',
}
const GUTTER_BG: Record<DiffLine['kind'], string> = {
  context: 'bg-sunken',
  add: 'bg-diff-add-bg',
  del: 'bg-diff-del-bg',
}
const SIGN: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '−' }
const SIGN_CLASS: Record<DiffLine['kind'], string> = { context: 'text-ink-4', add: 'text-diff-add-ink', del: 'text-diff-del-ink' }
const MARK_CLASS: Record<DiffLine['kind'], string> = { context: '', add: 'bg-diff-add-mark', del: 'bg-diff-del-mark' }

/**
 * Line diff in unified or split mode: hunk headers, old/new numbers, collapsed context with
 * "expand", word-level emphasis, optional syntax colors and a large-file guard.
 */
export function DiffView({
  oldText,
  newText,
  patch,
  path,
  oldPath,
  language,
  mode: modeProp = 'unified',
  onModeChange,
  context = 3,
  syntax = true,
  maxLines = 3000,
  header,
  actions,
  hideHeader,
  maxHeight,
  className,
  ...props
}: DiffViewProps) {
  const [mode, setModeState] = useState<DiffMode>(modeProp)
  const [prevModeProp, setPrevModeProp] = useState(modeProp)
  if (prevModeProp !== modeProp) {
    setPrevModeProp(modeProp)
    setModeState(modeProp)
  }
  const setMode = (m: DiffMode) => {
    setModeState(m)
    onModeChange?.(m)
  }
  const [forced, setForced] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const sizeLines = Math.max(countLines(oldText ?? ''), countLines(newText ?? ''))
  const guarded = !forced && (oldText !== undefined || newText !== undefined) && sizeLines > maxLines

  const lang = language ?? languageFromPath(path)
  const model = useMemo(
    () => (guarded ? null : buildModel(oldText, newText, patch, context, lang, syntax)),
    [guarded, oldText, newText, patch, context, lang, syntax],
  )
  const displayPath = path ?? model?.fileName
  const gutterCh = Math.max(2, String(model?.maxLineNo ?? sizeLines).length)

  const expand = (id: string) => setExpanded((s) => new Set(s).add(id))

  return (
    <div className={cn('overflow-hidden rounded-md border border-line bg-sunken text-ink', className)} {...props}>
      {!hideHeader && (
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-canvas py-1.5 pr-1.5 pl-3">
          {header ?? (
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {displayPath ? <FileIcon name={displayPath} className="size-3.5" /> : <FileDiff aria-hidden className="size-3.5 text-ink-3" />}
              <span className="min-w-0 truncate font-mono text-xs text-ink-2" title={displayPath}>
                {oldPath && oldPath !== displayPath ? (
                  <>
                    <span className="text-ink-3">{oldPath}</span> <span className="text-ink-4">→</span> {displayPath}
                  </>
                ) : (
                  (displayPath ?? 'Changes')
                )}
              </span>
              {model && !model.tooComplex && !model.unreadable && (
                <DiffStat additions={model.stats.additions} deletions={model.stats.deletions} className="ml-1 shrink-0 max-sm:[&_[data-bar]]:hidden" />
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {actions}
            <Segmented
              label="Diff layout"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'unified', label: 'Unified', icon: <Rows2 /> },
                { value: 'split', label: 'Split', icon: <Columns2 /> },
              ]}
            />
          </div>
        </div>
      )}

      {guarded ? (
        <div className="flex flex-col items-start gap-3 px-4 py-6 sm:flex-row sm:items-center">
          <div className="flex-1">
            <p className="text-sm text-ink">Large file — diff not rendered</p>
            <p className="mt-0.5 text-xs text-ink-3 tabular">
              {formatNumber(countLines(oldText ?? ''))} → {formatNumber(countLines(newText ?? ''))} lines. Rendering may be slow.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setForced(true)}
            className="inline-flex h-8 items-center rounded-sm border border-line-strong px-3 text-sm text-ink transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11"
          >
            Show anyway
          </button>
        </div>
      ) : model?.unreadable ? (
        <p className="px-4 py-6 text-sm text-ink-3">Couldn’t read this patch — it isn’t a unified diff.</p>
      ) : model?.tooComplex ? (
        <p className="px-4 py-6 text-sm text-ink-3">This diff is too complex to compute in the browser.</p>
      ) : model?.identical ? (
        <p className="px-4 py-6 text-sm text-ink-3">No changes.</p>
      ) : model ? (
        <div
          role="region"
          aria-label={`Diff${displayPath ? ` of ${displayPath}` : ''}`}
          tabIndex={0}
          className="overflow-auto focus-visible:outline-offset-[-2px]"
          style={maxHeight ? { maxHeight } : undefined}
        >
          <div className={cn('py-1 font-mono text-xs leading-5 [font-variant-ligatures:none]', mode === 'unified' ? 'w-max min-w-full' : 'w-full')}>
            {model.segments.map((seg, si) => {
              if (seg.type === 'gap') {
                const next = model.segments[si + 1]
                const headerText = next && next.type === 'lines' ? formatHunkHeader(next.hunk) : undefined
                if (expanded.has(seg.id) && seg.expandable) {
                  return <Lines key={seg.id} lines={seg.lines} model={model} lang={lang} syntax={syntax} mode={mode} gutterCh={gutterCh} />
                }
                return (
                  <GapRow
                    key={seg.id}
                    count={seg.count}
                    expandable={seg.expandable}
                    header={headerText}
                    onExpand={() => expand(seg.id)}
                  />
                )
              }
              return (
                <Fragment key={seg.id}>
                  {si === 0 && <HunkRow text={formatHunkHeader(seg.hunk)} />}
                  <Lines lines={seg.lines} model={model} lang={lang} syntax={syntax} mode={mode} gutterCh={gutterCh} />
                </Fragment>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HunkRow({ text }: { text: string }) {
  return (
    <div className="flex h-7 items-center bg-accent-tint/50 px-3 text-2xs text-ink-3 select-none">
      <span className="sticky left-3">{text}</span>
    </div>
  )
}

function GapRow({ count, expandable, header, onExpand }: { count: number; expandable: boolean; header?: string; onExpand: () => void }) {
  return (
    <div className="flex h-8 items-center gap-3 bg-accent-tint/40 pr-3 text-2xs text-ink-3 select-none pointer-coarse:h-11">
      <span className="sticky left-0 flex items-center gap-3 pl-1.5">
        {expandable ? (
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex h-6 items-center gap-1.5 rounded-sm px-1.5 font-sans text-xs text-accent-ink transition-colors duration-(--dur-1) hover:bg-accent-tint pointer-coarse:h-10"
          >
            <UnfoldVertical aria-hidden className="size-3.5" />
            Expand {formatNumber(count)} unchanged {count === 1 ? 'line' : 'lines'}
          </button>
        ) : (
          <span className="px-1.5 font-sans text-xs">{formatNumber(count)} unchanged lines</span>
        )}
        {header && <span className="hidden sm:inline">{header}</span>}
      </span>
    </div>
  )
}

interface LinesProps {
  lines: DiffLine[]
  model: Model
  lang?: string
  syntax: boolean
  mode: DiffMode
  gutterCh: number
}

function Lines({ lines, model, lang, syntax, mode, gutterCh }: LinesProps) {
  const unifiedRanges = useMemo(() => (mode === 'unified' ? unifiedWordRanges(lines) : null), [lines, mode])
  const rows = useMemo(() => (mode === 'split' ? pairLines(lines) : null), [lines, mode])
  const numW = { width: `calc(${gutterCh}ch + 14px)` }

  if (mode === 'unified') {
    return (
      <>
        {lines.map((line, i) => {
          const tokens = overlayRanges(tokensFor(line, model, lang, syntax), unifiedRanges?.get(line))
          return (
            <div key={i} className={cn('flex', ROW_BG[line.kind])}>
              <span className={cn('sticky left-0 z-[1] flex shrink-0 select-none', GUTTER_BG[line.kind])}>
                <span aria-hidden className="pr-2 text-right text-ink-4 tabular" style={numW}>
                  {line.oldNo ?? ''}
                </span>
                <span aria-hidden className="pr-2 text-right text-ink-4 tabular" style={numW}>
                  {line.newNo ?? ''}
                </span>
                <span className={cn('w-5 text-center', SIGN_CLASS[line.kind])}>
                  <span aria-hidden>{SIGN[line.kind]}</span>
                  <span className="sr-only">{line.kind === 'add' ? 'added' : line.kind === 'del' ? 'removed' : ''}</span>
                </span>
              </span>
              <span className="flex-1 pr-6 whitespace-pre">
                <TokenLine tokens={tokens} markClass={MARK_CLASS[line.kind]} />
                {!line.text && '​'}
              </span>
            </div>
          )
        })}
      </>
    )
  }

  return (
    <>
      {rows!.map((row, i) => {
        let lr: Range[] | undefined
        let rr: Range[] | undefined
        if (row.left && row.right && row.left !== row.right) {
          const w = wordRanges(row.left.text, row.right.text)
          lr = w?.old
          rr = w?.new
        }
        return (
          <div key={i} className="grid grid-cols-2">
            <SplitCell line={row.left} ranges={lr} model={model} lang={lang} syntax={syntax} numW={numW} side="old" />
            <SplitCell line={row.right} ranges={rr} model={model} lang={lang} syntax={syntax} numW={numW} side="new" />
          </div>
        )
      })}
    </>
  )
}

function SplitCell({
  line,
  ranges,
  model,
  lang,
  syntax,
  numW,
  side,
}: {
  line: DiffLine | null
  ranges?: Range[]
  model: Model
  lang?: string
  syntax: boolean
  numW: CSSProperties
  side: 'old' | 'new'
}) {
  if (!line) return <div className={cn('min-w-0 bg-hover/50', side === 'new' && 'border-l border-line')} aria-hidden />
  const tokens = overlayRanges(tokensFor(line, model, lang, syntax), ranges)
  const no = side === 'old' ? line.oldNo : line.newNo
  return (
    <div className={cn('flex min-w-0', ROW_BG[line.kind], side === 'new' && 'border-l border-line')}>
      <span aria-hidden className="shrink-0 pr-2 text-right text-ink-4 tabular select-none" style={numW}>
        {no ?? ''}
      </span>
      <span className={cn('w-4 shrink-0 text-center select-none', SIGN_CLASS[line.kind])}>
        <span aria-hidden>{line.kind === 'context' ? '' : SIGN[line.kind]}</span>
        <span className="sr-only">{line.kind === 'add' ? 'added' : line.kind === 'del' ? 'removed' : ''}</span>
      </span>
      <span className="min-w-0 flex-1 pr-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
        <TokenLine tokens={tokens} markClass={MARK_CLASS[line.kind]} />
        {!line.text && '​'}
      </span>
    </div>
  )
}
