import { isValidElement, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Link, NavLink } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface ListItemProps {
  ref?: Ref<HTMLElement>
  /** Lucide icon or any node (Avatar, swatch). */
  icon?: LucideIcon | ReactNode
  label: ReactNode
  /** Second line (makes the row two-line). */
  description?: ReactNode
  /** Quiet right-side metadata (time, count) — mono. */
  meta?: ReactNode
  /** Right-side slot (badge, action button). Interactive trailing content is safe with onClick rows. */
  trailing?: ReactNode
  /** Reveal `trailing` only on hover/focus (row actions). */
  trailingOnHover?: boolean
  selected?: boolean
  disabled?: boolean
  /** Router link row. */
  to?: string
  href?: string
  onClick?: (e: MouseEvent<HTMLElement>) => void
  className?: string
  title?: string
  id?: string
  role?: string
  'aria-selected'?: boolean
  'aria-current'?: 'page' | 'true' | 'location' | boolean
}

const ROW = 'h-8 [[data-density=compact]_&]:h-7 pointer-coarse:h-11'

function renderIcon(icon: ListItemProps['icon'], className: string) {
  if (!icon) return null
  if (isValidElement(icon)) return <span className="flex shrink-0 items-center">{icon}</span>
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null && '$$typeof' in icon)) {
    const Icon = icon as LucideIcon
    return <Icon aria-hidden className={className} strokeWidth={1.75} />
  }
  return <span className="flex shrink-0 items-center">{icon as ReactNode}</span>
}

function rowClasses({ selected, disabled, interactive, twoLine }: { selected?: boolean; disabled?: boolean; interactive: boolean; twoLine: boolean }) {
  return cn(
    'group/row relative flex w-full min-w-0 items-center gap-2.5 rounded-sm px-2 text-left text-sm',
    'transition-colors duration-(--dur-1) ease-standard outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    twoLine ? 'py-1.5' : ROW,
    selected ? 'bg-press text-ink' : 'text-ink-2',
    interactive && !disabled && !selected && 'cursor-pointer hover:bg-hover hover:text-ink',
    interactive && !disabled && 'cursor-pointer',
    disabled && 'pointer-events-none opacity-45',
  )
}

function RowContent({ icon, label, description, meta, trailing, trailingOnHover, selected }: ListItemProps) {
  return (
    <>
      {renderIcon(icon, cn('size-4 shrink-0', selected ? 'text-ink-2' : 'text-ink-3 group-hover/row:text-ink-2', description ? 'self-start mt-0.5' : ''))}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {description && <span className="truncate text-xs text-ink-3">{description}</span>}
      </span>
      {meta != null && <span className="shrink-0 font-mono text-2xs text-ink-4 tabular">{meta}</span>}
      {trailing && (
        <span
          className={cn(
            'flex shrink-0 items-center gap-1',
            trailingOnHover && 'opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          {trailing}
        </span>
      )}
    </>
  )
}

/**
 * A list row: icon, label (+ description), mono meta, trailing slot. Renders as a router link (`to`),
 * anchor (`href`), button (`onClick`) or plain row. 32px tall (28 compact, 44 on touch).
 */
export function ListItem(props: ListItemProps) {
  const { ref, to, href, onClick, selected, disabled, className, description, title, id, role } = props
  const interactive = !!(to || href || onClick)
  const classes = cn(rowClasses({ selected, disabled, interactive, twoLine: !!description }), className)
  const aria = { 'aria-selected': props['aria-selected'], 'aria-current': props['aria-current'], title, id, role }
  if (to)
    return (
      <Link ref={ref as Ref<HTMLAnchorElement>} to={to} className={classes} data-selected={selected ? '' : undefined} {...aria}>
        <RowContent {...props} />
      </Link>
    )
  if (href)
    return (
      <a ref={ref as Ref<HTMLAnchorElement>} href={href} className={classes} data-selected={selected ? '' : undefined} {...aria}>
        <RowContent {...props} />
      </a>
    )
  if (onClick)
    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        {...aria}
        role={role ?? 'button'}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        data-selected={selected ? '' : undefined}
        className={classes}
        onClick={(e) => {
          // Ignore clicks from nested controls and from portaled content (menus opened from a row action).
          const target = e.target as Element
          if (!e.currentTarget.contains(target)) return
          const nested = target.closest('button,a,input,select,textarea,[role="menuitem"],[role="checkbox"],[role="switch"]')
          if (nested && nested !== e.currentTarget && e.currentTarget.contains(nested)) return
          onClick(e)
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick(e as unknown as MouseEvent<HTMLElement>)
          }
        }}
      >
        <RowContent {...props} />
      </div>
    )
  return (
    <div ref={ref as Ref<HTMLDivElement>} className={classes} data-selected={selected ? '' : undefined} {...aria}>
      <RowContent {...props} />
    </div>
  )
}

export interface NavItemProps extends Omit<ListItemProps, 'href' | 'onClick' | 'selected'> {
  to: string
  /** Exact match only (for index routes). */
  end?: boolean
  /** Count shown at the right (tabular). */
  count?: number
  /** Force active (otherwise derived from the route). */
  active?: boolean
}

/** Navigation row: NavLink with aria-current, an ink tick on the active item and an optional count. */
export function NavItem({
  to,
  end,
  count,
  active,
  icon,
  label,
  description,
  trailing,
  trailingOnHover,
  className,
  ref,
  disabled,
  title,
  id,
}: NavItemProps) {
  return (
    <NavLink
      ref={ref as Ref<HTMLAnchorElement>}
      to={to}
      end={end}
      title={title}
      id={id}
      aria-disabled={disabled || undefined}
      aria-current={active ? 'page' : undefined}
      className={({ isActive }) => {
        const on = active ?? isActive
        return cn(
          rowClasses({ selected: on, interactive: true, twoLine: !!description }),
          'before:absolute before:top-1/2 before:left-0 before:h-3.5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-ink before:transition-opacity before:duration-(--dur-2)',
          on ? 'before:opacity-100' : 'before:opacity-0',
          disabled && 'pointer-events-none opacity-45',
          className,
        )
      }}
    >
      {({ isActive }) => (
        <RowContent
          icon={icon}
          label={label}
          description={description}
          selected={active ?? isActive}
          meta={count !== undefined ? count : undefined}
          trailing={trailing}
          trailingOnHover={trailingOnHover}
        />
      )}
    </NavLink>
  )
}
