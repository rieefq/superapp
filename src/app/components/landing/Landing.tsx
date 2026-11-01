import { useRef } from 'react'
import { CornerDownRight, RotateCw } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { workspaceForPath } from '@/app/registry'
import { attachRun } from '@/app/shell/store'
import { runEngine } from '@/core/runs'
import { entityRoute, KIND_META, RUN_KIND_LABEL, useEntity } from '@/core/services'
import { isRunActive, type EntityRef, type Run } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Button, Tooltip, toast } from '@/ui'
import { HoldButton, SaveToKnowledgeButton } from '../actions/actions'
import { EntityChip, ProvenanceLine, RUN_KIND_ICON, RunStatusGlyph, StepTape } from '../sig'
import { useDerived, type DerivedItem } from './useDerived'

/**
 * DerivedRow and LandedCard (§5.4.12): what was made from a source shows under it while its run works
 * (`↳ Research · Stripe webhook retries · ● 2/7` + tape; click attaches the run) and lands as a card
 * when the run ends (summary, outputs, Colophon, Open · Save to Knowledge · Hold; Retry when it failed).
 */

const doneSteps = (run: Run) => run.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length

function useAttach(): (runId: string) => void {
  const { pathname } = useLocation()
  return (runId) => attachRun(runId, workspaceForPath(pathname).id)
}

function kindLabel(item: DerivedItem): string {
  if (item.ref.kind === 'run' && item.run) return RUN_KIND_LABEL[item.run.kind]
  if (item.ref.kind === 'session') return 'Coding session'
  if (item.ref.kind === 'investigation') return 'Research'
  if (item.ref.kind === 'asset') return 'Studio'
  return KIND_META[item.ref.kind].label
}

export interface DerivedRowProps {
  item: DerivedItem
  className?: string
}

/** `↳ Research · Stripe webhook retries · ● 2/7` with a mini tape. Click → attach the run. */
export function DerivedRow({ item, className }: DerivedRowProps) {
  const entity = useEntity(item.ref)
  const attach = useAttach()
  const run = item.run
  const total = run ? Math.max(run.steps.length, run.plannedSteps ?? 0) : 0
  const label = `${kindLabel(item)}: ${entity.title}${run ? `, ${doneSteps(run)} of ${total || '?'} steps` : ''}. Attach the run`
  return (
    <button
      type="button"
      onClick={() => run && attach(run.id)}
      disabled={!run}
      aria-label={label}
      className={cn(
        'group/derived flex h-7 w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left transition-colors duration-(--dur-1) hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent',
        className,
      )}
    >
      <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      <span className="type-caption shrink-0 text-ink-3">{kindLabel(item)}</span>
      <span aria-hidden className="text-ink-4">
        ·
      </span>
      <span className="type-body-sm min-w-0 truncate text-ink-2 group-hover/derived:text-ink">{entity.title}</span>
      {run && (
        <>
          <span aria-hidden className="text-ink-4">
            ·
          </span>
          <RunStatusGlyph status={run.status} decorative />
          <span className="type-meta shrink-0 text-ink-3">
            {doneSteps(run)}/{total || '…'}
          </span>
          <StepTape run={run} size="xs" max={12} className="ml-0.5 shrink-0" />
        </>
      )}
    </button>
  )
}

export interface LandedCardProps {
  run: Run
  /** The landed thing (an investigation, session, task…) when it is not the run itself. */
  subject?: EntityRef
  /** Override the title (e.g. a notification's sentence). */
  title?: string
  /** Override the summary (e.g. a notification body). */
  summary?: string
  /** One-line summary (Home › Landed). */
  compact?: boolean
  /** Header time (default: when the run ended). */
  at?: number
  /** Called when the card is opened or acted on (e.g. mark the landing seen). */
  onSeen?: () => void
  className?: string
}

/** A run that ended, landed where it was requested (and in Home › Landed). */
export function LandedCard({ run, subject, title: titleProp, summary, compact, at, onSeen, className }: LandedCardProps) {
  const navigate = useNavigate()
  const attach = useAttach()
  // H / S hold or save while focus is inside the card.
  const cardRef = useRef<HTMLElement>(null)
  const target: EntityRef = subject ?? { kind: 'run', id: run.id }
  const entity = useEntity(target)
  const Icon = RUN_KIND_ICON[run.kind]
  const failed = run.status === 'failed'
  const stopped = run.status === 'cancelled'
  const outputs = run.outputs.filter((o) => !(o.kind === target.kind && o.id === target.id)).slice(0, 4)
  const title = titleProp ?? (subject ? entity.title : run.title)
  const text = failed ? (run.error ?? 'The run failed.') : (summary ?? run.summary ?? (stopped ? 'Stopped before it finished.' : 'Finished.'))
  const open = () => {
    onSeen?.()
    navigate(entityRoute(target))
  }
  const retry = () => {
    const next = runEngine.retry(run.id)
    onSeen?.()
    if (next) {
      toast({ title: `Retrying “${run.title}”`, action: { label: 'Attach', onClick: () => attach(next.id) } })
    } else {
      toast({ tone: 'error', title: 'Couldn’t retry this run', description: 'Its script is no longer available. Start it again from its workspace.' })
    }
  }
  return (
    <article
      ref={cardRef}
      aria-label={`${RUN_KIND_LABEL[run.kind]} ${failed ? 'failed' : stopped ? 'stopped' : 'landed'}: ${title}`}
      className={cn('relative flex min-w-0 overflow-hidden rounded-md border border-line bg-canvas', className)}
    >
      {run.simulated && <span aria-hidden className="sim-band shrink-0 self-stretch" />}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <header className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden className="size-4 shrink-0 text-ink-3" strokeWidth={1.75} />
          <button
            type="button"
            onClick={open}
            className="type-body-sm min-w-0 truncate rounded-xs text-left font-medium text-ink hover:underline hover:decoration-line-input hover:underline-offset-2"
          >
            {title}
          </button>
          <RunStatusGlyph status={run.status} />
          <span className="flex-1" />
          <Tooltip content="Attach the run">
            <button type="button" onClick={() => attach(run.id)} className="type-meta shrink-0 rounded-xs text-ink-3 hover:text-ink">
              {timeAgo(at ?? run.endedAt ?? run.createdAt)}
            </button>
          </Tooltip>
        </header>
        <p className={cn('type-body-sm text-pretty', compact ? 'line-clamp-1' : 'line-clamp-2', failed ? 'text-fail-ink' : 'text-ink-2')}>{text}</p>
        {outputs.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {outputs.map((o) => (
              <EntityChip key={`${o.kind}:${o.id}`} entity={o} size="sm" />
            ))}
          </div>
        )}
        <ProvenanceLine run={run} onViewRun={() => attach(run.id)} />
        <footer className="-mb-1 -ml-2 flex flex-wrap items-center gap-0.5">
          {failed || stopped ? (
            <Button size="xs" variant="ghost" leadingIcon={RotateCw} onClick={retry}>
              Retry
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" onClick={open}>
            Open
          </Button>
          {!failed && <SaveToKnowledgeButton entity={target} size="xs" variant="ghost" onDone={onSeen} hotkeyScope={cardRef} />}
          <HoldButton entity={target} size="xs" variant="ghost" hotkeyScope={cardRef} />
        </footer>
      </div>
    </article>
  )
}

export interface DerivedListProps {
  source: EntityRef
  className?: string
}

/** Everything derived from a source: DerivedRows while working, LandedCards once they end. */
export function DerivedList({ source, className }: DerivedListProps) {
  const items = useDerived(source)
  if (!items.length) return null
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {items.map((item) =>
        item.run && !isRunActive(item.run.status) ? (
          <LandedCard key={`${item.ref.kind}:${item.ref.id}`} run={item.run} subject={item.ref.kind === 'run' ? undefined : item.ref} />
        ) : item.run ? (
          <DerivedRow key={`${item.ref.kind}:${item.ref.id}`} item={item} />
        ) : (
          <DerivedChip key={`${item.ref.kind}:${item.ref.id}`} entity={item.ref} />
        ),
      )}
    </div>
  )
}

/** Derived things that do not run (a task for you, a note): `↳ Task · Fix login redirect` as a chip row. */
function DerivedChip({ entity }: { entity: EntityRef }) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-2 px-1.5">
      <CornerDownRight aria-hidden className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      <EntityChip entity={entity} size="sm" showKind />
    </div>
  )
}
