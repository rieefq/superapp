import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react'
import { Search, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useFieldControl } from './Field'
import { KbdCombo } from './Kbd'
import { mergeRefs } from './slot'

export type ControlSize = 'sm' | 'md' | 'lg'

/**
 * Shared look for text-entry wells: sunken surface, a --line-input boundary (≥3:1), and the standard
 * focus ring (2px ink, 2px offset). Invalid fields use the fail border plus a message.
 */
export const CONTROL_SURFACE = cn(
  'rounded-sm border bg-sunken text-ink',
  'transition-[border-color,box-shadow,background-color] duration-(--dur-1) ease-standard',
)

export function controlStateClasses({ invalid, disabled, focusWithin = true }: { invalid?: boolean; disabled?: boolean; focusWithin?: boolean }) {
  return cn(
    invalid ? 'border-fail' : 'border-line-input',
    !disabled && !invalid && 'hover:border-ink-3',
    focusWithin
      ? 'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--focus-ring)'
      : 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)',
    disabled && 'cursor-not-allowed opacity-50',
  )
}

/** md follows --control-h (32px, 28px in compact density). */
const CONTROL_SIZE: Record<ControlSize, { box: string; pad: string; icon: string; text: string }> = {
  sm: { box: 'h-7', pad: 'px-2', icon: 'size-3.5', text: 'text-sm' },
  md: { box: 'h-(--control-h)', pad: 'px-2.5', icon: 'size-4', text: 'text-sm' },
  lg: { box: 'h-10', pad: 'px-3', icon: 'size-4', text: 'text-base' },
}

/** iOS zooms into inputs under 16px; coarse pointers get 16px text. */
const TOUCH_TEXT = 'pointer-coarse:text-[16px]'

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  ref?: Ref<HTMLInputElement>
  size?: ControlSize
  /** Leading icon inside the field. */
  icon?: LucideIcon
  /** Leading node (e.g. "https://" prefix). */
  prefix?: ReactNode
  /** Trailing node (unit, button, kbd). */
  suffix?: ReactNode
  invalid?: boolean
  /** Class for the outer well (className goes there too). */
  wrapperClassName?: string
  /** Called with the string value on every change. */
  onValueChange?: (value: string) => void
}

/** Single-line text input. Works standalone or inside <Field> (ids/aria wired automatically). */
export function Input({
  size = 'md',
  icon: Icon,
  prefix,
  suffix,
  invalid: invalidProp,
  className,
  wrapperClassName,
  onChange,
  onValueChange,
  disabled: disabledProp,
  required: requiredProp,
  ref,
  ...props
}: InputProps) {
  const field = useFieldControl({ ...props, invalid: invalidProp, disabled: disabledProp, required: requiredProp })
  const s = CONTROL_SIZE[size]
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={cn(
        CONTROL_SURFACE,
        controlStateClasses({ invalid: field.invalid, disabled: field.disabled }),
        'flex w-full min-w-0 items-center gap-2',
        props.readOnly && 'bg-transparent',
        s.box,
        s.pad,
        wrapperClassName,
        className,
      )}
      onPointerDown={(e) => {
        // Clicking the well's padding/icon focuses the input.
        if (e.target === e.currentTarget || (e.target as Element).closest?.('[data-input-adornment]')) {
          e.preventDefault()
          inputRef.current?.focus()
        }
      }}
    >
      {Icon && <Icon data-input-adornment aria-hidden className={cn(s.icon, 'shrink-0 text-ink-3')} strokeWidth={1.75} />}
      {prefix && (
        <span data-input-adornment className="-mr-1.5 shrink-0 text-sm text-ink-3 select-none">
          {prefix}
        </span>
      )}
      <input
        ref={mergeRefs(ref, inputRef)}
        disabled={field.disabled}
        required={field.required}
        className={cn(
          'h-full w-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3 disabled:cursor-not-allowed',
          s.text,
          TOUCH_TEXT,
        )}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          onChange?.(e)
          onValueChange?.(e.target.value)
        }}
        {...props}
        {...field.a11y}
      />
      {suffix && <span className="flex shrink-0 items-center text-sm text-ink-3">{suffix}</span>}
    </div>
  )
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>
  invalid?: boolean
  /** Grow with content between minRows and maxRows. */
  autosize?: boolean
  minRows?: number
  maxRows?: number
  /** Monospace (code, JSON, prompts). */
  mono?: boolean
  onValueChange?: (value: string) => void
}

/** Multi-line text input with optional autosize. */
export function Textarea({
  invalid: invalidProp,
  autosize,
  minRows = 3,
  maxRows = 12,
  mono,
  rows,
  className,
  onChange,
  onValueChange,
  disabled: disabledProp,
  required: requiredProp,
  style,
  ref,
  ...props
}: TextareaProps) {
  const field = useFieldControl({ ...props, invalid: invalidProp, disabled: disabledProp, required: requiredProp })
  const innerRef = useRef<HTMLTextAreaElement>(null)

  const resize = useCallback(() => {
    const el = innerRef.current
    if (!el || !autosize) return
    const cs = getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || 20
    const borderY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + borderY
    el.style.height = 'auto'
    const min = minRows * line + chrome
    const max = maxRows * line + chrome
    const content = el.scrollHeight + borderY
    el.style.height = `${Math.min(max, Math.max(min, content))}px`
    el.style.overflowY = content > max + 1 ? 'auto' : 'hidden'
  }, [autosize, minRows, maxRows])

  useLayoutEffect(() => {
    resize()
  }, [resize, props.value])

  // Re-measure when the width changes (line wrapping changes).
  useLayoutEffect(() => {
    const el = innerRef.current
    if (!el || !autosize || typeof ResizeObserver === 'undefined') return
    let width = el.offsetWidth
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth !== width) {
        width = el.offsetWidth
        resize()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [autosize, resize])

  return (
    <textarea
      ref={mergeRefs(ref, innerRef)}
      rows={autosize ? minRows : (rows ?? minRows)}
      disabled={field.disabled}
      required={field.required}
      className={cn(
        CONTROL_SURFACE,
        controlStateClasses({ invalid: field.invalid, disabled: field.disabled, focusWithin: false }),
        'block w-full min-w-0 px-2.5 py-1.5 text-sm leading-5 placeholder:text-ink-3',
        TOUCH_TEXT,
        mono && 'font-mono text-xs leading-5',
        autosize ? 'resize-none' : 'resize-y',
        className,
      )}
      style={style}
      onChange={(e) => {
        onChange?.(e)
        onValueChange?.(e.target.value)
        resize()
      }}
      {...props}
      {...field.a11y}
    />
  )
}

export interface SearchFieldProps extends Omit<InputProps, 'icon' | 'type' | 'value' | 'defaultValue'> {
  value?: string
  defaultValue?: string
  /** Shortcut hint shown while empty and unfocused, e.g. '/'. Display only. */
  kbd?: string
  /** Escape on an empty field (a non-empty field clears first). */
  onEscape?: () => void
  /** Called when the clear button (or Escape) clears the field. */
  onClear?: () => void
  /** Accessible label (defaults to the placeholder). */
  'aria-label'?: string
}

/** Search input: icon, clear button, kbd hint. Escape clears, then calls onEscape. */
export function SearchField({
  value: valueProp,
  defaultValue = '',
  onValueChange,
  kbd,
  onEscape,
  onClear,
  onKeyDown,
  onFocus,
  onBlur,
  placeholder = 'Search',
  size = 'md',
  className,
  'aria-label': ariaLabel,
  ref,
  ...props
}: SearchFieldProps) {
  const [internal, setInternal] = useState(defaultValue)
  const controlled = valueProp !== undefined
  const value = controlled ? valueProp : internal
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const setValue = (next: string) => {
    if (!controlled) setInternal(next)
    onValueChange?.(next)
  }

  const clear = () => {
    setValue('')
    onClear?.()
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      if (value) {
        e.preventDefault()
        e.stopPropagation()
        clear()
      } else if (onEscape) {
        e.preventDefault()
        e.stopPropagation()
        onEscape()
      }
    }
  }

  return (
    <Input
      ref={mergeRefs(ref, inputRef)}
      type="search"
      role="searchbox"
      size={size}
      icon={Search}
      placeholder={placeholder}
      aria-label={ariaLabel ?? (typeof placeholder === 'string' ? placeholder : 'Search')}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onValueChange={setValue}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      className={cn('[&_input::-webkit-search-cancel-button]:appearance-none', className)}
      suffix={
        value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="-mr-1 grid size-5 place-items-center rounded-xs text-ink-3 hover:bg-hover hover:text-ink pointer-coarse:size-7"
          >
            <X aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        ) : kbd && !focused ? (
          <KbdCombo combo={kbd} aria-hidden className="pointer-coarse:hidden" />
        ) : undefined
      }
      {...props}
    />
  )
}
