import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { actorName, useProjectActivity } from '@/core/services'
import type { ActivityEvent, EntityKind, Project } from '@/core/types'
import { ActivityFeed, Button, Select, type ActivityItem } from '@/ui'
import { ActorMark } from './parts'

/**
 * Activity (§6.9): the project's feed grouped by day, filtered by actor (anyone, you, an agent) and by
 * kind of thing touched. Every row is a sentence from the audit log.
 */

type KindFilter = 'all' | 'tasks' | 'runs' | 'conversations' | 'research' | 'code' | 'knowledge' | 'studio' | 'workflows' | 'project'

const KIND_GROUP: Record<EntityKind, KindFilter> = {
  task: 'tasks',
  run: 'runs',
  approval: 'runs',
  agent: 'runs',
  thread: 'conversations',
  message: 'conversations',
  investigation: 'research',
  source: 'research',
  session: 'code',
  repo: 'code',
  knowledge: 'knowledge',
  collection: 'knowledge',
  asset: 'studio',
  board: 'studio',
  workflow: 'workflows',
  project: 'project',
  integration: 'workflows',
}

const KIND_LABEL: Record<KindFilter, string> = {
  all: 'Everything',
  tasks: 'Tasks',
  runs: 'Runs and approvals',
  conversations: 'Conversations',
  research: 'Research',
  code: 'Code',
  knowledge: 'Knowledge',
  studio: 'Studio',
  workflows: 'Workflows',
  project: 'The project itself',
}

const PAGE = 60

export default function ProjectActivity({ project }: { project: Project }) {
  const events = useProjectActivity(project.id, 2000)
  const [actor, setActor] = useState<string>('any')
  const [kind, setKind] = useState<KindFilter>('all')
  const [limit, setLimit] = useState(PAGE)
  const agents = useDB(useShallow((s: Tables) => Object.values(s.agents).map((a) => `${a.id}|${a.name}`)))

  const actors = useMemo(() => {
    const present = new Set(events.filter((e) => e.actor.type === 'agent').map((e) => e.actor.id))
    return agents
      .map((k) => k.split('|') as [string, string])
      .filter(([id]) => present.has(id))
      .sort((a, b) => a[1].localeCompare(b[1]))
  }, [events, agents])
  const kinds = useMemo(() => {
    const present = new Set(events.map((e) => KIND_GROUP[e.target.kind]))
    return (Object.keys(KIND_LABEL) as KindFilter[]).filter((k) => k === 'all' || present.has(k))
  }, [events])

  const filtered = useMemo(
    () =>
      events.filter((e) => {
        if (actor === 'me' && e.actor.type !== 'user') return false
        if (actor === 'system' && e.actor.type !== 'system' && e.actor.type !== 'workflow') return false
        if (actor !== 'any' && actor !== 'me' && actor !== 'system' && !(e.actor.type === 'agent' && e.actor.id === actor)) return false
        if (kind !== 'all' && KIND_GROUP[e.target.kind] !== kind) return false
        return true
      }),
    [events, actor, kind],
  )
  const items = useMemo<ActivityItem[]>(() => filtered.slice(0, limit).map(toItem), [filtered, limit])
  const narrowed = actor !== 'any' || kind !== 'all'

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter activity">
        <Select
          size="sm"
          aria-label="Who"
          value={actor}
          onValueChange={(v) => {
            setActor(v)
            setLimit(PAGE)
          }}
          options={[
            { value: 'any', label: 'Anyone' },
            { value: 'me', label: 'You' },
            ...actors.map(([id, name]) => ({ value: id, label: name, group: 'Agents' })),
            { value: 'system', label: 'Workflows and Atrium' },
          ]}
          className="w-44"
        />
        <Select
          size="sm"
          aria-label="What"
          value={kind}
          onValueChange={(v) => {
            setKind(v)
            setLimit(PAGE)
          }}
          options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          className="w-48"
        />
        {narrowed && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setActor('any')
              setKind('all')
            }}
          >
            Clear
          </Button>
        )}
        <span className="flex-1" />
        <span className="type-meta text-ink-3 tabular">{filtered.length} events</span>
      </div>
      <ActivityFeed items={items} empty={narrowed ? 'Nothing matches these filters.' : 'No activity in this project yet.'} />
      {filtered.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)} className="self-start">
          Show {Math.min(PAGE, filtered.length - limit)} more
        </Button>
      )}
    </div>
  )
}

/** The feed shows the audit sentence itself; who did it goes underneath, with their mark. */
function toItem(e: ActivityEvent): ActivityItem {
  return {
    id: e.id,
    at: e.at,
    actor: { label: '', mark: <ActorMark actor={e.actor.type === 'user' || e.actor.type === 'agent' ? e.actor : null} size={20} /> },
    summary: e.summary,
    detail: e.actor.type === 'user' ? 'You' : actorName(e.actor),
  }
}
