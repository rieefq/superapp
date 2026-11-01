import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useInsights, useMinuteNow } from '@/core/analytics'
import { ErrorState } from '@/ui'
import { RunsCard, SpendCard, TokensCard, WaitCard } from './Charts'
import { FewRunsNote, HonestyBanner } from './Honesty'
import { KpiPanel } from './Kpis'
import { AgentsTable, FailureReasons, WorkflowsTable } from './Tables'
import { useInsightsFilters } from './state'

/**
 * Overview (§6.10): honesty first, then the four headline tiles, at most four figures, and the
 * Agents and Workflows tables with the top failure reasons. Numbers drill into History.
 */
export function Overview() {
  const { params, filters } = useInsightsFilters()
  const now = useMinuteNow()
  const insights = useInsights({
    rangeDays: filters.rangeDays,
    projectId: filters.projectId,
    kinds: filters.kind ? [filters.kind] : undefined,
    provider: filters.provider,
  })
  return (
    <div className="flex flex-col gap-6" data-testid="insights-overview" data-runs={insights.totals.runs}>
      <Boundary name="the honesty note">
        <HonestyBanner insights={insights} />
      </Boundary>
      <FewRunsNote runs={insights.totals.runs} />
      <Boundary name="the key figures">
        <KpiPanel insights={insights} params={params} />
      </Boundary>
      <div className="grid gap-6 lg:grid-cols-2">
        <Boundary name="Runs">
          <RunsCard insights={insights} params={params} now={now} />
        </Boundary>
        <Boundary name="Spend">
          <SpendCard insights={insights} params={params} now={now} />
        </Boundary>
        <Boundary name="Tokens">
          <TokensCard insights={insights} params={params} />
        </Boundary>
        <Boundary name="Approval wait">
          <WaitCard insights={insights} />
        </Boundary>
      </div>
      <Boundary name="Agents">
        <AgentsTable insights={insights} params={params} />
      </Boundary>
      <Boundary name="Workflows">
        <WorkflowsTable insights={insights} params={params} />
      </Boundary>
      <Boundary name="failure reasons">
        <FailureReasons insights={insights} params={params} />
      </Boundary>
    </div>
  )
}

/** One failing figure shows an ErrorState with Retry; the rest of Insights keeps working. */
export class Boundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[insights] ${this.props.name} failed`, error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <ErrorState
          compact
          title={`Couldn’t show ${this.props.name}`}
          message="Something in this part of Insights failed to render. The rest still works."
          details={this.state.error.stack ?? this.state.error.message}
          onRetry={() => this.setState({ error: null })}
          retryLabel="Retry"
        />
      )
    }
    return this.props.children
  }
}
