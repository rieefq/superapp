import type { MouseEvent, ReactNode } from 'react'
import {
  ArrowUpRight, Ellipsis, MessagesSquare, Orbit, Palette, PanelRight, Pause, Play, RotateCw, Square, SquareTerminal, Telescope,
  Workflow, type LucideIcon,
} from 'lucide-react'
import { RUN_KIND_LABEL } from '@/core/services/entities'
import { isRunActive, type Run, type RunKind } from '@/core/types'
import { cn } from '@/lib/cn'
import { IconButton, Menu, Tooltip, type MenuItem } from '@/ui/primitives'
import { formatClock, formatCost, formatTok } from './format'
import { RUN_STATUS_META } from './glyphMeta'
import { RunStatusGlyph } from './glyphs'
import { OriginBadge } from './honesty'
import { AgentMark, MonogramMark } from './marks'
import { useRunElapsed, type RunOwner, type RunProjectInfo } from './RunPill'
import { IdCode } from './small'
import { StepTape } from './StepTape'
import { currentStepIndex } from './tape'
import { stepTitle, stripTicks } from './tense'

export const RUN_KIND_ICON: Record<RunKind, LucideIcon> = {
  chat: MessagesSquare,
  code: SquareTerminal,
  agent: Orbit,
  research: Telescope,
  workflow: Workflow,
  studio: Palette,
}

/** What a run row says in its "current step" column: the active step (present tense) or the outcome. */
export function runCurrentLine(run: Run): string {
  if (isRunActive(run.status)) {
    const i = currentStepIndex(run.steps, run.status)
    if (i < 0) return run.status === 'queued' ? 'Waiting to start' : 'Starting'
    const step = run.steps[i]
    return stripTicks(stepTitle(step.title, run.status === 'paused' ? 'pending' : step.status))
  }
  if (run.status === 'failed') return run.error ?? 'Failed'
  if (run.status === 'cancelled') return run.error && !/cancel|stop/i.test(run.error) ? run.error : 'Stopped by you'
  return run.summary ?? 'Done'
}

export interface RunRowProps {
  run: Run
  /** The agent that owns the run. */
  agent?: RunOwner
  /** Replaces the owner mark (e.g. your Avatar for runs you started). */
  owner?: ReactNode
  project?: RunProjectInfo
  selected?: boolean
  /** Row click (usually: attach the run). */
  onSelect?: (e: MouseEvent<HTMLButtonElement>) => void
  onAttach?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  onRetry?: () => void
  onOpen?: () => void
  className?: string
}

/**
 * Run list row (docs/DESIGN.md §5.4.3), height --row-h: glyph · title + handle · kind · owner · project ·
 * tape · current step or summary · elapsed · tokens · cost · LIVE/SIM. Columns hide right to left as the
 * row narrows (container queries); the SIM/LIVE tag never hides. Hover actions are mirrored in a ⋯ menu.
 */
export function RunRow({
  run, agent, owner, project, selected, onSelect, onAttach, onPause, onResume, onStop, onRetry, onOpen, className,
}: RunRowProps) {
  const elapsed = useRunElapsed(run)
  const active = isRunActive(run.status)
  const KindIcon = RUN_KIND_ICON[run.kind]
  const tokens = run.usage.inputTokens + run.usage.outputTokens
  const word = RUN_STATUS_META[run.status].word
  const line = runCurrentLine(run)
  const canPause = (run.status === 'running' || run.status === 'queued') && !!onPause
  const canResume = run.status === 'paused' && !!onResume
  const canStop = active && !!onStop
  const canRetry = (run.status === 'failed' || run.status === 'cancelled') && !!onRetry

  const actions: { key: string; label: string; icon: LucideIcon; onSelect: () => void; danger?: boolean }[] = []
  if (onAttach) actions.push({ key: 'attach', label: 'Attach', icon: PanelRight, onSelect: onAttach })
  if (canPause) actions.push({ key: 'pause', label: 'Pause', icon: Pause, onSelect: onPause! })
  if (canResume) actions.push({ key: 'resume', label: 'Resume', icon: Play, onSelect: onResume! })
  if (canStop) actions.push({ key: 'stop', label: 'Stop', icon: Square, onSelect: onStop!, danger: true })
  if (canRetry) actions.push({ key: 'retry', label: 'Retry', icon: RotateCw, onSelect: onRetry! })
  if (onOpen) actions.push({ key: 'open', label: 'Open', icon: ArrowUpRight, onSelect: onOpen })
  const menu: MenuItem[] = actions.map((a) => ({ id: a.key, label: a.label, icon: a.icon, onSelect: a.onSelect, danger: a.danger }))

  return (
    <div
      data-status={run.status}
      data-selected={selected ? '' : undefined}
      className={cn(
        '@container group/run relative isolate flex h-(--row-h) w-full min-w-0 items-center rounded-sm pointer-coarse:min-h-11',
        'transition-colors duration-(--dur-1) ease-standard',
        selected ? 'bg-press' : 'hover:bg-hover focus-within:bg-hover',
        className,
      )}
    >
      {onSelect && (
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected || undefined}
          aria-label={`${run.title}, ${word}`}
          className="absolute inset-0 -z-10 rounded-sm focus-visible:outline-2 focus-visible:-outline-offset-2"
        />
      )}
      <div className="pointer-events-none flex min-w-0 flex-1 items-center gap-2.5 pr-3 pl-2 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
        <RunStatusGlyph status={run.status} />
        <span className="flex min-w-0 flex-[3_1_200px] items-baseline gap-2">
          <span className="type-body-sm truncate font-medium text-ink">{stripTicks(run.title)}</span>
          <IdCode id={run.id} className="hidden @[420px]:inline-flex" />
        </span>
        <span className="type-caption hidden w-[84px] shrink-0 items-center gap-1.5 text-ink-3 @[560px]:flex">
          <KindIcon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />
          <span className="truncate">{RUN_KIND_LABEL[run.kind]}</span>
        </span>
        <span className="hidden w-9 shrink-0 items-center gap-1 @[720px]:flex">
          {owner ?? (agent ? <AgentMark seed={agent.sigil} hue={agent.hue} size={16} label={agent.name} live={run.status === 'running'} /> : null)}
          {project && <MonogramMark text={project.name} hue={project.hue} size={16} label={project.name} />}
        </span>
        <span className="hidden w-[132px] shrink-0 overflow-hidden @[360px]:inline-flex">
          <StepTape run={run} size="sm" max={12} />
        </span>
        <span
          className={cn(
            'type-caption hidden min-w-0 flex-[2_1_0] truncate @[640px]:block',
            run.status === 'failed' ? 'text-fail-ink' : 'text-ink-3',
          )}
          title={line}
        >
          {line}
        </span>
        <span className="type-meta hidden w-12 shrink-0 text-right text-ink-3 @[480px]:block">{run.startedAt === undefined ? '—' : formatClock(elapsed)}</span>
        <span className="type-meta hidden w-[68px] shrink-0 text-right text-ink-3 @[820px]:block">{formatTok(tokens)}</span>
        {run.simulated ? (
          <Tooltip content="Estimated at reference pricing; no money was spent.">
            <span className="type-meta hidden w-[72px] shrink-0 text-right text-ink-3 @[900px]:block">{formatCost(run.usage.costUsd, { est: true })}</span>
          </Tooltip>
        ) : (
          <span className="type-meta hidden w-[72px] shrink-0 text-right text-ink-3 @[900px]:block">{formatCost(run.usage.costUsd)}</span>
        )}
      </div>
      {/* The SIM/LIVE tag never hides: hover actions open to its left. */}
      <span className="flex w-11 shrink-0 justify-start pr-2">
        <OriginBadge simulated={run.simulated} />
      </span>
      {actions.length > 0 && (
        <div
          className={cn(
            'absolute inset-y-1 right-11 flex items-center gap-0.5 rounded-sm pl-1',
            selected ? 'bg-press' : 'bg-hover',
            'opacity-0 transition-opacity duration-(--dur-2) ease-standard group-hover/run:opacity-100 group-focus-within/run:opacity-100',
            'pointer-coarse:hidden',
          )}
        >
          {actions.map((a) => (
            <IconButton key={a.key} icon={a.icon} label={a.label} size="xs" variant={a.danger ? 'danger' : 'ghost'} onClick={a.onSelect} />
          ))}
        </div>
      )}
      {actions.length > 0 && (
        <div className="hidden pr-1 pointer-coarse:flex">
          <Menu
            items={menu}
            placement="bottom-end"
            aria-label={`Actions for ${run.title}`}
            trigger={<IconButton icon={Ellipsis} label="Run actions" size="sm" tooltip={false} />}
          />
        </div>
      )}
    </div>
  )
}
