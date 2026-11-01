import { createContext, useContext, useId, type AriaAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FieldContextValue {
  /** id for the control element. */
  id: string
  labelId: string
  /** Space-separated ids of hint/error text. */
  describedBy?: string
  invalid: boolean
  required: boolean
  disabled: boolean
}

const FieldContext = createContext<FieldContextValue | null>(null)

/** The surrounding Field's wiring, if any. */
export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext)
}

interface ControlA11yInput {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
  'aria-labelledby'?: string
  required?: boolean
  disabled?: boolean
  invalid?: boolean
}

/**
 * Resolve a control's a11y props from its own props + the surrounding Field (own props win).
 * Returns { id, aria-describedby, aria-invalid, aria-required, disabled, invalid }.
 */
export function useFieldControl(props: ControlA11yInput) {
  const field = useFieldContext()
  const fallbackId = useId()
  const id = props.id ?? field?.id ?? fallbackId
  const describedBy = [props['aria-describedby'], field?.describedBy].filter(Boolean).join(' ') || undefined
  const invalid = !!(props.invalid ?? (props['aria-invalid'] === true || props['aria-invalid'] === 'true' ? true : field?.invalid))
  const required = props.required ?? field?.required ?? false
  const disabled = props.disabled ?? field?.disabled ?? false
  return {
    id,
    labelId: field?.labelId,
    describedBy,
    invalid,
    required,
    disabled,
    a11y: {
      id,
      'aria-describedby': describedBy,
      'aria-invalid': invalid || undefined,
      'aria-required': required || undefined,
    },
  }
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  /** Helper text under the control. */
  hint?: ReactNode
  /** Error text; marks the control aria-invalid. Shown with an icon (color is never the only signal). */
  error?: ReactNode
  required?: boolean
  /** Show a quiet "Optional" marker. */
  optional?: boolean
  disabled?: boolean
  /** Override the generated control id. */
  id?: string
  /** 'stack': label above. 'inline': label + hint left, control right (settings rows). */
  layout?: 'stack' | 'inline'
  /** Visually hide the label (still announced). */
  hideLabel?: boolean
  /** Small action aligned with the label (e.g. "Generate"). */
  labelAction?: ReactNode
  children: ReactNode
}

/** Label + control + hint/error, with id, aria-describedby, aria-invalid and aria-required wired. */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional,
  disabled = false,
  id: idProp,
  layout = 'stack',
  hideLabel,
  labelAction,
  className,
  children,
  ...props
}: FieldProps) {
  const autoId = useId()
  const id = idProp ?? `field-${autoId}`
  const labelId = `${id}-label`
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  const value: FieldContextValue = { id, labelId, describedBy, invalid: !!error, required, disabled }

  const labelEl = (
    <label
      id={labelId}
      htmlFor={id}
      className={cn(
        'text-sm font-medium',
        layout === 'inline' ? 'text-ink' : 'text-ink-2',
        disabled && 'opacity-60',
        hideLabel && 'sr-only',
      )}
    >
      {label}
      {required && (
        <span aria-hidden className="ml-0.5 text-fail-ink">
          *
        </span>
      )}
      {optional && !required && <span className="ml-1.5 text-xs font-normal text-ink-3">Optional</span>}
    </label>
  )

  const hintEl = hint && (
    <p id={hintId} className="text-xs text-ink-3 text-pretty">
      {hint}
    </p>
  )
  const errorEl = error && (
    <p id={errorId} className="flex items-start gap-1.5 text-xs text-fail-ink">
      <CircleAlert aria-hidden className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      <span className="text-pretty">{error}</span>
    </p>
  )

  if (layout === 'inline') {
    return (
      <div className={cn('flex items-start justify-between gap-6', className)} {...props}>
        <div className="flex min-w-0 flex-col gap-0.5 pt-1">
          {labelEl}
          {hintEl}
          {errorEl}
        </div>
        <div className="flex shrink-0 items-center">
          <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)} {...props}>
      {(labelAction || !hideLabel) && (
        <div className={cn('flex min-h-5 items-baseline justify-between gap-3', hideLabel && 'justify-end')}>
          {labelEl}
          {labelAction}
        </div>
      )}
      {hideLabel && !labelAction && labelEl}
      <FieldContext.Provider value={value}>{children}</FieldContext.Provider>
      {(hintEl || errorEl) && (
        <div className="flex flex-col gap-1">
          {errorEl}
          {hintEl}
        </div>
      )}
    </div>
  )
}
