import { memo, useEffect, useMemo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { switchScope } from '@/app/shell/scope'
import { openStartSheet } from '@/app/shell/store'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { KIND_META, useEntity, useProjectItems } from '@/core/services'
import { refKey, type EntityKind, type EntityRef, type Project } from '@/core/types'
import { timeAgo } from '@/lib/format'
import { EntityChip, EntityMark, entityStatusWord, SimBadge } from '@/ui'
import { deliverablesIn } from './logic'
import { QuietLine, SectionAction, SectionLabel } from './parts'

/**
 * Work (§6.9): Deliverables first — reports, pull requests (simulated), assets and documents, each
 * with its provenance chain — then Conversations · Coding sessions · Investigations · Workflows ·
 * Knowledge. Every item opens in its own workspace.
 */
export default function Work({ project }: { project: Project }) {
  const items = useProjectItems(project.id)
  const location = useLocation()

  // `#conversations` etc. (from Overview › Linked work) scrolls to the section.
  useEffect(() => {
    const id = location.hash.slice(1)
    if (!id) return
    requestAnimationFrame(() => document.getElementById(`work-${id}`)?.scrollIntoView({ block: 'start' }))
  }, [location.hash])

  return (
    <div className="flex flex-col gap-10">
      <Deliverables project={project} />
      <Section id="conversations" title="Conversations" kind="thread" refs={items.threads.map((t) => ({ kind: 'thread' as const, id: t.id }))} project={project} empty="No conversations in this project yet." start={{ label: 'New conversation', to: '/chat' }} />
      <Section id="sessions" title="Coding sessions" kind="session" refs={items.sessions.map((t) => ({ kind: 'session' as const, id: t.id }))} project={project} empty="No coding sessions yet." start={{ label: 'New coding session', sheet: 'session' }} />
      <Section id="investigations" title="Investigations" kind="investigation" refs={items.investigations.map((t) => ({ kind: 'investigation' as const, id: t.id }))} project={project} empty="No research yet." start={{ label: 'Start research', sheet: 'research' }} />
      <Section id="workflows" title="Workflows" kind="workflow" refs={items.workflows.map((t) => ({ kind: 'workflow' as const, id: t.id }))} project={project} empty="No workflows in this project." start={{ label: 'New workflow', to: '/workflows/new' }} />
      <Section id="assets" title="Assets" kind="asset" refs={items.assets.map((t) => ({ kind: 'asset' as const, id: t.id }))} project={project} empty="No Studio assets yet." start={{ label: 'Create in Studio', sheet: 'studio' }} />
      <Section id="knowledge" title="Knowledge" kind="knowledge" refs={items.knowledge.map((t) => ({ kind: 'knowledge' as const, id: t.id }))} project={project} empty="Nothing in Knowledge is filed here yet." start={{ label: 'New note', sheet: 'note' }} />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ deliverables

function Deliverables({ project }: { project: Project }) {
  const keys = useDB(
    useShallow((s: Tables) =>
      deliverablesIn(s, project.id)
        .slice(0, 24)
        .map((d) => [refKey(d.ref), d.kind, d.chain.map(refKey).join(','), d.updatedAt, d.simulated ? 1 : 0].join('|')),
    ),
  )
  const rows = useMemo(
    () =>
      keys.map((k) => {
        const [ref, kind, chain, at, sim] = k.split('|')
        return { ref: parse(ref), kind, chain: chain ? chain.split(',').map(parse) : [], updatedAt: Number(at), simulated: sim === '1' }
      }),
    [keys],
  )
  return (
    <section aria-labelledby="work-deliverables">
      <SectionLabel id="work-deliverables" title="Deliverables" count={rows.length} />
      {rows.length === 0 ? (
        <QuietLine>Reports, pull requests, assets and documents made in this project appear here with where they came from.</QuietLine>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {rows.map((d) => (
            <DeliverableRow key={refKey(d.ref)} item={d} />
          ))}
        </ul>
      )}
    </section>
  )
}

const DeliverableRow = memo(function DeliverableRow({ item }: { item: { ref: EntityRef; kind: string; chain: EntityRef[]; updatedAt: number; simulated: boolean } }) {
  const navigate = useNavigate()
  const e = useEntity(item.ref)
  return (
    <li className="relative flex min-w-0 flex-col gap-2 px-4 py-3">
      {item.simulated && <span aria-hidden className="sim-band absolute inset-y-0 left-0" />}
      <div className="flex min-w-0 items-center gap-2.5">
        <EntityMark entity={item.ref} resolved={e} size={20} />
        <button type="button" onClick={() => navigate(e.route)} className="type-body-sm min-w-0 truncate text-left font-medium text-ink hover:underline hover:decoration-line-input hover:underline-offset-2">
          {e.title}
        </button>
        <span className="type-caption shrink-0 text-ink-3">{item.kind}</span>
        {item.simulated && <SimBadge size="xs" />}
        <span className="flex-1" />
        <span className="type-meta shrink-0 text-ink-3">{timeAgo(item.updatedAt)}</span>
      </div>
      {item.chain.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pl-[30px]" aria-label="Provenance">
          {item.chain.map((r, i) => (
            <span key={refKey(r)} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ArrowRight aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />}
              <EntityChip entity={r} size="sm" />
            </span>
          ))}
          <ArrowRight aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />
          <span className="type-caption text-ink-2">{item.kind}</span>
        </div>
      )}
    </li>
  )
})

// ------------------------------------------------------------------------------------------------ sections

const parse = (key: string): EntityRef => {
  const at = key.indexOf(':')
  return { kind: key.slice(0, at) as EntityKind, id: key.slice(at + 1) }
}

const SHOWN = 8

function Section({
  id,
  title,
  kind,
  refs,
  project,
  empty,
  start,
}: {
  id: string
  title: string
  kind: EntityKind
  refs: EntityRef[]
  project: Project
  empty: string
  start: { label: string; to?: string; sheet?: 'session' | 'research' | 'studio' | 'note' }
}) {
  const navigate = useNavigate()
  const scope = useScope()
  const workspace = KIND_META[kind].workspace
  // Opening the workspace in this project's scope shows exactly this list there.
  const openAll = () => {
    if (scope !== project.id) switchScope(project.id)
    navigate(`/${workspace}`)
  }
  const begin = () => {
    if (start.sheet) openStartSheet(start.sheet, { prefill: { projectId: project.id } })
    else if (start.to) navigate(start.to)
  }
  return (
    <section aria-labelledby={`work-${id}-title`} id={`work-${id}`} className="scroll-mt-4">
      <SectionLabel
        id={`work-${id}-title`}
        title={title}
        count={refs.length}
        action={
          refs.length > SHOWN ? (
            <SectionAction onClick={openAll}>
              All {refs.length} <ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.75} />
            </SectionAction>
          ) : undefined
        }
      />
      {refs.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-2">
          <QuietLine>{empty}</QuietLine>
          <SectionAction onClick={begin}>{start.label}</SectionAction>
        </div>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {refs.slice(0, SHOWN).map((r) => (
            <WorkRow key={refKey(r)} entity={r} projectName={project.name} />
          ))}
        </ul>
      )}
    </section>
  )
}

const WorkRow = memo(function WorkRow({ entity, projectName }: { entity: EntityRef; projectName: string }) {
  const navigate = useNavigate()
  const e = useEntity(entity)
  const status = statusWord(entity.kind, e.status)
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(e.route)}
        className="group/work flex h-10 w-full min-w-0 items-center gap-2.5 rounded-sm px-2 text-left transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11"
      >
        <EntityMark entity={entity} resolved={e} size={16} />
        <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2 group-hover/work:text-ink">{e.title}</span>
        {e.subtitle && e.subtitle !== projectName && <span className="type-caption hidden max-w-[40%] truncate text-ink-3 sm:block">{e.subtitle}</span>}
        {e.simulated && <SimBadge size="xs" noTooltip />}
        {status && <span className="type-meta hidden shrink-0 text-ink-3 md:inline">{status}</span>}
        {e.updatedAt && <span className="type-meta w-16 shrink-0 text-right text-ink-3">{timeAgo(e.updatedAt).replace(' ago', '')}</span>}
      </button>
    </li>
  )
})

function statusWord(kind: EntityKind, status?: string): ReactNode {
  if (!status) return null
  if (kind === 'workflow') return status === 'enabled' ? 'On' : 'Off'
  return entityStatusWord(kind, status)
}
