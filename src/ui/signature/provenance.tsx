import { useId, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronRight, Copy } from 'lucide-react'
import { resolveEntity } from '@/core/services/entities'
import { useApprovalsForRun } from '@/core/services/approvals'
import type { Approval, EntityRef, Run, Usage } from '@/core/types'
import { cn } from '@/lib/cn'
import { CodeBlock } from '@/ui/display'
import { useCopy } from '@/ui/hooks'
import { Button, Tooltip } from '@/ui/primitives'
import { EntityChip } from './entity'
import { formatClock, formatCost, formatSeconds, formatTok, formatTokenCount } from './format'
import { LiveBadge, OriginBadge, SimBadge } from './honesty'
import { useRunElapsed } from './RunPill'
import { buildReceipt, modelInfoFor, receiptJson, receiptToMarkdown, type ReceiptModel } from './receipt'
import { tapeProgress } from './tape'

/* Colophon (`ProvenanceLine`), RunMeta and the Receipt (docs/DESIGN.md §5.4.6, §3.5). */

const Sep = () => (
  <span aria-hidden className="text-ink-4">
    ·
  </span>
)

const ESTIMATE_NOTE = 'Estimated at reference pricing; no money was spent.'

export interface ProvenanceTool {
  label: string
  simulated: boolean
}

export interface ProvenanceLineProps {
  /** "Claude Sonnet 5.5", "Simulator · Deep". Derived from `run` when omitted. */
  modelLabel?: string
  simulated?: boolean
  usage?: Usage
  durationMs?: number
  /** Live run whose provider did not report usage: tokens and cost read as estimates. */
  costIsEstimate?: boolean
  /** Extra nodes appended at the end of the line. */
  extra?: ReactNode
  className?: string
  /** Derive everything from a run. Explicit props win. */
  run?: Run
  /** Tools used; listed only when live and simulated work mix ("· tools: GitHub read LIVE, Web search SIM"). */
  tools?: readonly ProvenanceTool[]
  /** Ends the line with "· Stopped by you". Defaults to the run being cancelled. */
  stopped?: boolean
  /** Who stopped it (default "you"). */
  stoppedBy?: string
  /** Shows the "View run" link. */
  onViewRun?: () => void
}

/**
 * The provenance line under every AI output, in `type-meta` ink-3:
 * live `Claude Sonnet 5.5 · 1,204 tok · $0.004 · 3.1 s · View run`;
 * simulated `[SIM] Simulator · Deep · No model was called · ~980 tok est. · $0.00 · 1.8 s · View run`.
 */
export function ProvenanceLine({
  modelLabel, simulated, usage, durationMs, costIsEstimate, extra, className, run, tools, stopped, stoppedBy = 'you', onViewRun,
}: ProvenanceLineProps) {
  const sim = simulated ?? run?.simulated ?? false
  const model = modelLabel ?? (run ? modelInfoFor(run.modelId, run.simulated)?.label : undefined) ?? (sim ? 'Simulator' : undefined)
  const u = usage ?? run?.usage
  const tokens = u ? u.inputTokens + u.outputTokens : undefined
  const duration = durationMs ?? (run?.endedAt !== undefined ? run.endedAt - (run.startedAt ?? run.createdAt) : undefined)
  const toolList = useMemo(() => tools ?? (run ? buildReceipt(run).tools : []), [tools, run])
  const mixed = toolList.some((t) => t.simulated) && (toolList.some((t) => !t.simulated) || !sim)
  const isStopped = stopped ?? run?.status === 'cancelled'
  const estimate = sim || !!costIsEstimate

  const items: ReactNode[] = []
  if (model) items.push(<span key="model" className="text-ink-2">{model}</span>)
  if (sim) items.push(<span key="nomodel">No model was called</span>)
  if (tokens !== undefined) items.push(<span key="tok">{formatTok(tokens, { est: estimate })}</span>)
  if (u) {
    items.push(
      sim ? (
        <Tooltip key="cost" content={`No money was spent. Est. ${formatCost(u.costUsd)} at reference pricing.`}>
          <span>$0.00</span>
        </Tooltip>
      ) : costIsEstimate ? (
        <Tooltip key="cost" content={ESTIMATE_NOTE}>
          <span>{formatCost(u.costUsd, { est: true })}</span>
        </Tooltip>
      ) : (
        <span key="cost">{formatCost(u.costUsd)}</span>
      ),
    )
  }
  if (duration !== undefined) items.push(<span key="dur">{formatSeconds(duration)}</span>)
  if (onViewRun) {
    items.push(
      <button
        key="view"
        type="button"
        onClick={onViewRun}
        className="relative rounded-xs text-ink-3 underline decoration-line-input underline-offset-[3px] transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink focus-visible:outline-offset-1 pointer-coarse:after:absolute pointer-coarse:after:-inset-3 pointer-coarse:after:content-['']"
      >
        View run
      </button>,
    )
  }
  if (mixed && toolList.length) {
    items.push(
      <span key="tools" className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        tools:
        {toolList.map((t, i) => (
          <span key={`${t.label}-${i}`} className="inline-flex items-center gap-1">
            {t.label}
            <span className="inline-flex items-center">
              {t.simulated ? <SimBadge /> : <LiveBadge />}
              {i < toolList.length - 1 && <span aria-hidden>,</span>}
            </span>
          </span>
        ))}
      </span>,
    )
  }
  if (isStopped) items.push(<span key="stopped">Stopped by {stoppedBy}</span>)
  if (extra) items.push(<span key="extra">{extra}</span>)

  return (
    <div className={cn('type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3', className)}>
      {sim && <SimBadge />}
      {items.map((node, i) => (
        <span key={i} className="inline-flex items-center gap-x-1.5">
          {i > 0 && <Sep />}
          {node}
        </span>
      ))}
    </div>
  )
}

export interface RunMetaProps {
  run: Run
  /** Lead with the model label. */
  showModel?: boolean
  className?: string
}

/** Inspector meta row: LIVE/SIM, elapsed · steps n/m · tokens · cost (est.). The tag leads, as in the Colophon. */
export function RunMeta({ run, showModel, className }: RunMetaProps) {
  const elapsed = useRunElapsed(run)
  const tokens = run.usage.inputTokens + run.usage.outputTokens
  const model = showModel ? modelInfoFor(run.modelId, run.simulated)?.label : undefined
  const parts: ReactNode[] = []
  if (model) parts.push(<span className="text-ink-2">{model}</span>)
  parts.push(<span>{formatClock(elapsed)}</span>)
  parts.push(<span>steps {tapeProgress(run)}</span>)
  parts.push(<span>{formatTok(tokens, { est: run.simulated })}</span>)
  parts.push(
    run.simulated ? (
      <Tooltip content={ESTIMATE_NOTE}>
        <span>{formatCost(run.usage.costUsd, { est: true })}</span>
      </Tooltip>
    ) : (
      <span>{formatCost(run.usage.costUsd)}</span>
    ),
  )
  return (
    <div className={cn('type-meta flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3', className)}>
      <OriginBadge simulated={run.simulated} className="mr-0.5" />
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center gap-x-1.5">
          {i > 0 && <Sep />}
          {p}
        </span>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ Receipt

function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-x-3 py-1', className)}>
      <dt className="type-label text-ink-3">{label}</dt>
      <dd className="type-mono-sm min-w-0 text-ink-2">{children}</dd>
    </div>
  )
}

function ShareBar({ share }: { share: number }) {
  return (
    <span aria-hidden className="inline-block h-1 w-10 shrink-0 overflow-hidden rounded-[1px] bg-line align-middle">
      <span className="block h-full bg-ink-3" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
    </span>
  )
}

export interface ReceiptProps {
  run: Run
  /** The run's approvals (default: read live from the database). */
  approvals?: readonly Approval[]
  /** Override the derived "Saw" list (e.g. a chat turn's recorded context). */
  saw?: readonly { ref: EntityRef; tokens: number }[]
  className?: string
}

/**
 * The expanded Colophon: model and provider (LIVE/SIM), tools, capabilities with their decisions,
 * tokens in/out, cost (actual or est.), duration, Saw (with token share), outputs, "Copy receipt
 * (Markdown)" and a "Raw JSON" disclosure.
 */
export function Receipt({ run, approvals: approvalsProp, saw, className }: ReceiptProps) {
  const live = useApprovalsForRun(approvalsProp ? null : run.id)
  const approvals = approvalsProp ?? live
  const r: ReceiptModel = useMemo(() => buildReceipt(run, { approvals, saw }), [run, approvals, saw])
  const { copy, copied } = useCopy()
  const [raw, setRaw] = useState(false)
  const rawId = useId()

  const copyReceipt = () =>
    void copy(
      receiptToMarkdown(run, {
        approvals,
        saw,
        resolveTitle: (ref) => resolveEntity(ref).title,
      }),
    )

  return (
    <section aria-label="Receipt" className={cn('flex flex-col', className)}>
      <dl className="flex flex-col">
        {r.model && (
          <Row label="Model">
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="text-ink">{r.model.label}</span>
              <span className="text-ink-3">{r.model.provider}</span>
              <OriginBadge simulated={r.model.simulated} />
              {r.model.simulated && <span className="text-ink-3">No model was called</span>}
            </span>
          </Row>
        )}
        {r.tools.length > 0 && (
          <Row label="Tools">
            <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {r.tools.map((t) => (
                <span key={`${t.label}-${t.simulated}`} className="inline-flex items-center gap-1">
                  {t.label}
                  {t.uses > 1 && <span className="text-ink-3">×{t.uses}</span>}
                  <OriginBadge simulated={t.simulated} />
                </span>
              ))}
            </span>
          </Row>
        )}
        {r.capabilities.length > 0 && (
          <Row label="Can">
            <ul className="flex flex-col gap-0.5">
              {r.capabilities.map((c) => (
                <li key={c.capability} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
                  <span className="text-ink">{c.label}</span>
                  <span aria-hidden className="text-ink-4">·</span>
                  <span
                    className={cn(
                      c.outcome === 'denied' || c.outcome === 'blocked' ? 'text-fail-ink' : c.outcome === 'pending' ? 'text-attn-ink' : 'text-ink-3',
                    )}
                  >
                    {c.decision}
                    {c.outcome === 'pending' && ' ◆'}
                  </span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        <Row label="Tokens">
          {formatTokenCount(r.inputTokens)} in <span className="text-ink-4">·</span> {formatTokenCount(r.outputTokens)} out
          {r.simulated && <span className="text-ink-3"> est.</span>}
        </Row>
        <Row label="Cost">
          {r.costIsEstimate ? (
            <Tooltip content={ESTIMATE_NOTE}>
              <span>
                {formatCost(r.costUsd, { est: true })} <span className="text-ink-3">at reference pricing · no money was spent</span>
              </span>
            </Tooltip>
          ) : (
            formatCost(r.costUsd)
          )}
        </Row>
        {r.durationMs !== undefined && <Row label="Duration">{r.durationMs >= 60_000 ? formatClock(r.durationMs) : formatSeconds(r.durationMs)}</Row>}
        {r.saw.length > 0 && (
          <Row label="Saw">
            <ul className="flex flex-col gap-1">
              {r.saw.map((s) => (
                <li key={`${s.ref.kind}:${s.ref.id}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                  <span className="flex min-w-0">
                    <EntityChip entity={s.ref} size="sm" variant="subtle" className="min-w-0 shrink" />
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="type-meta text-ink-3">{formatTok(s.tokens)}</span>
                    <ShareBar share={s.share} />
                    <span className="type-meta w-8 text-right text-ink-3 tabular">{Math.round(s.share * 100)}%</span>
                  </span>
                </li>
              ))}
            </ul>
          </Row>
        )}
        {r.outputs.length > 0 && (
          <Row label="Outputs">
            <span className="flex flex-wrap gap-1">
              {r.outputs.map((o) => (
                <EntityChip key={`${o.kind}:${o.id}`} entity={o} size="sm" />
              ))}
            </span>
          </Row>
        )}
        {r.stopped && <Row label="Outcome">Stopped by you</Row>}
        {r.error && !r.stopped && (
          <Row label="Error">
            <span className="text-fail-ink">{r.error}</span>
          </Row>
        )}
      </dl>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
        <Button size="xs" variant="ghost" leadingIcon={copied ? Check : Copy} onClick={copyReceipt} aria-live="polite">
          {copied ? 'Copied' : 'Copy receipt (Markdown)'}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          leadingIcon={ChevronRight}
          aria-expanded={raw}
          aria-controls={rawId}
          onClick={() => setRaw((v) => !v)}
          className={cn('[&_svg]:transition-transform [&_svg]:duration-(--dur-1)', raw && '[&_svg:first-child]:rotate-90')}
        >
          Raw JSON
        </Button>
      </div>
      {raw && (
        <div id={rawId} className="mt-2">
          <CodeBlock code={receiptJson(run, approvals)} language="json" maxHeight={320} />
        </div>
      )}
    </section>
  )
}
