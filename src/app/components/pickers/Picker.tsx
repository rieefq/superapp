import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { Check, ChevronDown, ChevronsUpDown, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Popover, Spinner, type Placement, type PopoverTriggerProps } from '@/ui'

/**
 * Picker: a keyboard-friendly popover combobox (search field + listbox), the base of every
 * entity picker (projects, agents, repos, collections, workflows, models, any entity).
 * Focus moves into the search field; ↑↓ Home End move, ⏎ picks, Esc closes and returns focus.
 */

export interface PickerOption<V extends string = string> {
  value: V
  label: string
  /** Second line (ink-3). */
  description?: ReactNode
  /** Leading mark (hue square, AgentMark, icon…). */
  leading?: ReactNode
  /** Right-aligned meta (status word, count, LIVE/SIM tag). */
  meta?: ReactNode
  /** Options sharing a group render under a `label` heading (keep groups contiguous). */
  group?: string
  disabled?: boolean
  /** Extra text matched by the search (ids, roles, owners). */
  keywords?: string
}

export interface PickerProps<V extends string = string> {
  options: readonly PickerOption<V>[]
  value?: V | null
  onSelect: (value: V) => void
  /** The trigger element, or a render function receiving the props to spread (see PickerTrigger). */
  trigger: ReactElement | ((props: PopoverTriggerProps, state: { open: boolean }) => ReactNode)
  /** Accessible name of the list ("Projects"). */
  label: string
  placeholder?: string
  emptyText?: ReactNode
  /** Under the list (e.g. "New project"). Receives `close`. */
  footer?: ReactNode | ((close: () => void) => ReactNode)
  /** Called as the user types (for remote/indexed search); combine with `filter={false}`. */
  onQueryChange?: (query: string) => void
  /** Filter options by the query locally. Default true. */
  filter?: boolean
  /** Options are being fetched. */
  loading?: boolean
  width?: number
  placement?: Placement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

function matches(o: PickerOption, q: string): boolean {
  if (!q) return true
  const hay = `${o.label} ${typeof o.description === 'string' ? o.description : ''} ${o.keywords ?? ''} ${o.group ?? ''}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

export function Picker<V extends string = string>({
  options,
  value,
  onSelect,
  trigger,
  label,
  placeholder = 'Search…',
  emptyText = 'No matches',
  footer,
  onQueryChange,
  filter = true,
  loading,
  width = 320,
  placement = 'bottom-start',
  open: openProp,
  onOpenChange,
  className,
}: PickerProps<V>) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setOpenState(next)
    onOpenChange?.(next)
  }
  return (
    <Popover
      trigger={trigger}
      open={open}
      onOpenChange={setOpen}
      placement={placement}
      aria-label={label}
      className={cn('flex max-h-[min(420px,70vh)] flex-col overflow-hidden p-0', className)}
    >
      {({ close }) => (
        <PickerPanel
          options={options}
          value={value}
          label={label}
          placeholder={placeholder}
          emptyText={emptyText}
          footer={typeof footer === 'function' ? footer(close) : footer}
          onQueryChange={onQueryChange}
          filter={filter}
          loading={loading}
          width={width}
          onPick={(v) => {
            onSelect(v)
            close()
          }}
        />
      )}
    </Popover>
  )
}

interface PanelProps<V extends string> {
  options: readonly PickerOption<V>[]
  value?: V | null
  label: string
  placeholder: string
  emptyText: ReactNode
  footer?: ReactNode
  onQueryChange?: (q: string) => void
  filter: boolean
  loading?: boolean
  width: number
  onPick: (v: V) => void
}

function PickerPanel<V extends string>({ options, value, label, placeholder, emptyText, footer, onQueryChange, filter, loading, width, onPick }: PanelProps<V>) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const visible = useMemo(() => (filter ? options.filter((o) => matches(o, query)) : [...options]), [options, query, filter])
  const enabled = visible.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0)
  const selectedIndex = visible.findIndex((o) => o.value === value)
  const [active, setActive] = useState(() => (selectedIndex >= 0 && !visible[selectedIndex]?.disabled ? selectedIndex : (enabled[0] ?? -1)))

  // Keep the active option valid as the list filters.
  useEffect(() => {
    if (active >= 0 && active < visible.length && !visible[active]?.disabled) return
    setActive(enabled[0] ?? -1)
  }, [visible, active, enabled])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const move = (dir: 1 | -1) => {
    if (!enabled.length) return
    const at = enabled.indexOf(active)
    const next = at < 0 ? (dir > 0 ? 0 : enabled.length - 1) : (at + dir + enabled.length) % enabled.length
    setActive(enabled[next])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        if (!query) {
          e.preventDefault()
          setActive(enabled[0] ?? -1)
        }
        break
      case 'End':
        if (!query) {
          e.preventDefault()
          setActive(enabled[enabled.length - 1] ?? -1)
        }
        break
      case 'Enter': {
        e.preventDefault()
        const o = visible[active]
        if (o && !o.disabled) onPick(o.value)
        break
      }
    }
  }

  let lastGroup: string | undefined
  return (
    <div className="flex min-h-0 flex-col" style={{ width: `min(${width}px, calc(100vw - 16px))` }}>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Search aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            onQueryChange?.(e.target.value)
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 pointer-coarse:text-[16px]"
        />
        {loading && <Spinner size={13} />}
      </div>
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        {visible.map((o, i) => {
          const heading = o.group && o.group !== lastGroup ? o.group : undefined
          lastGroup = o.group
          const selected = o.value === value
          return (
            <div key={`${o.group ?? ''}:${o.value}`} role="presentation">
              {heading && (
                <div role="presentation" className="type-label px-2 pt-2.5 pb-1 text-ink-3 select-none first:pt-1.5">
                  {heading}
                </div>
              )}
              <div
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={selected}
                aria-disabled={o.disabled || undefined}
                data-index={i}
                data-active={i === active ? '' : undefined}
                onPointerMove={() => !o.disabled && active !== i && setActive(i)}
                onClick={() => !o.disabled && onPick(o.value)}
                className={cn(
                  'flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 select-none pointer-coarse:min-h-11',
                  o.description ? 'min-h-11' : 'min-h-8',
                  'data-active:bg-ink/8',
                  o.disabled && 'cursor-not-allowed',
                )}
              >
                {o.leading && <span className={cn('flex shrink-0 items-center', o.disabled && 'opacity-50')}>{o.leading}</span>}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate text-sm', o.disabled ? 'text-ink-3' : 'text-ink')}>{o.label}</span>
                  {o.description && <span className="truncate text-xs text-ink-3">{o.description}</span>}
                </span>
                {o.meta && <span className="flex shrink-0 items-center gap-1.5">{o.meta}</span>}
                <Check aria-hidden className={cn('size-3.5 shrink-0 text-ink', selected ? 'visible' : 'invisible')} strokeWidth={2.25} />
              </div>
            </div>
          )
        })}
        {!visible.length && <div className="px-2 py-6 text-center text-sm text-ink-3">{loading ? 'Searching…' : emptyText}</div>}
      </div>
      {footer && <div className="shrink-0 border-t border-line p-1">{footer}</div>}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ triggers

export interface PickerTriggerProps extends PopoverTriggerProps {
  /** 'field': a form well (Start sheet). 'chip': a quiet 28px toolbar chip (composers). */
  variant?: 'field' | 'chip'
  leading?: ReactNode
  children: ReactNode
  placeholder?: boolean
  disabled?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  className?: string
  id?: string
  ref: Ref<HTMLElement>
}

/** The standard trigger for pickers: spread the Picker's trigger props onto it. */
export function PickerTrigger({ variant = 'field', leading, children, placeholder, disabled, className, ref, ...props }: PickerTriggerProps) {
  if (variant === 'chip') {
    return (
      <button
        type="button"
        ref={ref as Ref<HTMLButtonElement>}
        disabled={disabled}
        {...props}
        className={cn(
          'inline-flex h-7 min-w-0 max-w-full shrink-0 items-center gap-1.5 rounded-sm px-2 text-xs font-medium text-ink-2',
          'transition-colors duration-(--dur-1) ease-standard hover:bg-hover hover:text-ink data-[state=open]:bg-press data-[state=open]:text-ink',
          'disabled:cursor-not-allowed disabled:opacity-45',
          "relative pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
          className,
        )}
      >
        {leading}
        <span className={cn('truncate', placeholder && 'text-ink-3')}>{children}</span>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-ink-3" strokeWidth={2} />
      </button>
    )
  }
  return (
    <button
      type="button"
      ref={ref as Ref<HTMLButtonElement>}
      disabled={disabled}
      {...props}
      className={cn(
        'flex h-(--control-h) w-full min-w-0 items-center gap-2 rounded-sm border border-line-input bg-sunken pr-2 pl-2.5 text-left text-sm text-ink',
        'transition-[border-color] duration-(--dur-1) ease-standard hover:border-ink-3 data-[state=open]:border-ink-3',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {leading}
      <span className={cn('min-w-0 flex-1 truncate', placeholder && 'text-ink-3')}>{children}</span>
      <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
    </button>
  )
}
