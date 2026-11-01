import { memo, useMemo, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Link, useNavigate } from 'react-router'
import { CornerUpRight, ListFilter } from 'lucide-react'
import { ESTIMATE_TOOLTIP, TurnIntoMenu } from '@/app/components'
import { formatRate, rangeLabel, type AgentInsight, type FailureReason, type Insights, type WorkflowInsight } from '@/core/analytics'
import { useDB, type Tables as DBTables } from '@/core/db'
import { entityRoute } from '@/core/services'
import { timeAgo } from '@/lib/format'
import {
  Button, DataTable, EntityChip, formatCost, formatSeconds, OutcomeTape, RunStatusGlyph, SimBadge, Sparkline, Tooltip, type DataColumn,
} from '@/ui'
import { filterQuery } from './state'
import { fitColumns, useWidth } from './useWidth'

/** Minimum table width (px) at which each optional column is shown. */
const AGENT_COLUMN_MIN: Partial<Record<string, number>> = { success: 400, duration: 560, approvals: 680, failure: 780, trend: 960 }
const WORKFLOW_COLUMN_MIN: Partial<Record<string, number>> = { last: 460, duration: 600, node: 760, recent: 940 }

/**
 * Overview tables (§6.10): Agents (runs, success, average duration, approvals asked, spend, trend,
 * last failure), Workflows (runs, failure rate, average duration, failing node, last run, recent
 * outcomes) and the top failure reasons. Rows drill into the runs behind them; names open the entity.
 */

const COUNT = new Intl.NumberFormat('en-US')

/** Keep clicks and keys inside a cell (chips, links, menus) from also activating the row. */
const stop = {
  onClick: (e: MouseEvent) => e.stopPropagation(),
  onKeyDown: (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
  },
}

function Section({
  id, title, meta, children, action, bodyRef,
}: { id: string; title: string; meta?: ReactNode; children: ReactNode; action?: ReactNode; bodyRef?: Ref<HTMLElement> }) {
  return (
    <section ref={bodyRef} aria-labelledby={id} className="flex min-w-0 flex-col rounded-md border border-line">
      <header className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3 pb-2 md:px-5">
        <h2 id={id} className="type-label text-ink-3">
          {title}
        </h2>
        {meta && <span className="type-meta text-ink-3">{meta}</span>}
        <span className="flex-1" />
        {action}
      </header>
      {children}
    </section>
  )
}

function CostCell({ usd, estimate }: { usd: number; estimate: boolean }) {
  if (!estimate) return <span>{formatCost(usd)}</span>
  return (
    <Tooltip content={ESTIMATE_TOOLTIP}>
      <span>{formatCost(usd, { est: true })}</span>
    </Tooltip>
  )
}

// ------------------------------------------------------------------------------------------------ agents

export function AgentsTable({ insights, params }: { insights: Insights; params: URLSearchParams }) {
  const navigate = useNavigate()
  const rows = insights.byAgent
  const unit = insights.bucketUnit === 'hour' ? 'hour' : 'day'
  const columns = useMemo<DataColumn<AgentInsight>[]>(
    () => [
      {
        key: 'agent',
        header: 'Agent',
        sortable: true,
        sortValue: (a) => a.name.toLowerCase(),
        cell: (a) =>
          a.deleted ? (
            <span className="type-body-sm text-ink-3">Deleted agent</span>
          ) : (
            <span {...stop} className="inline-flex max-w-full">
              <EntityChip entity={{ kind: 'agent', id: a.agentId }} size="sm" variant="subtle" />
            </span>
          ),
      },
      { key: 'runs', header: 'Runs', align: 'right', sortable: true, mono: true, cell: (a) => COUNT.format(a.runs) },
      { key: 'success', header: 'Success', align: 'right', sortable: true, mono: true, sortValue: (a) => a.successRate ?? -1, cell: (a) => formatRate(a.successRate) },
      {
        key: 'duration',
        header: 'Avg time',
        align: 'right',
        sortable: true,
        mono: true,
        sortValue: (a) => a.avgDurationMs ?? -1,
        cell: (a) => (a.avgDurationMs !== null ? formatSeconds(a.avgDurationMs) : '—'),
      },
      { key: 'approvals', header: 'Approvals', align: 'right', sortable: true, mono: true, sortValue: (a) => a.approvalsAsked, cell: (a) => (a.approvalsAsked ? COUNT.format(a.approvalsAsked) : '—') },
      { key: 'spend', header: 'Spend', align: 'right', sortable: true, mono: true, sortValue: (a) => a.costUsd, cell: (a) => <CostCell usd={a.costUsd} estimate={a.costIsEstimate} /> },
      {
        key: 'trend',
        header: 'Trend',
        width: 112,
        cell: (a) =>
          a.runs ? <Sparkline values={a.buckets} variant="bars" height={20} label={`${a.name}: runs per ${unit}`} format={(v) => `${v} runs`} /> : <span className="text-ink-4">—</span>,
      },
      {
        key: 'failure',
        header: 'Last failure',
        sortable: true,
        sortValue: (a) => a.lastFailure?.at ?? -1,
        cell: (a) =>
          a.lastFailure ? (
            <span {...stop} className="flex min-w-0 max-w-[280px] items-center gap-1.5">
              <RunStatusGlyph status="failed" decorative />
              <Link
                to={entityRoute({ kind: 'run', id: a.lastFailure.runId })}
                title={a.lastFailure.reason}
                className="type-caption min-w-0 truncate text-ink-2 underline decoration-transparent underline-offset-2 hover:text-ink hover:decoration-line-input"
              >
                {a.lastFailure.reason}
              </Link>
              <span className="type-meta shrink-0 text-ink-3">{timeAgo(a.lastFailure.at)}</span>
            </span>
          ) : (
            <span className="type-caption text-ink-3">None</span>
          ),
      },
    ],
    [unit],
  )
  const active = rows.filter((a) => a.runs > 0).length
  const [ref, width] = useWidth<HTMLElement>()
  const shown = useMemo(() => fitColumns(columns, width, AGENT_COLUMN_MIN), [columns, width])
  return (
    <Section id="insights-agents" title="Agents" meta={`${active} of ${rows.length} ran · ${rangeLabel(insights.window.rangeDays).toLowerCase()}`} bodyRef={ref}>
      <DataTable
        caption="Agents"
        columns={shown}
        rows={rows}
        rowKey={(a) => a.agentId}
        defaultSort={{ key: 'runs', direction: 'desc' }}
        onRowClick={(a) => navigate(`/insights/history${filterQuery(params, { agent: a.agentId })}`)}
        empty="No agent ran in this period."
        className="px-1 pb-1 md:px-2"
      />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ workflows

export function WorkflowsTable({ insights, params }: { insights: Insights; params: URLSearchParams }) {
  const navigate = useNavigate()
  const columns = useMemo<DataColumn<WorkflowInsight>[]>(
    () => [
      {
        key: 'workflow',
        header: 'Workflow',
        sortable: true,
        sortValue: (w) => w.name.toLowerCase(),
        cell: (w) =>
          w.deleted ? (
            <span className="type-body-sm text-ink-3">Deleted workflow</span>
          ) : (
            <span {...stop} className="inline-flex max-w-full">
              <EntityChip entity={{ kind: 'workflow', id: w.workflowId }} size="sm" variant="subtle" />
            </span>
          ),
      },
      { key: 'runs', header: 'Runs', align: 'right', sortable: true, mono: true, cell: (w) => COUNT.format(w.runs) },
      {
        key: 'failure',
        header: 'Failure rate',
        align: 'right',
        sortable: true,
        mono: true,
        sortValue: (w) => w.failureRate ?? -1,
        cell: (w) => (
          <span className={w.failed ? 'text-fail-ink' : undefined}>
            {formatRate(w.failureRate)}
            {w.failed > 0 && <span className="sr-only">, {w.failed} failed</span>}
          </span>
        ),
      },
      {
        key: 'duration',
        header: 'Avg time',
        align: 'right',
        sortable: true,
        mono: true,
        sortValue: (w) => w.avgDurationMs ?? -1,
        cell: (w) => (w.avgDurationMs !== null ? formatSeconds(w.avgDurationMs) : '—'),
      },
      {
        key: 'node',
        header: 'Failing node',
        sortable: true,
        sortValue: (w) => w.failingNode?.count ?? 0,
        cell: (w) =>
          w.failingNode ? (
            <span className="flex min-w-0 max-w-[220px] items-center gap-1.5">
              <span className="type-caption min-w-0 truncate text-ink-2" title={w.failingNode.label}>
                {w.failingNode.label}
              </span>
              <span className="type-meta shrink-0 text-ink-3">×{w.failingNode.count}</span>
            </span>
          ) : (
            <span className="type-caption text-ink-3">None</span>
          ),
      },
      {
        key: 'recent',
        header: 'Recent',
        cell: (w) => <OutcomeTape outcomes={w.recent} max={10} label={`${w.name}: latest runs`} />,
      },
      {
        key: 'last',
        header: 'Last run',
        align: 'right',
        sortable: true,
        sortValue: (w) => w.lastRunAt ?? -1,
        cell: (w) =>
          w.lastRunId && w.lastRunStatus ? (
            <span {...stop} className="inline-flex items-center justify-end gap-1.5">
              <RunStatusGlyph status={w.lastRunStatus} />
              <Link
                to={entityRoute({ kind: 'run', id: w.lastRunId })}
                className="type-meta text-ink-3 underline decoration-transparent underline-offset-2 hover:text-ink hover:decoration-line-input"
              >
                {timeAgo(w.lastRunAt ?? 0)}
              </Link>
            </span>
          ) : (
            <span className="type-meta text-ink-3">Never</span>
          ),
      },
    ],
    [],
  )
  const [ref, width] = useWidth<HTMLElement>()
  const shown = useMemo(() => fitColumns(columns, width, WORKFLOW_COLUMN_MIN), [columns, width])
  return (
    <Section id="insights-workflows" title="Workflows" meta={`${insights.byWorkflow.filter((w) => w.runs > 0).length} ran`} bodyRef={ref}>
      <DataTable
        caption="Workflows"
        columns={shown}
        rows={insights.byWorkflow}
        rowKey={(w) => w.workflowId}
        defaultSort={{ key: 'runs', direction: 'desc' }}
        onRowClick={(w) => navigate(`/insights/history${filterQuery(params, { workflow: w.workflowId })}`)}
        empty="No workflow ran in this period."
        className="px-1 pb-1 md:px-2"
      />
    </Section>
  )
}

// ------------------------------------------------------------------------------------------------ failure reasons

const FAILURES_SHOWN = 5

export function FailureReasons({ insights, params }: { insights: Insights; params: URLSearchParams }) {
  const reasons = insights.failureReasons
  const total = reasons.reduce((n, r) => n + r.count, 0)
  return (
    <Section id="insights-failures" title="Top failure reasons" meta={total ? `${total} failed ${total === 1 ? 'run' : 'runs'}` : undefined}>
      {reasons.length === 0 ? (
        <p className="type-body-sm px-4 pb-5 text-ink-3 md:px-5">No runs failed in this period.</p>
      ) : (
        <ol className="flex flex-col px-2 pb-2 md:px-3">
          {reasons.slice(0, FAILURES_SHOWN).map((r) => (
            <FailureRow key={r.key} reason={r} params={params} />
          ))}
          {reasons.length > FAILURES_SHOWN && (
            <li className="px-2 pt-1">
              <Link
                to={`/insights/history${filterQuery(params, { status: 'failed' })}`}
                className="type-caption inline-flex h-7 items-center rounded-sm px-1.5 font-medium text-ink-3 hover:bg-hover hover:text-ink"
              >
                {reasons.length - FAILURES_SHOWN} more reasons · all failed runs
              </Link>
            </li>
          )}
        </ol>
      )}
    </Section>
  )
}

const FailureRow = memo(function FailureRow({ reason: r, params }: { reason: FailureReason; params: URLSearchParams }) {
  const example = useDB((s: DBTables) => {
    const run = s.runs[r.exampleRunId]
    return run ? `${run.title}${run.agentId && s.agents[run.agentId] ? ` · ${s.agents[run.agentId].name}` : ''}` : undefined
  })
  return (
    <li className="group/fail flex min-w-0 flex-col gap-1.5 rounded-sm px-2 py-2.5 transition-colors duration-(--dur-1) hover:bg-hover focus-within:bg-hover sm:flex-row sm:items-start sm:gap-3">
      <span className="flex min-w-0 flex-1 items-start gap-2">
        <span className="mt-[3px] shrink-0">
          <RunStatusGlyph status="failed" decorative />
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="type-body-sm text-ink text-pretty">{r.reason}</span>
          <span className="type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 text-ink-3">
            <span>
              {r.count} {r.count === 1 ? 'run' : 'runs'}
            </span>
            <span aria-hidden>·</span>
            <span>last {timeAgo(r.lastAt)}</span>
            {example && (
              <>
                <span aria-hidden>·</span>
                <span className="min-w-0 truncate">{example}</span>
              </>
            )}
            {r.simulated && <SimBadge size="xs" className="ml-0.5" />}
          </span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 pl-5 sm:pl-0">
        <Link
          to={`/insights/history${filterQuery(params, { reason: r.key, status: 'failed' })}`}
          className="type-caption inline-flex h-6 items-center gap-1 rounded-sm px-1.5 font-medium text-ink-2 transition-colors duration-(--dur-1) hover:bg-press hover:text-ink pointer-coarse:h-11"
        >
          <ListFilter aria-hidden className="size-3.5" strokeWidth={1.75} />
          Show runs
        </Link>
        <TurnIntoMenu
          entity={{ kind: 'run', id: r.exampleRunId }}
          kinds={['task', 'session', 'research', 'agent']}
          prefill={{ title: `Fix: ${r.reason}`, brief: `Recurring failure (${r.count}× in this period): ${r.reason}` }}
          size="xs"
          trigger={
            <Button size="xs" variant="ghost" leadingIcon={CornerUpRight}>
              Turn into…
            </Button>
          }
        />
      </span>
    </li>
  )
})
