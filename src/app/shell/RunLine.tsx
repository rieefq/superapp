import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence } from 'motion/react'
import { useDB, useRowsByIds } from '@/core/db'
import { useScope } from '@/core/context'
import { useActiveRuns } from '@/core/runs'
import { entityRoute } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { Run } from '@/core/types'
import { RunPill, SimBadge } from '@/ui'
import { cn } from '@/lib/cn'
import { attachRun } from './store'
import { useShellLayout } from './context'
import { useNeedsYouCount } from './signals'
import { RunPeek } from './RunPeek'
import { markRunOpened, useFailedUnopenedIds, useJustFinishedIds } from './runTracker'
import { budgetTone, computeSpend, fitPills, orderRunLine, splitPills, totalsParts } from './runline'

/** All the runs the Run Line shows, in order (shared with the phone live strip). */
export function useRunLineRuns(): { ordered: Run[]; active: Run[]; finishedIds: Set<string>; failedIds: Set<string> } {
  const scope = useScope()
  const active = useActiveRuns()
  const failedKey = useFailedUnopenedIds().join(',')
  const finishedKey = useJustFinishedIds().join(',')
  const failedIds = useMemo(() => (failedKey ? failedKey.split(',') : []), [failedKey])
  const finishedIds = useMemo(() => (finishedKey ? finishedKey.split(',') : []), [finishedKey])
  const failedRuns = useRowsByIds('runs', failedIds).filter((r) => r.status === 'failed')
  const finishedRuns = useRowsByIds('runs', finishedIds).filter((r) => r.status === 'succeeded')
  const ordered = orderRunLine({ active, failedUnopened: failedRuns, justFinished: finishedRuns, scopeProjectId: scope })
  return { ordered, active, finishedIds: new Set(finishedIds), failedIds: new Set(failedIds) }
}

function useSpend() {
  const count = useSettings((s) => s.safety.countSimulatedSpend)
  const budget = useSettings((s) => s.safety.monthlyBudgetUsd)
  // Encoded so the totals only re-render when a cent-level figure changes.
  const key = useDB((s) => {
    const sp = computeSpend(Object.values(s.runs), Date.now(), count)
    return `${sp.liveToday.toFixed(4)}|${sp.simToday.toFixed(4)}|${sp.monthCounted.toFixed(4)}`
  })
  const [liveToday, simToday, monthCounted] = key.split('|').map(Number)
  return { spend: { liveToday, simToday, monthCounted }, tone: budgetTone(monthCounted, budget), budget }
}

/** The Run Line (§3.6): every run in flight, as pills; totals at the right. */
export function RunLine() {
  const navigate = useNavigate()
  const { metrics, workspace } = useShellLayout()
  const focusMode = useSettings((s) => s.notifications.focusMode)
  const scope = useScope()
  const { ordered, active } = useRunLineRuns()
  const needsYou = useNeedsYouCount()
  const { spend, tone, budget } = useSpend()
  const totals = totalsParts(active, needsYou, spend)
  const pillsRef = useRef<HTMLDivElement>(null)
  const [pillsWidth, setPillsWidth] = useState(0)

  // Show as many pills as fit with readable titles, within the range's maximum (3 · 4 · 5).
  useEffect(() => {
    const el = pillsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setPillsWidth(el.clientWidth))
    ro.observe(el)
    setPillsWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  const { shown, overflow } = splitPills(ordered, pillsWidth ? fitPills(ordered, pillsWidth, metrics.pills) : metrics.pills)

  const attach = (run: Run) => {
    markRunOpened(run.id)
    attachRun(run.id, workspace.id)
  }
  const openRun = (run: Run) => {
    markRunOpened(run.id)
    navigate(entityRoute({ kind: 'run', id: run.id }))
  }

  const toneClass = tone === 'fail' ? 'text-fail-ink' : tone === 'attn' ? 'text-attn-ink' : 'text-ink-3'
  const budgetNote =
    tone === 'fail' ? `Over this month’s $${budget} budget` : tone === 'attn' ? `Over 80% of this month’s $${budget} budget` : undefined

  return (
    <section
      role="region"
      aria-label="Runs"
      data-region="runline"
      className="relative z-(--z-topbar) flex h-7 shrink-0 items-center gap-3 bg-chrome pr-3"
      style={{ paddingLeft: metrics.rail + metrics.bezel }}
    >
      <div ref={pillsRef} className="flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {ordered.length === 0 ? (
          <span className="type-meta text-ink-4">No runs in flight</span>
        ) : (
          <div className="flex min-w-0 items-center gap-1.5" role="group" aria-label="Runs in flight">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((run) => (
                <Pill key={run.id} run={run} scope={scope} onAttach={() => attach(run)} onOpen={() => openRun(run)} />
              ))}
            </AnimatePresence>
            {overflow > 0 && (
              <button
                type="button"
                onClick={() => navigate('/agents')}
                aria-label={`${overflow} more run${overflow === 1 ? '' : 's'} in Agents`}
                className="type-meta flex h-5 shrink-0 items-center rounded-full border border-line-strong px-2 text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
              >
                +{overflow}
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => navigate('/agents')}
        title={budgetNote}
        aria-label={`${totals.running} running, ${totals.needsYou} need${totals.needsYou === 1 ? 's' : ''} you, ${totals.spendLabel}${totals.estimated ? ' (simulated estimate)' : ''}. Open Agents`}
        className={cn('type-meta flex h-5 shrink-0 items-center gap-1.5 rounded-xs px-1 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink', toneClass)}
      >
        <span>{totals.running} running</span>
        {totals.paused > 0 && (
          <>
            <span aria-hidden>·</span>
            <span>{totals.paused} paused</span>
          </>
        )}
        <span aria-hidden>·</span>
        <span>{totals.needsYou} needs you</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{totals.spendLabel}</span>
        {totals.estimated && <SimBadge size="xs" />}
      </button>
      {focusMode && (
        <span className="type-meta-caps flex h-4 shrink-0 items-center rounded-xs border border-line-strong px-1 text-ink-2" title="Focus mode: approvals don’t toast">
          Focus
        </span>
      )}
    </section>
  )
}

/** One Run Line pill: the signature RunPill with its owner, project and the peek card (§3.6, §5.4.3). */
function Pill({ run, scope, onAttach, onOpen }: { run: Run; scope: string | null; onAttach: () => void; onOpen: () => void }) {
  const agent = useDB((s) => (run.agentId ? s.agents[run.agentId] : undefined))
  const project = useDB((s) => (run.projectId ? s.projects[run.projectId] : undefined))
  const otherProject = !!scope && run.projectId !== scope
  return (
    <RunPill
      run={run}
      agent={agent ? { name: agent.name, hue: agent.hue, sigil: agent.sigil } : undefined}
      project={project ? { name: project.name, hue: project.hue } : undefined}
      otherProject={otherProject}
      onClick={onAttach}
      onOpen={onOpen}
      peek={<RunPeek run={run} onAttach={onAttach} onOpen={onOpen} />}
      className="min-w-0 shrink"
    />
  )
}
