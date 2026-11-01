import type { ReactNode } from 'react'
import type { IntegrationStatus } from '@/core/services/integrations'
import type { Hue, IntegrationDef, RiskLevel } from '@/core/types'
import { HUES } from '@/core/types'
import { cn } from '@/lib/cn'
import { LiveBadge, MonogramMark, RISK_LABEL, SimBadge, StatusGlyph } from '@/ui'
import { STATUS_SPEC } from './logic'

/*
 * Small shared parts of the Integrations workspace: identity marks (ring monogram, dashed when
 * simulated · the hatched Simulator ring), status glyphs and chips, the LIVE / SIMULATED badge,
 * the risk chip and the section header (Home's rhythm: 28px row, `label` kicker, mono count).
 */

const asHue = (h: string): Hue => ((HUES as readonly string[]).includes(h) ? (h as Hue) : 'sky')

/** The integration's ring monogram (§5.4.7): no third-party logos; dashed when simulated. */
export function IntegrationMark({ def, size = 32, label }: { def: IntegrationDef; size?: number; label?: string }) {
  return <MonogramMark variant="ring" text={def.monogram} hue={asHue(def.hue)} size={size} simulated={def.support === 'simulated'} label={label} />
}

/** The Simulator's mark: a hatched disc with a dashed ring — simulated by construction. */
export function SimulatorMark({ size = 32 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="sim-hatch relative inline-grid shrink-0 place-items-center rounded-full border border-dashed border-line-input"
      style={{ width: size, height: size }}
    >
      <span className="type-meta-caps rounded-xs bg-sim-tint px-0.5 leading-none text-sim-ink" style={{ fontSize: Math.max(8, Math.round(size * 0.28)) }}>
        SIM
      </span>
    </span>
  )
}

/** LIVE for real network paths, SIMULATED for local emulation (cards and headers, §8.4). */
export function ModeBadge({ support, short }: { support: IntegrationDef['support']; short?: boolean }) {
  return support === 'live' ? (
    <LiveBadge size="xs" explanation="Live: Atrium makes real requests to this service from your browser." />
  ) : (
    <SimBadge
      size="xs"
      label={short ? 'SIM' : 'SIMULATED'}
      explanation="Simulated — nothing leaves your browser. Atrium emulates this service locally and labels everything it does."
    />
  )
}

/** The status glyph alone (decorative when a word sits next to it). */
export function StatusMark({ status, size = 12, decorative = true }: { status: IntegrationStatus | 'always'; size?: number; decorative?: boolean }) {
  const spec = STATUS_SPEC[status]
  return <StatusGlyph shape={spec.shape} tone={spec.tone} live={spec.live} size={size} word={spec.word} decorative={decorative} />
}

const CHIP_TONE: Record<string, string> = {
  'ink-2': 'bg-hover text-ink-2',
  'ink-3': 'bg-hover text-ink-2',
  live: 'bg-live-tint text-live-ink',
  fail: 'bg-fail-tint text-fail-ink',
}

/** Status chip for the stage header: glyph + word on a quiet tint (rounded: a connection is a thing that lasts). */
export function StatusChip({ status, word }: { status: IntegrationStatus | 'always'; word?: string }) {
  const spec = STATUS_SPEC[status]
  return (
    <span
      data-status={status}
      className={cn('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-sm pr-2 pl-1.5 text-xs leading-none font-medium whitespace-nowrap', CHIP_TONE[spec.tone])}
    >
      <StatusMark status={status} />
      {word ?? spec.word}
    </span>
  )
}

const RISK_CHIP: Record<RiskLevel, string> = {
  low: 'border-line-strong text-ink-3',
  medium: 'border-line-input text-ink-2',
  high: 'border-fail/50 text-fail-ink',
}

const RISK_WORD: Record<RiskLevel, string> = { low: 'Low risk', medium: 'Medium risk', high: 'High risk' }

/** LOW · MED · HIGH, as on the ApprovalCard (HIGH in fail ink). */
export function RiskChip({ risk }: { risk: RiskLevel }) {
  return (
    <span
      role="img"
      aria-label={RISK_WORD[risk]}
      className={cn('type-meta-caps inline-flex h-4 shrink-0 items-center rounded-xs border px-1 text-[10px]', RISK_CHIP[risk])}
    >
      <span aria-hidden>{RISK_LABEL[risk]}</span>
    </span>
  )
}

/** A section header in Home's rhythm: `label` kicker, mono count, optional action on the right. */
export function SectionHead({ id, title, count, action, className }: { id: string; title: string; count?: number | string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex h-7 min-w-0 items-center gap-2', className)}>
      <h2 id={id} className="type-label text-ink-3">
        {title}
      </h2>
      {count !== undefined && count !== 0 && <span className="type-meta text-ink-3 tabular">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

/** A label/value row in the ReadBack grammar (`label` kicker column, mono-sm value). */
export function KeyRow({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[128px_minmax(0,1fr)] items-baseline gap-x-3 py-1', className)}>
      <dt className="type-label pt-px text-ink-3">{label}</dt>
      <dd className="type-mono-sm min-w-0 break-words text-ink">{children}</dd>
    </div>
  )
}
