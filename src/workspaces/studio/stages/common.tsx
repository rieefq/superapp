import type { ReactNode } from 'react'
import { ArrowUpRight, RotateCcw, Square } from 'lucide-react'
import { attachRun } from '@/app/shell/store'
import { useRun } from '@/core/runs'
import { retryGeneration, setCurrentVersion, stopGeneration, versionContent } from '@/core/services/studio'
import type { Asset } from '@/core/types'
import { cn } from '@/lib/cn'
import { Button, RunStatusGlyph, StepTape, runCurrentLine } from '@/ui'

/** Over a preview while a version is generating: the run's tape, its current step, View run and Stop. */
export function GeneratingCard({ asset, className }: { asset: Asset; className?: string }) {
  const run = useRun(asset.runId)
  const next = asset.versions.length + 1
  return (
    <div role="status" aria-live="off" className={cn('flex max-w-[min(360px,90%)] flex-col items-center gap-2.5 rounded-md border border-line bg-overlay px-4 py-3 text-center shadow-e1', className)}>
      <span className="type-label text-ink-3">Generating v{next}</span>
      {run ? <StepTape run={run} size="md" max={12} /> : <RunStatusGlyph status="queued" size={12} />}
      {run && <span className="type-body-sm max-w-full truncate text-live-ink">{runCurrentLine(run)}</span>}
      <span className="flex items-center gap-1">
        {run && (
          <Button size="xs" variant="ghost" leadingIcon={ArrowUpRight} onClick={() => attachRun(run.id, 'studio')}>
            View run
          </Button>
        )}
        <Button size="xs" variant="ghost" leadingIcon={Square} onClick={() => stopGeneration(asset.id)}>
          Stop
        </Button>
      </span>
    </div>
  )
}

/** A failed first generation: what happened, and Retry. */
export function FailedCard({ asset, className }: { asset: Asset; className?: string }) {
  const run = useRun(asset.runId)
  const stopped = run?.status === 'cancelled'
  return (
    <div role="status" className={cn('flex max-w-[min(380px,90%)] flex-col items-center gap-2 rounded-md border border-line bg-overlay px-4 py-3 text-center shadow-e1', className)}>
      <span className="flex items-center gap-1.5 text-fail-ink">
        <RunStatusGlyph status={stopped ? 'cancelled' : 'failed'} size={12} />
        <span className="type-body-sm font-medium">{stopped ? 'Generation stopped' : 'Generation failed'}</span>
      </span>
      <span className="type-caption text-ink-3">
        {run ? runCurrentLine(run) : 'This asset has no version yet.'} Retry starts a fresh run with the same brief.
      </span>
      <Button size="sm" variant="secondary" leadingIcon={RotateCcw} onClick={() => retryGeneration(asset.id)}>
        Retry
      </Button>
    </div>
  )
}

/** The light table under every preview: --surface-sunken, generous padding, centered content. */
export function LightTable({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col items-center gap-3 bg-sunken px-4 py-5 md:px-8 md:py-6', className)}>{children}</div>
}

/** A label over one side of an A/B compare. */
export function SideLabel({ side, index, current }: { side: 'A' | 'B'; index: number; current?: boolean }) {
  return (
    <span className="type-meta flex items-center gap-1.5 text-ink-3">
      <span className="type-meta-caps grid size-4 place-items-center rounded-xs border border-line-strong text-ink">{side}</span>v{index + 1}
      {current && <span>· current</span>}
    </span>
  )
}

/**
 * A version whose text was never recorded (seeded data from before per-version text): say so, and
 * offer the newest version that has its text, instead of showing another version's words.
 */
export function UnrecordedCard({ asset, index, className }: { asset: Asset; index: number; className?: string }) {
  let latest = -1
  for (let i = asset.versions.length - 1; i >= 0; i--) {
    if (i !== index && versionContent(asset, i).known) {
      latest = i
      break
    }
  }
  return (
    <div role="status" className={cn('flex max-w-[min(420px,90%)] flex-col items-center gap-2 rounded-md border border-line bg-overlay px-4 py-3 text-center shadow-e1', className)}>
      <span className="type-body-sm font-medium text-ink">v{index + 1}’s text wasn’t kept</span>
      <span className="type-caption text-ink-3">It predates per-version text in this build — only its preview and prompt were recorded.</span>
      {latest >= 0 && (
        <Button size="sm" variant="secondary" onClick={() => setCurrentVersion(asset.id, latest)}>
          Show v{latest + 1}
        </Button>
      )}
    </div>
  )
}

/** True when a version exists but its text was not recorded. */
export function isUnrecorded(asset: Asset, index: number): boolean {
  return !!asset.versions[index] && !versionContent(asset, index).known && asset.status !== 'generating'
}
