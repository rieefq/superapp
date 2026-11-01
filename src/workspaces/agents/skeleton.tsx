import { cn } from '@/lib/cn'

/*
 * Loading skeletons drawn in the shape grammar (§5.4.14): circles for actors, capsules for runs,
 * row rectangles for lists. Static, with a breathing opacity (still under reduced motion).
 */

const pulse = 'sig-breathe'

function Bar({ className }: { className?: string }) {
  return <span aria-hidden className={cn('block rounded-sm bg-hover', pulse, className)} />
}

export function RowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden className={cn('flex flex-col gap-1 px-3 py-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-3 px-2">
          <span className={cn('size-3 rounded-full bg-hover', pulse)} />
          <Bar className="h-3 w-[38%]" />
          <span className={cn('h-3 w-24 rounded-full bg-hover', pulse)} />
          <Bar className="ml-auto h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export function CardsSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="flex h-[188px] flex-col gap-3 rounded-md border border-line p-4">
          <div className="flex items-center gap-3">
            <span className={cn('size-10 rounded-full bg-hover', pulse)} />
            <div className="flex flex-1 flex-col gap-1.5">
              <Bar className="h-3.5 w-1/2" />
              <Bar className="h-3 w-1/3" />
            </div>
          </div>
          <Bar className="h-3 w-3/4" />
          <span className={cn('h-3 w-28 rounded-full bg-hover', pulse)} />
          <Bar className="mt-auto h-3 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** Fallback while a lazily loaded Agents view arrives. */
export function ViewSkeleton({ kind }: { kind: 'grid' | 'form' | 'detail' }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <span className={cn('size-6 rounded-full bg-hover', pulse)} />
        <Bar className="h-4 w-40" />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-4 md:p-6">
        {kind === 'grid' ? (
          <CardsSkeleton />
        ) : kind === 'form' ? (
          <div className="mx-auto flex max-w-[640px] flex-col gap-4">
            <Bar className="h-6 w-1/3" />
            <Bar className="h-9 w-full" />
            <Bar className="h-9 w-full" />
            <Bar className="h-24 w-full" />
          </div>
        ) : (
          <div className="mx-auto flex max-w-[880px] flex-col gap-4">
            <div className="flex items-center gap-3">
              <span className={cn('size-12 rounded-full bg-hover', pulse)} />
              <div className="flex flex-1 flex-col gap-2">
                <Bar className="h-4 w-1/4" />
                <Bar className="h-3 w-2/3" />
              </div>
            </div>
            <RowsSkeleton rows={6} className="px-0" />
          </div>
        )}
      </div>
    </div>
  )
}
