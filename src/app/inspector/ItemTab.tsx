import { Component, Suspense, useMemo, type ComponentType, type ErrorInfo, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { ArrowUpRight, ChevronLeft, Copy, Ellipsis, Layers, Link2, LibraryBig, Shuffle } from 'lucide-react'
import { useDB } from '@/core/db'
import { useIsPinned } from '@/core/context'
import {
  KIND_META,
  actorName,
  describeSource,
  entityRoute,
  toKnowledge,
  useActivityFor,
  useConnections,
  useEntity,
  type Connection,
} from '@/core/services'
import type { ActivityEvent, EntityRef, ID } from '@/core/types'
import { refKey } from '@/core/types'
import { Button, EmptyState, EntityChip, EntityMark, ErrorState, IconButton, IdCode, Menu, MonogramMark, SimBadge, Skeleton, toast, type MenuItem } from '@/ui'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import { timeAgo, truncate } from '@/lib/format'
import { useLens } from '../lens/registry'
import type { LensProps } from '../lens/types'
import { currentSegment, openStartSheet, useShellStore, type StartKind } from '../shell/store'
import { toggleHold } from '../shell/scope'
import { INSPECT_PARAM, formatInspectParam } from './inspect'

/** What Inspector › Item shows: the peek stack's top, else the selection, else the stage's primary object. */
export function useInspectedRef(): EntityRef | null {
  const location = useLocation()
  const top = useShellStore((s) => s.inspectStack[s.inspectStack.length - 1])
  const selection = useShellStore((s) => (s.selectionPath === currentSegment(location.pathname) ? s.selection : null))
  const primary = useShellStore((s) => s.stagePrimary)
  return top ?? selection ?? primary ?? null
}

/** Inspector › Item (§3.5): header, lens body (or the generic panel), Links and History. */
export function ItemTab() {
  const ref = useInspectedRef()
  if (!ref) {
    return (
      <EmptyState
        compact
        title="Nothing selected"
        description="Select an item, or press Space on a row, to see it here with its links and history."
        className="px-4 pt-5"
      />
    )
  }
  return <ItemView key={refKey(ref)} entity={ref} />
}

const START_KINDS: { kind: StartKind; label: string }[] = [
  { kind: 'task', label: 'Task' },
  { kind: 'research', label: 'Research' },
  { kind: 'session', label: 'Coding session' },
  { kind: 'agent', label: 'Agent run' },
  { kind: 'workflow', label: 'Workflow run' },
  { kind: 'note', label: 'Note' },
  { kind: 'studio', label: 'Studio' },
]

function ItemView({ entity: ref }: { entity: EntityRef }) {
  const navigate = useNavigate()
  const [, setParams] = useSearchParams()
  const stack = useShellStore((s) => s.inspectStack)
  const entity = useEntity(ref)
  const held = useIsPinned(ref)
  const project = useDB((s) => (entity.projectId ? s.projects[entity.projectId] : undefined))
  const previous = stack.length > 1 ? stack[stack.length - 2] : undefined
  const meta = KIND_META[ref.kind]

  const open = () => navigate(entityRoute(ref))
  const back = () => {
    if (!previous) return
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        next.set(INSPECT_PARAM, formatInspectParam(previous))
        return next
      },
      { replace: true },
    )
  }
  const save = () => {
    try {
      const result = toKnowledge(ref)
      toast.success('Saved to Knowledge', { action: { label: 'Open', onClick: () => navigate(result.route) } })
    } catch (err) {
      toast.error('Couldn’t save to Knowledge', { description: err instanceof Error ? err.message : String(err) })
    }
  }
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${what} copied`)
    } catch {
      toast.error(`Couldn’t copy the ${what.toLowerCase()}`)
    }
  }

  const turnInto: MenuItem[] = START_KINDS.map((k) => ({ id: k.kind, label: k.label, onSelect: () => openStartSheet(k.kind, { source: ref }) }))
  const more: MenuItem[] = [
    { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copy(`${window.location.origin}${entityRoute(ref)}`, 'Link') },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => void copy(shortCode(ref.id), 'Handle') },
  ]

  if (!entity.exists) {
    return (
      <div className="flex flex-col">
        {previous && <BackRow previous={previous} onBack={back} />}
        <EmptyState compact title="This item was deleted" description="It no longer exists, so there is nothing to inspect." className="px-4 pt-5" />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          open()
        }
      }}
    >
      {previous && <BackRow previous={previous} onBack={back} />}
      <header className="flex flex-col gap-3 border-b border-line px-4 pt-3.5 pb-3">
        <div className="flex items-start gap-3">
          <EntityMark entity={ref} resolved={entity} size={32} />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="type-label text-ink-3">{meta.label}</span>
            <h2 className="type-title-3 text-pretty text-ink">{entity.title}</h2>
          </div>
        </div>
        <div className="type-meta flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-3">
          <IdCode id={ref.id} />
          {project && (
            <>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1.5">
                <MonogramMark text={project.name} hue={project.hue} size={12} />
                {project.name}
              </span>
            </>
          )}
          {entity.status && (
            <>
              <span aria-hidden>·</span>
              <span>{statusWord(entity.status)}</span>
            </>
          )}
          {entity.updatedAt && (
            <>
              <span aria-hidden>·</span>
              <span>{timeAgo(entity.updatedAt)}</span>
            </>
          )}
          {entity.simulated && <SimBadge size="xs" />}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" leadingIcon={ArrowUpRight} kbd="mod+enter" onClick={open}>
            Open
          </Button>
          <Button size="sm" variant="ghost" leadingIcon={Layers} aria-pressed={held} onClick={() => toggleHold(ref)} kbd="h">
            {held ? 'Release' : 'Hold'}
          </Button>
          {ref.kind !== 'knowledge' && (
            <Button size="sm" variant="ghost" leadingIcon={LibraryBig} onClick={save}>
              Save to Knowledge
            </Button>
          )}
          <Menu
            items={turnInto}
            aria-label="Turn into"
            trigger={<Button size="sm" variant="ghost" leadingIcon={Shuffle}>Turn into…</Button>}
          />
          <Menu items={more} aria-label="More actions" placement="bottom-end" trigger={<IconButton icon={Ellipsis} label="More actions" size="sm" />} />
        </div>
      </header>

      <LensBody entity={ref} />
      <Links entity={ref} />
      <History entity={ref} />
    </div>
  )
}

function statusWord(status: string): string {
  const s = status.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function BackRow({ previous, onBack }: { previous: EntityRef; onBack: () => void }) {
  const prev = useEntity(previous)
  return (
    <button
      type="button"
      onClick={onBack}
      className="type-caption flex h-8 w-full items-center gap-1 border-b border-line px-3 text-left text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
    >
      <ChevronLeft aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
      <span className="shrink-0">Back</span>
      <span className="truncate text-ink-4">· {prev.title}</span>
    </button>
  )
}

// ------------------------------------------------------------------------------------------------ lens body

class LensBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[inspector] lens panel failed', error, info.componentStack)
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children
  }
}

function LensBody({ entity }: { entity: EntityRef }) {
  const { lens, loading } = useLens(entity.kind)
  const Panel = lens?.panel as ComponentType<LensProps> | undefined
  if (loading) {
    return (
      <div className="flex flex-col gap-2 px-4 py-4" aria-busy="true" aria-label="Loading details">
        <Skeleton variant="text" lines={3} />
      </div>
    )
  }
  if (!Panel) return <GenericPanel entity={entity} />
  return (
    <section aria-label="Details" className="border-b border-line">
      <LensBoundary fallback={<ErrorState compact title="Couldn’t show this item’s details" message="The details panel failed. The links and history below still work." className="m-4" />}>
        <Suspense fallback={<div className="px-4 py-4"><Skeleton variant="text" lines={3} /></div>}>
          <Panel entity={entity} />
        </Suspense>
      </LensBoundary>
    </section>
  )
}

/** The generic panel for kinds without a lens: subtitle, a plain-text excerpt and the basic facts. */
export function GenericPanel({ entity: ref }: { entity: EntityRef }) {
  const entity = useEntity(ref)
  const excerpt = useMemo(() => {
    try {
      // Plain text without Markdown punctuation (tables, headings, emphasis).
      const text = describeSource(ref).text.replace(/[|#*_`>]+/g, ' ').replace(/-{3,}/g, ' ')
      return truncate(text.replace(/\s+/g, ' ').trim(), 420)
    } catch {
      return ''
    }
    // The excerpt follows the entity's last update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.kind, ref.id, entity.updatedAt])
  // The excerpt usually opens with the subtitle (a description or goal): show it once.
  const subtitle = entity.subtitle && !(excerpt && excerpt.startsWith(entity.subtitle.slice(0, 32))) ? entity.subtitle : undefined
  return (
    <section aria-label="Details" className="flex flex-col gap-3 border-b border-line px-4 py-3.5">
      {subtitle && <p className="type-body-sm text-ink-2">{subtitle}</p>}
      {excerpt && excerpt !== entity.subtitle && (
        <p className={cn('type-body-sm rounded-sm border px-3 py-2.5 text-ink-2', entity.simulated ? 'border-dashed border-line-input bg-sim-tint' : 'border-line bg-raised')}>{excerpt}</p>
      )}
      {entity.simulated && <p className="type-caption text-ink-3">Simulated: produced by Atrium’s local simulator. No model, web service or integration was called.</p>}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ links

type LinkGroup = 'Came from' | 'Led to' | 'Used by' | 'Cited by' | 'Related'

function groupOf(c: Connection): LinkGroup {
  const { rel } = c.link
  if (rel === 'cites') return c.direction === 'incoming' ? 'Cited by' : 'Related'
  if (rel === 'derived_from') return c.direction === 'outgoing' ? 'Came from' : 'Led to'
  if (rel === 'produced') return c.direction === 'incoming' ? 'Came from' : 'Led to'
  if (rel === 'references') return c.direction === 'incoming' ? 'Used by' : 'Related'
  return 'Related'
}

/** Runs whose steps read this entity (its "Used by" runs). */
function useRunsThatSaw(ref: EntityRef): ID[] {
  const key = useDB((s) => {
    const ids: ID[] = []
    for (const r of Object.values(s.runs)) {
      if (r.steps.some((st) => st.refs?.some((x) => x.kind === ref.kind && x.id === ref.id))) ids.push(r.id)
    }
    return ids.sort().join(',')
  })
  return key ? key.split(',') : []
}

function Links({ entity: ref }: { entity: EntityRef }) {
  const connections = useConnections(ref)
  const sawIds = useRunsThatSaw(ref)
  const origin = useDB((s) => (ref.kind === 'run' ? s.runs[ref.id]?.origin : ref.kind === 'task' ? s.tasks[ref.id]?.origin : undefined))
  const groups = useMemo(() => {
    const map = new Map<LinkGroup, EntityRef[]>()
    const seen = new Set<string>()
    const add = (g: LinkGroup, r: EntityRef) => {
      const k = `${g}|${r.kind}:${r.id}`
      if (seen.has(k) || (r.kind === ref.kind && r.id === ref.id)) return
      seen.add(k)
      map.set(g, [...(map.get(g) ?? []), r])
    }
    if (origin) add('Came from', origin)
    for (const c of connections) add(groupOf(c), c.other)
    for (const id of sawIds) add('Used by', { kind: 'run', id })
    const order: LinkGroup[] = ['Came from', 'Led to', 'Used by', 'Cited by', 'Related']
    return order.filter((g) => map.has(g)).map((g) => ({ group: g, refs: map.get(g)! }))
  }, [connections, sawIds, origin, ref])

  return (
    <section aria-label="Links" className="border-b border-line px-4 py-3.5">
      <h3 className="type-label pb-2.5 text-ink-3">Links</h3>
      {groups.length === 0 ? (
        <p className="type-caption text-ink-3">No links yet. Work started from this item, and items it came from, appear here.</p>
      ) : (
        <dl className="flex flex-col gap-2.5">
          {groups.map(({ group, refs }) => (
            <div key={group} className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
              <dt className="type-caption pt-0.5 text-ink-3">{group}</dt>
              <dd className="flex min-w-0 flex-wrap gap-1.5">
                {refs.slice(0, 12).map((r) => (
                  <EntityChip key={`${r.kind}:${r.id}`} entity={r} size="sm" />
                ))}
                {refs.length > 12 && <span className="type-meta self-center text-ink-3">+{refs.length - 12}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ history

function History({ entity: ref }: { entity: EntityRef }) {
  const events = useActivityFor(ref, 20)
  return (
    <section aria-label="History" className="px-4 py-3.5">
      <h3 className="type-label pb-2.5 text-ink-3">History</h3>
      {events.length === 0 ? (
        <p className="type-caption text-ink-3">No recorded activity yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-2.5 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line">
          {events.map((e) => (
            <HistoryRow key={e.id} event={e} />
          ))}
        </ol>
      )}
    </section>
  )
}

function HistoryRow({ event }: { event: ActivityEvent }) {
  const who = actorName(event.actor)
  return (
    <li className="relative flex gap-3 pl-4">
      <span aria-hidden className={cn('absolute top-1.5 left-0 size-[7px] rounded-full border bg-canvas', event.actor.type === 'agent' ? 'border-ink-3' : 'border-line-input')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-sm text-pretty text-ink-2">{event.summary}</span>
        <span className="type-meta text-ink-3">
          {who} · {timeAgo(event.at)}
        </span>
      </div>
    </li>
  )
}
