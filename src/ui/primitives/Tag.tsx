import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from 'react'
import { Check, X, type LucideIcon } from 'lucide-react'
import type { Hue } from '@/core/types'
import { cn } from '@/lib/cn'
import { HUE_FILL } from './tones'

export interface TagProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  ref?: Ref<HTMLButtonElement>
  size?: 'sm' | 'md'
  icon?: LucideIcon
  /** Identity hue swatch before the label (collections, projects). */
  hue?: Hue
  /** Toggleable filter chip: renders aria-pressed and a check when selected. */
  selectable?: boolean
  selected?: boolean
  onSelectedChange?: (selected: boolean) => void
  /** Show a remove (×) button. */
  onRemove?: () => void
  /** Accessible name for the remove button. Default: `Remove <label>`. */
  removeLabel?: string
  children: ReactNode
}

const SIZE = {
  sm: { root: 'h-6 text-xs', pad: 'px-2', gap: 'gap-1.5', icon: 'size-3' },
  md: { root: 'h-7 text-sm', pad: 'px-2.5', gap: 'gap-1.5', icon: 'size-3.5' },
}

/**
 * Chip for filters, labels and tokens. Static by default; `selectable` makes it a toggle button;
 * `onRemove` adds a separate remove button (Backspace/Delete on the chip also removes).
 */
export function Tag({
  size = 'sm',
  icon: Icon,
  hue,
  selectable,
  selected = false,
  onSelectedChange,
  onRemove,
  removeLabel,
  disabled,
  className,
  children,
  onClick,
  onKeyDown,
  ref,
  ...props
}: TagProps) {
  const s = SIZE[size]
  const interactive = selectable || !!onClick
  const content = (
    <>
      {selectable && selected ? (
        <Check aria-hidden className={cn(s.icon, 'shrink-0')} strokeWidth={2.25} />
      ) : Icon ? (
        <Icon aria-hidden className={cn(s.icon, 'shrink-0 opacity-80')} strokeWidth={2} />
      ) : hue ? (
        <span aria-hidden className={cn('size-2 shrink-0 rounded-[2px]', HUE_FILL[hue])} />
      ) : null}
      <span className="truncate">{children}</span>
    </>
  )

  const base = cn(
    'inline-flex max-w-full shrink-0 items-center rounded-xs border leading-none whitespace-nowrap',
    'transition-[background-color,border-color,color] duration-(--dur-1) ease-standard',
    s.root,
    selected
      ? 'border-accent/40 bg-accent-tint text-accent-ink'
      : 'border-line bg-transparent text-ink-2',
    disabled && 'opacity-50',
    className,
  )

  const removeButton = onRemove && (
    <button
      type="button"
      aria-label={removeLabel ?? `Remove ${typeof children === 'string' ? children : ''}`.trim()}
      disabled={disabled}
      onClick={(e: MouseEvent) => {
        e.stopPropagation()
        onRemove()
      }}
      className={cn(
        '-mr-1 ml-0.5 grid size-4 shrink-0 place-items-center rounded-xs text-ink-3',
        'hover:bg-press hover:text-ink focus-visible:outline-offset-0',
        'pointer-coarse:size-6',
      )}
    >
      <X aria-hidden className="size-3" strokeWidth={2.25} />
    </button>
  )

  if (!interactive) {
    return (
      <span className={cn(base, s.gap, s.pad, onRemove && 'pr-1.5')}>
        {content}
        {removeButton}
      </span>
    )
  }

  return (
    <span className={cn(base, 'p-0', onRemove && 'pr-1.5')}>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-pressed={selectable ? selected : undefined}
        onClick={(e) => {
          onClick?.(e)
          if (!e.defaultPrevented && selectable) onSelectedChange?.(!selected)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (!e.defaultPrevented && onRemove && (e.key === 'Backspace' || e.key === 'Delete')) {
            e.preventDefault()
            onRemove()
          }
        }}
        className={cn(
          'inline-flex h-full min-w-0 items-center rounded-xs focus-visible:outline-offset-1',
          s.gap,
          s.pad,
          onRemove && 'pr-1',
          !disabled && !selected && 'hover:text-ink',
        )}
        {...props}
      >
        {content}
      </button>
      {removeButton}
    </span>
  )
}

/** Alias: chips and tags are the same primitive. */
export const Chip = Tag
export type ChipProps = TagProps
