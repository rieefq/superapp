import { Fragment, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Menu, type MenuItem } from './Menu'

export interface Crumb {
  label: string
  /** Router path. */
  to?: string
  /** External/plain href. */
  href?: string
  icon?: LucideIcon
  onClick?: () => void
}

export interface BreadcrumbsProps {
  items: readonly Crumb[]
  /** Collapse the middle into a "…" menu beyond this many crumbs. Default 4. */
  maxItems?: number
  className?: string
  /** Trailing node after the last crumb (e.g. a status badge). */
  trailing?: ReactNode
}

/** Location trail: mono slash separators, last crumb is the current page; long trails collapse into a menu. */
export function Breadcrumbs({ items, maxItems = 4, className, trailing }: BreadcrumbsProps) {
  const navigate = useNavigate()
  const collapse = items.length > maxItems && maxItems >= 3
  const head = collapse ? items.slice(0, 1) : items
  const hidden = collapse ? items.slice(1, items.length - (maxItems - 2)) : []
  const tail = collapse ? items.slice(items.length - (maxItems - 2)) : []
  const visible: (Crumb | 'collapsed')[] = collapse ? [...head, 'collapsed', ...tail] : [...head]

  const menuItems: MenuItem[] = hidden.map((c) => ({
    label: c.label,
    icon: c.icon,
    onSelect: () => {
      if (c.onClick) c.onClick()
      else if (c.href) window.location.assign(c.href)
      else if (c.to) navigate(c.to)
    },
  }))

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {visible.map((c, i) => {
          const last = i === visible.length - 1
          return (
            <Fragment key={c === 'collapsed' ? '__collapsed' : `${c.label}-${i}`}>
              {i > 0 && (
                <li aria-hidden className="shrink-0 font-mono text-xs text-ink-4 select-none">
                  /
                </li>
              )}
              <li className={cn('flex min-w-0 items-center', last ? 'max-w-[65%] shrink-0' : 'shrink')}>
                {c === 'collapsed' ? (
                  <Menu
                    items={menuItems}
                    aria-label="Hidden breadcrumbs"
                    trigger={
                      <button
                        type="button"
                        aria-label={`Show ${hidden.length} more`}
                        className="grid h-6 w-7 place-items-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink"
                      >
                        <Ellipsis aria-hidden className="size-4" strokeWidth={1.75} />
                      </button>
                    }
                  />
                ) : (
                  <CrumbLink crumb={c} current={last} />
                )}
              </li>
            </Fragment>
          )
        })}
        {trailing && <li className="ml-1 flex shrink-0 items-center">{trailing}</li>}
      </ol>
    </nav>
  )
}

function CrumbLink({ crumb, current }: { crumb: Crumb; current: boolean }) {
  const Icon = crumb.icon
  const content = (
    <>
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" strokeWidth={1.75} />}
      <span className="truncate">{crumb.label}</span>
    </>
  )
  const base = 'flex min-w-0 items-center gap-1.5 rounded-xs'
  if (current) {
    return (
      <span aria-current="page" className={cn(base, 'font-medium text-ink')}>
        {content}
      </span>
    )
  }
  const linkClass = cn(base, 'text-ink-3 transition-colors duration-(--dur-1) hover:text-ink')
  if (crumb.to) {
    return (
      <Link to={crumb.to} onClick={crumb.onClick} className={linkClass}>
        {content}
      </Link>
    )
  }
  if (crumb.href) {
    return (
      <a href={crumb.href} onClick={crumb.onClick} className={linkClass}>
        {content}
      </a>
    )
  }
  if (crumb.onClick) {
    return (
      <button type="button" onClick={crumb.onClick} className={linkClass}>
        {content}
      </button>
    )
  }
  return <span className={cn(base, 'text-ink-3')}>{content}</span>
}
