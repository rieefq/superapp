import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { useDB, useRowsByIds } from '@/core/db'
import { useScope } from '@/core/context'
import { useActiveRuns } from '@/core/runs'
import { entityRoute } from '@/core/services'
import { useSettings } from '@/core/settings'
import type { Run } from '@/core/types'
import { HoverCard, useReducedMotion } from '@/ui'
import { AgentMark, SimBadge } from '@/ui/signature'
import { cn } from '@/lib/cn'
import { attachRun } from './store'
import { useShellLayout } from './context'
import { useNeedsYouCount } from './signals'
import { RunGlyph, Tape, runStatusWord } from './sig'
import { RunPeek } from './RunPeek'
import { markRunOpened, useFailedUnopenedIds, useJustFinishedIds } from './runTracker'
import { budgetTone, computeSpend, formatElapsed, orderRunLine, splitPills, totalsParts } from './runline'
import { ProjectMark } from './ProjectSwitcher'

/** A clock that ticks every `ms` while `enabled` (elapsed times in pills and peeks). */
export function useNow(ms: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms, enabled])
  return now
}

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
  const { ordered, active, finishedIds } = useRunLineRuns()
  const needsYou = useNeedsYouCount()
  const { spend, tone, budget } = useSpend()
  const totals = totalsParts(active, needsYou, spend)
  const now = useNow(1000, ordered.length > 0)
  const reduced = useReducedMotion()
  const pillsRef = useRef<HTMLDivElement>(null)
  const [pillRoom, setPillRoom] = useState(metrics.pills)

  // Never show more pills than fit (≈200px each), within the range's maximum (3 · 4 · 5).
  useEffect(() => {
    const el = pillsRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setPillRoom(Math.max(1, Math.floor((el.clientWidth - 48) / 196))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { shown, overflow } = splitPills(ordered, Math.min(metrics.pills, pillRoom))

  const open = (run: Run, e: MouseEvent) => {
    markRunOpened(run.id)
    if (e.metaKey || e.ctrlKey) {
      navigate(entityRoute({ kind: 'run', id: run.id }))
      return
    }
    attachRun(run.id, workspace.id)
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
          <ul className="flex min-w-0 items-center gap-1.5" aria-label="Runs in flight">
            <AnimatePresence initial={false} mode="popLayout">
              {shown.map((run) => (
                <motion.li
                  key={run.id}
                  layout={reduced ? false : 'position'}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, scale: 0.96, transition: { duration: 0.24, ease: [0.4, 0, 1, 1] } }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="flex min-w-0 shrink"
                >
                  <HoverCard
                    openDelay={300}
                    placement="top-start"
                    className="w-80 p-0"
                    content={<RunPeek run={run} now={now} onAttach={() => attachRun(run.id, workspace.id)} onOpen={() => markRunOpened(run.id)} />}
                  >
                    <PillButton run={run} now={now} finished={finishedIds.has(run.id)} otherProject={!!scope && run.projectId !== scope} onClick={(e) => open(run, e)} />
                  </HoverCard>
                </motion.li>
              ))}
            </AnimatePresence>
            {overflow > 0 && (
              <li className="flex shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/agents')}
                  aria-label={`${overflow} more run${overflow === 1 ? '' : 's'} in Agents`}
                  className="type-meta flex h-5 items-center rounded-full border border-line-strong px-2 text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
                >
                  +{overflow}
                </button>
              </li>
            )}
          </ul>
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

/** The pill itself (§5.4.3). Click attaches; ⌘/Ctrl-click opens; hover peeks. */
function PillButton({
  run,
  now,
  finished,
  otherProject,
  onClick,
  ...rest
}: {
  run: Run
  now: number
  finished: boolean
  otherProject: boolean
  onClick: (e: MouseEvent) => void
}) {
  const agent = useDB((s) => (run.agentId ? s.agents[run.agentId] : undefined))
  const project = useDB((s) => (otherProject && run.projectId ? s.projects[run.projectId] : undefined))
  const waiting = run.status === 'waiting'
  const failed = run.status === 'failed'
  const done = run.steps.filter((s) => s.status === 'done').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const elapsed = formatElapsed((run.endedAt ?? now) - (run.startedAt ?? run.createdAt))
  const meta = waiting ? 'wants approval' : failed ? 'failed' : finished ? 'done' : `${total ? `${Math.min(done + (run.status === 'running' ? 1 : 0), total)}/${total} · ` : ''}${elapsed}`
  return (
    <button
      type="button"
      {...rest}
      onClick={onClick}
      aria-label={`${run.title}, ${runStatusWord(run.status)}${waiting ? ', wants approval' : ''}. Attach to the Inspector`}
      data-run-pill={run.id}
      data-status={run.status}
      className={cn(
        'group flex h-5 max-w-[300px] min-w-0 items-center gap-1.5 rounded-full border bg-canvas/40 pr-2 pl-1.5 transition-colors duration-(--dur-1) ease-standard',
        'hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--focus-ring)',
        waiting ? 'border-attn' : failed ? 'border-fail/70' : 'border-line-strong',
        otherProject && 'opacity-60 hover:opacity-100',
      )}
    >
      <RunGlyph status={run.status} />
      {project && <ProjectMark project={project} size={12} />}
      {agent && <AgentMark seed={agent.sigil ?? 0} hue={agent.hue} size={14} label={agent.name} className="shrink-0" />}
      <span className="min-w-0 truncate text-xs leading-4 font-medium text-ink" style={{ maxWidth: 160 }}>
        {run.title}
      </span>
      {!waiting && !failed && <Tape run={run} size="pill" maxCells={12} className="shrink-0" />}
      <span className={cn('type-meta shrink-0 whitespace-nowrap', waiting ? 'text-attn-ink' : failed ? 'text-fail-ink' : 'text-ink-3')}>{meta}</span>
      {run.simulated && <span className="sr-only">Simulated</span>}
    </button>
  )
}
