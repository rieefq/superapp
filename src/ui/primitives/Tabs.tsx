import {
  createContext,
  useContext,
  useId,
  useRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { NavLink } from 'react-router'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { EASE_SETTLE } from './motion'

export interface TabItem<T extends string = string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Small count after the label (e.g. open tasks). */
  count?: number
  disabled?: boolean
  /** Render as a router link (navigation tabs). */
  to?: string
  /** NavLink `end` matching for link tabs. */
  end?: boolean
}

interface TabsContextValue {
  baseId: string
  value: string | undefined
}
const TabsContext = createContext<TabsContextValue | null>(null)

const tabId = (base: string, value: string) => `${base}-tab-${value}`
const panelId = (base: string, value: string) => `${base}-panel-${value}`

export interface TabsProps<T extends string = string> {
  items: readonly TabItem<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  /** underline: page/section tabs on a hairline. pill: compact switches inside panels. */
  variant?: 'underline' | 'pill'
  size?: 'sm' | 'md'
  /** automatic: arrow keys select. manual: arrows move focus, Enter/Space selects. */
  activation?: 'automatic' | 'manual'
  'aria-label'?: string
  className?: string
  /** <TabPanel>s (optional — omit when you render content yourself). */
  children?: ReactNode
}

/** Underline bars are 32 / 40px (DESIGN §5.5); pills are 28 / 32px controls for dense filters. */
const SIZE = {
  underline: { sm: 'h-8 text-sm gap-1.5', md: 'h-10 text-sm gap-1.5' },
  pill: { sm: 'h-7 px-2 text-xs gap-1', md: 'h-8 px-2.5 text-sm gap-1.5' },
}

/**
 * Tabs with roving tabindex (one tab stop; arrows/Home/End move). Underline or pill variant; items can
 * carry icons and counts, or be links (`to`) for route-driven tabs, which render as a nav with aria-current.
 */
export function Tabs<T extends string = string>({
  items,
  value: valueProp,
  defaultValue,
  onValueChange,
  variant = 'underline',
  size = 'md',
  activation = 'automatic',
  className,
  children,
  'aria-label': ariaLabel,
}: TabsProps<T>) {
  const baseId = useId()
  const [value, setValue] = useControllableState<T | undefined>({
    value: valueProp,
    defaultValue: defaultValue ?? items.find((i) => !i.disabled)?.value,
    onChange: (v) => v && onValueChange?.(v),
  })
  const refs = useRef<(HTMLElement | null)[]>([])
  const reduced = useReducedMotion()
  const isLinks = items.some((i) => i.to)
  const selectedIndex = items.findIndex((i) => i.value === value)

  const focusAt = (i: number) => refs.current[i]?.focus()

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const n = items.length
    const enabled = (i: number) => !items[i].disabled
    const find = (dir: 1 | -1) => {
      for (let k = 1; k <= n; k++) {
        const i = (index + dir * k + n) % n
        if (enabled(i)) return i
      }
      return index
    }
    let target = -1
    if (e.key === 'ArrowRight') target = find(1)
    else if (e.key === 'ArrowLeft') target = find(-1)
    else if (e.key === 'Home') target = items.findIndex((_, i) => enabled(i))
    else if (e.key === 'End') {
      for (let i = n - 1; i >= 0; i--) if (enabled(i)) {
        target = i
        break
      }
    } else if (!isLinks && activation === 'manual' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      setValue(items[index].value)
      return
    }
    if (target < 0) return
    e.preventDefault()
    focusAt(target)
    if (!isLinks && activation === 'automatic') setValue(items[target].value)
  }

  const indicator = (layoutKey: string) =>
    variant === 'underline' ? (
      <motion.span
        layoutId={layoutKey}
        aria-hidden
        transition={reduced ? { duration: 0 } : { duration: 0.28, ease: EASE_SETTLE }}
        className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-ink"
      />
    ) : (
      <motion.span
        layoutId={layoutKey}
        aria-hidden
        transition={reduced ? { duration: 0 } : { duration: 0.24, ease: EASE_SETTLE }}
        className="absolute inset-0 -z-10 rounded-sm bg-press"
      />
    )

  const listClass = cn(
    'no-scrollbar flex min-w-0 items-center overflow-x-auto',
    variant === 'underline' ? 'gap-5 border-b border-line' : 'gap-0.5',
    className,
  )

  const tabClass = (selected: boolean, disabled?: boolean) =>
    cn(
      'relative z-0 inline-flex shrink-0 cursor-pointer items-center font-medium whitespace-nowrap select-none',
      'transition-colors duration-(--dur-1) ease-standard focus-visible:outline-offset-0',
      SIZE[variant][size],
      variant === 'pill' && 'rounded-sm',
      selected ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
      variant === 'pill' && !selected && 'hover:bg-hover',
      disabled && 'pointer-events-none opacity-40',
    )

  const inner = (item: TabItem<T>, selected: boolean) => {
    const Icon = item.icon
    return (
      <>
        {Icon && <Icon aria-hidden className={cn('shrink-0', size === 'sm' ? 'size-3.5' : 'size-4', !selected && 'opacity-80')} strokeWidth={1.75} />}
        <span>{item.label}</span>
        {item.count !== undefined && (
          <span
            className={cn(
              'type-meta rounded-xs px-1 leading-4',
              selected ? 'bg-press text-ink-2' : 'bg-hover text-ink-3',
              variant === 'pill' && selected && 'bg-hover',
            )}
          >
            {item.count}
          </span>
        )}
      </>
    )
  }

  if (isLinks) {
    return (
      <nav aria-label={ariaLabel} className={listClass}>
        {items.map((item, i) => (
          <NavLink
            key={item.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            to={item.to ?? '#'}
            end={item.end}
            aria-disabled={item.disabled || undefined}
            onKeyDown={(e) => onKeyDown(e, i)}
            aria-current={value !== undefined ? (item.value === value ? 'page' : undefined) : undefined}
            className={({ isActive }) => tabClass(value !== undefined ? item.value === value : isActive, item.disabled)}
          >
            {({ isActive }) => {
              const selected = value !== undefined ? item.value === value : isActive
              return (
                <>
                  {inner(item, selected)}
                  {selected && indicator(`tabs-${baseId}`)}
                </>
              )
            }}
          </NavLink>
        ))}
      </nav>
    )
  }

  return (
    <TabsContext.Provider value={{ baseId, value }}>
      <div role="tablist" aria-label={ariaLabel} aria-orientation="horizontal" className={listClass}>
        {items.map((item, i) => {
          const selected = item.value === value
          const tabbable = selected || (selectedIndex < 0 && i === 0)
          return (
            <button
              key={item.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={tabId(baseId, item.value)}
              aria-selected={selected}
              aria-controls={children ? panelId(baseId, item.value) : undefined}
              tabIndex={tabbable ? 0 : -1}
              disabled={item.disabled}
              onClick={() => setValue(item.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={tabClass(selected, item.disabled)}
            >
              {inner(item, selected)}
              {selected && indicator(`tabs-${baseId}`)}
            </button>
          )
        })}
      </div>
      {children}
    </TabsContext.Provider>
  )
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string
  /** Keep the panel mounted (hidden) when inactive. */
  keepMounted?: boolean
}

/** Content for one tab (place inside <Tabs>). Wired with role="tabpanel" + aria-labelledby. */
export function TabPanel({ value, keepMounted, className, children, ...props }: TabPanelProps) {
  const ctx = useContext(TabsContext)
  if (!ctx) return null
  const active = ctx.value === value
  if (!active && !keepMounted) return null
  return (
    <div
      role="tabpanel"
      id={panelId(ctx.baseId, value)}
      aria-labelledby={tabId(ctx.baseId, value)}
      hidden={!active}
      tabIndex={0}
      className={cn('focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent', className)}
      {...props}
    >
      {children}
    </div>
  )
}
