/**
 * Signature-component adapter for the shell. The signature track is replacing the stubs in
 * `@/ui/signature` while the shell is built; newer components (AtriumMark, StepTape, RunPill,
 * Receipt, ApprovalCardConnected, FAVICON_SVGS…) are resolved here at render time so the shell
 * keeps working before they land and picks them up the moment they do. Each fallback is a
 * minimal, spec-faithful rendering — never a restyle of an existing signature component.
 */
import type { ComponentType, ReactNode } from 'react'
import * as Signature from '@/ui/signature'
import type { Run, RunStatus, StepStatus } from '@/core/types'
import { useRow } from '@/core/db'
import { approve, reject } from '@/core/services/approvals'
import { cn } from '@/lib/cn'

const S = Signature as unknown as Record<string, unknown>

function component<P>(name: string): ComponentType<P> | undefined {
  const v = S[name]
  return typeof v === 'function' || (typeof v === 'object' && v !== null && '$$typeof' in v) ? (v as ComponentType<P>) : undefined
}

// ------------------------------------------------------------------------------------------------ mark

export type MarkState = 'idle' | 'working' | 'waiting'

/** AtriumMark (§5.4.1): circle = actors, capsule = the activity LED, square = things that last. */
export function Mark({ state, size = 'md', className }: { state: MarkState; size?: 'md' | 'lg'; className?: string }) {
  const Impl = component<{ state: MarkState; size?: 'md' | 'lg'; className?: string }>('AtriumMark')
  if (Impl) return <Impl state={state} size={size} className={className} />
  const w = size === 'lg' ? 63 : 42
  const h = size === 'lg' ? 24 : 16
  return (
    <svg width={w} height={h} viewBox="0 0 42 16" aria-hidden className={cn('shrink-0', className)}>
      <circle cx="5" cy="8" r="5" className="fill-ink-2" />
      <rect
        x="13"
        y="3"
        width="16"
        height="10"
        rx="5"
        className={cn(state === 'waiting' ? 'fill-attn' : state === 'working' ? 'fill-live atrium-mark-breathe' : 'fill-ink-3')}
      />
      <rect x="32" y="3" width="10" height="10" rx="2.5" className="fill-ink-2" />
    </svg>
  )
}

/** Favicon data URLs for idle / working / waiting (§5.4.1), from the signature track when available. */
export function faviconFor(state: MarkState): string {
  const fromSig = S.FAVICON_SVGS as Record<MarkState, string> | undefined
  if (fromSig && typeof fromSig[state] === 'string') return fromSig[state]
  const fill = state === 'waiting' ? '#e2ad45' : state === 'working' ? '#8fb1e6' : '#959289'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#121211"/><rect x="7" y="11" width="18" height="10" rx="5" fill="${fill}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// ------------------------------------------------------------------------------------------------ glyphs

const RUN_WORD: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  waiting: 'Needs you',
  paused: 'Paused',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
}

export function runStatusWord(status: RunStatus): string {
  return RUN_WORD[status]
}

/** 8px glyph in a 12px box (§5.3); the shape carries the meaning without color. */
export function RunGlyph({ status, className, label }: { status: RunStatus; className?: string; label?: string }) {
  const Impl = component<{ status: RunStatus; className?: string; label?: string }>('RunStatusGlyph')
  if (Impl) return <Impl status={status} className={className} label={label} />
  return <FallbackGlyph status={status} className={className} label={label ?? RUN_WORD[status]} />
}

function FallbackGlyph({ status, className, label }: { status: RunStatus | StepStatus; className?: string; label: string }) {
  const box = cn('relative inline-grid size-3 shrink-0 place-items-center', className)
  let inner: ReactNode
  switch (status) {
    case 'queued':
    case 'pending':
      inner = <span className="size-2 rounded-full border-[1.5px] border-ink-3" />
      break
    case 'running':
      inner = (
        <>
          <span className="atrium-mark-breathe absolute size-3 rounded-full bg-live/35" />
          <span className="relative size-2 rounded-full bg-live" />
        </>
      )
      break
    case 'waiting':
      inner = <span className="size-[7px] rotate-45 rounded-[1px] bg-attn" />
      break
    case 'paused':
      inner = (
        <span className="flex gap-[2px]">
          <span className="h-2 w-[2px] bg-ink-2" />
          <span className="h-2 w-[2px] bg-ink-2" />
        </span>
      )
      break
    case 'succeeded':
    case 'done':
      inner = (
        <svg viewBox="0 0 8 8" className="size-2 text-done" aria-hidden>
          <path d="M1 4.2 3.1 6.2 7 1.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
      break
    case 'failed':
      inner = (
        <svg viewBox="0 0 8 8" className="size-2 text-fail" aria-hidden>
          <path d="M1.5 1.5 6.5 6.5M6.5 1.5 1.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
      break
    case 'skipped':
      inner = <span className="h-[1.5px] w-2 bg-ink-4" />
      break
    default:
      inner = (
        <svg viewBox="0 0 8 8" className="size-2 text-ink-3" aria-hidden>
          <circle cx="4" cy="4" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
          <path d="M1.8 6.2 6.2 1.8" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      )
  }
  return (
    <span role="img" aria-label={label} className={box}>
      {inner}
    </span>
  )
}

/** Step status glyph (pending ○ · running ● · waiting ◆ · done ✓ · failed ✕ · skipped –). */
export function StepGlyph({ status, className }: { status: StepStatus; className?: string }) {
  const Impl = component<{ status: StepStatus; className?: string }>('StepStatusGlyph')
  if (Impl) return <Impl status={status} className={className} />
  return <FallbackGlyph status={status} className={className} label={status} />
}

// ------------------------------------------------------------------------------------------------ tape

export type TapeSize = 'pill' | 'inline' | 'scrubber'

/** StepTape (§5.4.2) — one cell per step, everywhere a run is referenced. */
export function Tape({ run, size = 'inline', maxCells, className }: { run: Run; size?: TapeSize; maxCells?: number; className?: string }) {
  const Impl = component<{ run: Run; size?: TapeSize; maxCells?: number; className?: string }>('StepTape')
  if (Impl) return <Impl run={run} size={size} maxCells={maxCells} className={className} />
  const planned = Math.max(run.steps.length, run.plannedSteps ?? 0)
  const active = run.status === 'running' || run.status === 'queued' || run.status === 'waiting' || run.status === 'paused'
  const total = planned + (active && !run.plannedSteps ? 1 : 0)
  const cells = Array.from({ length: total }, (_, i) => run.steps[i]?.status ?? 'pending')
  const limit = maxCells ?? (size === 'pill' ? 12 : 24)
  const hidden = Math.max(0, cells.length - limit)
  const shown = cells.slice(hidden)
  const dims = size === 'pill' ? 'h-2.5 w-1' : size === 'scrubber' ? 'h-4 w-2' : 'h-3 w-1.5'
  const done = run.steps.filter((s) => s.status === 'done').length
  return (
    <span role="img" aria-label={`Step ${Math.min(done + 1, total)} of ${total}`} className={cn('inline-flex items-end gap-0.5', className)}>
      {hidden > 0 && <span className="type-meta mr-0.5 text-ink-3">+{hidden}</span>}
      {shown.map((st, i) => (
        <span
          key={i}
          className={cn(
            'rounded-cell',
            dims,
            st === 'done' && 'bg-ink-3',
            st === 'running' && 'atrium-mark-breathe bg-live',
            st === 'waiting' && 'bg-attn',
            st === 'failed' && 'bg-fail',
            (st === 'pending' || st === 'skipped') && 'border border-line-input',
          )}
        />
      ))}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ connected pieces

/** A compact or full ApprovalCard wired to the approvals service (signature track). */
export function ConnectedApproval({ approvalId, variant = 'compact' }: { approvalId: string; variant?: 'compact' | 'full' }) {
  const Impl = component<{ approvalId: string; variant?: 'compact' | 'full' }>('ApprovalCardConnected')
  if (Impl) return <Impl approvalId={approvalId} variant={variant} />
  return <FallbackApproval approvalId={approvalId} variant={variant} />
}

function FallbackApproval({ approvalId, variant }: { approvalId: string; variant: 'compact' | 'full' }) {
  const approval = useRow('approvals', approvalId)
  const Card = Signature.ApprovalCard
  if (!approval) return null
  return <Card approval={approval} variant={variant} onApprove={(note) => approve(approval.id, note)} onReject={(note) => reject(approval.id, note)} />
}

/** Is a component from the signature track available yet? */
export function hasSignature(name: string): boolean {
  return !!component(name)
}

/** Shell-local keyframes for the fallbacks (breathing at --dur-breathe; static under reduced motion). */
export function SigStyles() {
  return (
    <style href="atrium-shell-sig" precedence="default">{`
@keyframes atrium-mark-breathe { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
.atrium-mark-breathe { animation: atrium-mark-breathe var(--dur-breathe, 1600ms) ease-in-out infinite; }
html[data-motion='reduce'] .atrium-mark-breathe { animation: none !important; }
@media (prefers-reduced-motion: reduce) { html:not([data-motion='full']) .atrium-mark-breathe { animation: none !important; } }
`}</style>
  )
}
