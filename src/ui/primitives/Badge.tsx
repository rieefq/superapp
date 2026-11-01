import type { HTMLAttributes, ReactNode, Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PrimitiveStyles } from './styles'
import { toneClasses, toneFill, type Tone, type ToneVariant } from './tones'

export type BadgeTone = Tone
export type BadgeVariant = ToneVariant

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>
  /** neutral | accent | live | attn | done | fail | sim (hatched) | `hue:<name>`. Default neutral. */
  tone?: Tone
  variant?: BadgeVariant
  size?: 'sm' | 'md'
  icon?: LucideIcon
  /** Leading status dot in the tone's color. */
  dot?: boolean
  /** Breathing dot — only for things happening right now (live). */
  pulse?: boolean
  /** meta-caps tag (SIM, LIVE, BETA): mono uppercase, 16px tall. */
  mono?: boolean
  children?: ReactNode
}

const SIZE = {
  sm: 'h-[18px] gap-1 px-1.5 text-2xs',
  md: 'h-[22px] gap-1.5 px-2 text-xs',
}

/** Compact status/identity label. Color is never the only signal — always pair with text. */
export function Badge({
  tone = 'neutral',
  variant = 'subtle',
  size = 'sm',
  icon: Icon,
  dot,
  pulse,
  mono,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-xs leading-none font-medium whitespace-nowrap select-none',
        mono ? 'type-meta-caps h-4 gap-1 px-1' : SIZE[size],
        toneClasses(tone, variant),
        className,
      )}
      {...props}
    >
      {pulse && <PrimitiveStyles />}
      {dot && (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            variant === 'solid' ? 'bg-current opacity-80' : toneFill(tone),
            pulse && 'atrium-breathe',
          )}
        />
      )}
      {Icon && <Icon aria-hidden className={cn('shrink-0', size === 'sm' ? 'size-3' : 'size-3.5')} strokeWidth={2} />}
      {children != null && <span className="truncate">{children}</span>}
    </span>
  )
}
