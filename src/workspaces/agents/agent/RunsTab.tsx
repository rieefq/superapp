import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ScopeFilterRow } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import { runsByAgent } from '@/core/services'
import { isRunActive, type Agent, type Run } from '@/core/types'
import { EmptyState, Tabs } from '@/ui'
import { AgentRunRow } from './NowTab'

type Filter = 'all' | 'active' | 'succeeded' | 'failed' | 'cancelled'
const PAGE = 30

const matches = (r: Run, f: Filter) => (f === 'all' ? true : f === 'active' ? isRunActive(r.status) : r.status === f)

/** Runs (§6.4): every run of this agent, newest first, filterable by outcome; a row opens it in place. */
export default function RunsTab({ agent }: { agent: Agent }) {
  const scope = useScope()
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  const data = useDB(
    useShallow((s: Tables) => {
      const runs = (runsByAgent(s.runs).get(agent.id) ?? []).filter((r) => !scope || r.projectId === scope)
      const counts = { all: runs.length, active: 0, succeeded: 0, failed: 0, cancelled: 0 }
      for (const r of runs) {
        if (isRunActive(r.status)) counts.active++
        else if (r.status === 'succeeded' || r.status === 'failed' || r.status === 'cancelled') counts[r.status]++
      }
      const ids = runs
        .filter((r) => matches(r, filter))
        .sort((a, b) => Number(isRunActive(b.status)) - Number(isRunActive(a.status)) || b.createdAt - a.createdAt)
        .map((r) => r.id)
      return { ids: ids.join(','), ...counts }
    }),
  )
  const ids = data.ids ? data.ids.split(',') : []
  const shown = ids.slice(0, limit)
  return (
    <section aria-label={`${agent.name}’s runs`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          variant="pill"
          size="sm"
          aria-label="Outcome"
          value={filter}
          onValueChange={(v) => {
            setFilter(v as Filter)
            setLimit(PAGE)
          }}
          items={[
            { value: 'all', label: 'All', count: data.all },
            { value: 'active', label: 'In flight', count: data.active },
            { value: 'succeeded', label: 'Done', count: data.succeeded },
            { value: 'failed', label: 'Failed', count: data.failed },
            { value: 'cancelled', label: 'Stopped', count: data.cancelled },
          ]}
        />
      </div>
      <ScopeFilterRow className="-mx-4 -my-1" />
      {shown.length === 0 ? (
        <EmptyState
          compact
          title={data.all === 0 ? `${agent.name} hasn’t run yet` : 'No runs with this outcome'}
          description={data.all === 0 ? (scope ? 'Nothing in this project yet. Show all projects to see every run.' : 'Runs appear here as soon as it starts working.') : 'Choose another outcome to see the rest.'}
        />
      ) : (
        <div role="list" aria-label="Runs" className="-mx-2 flex flex-col gap-px">
          {shown.map((id) => (
            <div role="listitem" key={id}>
              <AgentRunRow runId={id} agentId={agent.id} />
            </div>
          ))}
        </div>
      )}
      {ids.length > shown.length && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE)}
          className="type-caption self-start rounded-sm px-2 py-1.5 font-medium text-ink-3 hover:bg-hover hover:text-ink"
        >
          Show {Math.min(PAGE, ids.length - shown.length)} more · {ids.length - shown.length} left
        </button>
      )}
    </section>
  )
}
