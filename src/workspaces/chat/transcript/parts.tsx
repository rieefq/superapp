import { useId, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { BookOpen, ChevronRight, File, FileText, Globe, Image as ImageIcon, RotateCcw, Search, Wrench } from 'lucide-react'
import { DerivedRow, LandedCard, type DerivedItem } from '@/app/components'
import { getModelInfo } from '@/core/ai'
import { isRunActive, type Attachment, type Citation, type ID, type Message, type ToolTrace } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatBytes, formatDateTime, formatTime } from '@/lib/format'
import { Button, EntityChip, IdCode, LiveBadge, RunStatusGlyph, SimBadge, StatusGlyph, Tooltip } from '@/ui'
import { inspectNow } from '../actions'
import { startOfLocalDay } from '../logic/grouping'

/*
 * The pieces of a turn (§6.2 Transcript): the gutter (speaker in meta-caps, time, run handle, the
 * thread spine — a .sim-band for simulated replies), tool traces, the reasoning disclosure, the
 * Sources row, attachments, the inline error and items made from the conversation.
 */

// ------------------------------------------------------------------------------------------------ speaker

export function speakerOf(message: Pick<Message, 'role' | 'modelId' | 'simulated'>): { label: string; simulated: boolean } {
  if (message.role === 'user') return { label: 'You', simulated: false }
  const model = getModelInfo(message.modelId)
  if (message.simulated || model?.simulated) return { label: 'Simulator', simulated: true }
  return { label: model?.label ?? 'Assistant', simulated: false }
}

/** "10:42 AM" today; "Oct 24" before (the full date and time are in the tooltip). */
export function turnTime(ts: number, now = Date.now()): string {
  if (ts >= startOfLocalDay(now)) return formatTime(ts)
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, d.getFullYear() === new Date(now).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', year: 'numeric' })
}

interface GutterProps {
  speaker: string
  simulated: boolean
  at: number
  runId?: ID
  /** The reply is being written: the glyph breathes and reads "writing…". */
  writing?: boolean
  failed?: boolean
  stopped?: boolean
}

function StateLine({ writing, failed, stopped }: Pick<GutterProps, 'writing' | 'failed' | 'stopped'>) {
  if (writing)
    return (
      <span className="type-meta inline-flex items-center gap-1 whitespace-nowrap text-live-ink">
        <RunStatusGlyph status="running" size={10} decorative />
        writing…
      </span>
    )
  if (failed)
    return (
      <span className="type-meta inline-flex items-center gap-1 whitespace-nowrap text-fail-ink">
        <RunStatusGlyph status="failed" size={10} decorative />
        failed
      </span>
    )
  if (stopped)
    return (
      <span className="type-meta inline-flex items-center gap-1 whitespace-nowrap text-ink-3">
        <RunStatusGlyph status="cancelled" size={10} decorative />
        stopped
      </span>
    )
  return null
}

/** Wide transcripts: the 72px gutter column with the spine under the labels. */
export function Gutter({ speaker, simulated, at, runId, writing, failed, stopped, spine }: GutterProps & { spine: 'line' | 'sim' }) {
  return (
    <div className="relative hidden flex-col items-start pt-[3px] @min-[600px]:flex">
      {/* 68px of the 72px column: "SIMULATOR" and "● writing…" are the widest lines and fit exactly. */}
      <div className="flex w-full flex-col items-start gap-1 pr-1">
        <span className="type-meta-caps break-words text-ink-2">{speaker}</span>
        {simulated && <SimBadge noTooltip />}
        <span className="type-meta text-ink-3 tabular" title={formatDateTime(at)}>
          {turnTime(at)}
        </span>
        {runId && <IdCode id={runId} className="type-meta text-ink-3" />}
        <StateLine writing={writing} failed={failed} stopped={stopped} />
      </div>
      <span aria-hidden className={cn('mt-2 min-h-4 flex-1', spine === 'sim' ? 'sim-band' : 'ml-px w-px bg-line-strong')} />
    </div>
  )
}

/** Narrow transcripts (<600px): the gutter folds into a header line above the turn. */
export function TurnHeaderLine({ speaker, simulated, at, runId, writing, failed, stopped }: GutterProps) {
  return (
    <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 @min-[600px]:hidden">
      <span className="type-meta-caps text-ink-2">{speaker}</span>
      {simulated && <SimBadge noTooltip />}
      <span aria-hidden className="text-ink-4">
        ·
      </span>
      <span className="type-meta text-ink-3 tabular" title={formatDateTime(at)}>
        {turnTime(at)}
      </span>
      {runId && (
        <>
          <span aria-hidden className="text-ink-4">
            ·
          </span>
          <IdCode id={runId} className="type-meta text-ink-3" />
        </>
      )}
      {(writing || failed || stopped) && (
        <>
          <span aria-hidden className="text-ink-4">
            ·
          </span>
          <StateLine writing={writing} failed={failed} stopped={stopped} />
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ disclosure

function Disclosure({
  icon,
  label,
  meta,
  children,
  defaultOpen = false,
}: {
  icon: ReactNode
  label: ReactNode
  meta?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="group/disc -ml-1.5 flex h-7 max-w-full min-w-0 items-center gap-1.5 self-start rounded-sm px-1.5 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-1)', open && 'rotate-90')} strokeWidth={1.75} />
        {icon}
        <span className="type-caption min-w-0 truncate text-ink-2 group-hover/disc:text-ink">{label}</span>
        {meta}
      </button>
      {open && (
        <div id={id} className="mt-1 mb-1 ml-[7px] border-l border-line-strong pl-4">
          {children}
        </div>
      )}
    </div>
  )
}

const TOOL_ICON: Record<string, typeof Search> = { 'knowledge.search': BookOpen, 'web.search': Globe }

/** "Searched knowledge · 3 results · LIVE local" — collapsible, showing what was found. */
export function ToolTraces({ tools, messageSimulated }: { tools: readonly ToolTrace[]; messageSimulated: boolean }) {
  return (
    <div className="flex flex-col">
      {tools.map((t) => {
        const Icon = TOOL_ICON[t.name] ?? Wrench
        const running = t.status === 'running'
        const local = t.name.startsWith('knowledge.')
        // Origin tags only where live and simulated mix (§5.4.5): a live step inside a simulated answer, or a simulated step.
        const origin = t.simulated ? (
          <SimBadge noTooltip />
        ) : messageSimulated ? (
          <span className="inline-flex items-center gap-1">
            <LiveBadge noTooltip />
            {local && <span className="type-meta text-ink-3">local</span>}
          </span>
        ) : null
        const label = running ? t.label.replace(/^Searched/, 'Searching').replace(/^Read/, 'Reading') : t.label
        const results = t.results ?? []
        return (
          <Disclosure
            key={t.id}
            icon={running ? <RunStatusGlyph status="running" size={12} decorative /> : <Icon aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />}
            label={
              <>
                {label}
                {t.detail && <span className="text-ink-3"> · {t.detail}</span>}
              </>
            }
            meta={origin && <span className="ml-0.5 inline-flex shrink-0 items-center">{origin}</span>}
          >
            {results.length ? (
              <div className="flex flex-wrap gap-1.5 py-1">
                {results.map((r) => (
                  <EntityChip key={`${r.kind}:${r.id}`} entity={r} size="sm" />
                ))}
              </div>
            ) : (
              <p className="type-caption py-1 text-ink-3">{t.status === 'error' ? 'The step failed.' : 'Nothing matched.'}</p>
            )}
            {!t.simulated && local && (
              <p className="type-caption pb-1 text-ink-3">Searched this device’s Knowledge index. Nothing left the browser.</p>
            )}
          </Disclosure>
        )
      })}
    </div>
  )
}

/** "Reasoning · 96 words" — the model's reasoning summary, collapsed by default. */
export function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return (
    <Disclosure
      icon={streaming ? <RunStatusGlyph status="running" size={12} decorative /> : <StatusGlyph shape="ring" tone="ink-3" size={12} decorative />}
      label={streaming ? 'Thinking' : 'Reasoning'}
      meta={<span className="type-meta shrink-0 text-ink-3">{words} words</span>}
    >
      <p className="type-body-sm py-1 whitespace-pre-wrap text-ink-2 text-pretty">{text}</p>
    </Disclosure>
  )
}

// ------------------------------------------------------------------------------------------------ sources

/** The Sources row: numbered chips matching the [n] markers. Click inspects; ⌘-click opens. */
export function Sources({ citations }: { citations: readonly Citation[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="type-label text-ink-3">Sources</span>
      {citations.map((c, i) => (
        <span key={c.id} className="inline-flex min-w-0 items-center gap-1">
          <span className="type-meta text-ink-3 tabular">{i + 1}</span>
          <EntityChip entity={c.ref} size="sm" />
        </span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ attachments

const KIND_ICON: Record<Attachment['kind'], typeof File> = { text: FileText, image: ImageIcon, pdf: FileText, other: File }

/** Files sent with a message: images as thumbnails, files as chips (linked to Knowledge when saved there). */
export function Attachments({ items }: { items: readonly Attachment[] }) {
  const images = items.filter((a) => a.kind === 'image' && a.previewUrl)
  const files = items.filter((a) => !(a.kind === 'image' && a.previewUrl))
  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => (
            <figure key={a.id} className="flex flex-col gap-1">
              <img src={a.previewUrl} alt={a.name} className="h-24 max-w-[200px] rounded-sm border border-line object-cover" />
              <figcaption className="type-meta max-w-[200px] truncate text-ink-3">{a.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <ul className="flex flex-col items-start gap-1.5" aria-label="Attachments">
          {files.map((a) => {
            const Icon = KIND_ICON[a.kind]
            return (
              <li key={a.id} className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1">
                <span className="type-caption inline-flex h-[22px] max-w-[280px] min-w-0 items-center gap-1.5 rounded-sm border border-line-strong pr-2 pl-1.5 font-medium text-ink">
                  <Icon aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                  <span className="truncate">{a.name}</span>
                </span>
                <span className="type-meta text-ink-3">{formatBytes(a.size)}</span>
                {a.kind === 'text' ? (
                  <span className="type-caption text-ink-3">· read on this device</span>
                ) : a.kind !== 'image' ? (
                  <span className="type-caption text-ink-3">· contents not read</span>
                ) : null}
                {a.knowledgeId && (
                  <button
                    type="button"
                    onClick={() => inspectNow({ kind: 'knowledge', id: a.knowledgeId as string })}
                    className="type-caption rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink"
                  >
                    In Knowledge
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ error

export function integrationFor(modelId: string | undefined): string {
  const model = getModelInfo(modelId)
  if (model?.providerId === 'anthropic') return '/integrations/anthropic'
  if (model?.providerId === 'openai-compatible') return '/integrations/openai-compatible'
  return '/integrations'
}

/** The inline fail note (§6.2 Error): what happened, then Retry · Open Integrations · Use Simulator for this turn. */
export function ErrorNote({
  error,
  modelId,
  onRetry,
  onSimulator,
  canRetry,
}: {
  error: string
  modelId?: string
  onRetry?: () => void
  onSimulator?: () => void
  canRetry: boolean
}) {
  const model = getModelInfo(modelId)
  const live = !!model && !model.simulated
  return (
    <div role="alert" className="flex gap-2.5 rounded-md border border-line border-l-2 border-l-fail bg-raised py-2.5 pr-3 pl-3">
      <RunStatusGlyph status="failed" size={14} className="mt-[3px]" decorative />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="type-body-sm font-medium text-ink">Couldn’t finish this answer</p>
          <p className="type-body-sm text-ink-2 text-pretty">{error}</p>
        </div>
        <div className="-ml-1.5 flex flex-wrap items-center gap-1">
          {canRetry && onRetry && (
            <Button size="xs" variant="secondary" leadingIcon={RotateCcw} onClick={onRetry}>
              Retry
            </Button>
          )}
          {live && (
            <Link
              to={integrationFor(modelId)}
              className="type-caption inline-flex h-6 items-center rounded-sm px-2 font-medium text-ink-2 underline decoration-line-input underline-offset-2 transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink"
            >
              Open Integrations
            </Link>
          )}
          {live && canRetry && onSimulator && (
            <Tooltip content="Answers this turn with the local simulator. No model is called; the answer is labeled simulated.">
              <Button size="xs" variant="ghost" onClick={onSimulator}>
                Use Simulator for this turn
              </Button>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ made from the conversation

/** One item made from a message or the conversation: a DerivedRow while it runs, a LandedCard when it ends, a chip otherwise. */
export function DerivedItemView({ item }: { item: DerivedItem }) {
  if (item.run && !isRunActive(item.run.status)) return <LandedCard run={item.run} subject={item.ref.kind === 'run' ? undefined : item.ref} />
  if (item.run) return <DerivedRow item={item} />
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-1.5">
      <span aria-hidden className="type-caption text-ink-4">
        ↳
      </span>
      <EntityChip entity={item.ref} size="sm" showKind />
    </div>
  )
}
