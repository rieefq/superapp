import { History } from 'lucide-react'
import { RunPanel } from '@/app/components'
import { useRowsByIds } from '@/core/db'
import { useActivityFor, actorName } from '@/core/services'
import type { Investigation } from '@/core/types'
import { timeAgo } from '@/lib/format'
import { EmptyState } from '@/ui'
import { QuietLine, SectionLabel } from './parts'

/**
 * Activity (§6.5): every run of the investigation, newest first, as a full RunTimeline with its
 * controls and Colophon (RunPanel), then the investigation's history as sentences.
 */
export function ActivityView({ inv }: { inv: Investigation }) {
  const runs = useRowsByIds('runs', inv.runIds)
  const newestFirst = [...runs].reverse()
  const events = useActivityFor({ kind: 'investigation', id: inv.id }, 30)
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="activity-runs" className="flex flex-col gap-3">
        <SectionLabel id="activity-runs" count={runs.length || undefined}>
          Runs
        </SectionLabel>
        {newestFirst.length === 0 ? (
          <EmptyState
            compact
            icon={History}
            title="No runs recorded"
            description="This investigation came with the demo data, so its run history isn’t here. Ask a follow-up to start one."
            className="px-0"
          />
        ) : (
          <div className="flex flex-col gap-8">
            {newestFirst.map((run) => (
              <div key={run.id} className="[--sig-surface:var(--surface-canvas)]">
                <RunPanel runId={run.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="activity-history" className="flex flex-col gap-2">
        <SectionLabel id="activity-history">History</SectionLabel>
        {events.length === 0 ? (
          <QuietLine>No recorded activity yet.</QuietLine>
        ) : (
          <ol className="relative flex flex-col gap-3 before:absolute before:top-1.5 before:bottom-1.5 before:left-[3px] before:w-px before:bg-line">
            {events.map((e) => (
              <li key={e.id} className="relative flex gap-3 pl-4">
                <span aria-hidden className={`absolute top-1.5 left-0 size-[7px] rounded-full border bg-canvas ${e.actor.type === 'agent' ? 'border-ink-3' : 'border-line-input'}`} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="type-body-sm text-pretty text-ink-2">{e.summary}</span>
                  <span className="type-meta text-ink-3">
                    {actorName(e.actor)} · {timeAgo(e.at)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
