import { useState, type HTMLAttributes, type Ref } from 'react'
import { HUES, type Hue } from '@/core/types'
import { cn } from '@/lib/cn'
import { PrimitiveStyles } from './styles'
import { HUE_SUBTLE } from './tones'

/** Deterministic identity hue for a name/id (stable across sessions). */
export function hueFor(seed: string): Hue {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return HUES[h % HUES.length]
}

/** "Morgan Lee" → "ML", "atlas" → "AT", "GH" stays "GH". */
export function initialsOf(name: string, max = 2): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) {
    const w = words[0]
    return (w.length <= max && w === w.toUpperCase() ? w : w.slice(0, max)).toUpperCase()
  }
  return words
    .slice(0, max)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

const SIZE = {
  xs: { box: 'size-4', text: 'text-[8px]', max: 1, status: 'size-1.5' },
  sm: { box: 'size-5', text: 'text-[9px]', max: 2, status: 'size-1.5' },
  md: { box: 'size-6', text: 'text-[10px]', max: 2, status: 'size-2' },
  lg: { box: 'size-8', text: 'text-xs', max: 2, status: 'size-2.5' },
  xl: { box: 'size-10', text: 'text-sm', max: 2, status: 'size-3' },
} as const

const STATUS = {
  live: 'bg-live atrium-breathe',
  attn: 'bg-attn',
  done: 'bg-done',
  fail: 'bg-fail',
  idle: 'bg-ink-4',
} as const

export interface AvatarProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>
  /** Name used for initials, hue and the accessible label. */
  name: string
  /** Override the derived identity hue. */
  hue?: Hue
  /** Explicit monogram (integrations: 'GH'). */
  monogram?: string
  src?: string
  size?: keyof typeof SIZE
  /** circle = people; square = agents, projects, integrations (monogram). */
  shape?: 'circle' | 'square'
  /** Small presence/state dot. */
  status?: keyof typeof STATUS
  /** Decorative when the name is already visible next to it. */
  decorative?: boolean
}

/** Identity mark: initials on a tinted identity hue, or an image. */
export function Avatar({
  name,
  hue,
  monogram,
  src,
  size = 'md',
  shape = 'circle',
  status,
  decorative,
  className,
  ...props
}: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const s = SIZE[size]
  const h = hue ?? hueFor(name)
  const showImage = src && !failed
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
      className={cn('relative inline-flex shrink-0', className)}
      {...props}
    >
      {status === 'live' && <PrimitiveStyles />}
      <span
        className={cn(
          'inline-grid place-items-center overflow-hidden font-semibold leading-none tracking-[0.02em] select-none',
          s.box,
          s.text,
          shape === 'circle' ? 'rounded-full' : size === 'lg' || size === 'xl' ? 'rounded-sm' : 'rounded-xs',
          showImage ? 'bg-hover' : HUE_SUBTLE[h],
          'shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_14%,transparent)]',
        )}
      >
        {showImage ? (
          <img src={src} alt="" className="size-full object-cover" onError={() => setFailed(true)} />
        ) : (
          (monogram ?? initialsOf(name, s.max)).slice(0, s.max)
        )}
      </span>
      {status && (
        <span
          aria-hidden
          className={cn(
            'absolute -right-px -bottom-px rounded-full ring-2 ring-canvas',
            s.status,
            STATUS[status],
          )}
        />
      )}
    </span>
  )
}

export interface AvatarGroupProps extends HTMLAttributes<HTMLDivElement> {
  people: { name: string; hue?: Hue; src?: string }[]
  max?: number
  size?: AvatarProps['size']
}

/** Overlapping avatars with a "+N" overflow count. */
export function AvatarGroup({ people, max = 4, size = 'md', className, ...props }: AvatarGroupProps) {
  const shown = people.slice(0, max)
  const rest = people.length - shown.length
  return (
    <div role="group" aria-label={people.map((p) => p.name).join(', ')} className={cn('flex items-center', className)} {...props}>
      {shown.map((p, i) => (
        <Avatar key={p.name + i} {...p} size={size} decorative className={cn(i > 0 && '-ml-1.5', 'rounded-full ring-2 ring-canvas')} />
      ))}
      {rest > 0 && (
        <span
          aria-hidden
          className={cn(
            '-ml-1.5 inline-grid place-items-center rounded-full bg-hover font-mono text-ink-3 ring-2 ring-canvas',
            SIZE[size].box,
            'text-[9px]',
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  )
}
