import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useFieldControl } from './Field'

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  ref?: Ref<HTMLButtonElement>
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  label?: ReactNode
  description?: ReactNode
  size?: 'sm' | 'md'
  /** Put the label before the switch (settings rows). */
  labelPosition?: 'start' | 'end'
  /** Submits "on" with forms via a hidden input. */
  name?: string
}

const TRACK = { sm: 'h-3.5 w-6', md: 'h-[18px] w-8' }
const THUMB = { sm: 'size-2.5 data-[on]:translate-x-2.5', md: 'size-3.5 data-[on]:translate-x-3.5' }

/** On/off toggle (role="switch"). Ink-inverted track when on; the thumb settles with ease-settle. */
export function Switch({
  checked: checkedProp,
  defaultChecked = false,
  onCheckedChange,
  label,
  description,
  size = 'md',
  labelPosition = 'end',
  name,
  disabled: disabledProp,
  className,
  onClick,
  ref,
  ...props
}: SwitchProps) {
  const field = useFieldControl({ ...props, disabled: disabledProp })
  const [checked, setChecked] = useControllableState({ value: checkedProp, defaultValue: defaultChecked, onChange: onCheckedChange })

  const control = (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={field.disabled}
      data-on={checked ? '' : undefined}
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) setChecked(!checked)
      }}
      className={cn(
        'group relative inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5',
        'transition-[background-color,box-shadow] duration-(--dur-2) ease-standard',
        "pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']",
        TRACK[size],
        checked ? 'bg-inverse' : 'bg-press shadow-[inset_0_0_0_1px_var(--line-strong)] hover:shadow-[inset_0_0_0_1px_var(--ink-4)]',
        'disabled:cursor-not-allowed disabled:opacity-45',
        label ? undefined : className,
      )}
      {...props}
      {...field.a11y}
    >
      <span
        aria-hidden
        data-on={checked ? '' : undefined}
        className={cn(
          'block rounded-full transition-[transform,background-color] duration-(--dur-2) ease-settle',
          THUMB[size],
          checked ? 'bg-canvas' : 'bg-ink-3',
        )}
      />
      {name && <input type="hidden" name={name} value={checked ? 'on' : ''} />}
    </button>
  )

  if (!label) return control

  return (
    <label
      className={cn(
        'inline-flex max-w-full cursor-pointer items-start gap-2.5 select-none',
        labelPosition === 'start' && 'flex-row-reverse justify-between',
        field.disabled && 'cursor-not-allowed',
        className,
      )}
    >
      <span className="mt-px flex">{control}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-sm text-ink', field.disabled && 'text-ink-3')}>{label}</span>
        {description && <span className="text-xs text-ink-3 text-pretty">{description}</span>}
      </span>
    </label>
  )
}
