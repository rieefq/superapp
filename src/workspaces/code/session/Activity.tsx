import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ArrowDown, ChevronRight, RotateCw } from 'lucide-react'
import { HoldButton, SaveToKnowledgeButton, TurnIntoMenu } from '@/app/components'
import { attachRun } from '@/app/shell/store'
import { useDB, type Tables } from '@/core/db'
import { continueSession, PR_FACTORY } from '@/core/services'
import { isRunActive, type CodeSession, type CodeTurn, type EntityRef, type FileChange, type ID, type Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatTime } from '@/lib/format'
import {
  AgentMark, Button, DiffStat, DiffView, EntityChip, IdCode, Markdown, ProvenanceLine, RunStatusBadge, RunTimeline, SimBadge, Skeleton, StepTape,
  formatClock, useNow, useReducedMotion,
} from '@/ui'
import { useSessionDrafts } from '../drafts'
import { summaryMarkdown } from '../logic'
import { SessionComposer } from './SessionComposer'

/**
 * Activity (§6.3): turns `v1`, `v2`… — your instruction, then the agent's live RunTimeline (plan,
 * searches, file reads, edits with their diffs, simulated commands and tests, inline approvals) and
 * the summary with its Colophon. The composer queues a message sent while a turn runs.
 */

export const SIM_TERMINAL = 'Simulated terminal — nothing was executed'

export function PaneHeader({ title, children, className }: { title: string; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex h-9 shrink-0 items-center gap-2 border-b border-line px-4 md:px-5', className)}>
      <h2 className="type-label text-ink-3">{title}</h2>
      <span className="flex-1" />
      {children}
    </div>
  )
}

/** The pane-level honesty label: commands, tests and checks are simulated (§8.4). */
export function SimTerminalNote({ className }: { className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <SimBadge />
      <span className="type-caption truncate text-ink-3">{SIM_TERMINAL}</span>
    </span>
  )
}

/** Other runs that belong to the session but are not turns (pull requests), by creation time. */
function useExtraRuns(session: CodeSession): string[] {
  return useDB(
    useShallow((s: Tables) => {
      const turnRuns = new Set(session.turns.map((t) => t.runId).filter(Boolean))
      return Object.values(s.runs)
        .filter((r) => r.origin?.kind === 'session' && r.origin.id === session.id && !turnRuns.has(r.id) && r.script?.factory === PR_FACTORY)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((r) => r.id)
    }),
  )
}

export function ActivityPane({ session, onReviewFile, header = true }: { session: CodeSession; onReviewFile: (path: string) => void; header?: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLOListElement>(null)
  const [params] = useSearchParams()
  const focusRun = params.get('run')
  const extra = useExtraRuns(session)
  const { atBottom, jump } = useStickToBottom(scrollRef, contentRef, focusRun)

  // ?run= scrolls to (and outlines) that turn.
  useEffect(() => {
    if (!focusRun) return
    const el = contentRef.current?.querySelector<HTMLElement>(`[data-run-id="${CSS.escape(focusRun)}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [focusRun])

  const items = useMemo(() => {
    const turns = session.turns.map((t, i) => ({ type: 'turn' as const, at: t.createdAt, turn: t, index: i }))
    return turns
  }, [session.turns])
  const latestTurnId = session.turns[session.turns.length - 1]?.id
  const archived = session.status === 'archived'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {header && (
        <PaneHeader title="Activity">
          <SimTerminalNote />
        </PaneHeader>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain" data-activity-scroll="">
          {!header && <SimTerminalNote className="px-4 pt-3 md:px-5" />}
          <ol ref={contentRef} aria-label={`Turns of ${session.title}`} className="flex flex-col gap-10 px-4 pt-5 pb-8 md:px-5">
            {items.map(({ turn, index }) => (
              <TurnItem
                key={turn.id}
                sessionId={session.id}
                turn={turn}
                version={index + 1}
                latest={turn.id === latestTurnId}
                archived={archived}
                highlighted={!!focusRun && turn.runId === focusRun}
                onReviewFile={onReviewFile}
              />
            ))}
            {extra.map((runId) => (
              <PullRequestRunItem key={runId} runId={runId} highlighted={focusRun === runId} />
            ))}
          </ol>
        </div>
        {!atBottom && (
          <button
            type="button"
            onClick={jump}
            className="atr-rise absolute bottom-3 left-1/2 inline-flex h-7 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-overlay px-3 text-xs text-ink shadow-e1 transition-colors duration-(--dur-1) hover:bg-hover pointer-coarse:h-11"
          >
            <ArrowDown aria-hidden className="size-3.5" />
            Jump to latest
          </button>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-3 pt-3 pb-3 md:px-4">
        <SessionComposer session={session} />
      </div>
    </div>
  )
}

/**
 * Follow the latest activity while you are at the bottom; stop when you scroll up (a "Jump to
 * latest" chip appears). Starts at the bottom (the latest turn) unless a `?run=` focuses one.
 */
function useStickToBottom(scrollRef: RefObject<HTMLDivElement | null>, contentRef: RefObject<HTMLElement | null>, focusRun: string | null) {
  const [atBottom, setAtBottom] = useState(true)
  const pinned = useRef(!focusRun)
  const reduced = useReducedMotion()

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [scrollRef])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    // Only your own scrolling unpins: layout changes (a card collapsing, output arriving) never do.
    let intentAt = 0
    const intent = () => {
      intentAt = Date.now()
    }
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) intent()
    }
    // A press on the scrollbar itself (dragging it) is scrolling; a click on content is not.
    const onPointer = (e: PointerEvent) => {
      if (e.offsetX >= el.clientWidth) intent()
    }
    const isBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 24
    const onScroll = () => {
      const bottom = isBottom()
      if (bottom) pinned.current = true
      else if (Date.now() - intentAt < 400) pinned.current = false
      else if (pinned.current) el.scrollTop = el.scrollHeight
      setAtBottom(pinned.current || bottom || el.scrollHeight <= el.clientHeight)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', intent, { passive: true })
    el.addEventListener('touchmove', intent, { passive: true })
    el.addEventListener('pointerdown', onPointer, { passive: true })
    el.addEventListener('keydown', onKey)
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (pinned.current) el.scrollTop = el.scrollHeight
        setAtBottom(pinned.current || isBottom() || el.scrollHeight <= el.clientHeight)
      })
      ro.observe(content)
    }
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', intent)
      el.removeEventListener('touchmove', intent)
      el.removeEventListener('pointerdown', onPointer)
      el.removeEventListener('keydown', onKey)
      ro?.disconnect()
    }
  }, [scrollRef, contentRef])

  const jump = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    pinned.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' })
    setAtBottom(true)
  }, [scrollRef, reduced])

  return { atBottom, jump }
}

// ------------------------------------------------------------------------------------------------ a turn

interface TurnItemProps {
  sessionId: ID
  turn: CodeTurn
  version: number
  latest: boolean
  archived: boolean
  highlighted: boolean
  onReviewFile: (path: string) => void
}

const TurnItem = memo(function TurnItem({ sessionId, turn, version, latest, archived, highlighted, onReviewFile }: TurnItemProps) {
  const run = useDB((s: Tables) => (turn.runId ? s.runs[turn.runId] : undefined))
  const agent = useDB((s: Tables) => (run?.agentId ? s.agents[run.agentId] : undefined))
  const actionsRef = useRef<HTMLDivElement>(null)
  const active = !!run && isRunActive(run.status)
  const finished = !!run && !active
  const failed = run?.status === 'failed' || run?.status === 'cancelled'
  const summary = run?.status === 'succeeded' ? (run.summary ?? turn.summary) : undefined
  const runRef: EntityRef | undefined = run ? { kind: 'run', id: run.id } : undefined

  return (
    <li data-turn={turn.id} data-run-id={turn.runId} className={cn('flex min-w-0 flex-col gap-3 rounded-md', highlighted && '-mx-2 px-2 py-2 ring-1 ring-line-strong')}>
      {/* Your instruction */}
      <div className="flex flex-col gap-1.5">
        <p className="type-meta-caps flex items-center gap-2 text-ink-3">
          <span className="text-ink-2">v{version}</span>
          <span aria-hidden>·</span>
          <span>You</span>
          <span aria-hidden>·</span>
          <time dateTime={new Date(turn.createdAt).toISOString()} className="normal-case">
            {formatTime(turn.createdAt)}
          </time>
        </p>
        <div className="type-body rounded-md border border-line bg-raised px-3.5 py-2.5 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">{turn.prompt}</div>
      </div>

      {/* The agent's run */}
      {!run ? (
        turn.runId ? (
          <p className="type-caption text-ink-3">This turn’s run was deleted.</p>
        ) : (
          <div className="flex flex-col gap-2" aria-busy="true" aria-label="Starting the turn">
            <Skeleton height={12} width="40%" />
            <Skeleton height={10} width="65%" />
          </div>
        )
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <RunLine run={run} agentName={agent?.name} agentMark={agent ? <AgentMark seed={agent.sigil} hue={agent.hue} size={16} live={run.status === 'running'} label={agent.name} /> : null} />
          <RunTimeline run={run} renderRef={(ref) => <EntityChip entity={ref} size="sm" />} defaultExpanded={active ? 'active' : 'none'} />
          <TurnEdits run={run} onReviewFile={onReviewFile} />
          {run.status === 'failed' && run.error && !run.steps.some((st) => st.status === 'failed') && (
            <p role="alert" className="type-body-sm rounded-sm border border-fail/30 bg-fail-tint/40 px-3 py-2 text-fail-ink">
              {run.error}
            </p>
          )}
          {summary && (
            <div className="flex flex-col gap-1.5">
              <span className="type-label text-ink-3">Summary</span>
              <Markdown prose="ui" className="type-body-sm text-ink">
                {summaryMarkdown(summary)}
              </Markdown>
            </div>
          )}
          {finished && (
            <div ref={actionsRef} className="flex flex-col gap-2 border-t border-line pt-2.5">
              <ProvenanceLine run={run} onViewRun={() => attachRun(run.id, 'code')} />
              <div className="-ml-2 flex flex-wrap items-center gap-1">
                {failed && latest && !archived && (
                  <Button size="xs" variant="secondary" leadingIcon={RotateCw} onClick={() => continueSession(sessionId, turn.prompt)}>
                    Retry this turn
                  </Button>
                )}
                {runRef && <HoldButton entity={runRef} size="xs" hotkeyScope={actionsRef} />}
                {runRef && <SaveToKnowledgeButton entity={runRef} size="xs" hotkeyScope={actionsRef} />}
                {runRef && <TurnIntoMenu entity={runRef} kinds={['task', 'research', 'note', 'agent']} size="xs" hotkeyScope={actionsRef} />}
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  )
})

/** The run's line above its timeline: agent, SIM, handle, status, steps n/m, elapsed and the Step Tape. */
function RunLine({ run, agentName, agentMark }: { run: Run; agentName?: string; agentMark: ReactNode }) {
  const live = run.status === 'running'
  const now = useNow(live)
  const elapsed = (run.endedAt ?? (isRunActive(run.status) ? now : run.startedAt ?? run.createdAt)) - (run.startedAt ?? run.createdAt)
  const done = run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const total = Math.max(run.steps.length, run.plannedSteps ?? 0)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <span className="type-meta-caps inline-flex items-center gap-1.5 text-ink-2">
        {agentMark}
        {agentName ?? 'Agent'}
        {run.simulated && <SimBadge />}
      </span>
      <RunStatusBadge status={run.status} />
      <span className="type-meta flex items-center gap-1.5 text-ink-3 tabular">
        <IdCode id={run.id} />
        <span aria-hidden>·</span>
        <span>
          {done}/{total || '…'} steps
        </span>
        <span aria-hidden>·</span>
        <span className={cn(live && 'text-live-ink')}>{formatClock(Math.max(0, elapsed))}</span>
      </span>
      <span className="flex-1" />
      <StepTape run={run} size="sm" max={20} />
    </div>
  )
}

/** The edits this turn made, as mini diffs under the timeline (collapsed to one line by default). */
function TurnEdits({ run, onReviewFile }: { run: Run; onReviewFile: (path: string) => void }) {
  const [open, setOpen] = useState(false)
  const changes = useMemo(() => {
    const byPath = new Map<string, FileChange>()
    for (const step of run.steps) {
      if (step.status !== 'done') continue
      for (const c of step.fileChanges ?? []) {
        const prev = byPath.get(c.path)
        // Several steps may touch one file: keep the first before and the last after.
        byPath.set(c.path, prev ? { ...c, before: prev.before, changeType: prev.changeType === 'added' ? 'added' : c.changeType } : c)
      }
    }
    return [...byPath.values()]
  }, [run.steps])
  if (!changes.length) return null
  const add = changes.reduce((n, c) => n + c.additions, 0)
  const del = changes.reduce((n, c) => n + c.deletions, 0)
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="group/edits -mx-1.5 flex min-w-0 items-center gap-2 self-start rounded-sm px-1.5 py-1 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-ink-3 transition-transform duration-(--dur-1)', open && 'rotate-90')} strokeWidth={2} />
        <span className="type-body-sm font-medium text-ink-2 group-hover/edits:text-ink">
          {open ? 'Hide the diffs' : 'Show the diffs'}
        </span>
        <span className="type-meta text-ink-3">
          {changes.length} {changes.length === 1 ? 'file' : 'files'}
        </span>
        <DiffStat additions={add} deletions={del} hideBar />
      </button>
      {open && (
        <div className="flex min-w-0 flex-col gap-2">
          {changes.map((c) => (
            <DiffView
              key={c.path}
              oldText={c.changeType === 'added' ? '' : (c.before ?? '')}
              newText={c.changeType === 'deleted' ? '' : (c.after ?? '')}
              path={c.path}
              oldPath={c.oldPath}
              context={2}
              maxHeight={280}
              actions={
                <Button size="xs" variant="ghost" onClick={() => onReviewFile(c.path)}>
                  Review
                </Button>
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** A pull-request run in the activity stream (not a turn): its compact timeline and Colophon. */
const PullRequestRunItem = memo(function PullRequestRunItem({ runId, highlighted }: { runId: ID; highlighted: boolean }) {
  const run = useDB((s: Tables) => s.runs[runId])
  const agent = useDB((s: Tables) => (run?.agentId ? s.agents[run.agentId] : undefined))
  if (!run) return null
  return (
    <li data-run-id={run.id} className={cn('flex min-w-0 flex-col gap-3', highlighted && '-mx-2 rounded-md px-2 py-2 ring-1 ring-line-strong')}>
      <p className="type-meta-caps text-ink-3">Pull request · {formatTime(run.createdAt)}</p>
      <RunLine run={run} agentName={agent?.name} agentMark={agent ? <AgentMark seed={agent.sigil} hue={agent.hue} size={16} live={run.status === 'running'} label={agent.name} /> : null} />
      <RunTimeline run={run} compact defaultExpanded="none" />
      {!isRunActive(run.status) && <ProvenanceLine run={run} onViewRun={() => attachRun(run.id, 'code')} className="border-t border-line pt-2.5" />}
    </li>
  )
})

/** Insert text into this session's composer (used by Files and Changes). */
export function useInsertIntoComposer(sessionId: ID) {
  const insert = useSessionDrafts((s) => s.insert)
  return useCallback((text: string) => insert(sessionId, text), [insert, sessionId])
}
