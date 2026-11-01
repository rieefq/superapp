import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { ArrowUpRight, Ban, BookOpen, RotateCcw } from 'lucide-react'
import { SaveToKnowledgeButton } from '@/app/components'
import type { LensModule, LensProps } from '@/app/lens/types'
import { attachRun } from '@/app/shell/store'
import { useRow, useRowsByIds } from '@/core/db'
import { discardSource, restoreSource } from '@/core/services'
import { excerpt } from '@/core/sim/text'
import { isRunActive, type Investigation, type Source } from '@/core/types'
import { cn } from '@/lib/cn'
import { formatDate, timeAgo } from '@/lib/format'
import { Button, EntityChip, SimFrame, StepTape, runCurrentLine, toast } from '@/ui'
import { DEPTH_LABEL, sourceStats } from './logic'
import { ConfidenceMeter, CredibilityMeter, InvestigationStatusChip, SOURCE_KIND_WORD, SourceOriginTag, SourceStatus } from './parts'

/**
 * Lens renderers for the kinds Research owns (§5.4.8): `investigation` and `source`.
 * panel = Inspector › Item body (the shell adds the header, Links and History);
 * card = hover card and ⌘K preview (the generic header is drawn around it).
 * The source panel is the "source drawer": what the source says, where it came from and how honest it is.
 */

// ------------------------------------------------------------------------------------------------ investigation

function summaryOf(inv: Investigation): string | undefined {
  const section = /##\s+(?:Executive summary|Summary)\s+([\s\S]*?)(\n## |$)/.exec(inv.report ?? '')?.[1]
  return section ? excerpt(section, 320) : undefined
}

function InvestigationPanel({ entity }: LensProps) {
  const navigate = useNavigate()
  const inv = useRow('investigations', entity.id)
  const run = useRow('runs', inv?.runIds[inv.runIds.length - 1])
  const sources = useRowsByIds('sources', inv?.sourceIds)
  const stats = useMemo(() => sourceStats(sources), [sources])
  const knowledge = useRow('knowledge', inv?.knowledgeId)
  if (!inv) return null
  const active = !!run && isRunActive(run.status)
  const summary = summaryOf(inv)
  const top = [...inv.findings].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)).slice(0, 3)
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <InvestigationStatusChip inv={inv} run={run} />
        <span className="type-meta text-ink-3">{DEPTH_LABEL[inv.depth]} depth</span>
      </div>
      <p className="type-body-sm text-pretty text-ink-2">{inv.question}</p>

      {active && run && (
        <button
          type="button"
          onClick={() => attachRun(run.id, 'research')}
          className="-mx-1.5 flex flex-col gap-1.5 rounded-sm px-1.5 py-1.5 text-left transition-colors duration-(--dur-1) hover:bg-hover"
          aria-label={`Attach the run: ${runCurrentLine(run)}`}
        >
          <span className="type-caption truncate text-live-ink">{runCurrentLine(run)}</span>
          <StepTape run={run} size="sm" />
        </button>
      )}

      <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        <dt className="type-caption text-ink-3">Sources</dt>
        <dd className="type-body-sm tabular text-ink-2">
          {stats.active}
          {stats.knowledge > 0 && <span className="text-ink-3"> · {stats.knowledge} your knowledge</span>}
          {stats.simulated > 0 && <span className="text-ink-3"> · {stats.simulated} simulated</span>}
          {stats.discarded > 0 && <span className="text-ink-3"> · {stats.discarded} discarded</span>}
        </dd>
        <dt className="type-caption text-ink-3">Findings</dt>
        <dd className="type-body-sm tabular text-ink-2">
          {inv.findings.length}
          {inv.findings.some((f) => f.pinned) && <span className="text-ink-3"> · {inv.findings.filter((f) => f.pinned).length} pinned</span>}
        </dd>
        {knowledge && (
          <>
            <dt className="type-caption pt-0.5 text-ink-3">In Knowledge</dt>
            <dd className="min-w-0">
              <EntityChip entity={{ kind: 'knowledge', id: knowledge.id }} size="sm" />
            </dd>
          </>
        )}
      </dl>

      {summary && <p className="type-body-sm border-l-2 border-line-strong pl-3 text-pretty text-ink-2">{summary}</p>}

      {top.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="type-label text-ink-3">{top.some((f) => f.pinned) ? 'Pinned findings' : 'Findings'}</span>
          <ul className="flex flex-col gap-2">
            {top.map((f) => (
              <li key={f.id} className="flex flex-col gap-1">
                <ConfidenceMeter confidence={f.confidence} />
                <span className="type-body-sm line-clamp-3 text-pretty text-ink-2">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <Button size="sm" variant="secondary" trailingIcon={ArrowUpRight} onClick={() => navigate(`/research/${inv.id}`)}>
          {inv.report ? 'Open the report' : 'Open the investigation'}
        </Button>
      </div>
    </div>
  )
}

function InvestigationCard({ entity }: LensProps) {
  const inv = useRow('investigations', entity.id)
  const run = useRow('runs', inv?.runIds[inv.runIds.length - 1])
  if (!inv) return null
  const active = !!run && isRunActive(run.status)
  return (
    <div className="flex flex-col gap-2">
      <p className="type-caption line-clamp-3 text-pretty text-ink-2">{summaryOf(inv) ?? inv.question}</p>
      <div className="type-meta flex flex-wrap items-center gap-x-1.5 text-ink-3 tabular">
        <span>{DEPTH_LABEL[inv.depth]}</span>
        <span aria-hidden>·</span>
        <span>
          {inv.sourceIds.length} source{inv.sourceIds.length === 1 ? '' : 's'}
        </span>
        <span aria-hidden>·</span>
        <span>
          {inv.findings.length} finding{inv.findings.length === 1 ? '' : 's'}
        </span>
      </div>
      {active && run && <StepTape run={run} size="sm" />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ source

/** The honest note for a source: what it is and what Atrium did (and did not) do with it. */
function sourceNote(s: Source): string {
  if (s.kind === 'knowledge') return 'From your knowledge base, found by Atrium’s local search. The passage below is your own material.'
  if (s.simulated) return 'Simulated web result: a fictional publication on a reserved .example domain, generated locally. No page was fetched; the summary was generated, not read.'
  return 'Added by you. Atrium doesn’t fetch pages in this build, so this source holds only the link and your notes.'
}

function SourcePanel({ entity }: LensProps) {
  const navigate = useNavigate()
  const s = useRow('sources', entity.id)
  const inv = useRow('investigations', s?.investigationId)
  if (!s) return null
  const n = inv ? inv.sourceIds.indexOf(s.id) + 1 : 0
  const citing = inv ? inv.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.sourceIds.includes(s.id)) : []
  const discarded = s.status === 'discarded'
  const toggle = () => {
    if (discarded) {
      restoreSource(s.id)
      return
    }
    discardSource(s.id)
    toast({ title: 'Source discarded', description: 'It no longer counts toward findings or the report.', action: { label: 'Undo', onClick: () => restoreSource(s.id) } })
  }
  const details = [s.author, s.publishedAt ? `published ${formatDate(s.publishedAt, { month: 'short', day: 'numeric', year: 'numeric' })}` : null, `added ${timeAgo(s.addedAt)}`].filter(Boolean)
  return (
    <div className="flex flex-col gap-4 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <SourceOriginTag source={s} />
        <span className="type-caption text-ink-3">{SOURCE_KIND_WORD[s.kind]}</span>
        <SourceStatus status={s.status} />
        {n > 0 && <span className="type-meta text-ink-3">cited as [{n}]</span>}
      </div>

      {s.url && (
        <div className="flex min-w-0 flex-col gap-1">
          {s.simulated ? (
            <span className="type-mono-sm break-all text-ink-3" title="A reserved .example domain — it does not resolve">
              {s.url}
            </span>
          ) : (
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="type-mono-sm inline-flex min-w-0 items-center gap-1 break-all text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
              {s.url}
              <ArrowUpRight aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
            </a>
          )}
        </div>
      )}
      {details.length > 0 && <p className="type-meta -mt-2 text-ink-3">{details.join(' · ')}</p>}

      <div className="flex flex-col gap-1.5">
        <span className="type-label text-ink-3">Credibility</span>
        <CredibilityMeter source={s} withValue />
        <span className="type-caption text-ink-3">
          {s.kind === 'knowledge'
            ? 'Your own material ranks high by default.'
            : s.simulated
              ? s.status === 'queued'
                ? 'Assessed once the source is read.'
                : 'A heuristic for a fictional publication — not a judgment of a real outlet.'
              : 'Neutral until you assess it.'}
        </span>
      </div>

      {s.snippet && (
        <div className="flex flex-col gap-1.5">
          <span className="type-label text-ink-3">Snippet</span>
          <p className="type-body-sm border-l-2 border-line-strong pl-3 text-pretty text-ink-2">{s.snippet}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="type-label text-ink-3">{s.kind === 'knowledge' ? 'Passage' : s.simulated ? 'Content summary' : 'Your notes'}</span>
        {s.simulated ? (
          <SimFrame header="Simulated web result">
            <p className="type-body-sm px-3 py-2.5 whitespace-pre-wrap text-pretty text-ink-2">{s.content ?? 'Not read yet — the summary appears once Scout reads this source.'}</p>
          </SimFrame>
        ) : (
          <p className={cn('type-body-sm rounded-sm border border-line bg-raised px-3 py-2.5 whitespace-pre-wrap text-pretty', s.content ? 'text-ink-2' : 'text-ink-3')}>
            {s.content || 'Nothing here yet.'}
          </p>
        )}
        <p className="type-caption text-pretty text-ink-3">{sourceNote(s)}</p>
      </div>

      {citing.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="type-label text-ink-3">Cited by</span>
          <ul className="flex flex-col gap-1">
            {citing.map(({ f, i }) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => inv && navigate(`/research/${inv.id}/findings`)}
                  className="type-body-sm -mx-1.5 flex w-[calc(100%+12px)] min-w-0 items-baseline gap-2 rounded-sm px-1.5 py-1 text-left text-ink-2 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink"
                >
                  <span className="type-meta shrink-0 text-ink-3">Finding {i + 1}</span>
                  <span className="line-clamp-2 min-w-0 text-pretty">{f.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {inv && (
        <div className="type-caption flex min-w-0 items-center gap-1.5 text-ink-3">
          <span>In</span>
          <EntityChip entity={{ kind: 'investigation', id: inv.id }} size="sm" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="secondary" leadingIcon={discarded ? RotateCcw : Ban} onClick={toggle}>
          {discarded ? 'Restore' : 'Discard'}
        </Button>
        {s.kind === 'knowledge' && s.knowledgeId ? (
          <Button size="sm" variant="ghost" leadingIcon={BookOpen} onClick={() => navigate(`/knowledge/${s.knowledgeId}`)}>
            Open in Knowledge
          </Button>
        ) : (
          <SaveToKnowledgeButton entity={{ kind: 'source', id: s.id }} />
        )}
      </div>
    </div>
  )
}

function SourceCard({ entity }: LensProps) {
  const s = useRow('sources', entity.id)
  if (!s) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <SourceOriginTag source={s} />
        {s.domain && s.kind !== 'knowledge' && <span className="type-meta text-ink-3">{s.domain}</span>}
      </div>
      {s.snippet && <p className="type-caption line-clamp-3 text-pretty text-ink-2">{s.snippet}</p>}
      <div className="flex items-center gap-3">
        <CredibilityMeter source={s} withValue />
        <SourceStatus status={s.status} />
      </div>
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  investigation: { panel: InvestigationPanel, card: InvestigationCard },
  source: { panel: SourcePanel, card: SourceCard },
}
