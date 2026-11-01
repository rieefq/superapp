import { useEffect, useMemo } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { CalendarRange, History as HistoryIcon, ScrollText } from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import type { Command } from '@/app/types'
import { PageTemplate, StageHeader } from '@/app/templates'
import { INSIGHT_RANGES, rangeLabel, rangeToken, watchBudget } from '@/core/analytics'
import { SERIES_VARS, SimHatchDefs } from './Card'
import { FilterBar } from './FilterBar'
import { History } from './History'
import { Journal } from './Journal'
import { Boundary, Overview } from './Overview'
import { filterQuery, useInsightsFilters } from './state'

type Tab = 'overview' | 'history' | 'journal'

/** The shared filters of the page as it is now (for commands that run later). */
const currentQuery = () => filterQuery(new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search))

function tabOf(pathname: string): Tab {
  const rest = pathname.replace(/^\/insights/, '').replace(/\/+$/, '')
  if (rest === '/history') return 'history'
  if (rest === '/journal') return 'journal'
  return 'overview'
}

/**
 * Insights (§6.10): runs, reliability, model usage, tokens and spend — Page template, max 1280.
 * Tabs: Overview · History · Journal. Filters (range, project, kind, provider) live in the URL and
 * carry across tabs; every number drills into the runs behind it.
 */
export default function InsightsWorkspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const { params, filters, setRange } = useInsightsFilters()
  const tab = tabOf(location.pathname)
  const q = filterQuery(params)

  // Crossing 80% of the monthly budget posts one Update (§6.10).
  useEffect(() => watchBudget(), [])

  const commands = useMemo<Command[]>(
    () => [
      ...INSIGHT_RANGES.filter((d) => d !== filters.rangeDays).map(
        (d, i): Command => ({
          id: `insights.range.${d}`,
          title: `Show the ${rangeLabel(d).toLowerCase()}`,
          subtitle: 'Insights range',
          icon: CalendarRange,
          group: 'Insights',
          keywords: ['range', 'period', rangeToken(d), 'insights'],
          priority: 20 - i,
          run: (ctx) => {
            ctx.close()
            setRange(d)
          },
        }),
      ),
      ...(tab !== 'history'
        ? [
            {
              id: 'insights.view.history',
              title: 'Show the runs behind these numbers',
              subtitle: 'Insights › History',
              icon: HistoryIcon,
              group: 'Insights',
              keywords: ['history', 'runs', 'executions'],
              // Registered commands outlive this render: read the filters when the command runs.
              run: (ctx) => {
                ctx.close()
                navigate(`/insights/history${currentQuery()}`)
              },
            } satisfies Command,
          ]
        : []),
      ...(tab !== 'journal'
        ? [
            {
              id: 'insights.view.journal',
              title: 'Open the activity journal',
              subtitle: 'Insights › Journal',
              icon: ScrollText,
              group: 'Insights',
              keywords: ['journal', 'activity', 'audit', 'log'],
              run: (ctx) => {
                ctx.close()
                navigate(`/insights/journal${currentQuery()}`)
              },
            } satisfies Command,
          ]
        : []),
    ],
    [filters.rangeDays, tab, navigate, setRange],
  )
  useRegisterCommands('insights.view', commands)

  const header = (
    <StageHeader
      title="Insights"
      tabs={{
        'aria-label': 'Insights views',
        value: tab,
        items: [
          { value: 'overview', label: 'Overview', to: `/insights${q}`, end: true },
          { value: 'history', label: 'History', to: `/insights/history${q}` },
          { value: 'journal', label: 'Journal', to: `/insights/journal${q}` },
        ],
      }}
    />
  )

  return (
    <PageTemplate width="insights" header={header} className="pb-16 md:pb-16">
      <SimHatchDefs />
      <div className="flex flex-col gap-6" style={SERIES_VARS}>
        <FilterBar showProvider={tab !== 'journal'} showKind={tab !== 'journal'} />
        <Routes>
          <Route index element={<Overview />} />
          <Route
            path="history"
            element={
              <Boundary name="the history">
                <History />
              </Boundary>
            }
          />
          <Route
            path="journal"
            element={
              <Boundary name="the journal">
                <Journal />
              </Boundary>
            }
          />
          <Route path="*" element={<Navigate to={`/insights${q}`} replace />} />
        </Routes>
      </div>
    </PageTemplate>
  )
}
