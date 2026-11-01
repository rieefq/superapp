import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Approval, EntityRef, ID, Run, RunStep } from '@/core/types'
import { cn } from '@/lib/cn'
import { DiffStat, Markdown, Terminal, type TerminalLine } from '@/ui/display'
import { useReducedMotion } from '@/ui/hooks'
import { ApprovalCard, ApprovalCardConnected, type ApprovalRequester } from './ApprovalCard'
import { useNow } from './clock'
import { EntityChip } from './entity'
import { formatClock, formatSeconds, formatTokenCount } from './format'
import { StatusGlyph, StepStatusGlyph } from './glyphs'
import { OriginBadge, SimBadge } from './honesty'
import { toolUseLabel } from './receipt'
import { StepIcon } from './StepTape'
import { stepTitle } from './tense'
import { CodeSpans } from './text'
import {
  groupStatus, groupTimelineSteps, isStepSimulated, isTerminalStep, isWebStep, simulatedFrameHeader, stepDurationMs,
  type TimelineEntry, type TimelineGroupEntry,
} from './timeline'
import './signature.css'

export interface RunTimelineProps {
  run: Run
  /**
   * Approvals by id; steps with an approval render an inline full ApprovalCard with these handlers.
   * Omit it to wire approval steps to the approvals service (ApprovalCardConnected).
   */
  approvals?: Record<ID, Approval>
  onApprove?: (approvalId: ID, note?: string) => void | Promise<void>
  onReject?: (approvalId: ID, note?: string) => void | Promise<void>
  onAlwaysAllow?: (approvalId: ID) => void | Promise<void>
  onEditApproval?: (approvalId: ID, payload: string) => void | Promise<void>
  /** Whether a capability is in Settings › Safety › always ask (hides "Always allow"). */
  alwaysAskBlocked?: (approval: Approval) => boolean
  /** Requester shown on approval cards (name + mark). */
  requesterFor?: (approval: Approval) => ApprovalRequester | undefined
  /** Custom rendering for referenced entities (default: EntityChip). */
  renderRef?: (ref: EntityRef) => ReactNode
  /** Alias of `variant="compact"`. */
  compact?: boolean
  /** full (stage) · compact (Inspector: outputs collapsed, 6px tighter). */
  variant?: 'full' | 'compact'
  /** Which steps start with input/output open. Default: full → 'active', compact → 'none'. */
  defaultExpanded?: 'all' | 'active' | 'none'
  /** Highlight and scroll to a step (the Inspector's Step Tape scrubber). */
  selectedStepId?: ID
  className?: string
}

/**
 * The thread of a run (docs/DESIGN.md §5.4.4): a spine (4px hatch band when simulated) with a live bead
 * on the active segment, 20px kind markers, present/past-tense titles, LIVE/SIM tool chips, expandable
 * input/output (simulated tools framed in a hatch), refs, file changes, inline approvals, and runs of
 * finished read/search steps collapsed into one group. Set `--sig-surface` to the background it sits on.
 */
export function RunTimeline({
  run, approvals, onApprove, onReject, onAlwaysAllow, onEditApproval, alwaysAskBlocked, requesterFor, renderRef, compact, variant,
  defaultExpanded, selectedStepId, className,
}: RunTimelineProps) {
  const v = variant ?? (compact ? 'compact' : 'full')
  const isCompact = v === 'compact'
  const mode = defaultExpanded ?? (isCompact ? 'none' : 'active')
  const live = run.status === 'running'
  const now = useNow(live)
  const reduced = useReducedMotion()
  const entries = useMemo(() => groupTimelineSteps(run.steps, { runKind: run.kind }), [run.steps, run.kind])
  const rootRef = useRef<HTMLDivElement>(null)

  // Explicit user choices win; steps that were open while running/failed stay open (no layout jump on finish).
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const [sticky, setSticky] = useState<Record<string, true>>({})
  const autoOpen = run.steps.filter((s) => (mode === 'active' && (s.status === 'running' || s.status === 'failed')) || mode === 'all')
  const missing = autoOpen.filter((s) => !sticky[s.id])
  if (missing.length) setSticky((prev) => ({ ...prev, ...Object.fromEntries(missing.map((s) => [s.id, true as const])) }))
  const isOpen = (key: string) => toggled[key] ?? !!sticky[key]
  const toggle = (key: string) => setToggled((prev) => ({ ...prev, [key]: !isOpen(key) }))

  // Scrubber selection: a group holding the selected step opens (GroupItem), then the step scrolls into view.
  useEffect(() => {
    if (!selectedStepId) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(selectedStepId)}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [selectedStepId, reduced])

  const planned = Math.max(0, (run.plannedSteps ?? 0) - run.steps.length)
  const activeRun = run.status === 'running' || run.status === 'queued' || run.status === 'waiting' || run.status === 'paused'
  const lastIndex = entries.length - 1
  const hasTail = activeRun && planned > 0
  const failedStep = run.steps.some((s) => s.status === 'failed')
  const showFailure = run.status === 'failed' && !failedStep && !!run.error
  const showStopped = run.status === 'cancelled'

  const ctx: ItemContext = {
    run, approvals, isCompact, now, renderRef, isOpen, toggle, selectedStepId,
    approval: { onApprove, onReject, onAlwaysAllow, onEditApproval, alwaysAskBlocked, requesterFor },
  }

  return (
    <div ref={rootRef} className={cn('@container/timeline min-w-0', className)}>
      <ol aria-label={`Steps of ${run.title}`} className="relative flex flex-col">
        {run.steps.length === 0 && (
          <EndRow
            glyph={<StatusGlyph shape="ring" tone="ink-3" decorative />}
            text={run.status === 'queued' ? 'Queued · waiting to start' : run.status === 'running' ? 'Starting' : 'No steps were recorded'}
            spine={live ? 'tail' : hasTail ? 'line' : 'none'}
            run={run}
            compact={isCompact}
          />
        )}
        {entries.map((entry, i) => {
          const isLast = i === lastIndex
          const continues = !isLast || hasTail || showFailure || showStopped
          const running = entry.type === 'step' && entry.step.status === 'running'
          const spine: SpineKind = continues ? (running ? 'live' : 'line') : running && live ? 'tail' : 'none'
          return entry.type === 'group' ? (
            <GroupItem key={entry.key} entry={entry} ctx={ctx} spine={spine} />
          ) : (
            <StepItem key={entry.step.id} step={entry.step} ctx={ctx} spine={spine} />
          )
        })}
        {hasTail && (
          <EndRow
            glyph={<StatusGlyph shape="ring" tone="ink-4" decorative />}
            text={`${planned} more ${planned === 1 ? 'step' : 'steps'} planned`}
            spine="none"
            run={run}
            compact={isCompact}
            quiet
          />
        )}
        {showFailure && <EndRow glyph={<StatusGlyph shape="cross" tone="fail" decorative />} text={run.error!} spine="none" run={run} compact={isCompact} tone="fail" />}
        {showStopped && (
          <EndRow
            glyph={<StatusGlyph shape="slash" tone="ink-3" decorative />}
            text={run.error && !/cancel|stop/i.test(run.error) ? `Stopped · ${run.error}` : 'Stopped by you'}
            spine="none"
            run={run}
            compact={isCompact}
          />
        )}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------------ spine

type SpineKind = 'none' | 'line' | 'live' | 'tail'

/** The segment from this item's marker to the next one (or a short tail below a live last step). */
function Spine({ kind, simulated }: { kind: SpineKind; simulated: boolean }) {
  if (kind === 'none') return null
  const tail = kind === 'tail'
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute top-2.5 left-0 w-5', tail ? 'h-8' : '-bottom-2.5')}
    >
      <span className={cn('absolute inset-y-0', simulated ? 'sim-band left-2' : 'left-[9.5px] w-px bg-line-strong')} />
      {(kind === 'live' || tail) && (
        <span className="sig-bead-track absolute inset-x-0 top-2.5 bottom-0">
          <span className="sig-bead absolute left-2 size-1 rounded-full bg-live" />
        </span>
      )}
    </span>
  )
}

function EndRow({
  glyph, text, spine, run, compact, quiet, tone,
}: { glyph: ReactNode; text: string; spine: SpineKind; run: Run; compact: boolean; quiet?: boolean; tone?: 'fail' }) {
  return (
    <li className={cn('relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3', compact ? 'pb-1.5' : 'pb-2')}>
      <Spine kind={spine} simulated={run.simulated} />
      <span className="relative grid size-5 place-items-center rounded-sm bg-[var(--sig-surface,var(--surface-canvas))]">{glyph}</span>
      <span className={cn('type-caption flex min-h-5 items-center', tone === 'fail' ? 'text-fail-ink' : quiet ? 'text-ink-3' : 'text-ink-2')}>{text}</span>
    </li>
  )
}

// ------------------------------------------------------------------ items

interface ItemContext {
  run: Run
  approvals?: Record<ID, Approval>
  isCompact: boolean
  now: number
  renderRef?: (ref: EntityRef) => ReactNode
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
  selectedStepId?: ID
  approval: Pick<RunTimelineProps, 'onApprove' | 'onReject' | 'onAlwaysAllow' | 'onEditApproval' | 'alwaysAskBlocked' | 'requesterFor'>
}

const TITLE_TONE: Record<RunStep['status'], string> = {
  pending: 'text-ink-3',
  running: 'text-live-ink',
  waiting: 'text-ink',
  done: 'text-ink',
  failed: 'text-ink',
  skipped: 'text-ink-3',
}

function ToolChip({ label, simulated }: { label: string; simulated: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span className="type-caption text-ink-3">{label}</span>
      <OriginBadge simulated={simulated} />
    </span>
  )
}

function MetaCluster({
  tool, simulated, durationMs, running, tokens, estimated, children,
}: { tool?: string; simulated: boolean; durationMs?: number; running: boolean; tokens?: number; estimated: boolean; children?: ReactNode }) {
  return (
    <span className="type-meta flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-ink-3">
      {tool && <ToolChip label={tool} simulated={simulated} />}
      {durationMs !== undefined && (
        <span className={cn('tabular', running && 'text-live-ink')}>{running ? formatClock(durationMs) : formatSeconds(durationMs)}</span>
      )}
      {tokens ? <span className="tabular">{`${estimated ? '~' : ''}${formatTokenCount(tokens)} tok`}</span> : null}
      {children}
    </span>
  )
}

function StepItem({ step, ctx, spine, nested }: { step: RunStep; ctx: ItemContext; spine: SpineKind; nested?: boolean }) {
  const { run, isCompact, now } = ctx
  const ioId = useId()
  const sim = isStepSimulated(run, step)
  const tool = toolUseLabel(step)
  const hasIO = !!(step.input || step.output)
  const open = hasIO && ctx.isOpen(step.id)
  const title = stepTitle(step.title, step.status)
  const duration = step.status === 'waiting' ? undefined : stepDurationMs(step, now)
  const running = step.status === 'running'
  const approval = step.approvalId ? ctx.approvals?.[step.approvalId] : undefined
  const selected = ctx.selectedStepId === step.id
  const meta = (
    <MetaCluster tool={tool} simulated={sim} durationMs={duration} running={running} tokens={step.tokens} estimated={run.simulated}>
      {isCompact ? null : <StepStatusGlyph status={step.status} context="timeline" />}
    </MetaCluster>
  )

  const titleText = (
    <span className={cn('type-body-sm font-medium text-pretty', TITLE_TONE[step.status])}>
      <CodeSpans text={title} />
      {step.status === 'skipped' && <span className="font-normal text-ink-3"> · skipped</span>}
    </span>
  )

  return (
    <li
      data-step-id={step.id}
      data-status={step.status}
      className={cn('relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3', isCompact ? 'pb-2.5' : 'pb-4', nested && 'pb-3')}
    >
      <Spine kind={spine} simulated={run.simulated} />
      <StepIcon kind={step.kind} status={step.status} marker />
      <div className={cn('flex min-w-0 flex-col gap-1.5 rounded-sm', selected && 'bg-hover/60 -mx-1.5 px-1.5 pb-1 ring-1 ring-line-strong')}>
        <div
          className={cn(
            'flex min-w-0 flex-col gap-0.5',
            !isCompact && '@[520px]/timeline:flex-row @[520px]/timeline:items-start @[520px]/timeline:justify-between @[520px]/timeline:gap-3',
          )}
        >
          <div className="flex min-h-5 min-w-0 items-start gap-1.5 pt-px">
            {hasIO ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? ioId : undefined}
                onClick={() => ctx.toggle(step.id)}
                className="group/title -mx-1 -my-0.5 flex min-w-0 items-start gap-1 rounded-xs px-1 py-0.5 text-left transition-colors duration-(--dur-1) hover:bg-hover"
              >
                {titleText}
                <ChevronRight
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform duration-(--dur-1) group-hover/title:text-ink-2',
                    open && 'rotate-90',
                  )}
                  strokeWidth={2}
                />
              </button>
            ) : (
              titleText
            )}
            {isCompact && (
              <span className="ml-auto pt-0.5">
                <StepStatusGlyph status={step.status} context="timeline" />
              </span>
            )}
          </div>
          {meta}
        </div>
        {step.detail && <p className="type-caption text-ink-2 text-pretty">{step.detail}</p>}
        {step.status === 'failed' && step.error && <p className="type-caption text-fail-ink text-pretty">{step.error}</p>}
        {step.status === 'waiting' && !approval && ctx.approvals && <p className="type-caption text-attn-ink">Waiting for your approval</p>}
        {step.refs && step.refs.length > 0 && <Refs refs={step.refs} render={ctx.renderRef} />}
        {step.fileChanges && step.fileChanges.length > 0 && <FileChanges changes={step.fileChanges} />}
        {open && (
          <div id={ioId} className="pt-0.5">
            <StepIO step={step} simulated={sim} compact={isCompact} />
          </div>
        )}
        {!ctx.approvals && step.approvalId && (
          <ApprovalCardConnected approvalId={step.approvalId} variant="full" ifMissing="nothing" collapseResolved showRun={false} className="mt-1" />
        )}
        {approval && (
          <ApprovalCard
            approval={approval}
            variant="full"
            collapseResolved
            simulated={run.simulated}
            requester={ctx.approval.requesterFor?.(approval)}
            alwaysAskBlocked={ctx.approval.alwaysAskBlocked?.(approval)}
            onApprove={ctx.approval.onApprove ? (note) => ctx.approval.onApprove!(approval.id, note) : undefined}
            onReject={ctx.approval.onReject ? (note) => ctx.approval.onReject!(approval.id, note) : undefined}
            onAlwaysAllow={ctx.approval.onAlwaysAllow ? () => ctx.approval.onAlwaysAllow!(approval.id) : undefined}
            onEdit={ctx.approval.onEditApproval ? (payload) => ctx.approval.onEditApproval!(approval.id, payload) : undefined}
            className="mt-1 [--sig-surface:var(--surface-canvas)]"
          />
        )}
      </div>
    </li>
  )
}

function GroupItem({ entry, ctx, spine }: { entry: TimelineGroupEntry; ctx: ItemContext; spine: SpineKind }) {
  const { run, isCompact } = ctx
  const listId = useId()
  const open = ctx.isOpen(entry.key)
  const steps = entry.steps.map((e) => e.step)
  const status = groupStatus(steps)
  const duration = steps.reduce((n, s) => n + (stepDurationMs(s) ?? 0), 0)
  const tokens = steps.reduce((n, s) => n + (s.tokens ?? 0), 0)
  const tools = [...new Set(steps.map((s) => toolUseLabel(s)).filter(Boolean))] as string[]
  const sim = steps.some((s) => isStepSimulated(run, s))
  const containsSelected = !!ctx.selectedStepId && steps.some((s) => s.id === ctx.selectedStepId)
  return (
    <li data-group={entry.key} className={cn('relative grid grid-cols-[20px_minmax(0,1fr)] gap-x-3', isCompact ? 'pb-2.5' : 'pb-4')}>
      <Spine kind={spine} simulated={run.simulated} />
      <StepIcon kind={entry.kind} status={status} marker />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-0.5',
            !isCompact && '@[520px]/timeline:flex-row @[520px]/timeline:items-start @[520px]/timeline:justify-between @[520px]/timeline:gap-3',
          )}
        >
          <div className="flex min-h-5 min-w-0 items-start gap-1.5 pt-px">
            <button
              type="button"
              aria-expanded={open || containsSelected}
              aria-controls={open || containsSelected ? listId : undefined}
              onClick={() => ctx.toggle(entry.key)}
              className="group/title -mx-1 -my-0.5 flex min-w-0 items-start gap-1 rounded-xs px-1 py-0.5 text-left transition-colors duration-(--dur-1) hover:bg-hover"
            >
              <span className="type-body-sm font-medium text-ink">{entry.label}</span>
              <span className="type-meta mt-0.5 text-ink-3">{steps.length} steps</span>
              <ChevronRight
                aria-hidden
                className={cn('mt-0.5 size-3.5 shrink-0 text-ink-4 transition-transform duration-(--dur-1) group-hover/title:text-ink-2', open && 'rotate-90')}
                strokeWidth={2}
              />
            </button>
            {isCompact && (
              <span className="ml-auto pt-0.5">
                <StepStatusGlyph status={status} context="timeline" />
              </span>
            )}
          </div>
          <MetaCluster tool={tools.length === 1 ? tools[0] : undefined} simulated={sim} durationMs={duration} running={false} tokens={tokens} estimated={run.simulated}>
            {isCompact ? null : <StepStatusGlyph status={status} context="timeline" />}
          </MetaCluster>
        </div>
        {(open || containsSelected) && (
          <ol id={listId} aria-label={entry.label} className="relative mt-1.5 flex flex-col">
            {entry.steps.map((child, i) => (
              <StepItem key={child.step.id} step={child.step} ctx={ctx} spine={i < entry.steps.length - 1 ? 'line' : 'none'} nested />
            ))}
          </ol>
        )}
      </div>
    </li>
  )
}

// ------------------------------------------------------------------ step content

function Refs({ refs, render }: { refs: readonly EntityRef[]; render?: (ref: EntityRef) => ReactNode }) {
  const [all, setAll] = useState(false)
  const shown = all ? refs : refs.slice(0, 6)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((ref) => (
        <span key={`${ref.kind}:${ref.id}`} className="inline-flex max-w-full">
          {render ? render(ref) : <EntityChip entity={ref} size="sm" />}
        </span>
      ))}
      {refs.length > shown.length && (
        <button type="button" onClick={() => setAll(true)} className="type-meta h-[18px] rounded-xs px-1 text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink">
          +{refs.length - shown.length} more
        </button>
      )}
    </div>
  )
}

function FileChanges({ changes }: { changes: NonNullable<RunStep['fileChanges']> }) {
  const [all, setAll] = useState(false)
  const shown = all ? changes : changes.slice(0, 5)
  return (
    <ul className="flex flex-col gap-0.5">
      {shown.map((c) => (
        <li key={c.path} className="flex min-w-0 items-center gap-2">
          <span className="type-mono-sm min-w-0 truncate text-ink-2" title={c.path}>
            {c.changeType === 'renamed' && c.oldPath ? `${c.oldPath} → ${c.path}` : c.path}
          </span>
          {c.changeType !== 'modified' && <span className="type-meta shrink-0 text-ink-3">{c.changeType}</span>}
          <DiffStat additions={c.additions} deletions={c.deletions} className="shrink-0" />
        </li>
      ))}
      {changes.length > shown.length && (
        <li>
          <button type="button" onClick={() => setAll(true)} className="type-meta rounded-xs px-1 text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink">
            +{changes.length - shown.length} more files
          </button>
        </li>
      )}
    </ul>
  )
}

/** Hatched frame around a simulated tool's output, with its exact header (§8.4). */
export function SimFrame({ header, children, className }: { header: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('sim-hatch rounded-md border border-dashed border-line-input p-1', className)}>
      <div className="flex min-h-7 items-start gap-2 px-1.5 pt-1 pb-1.5">
        <SimBadge className="mt-px" />
        {/* Never truncated: the exact honesty string always shows in full (§8.4). */}
        <span className="type-caption min-w-0 rounded-xs bg-sim-tint px-1 text-pretty text-sim-ink">{header}</span>
      </div>
      {children}
    </div>
  )
}

const looksLikeMarkdown = (text: string) => /(^|\n)\s*([-*] |\d+\. |#{1,3} |> )|\*\*|`/.test(text)

function StepIO({ step, simulated, compact }: { step: RunStep; simulated: boolean; compact: boolean }) {
  const header = simulated ? simulatedFrameHeader(step) : undefined
  const terminal = isTerminalStep(step)
  const lines = useMemo(() => {
    const out: TerminalLine[] = []
    if (!terminal) return out
    if (step.input) out.push({ id: 'cmd', kind: 'command', text: step.input })
    // A leading ✓ is a success whatever words follow ("✓ No type errors"); other lines keep the heuristic.
    if (step.output) step.output.split('\n').forEach((text, i) => out.push({ id: `o${i}`, text, tone: /^\s*[✓✔]/.test(text) ? 'done' : undefined }))
    return out
  }, [terminal, step.input, step.output])
  let body: ReactNode
  if (terminal) {
    body = (
      <Terminal
        lines={lines}
        prompt="$"
        hideHeader
        height={compact ? 'sm' : 'md'}
        streaming={step.status === 'running'}
        emptyText={step.status === 'running' ? 'Waiting for output' : 'No output.'}
        aria-label={`Output of ${step.title}`}
      />
    )
  } else if (isWebStep(step) || step.kind === 'search') {
    body = (
      <div className="type-mono-sm flex flex-col gap-1 rounded-sm border border-line bg-sunken px-3 py-2 text-ink-2">
        {step.input && (
          <p className="[overflow-wrap:anywhere]">
            <span className="mr-2 text-ink-4 select-none">{step.kind === 'browse' ? 'page' : 'query'}</span>
            <span className="text-ink">{step.input}</span>
          </p>
        )}
        {step.output && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{step.output}</p>}
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-1.5 rounded-sm border border-line bg-sunken px-3 py-2">
        {step.input && (
          <p className="type-mono-sm text-ink-2 [overflow-wrap:anywhere]">
            <span className="mr-2 text-ink-4 select-none">input</span>
            {step.input}
          </p>
        )}
        {step.output &&
          (looksLikeMarkdown(step.output) ? (
            <Markdown prose="ui" className="text-ink-2">
              {step.output}
            </Markdown>
          ) : (
            <p className="type-body-sm whitespace-pre-wrap text-ink-2">{step.output}</p>
          ))}
        {!step.output && step.status === 'running' && <p className="type-caption text-ink-3">Waiting for output</p>}
      </div>
    )
  }
  return header ? <SimFrame header={header}>{body}</SimFrame> : <>{body}</>
}

export type { TimelineEntry }
