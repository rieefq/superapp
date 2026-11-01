import { isValidElement, useId, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Link, NavLink } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PrimitiveStyles } from './styles'

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
  /**
   * Clickable row: a full-row <button> sits behind the content (named by the label, aria-current when
   * selected), so `trailing` actions remain separate, valid controls.
   */
  onClick?: (e: MouseEvent<HTMLElement>) => void
  className?: string
  title?: string
  id?: string
  role?: string
  'aria-selected'?: boolean
  'aria-current'?: 'page' | 'true' | 'location' | boolean
}

/** --row-h: 36px (28px compact); two-line rows use --row-h-2; ≥44px on touch. */
const ROW = 'h-(--row-h) pointer-coarse:min-h-11'
const ROW_2 = 'min-h-(--row-h-2) py-1.5'

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
    'group/row type-body-sm relative flex w-full min-w-0 items-center gap-2.5 rounded-sm px-2 text-left',
    'transition-colors duration-(--dur-1) ease-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    twoLine ? ROW_2 : ROW,
    selected ? 'bg-press text-ink' : 'text-ink-2',
    interactive && !disabled && !selected && 'cursor-pointer hover:bg-hover hover:text-ink',
    interactive && !disabled && 'cursor-pointer',
    disabled && 'pointer-events-none opacity-45',
  )
}

function RowContent({
  icon,
  label,
  description,
  meta,
  trailing,
  trailingOnHover,
  selected,
  labelId,
  descriptionId,
}: ListItemProps & { labelId?: string; descriptionId?: string }) {
  return (
    <>
      {renderIcon(icon, cn('size-4 shrink-0', selected ? 'text-ink-2' : 'text-ink-3 group-hover/row:text-ink-2', description ? 'self-start mt-0.5' : ''))}
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={labelId} className="truncate">
          {label}
        </span>
        {description && (
          <span id={descriptionId} className="type-caption truncate text-ink-3">
            {description}
          </span>
        )}
      </span>
      {meta != null && <span className="type-meta shrink-0 text-ink-3">{meta}</span>}
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
  const autoId = useId()
  const labelId = `${autoId}-label`
  const descriptionId = `${autoId}-description`
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
        id={id}
        title={title}
        data-selected={selected ? '' : undefined}
        className={cn(classes, 'isolate', !disabled && 'atrium-passthrough')}
      >
        <PrimitiveStyles />
        {/* Full-row button behind the content: real button semantics, while trailing actions stay clickable. */}
        <button
          type="button"
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={description ? descriptionId : undefined}
          aria-current={props['aria-current'] ?? (selected ? 'true' : undefined)}
          onClick={onClick}
          className="absolute inset-0 -z-10 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
        />
        <RowContent {...props} labelId={labelId} descriptionId={descriptionId} />
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
