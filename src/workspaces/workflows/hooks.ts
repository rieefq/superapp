import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { useDB, type Tables } from '@/core/db'
import { validateWorkflow, type WorkflowIssue } from '@/core/services/workflows'
import { isRunActive, type Agent, type ID, type Run, type RunStatus, type Workflow } from '@/core/types'
import { useEditorStore } from './editorStore'

/**
 * Compact run summaries per workflow for lists and cards. The selector returns one short string per
 * workflow (shallow-compared), so lists re-render when an outcome changes — not on every step update.
 */

export interface WorkflowSummary {
  runs: number
  /** Last 10 outcomes, oldest first. */
  outcomes: RunStatus[]
  /** Share of finished runs (of the last 20) that succeeded. */
  successRate: number | null
  /** Status of the newest active run (running · waiting · queued · paused). */
  active?: RunStatus
  activeRunId?: ID
  lastAt?: number
  lastStatus?: RunStatus
}

const EMPTY: WorkflowSummary = { runs: 0, outcomes: [], successRate: null }

function summarize(runs: Run[]): string {
  runs.sort((a, b) => b.createdAt - a.createdAt)
  const finished = runs.filter((r) => !isRunActive(r.status)).slice(0, 20)
  const ok = finished.filter((r) => r.status === 'succeeded').length
  const active = runs.find((r) => isRunActive(r.status))
  return [
    runs.length,
    runs.slice(0, 10).map((r) => r.status).reverse().join(','),
    finished.length ? (ok / finished.length).toFixed(3) : '',
    active ? `${active.status}:${active.id}` : '',
    runs[0] ? `${runs[0].createdAt}:${runs[0].status}` : '',
  ].join('|')
}

function parse(key: string | undefined): WorkflowSummary {
  if (!key) return EMPTY
  const [count, outcomes, rate, active, last] = key.split('|')
  const [activeStatus, activeRunId] = active ? active.split(':') : []
  const [lastAt, lastStatus] = last ? last.split(':') : []
  return {
    runs: Number(count),
    outcomes: outcomes ? (outcomes.split(',') as RunStatus[]) : [],
    successRate: rate ? Number(rate) : null,
    ...(activeStatus ? { active: activeStatus as RunStatus, activeRunId } : {}),
    ...(lastAt ? { lastAt: Number(lastAt), lastStatus: lastStatus as RunStatus } : {}),
  }
}

/** Summaries for every workflow, keyed by id. */
export function useWorkflowSummaries(): Record<ID, WorkflowSummary> {
  const keys = useDB(
    useShallow((s: Tables) => {
      const byWf: Record<string, Run[]> = {}
      for (const r of Object.values(s.runs)) if (r.workflowId && s.workflows[r.workflowId]) (byWf[r.workflowId] ??= []).push(r)
      const out: Record<string, string> = {}
      for (const id of Object.keys(s.workflows)) out[id] = summarize(byWf[id] ?? [])
      return out
    }),
  )
  return useMemo(() => Object.fromEntries(Object.entries(keys).map(([id, k]) => [id, parse(k)])), [keys])
}

/** Runs started per day for one workflow over the last `days` days (oldest first). */
export function useRunsPerDay(workflowId: ID, days = 14): number[] {
  const key = useDB((s: Tables) => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const counts = Array.from({ length: days }, () => 0)
    for (const r of Object.values(s.runs)) {
      if (r.workflowId !== workflowId) continue
      const d = new Date(r.createdAt)
      d.setHours(0, 0, 0, 0)
      const idx = days - 1 - Math.round((start.getTime() - d.getTime()) / 86_400_000)
      if (idx >= 0 && idx < days) counts[idx]++
    }
    return counts.join(',')
  })
  return useMemo(() => key.split(',').map(Number), [key])
}

/** Workflows in scope (all when unscoped or when the list shows All), newest edit first. */
export function useScopedWorkflows(projectId: ID | null): Workflow[] {
  return useDB(
    useShallow((s: Tables) =>
      Object.values(s.workflows)
        .filter((w) => !projectId || w.projectId === projectId)
        .sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.updatedAt - a.updatedAt),
    ),
  )
}

// ------------------------------------------------------------------------------------------------ editor model

/** Draw a run on the canvas and keep it in the URL (`?run=`), so it survives a reload and can be shared. */
export function useShowRun(): (runId: ID | null) => void {
  const [, setParams] = useSearchParams()
  return (runId) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (runId) next.set('run', runId)
        else next.delete('run')
        return next
      },
      { replace: true },
    )
}

/** The run drawn on the canvas: ?run=, else the one you just started, else the newest run still in flight. */
export function useOverlayRun(wf: Workflow | undefined, runs: Run[]): Run | undefined {
  const [params] = useSearchParams()
  const picked = params.get('run')
  const started = useEditorStore((s) => s.overlayRunId)
  if (!wf) return undefined
  const mine = (id: string | null) => (id ? runs.find((r) => r.id === id) : undefined)
  return mine(picked) ?? mine(started) ?? runs.find((r) => isRunActive(r.status))
}

export function useAgentsById(): Record<string, Pick<Agent, 'name' | 'sigil' | 'hue'>> {
  return useDB(
    useShallow((s: Tables) => {
      const out: Record<string, Agent> = {}
      for (const a of Object.values(s.agents)) out[a.id] = a
      return out
    }),
  )
}

export function useIssues(wf: Workflow | undefined): { issues: WorkflowIssue[]; byNode: Record<string, WorkflowIssue[]> } {
  // Validation depends on the graph, agents and connections.
  const deps = useDB(useShallow((s: Tables) => ({ agents: s.agents, connections: s.connections })))
  return useMemo(() => {
    if (!wf) return { issues: [], byNode: {} }
    const issues = validateWorkflow(wf)
    const byNode: Record<string, WorkflowIssue[]> = {}
    for (const i of issues) if (i.nodeId) (byNode[i.nodeId] ??= []).push(i)
    return { issues, byNode }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf, deps])
}

