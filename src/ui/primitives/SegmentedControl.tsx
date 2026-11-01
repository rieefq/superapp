import { useId, useRef, type KeyboardEvent, type Ref } from 'react'
import { motion } from 'motion/react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { useFieldContext } from './Field'
import { EASE_SETTLE } from './motion'
import { Tooltip } from './Tooltip'

export interface SegmentOption<T extends string = string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Show only the icon; the label becomes the accessible name and tooltip. */
  iconOnly?: boolean
  disabled?: boolean
}

export interface SegmentedControlProps<T extends string = string> {
  options: readonly SegmentOption<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  size?: 'sm' | 'md'
  fullWidth?: boolean
  disabled?: boolean
  className?: string
  'aria-label'?: string
  ref?: Ref<HTMLDivElement>
}

const SEG = {
  sm: { root: 'h-7', item: 'h-6 px-2 text-xs gap-1', icon: 'size-3.5', iconOnly: 'w-6 px-0' },
  md: { root: 'h-8', item: 'h-7 px-2.5 text-sm gap-1.5', icon: 'size-4', iconOnly: 'w-7 px-0' },
}

/**
 * Mutually exclusive view/mode switch (radiogroup semantics): one tab stop, arrows move and select,
 * Home/End jump. The selected thumb glides between segments (instant under reduced motion).
 */
export function SegmentedControl<T extends string = string>({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  size = 'md',
  fullWidth,
  disabled,
  className,
  'aria-label': ariaLabel,
  ref,
}: SegmentedControlProps<T>) {
  const field = useFieldContext()
  const [value, setValue] = useControllableState<T | undefined>({
    value: valueProp,
    defaultValue: defaultValue ?? options[0]?.value,
    onChange: (v) => v && onValueChange?.(v),
  })
  const layoutId = useId()
  const reduced = useReducedMotion()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const s = SEG[size]
  const groupDisabled = disabled ?? field?.disabled ?? false
  const selectedIndex = options.findIndex((o) => o.value === value)

  const select = (i: number) => {
    const opt = options[i]
    if (!opt || opt.disabled || groupDisabled) return
    setValue(opt.value)
    buttons.current[i]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent, index: number) => {
    const n = options.length
    const next = (dir: 1 | -1) => {
      for (let k = 1; k <= n; k++) {
        const i = (index + dir * k + n) % n
        if (!options[i].disabled) return i
      }
      return index
    }
    let target = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') target = next(1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') target = next(-1)
    else if (e.key === 'Home') target = options.findIndex((o) => !o.disabled)
    else if (e.key === 'End') target = options.length - 1 - [...options].reverse().findIndex((o) => !o.disabled)
    if (target >= 0) {
      e.preventDefault()
      select(target)
    }
  }

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : field?.labelId}
      aria-disabled={groupDisabled || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-line bg-sunken p-[3px]',
        s.root,
        fullWidth ? 'flex w-full' : 'w-fit max-w-full',
        groupDisabled && 'opacity-50',
        className,
      )}
    >
      {options.map((opt, i) => {
        const selected = i === selectedIndex
        const tabbable = selected || (selectedIndex < 0 && i === 0)
        const Icon = opt.icon
        const button = (
          <button
            key={opt.value}
            ref={(el) => {
              buttons.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.iconOnly ? opt.label : undefined}
            tabIndex={tabbable ? 0 : -1}
            disabled={groupDisabled || opt.disabled}
            data-selected={selected ? '' : undefined}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'relative z-0 inline-flex min-w-0 cursor-pointer items-center justify-center rounded-[4px] font-medium whitespace-nowrap select-none',
              'transition-colors duration-(--dur-1) ease-standard focus-visible:outline-offset-1',
              'disabled:cursor-not-allowed',
              s.item,
              opt.iconOnly && s.iconOnly,
              fullWidth && 'flex-1',
              selected ? 'text-ink' : 'text-ink-3 enabled:hover:text-ink-2',
              opt.disabled && 'opacity-45',
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${layoutId}`}
                aria-hidden
                transition={reduced ? { duration: 0 } : { duration: 0.24, ease: EASE_SETTLE }}
                className="absolute inset-0 -z-10 rounded-[4px] border border-line-strong bg-raised shadow-inset"
              />
            )}
            {Icon && <Icon aria-hidden className={cn(s.icon, 'shrink-0')} strokeWidth={1.75} />}
            {!opt.iconOnly && <span className="truncate">{opt.label}</span>}
          </button>
        )
        return opt.iconOnly ? (
          <Tooltip key={opt.value} content={opt.label} asLabel>
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}
