import { createContext, useContext, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useInRouterContext, useNavigate, useSearchParams } from 'react-router'
import { ArrowUpRight, Hand, PanelRight, X } from 'lucide-react'
import { useRow } from '@/core/db'
import { getContext, useIsPinned } from '@/core/context'
import { getIntegration } from '@/core/integrations/catalog'
import { KIND_META, TASK_STATUS_LABEL, useEntity, type ResolvedEntity } from '@/core/services/entities'
import { HUES, refKey, type ApprovalStatus, type EntityKind, type EntityRef, type Hue, type RunStatus, type TaskStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { shortCode } from '@/lib/id'
import { useCoarsePointer } from '@/ui/hooks'
import { Button, DynamicIcon, HoverCard } from '@/ui/primitives'
import { RUN_STATUS_META } from './glyphMeta'
import { SimBadge } from './honesty'
import { AgentMark, MonogramMark } from './marks'
import './signature.css'

/*
 * EntityChip, EntityHoverCard, EntityIcon (docs/DESIGN.md §5.4.8). Chips are connected: they resolve
 * the entity live, open Inspector › Item via `?inspect=<kind>:<id>`, navigate on ⌘/Ctrl-click, preview
 * on a 400ms hover, and drag (desktop) as `application/x-atrium-entity`.
 */

export const ENTITY_DRAG_TYPE = 'application/x-atrium-entity'

/** Icon per kind for menus and lists (actors use an abstract orbit, never a robot). */
const KIND_ICON_OVERRIDE: Partial<Record<EntityKind, string>> = { agent: 'Orbit', run: 'Activity' }

export function kindIcon(kind: EntityKind): string {
  return KIND_ICON_OVERRIDE[kind] ?? KIND_META[kind]?.icon ?? 'Circle'
}

export interface EntityIconProps {
  kind: EntityKind
  size?: number
  /** A more specific icon name (e.g. a knowledge item's 'StickyNote'). */
  icon?: string
  className?: string
}

/** The lucide icon for an entity kind. Decorative. */
export function EntityIcon({ kind, size = 14, icon, className }: EntityIconProps) {
  return <DynamicIcon name={icon ?? kindIcon(kind)} className={cn('shrink-0', className)} style={{ width: size, height: size }} strokeWidth={1.75} />
}

// ------------------------------------------------------------------ status words

const APPROVAL_WORD: Record<ApprovalStatus, string> = { pending: 'Needs you', approved: 'Approved', rejected: 'Denied', expired: 'Expired' }

/** User-facing word for a resolved entity's raw status. */
export function entityStatusWord(kind: EntityKind, status: string | undefined): string | undefined {
  if (!status) return undefined
  if (kind === 'run' && status in RUN_STATUS_META) return RUN_STATUS_META[status as RunStatus].word
  if (kind === 'task' && status in TASK_STATUS_LABEL) return TASK_STATUS_LABEL[status as TaskStatus]
  if (kind === 'approval' && status in APPROVAL_WORD) return APPROVAL_WORD[status as ApprovalStatus]
  const words = status.replace(/[_-]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : undefined
}

// ------------------------------------------------------------------ marks

const CAPSULE: Record<string, string> = {
  queued: 'border-[1.5px] border-ink-3',
  running: 'bg-live sig-breathe',
  waiting: 'bg-attn',
  paused: 'border-[1.5px] border-ink-2',
  succeeded: 'bg-ink-3',
  failed: 'bg-fail',
  cancelled: 'border-[1.5px] border-ink-4',
  pending: 'bg-attn',
  approved: 'bg-ink-3',
  rejected: 'bg-fail',
  expired: 'border-[1.5px] border-ink-4',
}

/** A run's (or approval's) capsule glyph: capsules are happenings with a start and an end. */
export function RunCapsule({ status, size = 14, className }: { status: string | undefined; size?: number; className?: string }) {
  const h = Math.round(size * 0.57)
  return (
    <span aria-hidden className="grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <span className={cn('block rounded-full', CAPSULE[status ?? 'queued'] ?? CAPSULE.queued, className)} style={{ width: size, height: h }} />
    </span>
  )
}

/** A kind tile: rounded square with the kind icon (dashed when simulated). */
export function KindTile({ kind, icon, size = 14, simulated, className }: { kind: EntityKind; icon?: string; size?: number; simulated?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-xs text-ink-2',
        simulated ? 'border border-dashed border-line-input' : 'bg-press',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <EntityIcon kind={kind} icon={icon} size={Math.round(size * 0.7)} />
    </span>
  )
}

const asHue = (h: string | undefined): Hue => (h && (HUES as readonly string[]).includes(h) ? (h as Hue) : 'volt')

/** The leading mark for any entity: AgentMark, square monogram, integration ring, run capsule or kind tile. */
export function EntityMark({ entity, resolved, size = 14 }: { entity: EntityRef; resolved: ResolvedEntity; size?: number }) {
  const agent = useRow('agents', entity.kind === 'agent' ? entity.id : null)
  switch (entity.kind) {
    case 'agent':
      return agent ? <AgentMark seed={agent.sigil} hue={agent.hue} size={size} /> : <KindTile kind="agent" size={size} />
    case 'project':
    case 'collection':
    case 'workflow':
      return <MonogramMark text={resolved.title} hue={asHue(resolved.hue)} size={size} />
    case 'integration': {
      const def = getIntegration(entity.id)
      return <MonogramMark variant="ring" text={def?.monogram ?? resolved.title} hue={asHue(def?.hue)} size={size} simulated={def?.support === 'simulated'} />
    }
    case 'run':
    case 'approval':
      return <RunCapsule status={resolved.status} size={size} />
    default:
      return <KindTile kind={entity.kind} icon={resolved.icon} size={size} simulated={resolved.simulated} />
  }
}

// ------------------------------------------------------------------ navigation helpers

/** Open Inspector › Item for an entity (sets `?inspect=`) and navigate to it; router-aware. */
export function useEntityActions() {
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  return {
    inspect: (ref: EntityRef) =>
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.set('inspect', refKey(ref))
        return next
      }),
    open: (route: string) => navigate(route),
  }
}

// ------------------------------------------------------------------ lens card slot

/** Optional richer body for hover cards (the shell plugs the Lens `card` renderer in here). */
export const EntityCardContext = createContext<((entity: EntityRef) => ReactNode) | null>(null)

export function EntityCardProvider({ render, children }: { render: (entity: EntityRef) => ReactNode; children: ReactNode }) {
  return <EntityCardContext.Provider value={render}>{children}</EntityCardContext.Provider>
}

// ------------------------------------------------------------------ hover card

export interface EntityHoverCardProps {
  entity: EntityRef
  className?: string
}

/** Hover-card body (320px): mark, kind, handle, title, project, status, updated, 3-line excerpt; Open · Hold · Inspect. */
export function EntityHoverCard({ entity, className }: EntityHoverCardProps) {
  const routed = useInRouterContext()
  return routed ? <HoverCardBody entity={entity} className={className} routed /> : <HoverCardBody entity={entity} className={className} />
}

function HoverCardActions({ entity, route }: { entity: EntityRef; route: string }) {
  const { inspect, open } = useEntityActions()
  const held = useIsPinned(entity)
  return (
    <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
      <Button size="xs" variant="ghost" leadingIcon={ArrowUpRight} onClick={() => open(route)}>
        Open
      </Button>
      <Button size="xs" variant="ghost" leadingIcon={Hand} aria-pressed={held} onClick={() => getContext().toggle(entity)}>
        {held ? 'Release' : 'Hold'}
      </Button>
      <span className="flex-1" />
      <Button size="xs" variant="ghost" leadingIcon={PanelRight} onClick={() => inspect(entity)}>
        Inspect
      </Button>
    </div>
  )
}

function HoverCardBody({ entity, className, routed }: EntityHoverCardProps & { routed?: boolean }) {
  const r = useEntity(entity)
  const project = useRow('projects', r.projectId && entity.kind !== 'project' ? r.projectId : null)
  const lens = useContext(EntityCardContext)
  const custom = lens?.(entity)
  const status = entityStatusWord(entity.kind, r.status)
  const kindLabel = KIND_META[entity.kind]?.label ?? entity.kind
  return (
    <div className={cn('flex w-80 max-w-[calc(100vw-24px)] flex-col', className)}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <EntityMark entity={entity} resolved={r} size={20} />
          <span className="type-label truncate text-ink-3">{kindLabel}</span>
          <span className="type-meta truncate text-ink-3">{shortCode(entity.id)}</span>
          <span className="flex-1" />
          {r.simulated && <SimBadge noTooltip />}
        </div>
        <div className={cn('type-body line-clamp-2 font-medium text-pretty', r.exists ? 'text-ink' : 'text-ink-3')}>{r.title}</div>
        {(project || status || r.updatedAt) && (
          <div className="type-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ink-3">
            {project && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MonogramMark text={project.name} hue={project.hue} size={12} />
                <span className="truncate text-ink-2">{project.name}</span>
              </span>
            )}
            {project && status && <span aria-hidden>·</span>}
            {status && <span>{status}</span>}
            {r.updatedAt !== undefined && (status || project) && <span aria-hidden>·</span>}
            {r.updatedAt !== undefined && <span className="type-meta">Updated {timeAgo(r.updatedAt)}</span>}
          </div>
        )}
        {custom ?? (r.subtitle && <p className="type-caption line-clamp-3 text-ink-2">{r.subtitle}</p>)}
        {!r.exists && <p className="type-caption text-ink-3">This item was deleted or is no longer available.</p>}
      </div>
      {routed && r.exists && <HoverCardActions entity={entity} route={r.route} />}
    </div>
  )
}

// ------------------------------------------------------------------ chip

export interface EntityChipProps {
  entity: EntityRef
  /** md 22px (default) · sm 18px. */
  size?: 'sm' | 'md'
  variant?: 'default' | 'subtle' | 'outline'
  /** Show a × that calls this. */
  onRemove?: () => void
  noHoverCard?: boolean
  /** Static chip: no inspect/navigate/drag. */
  noLink?: boolean
  /** Prefix the kind ("Task · …"). */
  showKind?: boolean
  /** Replace the default click (inspect) — e.g. pickers. ⌘/Ctrl-click still navigates. */
  onActivate?: (entity: EntityRef) => void
  /** Drag to drop targets (desktop). Default true. */
  draggable?: boolean
  className?: string
}

const VARIANT = {
  default: 'border border-line-strong',
  subtle: 'border border-transparent bg-hover',
  outline: 'border border-line',
} as const

/** A reference to any entity, resolved live. */
export function EntityChip(props: EntityChipProps) {
  const routed = useInRouterContext()
  return routed && !props.noLink ? <RoutedChip {...props} /> : <ChipFrame {...props} />
}

function RoutedChip(props: EntityChipProps) {
  const { inspect, open } = useEntityActions()
  return <ChipFrame {...props} onInspect={props.onActivate ?? inspect} onOpen={open} />
}

function ChipFrame({
  entity,
  size = 'md',
  variant = 'default',
  onRemove,
  noHoverCard,
  showKind,
  draggable = true,
  className,
  onInspect,
  onOpen,
}: EntityChipProps & { onInspect?: (ref: EntityRef) => void; onOpen?: (route: string) => void }) {
  const r = useEntity(entity)
  const coarse = useCoarsePointer()
  const sm = size === 'sm'
  const interactive = !!onInspect && r.exists
  const kindLabel = KIND_META[entity.kind]?.label ?? entity.kind
  const title = r.exists ? r.title : 'Deleted item'

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (e.metaKey || e.ctrlKey) onOpen?.(r.route)
    else onInspect?.(entity)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === ' ') {
      e.preventDefault()
      onInspect?.(entity)
    }
  }
  const onDragStart = (e: DragEvent<HTMLAnchorElement>) => {
    e.dataTransfer.setData(ENTITY_DRAG_TYPE, JSON.stringify({ kind: entity.kind, id: entity.id }))
    e.dataTransfer.setData('text/plain', title)
    e.dataTransfer.effectAllowed = 'copyLink'
  }

  const content = (
    <>
      <EntityMark entity={entity} resolved={r} size={sm ? 12 : 14} />
      {showKind && <span className="shrink-0 text-ink-3">{kindLabel} ·</span>}
      <span className={cn('min-w-0 truncate', !r.exists && 'text-ink-3 line-through decoration-ink-4')}>{title}</span>
      {r.simulated && <SimBadge noTooltip className={sm ? 'h-3 px-0.5 text-[9px]' : undefined} />}
    </>
  )
  const inner = cn('inline-flex min-w-0 items-center', sm ? 'gap-1' : 'gap-1.5')
  const accessibleName = `${kindLabel}: ${title}${r.simulated ? ' (simulated)' : ''}`

  const main = interactive ? (
    <a
      href={r.route}
      onClick={onClick}
      onKeyDown={onKeyDown}
      draggable={draggable && !coarse}
      onDragStart={draggable && !coarse ? onDragStart : undefined}
      aria-label={accessibleName}
      className={cn(
        inner,
        'h-full max-w-[220px] rounded-[5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-ring)',
        sm ? 'pr-1.5 pl-1' : 'pr-2 pl-1',
        onRemove && (sm ? 'pr-0.5' : 'pr-1'),
        "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
      )}
    >
      {content}
    </a>
  ) : (
    <span aria-label={accessibleName} role="img" className={cn(inner, 'max-w-[220px]', sm ? 'pr-1.5 pl-1' : 'pr-2 pl-1', onRemove && 'pr-0.5')}>
      {content}
    </span>
  )

  const chip = (
    <span
      data-entity={refKey(entity)}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-sm align-middle leading-none font-medium whitespace-nowrap text-ink',
        sm ? 'type-micro h-[18px]' : 'type-caption h-[22px] font-medium',
        VARIANT[variant],
        r.simulated && variant !== 'subtle' && 'border-dashed border-line-input',
        interactive && 'transition-colors duration-(--dur-1) ease-standard hover:bg-hover active:bg-press',
        className,
      )}
    >
      {interactive && !noHoverCard ? (
        <HoverCard content={<EntityHoverCard entity={entity} />} className="w-auto p-0" placement="bottom-start">
          {main}
        </HoverCard>
      ) : (
        main
      )}
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${title}`}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className={cn(
            'relative mr-0.5 grid shrink-0 place-items-center rounded-xs text-ink-3 transition-colors duration-(--dur-1) hover:bg-press hover:text-ink',
            sm ? 'size-3.5' : 'size-4',
            "pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']",
          )}
        >
          <X aria-hidden className={sm ? 'size-2.5' : 'size-3'} strokeWidth={2.25} />
        </button>
      )}
    </span>
  )
  return chip
}
