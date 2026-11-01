import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Placement } from './positioning'
import { Spinner } from './Spinner'
import { Tooltip } from './Tooltip'

export type IconButtonVariant = 'ghost' | 'secondary' | 'outline' | 'primary' | 'danger'
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-3 not-data-disabled:hover:bg-hover not-data-disabled:hover:text-ink not-data-disabled:active:bg-press',
  secondary:
    'border border-line-strong bg-raised text-ink-2 shadow-inset not-data-disabled:hover:bg-hover not-data-disabled:hover:text-ink not-data-disabled:active:bg-press',
  outline:
    'border border-line text-ink-3 not-data-disabled:hover:border-line-strong not-data-disabled:hover:text-ink not-data-disabled:active:bg-press',
  primary: 'bg-inverse text-inverse-ink shadow-inset not-data-disabled:hover:bg-inverse/88 not-data-disabled:active:bg-inverse/78',
  danger: 'text-fail-ink not-data-disabled:hover:bg-fail-tint not-data-disabled:active:bg-fail-tint/70',
}

const SIZE: Record<IconButtonSize, { box: string; icon: string; spinner: number }> = {
  xs: { box: 'size-6 pointer-coarse:after:-inset-2.5', icon: 'size-3.5', spinner: 12 },
  sm: { box: 'size-7 pointer-coarse:after:-inset-2', icon: 'size-4', spinner: 13 },
  md: { box: 'size-8 pointer-coarse:after:-inset-1.5', icon: 'size-4', spinner: 14 },
  lg: { box: 'size-10 pointer-coarse:after:-inset-0.5', icon: 'size-[18px]', spinner: 16 },
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  ref?: Ref<HTMLButtonElement>
  icon: LucideIcon
  /** Accessible name; also the tooltip text. */
  label: string
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** Toggle buttons: sets aria-pressed and the pressed look. Leave undefined for plain actions. */
  active?: boolean
  /** Shortcut shown in the tooltip (display only). */
  shortcut?: string
  /** false hides the tooltip; a node replaces its content. */
  tooltip?: boolean | ReactNode
  tooltipPlacement?: Placement
  loading?: boolean
}

/** Square icon-only button with a tooltip. The label is always the accessible name. */
export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  active,
  shortcut,
  tooltip = true,
  tooltipPlacement = 'top',
  loading,
  disabled,
  type = 'button',
  className,
  onClick,
  ...props
}: IconButtonProps) {
  const s = SIZE[size]
  const inert = disabled || loading
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-pressed={active}
      aria-busy={loading || undefined}
      disabled={disabled}
      data-disabled={inert ? '' : undefined}
      data-active={active ? '' : undefined}
      className={cn(
        'relative inline-grid shrink-0 cursor-pointer place-items-center rounded-sm',
        'transition-[background-color,border-color,color,box-shadow,opacity] duration-(--dur-1) ease-standard',
        "pointer-coarse:after:absolute pointer-coarse:after:content-['']",
        'data-disabled:cursor-not-allowed data-disabled:opacity-45',
        s.box,
        VARIANT[variant],
        active && variant !== 'primary' && 'bg-press text-ink shadow-[inset_0_0_0_1px_var(--line)]',
        className,
      )}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (loading) return
        onClick?.(e)
      }}
      {...props}
    >
      {loading ? <Spinner size={s.spinner} /> : <Icon aria-hidden className={s.icon} strokeWidth={1.75} />}
    </button>
  )
  if (tooltip === false) return button
  return (
    <Tooltip content={tooltip === true ? label : tooltip} shortcut={shortcut} placement={tooltipPlacement} asLabel={tooltip === true}>
      {button}
    </Tooltip>
  )
}
