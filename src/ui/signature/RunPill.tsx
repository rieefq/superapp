import type { MouseEvent, ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowUpRight, PanelRight, Pause, Play, Square } from 'lucide-react'
import type { Hue, Run } from '@/core/types'
import { isRunActive } from '@/core/types'
import { cn } from '@/lib/cn'
import { useReducedMotion } from '@/ui/hooks'
import { Button, HoverCard } from '@/ui/primitives'
import { useNow } from './clock'
import { formatClock } from './format'
import { RUN_STATUS_META } from './glyphMeta'
import { RunStatusGlyph, StepStatusGlyph } from './glyphs'
import { AgentMark, MonogramMark } from './marks'
import { StepTape } from './StepTape'
import { computeTape, currentStepIndex, tapeProgress } from './tape'
import { stepTitle, stripTicks } from './tense'

export interface RunOwner {
  name: string
  hue: Hue
  sigil: number
}

export interface RunProjectInfo {
  name: string
  hue: Hue
}

/** Elapsed time of a run: live while active, final once it ended. */
export function useRunElapsed(run: Pick<Run, 'status' | 'startedAt' | 'endedAt' | 'createdAt'>): number {
  const active = run.status === 'running' || run.status === 'waiting'
  const now = useNow(active)
  const start = run.startedAt ?? run.createdAt
  if (run.endedAt !== undefined) return Math.max(0, run.endedAt - start)
  if (!active) return run.startedAt ? Math.max(0, Date.now() - start) : 0
  return Math.max(0, now - start)
}

export interface RunPillProps {
  run: Run
  /** The agent that owns the run (draws a 14px AgentMark). */
  agent?: RunOwner
  /** The run's project; with `otherProject` a 12px mark shows and the pill dims to 60%. */
  project?: RunProjectInfo
  otherProject?: boolean
  /** Click: attach the run (Inspector › Run). */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** ⌘/Ctrl-click: open the run in its workspace. */
  onOpen?: () => void
  /** Peek card shown after a 300ms hover (320px). */
  peek?: ReactNode
  className?: string
}

/**
 * Run Line pill (docs/DESIGN.md §5.4.3): a 20px capsule with glyph · agent · title · mini tape ·
 * "3/7 · 01:24". Waiting pills get an attn outline and "wants approval"; failed pills stay red.
 * Enters at 240ms (scale 0.96 → 1, fade) and collapses on exit when rendered in AnimatePresence.
 */
export function RunPill({ run, agent, project, otherProject, onClick, onOpen, peek, className }: RunPillProps) {
  const reduced = useReducedMotion()
  const elapsed = useRunElapsed(run)
  const waiting = run.status === 'waiting'
  const failed = run.status === 'failed'
  const tape = computeTape(run)
  const word = RUN_STATUS_META[run.status].word
  const meta = waiting ? 'wants approval' : `${tapeProgress(run)} · ${formatClock(elapsed)}`
  const name = `${agent ? `${agent.name}: ` : ''}${stripTicks(run.title)}. ${word}. ${tape.label}${otherProject && project ? `. In ${project.name}` : ''}`

  const pill = (
    <motion.button
      type="button"
      layout={reduced ? false : 'position'}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: otherProject ? 0.6 : 1, scale: 1 }}
      exit={reduced ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, width: 0, paddingLeft: 0, paddingRight: 0, marginLeft: 0, marginRight: 0, borderWidth: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
      onClick={(e) => {
        if ((e.metaKey || e.ctrlKey) && onOpen) {
          e.preventDefault()
          onOpen()
          return
        }
        onClick?.(e)
      }}
      aria-label={name}
      data-status={run.status}
      className={cn(
        'group/pill relative inline-flex h-5 max-w-[340px] shrink-0 items-center gap-1.5 overflow-hidden rounded-full border px-2 whitespace-nowrap',
        'text-ink transition-[background-color,border-color] duration-(--dur-1) ease-standard hover:bg-hover active:bg-press',
        'focus-visible:outline-offset-1',
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-3 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
        waiting ? 'border-attn' : failed ? 'border-fail' : 'border-line-strong',
        className,
      )}
    >
      <RunStatusGlyph status={run.status} decorative />
      {otherProject && project && <MonogramMark text={project.name} hue={project.hue} size={12} />}
      {agent && <AgentMark seed={agent.sigil} hue={agent.hue} size={14} live={false} />}
      <span className="max-w-[160px] min-w-0 truncate text-xs leading-4 font-medium">{stripTicks(run.title)}</span>
      {isRunActive(run.status) || failed ? <StepTape run={run} size="xs" max={12} label={tape.label} className="mx-0.5" /> : null}
      <span className={cn('type-meta shrink-0', waiting ? 'text-attn-ink' : failed ? 'text-fail-ink' : 'text-ink-3')}>{meta}</span>
    </motion.button>
  )
  if (!peek) return pill
  return (
    <HoverCard content={peek} openDelay={300} placement="top-start" className="w-80 p-0">
      {pill}
    </HoverCard>
  )
}

export interface RunPeekProps {
  run: Run
  agent?: RunOwner
  project?: RunProjectInfo
  onAttach?: () => void
  onOpen?: () => void
  onPause?: () => void
  onResume?: () => void
  onStop?: () => void
  className?: string
}

/**
 * The Run Line peek card body (320px, §3.6): current step and detail, the last 3 steps, the tape,
 * and Attach · Open · Pause/Resume · Stop. Pass it to RunPill's `peek`.
 */
export function RunPeek({ run, agent, project, onAttach, onOpen, onPause, onResume, onStop, className }: RunPeekProps) {
  const elapsed = useRunElapsed(run)
  const i = currentStepIndex(run.steps, run.status)
  const current = i >= 0 ? run.steps[i] : undefined
  const recent = run.steps.slice(Math.max(0, i - 3), Math.max(0, i)).reverse()
  const active = run.status === 'running' || run.status === 'waiting' || run.status === 'queued' || run.status === 'paused'
  return (
    <div className={cn('flex w-80 max-w-[calc(100vw-24px)] flex-col', className)}>
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex min-w-0 items-center gap-2">
          <RunStatusGlyph status={run.status} />
          {agent && <AgentMark seed={agent.sigil} hue={agent.hue} size={16} />}
          <span className="type-body-sm min-w-0 flex-1 truncate font-medium text-ink">{stripTicks(run.title)}</span>
          {project && <MonogramMark text={project.name} hue={project.hue} size={14} label={project.name} />}
        </div>
        {current && (
          <div className="flex flex-col gap-0.5">
            <span className={cn('type-body-sm font-medium', current.status === 'running' ? 'text-live-ink' : current.status === 'waiting' ? 'text-attn-ink' : 'text-ink')}>
              {stripTicks(stepTitle(current.title, run.status === 'paused' ? 'pending' : current.status))}
            </span>
            {(current.detail || current.error) && (
              <span className={cn('type-caption line-clamp-2', current.error ? 'text-fail-ink' : 'text-ink-2')}>{current.error ?? current.detail}</span>
            )}
          </div>
        )}
        {recent.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="Previous steps">
            {recent.map((s) => (
              <li key={s.id} className="type-caption flex min-w-0 items-center gap-2 text-ink-3">
                <StepStatusGlyph status={s.status} context="timeline" />
                <span className="truncate">{stripTicks(stepTitle(s.title, s.status))}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center justify-between gap-3">
          <StepTape run={run} size="sm" max={22} />
          <span className="type-meta shrink-0 text-ink-3">
            {tapeProgress(run)} · {formatClock(elapsed)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 border-t border-line px-2 py-1.5">
        {onAttach && (
          <Button size="xs" variant="ghost" leadingIcon={PanelRight} onClick={onAttach}>
            Attach
          </Button>
        )}
        {onOpen && (
          <Button size="xs" variant="ghost" leadingIcon={ArrowUpRight} onClick={onOpen}>
            Open
          </Button>
        )}
        <span className="flex-1" />
        {run.status === 'paused' && onResume && (
          <Button size="xs" variant="ghost" leadingIcon={Play} onClick={onResume}>
            Resume
          </Button>
        )}
        {(run.status === 'running' || run.status === 'queued') && onPause && (
          <Button size="xs" variant="ghost" leadingIcon={Pause} onClick={onPause}>
            Pause
          </Button>
        )}
        {active && onStop && (
          <Button size="xs" variant="danger" leadingIcon={Square} onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
    </div>
  )
}
