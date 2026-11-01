import type { HTMLAttributes, KeyboardEvent, MouseEvent, ReactNode, Ref } from 'react'
import { Link } from 'react-router'
import { cn } from '@/lib/cn'

export type SurfaceVariant = 'flat' | 'raised' | 'sunken'

const VARIANT: Record<SurfaceVariant, string> = {
  flat: 'border border-line',
  raised: 'border border-line bg-raised',
  sunken: 'border border-line bg-sunken',
}

const PADDING = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-6' } as const
const RADIUS = { sm: 'rounded-sm', md: 'rounded-md', lg: 'rounded-lg' } as const

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  ref?: Ref<HTMLElement>
  variant?: SurfaceVariant
  padding?: keyof typeof PADDING
  radius?: keyof typeof RADIUS
  as?: 'div' | 'section' | 'article' | 'aside' | 'li' | 'figure'
}

/** A bounded area. Prefer whitespace + hairlines; reach for a surface only when grouping needs an edge. */
export function Surface({ variant = 'raised', padding = 'none', radius = 'md', as: Tag = 'div', className, ...props }: SurfaceProps) {
  return <Tag className={cn(VARIANT[variant], PADDING[padding], RADIUS[radius], className)} {...(props as HTMLAttributes<HTMLElement>)} />
}

const INTERACTIVE_INSIDE = 'a,button,input,select,textarea,label,[role="button"],[role="menuitem"],[role="checkbox"],[role="switch"],[contenteditable="true"]'

export interface CardProps extends Omit<SurfaceProps, 'onClick'> {
  /** Hover/press affordances; also implied by onClick or `to`. */
  interactive?: boolean
  /** Selected state (accent edge — selection, not status). */
  selected?: boolean
  disabled?: boolean
  /** Makes the whole card a router link. Avoid nested interactive content when using it. */
  to?: string
  /** Makes the card a button-like target. Clicks on nested buttons/links inside are ignored. */
  onClick?: (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void
  children?: ReactNode
}

/**
 * A card: something you move, open or select. Flat at rest; interactive cards lift their edge on hover,
 * show the focus ring on keyboard focus and an accent edge when selected.
 */
export function Card({
  variant = 'raised',
  padding = 'md',
  radius = 'md',
  interactive,
  selected,
  disabled,
  to,
  onClick,
  className,
  children,
  as: Tag = 'div',
  onKeyDown,
  ...props
}: CardProps) {
  const isInteractive = !disabled && (interactive || !!onClick || !!to)
  const classes = cn(
    'relative block text-left',
    VARIANT[variant],
    PADDING[padding],
    RADIUS[radius],
    'transition-[border-color,background-color,box-shadow] duration-(--dur-1) ease-standard',
    isInteractive && 'cursor-pointer hover:border-line-strong',
    isInteractive && variant === 'raised' && 'hover:bg-[color-mix(in_oklab,var(--surface-raised),var(--surface-hover)_60%)]',
    isInteractive && variant === 'flat' && 'hover:bg-hover/40',
    selected && 'border-accent/70 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_45%,transparent)] hover:border-accent/70',
    disabled && 'opacity-50',
    className,
  )

  if (to && !disabled) {
    return (
      <Link to={to} data-selected={selected ? '' : undefined} className={classes} {...(props as HTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </Link>
    )
  }

  // Ignore clicks from nested controls and from portaled content (e.g. a menu opened inside the card).
  const fromNested = (e: { target: EventTarget; currentTarget: EventTarget }) => {
    const current = e.currentTarget as Element
    const target = e.target as Element
    if (!current.contains(target)) return true
    const hit = target.closest?.(INTERACTIVE_INSIDE)
    return !!hit && hit !== current && current.contains(hit)
  }

  return (
    <Tag
      role={onClick && !disabled ? 'button' : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined}
      aria-disabled={disabled || undefined}
      aria-pressed={onClick && selected !== undefined ? selected : undefined}
      data-selected={selected ? '' : undefined}
      onClick={(e: MouseEvent<HTMLElement>) => {
        if (disabled || !onClick || fromNested(e)) return
        onClick(e)
      }}
      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(e as KeyboardEvent<HTMLElement>)
        if (e.defaultPrevented || disabled || !onClick || e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(e)
        }
      }}
      className={classes}
      {...(props as HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Tag>
  )
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  ref?: Ref<HTMLElement>
  title?: ReactNode
  /** Mono kicker before the title. */
  kicker?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  /** Body padding. Default 'md'. */
  padding?: keyof typeof PADDING
  variant?: SurfaceVariant
  bodyClassName?: string
}

/** Bordered region with a hairline header (title + actions), body and optional footer. */
export function Panel({ title, kicker, actions, footer, padding = 'md', variant = 'raised', className, bodyClassName, children, ...props }: PanelProps) {
  const hasHeader = title || kicker || actions
  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-md', VARIANT[variant], className)} {...props}>
      {hasHeader && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-4 py-2">
          <div className="flex min-w-0 items-baseline gap-2.5">
            {kicker && <span className="shrink-0 font-mono text-2xs tracking-[0.08em] text-ink-3 uppercase">{kicker}</span>}
            {title && <h3 className="truncate text-sm font-medium text-ink">{title}</h3>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', PADDING[padding], bodyClassName)}>{children}</div>
      {footer && <footer className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-sm">{footer}</footer>}
    </section>
  )
}
