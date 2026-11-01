import { useId, type HTMLAttributes, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useFieldContext } from './Field'

export interface RadioOption<T extends string = string> {
  value: T
  label: ReactNode
  description?: ReactNode
  disabled?: boolean
}

export interface RadioGroupProps<T extends string = string> extends Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'defaultValue'> {
  ref?: Ref<HTMLDivElement>
  options: readonly RadioOption<T>[]
  value?: T
  defaultValue?: T
  onValueChange?: (value: T) => void
  name?: string
  orientation?: 'vertical' | 'horizontal'
  disabled?: boolean
  /** 'cards': each option is a bordered, selectable card. */
  variant?: 'plain' | 'cards'
  'aria-label'?: string
}

/** Native radios (arrow keys move the selection) with a custom dot. Wires to a surrounding <Field>. */
export function RadioGroup<T extends string = string>({
  options,
  value: valueProp,
  defaultValue,
  onValueChange,
  name: nameProp,
  orientation = 'vertical',
  disabled,
  variant = 'plain',
  className,
  ...props
}: RadioGroupProps<T>) {
  const field = useFieldContext()
  const autoName = useId()
  const name = nameProp ?? `radio-${autoName}`
  const [value, setValue] = useControllableState<T | undefined>({ value: valueProp, defaultValue, onChange: (v) => v && onValueChange?.(v) })
  const groupDisabled = disabled ?? field?.disabled ?? false

  return (
    <div
      role="radiogroup"
      aria-labelledby={props['aria-label'] ? undefined : field?.labelId}
      aria-describedby={field?.describedBy}
      aria-required={field?.required || undefined}
      aria-invalid={field?.invalid || undefined}
      aria-orientation={orientation}
      className={cn(
        'flex',
        orientation === 'vertical' ? 'flex-col gap-2.5' : 'flex-row flex-wrap gap-x-5 gap-y-2',
        variant === 'cards' && 'gap-2',
        className,
      )}
      {...props}
    >
      {options.map((opt, i) => {
        const checked = value === opt.value
        const isDisabled = groupDisabled || opt.disabled
        return (
          <label
            key={opt.value}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 select-none',
              isDisabled && 'cursor-not-allowed opacity-50',
              variant === 'cards' &&
                cn(
                  'rounded-sm border px-3 py-2.5 transition-[border-color,background-color] duration-(--dur-1) ease-standard',
                  checked ? 'border-accent/60 bg-accent-tint/50' : 'border-line hover:border-line-strong',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
                ),
            )}
          >
            <span className="relative mt-0.5 inline-grid size-4 shrink-0 place-items-center">
              <input
                type="radio"
                name={name}
                value={opt.value}
                checked={checked}
                disabled={isDisabled}
                id={i === 0 && field ? field.id : undefined}
                onChange={() => setValue(opt.value)}
                className="peer absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-not-allowed pointer-coarse:-inset-3.5 pointer-coarse:size-auto"
              />
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none grid size-full place-items-center rounded-full border transition-[border-color,background-color] duration-(--dur-1) ease-standard',
                  checked ? 'border-inverse bg-inverse' : 'border-line-strong bg-sunken peer-hover:border-ink-4',
                  variant !== 'cards' && 'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                )}
              >
                <span className={cn('size-1.5 rounded-full bg-inverse-ink transition-transform duration-(--dur-2) ease-settle', checked ? 'scale-100' : 'scale-0')} />
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm text-ink">{opt.label}</span>
              {opt.description && <span className="text-xs text-ink-3 text-pretty">{opt.description}</span>}
            </span>
          </label>
        )
      })}
    </div>
  )
}
