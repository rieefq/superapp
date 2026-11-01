import { useEffect, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useFieldControl } from './Field'
import { mergeRefs } from './slot'

export type CheckedState = boolean | 'indeterminate'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size' | 'checked' | 'defaultChecked'> {
  ref?: Ref<HTMLInputElement>
  checked?: CheckedState
  defaultChecked?: CheckedState
  onCheckedChange?: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  size?: 'sm' | 'md'
  invalid?: boolean
}

const BOX = { sm: 'size-3.5', md: 'size-4' }
const ICON = { sm: 'size-2.5', md: 'size-3' }

/**
 * Native checkbox (form-ready, label-clickable) with a custom box. Supports 'indeterminate'
 * (announced as mixed). Ink-inverted when checked: selection, not status.
 */
export function Checkbox({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  size = 'md',
  invalid,
  disabled: disabledProp,
  required: requiredProp,
  className,
  onChange,
  ref,
  ...props
}: CheckboxProps) {
  const field = useFieldControl({ ...props, invalid, disabled: disabledProp, required: requiredProp })
  const [checked, setChecked] = useControllableState<CheckedState>({ value: checkedProp, defaultValue: defaultChecked })
  const inputRef = useRef<HTMLInputElement>(null)
  const indeterminate = checked === 'indeterminate'
  const on = checked === true || indeterminate

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])

  const box = (
    <span className={cn('relative inline-grid shrink-0 place-items-center', BOX[size], label ? 'mt-0.5' : undefined)}>
      <input
        ref={mergeRefs(ref, inputRef)}
        type="checkbox"
        checked={checked === true}
        disabled={field.disabled}
        required={field.required}
        onChange={(e) => {
          onChange?.(e)
          setChecked(e.target.checked)
          onCheckedChange?.(e.target.checked)
        }}
        className={cn(
          'peer absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed',
          'pointer-coarse:-inset-3.5 pointer-coarse:size-auto',
        )}
        {...props}
        {...field.a11y}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none grid size-full place-items-center rounded-xs border transition-[background-color,border-color] duration-(--dur-1) ease-standard',
          on ? 'border-inverse bg-inverse text-inverse-ink' : 'border-line-input bg-sunken text-transparent',
          !on && !field.disabled && 'peer-hover:border-ink-3',
          field.invalid && !on && 'border-fail',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--focus-ring)',
          field.disabled && 'opacity-50',
        )}
      >
        {indeterminate ? (
          <Minus className={ICON[size]} strokeWidth={3} />
        ) : (
          <Check className={cn(ICON[size], 'transition-opacity duration-(--dur-1)', on ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
        )}
      </span>
    </span>
  )

  if (!label) return <span className={cn('inline-flex', className)}>{box}</span>

  return (
    <label
      className={cn(
        'inline-flex max-w-full cursor-pointer items-start gap-2.5 select-none',
        field.disabled && 'cursor-not-allowed',
        className,
      )}
    >
      {box}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-sm text-ink', field.disabled && 'text-ink-3')}>{label}</span>
        {description && <span className="text-xs text-ink-3 text-pretty">{description}</span>}
      </span>
    </label>
  )
}
