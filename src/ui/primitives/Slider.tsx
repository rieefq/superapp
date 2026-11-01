import type { CSSProperties, InputHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { useControllableState } from '@/ui/hooks/useControllableState'
import { useFieldControl } from './Field'
import { PrimitiveStyles } from './styles'

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange' | 'size'> {
  ref?: Ref<HTMLInputElement>
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Show the current value on the right (formatted). */
  showValue?: boolean
  formatValue?: (value: number) => ReactNode
  /** Visible label row above the track (use <Field> for full form wiring). */
  label?: ReactNode
  /** Small captions under the track ends. */
  minLabel?: ReactNode
  maxLabel?: ReactNode
}

/** Native range input (full keyboard + a11y for free) with a hairline track, ink fill and a raised knob. */
export function Slider({
  value: valueProp,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  showValue,
  formatValue = (v) => v,
  label,
  minLabel,
  maxLabel,
  disabled: disabledProp,
  className,
  style,
  ref,
  ...props
}: SliderProps) {
  const field = useFieldControl({ ...props, disabled: disabledProp })
  const [value, setValue] = useControllableState({ value: valueProp, defaultValue: defaultValue ?? min, onChange: onValueChange })
  const pct = max === min ? 0 : ((value - min) / (max - min)) * 100
  const formatted = formatValue(value)

  return (
    <div className={cn('flex w-full flex-col gap-1.5', field.disabled && 'opacity-50', className)}>
      <PrimitiveStyles />
      {(label || showValue) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={field.id} className="text-sm text-ink-2">
              {label}
            </label>
          )}
          {showValue && (
            <output htmlFor={field.id} className="ml-auto font-mono text-xs text-ink-2 tabular">
              {formatted}
            </output>
          )}
        </div>
      )}
      <input
        ref={ref}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={field.disabled}
        aria-valuetext={typeof formatted === 'string' || typeof formatted === 'number' ? String(formatted) : undefined}
        onChange={(e) => setValue(Number(e.target.value))}
        className="atrium-range"
        style={{ '--pct': `${pct}%`, ...style } as CSSProperties}
        {...props}
        {...field.a11y}
      />
      {(minLabel || maxLabel) && (
        <div className="flex justify-between text-2xs text-ink-4">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      )}
    </div>
  )
}
