import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronsUpDown, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useReducedMotion } from '@/ui/hooks/useReducedMotion'
import { useFieldControl } from './Field'
import { CONTROL_SURFACE, controlStateClasses, type ControlSize } from './Input'
import { useLayer } from './layers'
import { floatingMotion } from './motion'
import { Portal } from './Portal'
import type { Placement } from './positioning'
import { mergeRefs } from './slot'
import { scrollIntoViewWithin } from './dom'
import { findTypeaheadMatch, isTypeaheadKey, useTypeahead } from './typeahead'
import { useFloating } from './useFloating'

export interface SelectOption<T extends string = string> {
  value: T
  label: string
  icon?: LucideIcon
  /** Secondary line under the label. */
  description?: string
  disabled?: boolean
  /** Options sharing a group render under a small heading (keep groups contiguous). */
  group?: string
  /** Right-aligned meta (e.g. price, count). */
  meta?: string
}

export interface SelectProps<T extends string = string> {
  options: readonly SelectOption<T>[]
  value?: T | null
  defaultValue?: T | null
  onValueChange?: (value: T) => void
  placeholder?: string
  size?: ControlSize
  /** 'field': sunken well (forms). 'ghost': text-only (toolbars, inline filters). */
  variant?: 'field' | 'ghost'
  disabled?: boolean
  invalid?: boolean
  required?: boolean
  /** Submits with forms via a hidden input. */
  name?: string
  id?: string
  placement?: Placement
  /** Custom rendering of the selected value in the trigger. */
  renderValue?: (option: SelectOption<T>) => ReactNode
  className?: string
  listClassName?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  ref?: Ref<HTMLButtonElement>
}

const TRIGGER_SIZE: Record<ControlSize, string> = {
  sm: 'h-7 gap-1.5 pl-2 pr-1.5 text-sm',
  md: 'h-8 gap-2 pl-2.5 pr-2 text-sm',
  lg: 'h-10 gap-2 pl-3 pr-2.5 text-base',
}

/**
 * Select-only combobox with a custom listbox (WAI-ARIA APG pattern): focus stays on the trigger,
 * the active option is exposed with aria-activedescendant. Arrows/Home/End/PageUp/PageDown move,
 * typing jumps (typeahead), Enter/Space/Tab choose, Escape closes. Controlled or uncontrolled.
 */
export function Select<T extends string = string>({
  options,
  value: valueProp,
  defaultValue = null,
  onValueChange,
  placeholder = 'Select…',
  size = 'md',
  variant = 'field',
  disabled: disabledProp,
  invalid: invalidProp,
  required: requiredProp,
  name,
  id: idProp,
  placement = 'bottom-start',
  renderValue,
  className,
  listClassName,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  ref,
}: SelectProps<T>) {
  const field = useFieldControl({ id: idProp, invalid: invalidProp, disabled: disabledProp, required: requiredProp })
  const [value, setValue] = useControllableState<T | null>({
    value: valueProp,
    defaultValue,
    onChange: (v) => v !== null && onValueChange?.(v),
  })
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const listId = `${baseId}-listbox`
  const valueId = `${baseId}-value`
  const optionId = (i: number) => `${baseId}-opt-${i}`
  const reduced = useReducedMotion()
  const typeahead = useTypeahead()

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const labels = useMemo(() => options.map((o) => o.label), [options])
  const isDisabled = useCallback((i: number) => !!options[i]?.disabled, [options])

  const firstEnabled = useCallback(
    (from: number, step: 1 | -1) => {
      for (let i = from; i >= 0 && i < options.length; i += step) if (!options[i].disabled) return i
      return -1
    },
    [options],
  )

  const openList = (initial: 'selected' | 'first' | 'last' = 'selected') => {
    if (field.disabled) return
    const start =
      initial === 'first'
        ? firstEnabled(0, 1)
        : initial === 'last'
          ? firstEnabled(options.length - 1, -1)
          : selectedIndex >= 0
            ? selectedIndex
            : firstEnabled(0, 1)
    setActive(start)
    setOpen(true)
  }

  const close = useCallback(() => {
    setOpen(false)
    typeahead.reset()
  }, [typeahead])

  const commit = (index: number) => {
    const opt = options[index]
    if (!opt || opt.disabled) return
    setValue(opt.value)
    close()
  }

  useLayer({ open, inside: [listRef, triggerRef], onEscape: close, onOutside: close })

  const floating = useFloating({ open, anchor: trigger, placement, offset: 4, matchWidth: 'min' })
  const preset = floatingMotion(floating.side, reduced)

  // Keep the active option visible inside the list (never scrolls the page).
  useEffect(() => {
    if (!open || active < 0) return
    const frame = requestAnimationFrame(() => scrollIntoViewWithin(listRef.current, document.getElementById(optionId(active))))
    return () => cancelAnimationFrame(frame)
  }, [open, active, baseId])

  const move = (to: number) => {
    if (to < 0) return
    setActive(to)
  }

  const step = (from: number, dir: 1 | -1, count = 1) => {
    let i = from
    let moved = 0
    let last = from
    while (moved < count) {
      i += dir
      if (i < 0 || i >= options.length) break
      if (!options[i].disabled) {
        last = i
        moved++
      }
    }
    return last
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (field.disabled) return
    const k = e.key
    if (!open) {
      if (k === 'ArrowDown' || k === 'Enter' || k === ' ') {
        e.preventDefault()
        openList('selected')
      } else if (k === 'ArrowUp') {
        e.preventDefault()
        openList(selectedIndex >= 0 ? 'selected' : 'last')
      } else if (k === 'Home') {
        e.preventDefault()
        openList('first')
      } else if (k === 'End') {
        e.preventDefault()
        openList('last')
      } else if (isTypeaheadKey(e)) {
        e.preventDefault()
        const q = typeahead.push(k)
        const match = findTypeaheadMatch(labels, q, selectedIndex, isDisabled)
        setActive(match >= 0 ? match : selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1))
        setOpen(true)
      }
      return
    }
    switch (k) {
      case 'ArrowDown':
        e.preventDefault()
        if (e.altKey) return
        move(step(active, 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (e.altKey) {
          commit(active)
          return
        }
        move(step(active, -1))
        break
      case 'Home':
        e.preventDefault()
        move(firstEnabled(0, 1))
        break
      case 'End':
        e.preventDefault()
        move(firstEnabled(options.length - 1, -1))
        break
      case 'PageDown':
        e.preventDefault()
        move(step(active, 1, 10))
        break
      case 'PageUp':
        e.preventDefault()
        move(step(active, -1, 10))
        break
      case 'Enter':
        e.preventDefault()
        commit(active)
        break
      case ' ':
        e.preventDefault()
        if (typeahead.active()) {
          const q = typeahead.push(' ')
          const match = findTypeaheadMatch(labels, q, active, isDisabled)
          if (match >= 0) move(match)
        } else commit(active)
        break
      case 'Tab':
        if (active >= 0) commit(active)
        else close()
        break
      default:
        if (isTypeaheadKey(e)) {
          e.preventDefault()
          const q = typeahead.push(k)
          const match = findTypeaheadMatch(labels, q, active, isDisabled)
          if (match >= 0) move(match)
        }
    }
  }

  const labelledBy = ariaLabelledBy ?? (field.labelId ? `${field.labelId} ${valueId}` : undefined)
  const hasMeta = options.some((o) => o.meta)

  return (
    <>
      <button
        ref={mergeRefs(ref, triggerRef, setTrigger)}
        type="button"
        role="combobox"
        id={field.id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-describedby={field.describedBy}
        aria-invalid={field.invalid || undefined}
        aria-required={field.required || undefined}
        disabled={field.disabled}
        data-state={open ? 'open' : 'closed'}
        onClick={() => (open ? close() : openList('selected'))}
        onKeyDown={onKeyDown}
        onBlur={() => {
          // Keyboard focus leaving the trigger (not a click into the list) closes it.
          requestAnimationFrame(() => {
            if (document.activeElement !== triggerRef.current && !listRef.current?.contains(document.activeElement)) close()
          })
        }}
        className={cn(
          'flex min-w-0 items-center text-left outline-none',
          variant === 'field'
            ? cn(CONTROL_SURFACE, controlStateClasses({ invalid: field.invalid, disabled: field.disabled, focusWithin: false }), 'w-full')
            : cn(
                'rounded-sm text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                field.disabled && 'cursor-not-allowed opacity-50',
              ),
          variant === 'field' && open && 'border-accent ring-2 ring-accent/25',
          variant === 'ghost' && open && 'bg-hover text-ink',
          TRIGGER_SIZE[size],
          className,
        )}
      >
        <span id={valueId} className={cn('flex min-w-0 flex-1 items-center gap-2 truncate', !selected && 'text-ink-4')}>
          {selected ? (
            renderValue ? (
              renderValue(selected)
            ) : (
              <>
                {selected.icon && <selected.icon aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />}
                <span className="truncate">{selected.label}</span>
              </>
            )
          ) : (
            <span className="truncate">{placeholder}</span>
          )}
        </span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
      </button>
      {name && <input type="hidden" name={name} value={value ?? ''} />}
      <AnimatePresence>
        {open && (
          <Portal>
            <motion.div
              ref={mergeRefs(listRef, floating.setFloating)}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-labelledby={labelledBy}
              aria-label={labelledBy ? undefined : ariaLabel}
              data-layer=""
              initial={preset.initial}
              animate={preset.animate}
              exit={preset.exit}
              transition={preset.transition}
              onMouseDown={(e) => e.preventDefault()}
              className={cn(
                'fixed top-0 left-0 z-(--z-popover) flex min-w-40 flex-col overflow-y-auto overscroll-contain rounded-md border border-line bg-overlay p-1 shadow-e1 outline-none',
                listClassName,
              )}
            >
              {options.map((opt, i) => {
                const isSelected = opt.value === value
                const isActive = i === active
                const showGroup = opt.group && opt.group !== options[i - 1]?.group
                return (
                  <Fragment key={opt.value}>
                    {showGroup && (
                      <div
                        role="presentation"
                        className={cn('px-2 pt-2 pb-1 font-mono text-2xs tracking-[0.08em] text-ink-4 uppercase', i > 0 && 'mt-1 border-t border-line pt-2.5')}
                      >
                        {opt.group}
                      </div>
                    )}
                    <div
                      id={optionId(i)}
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={opt.disabled || undefined}
                      data-active={isActive ? '' : undefined}
                      onPointerMove={() => !opt.disabled && active !== i && setActive(i)}
                      onClick={() => commit(i)}
                      className={cn(
                        'flex shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-ink-2 select-none',
                        opt.description ? 'py-1.5' : 'h-8 [[data-density=compact]_&]:h-7 pointer-coarse:h-11',
                        isActive && 'bg-ink/8 text-ink',
                        isSelected && 'text-ink',
                        opt.disabled && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      {opt.icon && (
                        <opt.icon
                          aria-hidden
                          className={cn('size-4 shrink-0 text-ink-3', opt.description && 'mt-0.5 self-start')}
                          strokeWidth={1.75}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn('truncate', isSelected && 'font-medium')}>{opt.label}</span>
                        {opt.description && <span className="text-xs text-ink-3 text-pretty">{opt.description}</span>}
                      </span>
                      {hasMeta && <span className="shrink-0 font-mono text-2xs text-ink-4 tabular">{opt.meta}</span>}
                      <Check
                        aria-hidden
                        className={cn('size-3.5 shrink-0 text-ink', opt.description && 'self-start mt-0.5', !isSelected && 'invisible')}
                        strokeWidth={2.25}
                      />
                    </div>
                  </Fragment>
                )
              })}
              {options.length === 0 && <div className="px-2 py-1.5 text-sm text-ink-3">No options</div>}
            </motion.div>
          </Portal>
        )}
      </AnimatePresence>
    </>
  )
}
