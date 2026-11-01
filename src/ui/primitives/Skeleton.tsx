import type { CSSProperties, HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { PrimitiveStyles } from './styles'

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'rect' | 'circle'
  /** text: number of lines (last one is shorter). */
  lines?: number
  width?: number | string
  height?: number | string
  /** circle diameter. */
  size?: number
  /** Disable the shimmer (e.g. many skeletons on screen). */
  still?: boolean
}

const px = (v: number | string | undefined) => (typeof v === 'number' ? `${v}px` : v)

/** Loading placeholder with a quiet shimmer (static under reduced motion). Hidden from assistive tech. */
export function Skeleton({ variant = 'rect', lines = 3, width, height, size = 32, still, className, style, ...props }: SkeletonProps) {
  const fill = cn('bg-hover', !still && 'atrium-shimmer')
  if (variant === 'text') {
    return (
      <div aria-hidden className={cn('flex flex-col gap-2 py-0.5', className)} style={{ width: px(width), ...style }} {...props}>
        <PrimitiveStyles />
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn('h-2.5 rounded-xs', fill)}
            style={{ width: lines > 1 && i === lines - 1 ? '62%' : i % 3 === 1 ? '92%' : '100%' }}
          />
        ))}
      </div>
    )
  }
  const dims: CSSProperties =
    variant === 'circle' ? { width: size, height: size } : { width: px(width) ?? '100%', height: px(height) ?? 16 }
  return (
    <div
      aria-hidden
      className={cn('shrink-0', variant === 'circle' ? 'rounded-full' : 'rounded-sm', fill, className)}
      style={{ ...dims, ...style }}
      {...props}
    >
      <PrimitiveStyles />
    </div>
  )
}
