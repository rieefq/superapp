import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import { Link, type LinkProps } from 'react-router'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { toAriaKeyShortcuts } from '@/ui/hooks/hotkeys'
import { KbdCombo } from './Kbd'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-solid' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

/*
 * Hover/press styles are gated on `not-data-disabled` so disabled and loading buttons stay still.
 * Variants: primary = ink-inverted; secondary = 1px strong hairline on a raised key; outline = quieter hairline;
 * ghost = text with hover wash; danger = fail-colored text; danger-solid = solid fail (confirm steps only).
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-inverse text-inverse-ink shadow-inset not-data-disabled:hover:bg-inverse/88 not-data-disabled:active:bg-inverse/78',
  secondary:
    'border border-line-strong bg-raised text-ink shadow-inset not-data-disabled:hover:bg-hover not-data-disabled:active:bg-press',
  outline:
    'border border-line text-ink-2 not-data-disabled:hover:border-line-strong not-data-disabled:hover:text-ink not-data-disabled:active:bg-press',
  ghost: 'text-ink-2 not-data-disabled:hover:bg-hover not-data-disabled:hover:text-ink not-data-disabled:active:bg-press',
  danger: 'text-fail-ink not-data-disabled:hover:bg-fail-tint not-data-disabled:active:bg-fail-tint/70',
  'danger-solid':
    'bg-fail text-inverse-ink shadow-inset not-data-disabled:hover:bg-fail/88 not-data-disabled:active:bg-fail/78',
  link: 'rounded-xs text-accent-ink decoration-accent-ink/40 underline-offset-[3px] not-data-disabled:hover:underline',
}

const SIZE: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 px-2 text-xs pointer-coarse:after:-inset-2.5',
  sm: 'h-7 gap-1.5 px-2.5 text-sm pointer-coarse:after:-inset-2',
  md: 'h-8 gap-1.5 px-3 text-sm pointer-coarse:after:-inset-1.5',
  lg: 'h-10 gap-2 px-4 text-base pointer-coarse:after:-inset-0.5',
}

const ICON_SIZE: Record<ButtonSize, string> = {
  xs: 'size-3.5',
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-4',
}

const SPINNER_SIZE: Record<ButtonSize, number> = { xs: 12, sm: 13, md: 14, lg: 16 }

export interface ButtonStyleOptions {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
}

/** Class string for button-styled elements (use for custom elements that must look like buttons). */
export function buttonClassName({ variant = 'secondary', size = 'md', fullWidth, className }: ButtonStyleOptions = {}): string {
  return cn(
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm font-medium whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-(--dur-1) ease-standard',
    "pointer-coarse:after:absolute pointer-coarse:after:content-['']",
    'data-disabled:cursor-not-allowed data-disabled:opacity-45',
    variant === 'link' ? 'h-auto gap-1 px-0 text-sm after:hidden' : SIZE[size],
    VARIANT[variant],
    fullWidth && 'w-full',
    className,
  )
}

interface ContentProps {
  size: ButtonSize
  variant: ButtonVariant
  leadingIcon?: LucideIcon
  trailingIcon?: LucideIcon
  kbd?: string
  loading?: boolean
  children?: ReactNode
}

function ButtonContent({ size, variant, leadingIcon: Leading, trailingIcon: Trailing, kbd, loading, children }: ContentProps) {
  const inverse = variant === 'primary' || variant === 'danger-solid'
  return (
    <>
      <span className={cn('inline-flex min-w-0 items-center gap-[inherit]', loading && 'invisible')}>
        {Leading && <Leading aria-hidden className={cn(ICON_SIZE[size], '-ml-0.5 shrink-0')} strokeWidth={1.75} />}
        {children != null && <span className="truncate">{children}</span>}
        {Trailing && <Trailing aria-hidden className={cn(ICON_SIZE[size], '-mr-0.5 shrink-0')} strokeWidth={1.75} />}
        {kbd && (
          <KbdCombo aria-hidden combo={kbd} variant="plain" tone={inverse ? 'inverse' : 'default'} className="ml-1 pointer-coarse:hidden" />
        )}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={SPINNER_SIZE[size]} />
        </span>
      )}
    </>
  )
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: LucideIcon
  trailingIcon?: LucideIcon
  /** Shortcut hint shown inside the button, e.g. 'mod+enter'. Display only — bind it with useHotkey. */
  kbd?: string
  /** Shows a spinner, keeps the width, sets aria-busy and ignores clicks. */
  loading?: boolean
  fullWidth?: boolean
}

/** The button. Primary is ink-inverted; color is reserved for meaning (danger = fail). */
export function Button({
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  kbd,
  loading,
  fullWidth,
  disabled,
  type = 'button',
  className,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const inert = disabled || loading
  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      data-disabled={inert ? '' : undefined}
      data-variant={variant}
      aria-keyshortcuts={kbd ? toAriaKeyShortcuts(kbd) : undefined}
      className={buttonClassName({ variant, size, fullWidth, className })}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (loading) {
          e.preventDefault()
          return
        }
        onClick?.(e)
      }}
      {...props}
    >
      <ButtonContent size={size} variant={variant} leadingIcon={leadingIcon} trailingIcon={trailingIcon} kbd={kbd} loading={loading}>
        {children}
      </ButtonContent>
    </button>
  )
}

export interface ButtonLinkProps extends Omit<LinkProps, 'className'> {
  ref?: Ref<HTMLAnchorElement>
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: LucideIcon
  trailingIcon?: LucideIcon
  kbd?: string
  fullWidth?: boolean
  className?: string
}

/** A react-router Link that looks like a Button (navigation, not actions). */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  leadingIcon,
  trailingIcon,
  kbd,
  fullWidth,
  className,
  children,
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      data-variant={variant}
      aria-keyshortcuts={kbd ? toAriaKeyShortcuts(kbd) : undefined}
      className={buttonClassName({ variant, size, fullWidth, className })}
      {...props}
    >
      <ButtonContent size={size} variant={variant} leadingIcon={leadingIcon} trailingIcon={trailingIcon} kbd={kbd}>
        {children as ReactNode}
      </ButtonContent>
    </Link>
  )
}
