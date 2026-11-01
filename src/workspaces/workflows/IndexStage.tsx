import { memo } from 'react'
import { Link } from 'react-router'
import { useScope } from '@/core/context'
import { useRow } from '@/core/db'
import { triggerLabel } from '@/core/services/workflows'
import type { Workflow } from '@/core/types'
import { timeAgo } from '@/lib/format'
import { EntityChip, MonogramMark, OutcomeTape, RUN_STATUS_META, RunStatusGlyph, Sparkline, Switch } from '@/ui'
import { toggleEnabled } from './dialogs'
import { useRunsPerDay, useScopedWorkflows, useWorkflowSummaries, type WorkflowSummary } from './hooks'
import { DescribeIt, TemplateCards } from './Start'

/**
 * /workflows: your workflows as cards (trigger, on/off, last run, runs per day, outcomes, project),
 * then how to start a new one — Describe it, templates, Blank (docs/DESIGN.md §6.6: "The stage shows
 * templates"; with no workflows the templates are the page).
 */
export function IndexStage() {
  const scope = useScope()
  const workflows = useScopedWorkflows(scope)
  const summaries = useWorkflowSummaries()
  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-10 px-4 py-6 md:px-6 md:py-8">
        {workflows.length > 0 && (
          <section aria-labelledby="wf-yours" className="flex flex-col gap-3">
            <div className="flex h-7 items-center gap-2">
              <h2 id="wf-yours" className="type-label text-ink-3">
                Your workflows
              </h2>
              <span className="type-meta text-ink-3">{workflows.length}</span>
            </div>
            <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
              {workflows.map((w) => (
                <li key={w.id}>
                  <WorkflowCard wf={w} summary={summaries[w.id]} />
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="wf-start" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id="wf-start" className={workflows.length ? 'type-label text-ink-3' : 'type-title-2 text-ink'}>
              {workflows.length ? 'Start a workflow' : 'Automate something'}
            </h2>
            {!workflows.length && <p className="type-body text-ink-2">Describe it in a sentence, start from a template, or begin with a blank canvas.</p>}
          </div>
          <div className="max-w-[720px]">
            <DescribeIt projectId={scope} compact />
          </div>
          <TemplateCards projectId={scope} />
        </section>
      </div>
    </div>
  )
}

const WorkflowCard = memo(function WorkflowCard({ wf, summary }: { wf: Workflow; summary?: WorkflowSummary }) {
  const project = useRow('projects', wf.projectId)
  const perDay = useRunsPerDay(wf.id, 14)
  const total = perDay.reduce((a, b) => a + b, 0)
  const rate = summary?.successRate
  const last = summary?.active ?? summary?.lastStatus
  return (
    <article className="relative flex h-full flex-col gap-3 rounded-md border border-line bg-raised p-3.5 transition-colors duration-(--dur-1) hover:border-line-strong">
      <div className="flex items-start gap-2.5">
        <MonogramMark text={wf.name} hue={wf.hue} size={24} className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="type-body-sm min-w-0 truncate font-semibold text-ink">
            <Link to={`/workflows/${encodeURIComponent(wf.id)}`} className="outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-(--focus-ring)">
              {wf.name}
            </Link>
          </h3>
          <span className="type-caption truncate text-ink-3">{triggerLabel(wf.trigger)}</span>
        </div>
        <span className="relative z-10">
          <Switch size="sm" checked={wf.enabled} onCheckedChange={(on) => toggleEnabled(wf, on)} aria-label={`${wf.enabled ? 'Turn off' : 'Turn on'} ${wf.name}`} />
        </span>
      </div>
      {wf.description && <p className="type-caption line-clamp-2 text-pretty text-ink-2">{wf.description}</p>}
      <div className="mt-auto flex items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="type-meta flex items-center gap-1.5 text-ink-3">
            {last ? (
              <>
                <RunStatusGlyph status={last} size={12} decorative />
                <span className={summary?.active === 'waiting' ? 'text-attn-ink' : summary?.active === 'running' ? 'text-live-ink' : 'text-ink-2'}>{RUN_STATUS_META[last].word}</span>
                {!summary?.active && summary?.lastAt && <span>· {timeAgo(summary.lastAt)}</span>}
              </>
            ) : (
              'No runs yet'
            )}
          </span>
          <span className="flex items-center gap-2">
            <OutcomeTape outcomes={summary?.outcomes ?? []} size="xs" max={10} label="Last runs" />
            <span className="type-meta text-ink-3 tabular">{rate == null ? '' : `${Math.round(rate * 100)}%`}</span>
          </span>
        </div>
        <div className="flex w-24 shrink-0 flex-col items-end gap-0.5">
          <Sparkline values={perDay} variant="bars" height={20} label={`Runs per day, last 14 days: ${total} in total`} className="w-full" />
          <span className="type-meta text-ink-3">{total} in 14d</span>
        </div>
      </div>
      {project && (
        <span className="relative z-10 flex min-w-0">
          <EntityChip entity={{ kind: 'project', id: project.id }} size="sm" variant="subtle" />
        </span>
      )}
    </article>
  )
})
