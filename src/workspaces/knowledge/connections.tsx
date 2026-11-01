import { memo, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight } from 'lucide-react'
import { attachRun } from '@/app/shell/store'
import { useDB, useRow, type Tables } from '@/core/db'
import { entityRoute, plainText, RUN_KIND_LABEL, TASK_STATUS_LABEL, usageOf } from '@/core/services'
import { refKey, type EntityRef, type ID } from '@/core/types'
import { EntityChip, RunStatusGlyph, SimBadge, TaskGlyph } from '@/ui'
import { cn } from '@/lib/cn'
import { timeAgo, truncate } from '@/lib/format'

/**
 * Where a knowledge item comes from and where it is used (§2.5 "every knowledge item shows which runs
 * used it", §7.1 "Runs remember"): the link graph, citations, run Saw lists, research sources and tasks.
 */

export interface CitedBy {
  ref: EntityRef
  at: number
}

export interface KnowledgeConnections {
  cameFrom: EntityRef[]
  /** Runs whose steps read the item, newest first. */
  usedBy: ID[]
  citedBy: CitedBy[]
  /** Investigations that used it as a source. */
  sourced: ID[]
  /** Tasks made from it or pointing at it. */
  tasks: ID[]
  /** Other things made from it (copies, sessions, assets…). */
  ledTo: EntityRef[]
  /** Knowledge it references or is related to. */
  related: EntityRef[]
}

const isKnowledge = (r: EntityRef, id: ID) => r.kind === 'knowledge' && r.id === id

function uniq(refs: EntityRef[]): EntityRef[] {
  const seen = new Set<string>()
  return refs.filter((r) => {
    const k = refKey(r)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Pure: every connection of one item, from a database snapshot. */
export function connectionsIn(s: Tables, id: ID): KnowledgeConnections {
  const item = s.knowledge[id]
  const cameFrom: EntityRef[] = []
  const citedBy: CitedBy[] = []
  const tasks = new Set<ID>()
  const ledTo: EntityRef[] = []
  const related: EntityRef[] = []
  if (item?.source.ref) cameFrom.push(item.source.ref)
  for (const inv of Object.values(s.investigations)) if (inv.knowledgeId === id) cameFrom.push({ kind: 'investigation', id: inv.id })

  for (const l of Object.values(s.links)) {
    const out = isKnowledge(l.from, id)
    const inc = isKnowledge(l.to, id)
    if (!out && !inc) continue
    const other = out ? l.to : l.from
    if (isKnowledge(other, id)) continue
    switch (l.rel) {
      case 'derived_from':
        if (out) cameFrom.push(other)
        else if (other.kind === 'task') tasks.add(other.id)
        else ledTo.push(other)
        break
      case 'produced':
        if (inc) cameFrom.push(other)
        else ledTo.push(other)
        break
      case 'cites':
        if (inc) citedBy.push({ ref: other, at: l.createdAt })
        else related.push(other)
        break
      case 'references':
        if (inc && other.kind === 'task') tasks.add(other.id)
        else related.push(other)
        break
      default:
        if (other.kind === 'task') tasks.add(other.id)
        else related.push(other)
    }
  }
  for (const t of Object.values(s.tasks)) if (t.origin && isKnowledge(t.origin, id)) tasks.add(t.id)

  const sourced = new Set<ID>()
  for (const src of Object.values(s.sources)) {
    if (src.knowledgeId === id && src.investigationId && !cameFrom.some((r) => r.kind === 'investigation' && r.id === src.investigationId)) sourced.add(src.investigationId)
  }
  // Investigations whose runs read it count as sourced too (Research › Sources may not list knowledge).
  const usedBy = usageOf(s.runs, id).runIds
  for (const runId of usedBy) {
    const run = s.runs[runId]
    if (run?.kind !== 'research') continue
    const inv = Object.values(s.investigations).find((i) => i.runIds.includes(runId))
    if (inv && !cameFrom.some((r) => r.kind === 'investigation' && r.id === inv.id)) sourced.add(inv.id)
  }

  return {
    cameFrom: uniq(cameFrom).filter((r) => !(r.kind === 'knowledge' && r.id === id)),
    usedBy,
    citedBy: citedBy.sort((a, b) => b.at - a.at),
    sourced: [...sourced].sort((a, b) => (s.investigations[b]?.updatedAt ?? 0) - (s.investigations[a]?.updatedAt ?? 0)),
    tasks: [...tasks].filter((t) => s.tasks[t]).sort((a, b) => (s.tasks[b]?.updatedAt ?? 0) - (s.tasks[a]?.updatedAt ?? 0)),
    ledTo: uniq(ledTo),
    related: uniq(related),
  }
}

/** Live connections of an item (re-renders only when the computed lists change). */
export function useKnowledgeConnections(id: ID): KnowledgeConnections {
  const tables = useDB(
    useShallow((s: Tables) => ({
      knowledge: s.knowledge,
      links: s.links,
      runs: s.runs,
      tasks: s.tasks,
      sources: s.sources,
      investigations: s.investigations,
    })),
  )
  const key = useMemo(() => JSON.stringify(connectionsIn(useDB.getState(), id)), [tables, id]) // eslint-disable-line react-hooks/exhaustive-deps
  return useMemo(() => JSON.parse(key) as KnowledgeConnections, [key])
}

export function connectionCount(c: KnowledgeConnections): number {
  return c.cameFrom.length + c.usedBy.length + c.citedBy.length + c.sourced.length + c.tasks.length + c.ledTo.length + c.related.length
}

// ------------------------------------------------------------------------------------------------ view

function Group({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[112px_minmax(0,1fr)]">
      <h4 className="type-caption flex items-baseline gap-1.5 pt-1.5 text-ink-3">
        {label}
        <span className="type-meta tabular">{count}</span>
      </h4>
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  )
}

const ROW = 'group/conn flex min-h-9 w-full min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:min-h-11'

const RunConnection = memo(function RunConnection({ id }: { id: ID }) {
  const run = useRow('runs', id)
  const agent = useDB((s: Tables) => (run?.agentId ? s.agents[run.agentId]?.name : undefined))
  if (!run) return null
  return (
    <button type="button" onClick={() => attachRun(run.id, 'knowledge')} className={ROW} aria-label={`${run.title}: ${RUN_KIND_LABEL[run.kind]} run. Attach to the Inspector`}>
      <RunStatusGlyph status={run.status} />
      <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2 group-hover/conn:text-ink">{run.title}</span>
      {run.simulated && <SimBadge noTooltip />}
      <span className="type-meta shrink-0 text-ink-3">
        {RUN_KIND_LABEL[run.kind]}
        {agent ? ` · ${agent}` : ''} · {timeAgo(run.startedAt ?? run.createdAt)}
      </span>
    </button>
  )
})

const CitedConnection = memo(function CitedConnection({ cite }: { cite: CitedBy }) {
  const navigate = useNavigate()
  const info = useDB(
    useShallow((s: Tables) => {
      if (cite.ref.kind === 'message') {
        const m = s.messages[cite.ref.id]
        const thread = m ? s.threads[m.threadId] : undefined
        return { title: thread?.title ?? 'Conversation', excerpt: m ? truncate(plainText(m.content).replace(/\s+/g, ' '), 140) : '', simulated: !!m?.simulated, exists: !!m }
      }
      const k = cite.ref.kind === 'knowledge' ? s.knowledge[cite.ref.id] : undefined
      return { title: k?.title ?? 'Deleted item', excerpt: '', simulated: !!k?.simulated, exists: !!k }
    }),
  )
  if (!info.exists) return null
  return (
    <button type="button" onClick={() => navigate(entityRoute(cite.ref))} className={cn(ROW, 'items-start')}>
      <span aria-hidden className="mt-1 grid size-3 shrink-0 place-items-center text-[11px] leading-none text-ink-3">
        “
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-sm truncate text-ink-2 group-hover/conn:text-ink">{info.title}</span>
        {info.excerpt && <span className="type-caption line-clamp-2 text-ink-3">{info.excerpt}</span>}
      </span>
      {info.simulated && <SimBadge noTooltip />}
      <span className="type-meta shrink-0 pt-0.5 text-ink-3">{timeAgo(cite.at)}</span>
    </button>
  )
})

const InvestigationConnection = memo(function InvestigationConnection({ id }: { id: ID }) {
  const navigate = useNavigate()
  const inv = useRow('investigations', id)
  if (!inv) return null
  return (
    <button type="button" onClick={() => navigate(entityRoute({ kind: 'investigation', id }))} className={ROW}>
      <ArrowUpRight aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
      <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2 group-hover/conn:text-ink">{inv.title}</span>
      <span className="type-meta shrink-0 text-ink-3">
        {inv.status === 'complete' ? 'Report' : inv.status.charAt(0).toUpperCase() + inv.status.slice(1)} · {timeAgo(inv.updatedAt)}
      </span>
    </button>
  )
})

const TaskConnection = memo(function TaskConnection({ id }: { id: ID }) {
  const navigate = useNavigate()
  const task = useRow('tasks', id)
  const live = useDB((s: Tables) => !!task && task.runIds.some((r) => s.runs[r]?.status === 'running'))
  if (!task) return null
  return (
    <button type="button" onClick={() => navigate(entityRoute({ kind: 'task', id }))} className={ROW}>
      <TaskGlyph status={task.status} live={live} />
      <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2 group-hover/conn:text-ink">{task.title}</span>
      <span className="type-meta shrink-0 text-ink-3">{TASK_STATUS_LABEL[task.status]}</span>
    </button>
  )
})

function Chips({ refs }: { refs: EntityRef[] }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {refs.slice(0, 16).map((r) => (
        <EntityChip key={refKey(r)} entity={r} size="sm" showKind />
      ))}
      {refs.length > 16 && <span className="type-meta self-center text-ink-3">+{refs.length - 16}</span>}
    </div>
  )
}

const USED_VISIBLE = 6

/** The Connections section of the reader: Came from · Used by · Cited by · Research · Tasks · Led to · Related. */
export function ConnectionsSection({ id }: { id: ID }) {
  const c = useKnowledgeConnections(id)
  const total = connectionCount(c)
  return (
    <section aria-labelledby="kn-connections" className="flex flex-col gap-3">
      <h3 id="kn-connections" className="type-label flex items-center gap-2 text-ink-3">
        Connections
        {total > 0 && <span className="type-meta font-normal tracking-normal normal-case tabular">{total}</span>}
      </h3>
      {total === 0 ? (
        <p className="type-body-sm text-pretty text-ink-3">
          Nothing uses this yet. Runs that read it, conversations that cite it and work made from it show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {c.cameFrom.length > 0 && (
            <Group label="Came from" count={c.cameFrom.length}>
              <Chips refs={c.cameFrom} />
            </Group>
          )}
          {c.usedBy.length > 0 && (
            <Group label="Used by" count={c.usedBy.length}>
              {c.usedBy.slice(0, USED_VISIBLE).map((runId) => (
                <RunConnection key={runId} id={runId} />
              ))}
              {c.usedBy.length > USED_VISIBLE && <p className="type-meta px-2 pt-1 text-ink-3">+{c.usedBy.length - USED_VISIBLE} older runs</p>}
            </Group>
          )}
          {c.citedBy.length > 0 && (
            <Group label="Cited by" count={c.citedBy.length}>
              {c.citedBy.slice(0, USED_VISIBLE).map((cite) => (
                <CitedConnection key={refKey(cite.ref)} cite={cite} />
              ))}
            </Group>
          )}
          {c.sourced.length > 0 && (
            <Group label="Research" count={c.sourced.length}>
              {c.sourced.map((invId) => (
                <InvestigationConnection key={invId} id={invId} />
              ))}
            </Group>
          )}
          {c.tasks.length > 0 && (
            <Group label="Tasks" count={c.tasks.length}>
              {c.tasks.map((taskId) => (
                <TaskConnection key={taskId} id={taskId} />
              ))}
            </Group>
          )}
          {c.ledTo.length > 0 && (
            <Group label="Led to" count={c.ledTo.length}>
              <Chips refs={c.ledTo} />
            </Group>
          )}
          {c.related.length > 0 && (
            <Group label="Related" count={c.related.length}>
              <Chips refs={c.related} />
            </Group>
          )}
        </div>
      )}
    </section>
  )
}
