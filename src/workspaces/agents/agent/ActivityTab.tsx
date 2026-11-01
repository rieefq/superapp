import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { actorName } from '@/core/services'
import type { ActivityEvent, Agent } from '@/core/types'
import { ActivityFeed, AgentMark, Avatar, EntityChip, Tabs, type ActivityItem } from '@/ui'
import { useSettings } from '@/core/settings'

type Filter = 'all' | 'config' | 'runs' | 'approvals'

/**
 * Activity (audit log): everything that happened to and by this agent — configuration changes, its
 * runs starting and ending, approvals it asked for and how you answered, what it wrote.
 */
export default function ActivityTab({ agent }: { agent: Agent }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(60)
  const profile = useSettings((s) => s.profile)
  const events = useDB(
    useShallow((s: Tables) => {
      const runIds = new Set(Object.values(s.runs).filter((r) => r.agentId === agent.id).map((r) => r.id))
      const out: ActivityEvent[] = []
      for (const e of Object.values(s.activity)) {
        const byAgent = e.actor.type === 'agent' && e.actor.id === agent.id
        const onAgent = e.target.kind === 'agent' && e.target.id === agent.id
        const onRun = e.target.kind === 'run' && runIds.has(e.target.id)
        const onApproval = e.target.kind === 'approval' && typeof e.meta?.runId === 'string' && runIds.has(e.meta.runId)
        if (!(byAgent || onAgent || onRun || onApproval)) continue
        if (filter === 'config' && !onAgent) continue
        if (filter === 'runs' && !onRun) continue
        if (filter === 'approvals' && !onApproval) continue
        out.push(e)
      }
      return out.sort((a, b) => b.at - a.at)
    }),
  )
  const items: ActivityItem[] = useMemo(
    () =>
      events.slice(0, limit).map((e) => ({
        id: e.id,
        at: e.at,
        actor: {
          label: actorName(e.actor),
          mark:
            e.actor.type === 'agent' && e.actor.id === agent.id ? (
              <AgentMark seed={agent.sigil} hue={agent.hue} size={20} />
            ) : e.actor.type === 'user' ? (
              <Avatar name={profile.name} hue={profile.hue} size="sm" />
            ) : undefined,
        },
        summary: e.summary,
        target: e.target.kind === 'agent' ? undefined : <EntityChip entity={e.target} size="sm" />,
      })),
    [events, limit, agent.id, agent.sigil, agent.hue, profile.name, profile.hue],
  )
  return (
    <section aria-label={`${agent.name} activity`} className="flex flex-col gap-4">
      <Tabs
        variant="pill"
        size="sm"
        aria-label="Show"
        value={filter}
        onValueChange={(v) => setFilter(v as Filter)}
        items={[
          { value: 'all', label: 'All' },
          { value: 'config', label: 'Configuration' },
          { value: 'runs', label: 'Runs' },
          { value: 'approvals', label: 'Approvals' },
        ]}
      />
      <ActivityFeed items={items} empty={<p className="type-body-sm py-2 text-ink-3">No recorded activity for this view yet.</p>} />
      {events.length > items.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + 60)}
          className="type-caption self-start rounded-sm px-2 py-1.5 font-medium text-ink-3 hover:bg-hover hover:text-ink"
        >
          Show older activity · {events.length - items.length} more
        </button>
      )}
    </section>
  )
}
