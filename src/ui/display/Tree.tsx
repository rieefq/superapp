import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { ChevronRight, RotateCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { matchRanges } from './highlight'
import { flattenTree, type FlatTreeItem } from './logic'
import { FileIcon } from './FileIcon'
import { MiniSpinner } from './internal'

export interface TreeNode {
  id: string
  label: string
  /** Custom icon; defaults to a FileIcon inferred from the label. */
  icon?: ReactNode
  children?: TreeNode[]
  /** Children exist but are loaded on demand via `loadChildren`. */
  hasChildren?: boolean
  /** Right-aligned metadata (status letter, count, diff stat…). */
  meta?: ReactNode
  disabled?: boolean
}

export interface TreeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  nodes: readonly TreeNode[]
  /** Accessible name of the tree. */
  label: string
  selectedId?: string | null
  defaultSelectedId?: string | null
  onSelect?: (node: TreeNode) => void
  /** Enter / double-click on a leaf (e.g. open a file). */
  onActivate?: (node: TreeNode) => void
  /** Controlled expanded ids. */
  expanded?: ReadonlySet<string>
  defaultExpanded?: Iterable<string>
  onExpandedChange?: (expanded: Set<string>) => void
  /** Lazy loader for nodes with `hasChildren` and no `children` yet. */
  loadChildren?: (node: TreeNode) => Promise<void>
  /** Show matching nodes (and ancestors) only; matches are highlighted. */
  filter?: string
  dense?: boolean
  /** Vertical indent guides. */
  guides?: boolean
  emptyText?: ReactNode
}

const INDENT = 14

interface RowProps {
  item: FlatTreeItem<TreeNode>
  domId: string
  selected: boolean
  focusable: boolean
  loading: boolean
  failed: boolean
  query: string
  dense: boolean
  guides: boolean
  onRowClick: (id: string, e: MouseEvent) => void
  onToggle: (id: string) => void
  onDouble: (id: string) => void
  onRetry: (id: string) => void
}

function Highlighted({ text, query }: { text: string; query: string }) {
  const ranges = query ? matchRanges(text, query) : []
  if (!ranges.length) return <>{text}</>
  const out: ReactNode[] = []
  let pos = 0
  ranges.forEach(([s, e], i) => {
    if (s > pos) out.push(text.slice(pos, s))
    out.push(
      <mark key={i} className="rounded-[2px] bg-highlight text-ink">
        {text.slice(s, e)}
      </mark>,
    )
    pos = e
  })
  if (pos < text.length) out.push(text.slice(pos))
  return <>{out}</>
}

const Row = memo(function Row({ item, domId, selected, focusable, loading, failed, query, dense, guides, onRowClick, onToggle, onDouble, onRetry }: RowProps) {
  const { node, depth, expandable, expanded, posInSet, setSize } = item
  const pad = 6 + (depth - 1) * INDENT
  return (
    <>
      <div
        id={domId}
        role="treeitem"
        aria-level={depth}
        aria-posinset={posInSet}
        aria-setsize={setSize}
        aria-expanded={expandable ? expanded : undefined}
        aria-selected={selected}
        aria-disabled={node.disabled || undefined}
        aria-busy={loading || undefined}
        tabIndex={focusable ? 0 : -1}
        data-id={node.id}
        onClick={(e) => onRowClick(node.id, e)}
        onDoubleClick={() => onDouble(node.id)}
        className={cn(
          'group/row relative flex cursor-default items-center gap-1.5 rounded-sm pr-2 text-sm outline-none select-none',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus-ring',
          dense ? 'h-7' : 'h-8 in-data-[density=compact]:h-7',
          'pointer-coarse:h-11',
          selected ? 'bg-accent-tint text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
          node.disabled && 'opacity-50',
          '[contain-intrinsic-size:auto_32px] [content-visibility:auto]',
        )}
        style={{ paddingLeft: pad }}
      >
        {guides &&
          Array.from({ length: depth - 1 }, (_, i) => (
            <span aria-hidden key={i} className="absolute inset-y-0 w-px bg-line" style={{ left: 6 + i * INDENT + 7 }} />
          ))}
        <span
          aria-hidden
          onClick={(e) => {
            if (!expandable) return
            e.stopPropagation()
            onToggle(node.id)
          }}
          className={cn('flex size-4 shrink-0 items-center justify-center rounded-xs text-ink-4', expandable && 'hover:text-ink')}
        >
          {expandable &&
            (loading ? (
              <MiniSpinner className="text-live" />
            ) : (
              <ChevronRight className={cn('size-3.5 transition-transform duration-(--dur-1) ease-settle', expanded && 'rotate-90')} />
            ))}
        </span>
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
          {node.icon ?? <FileIcon name={node.label} directory={expandable} open={expanded} />}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <Highlighted text={node.label} query={query} />
        </span>
        {node.meta != null && <span className="ml-2 shrink-0 font-mono text-2xs text-ink-4 tabular">{node.meta}</span>}
      </div>
      {failed && (
        <div role="none" className="flex h-8 items-center gap-2 text-xs text-fail-ink" style={{ paddingLeft: pad + INDENT + 22 }}>
          Couldn’t load
          <button
            type="button"
            onClick={() => onRetry(node.id)}
            className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <RotateCw aria-hidden className="size-3" />
            Retry
          </button>
        </div>
      )}
    </>
  )
})

/**
 * Keyboard-accessible tree view (WAI-ARIA tree pattern): ↑/↓ move, → expands / enters,
 * ← collapses / goes to parent, Home/End, type-ahead, * expands siblings, Enter activates,
 * Space selects. Lazy children show a loading state; filter text is highlighted.
 */
export function Tree({
  nodes,
  label,
  selectedId: selectedProp,
  defaultSelectedId = null,
  onSelect,
  onActivate,
  expanded: expandedProp,
  defaultExpanded,
  onExpandedChange,
  loadChildren,
  filter = '',
  dense = false,
  guides = true,
  emptyText = 'Nothing here.',
  className,
  ...props
}: TreeProps) {
  const baseId = useId()
  const [expandedState, setExpandedState] = useState<Set<string>>(() => new Set(defaultExpanded ?? []))
  const expanded = expandedProp ?? expandedState
  const [selectedState, setSelectedState] = useState<string | null>(defaultSelectedId)
  const selectedId = selectedProp !== undefined ? selectedProp : selectedState
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [loading, setLoading] = useState<ReadonlySet<string>>(() => new Set())
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set())
  const rootRef = useRef<HTMLDivElement>(null)
  const typeahead = useRef({ buf: '', t: 0 })

  const items = useMemo(() => flattenTree(nodes, expanded, filter), [nodes, expanded, filter])
  const index = useMemo(() => {
    const m = new Map<string, number>()
    items.forEach((it, i) => m.set(it.node.id, i))
    return m
  }, [items])

  // Keep a focusable row even when the focused node disappears (collapse / filter).
  const activeId = focusedId && index.has(focusedId) ? focusedId : selectedId && index.has(selectedId) ? selectedId : (items[0]?.node.id ?? null)

  const state = useRef({ items, index, expanded, selectedId })
  state.current = { items, index, expanded, selectedId }

  const domId = (id: string) => `${baseId}-${id}`

  const setExpanded = useCallback(
    (next: Set<string>) => {
      if (!expandedProp) setExpandedState(next)
      onExpandedChange?.(next)
    },
    [expandedProp, onExpandedChange],
  )

  const runLoad = useCallback(
    (node: TreeNode) => {
      if (!loadChildren) return
      setFailed((s) => {
        if (!s.has(node.id)) return s
        const n = new Set(s)
        n.delete(node.id)
        return n
      })
      setLoading((s) => new Set(s).add(node.id))
      loadChildren(node)
        .catch(() => setFailed((s) => new Set(s).add(node.id)))
        .finally(() =>
          setLoading((s) => {
            const n = new Set(s)
            n.delete(node.id)
            return n
          }),
        )
    },
    [loadChildren],
  )

  const toggle = useCallback(
    (id: string, open?: boolean) => {
      const { items: its, index: idx, expanded: exp } = state.current
      const it = its[idx.get(id) ?? -1]
      if (!it || !it.expandable) return
      const willOpen = open ?? !exp.has(id)
      const next = new Set(exp)
      if (willOpen) next.add(id)
      else next.delete(id)
      setExpanded(next)
      if (willOpen && it.node.hasChildren && !it.node.children) runLoad(it.node)
    },
    [setExpanded, runLoad],
  )

  const select = useCallback(
    (id: string) => {
      const { items: its, index: idx } = state.current
      const node = its[idx.get(id) ?? -1]?.node
      if (!node || node.disabled) return
      if (selectedProp === undefined) setSelectedState(id)
      onSelect?.(node)
    },
    [onSelect, selectedProp],
  )

  const focusRow = useCallback((id: string) => {
    setFocusedId(id)
    requestAnimationFrame(() => document.getElementById(`${baseId}-${id}`)?.focus({ preventScroll: false }))
  }, [baseId])

  const onRowClick = useCallback(
    (id: string, _e: MouseEvent) => {
      setFocusedId(id)
      select(id)
      const { items: its, index: idx } = state.current
      const it = its[idx.get(id) ?? -1]
      if (it?.expandable) toggle(id)
    },
    [select, toggle],
  )

  const onDouble = useCallback(
    (id: string) => {
      const { items: its, index: idx } = state.current
      const it = its[idx.get(id) ?? -1]
      if (it && !it.expandable && !it.node.disabled) onActivate?.(it.node)
    },
    [onActivate],
  )

  const onRetry = useCallback(
    (id: string) => {
      const { items: its, index: idx } = state.current
      const it = its[idx.get(id) ?? -1]
      if (it) runLoad(it.node)
    },
    [runLoad],
  )

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!activeId) return
    const i = index.get(activeId) ?? 0
    const it = items[i]
    const go = (j: number) => {
      const t = items[Math.max(0, Math.min(items.length - 1, j))]
      if (t) focusRow(t.node.id)
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        go(i + 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        go(i - 1)
        return
      case 'Home':
        e.preventDefault()
        go(0)
        return
      case 'End':
        e.preventDefault()
        go(items.length - 1)
        return
      case 'ArrowRight':
        e.preventDefault()
        if (it.expandable && !it.expanded) toggle(it.node.id, true)
        else if (it.expandable && it.expanded && items[i + 1]?.parentId === it.node.id) go(i + 1)
        return
      case 'ArrowLeft':
        e.preventDefault()
        if (it.expandable && it.expanded) toggle(it.node.id, false)
        else if (it.parentId) focusRow(it.parentId)
        return
      case 'Enter':
        e.preventDefault()
        select(it.node.id)
        if (it.expandable) toggle(it.node.id)
        else if (!it.node.disabled) onActivate?.(it.node)
        return
      case ' ':
        e.preventDefault()
        select(it.node.id)
        return
      case '*': {
        e.preventDefault()
        const next = new Set(expanded)
        items.filter((x) => x.parentId === it.parentId && x.expandable).forEach((x) => next.add(x.node.id))
        setExpanded(next)
        return
      }
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
          const now = Date.now()
          const ta = typeahead.current
          ta.buf = now - ta.t < 600 ? ta.buf + e.key.toLowerCase() : e.key.toLowerCase()
          ta.t = now
          const start = ta.buf.length > 1 ? i : i + 1
          for (let k = 0; k < items.length; k++) {
            const cand = items[(start + k) % items.length]
            if (cand.node.label.toLowerCase().startsWith(ta.buf)) {
              focusRow(cand.node.id)
              break
            }
          }
        }
    }
  }

  // If the focused node vanished (collapsed parent, filter), move focus state to a visible one.
  useEffect(() => {
    if (focusedId && !index.has(focusedId)) setFocusedId(null)
  }, [focusedId, index])

  const query = filter.trim()

  return (
    <div
      ref={rootRef}
      role="tree"
      aria-label={label}
      aria-activedescendant={undefined}
      onKeyDown={onKeyDown}
      className={cn('flex flex-col py-1 font-sans', className)}
      {...props}
    >
      {items.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-ink-3">{query ? `No matches for “${query}”.` : emptyText}</p>
      ) : (
        items.map((it) => {
          const id = it.node.id
          const isLoading = loading.has(id)
          return (
            <Row
              key={id}
              item={it}
              domId={domId(id)}
              selected={selectedId === id}
              focusable={activeId === id}
              loading={isLoading}
              failed={failed.has(id) && it.expanded}
              query={query}
              dense={dense}
              guides={guides}
              onRowClick={onRowClick}
              onToggle={toggle}
              onDouble={onDouble}
              onRetry={onRetry}
            />
          )
        })
      )}
    </div>
  )
}
