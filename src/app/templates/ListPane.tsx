import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { Plus } from 'lucide-react'
import { useDB } from '@/core/db'
import { useScope } from '@/core/context'
import type { EntityRef } from '@/core/types'
import { Button, ScrollArea, SearchField, SegmentedControl } from '@/ui'
import { cn } from '@/lib/cn'
import { useInspectEntity } from '../inspector/inspect'
import { switchScope } from '../shell/scope'

// ------------------------------------------------------------------------------------------------ ListPane

export interface ListPaneProps {
  /** Pane title, e.g. "Conversations". */
  title: string
  /** Mono count after the title. */
  count?: number
  /** "+ New" (also what `N` does when the manifest has no newAction). */
  onNew?: () => void
  newLabel?: string
  /** 32px search or filter field. Pass a node, or props for a SearchField. */
  search?: ReactNode | { value: string; onChange: (value: string) => void; placeholder?: string }
  /** `This project · All` toggle, shown only while scoped. */
  scopeToggle?: { value: 'project' | 'all'; onChange: (value: 'project' | 'all') => void }
  /** Extra controls under the search row (filters, sort). */
  filters?: ReactNode
  /** Pinned under the scrolling list (e.g. "Archived · 12"). */
  footer?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * List pane anatomy (§3.4): a 48px header (title, mono count, "+ New" N), an optional 32px search
 * or filter field, an optional `This project · All` toggle, then the scrolling list.
 */
export function ListPane({ title, count, onNew, newLabel = 'New', search, scopeToggle, filters, footer, children, className }: ListPaneProps) {
  const scope = useScope()
  const isSearchProps = search != null && typeof search === 'object' && 'onChange' in (search as object) && !('$$typeof' in (search as object))
  const sp = isSearchProps ? (search as { value: string; onChange: (v: string) => void; placeholder?: string }) : null
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-canvas', className)}>
      <header className="flex h-12 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 className="type-body min-w-0 truncate font-semibold text-ink">{title}</h2>
        {count !== undefined && <span className="type-meta text-ink-3">{count}</span>}
        <span className="flex-1" />
        {onNew && (
          <Button size="sm" variant="ghost" leadingIcon={Plus} kbd="n" onClick={onNew} aria-label={`${newLabel} (N)`}>
            {newLabel}
          </Button>
        )}
      </header>
      {(search || (scopeToggle && scope) || filters) && (
        <div className="flex shrink-0 flex-col gap-2 px-3 pb-2">
          {sp ? (
            <SearchField size="sm" value={sp.value} onValueChange={sp.onChange} placeholder={sp.placeholder ?? 'Search'} kbd="/" data-search-input aria-label={sp.placeholder ?? `Search ${title.toLowerCase()}`} />
          ) : (
            (search as ReactNode)
          )}
          {scopeToggle && scope && (
            <SegmentedControl
              size="sm"
              fullWidth
              aria-label="Show"
              value={scopeToggle.value}
              onValueChange={scopeToggle.onChange}
              options={[
                { value: 'project', label: 'This project' },
                { value: 'all', label: 'All' },
              ]}
            />
          )}
          {filters}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
      {footer && <footer className="shrink-0 border-t border-line">{footer}</footer>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ groups and rows

export function ListGroup({ label, count, children, className }: { label: string; count?: number; children: ReactNode; className?: string }) {
  return (
    <section aria-label={label} className={cn('pb-1', className)}>
      <h3 className="type-label flex items-center gap-1.5 px-4 pt-3 pb-1.5 text-ink-3">
        {label}
        {count !== undefined && <span className="type-meta font-normal tracking-normal normal-case">{count}</span>}
      </h3>
      {children}
    </section>
  )
}

export interface ListRowProps {
  /** Navigate on click (NavLink — selected follows the route unless `selected` is given). */
  to?: string
  onClick?: (e: MouseEvent) => void
  selected?: boolean
  /** Mark, glyph or icon (16–20px). */
  leading?: ReactNode
  title: ReactNode
  /** Second line (switches the row to two lines: 56px, 48px compact). */
  secondary?: ReactNode
  /** Right-aligned meta (mono time, count). */
  meta?: ReactNode
  /** Right-most slot (status glyph, ⋯). Revealed on hover and focus when `trailingOnHover`. */
  trailing?: ReactNode
  trailingOnHover?: boolean
  /** Space inspects this entity (Inspector › Item). */
  entity?: EntityRef
  'aria-label'?: string
  className?: string
}

/** One list row: 36px (one line) or 56px (two lines); 28/48 in compact density. Selected = accent tint. */
export function ListRow({ to, onClick, selected, leading, title, secondary, meta, trailing, trailingOnHover, entity, className, ...aria }: ListRowProps) {
  const body = (active: boolean) => (
    <>
      {leading && <span className={cn('flex shrink-0 items-center', secondary && 'self-start pt-0.5')}>{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('type-body-sm truncate', active ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink')}>{title}</span>
        {secondary && <span className="type-caption truncate text-ink-3">{secondary}</span>}
      </span>
      {meta && <span className={cn('type-meta shrink-0 text-ink-3', secondary && 'self-start pt-0.5')}>{meta}</span>}
      {trailing && (
        <span className={cn('flex shrink-0 items-center', trailingOnHover && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100')}>
          {trailing}
        </span>
      )}
    </>
  )
  const base = (active: boolean) =>
    cn(
      'group relative mx-1.5 flex items-center gap-2.5 rounded-sm px-2.5 outline-none transition-colors duration-(--dur-1) ease-standard',
      'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
      secondary ? 'h-(--row-h-2) py-1.5' : 'h-(--row-h) pointer-coarse:h-11',
      active ? 'bg-accent-tint' : 'hover:bg-hover',
      className,
    )
  const data = { 'data-list-row': '', 'data-inspect': entity ? `${entity.kind}:${entity.id}` : undefined }
  if (to) {
    return (
      <NavLink to={to} onClick={onClick} className={({ isActive }) => base(selected ?? isActive)} aria-label={aria['aria-label']} {...data}>
        {({ isActive }) => body(selected ?? isActive)}
      </NavLink>
    )
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} aria-label={aria['aria-label']} className={cn(base(!!selected), 'w-[calc(100%-12px)] text-left')} {...data}>
      {body(!!selected)}
    </button>
  )
}

/**
 * Keyboard for a list (§3.11, §8.5): one tab stop (roving), ↑↓ or J K move, Home/End jump, type-ahead
 * by first letters, ⏎ opens (the row's click), Space inspects (`?inspect=`).
 */
export function ListRows({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const inspect = useInspectEntity()
  const typed = useRef({ text: '', at: 0 })

  const rows = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('[data-list-row]') ?? [])

  // Roving tab stop: the selected row (or the first) is the only one in the tab order.
  useEffect(() => {
    const all = rows()
    if (!all.length) return
    const current = all.find((r) => r.matches(':focus')) ?? all.find((r) => r.getAttribute('aria-current') === 'page' || r.getAttribute('aria-pressed') === 'true') ?? all[0]
    for (const r of all) r.tabIndex = r === current ? 0 : -1
  })

  const focusRow = (el: HTMLElement | undefined) => {
    if (!el) return
    for (const r of rows()) r.tabIndex = r === el ? 0 : -1
    el.focus()
    el.scrollIntoView({ block: 'nearest' })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = rows()
    const i = all.indexOf(document.activeElement as HTMLElement)
    if (i < 0 || e.metaKey || e.ctrlKey || e.altKey) return
    const key = e.key
    if (key === 'ArrowDown' || key === 'j') {
      e.preventDefault()
      focusRow(all[Math.min(all.length - 1, i + 1)])
    } else if (key === 'ArrowUp' || key === 'k') {
      e.preventDefault()
      focusRow(all[Math.max(0, i - 1)])
    } else if (key === 'Home') {
      e.preventDefault()
      focusRow(all[0])
    } else if (key === 'End') {
      e.preventDefault()
      focusRow(all[all.length - 1])
    } else if (key === ' ') {
      const target = all[i]?.getAttribute('data-inspect')
      if (!target) return
      e.preventDefault()
      const at = target.indexOf(':')
      inspect({ kind: target.slice(0, at) as EntityRef['kind'], id: target.slice(at + 1) })
    } else if (key.length === 1 && /\S/.test(key)) {
      const now = Date.now()
      typed.current = { text: now - typed.current.at < 700 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now }
      const q = typed.current.text
      const order = [...all.slice(i + 1), ...all.slice(0, i + 1)]
      const hit = order.find((r) => (r.textContent ?? '').trim().toLowerCase().startsWith(q))
      if (hit) {
        e.preventDefault()
        focusRow(hit)
      }
    }
  }

  return (
    <div ref={ref} role="list" aria-label={label} onKeyDown={onKeyDown} className={cn('flex flex-col gap-px py-1', className)}>
      {children}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ scope filter row

/**
 * `Filtered to Atlas Portal v2 · Show all` (§2.4): shown on every list filtered to the scope.
 * `onShowAll` defaults to clearing the scope; pass a local handler to show all in this list only.
 */
export function ScopeFilterRow({ onShowAll, className }: { onShowAll?: () => void; className?: string }) {
  const scope = useScope()
  const project = useDB((s) => (scope ? s.projects[scope] : undefined))
  if (!project) return null
  return (
    <div className={cn('type-caption flex h-8 items-center gap-1.5 px-4 text-ink-3', className)}>
      <span className="truncate">
        Filtered to <span className="text-ink-2">{project.name}</span>
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onShowAll ?? (() => switchScope(null))}
        className="shrink-0 rounded-xs text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink"
      >
        Show all
      </button>
    </div>
  )
}
