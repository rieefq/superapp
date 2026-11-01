import { Component, memo, type ErrorInfo, type ReactNode } from 'react'
import { BookMarked, Clock, Layers, MessagesSquare, Orbit, SquareDashed, Telescope, Upload, type LucideIcon } from 'lucide-react'
import { useDB, type Tables } from '@/core/db'
import { AI_AVAILABILITY_LABEL, KNOWLEDGE_KIND_META, KIND_META, useKnowledgeUsage } from '@/core/services'
import { getIntegration } from '@/core/integrations/catalog'
import type { KnowledgeItem } from '@/core/types'
import { DynamicIcon, ErrorState, KindTile, Tooltip } from '@/ui'
import { cn } from '@/lib/cn'
import { isImage, type SmartFilter } from './model'

/** `[start, end)` ranges → text with `<mark>` washes (the neutral search highlight, §4.1 `--highlight`). */
export function Highlight({ text, ranges, className }: { text: string; ranges?: readonly (readonly [number, number])[]; className?: string }) {
  if (!ranges?.length) return <span className={className}>{text}</span>
  const out: ReactNode[] = []
  let at = 0
  ranges.forEach(([s, e], i) => {
    if (s > at) out.push(text.slice(at, s))
    out.push(
      <mark key={i} className="rounded-[2px] bg-highlight text-inherit">
        {text.slice(s, e)}
      </mark>,
    )
    at = e
  })
  if (at < text.length) out.push(text.slice(at))
  return <span className={className}>{out}</span>
}

/** The item's mark: a rounded-square kind tile (dashed when simulated), or the image preview for images. */
export const KnowledgeTile = memo(function KnowledgeTile({ item, size = 20, className }: { item: Pick<KnowledgeItem, 'kind' | 'file' | 'simulated'>; size?: number; className?: string }) {
  if (item.file?.previewUrl && size >= 28) {
    return (
      <span
        aria-hidden
        className={cn('block shrink-0 overflow-hidden rounded-sm border border-line bg-sunken', className)}
        style={{ width: size, height: size }}
      >
        <img src={item.file.previewUrl} alt="" className="size-full object-cover" draggable={false} />
      </span>
    )
  }
  const icon = isImage(item) ? 'Image' : (KNOWLEDGE_KIND_META[item.kind] ?? KNOWLEDGE_KIND_META.note).icon
  return <KindTile kind="knowledge" icon={icon} size={size} simulated={item.simulated} className={className} />
})

/** Where an item came from, as words: "Research · Competitor teardown", "Notion", "Uploaded", "Scout". */
export function originWords(s: Tables, item: KnowledgeItem): { label: string; icon: string } | null {
  const { source } = item
  const ref = source.ref
  if (ref) {
    const meta = KIND_META[ref.kind]
    const title = (() => {
      switch (ref.kind) {
        case 'investigation':
          return s.investigations[ref.id]?.title
        case 'message': {
          const m = s.messages[ref.id]
          return m ? s.threads[m.threadId]?.title : undefined
        }
        case 'thread':
          return s.threads[ref.id]?.title
        case 'run':
          return s.runs[ref.id]?.title
        case 'task':
          return s.tasks[ref.id]?.title
        case 'asset':
          return s.assets[ref.id]?.title
        case 'session':
          return s.sessions[ref.id]?.title
        case 'knowledge':
          return s.knowledge[ref.id]?.title
        default:
          return undefined
      }
    })()
    const where = ref.kind === 'message' || ref.kind === 'thread' ? 'Chat' : ref.kind === 'investigation' ? 'Research' : meta.label
    return { label: title ? `${where} · ${title}` : where, icon: ref.kind === 'message' ? 'MessagesSquare' : meta.icon }
  }
  if (source.type === 'integration' && source.integrationId) {
    const def = getIntegration(source.integrationId)
    return { label: def?.name ?? source.integrationId, icon: 'Plug' }
  }
  if (source.type === 'upload') return { label: item.file ? `Upload · ${item.file.name}` : 'Upload', icon: 'Upload' }
  if (item.author.type === 'agent') {
    const agent = s.agents[item.author.id]
    return { label: agent?.name ?? 'An agent', icon: 'Orbit' }
  }
  if (source.url) {
    try {
      return { label: new URL(source.url).hostname.replace(/^www\./, ''), icon: 'Link' }
    } catch {
      return { label: 'Link', icon: 'Link' }
    }
  }
  return null
}

/** Non-interactive origin label for rows and cards ("from Research · Competitor teardown"). */
export function OriginLabel({ item, className }: { item: KnowledgeItem; className?: string }) {
  const origin = useDB((s) => {
    const o = originWords(s, item)
    return o ? `${o.icon}|${o.label}` : ''
  })
  if (!origin) return null
  const at = origin.indexOf('|')
  const icon = origin.slice(0, at)
  const label = origin.slice(at + 1)
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)} title={`From ${label}`}>
      <DynamicIcon name={icon} aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate">from {label}</span>
    </span>
  )
}

/** "used by 6 runs" — runs whose Saw list includes the item. */
export function UsageText({ id, className, zero = 'not used yet' }: { id: string; className?: string; zero?: string | null }) {
  const { count } = useKnowledgeUsage(id)
  if (!count && zero === null) return null
  return (
    <span className={cn('whitespace-nowrap tabular', className)}>
      {count ? `used by ${count} run${count === 1 ? '' : 's'}` : zero}
    </span>
  )
}

/** A small neutral tag when an item is not always available to AI (rows, cards, headers). */
export function AvailabilityTag({ value, className }: { value: KnowledgeItem['aiAvailability']; className?: string }) {
  if (!value || value === 'always') return null
  const text = value === 'never' ? 'Never sent to AI' : 'AI: when cited'
  const tip =
    value === 'never'
      ? 'Available to AI: Never. Retrieval never reads it, and it can’t be held or @-mentioned.'
      : 'Available to AI: When cited. Read only when held, attached or @-mentioned — never picked automatically.'
  return (
    <Tooltip content={tip}>
      <span className={cn('type-meta inline-flex h-4 shrink-0 items-center rounded-xs border border-line-strong px-1 text-ink-3', className)} aria-label={tip}>
        {text}
      </span>
    </Tooltip>
  )
}

/** `Not indexed` tag for non-text files (their contents were not read). */
export function NotIndexedTag({ className }: { className?: string }) {
  const tip = 'Only the file name and details are searchable — its contents could not be read in the browser.'
  return (
    <Tooltip content={tip}>
      <span className={cn('type-meta inline-flex h-4 shrink-0 items-center rounded-xs border border-line-strong px-1 text-ink-3', className)} aria-label={`Not indexed. ${tip}`}>
        Not indexed
      </span>
    </Tooltip>
  )
}

export const AVAILABILITY_OPTIONS = [
  { value: 'always', label: AI_AVAILABILITY_LABEL.always },
  { value: 'cited', label: AI_AVAILABILITY_LABEL.cited },
  { value: 'never', label: AI_AVAILABILITY_LABEL.never },
] as const

export const AVAILABILITY_EFFECT: Record<'always' | 'cited' | 'never', string> = {
  always: 'Retrieval can pick it for any AI action in its project.',
  cited: 'Read only when held, attached or @-mentioned — never picked automatically.',
  never: 'Retrieval never reads it, and it can’t be held or @-mentioned. It stays searchable here.',
}

/** Smart filter icons (list pane rows, headers, empty states). Simulated uses the dashed square of the honesty grammar. */
export const FILTER_ICON: Record<SmartFilter, LucideIcon> = {
  recent: Clock,
  held: Layers,
  memory: BookMarked,
  research: Telescope,
  uploads: Upload,
  chat: MessagesSquare,
  agents: Orbit,
  simulated: SquareDashed,
}

/**
 * A failing section shows an ErrorState with Retry while the rest of the view keeps working
 * ("Couldn't {verb} {thing}", §5.4.14).
 */
export class SectionBoundary extends Component<{ what: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[knowledge] ${this.props.what} failed`, error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <ErrorState
        compact
        title={`Couldn’t show ${this.props.what}`}
        message="Something in this part failed to draw. Your knowledge is safe, and the rest of the page still works."
        details={this.state.error.stack ?? this.state.error.message}
        onRetry={() => this.setState({ error: null })}
        retryLabel="Retry"
      />
    )
  }
}
