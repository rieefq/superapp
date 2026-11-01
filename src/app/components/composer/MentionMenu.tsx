import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePinned } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { useSearch } from '@/core/search'
import { resolveIn, type ResolvedEntity } from '@/core/services'
import { isRunActive, refKey, type EntityRef, type ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { AgentMark, DynamicIcon, SimBadge } from '@/ui'
import type { SlashCommand } from '@/app/types'

/**
 * The composer's `@` menu (§5.4.10): Held, project memory, Knowledge (real local search), files,
 * runs, agents, tasks — in that order. Picking adds an Attached chip to the Context Line.
 */

export type MentionGroup = 'Held' | 'Project memory' | 'Knowledge' | 'Files' | 'Runs' | 'Agents' | 'Tasks'
const GROUP_ORDER: MentionGroup[] = ['Held', 'Project memory', 'Knowledge', 'Files', 'Runs', 'Agents', 'Tasks']

export interface MentionOption {
  key: string
  group: MentionGroup
  ref: EntityRef
  entity: ResolvedEntity
  /** For agents: the text inserted into the draft ("@Scout "). */
  insert?: string
  agent?: { sigil: number; hue: string }
}

const PER_GROUP_EMPTY = 4
const PER_GROUP_QUERY = 5

function titleMatch(title: string, q: string): boolean {
  if (!q) return true
  const t = title.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => t.includes(w))
}

/** Options for the `@` menu, grouped and ordered. `enabled` false skips work while the menu is closed. */
export function useMentionOptions(query: string, projectId: ID | null, enabled: boolean): MentionOption[] {
  const q = enabled ? query.trim() : ''
  const pinned = usePinned()
  const { results } = useSearch(enabled ? q : '', { kinds: ['knowledge', 'task'], limit: 30 })
  // Subscribe to the tables the menu reads only while it is open (runs change often while streaming).
  const tables = useDB(
    useShallow((s: Tables) =>
      enabled ? { knowledge: s.knowledge, runs: s.runs, agents: s.agents, tasks: s.tasks, projects: s.projects } : CLOSED,
    ),
  )

  return useMemo(() => {
    if (!enabled || tables === CLOSED) return [] as MentionOption[]
    const s = useDB.getState()
    const seen = new Set<string>()
    const out: MentionOption[] = []
    const push = (group: MentionGroup, ref: EntityRef, extra: Partial<MentionOption> = {}) => {
      const key = refKey(ref)
      if (seen.has(key)) return false
      const entity = resolveIn(s, ref)
      if (!entity.exists) return false
      seen.add(key)
      out.push({ key: `${group}:${key}`, group, ref, entity, ...extra })
      return true
    }
    const limit = q ? PER_GROUP_QUERY : PER_GROUP_EMPTY
    /** Add up to `max` refs; `filterTitle` matches the query locally (search results are already matched). */
    const take = (group: MentionGroup, refs: EntityRef[], max = limit, filterTitle = true) => {
      let n = 0
      for (const r of refs) {
        if (n >= max) break
        if (filterTitle && !titleMatch(resolveIn(s, r).title, q)) continue
        if (push(group, r)) n++
      }
    }

    take('Held', pinned.map((p) => p.ref))
    const memory = projectId ? (s.projects[projectId]?.pinnedRefs ?? []) : []
    take('Project memory', memory)

    // Knowledge & files: indexed search when typing; most recent (in scope first) otherwise.
    const knowledgeRefs: EntityRef[] = []
    const fileRefs: EntityRef[] = []
    if (q) {
      for (const r of results) {
        if (r.kind !== 'knowledge') continue
        const item = s.knowledge[r.ref.id]
        if (!item || item.aiAvailability === 'never') continue
        ;(item.file ? fileRefs : knowledgeRefs).push(r.ref)
      }
    } else {
      const inProject = (k: { projectIds: ID[] }) => Number(!!projectId && k.projectIds.includes(projectId))
      const items = Object.values(s.knowledge)
        .filter((k) => k.aiAvailability !== 'never')
        .sort((a, b) => inProject(b) - inProject(a) || b.updatedAt - a.updatedAt)
      for (const k of items) (k.file ? fileRefs : knowledgeRefs).push({ kind: 'knowledge', id: k.id })
    }
    take('Knowledge', knowledgeRefs, limit, false)
    take('Files', fileRefs, q ? PER_GROUP_QUERY : 3, false)

    // Runs are not in the search index: newest first, active ones before finished.
    const runs = Object.values(s.runs)
      .filter((r) => r.kind !== 'chat' && titleMatch(r.title, q))
      .sort((a, b) => Number(isRunActive(b.status)) - Number(isRunActive(a.status)) || b.createdAt - a.createdAt)
      .slice(0, q ? PER_GROUP_QUERY : 3)
    take('Runs', runs.map((r) => ({ kind: 'run' as const, id: r.id })), limit, false)

    // Agents: mentioning one also writes "@Name " into the draft (Chat routes "@Scout …" to an assignment).
    const agents = Object.values(s.agents)
      .filter((a) => a.status !== 'archived' && titleMatch(a.name, q))
      .sort((a, b) => a.name.localeCompare(b.name))
    let n = 0
    for (const a of agents) {
      if (n >= (q ? PER_GROUP_QUERY : 7)) break
      if (push('Agents', { kind: 'agent', id: a.id }, { insert: `@${a.name} `, agent: { sigil: a.sigil, hue: a.hue } })) n++
    }

    const taskRefs: EntityRef[] = q
      ? results.filter((r) => r.kind === 'task').map((r) => r.ref)
      : Object.values(s.tasks)
          .filter((t) => t.status !== 'done' && t.status !== 'cancelled' && (!projectId || t.projectId === projectId))
          .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || b.updatedAt - a.updatedAt)
          .map((t) => ({ kind: 'task' as const, id: t.id }))
    take('Tasks', taskRefs, limit, false)

    return out.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
  }, [enabled, tables, q, pinned, projectId, results])
}

const CLOSED = Object.freeze({}) as Record<string, never>

// ------------------------------------------------------------------------------------------------ lists

export function MentionList({ id, options, active, onPick, onHover }: {
  id: string
  options: MentionOption[]
  active: number
  onPick: (o: MentionOption) => void
  onHover: (i: number) => void
}) {
  let last: MentionGroup | null = null
  if (!options.length) return <div className="px-3 py-5 text-center text-sm text-ink-3">Nothing matches. Keep typing, or Esc to close.</div>
  return (
    <div id={id} role="listbox" aria-label="Add context" className="flex flex-col p-1">
      {options.map((o, i) => {
        const heading = o.group !== last ? o.group : null
        last = o.group
        return (
          <div key={o.key} role="presentation">
            {heading && <div className="type-label px-2 pt-2.5 pb-1 text-ink-3 first:pt-1.5">{heading}</div>}
            <div
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              data-active={i === active ? '' : undefined}
              onPointerMove={() => i !== active && onHover(i)}
              onPointerDown={(e) => e.preventDefault() /* keep focus in the textarea */}
              onClick={() => onPick(o)}
              className="flex min-h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1 select-none data-active:bg-ink/8 pointer-coarse:min-h-11"
            >
              <span aria-hidden className="grid size-4 shrink-0 place-items-center">
                {o.agent ? (
                  <AgentMark seed={o.agent.sigil} hue={o.agent.hue as never} size={16} />
                ) : (
                  <DynamicIcon name={o.entity.icon} className="size-4 text-ink-3" strokeWidth={1.75} />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{o.entity.title}</span>
              {o.entity.simulated && <SimBadge size="xs" label="SIM" />}
              {o.entity.subtitle && <span className="hidden max-w-[45%] truncate text-xs text-ink-3 sm:block">{o.entity.subtitle}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function SlashList({ id, commands, active, onPick, onHover }: {
  id: string
  commands: SlashCommand[]
  active: number
  onPick: (c: SlashCommand) => void
  onHover: (i: number) => void
}) {
  if (!commands.length) return <div className="px-3 py-5 text-center text-sm text-ink-3">No command matches.</div>
  return (
    <div id={id} role="listbox" aria-label="Commands" className="flex flex-col p-1">
      <div className="type-label px-2 pt-1.5 pb-1 text-ink-3">Commands</div>
      {commands.map((c, i) => {
        const Icon = c.icon
        return (
          <div
            key={c.name}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === active}
            data-active={i === active ? '' : undefined}
            onPointerMove={() => i !== active && onHover(i)}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => onPick(c)}
            className={cn('flex min-h-8 cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1 select-none data-active:bg-ink/8 pointer-coarse:min-h-11')}
          >
            <span aria-hidden className="grid size-4 shrink-0 place-items-center text-ink-3">
              {Icon ? <Icon className="size-4" strokeWidth={1.75} /> : <span className="font-mono text-xs">/</span>}
            </span>
            <span className="shrink-0 font-mono text-[13px] text-ink">
              /{c.name}
              {c.args && <span className="text-ink-3"> {c.args}</span>}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{c.description}</span>
          </div>
        )
      })}
    </div>
  )
}
