import { memo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'
import { SimBadge, Tooltip } from '@/ui'
import { ESTIMATE_TOOLTIP } from '@/app/components'
import { barShare } from './logic'

/**
 * A ranked bar list: the accessible form of a horizontal bar chart (§4.5: direct labels, exact
 * values in mono, simulated marks hatched and labeled). Every row drills into the runs behind it.
 */

export interface BreakdownItem {
  key: string
  label: ReactNode
  /** Plain-text name for the row's accessible label. */
  name: string
  leading?: ReactNode
  /** Drives the bar length. */
  value: number
  valueText: string
  /** The value is an estimate (simulated runs): `est.` with the reference-pricing tooltip. */
  estimate?: boolean
  detail?: ReactNode
  /** Simulated work: hatched bar (and a SIM tag when the list mixes live and simulated rows). */
  simulated?: boolean
  /** Drill-down target. */
  to?: string
}

export interface BreakdownProps {
  items: readonly BreakdownItem[]
  /** What the rows are, for screen readers ("Spend by model"). */
  label: string
  empty?: ReactNode
  /** Rows drawn (the rest are counted under the list). Default 8. */
  limit?: number
}

export function Breakdown({ items, label, empty, limit = 8 }: BreakdownProps) {
  if (!items.length) return <p className="type-body-sm py-8 text-center text-ink-3">{empty ?? 'Nothing in this period.'}</p>
  const shown = items.slice(0, limit)
  const max = Math.max(...items.map((i) => i.value))
  // A SIM tag on every row says nothing when every row is simulated (the card says it once).
  const mixed = items.some((i) => i.simulated) && items.some((i) => !i.simulated)
  return (
    <div>
      <ul aria-label={label} className="-mx-2 flex flex-col">
        {shown.map((item) => (
          <BreakdownRow key={item.key} item={item} max={max} tagSimulated={mixed} />
        ))}
      </ul>
      {items.length > shown.length && (
        <p className="type-meta mt-2 text-ink-3">
          +{items.length - shown.length} more · View as table
        </p>
      )}
    </div>
  )
}

const BreakdownRow = memo(function BreakdownRow({ item, max, tagSimulated }: { item: BreakdownItem; max: number; tagSimulated: boolean }) {
  const share = barShare(item.value, max)
  const valueNode = <span className="type-mono-sm shrink-0 text-ink tabular">{item.valueText}</span>
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {item.leading && <span className="flex shrink-0 items-center">{item.leading}</span>}
        <span className="type-body-sm shrink-0 truncate text-ink">{item.label}</span>
        {item.simulated && tagSimulated && <SimBadge size="xs" noTooltip />}
        {item.detail && <span className="type-meta min-w-0 truncate text-ink-3">{item.detail}</span>}
        <span className="flex-1" />
        {item.estimate ? <Tooltip content={ESTIMATE_TOOLTIP}>{valueNode}</Tooltip> : valueNode}
      </span>
      <span aria-hidden className="relative block h-2">
        {share > 0 && (
          <span
            className={cn(
              'absolute inset-y-0 left-0 rounded-[2px] transition-[width] duration-(--dur-3) ease-standard',
              item.simulated ? 'sim-hatch border border-dashed border-line-input' : 'bg-ink-2 group-hover/bd:bg-ink',
            )}
            style={{ width: `${share * 100}%` }}
          />
        )}
      </span>
    </>
  )
  const cls = 'group/bd flex min-h-11 flex-col justify-center gap-1.5 rounded-sm px-2 py-1.5 transition-colors duration-(--dur-1)'
  const aria = `${item.name}: ${item.estimate ? `${item.valueText}, estimated` : item.valueText}${item.simulated ? ', simulated' : ''}`
  return (
    <li>
      {item.to ? (
        <Link to={item.to} aria-label={`${aria}. Show these runs`} className={cn(cls, 'hover:bg-hover')}>
          {body}
        </Link>
      ) : (
        <div aria-label={aria} className={cls}>
          {body}
        </div>
      )}
    </li>
  )
})
