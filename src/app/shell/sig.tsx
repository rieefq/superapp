/**
 * Thin shell-side names for the signature components (`@/ui` signature kit), so the shell's call
 * sites stay small and consistent. No restyling happens here — every component is the signature one.
 */
import {
  AtriumMark,
  ApprovalCardConnected,
  FAVICON_SVGS,
  RUN_STATUS_META,
  RunStatusGlyph,
  StepStatusGlyph,
  StepTape,
  type AtriumMarkState,
} from '@/ui'
import type { Run, RunStatus, StepStatus } from '@/core/types'

export type MarkState = AtriumMarkState

/** The Atrium mark (§5.4.1) — its capsule is the activity LED. */
export function Mark({ state, size = 'md', className }: { state: MarkState; size?: 'md' | 'lg'; className?: string }) {
  return <AtriumMark state={state} size={size === 'lg' ? 'lg' : 'sm'} className={className} />
}

/** Favicon data URL for idle / working / waiting. */
export function faviconFor(state: MarkState): string {
  return FAVICON_SVGS[state]
}

/** The user-facing word for a run status (Queued · Running · Needs you · Paused · Done · Failed · Stopped). */
export function runStatusWord(status: RunStatus): string {
  return RUN_STATUS_META[status].word
}

export function RunGlyph({ status, className, label, decorative }: { status: RunStatus; className?: string; label?: string; decorative?: boolean }) {
  return <RunStatusGlyph status={status} className={className} label={label} decorative={decorative} />
}

export function StepGlyph({ status, className }: { status: StepStatus; className?: string }) {
  return <StepStatusGlyph status={status} context="timeline" className={className} />
}

export type TapeSize = 'pill' | 'inline' | 'scrubber'
const TAPE_SIZE = { pill: 'xs', inline: 'sm', scrubber: 'md' } as const

/** StepTape (§5.4.2): pill 4×10 · inline 6×12 · scrubber 8×16 (interactive in the Inspector). */
export function Tape({
  run,
  size = 'inline',
  maxCells,
  className,
  interactive,
  selectedStepId,
  onSelectStep,
}: {
  run: Run
  size?: TapeSize
  maxCells?: number
  className?: string
  interactive?: boolean
  selectedStepId?: string
  onSelectStep?: (stepId: string, index: number) => void
}) {
  return (
    <StepTape
      run={run}
      size={TAPE_SIZE[size]}
      max={maxCells}
      className={className}
      interactive={interactive}
      selectedStepId={selectedStepId}
      onSelectStep={onSelectStep}
    />
  )
}

/** A compact or full ApprovalCard wired to the approvals service. */
export function ConnectedApproval({ approvalId, variant = 'compact', onLater }: { approvalId: string; variant?: 'compact' | 'full'; onLater?: () => void }) {
  return <ApprovalCardConnected approvalId={approvalId} variant={variant} onLater={onLater} />
}

/** Shell-local motion classes (breathing badges), static under reduced motion. */
export function SigStyles() {
  return (
    <style href="atrium-shell-sig" precedence="default">{`
@keyframes atrium-mark-breathe { 0%, 100% { opacity: 1 } 50% { opacity: 0.55 } }
.atrium-mark-breathe { animation: atrium-mark-breathe var(--dur-breathe, 1600ms) ease-in-out infinite; }
html[data-motion='reduce'] .atrium-mark-breathe { animation: none !important; box-shadow: 0 0 0 1px var(--live) !important; }
@media (prefers-reduced-motion: reduce) { html:not([data-motion='full']) .atrium-mark-breathe { animation: none !important; } }
`}</style>
  )
}
