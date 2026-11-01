import { useMemo, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { formatNumber } from '@/lib/format'
import { sortRows, type SortDirection, type SortValue } from './logic'
import { SkeletonBar } from './internal'

export interface DataColumn<T> {
  key: string
  header: ReactNode
  /** Cell renderer (defaults to `row[key]`). */
  cell?: (row: T, index: number) => ReactNode
  sortable?: boolean
  /** Value used for sorting (defaults to `row[key]`). */
  sortValue?: (row: T) => SortValue
  align?: 'left' | 'right' | 'center'
  /** Fixed width (px number or any CSS length). */
  width?: number | string
  /** Mono + tabular figures (ids, numbers that tick). */
  mono?: boolean
  /** Hide on narrow screens. */
  hideBelow?: 'sm' | 'md' | 'lg'
  className?: string
}

export interface TableSort {
  key: string
  direction: SortDirection
}

export interface DataTableProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  columns: readonly DataColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T) => string
  /** Controlled sort. */
  sort?: TableSort | null
  defaultSort?: TableSort | null
  onSortChange?: (sort: TableSort) => void
  /** Rows are already sorted by the caller (server-side); only emit `onSortChange`. */
  manualSort?: boolean
  onRowClick?: (row: T) => void
  selectedKey?: string | null
  loading?: boolean
  skeletonRows?: number
  empty?: ReactNode
  dense?: boolean
  /** Scroll inside the table with a sticky header. */
  maxHeight?: number | string
  /** Background the sticky header sits on. */
  surface?: 'canvas' | 'raised' | 'sunken' | 'overlay'
  /** Accessible table caption (visually hidden). */
  caption?: string
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const
const HIDE = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const
const SURFACE = { canvas: 'bg-canvas', raised: 'bg-raised', sunken: 'bg-sunken', overlay: 'bg-overlay' } as const
const SKELETON_W = ['72%', '48%', '86%', '60%', '38%', '66%', '54%']

function defaultValue<T>(row: T, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

/**
 * Data table: sortable headers (aria-sort), sticky header, clickable/keyboard rows,
 * selection, loading skeleton, empty slot, dense mode. Hairline rows, no zebra.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  manualSort = false,
  onRowClick,
  selectedKey,
  loading = false,
  skeletonRows = 5,
  empty,
  dense = false,
  maxHeight,
  surface = 'canvas',
  caption,
  className,
  ...props
}: DataTableProps<T>) {
  const [sortState, setSortState] = useState<TableSort | null>(defaultSort)
  const sort = sortProp !== undefined ? sortProp : sortState

  const sorted = useMemo(() => {
    if (!sort || manualSort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return rows
    const acc = col.sortValue ?? ((r: T) => defaultValue(r, col.key) as SortValue)
    return sortRows(rows, acc, sort.direction)
  }, [rows, sort, columns, manualSort])

  const toggleSort = (col: DataColumn<T>) => {
    const first: SortDirection = col.align === 'right' ? 'desc' : 'asc'
    const next: TableSort =
      sort?.key === col.key ? { key: col.key, direction: sort.direction === 'asc' ? 'desc' : 'asc' } : { key: col.key, direction: first }
    if (sortProp === undefined) setSortState(next)
    onSortChange?.(next)
  }

  const rowH = dense ? 'h-7' : 'h-8 in-data-[density=compact]:h-7'
  const clickable = !!onRowClick
  // Clickable/selectable rows inset the first column so the selection bar has room.
  const firstPad = clickable || selectedKey != null ? 'first:pl-2.5' : 'first:pl-0'

  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onRowClick?.(row)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const sib = e.key === 'ArrowDown' ? e.currentTarget.nextElementSibling : e.currentTarget.previousElementSibling
      ;(sib as HTMLElement | null)?.focus()
    }
  }

  return (
    <div
      className={cn('relative overflow-auto', className)}
      style={maxHeight !== undefined ? { maxHeight } : undefined}
      {...props}
    >
      <table className="w-full border-separate border-spacing-0 font-sans text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <colgroup>
          {columns.map((c) => (
            <col key={c.key} style={c.width !== undefined ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={c.sortable ? (active ? (sort!.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                  className={cn(
                    'sticky top-0 z-[1] h-8 border-b border-line-strong px-3 align-middle font-mono text-2xs font-medium tracking-[0.06em] whitespace-nowrap text-ink-3 uppercase last:pr-0',
                    firstPad,
                    SURFACE[surface],
                    ALIGN[c.align ?? 'left'],
                    c.hideBelow && HIDE[c.hideBelow],
                  )}
                >
                  {c.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(c)}
                      className={cn(
                        'group/sort -mx-1 inline-flex h-6 items-center gap-1 rounded-xs px-1 uppercase transition-colors duration-(--dur-1) hover:text-ink pointer-coarse:h-11',
                        c.align === 'right' && 'flex-row-reverse',
                        active && 'text-ink',
                      )}
                    >
                      {c.header}
                      <span aria-hidden className={cn('inline-flex size-3 items-center', !active && 'opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60')}>
                        {active && sort!.direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            Array.from({ length: skeletonRows }, (_, ri) => (
              <tr key={`sk${ri}`} aria-hidden className={rowH}>
                {columns.map((c, ci) => (
                  <td key={c.key} className={cn('border-b border-line px-3 last:pr-0', firstPad, c.hideBelow && HIDE[c.hideBelow])}>
                    <SkeletonBar
                      className={cn(c.align === 'right' && 'ml-auto')}
                      style={{ width: SKELETON_W[(ri * 3 + ci) % SKELETON_W.length], animationDelay: `${ri * 80}ms` }}
                    />
                  </td>
                ))}
              </tr>
            ))
          ) : sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-ink-3">
                {empty ?? 'No results.'}
              </td>
            </tr>
          ) : (
            sorted.map((row, ri) => {
              const key = rowKey(row)
              const selected = selectedKey != null && selectedKey === key
              return (
                <tr
                  key={key}
                  tabIndex={clickable ? 0 : undefined}
                  aria-current={selected || undefined}
                  onClick={clickable ? () => onRowClick!(row) : undefined}
                  onKeyDown={clickable ? (e) => onRowKey(e, row) : undefined}
                  className={cn(
                    rowH,
                    'group/tr transition-colors duration-(--dur-1)',
                    clickable && 'cursor-pointer hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-[-2px]',
                    selected && 'bg-accent-tint hover:bg-accent-tint',
                    loading && 'opacity-60',
                  )}
                >
                  {columns.map((c, ci) => (
                    <td
                      key={c.key}
                      className={cn(
                        'border-b border-line px-3 align-middle text-ink-2 last:pr-0',
                        firstPad,
                        ci === 0 && 'text-ink',
                        ALIGN[c.align ?? 'left'],
                        (c.mono || c.align === 'right') && 'tabular whitespace-nowrap',
                        c.mono && 'font-mono text-xs',
                        c.hideBelow && HIDE[c.hideBelow],
                        ci === 0 && selected && 'shadow-[inset_2px_0_0_var(--accent)]',
                        c.className,
                      )}
                    >
                      {c.cell ? c.cell(row, ri) : String(defaultValue(row, c.key) ?? '')}
                    </td>
                  ))}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      {loading && rows.length > 0 && <span className="sr-only" role="status">Loading…</span>}
    </div>
  )
}

/* ------------------------------------------------------------------------------------------ */
/* Pagination                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export interface PaginationProps extends HTMLAttributes<HTMLElement> {
  /** 1-based page. */
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  /** Total rows and page size enable the "26–50 of 312" range readout. */
  total?: number
  pageSize?: number
}

/** Compact pager: range readout + previous / next. */
export function Pagination({ page, pageCount, onPageChange, total, pageSize, className, ...props }: PaginationProps) {
  const from = total !== undefined && pageSize ? Math.min(total, (page - 1) * pageSize + 1) : undefined
  const to = total !== undefined && pageSize ? Math.min(total, page * pageSize) : undefined
  const btn =
    'inline-flex size-7 items-center justify-center rounded-sm text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-11'
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-3 text-xs text-ink-3', className)} {...props}>
      <span className="tabular" aria-live="polite">
        {total !== undefined && from !== undefined ? (
          total === 0 ? (
            'No rows'
          ) : (
            <>
              <span className="text-ink-2">
                {formatNumber(from)}–{formatNumber(to!)}
              </span>{' '}
              of {formatNumber(total)}
            </>
          )
        ) : (
          <>
            Page <span className="text-ink-2">{page}</span> of {pageCount}
          </>
        )}
      </span>
      <span className="flex items-center gap-1">
        <button type="button" className={btn} aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-12 text-center tabular">
          {page} / {pageCount}
        </span>
        <button type="button" className={btn} aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="size-4" />
        </button>
      </span>
    </nav>
  )
}
