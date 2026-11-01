import { useLocation } from 'react-router'
import { workspaceForPath } from '@/app/registry'
import { useShellStore } from '@/app/shell/store'
import { cn } from '@/lib/cn'
import { Tooltip } from '@/ui'
import { formatTokenCount, formatWindow } from './tokens'

export interface ContextMeterProps {
  /** Estimated tokens the action will send (context + draft). */
  tokens: number
  /** The model's context window. */
  window: number
  /** Model label for the tooltip ("Simulator · Swift"). */
  modelLabel?: string
  /** Click handler; defaults to opening Inspector › Context for the current workspace. */
  onOpen?: () => void
  /** Surface the meter sits on (the tick notches are cut in this color). Default 'raised' (the composer). */
  surface?: 'raised' | 'overlay' | 'canvas'
  className?: string
}

const NOTCH = { raised: 'bg-raised', overlay: 'bg-overlay', canvas: 'bg-canvas' } as const

/** Fill level of the meter: ok, attention at ≥80%, over above 100% (§5.4.10). */
export function meterLevel(tokens: number, window: number): 'ok' | 'attn' | 'over' {
  if (window <= 0) return 'ok'
  const r = tokens / window
  return r > 1 ? 'over' : r >= 0.8 ? 'attn' : 'ok'
}

export const OVER_WINDOW_REASON = 'Over this model’s context window. Remove items or switch model.'

/** Open Inspector › Context in the workspace that owns the current route. */
export function useOpenContextInspector(): () => void {
  const { pathname } = useLocation()
  return () => {
    const ws = workspaceForPath(pathname).id
    useShellStore.getState().setInspector(ws, { open: true, tab: 'context' })
  }
}

/**
 * ContextMeter (§5.4.10): a 72×6 tick track with `~3.2k / 200k` in type-meta. Ink-2 fill; attn at ≥80%;
 * fail above 100% (the host disables Send and shows OVER_WINDOW_REASON). Click → Inspector › Context.
 */
export function ContextMeter({ tokens, window, modelLabel, onOpen, surface = 'raised', className }: ContextMeterProps) {
  const openInspector = useOpenContextInspector()
  const level = meterLevel(tokens, window)
  const ratio = window > 0 ? Math.min(1, tokens / window) : 0
  // Never show an empty track for a non-empty context: at least a sliver.
  const pct = tokens > 0 ? Math.max(ratio * 100, 2) : 0
  const reading = `${formatTokenCount(tokens)} / ${formatWindow(window)}`
  const label = `Context ${formatTokenCount(tokens)} of ${formatWindow(window)} tokens${level === 'over' ? ', over the limit' : ''}. Open the context breakdown`
  return (
    <Tooltip
      content={
        <span className="flex flex-col gap-0.5">
          <span>
            {formatTokenCount(tokens)} tok est. of {modelLabel ? `${modelLabel}’s ` : 'the '}
            {formatWindow(window)} window
          </span>
          <span className="opacity-70">Open the context breakdown</span>
        </span>
      }
    >
      <button
        type="button"
        aria-label={label}
        onClick={onOpen ?? openInspector}
        data-level={level}
        className={cn(
          'group/meter inline-flex h-7 shrink-0 items-center gap-2 rounded-sm px-1.5 transition-colors duration-(--dur-1) ease-standard hover:bg-hover',
          className,
        )}
      >
        <span aria-hidden className="relative block h-1.5 w-[72px] overflow-hidden rounded-[1px] bg-line">
          <span
            className={cn(
              'absolute inset-y-0 left-0 transition-[width,background-color] duration-(--dur-2) ease-standard',
              level === 'over' ? 'bg-fail' : level === 'attn' ? 'bg-attn' : 'bg-ink-2',
            )}
            style={{ width: `${pct}%` }}
          />
          {/* 10 ticks: hairline notches every 10% (the tick-scale motif). */}
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={cn('absolute inset-y-0 w-px', NOTCH[surface])} style={{ left: `${(i + 1) * 10}%` }} />
          ))}
        </span>
        <span
          className={cn(
            'type-meta whitespace-nowrap',
            level === 'over' ? 'text-fail-ink' : level === 'attn' ? 'text-attn-ink' : 'text-ink-3 group-hover/meter:text-ink-2',
          )}
        >
          {reading}
        </span>
      </button>
    </Tooltip>
  )
}
