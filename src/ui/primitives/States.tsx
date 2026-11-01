import { useId, useState, type HTMLAttributes, type ReactNode } from 'react'
import { ChevronRight, RefreshCw, TriangleAlert, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export interface EmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon
  /** Replaces the icon tile (custom art). */
  illustration?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Inline row layout for small containers (panels, lists). */
  compact?: boolean
  /** Dashed hairline frame (drop zones, empty canvases). */
  bordered?: boolean
}

/** Nothing here yet — explains what goes here and offers the next step. Serif title, quiet copy. */
export function EmptyState({ icon: Icon, illustration, title, description, actions, compact, bordered, className, ...props }: EmptyStateProps) {
  const mark =
    illustration ??
    (Icon && (
      <div
        aria-hidden
        className={cn(
          'grid shrink-0 place-items-center rounded-md border border-line bg-raised text-ink-3 shadow-inset',
          compact ? 'size-9' : 'size-11',
        )}
      >
        <Icon className={compact ? 'size-4' : 'size-5'} strokeWidth={1.5} />
      </div>
    ))
  if (compact) {
    return (
      <div className={cn('flex items-start gap-3 p-4', bordered && 'rounded-md border border-dashed border-line-strong', className)} {...props}>
        {mark}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-serif text-lg leading-6 text-ink">{title}</h3>
          {description && <p className="text-sm text-ink-3 text-pretty">{description}</p>}
          {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
        </div>
      </div>
    )
  }
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-5 px-6 py-14 text-center',
        bordered && 'rounded-lg border border-dashed border-line-strong',
        className,
      )}
      {...props}
    >
      {mark}
      <div className="flex max-w-sm flex-col items-center gap-1.5">
        <h3 className="font-serif text-xl leading-7 text-ink text-balance">{title}</h3>
        {description && <p className="text-sm text-ink-3 text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  )
}

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode
  /** Human message: what failed and what it means. */
  message?: ReactNode
  /** Technical details (stack, response body) behind a disclosure. */
  details?: string
  onRetry?: () => void
  retrying?: boolean
  retryLabel?: string
  /** Extra actions next to Retry. */
  actions?: ReactNode
  compact?: boolean
}

/** Something failed — say what, offer Retry, keep technical details one click away. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  details,
  onRetry,
  retrying,
  retryLabel = 'Try again',
  actions,
  compact,
  className,
  ...props
}: ErrorStateProps) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  return (
    <div
      role="alert"
      className={cn(
        'flex',
        compact ? 'items-start gap-3 rounded-md border border-fail/30 bg-fail-tint/40 p-3.5' : 'flex-col items-center gap-4 px-6 py-12 text-center',
        className,
      )}
      {...props}
    >
      <div
        aria-hidden
        className={cn('grid shrink-0 place-items-center rounded-md text-fail-ink', compact ? 'size-7 bg-fail-tint' : 'size-11 bg-fail-tint')}
      >
        <TriangleAlert className={compact ? 'size-4' : 'size-5'} strokeWidth={1.75} />
      </div>
      <div className={cn('flex min-w-0 flex-col gap-1', compact ? 'flex-1' : 'max-w-md items-center')}>
        <h3 className={cn('font-medium text-ink', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {message && <p className="text-sm text-ink-3 text-pretty">{message}</p>}
        {(onRetry || actions || details) && (
          <div className={cn('mt-2.5 flex flex-wrap items-center gap-2', !compact && 'justify-center')}>
            {onRetry && (
              <Button size="sm" variant="secondary" leadingIcon={RefreshCw} loading={retrying} onClick={onRetry}>
                {retryLabel}
              </Button>
            )}
            {actions}
            {details && (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={open}
                aria-controls={detailsId}
                onClick={() => setOpen((o) => !o)}
                leadingIcon={ChevronRight}
                className={cn('[&_svg]:transition-transform [&_svg]:duration-(--dur-2)', open && '[&_svg]:rotate-90')}
              >
                Details
              </Button>
            )}
          </div>
        )}
        {details && open && (
          <pre
            id={detailsId}
            className="mt-2 max-h-56 w-full overflow-auto rounded-sm border border-line bg-sunken p-3 text-left font-mono text-2xs leading-4 whitespace-pre-wrap text-ink-2"
          >
            {details}
          </pre>
        )}
      </div>
    </div>
  )
}
