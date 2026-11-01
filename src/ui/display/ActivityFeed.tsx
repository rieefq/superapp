import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatDateTime, formatTime, timeAgo } from '@/lib/format'
import { groupByDay } from './logic'
import { SkeletonBar } from './internal'

export interface ActivityItem {
  id: string
  /** Epoch ms. */
  at: number
  actor: { label: string; mark?: ReactNode }
  /** What happened, e.g. "merged" / "approved the plan for". */
  summary: ReactNode
  /** The object acted on (a link, chip…). */
  target?: ReactNode
  /** Optional trailing detail line. */
  detail?: ReactNode
}

export interface ActivityFeedProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: readonly ActivityItem[]
  /** Single-line rows without the timeline rail. */
  compact?: boolean
  /** Group under "Today", "Yesterday"… headers (default on). */
  groupByDay?: boolean
  /** Clock override (tests, stories). */
  now?: number
  loading?: boolean
  empty?: ReactNode
}

function initials(label: string): string {
  const parts = label.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')).toUpperCase() || '?'
}

function DefaultMark({ label, compact }: { label: string; compact: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-xs bg-press font-mono font-medium text-ink-2',
        compact ? 'size-4 text-[9px]' : 'size-5 text-[10px]',
      )}
    >
      {initials(label)}
    </span>
  )
}

/** Chronological activity grouped by day, with relative times today and clock times before. */
export function ActivityFeed({ items, compact = false, groupByDay: grouped = true, now, loading = false, empty, className, ...props }: ActivityFeedProps) {
  const clock = now ?? Date.now()
  if (loading && items.length === 0) {
    return (
      <div className={cn('flex flex-col gap-4 py-1', className)} aria-busy {...props}>
        {Array.from({ length: compact ? 5 : 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBar className={cn('rounded-xs', compact ? 'size-4' : 'size-5')} />
            <SkeletonBar className="h-2.5 flex-1" style={{ maxWidth: `${60 + ((i * 17) % 30)}%` }} />
          </div>
        ))}
      </div>
    )
  }
  if (items.length === 0) {
    return (
      <div className={cn('py-8 text-center text-sm text-ink-3', className)} {...props}>
        {empty ?? 'No activity yet.'}
      </div>
    )
  }
  const groups = grouped ? groupByDay(items, clock) : [{ key: 'all', label: '', items: [...items].sort((a, b) => b.at - a.at) }]
  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-5', className)} {...props}>
      {groups.map((g) => {
        const isToday = g.label === 'Today'
        return (
          <section key={g.key} aria-label={g.label || 'Activity'}>
            {g.label && (
              <h3 className="mb-1.5 font-mono text-2xs font-medium tracking-[0.08em] text-ink-3 uppercase">{g.label}</h3>
            )}
            <ol className="relative">
              {!compact && g.items.length > 1 && (
                <span aria-hidden className="absolute top-4 bottom-4 left-2.5 w-px -translate-x-1/2 bg-line" />
              )}
              {g.items.map((item) => {
                const time = isToday || !grouped ? timeAgo(item.at, clock) : formatTime(item.at)
                return (
                  <li
                    key={item.id}
                    className={cn('relative flex gap-3', compact ? 'min-h-7 items-center py-0.5' : 'items-start py-1.5')}
                  >
                    <span className={cn('relative z-[1] flex bg-canvas', !compact && 'mt-px')}>
                      {item.actor.mark ?? <DefaultMark label={item.actor.label} compact={compact} />}
                    </span>
                    <div className={cn('min-w-0 flex-1', compact ? 'truncate text-sm' : 'text-sm leading-5')}>
                      <span className="font-medium text-ink">{item.actor.label}</span>{' '}
                      <span className="text-ink-2">{item.summary}</span>
                      {item.target != null && <> {item.target}</>}
                      {!compact && item.detail != null && <div className="mt-0.5 text-xs text-ink-3">{item.detail}</div>}
                    </div>
                    <time
                      dateTime={new Date(item.at).toISOString()}
                      title={formatDateTime(item.at)}
                      className={cn('shrink-0 text-xs text-ink-4 tabular', !compact && 'pt-px')}
                    >
                      {time}
                    </time>
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
