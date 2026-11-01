import { memo, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { ListGroup, ListPane, ListRows, ScopeFilterRow } from '@/app/templates'
import { useScope } from '@/core/context'
import { triggerShort } from '@/core/services/workflows'
import type { Workflow } from '@/core/types'
import { cn } from '@/lib/cn'
import { EmptyState, MonogramMark, OutcomeTape, RunStatusGlyph, Switch } from '@/ui'
import { toggleEnabled } from './dialogs'
import { useScopedWorkflows, useWorkflowSummaries, type WorkflowSummary } from './hooks'

/**
 * List pane (docs/DESIGN.md §6.6): square mark, name, trigger summary in `meta`, enabled switch,
 * last-10 outcome cells and success %. Filtered to the scope with "This project · All".
 */
export function WorkflowListPane({ activeId }: { activeId: string | null }) {
  const navigate = useNavigate()
  const scope = useScope()
  const [show, setShow] = useState<'project' | 'all'>('project')
  const [q, setQ] = useState('')
  const filterProject = scope && show === 'project' ? scope : null
  const workflows = useScopedWorkflows(filterProject)
  const summaries = useWorkflowSummaries()
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? workflows.filter((w) => `${w.name} ${w.description} ${w.trigger.label}`.toLowerCase().includes(needle)) : workflows
  }, [workflows, q])
  const enabled = shown.filter((w) => w.enabled)
  const off = shown.filter((w) => !w.enabled)

  return (
    <ListPane
      title="Workflows"
      count={workflows.length}
      onNew={() => navigate('/workflows/new')}
      newLabel="New"
      search={{ value: q, onChange: setQ, placeholder: 'Search workflows' }}
      scopeToggle={{ value: show, onChange: setShow }}
    >
      {filterProject && <ScopeFilterRow onShowAll={() => setShow('all')} />}
      {shown.length === 0 ? (
        <EmptyState
          compact
          title={q ? `No matches for “${q.trim()}”` : filterProject ? 'No workflows in this project' : 'No workflows yet'}
          description={q ? 'Try another word, or clear the search.' : 'Start from a template or describe one.'}
          className="px-4 pt-4"
        />
      ) : (
        <ListRows label="Workflows">
          {enabled.length > 0 && (
            <ListGroup label="On" count={enabled.length}>
              {enabled.map((w) => (
                <WorkflowRow key={w.id} wf={w} summary={summaries[w.id]} active={w.id === activeId} />
              ))}
            </ListGroup>
          )}
          {off.length > 0 && (
            <ListGroup label="Off" count={off.length}>
              {off.map((w) => (
                <WorkflowRow key={w.id} wf={w} summary={summaries[w.id]} active={w.id === activeId} />
              ))}
            </ListGroup>
          )}
        </ListRows>
      )}
    </ListPane>
  )
}

const WorkflowRow = memo(function WorkflowRow({ wf, summary, active }: { wf: Workflow; summary?: WorkflowSummary; active: boolean }) {
  const rate = summary?.successRate
  return (
    <div role="listitem" className="group relative mx-1.5 flex items-center">
      <NavLink
        to={`/workflows/${encodeURIComponent(wf.id)}`}
        data-list-row=""
        data-inspect={`workflow:${wf.id}`}
        aria-current={active ? 'page' : undefined}
        aria-label={`${wf.name}, ${wf.enabled ? 'on' : 'off'}, ${wf.trigger.label}${summary?.active ? `, ${summary.active === 'waiting' ? 'needs you' : 'running'}` : ''}`}
        className={cn(
          'flex h-(--row-h-2) min-w-0 flex-1 items-center gap-2.5 rounded-sm py-1.5 pr-12 pl-2.5 outline-none transition-colors duration-(--dur-1) ease-standard',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
          active ? 'bg-accent-tint' : 'hover:bg-hover',
        )}
      >
        <MonogramMark text={wf.name} hue={wf.hue} size={20} className="shrink-0 self-start mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('type-body-sm truncate', active ? 'font-medium text-ink' : 'text-ink-2 group-hover:text-ink')}>{wf.name}</span>
            {summary?.active && <RunStatusGlyph status={summary.active} size={12} />}
          </span>
          <span className="flex min-w-0 items-center gap-2">
            <span className="type-meta truncate text-ink-3">{triggerShort(wf.trigger)}</span>
            <OutcomeTape outcomes={summary?.outcomes ?? []} size="xs" max={10} label="Last runs" className="ml-auto" />
            <span className="type-meta w-8 shrink-0 text-right text-ink-3 tabular">{rate == null ? '—' : `${Math.round(rate * 100)}%`}</span>
          </span>
        </span>
      </NavLink>
      <span className="absolute top-2 right-2">
        <Switch size="sm" checked={wf.enabled} onCheckedChange={(on) => toggleEnabled(wf, on)} aria-label={`${wf.enabled ? 'Turn off' : 'Turn on'} ${wf.name}`} />
      </span>
    </div>
  )
})
