import { memo, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useScope } from '@/core/context'
import { useRow, useRowsByIds } from '@/core/db'
import { useInvestigations } from '@/core/services'
import { excerpt } from '@/core/sim/text'
import type { Investigation } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { HUE_FILL } from '@/ui'
import { useLatestRun } from './hooks'
import { sourceStats } from './logic'
import { InvestigationGlyph, QuietLine, SectionLabel, TextButton, statusWord } from './parts'

const VISIBLE = 5

/** Recent reports on the Research home stage: the latest reports in scope, newest first. */
export function RecentReports({ className }: { className?: string }) {
  const scope = useScope()
  const reports = useInvestigations({ projectId: scope, status: ['review', 'complete'] })
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? reports : reports.slice(0, VISIBLE)
  return (
    <section aria-labelledby="research-recent" className={className}>
      <SectionLabel
        id="research-recent"
        count={reports.length || undefined}
        action={
          reports.length > VISIBLE ? (
            <TextButton onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show fewer' : `Show all ${reports.length}`}</TextButton>
          ) : undefined
        }
      >
        Recent reports
      </SectionLabel>
      {reports.length === 0 ? (
        <QuietLine>Reports appear here once Scout has drafted them.</QuietLine>
      ) : (
        <ul className="mt-1 flex flex-col divide-y divide-line border-y border-line">
          {shown.map((inv) => (
            <ReportRow key={inv.id} inv={inv} showProject={!scope} />
          ))}
        </ul>
      )}
    </section>
  )
}

const ReportRow = memo(function ReportRow({ inv, showProject }: { inv: Investigation; showProject: boolean }) {
  const run = useLatestRun(inv)
  const sources = useRowsByIds('sources', inv.sourceIds)
  const stats = useMemo(() => sourceStats(sources), [sources])
  const project = useRow('projects', showProject ? inv.projectId : null)
  const summary = useMemo(() => {
    const section = /##\s+(?:Executive summary|Summary)\s+([\s\S]*?)(\n## |$)/.exec(inv.report ?? '')?.[1]
    return excerpt(section ?? inv.question, 200)
  }, [inv.report, inv.question])
  return (
    <li>
      <Link
        to={`/research/${inv.id}`}
        className="group/report -mx-2 flex min-w-0 gap-3 rounded-sm px-2 py-3 transition-colors duration-(--dur-1) hover:bg-hover focus-visible:outline-offset-[-2px]"
      >
        <span className="flex h-5 shrink-0 items-center">
          <InvestigationGlyph inv={inv} run={run} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="type-body-sm min-w-0 flex-1 truncate font-medium text-ink">{inv.title}</span>
            <span className="type-meta shrink-0 text-ink-3">{timeAgo(inv.updatedAt)}</span>
          </span>
          <span className="type-caption line-clamp-2 text-pretty text-ink-2">{summary}</span>
          <span className="type-meta mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-ink-3 tabular">
            {project && (
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn('size-2 rounded-[2px]', HUE_FILL[project.hue])} />
                {project.name}
                <span aria-hidden>·</span>
              </span>
            )}
            <span>{statusWord(inv, run)}</span>
            <span aria-hidden>·</span>
            <span>
              {inv.findings.length} finding{inv.findings.length === 1 ? '' : 's'}
            </span>
            <span aria-hidden>·</span>
            <span>
              {stats.active} source{stats.active === 1 ? '' : 's'}
              {stats.simulated > 0 && ` (${stats.simulated} simulated)`}
            </span>
          </span>
        </span>
      </Link>
    </li>
  )
})
