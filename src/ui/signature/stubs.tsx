/**
 * CONTRACT STUBS for signature components — minimal renderings with the final props.
 * Replaced by the signature track (keep every prop; implementations will change).
 */
import type { ReactNode } from 'react'
import type {
  Approval, EntityKind, EntityRef, Hue, ID, Run, RunStatus, StepKind, StepStatus, Usage,
} from '@/core/types'
import { useEntity, entityRoute } from '@/core/services/entities'
import { cn } from '@/lib/cn'

export type SignalTone = 'live' | 'attn' | 'done' | 'fail' | 'neutral'

export interface AgentMarkProps { seed: number; hue: Hue; size?: number; live?: boolean; label?: string; shape?: 'square' | 'circle'; className?: string }
export function AgentMark({ hue, size = 24, label, className }: AgentMarkProps) {
  return <span role="img" aria-label={label} className={cn('inline-block rounded-xs', className)} style={{ width: size, height: size, background: `var(--hue-${hue})` }} />
}

export interface MonogramMarkProps { text: string; hue: Hue; size?: number; className?: string }
export function MonogramMark({ text, hue, size = 24, className }: MonogramMarkProps) {
  return <span className={cn('inline-flex items-center justify-center rounded-xs text-2xs font-semibold', className)} style={{ width: size, height: size, color: `var(--hue-${hue})` }}>{text}</span>
}

export interface LiveIndicatorProps { tone?: SignalTone; size?: 'xs' | 'sm' | 'md'; pulsing?: boolean; label?: string; className?: string }
export function LiveIndicator({ label, className }: LiveIndicatorProps) {
  return <span role={label ? 'status' : undefined} aria-label={label} className={cn('inline-block size-2 rounded-full bg-live', className)} />
}

export interface StatusDotProps { tone: SignalTone | 'sim'; className?: string }
export function StatusDot({ className }: StatusDotProps) {
  return <span className={cn('inline-block size-1.5 rounded-full bg-ink-3', className)} />
}

export interface RunStatusBadgeProps { status: RunStatus; size?: 'sm' | 'md'; className?: string }
export function RunStatusBadge({ status, className }: RunStatusBadgeProps) {
  return <span className={cn('text-xs text-ink-2', className)}>{status}</span>
}

export interface StepIconProps { kind: StepKind; status: StepStatus; className?: string }
export function StepIcon({ className }: StepIconProps) {
  return <span className={cn('inline-block size-3 rounded-full border border-line-strong', className)} />
}

export function MetaLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('font-mono text-2xs uppercase tracking-wider text-ink-3', className)}>{children}</span>
}

export interface IdCodeProps { id: string; label?: string; className?: string }
export function IdCode({ id, className }: IdCodeProps) {
  return <code className={cn('font-mono text-2xs text-ink-3', className)}>{id}</code>
}

export interface SimBadgeProps { size?: 'xs' | 'sm'; label?: string; explanation?: string; className?: string }
export function SimBadge({ label = 'Simulated', className }: SimBadgeProps) {
  return <span className={cn('sim-hatch rounded-xs px-1 text-2xs text-sim-ink', className)}>{label}</span>
}

export function LiveBadge({ className }: { size?: 'xs' | 'sm'; className?: string }) {
  return <span className={cn('rounded-xs px-1 text-2xs text-live-ink', className)}>Live</span>
}

export interface ProvenanceLineProps { modelLabel?: string; simulated?: boolean; usage?: Usage; durationMs?: number; costIsEstimate?: boolean; extra?: ReactNode; className?: string }
export function ProvenanceLine({ modelLabel, simulated, className }: ProvenanceLineProps) {
  return <div className={cn('text-2xs text-ink-3', className)}>{modelLabel}{simulated ? ' · Simulated' : ''}</div>
}

export interface RunMetaProps { run: Run; showModel?: boolean; className?: string }
export function RunMeta({ run, className }: RunMetaProps) {
  return <div className={cn('text-2xs text-ink-3', className)}>{run.id}</div>
}

export interface RunTimelineProps {
  run: Run
  approvals?: Record<ID, Approval>
  onApprove?: (approvalId: ID, note?: string) => void | Promise<void>
  onReject?: (approvalId: ID, note?: string) => void | Promise<void>
  renderRef?: (ref: EntityRef) => ReactNode
  compact?: boolean
  defaultExpanded?: 'all' | 'active' | 'none'
  className?: string
}
export function RunTimeline({ run, className }: RunTimelineProps) {
  return (
    <ol className={cn('flex flex-col gap-1', className)}>
      {run.steps.map((s) => (
        <li key={s.id} className="text-sm">{s.title} — {s.status}</li>
      ))}
    </ol>
  )
}

export interface ApprovalCardProps {
  approval: Approval
  requester?: { name: string; mark?: ReactNode }
  variant?: 'compact' | 'full'
  onApprove?: (note?: string) => void | Promise<void>
  onReject?: (note?: string) => void | Promise<void>
  className?: string
}
export function ApprovalCard({ approval, onApprove, onReject, className }: ApprovalCardProps) {
  return (
    <div className={cn('rounded-sm border border-line p-3', className)}>
      <div className="text-sm">{approval.title}</div>
      {approval.status === 'pending' && (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => void onApprove?.()}>Approve</button>
          <button type="button" onClick={() => void onReject?.()}>Reject</button>
        </div>
      )}
    </div>
  )
}

export interface EntityChipProps { entity: EntityRef; size?: 'sm' | 'md'; variant?: 'default' | 'subtle' | 'outline'; onRemove?: () => void; noHoverCard?: boolean; noLink?: boolean; showKind?: boolean; className?: string }
export function EntityChip({ entity, onRemove, className }: EntityChipProps) {
  const e = useEntity(entity)
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-xs border border-line px-1.5 text-xs', className)}>
      <a href={entityRoute(entity)}>{e.title}</a>
      {onRemove && <button type="button" aria-label="Remove" onClick={onRemove}>×</button>}
    </span>
  )
}

export function EntityIcon({ className }: { kind: EntityKind; size?: number; className?: string }) {
  return <span className={cn('inline-block size-3', className)} />
}
