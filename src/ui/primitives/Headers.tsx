import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Mono uppercase system label ("RUNS", "STEP 3 OF 5"). */
export function Kicker({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('font-mono text-2xs leading-4 tracking-[0.08em] text-ink-3 uppercase', className)} {...props} />
}

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  kicker?: ReactNode
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Heading level for the title. Default h2. */
  as?: 'h2' | 'h3' | 'h4'
  /** Draw a hairline under the header. */
  divider?: boolean
}

/** Section heading: mono kicker, title, optional description and right-aligned actions. */
export function SectionHeader({ kicker, title, description, actions, as: H = 'h2', divider, className, ...props }: SectionHeaderProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4', divider && 'border-b border-line pb-3', className)} {...props}>
      <div className="flex min-w-0 flex-col gap-1">
        {kicker && <Kicker>{kicker}</Kicker>}
        {title && <H className="text-base leading-6 font-medium text-ink text-balance">{title}</H>}
        {description && <p className="max-w-prose text-sm text-ink-3 text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  )
}

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Mono eyebrow above the title (workspace or section name). */
  eyebrow?: ReactNode
  title: ReactNode
  /** Display serif title for document-like pages (reports, projects). */
  serif?: boolean
  description?: ReactNode
  /** Identity mark before the title (Avatar / icon tile). */
  leading?: ReactNode
  /** Inline badges after the title. */
  meta?: ReactNode
  actions?: ReactNode
  /** Breadcrumbs above everything. */
  breadcrumbs?: ReactNode
  /** Tabs row under the header (sits on the bottom hairline). */
  tabs?: ReactNode
  /** Smaller title (dense pages, nested views). */
  compact?: boolean
}

/**
 * Workspace header: eyebrow, title (sans or serif), description, actions and a tabs slot. Stacks on mobile
 * (actions wrap under the title) and tightens the title size.
 */
export function PageHeader({
  eyebrow,
  title,
  serif,
  description,
  leading,
  meta,
  actions,
  breadcrumbs,
  tabs,
  compact,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header className={cn('flex flex-col', tabs ? 'gap-4' : 'gap-0', className)} {...props}>
      {breadcrumbs && <div className="mb-3">{breadcrumbs}</div>}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          {leading && <div className={cn('shrink-0', serif ? 'mt-1.5' : 'mt-0.5')}>{leading}</div>}
          <div className="flex min-w-0 flex-col">
            {eyebrow && <Kicker className="mb-1.5">{eyebrow}</Kicker>}
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1
                className={cn(
                  'min-w-0 text-ink text-balance',
                  serif
                    ? compact
                      ? 'font-serif text-2xl leading-8 tracking-[-0.01em]'
                      : 'font-serif text-[28px] leading-9 tracking-[-0.015em] sm:text-4xl sm:leading-[44px]'
                    : compact
                      ? 'text-lg leading-7 font-semibold tracking-[-0.01em]'
                      : 'text-xl leading-7 font-semibold tracking-[-0.015em] sm:text-2xl sm:leading-8',
                )}
              >
                {title}
              </h1>
              {meta && <div className="flex shrink-0 items-center gap-1.5">{meta}</div>}
            </div>
            {description && (
              <p className={cn('mt-1.5 max-w-2xl text-ink-2 text-pretty', compact ? 'text-sm' : 'text-sm sm:text-base')}>{description}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="min-w-0">{tabs}</div>}
    </header>
  )
}
