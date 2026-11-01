import { cn } from '@/lib/cn'
import { Skeleton } from '@/ui'

/** Skeleton rows in the grammar shapes (circle · capsule · row), static under reduced motion. */
export function SectionSkeleton({ rows = 3, tall }: { rows?: number; tall?: boolean }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      <Skeleton width={96} height={10} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={cn('flex items-center gap-3 rounded-sm px-2', tall ? 'h-16' : 'h-9')}>
          <Skeleton variant="circle" size={12} />
          <Skeleton height={10} width={`${48 - i * 8}%`} />
          <span className="flex-1" />
          <Skeleton height={10} width={64} className="rounded-full" />
        </div>
      ))}
    </div>
  )
}

