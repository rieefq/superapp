import { useId, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { getModelInfo } from '@/core/ai'
import { useMinuteNow } from '@/core/analytics'
import { useDB, type Tables } from '@/core/db'
import { useSettings } from '@/core/settings'
import type { Autonomy, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { Popover, SimBadge, Tooltip } from '@/ui'
import { formatTokenCount } from '../context/tokens'
import {
  budgetState,
  capabilityRows,
  estimateRunCost,
  formatCost,
  type BudgetState,
  type CapabilityRow,
  type CostEstimate,
  type ReadBackKind,
} from './plan'

/**
 * ReadBack (§5.4.11): the run's plan read back before it starts — what will run where, on which
 * model, with which context, what it may do (decisions from the live permission policy, each
 * expandable to its reason) and what it is likely to cost against the monthly budget.
 */

export interface ReadBackData {
  /** "Research", "Coding session", "Agent · Scout", "Workflow run", "Studio · Deck", "Task". */
  verb: string
  title?: string
  projectName?: string | null
  /** Model that will execute the run (delegated runs are simulated in this build). */
  model: { label: string; simulated: boolean } | null
  /** Context summary: "Project memory 3 · Held 2 · Message “…”" and its tokens. */
  context?: { parts: string[]; tokens: number } | null
  capabilities: CapabilityRow[]
  cost: CostEstimate | null
  budget: BudgetState | null
  /** Per-run budget cap (USD), when set. */
  capUsd?: number | null
}

export const SIM_EXECUTOR_ID = 'sim-deep'
export const ESTIMATE_TOOLTIP = 'Estimated at reference pricing; no money was spent.'

export interface UseReadBackInput {
  kind: ReadBackKind
  title?: string
  projectId?: ID | null
  agentId?: ID | null
  autonomy?: Autonomy
  repoId?: ID | null
  workflowId?: ID | null
  studioKind?: 'image' | 'video' | 'presentation' | 'document' | 'audio'
  /** The model the run will use; delegated kinds are executed by the simulator regardless. */
  modelId?: string
  context?: ReadBackData['context']
  capUsd?: number | null
}

/** Kinds whose runs are executed by the local simulation engine (no model is called). */
const SIMULATED_KINDS = new Set<ReadBackKind>(['research', 'session', 'agent', 'workflow', 'studio', 'task'])

/** Compute a ReadBack from live data (capability decisions, cost history, month-to-date spend). */
export function useReadBack(input: UseReadBackInput): ReadBackData {
  const { kind, agentId, autonomy, repoId, workflowId, studioKind, projectId } = input
  // Decisions depend on agents, connections, the repo/workflow and the safety settings.
  const deps = useDB(
    useShallow((s: Tables) => ({
      agent: agentId ? s.agents[agentId] : undefined,
      connections: s.connections,
      repo: repoId ? s.repos[repoId] : undefined,
      workflow: workflowId ? s.workflows[workflowId] : undefined,
      project: projectId ? s.projects[projectId] : undefined,
    })),
  )
  const safety = useSettings((s) => s.safety)
  const minute = useMinuteNow()
  const modelId = SIMULATED_KINDS.has(kind) ? SIM_EXECUTOR_ID : input.modelId
  const capabilities = useMemo(
    () => capabilityRows(useDB.getState(), { kind, agentId: agentId ?? undefined, autonomy, repoId: repoId ?? undefined, workflowId: workflowId ?? undefined, studioKind }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, agentId, autonomy, repoId, workflowId, studioKind, deps, safety],
  )
  // Cost history and spend are read at most once a minute (runs change constantly while simulating).
  const cost = useMemo(
    () => estimateRunCost(useDB.getState(), kind, modelId, input.context?.tokens ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, modelId, input.context?.tokens, minute],
  )
  const budget = useMemo(() => budgetState(useDB.getState(), safety, Date.now()), [safety, minute])
  const info = getModelInfo(modelId)
  return {
    verb: VERB[kind],
    title: input.title,
    projectName: deps.project?.name ?? null,
    model: info ? { label: info.label, simulated: info.simulated } : null,
    context: input.context ?? null,
    capabilities,
    cost,
    budget,
    capUsd: input.capUsd ?? null,
  }
}

const VERB: Record<ReadBackKind, string> = {
  research: 'Research',
  session: 'Coding session',
  agent: 'Agent run',
  workflow: 'Workflow run',
  studio: 'Studio',
  task: 'Task',
  note: 'Note',
  chat: 'Chat',
}

// ------------------------------------------------------------------------------------------------ pieces

function Tag({ live }: { live: boolean }) {
  return live ? (
    <span className="type-meta-caps inline-flex h-4 items-center rounded-xs border border-line-input px-1 text-[10px] text-ink-2">LIVE</span>
  ) : (
    <SimBadge size="xs" label="SIM" />
  )
}

function DecisionWord({ row }: { row: CapabilityRow }) {
  if (row.word === 'asks you')
    return (
      <span className="inline-flex items-center gap-1 text-attn-ink">
        asks you <span aria-hidden>◆</span>
      </span>
    )
  if (row.word === 'blocked')
    return (
      <span className="inline-flex items-center gap-1 text-ink-2">
        blocked <span aria-hidden>⊘</span>
      </span>
    )
  return <span className="text-ink-2">allowed</span>
}

function CapabilityLine({ row }: { row: CapabilityRow }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="group/cap -mx-1 flex w-[calc(100%+8px)] min-w-0 items-baseline gap-2 rounded-xs px-1 text-left hover:bg-hover"
      >
        <span className="shrink-0 text-ink">{row.label}</span>
        <span aria-hidden className="mb-[3px] min-w-3 flex-1 self-end border-b border-dotted border-line-input" />
        <span className="shrink-0">
          <DecisionWord row={row} />
        </span>
        <span className="flex w-10 shrink-0 justify-end self-center">
          <Tag live={!row.simulated} />
        </span>
        <ChevronRight
          aria-hidden
          className={cn('size-3 shrink-0 self-center text-ink-3 transition-transform duration-(--dur-2)', open && 'rotate-90')}
          strokeWidth={2}
        />
      </button>
      {open && (
        <p id={id} className="mt-0.5 mb-1 pl-0.5 text-ink-3">
          {row.decision.reason}.
        </p>
      )}
    </li>
  )
}

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[76px_minmax(0,1fr)] items-baseline gap-x-3', className)}>
      <dt className="type-label pt-px text-ink-3">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function CostText({ cost, budget, capUsd }: Pick<ReadBackData, 'cost' | 'budget' | 'capUsd'>) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5">
      {cost ? (
        <Tooltip content={cost.simulated ? ESTIMATE_TOOLTIP : `Based on ${cost.basedOn || 'typical'} past runs of this kind`}>
          <span tabIndex={0} className="text-ink outline-offset-1">
            est. {formatCost(cost.usd)}
          </span>
        </Tooltip>
      ) : (
        <span className="text-ink-3">no run</span>
      )}
      {capUsd ? <span className="text-ink-3">· stops at {formatCost(capUsd)}</span> : null}
      {budget && budget.monthlyUsd > 0 && (
        <span className={cn(budget.ratio !== null && budget.ratio >= 1 ? 'text-fail-ink' : budget.ratio !== null && budget.ratio >= 0.8 ? 'text-attn-ink' : 'text-ink-3')}>
          · {formatCost(budget.leftUsd)} left of {formatCost(budget.monthlyUsd)} this month
        </span>
      )}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ full

export interface ReadBackProps {
  data: ReadBackData
  className?: string
}

/** The full ReadBack (type-mono-sm, labels in type-label). */
export function ReadBack({ data, className }: ReadBackProps) {
  return (
    <dl aria-label="Read back" className={cn('type-mono-sm flex flex-col gap-1.5 text-ink-2', className)}>
      <Row label="Will run">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0">
            <span className="text-ink">{data.verb}</span>
            {data.title && <span className="text-ink-2"> · “{data.title}”</span>}
          </span>
          <span className="shrink-0 text-ink-3">{data.projectName ? `in ${data.projectName}` : 'no project'}</span>
        </span>
      </Row>
      {data.model && (
        <Row label="Model">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-ink">{data.model.label}</span>
            {data.model.simulated ? (
              <span className="inline-flex items-center gap-1.5 text-ink-3">
                <SimBadge size="xs" label="SIM" /> no model is called
              </span>
            ) : (
              <Tag live />
            )}
          </span>
        </Row>
      )}
      {data.context && (
        <Row label="Context">
          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="min-w-0 text-ink-2">{data.context.parts.length ? data.context.parts.join(' · ') : 'Nothing attached'}</span>
            <span className="shrink-0 text-ink-3">{formatTokenCount(data.context.tokens)} tok</span>
          </span>
        </Row>
      )}
      {data.capabilities.length > 0 && (
        <Row label="Can">
          <ul className="flex flex-col gap-0.5">
            {data.capabilities.map((c) => (
              <CapabilityLine key={`${c.capability}:${c.integrationId ?? ''}`} row={c} />
            ))}
          </ul>
        </Row>
      )}
      <Row label="Cost">
        <CostText cost={data.cost} budget={data.budget} capUsd={data.capUsd} />
      </Row>
    </dl>
  )
}

// ------------------------------------------------------------------------------------------------ line

/** The ReadBack line (§5.4.11): `Simulator · Deep SIM · asks before: Write knowledge · est. $0.06 · Details`. */
export function ReadBackLine({ data, className }: ReadBackProps) {
  const asks = data.capabilities.filter((c) => c.word === 'asks you').map((c) => c.label)
  const blocked = data.capabilities.filter((c) => c.word === 'blocked').map((c) => c.label)
  return (
    <div className={cn('type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3', className)}>
      {data.model && (
        <span className="inline-flex items-center gap-1.5 text-ink-2">
          {data.model.label}
          {data.model.simulated && <SimBadge size="xs" label="SIM" />}
        </span>
      )}
      {asks.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>
            asks before: <span className="text-attn-ink">{asks.join(', ')}</span>
          </span>
        </>
      )}
      {blocked.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>blocked: {blocked.join(', ')}</span>
        </>
      )}
      {data.cost && (
        <>
          <span aria-hidden>·</span>
          <Tooltip content={data.cost.simulated ? ESTIMATE_TOOLTIP : 'Estimated from past runs of this kind'}>
            <span tabIndex={0}>est. {formatCost(data.cost.usd)}</span>
          </Tooltip>
        </>
      )}
      <span aria-hidden>·</span>
      <Popover
        placement="top-start"
        aria-label="Read back details"
        className="w-[min(460px,calc(100vw-16px))] p-4"
        trigger={
          <button type="button" className="rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
            Details
          </button>
        }
      >
        <ReadBack data={data} />
      </Popover>
    </div>
  )
}
