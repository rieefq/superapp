import { memo, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { Telescope } from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows, ScopeFilterRow } from '@/app/templates'
import { useScope } from '@/core/context'
import { useRow } from '@/core/db'
import { useInvestigations } from '@/core/services'
import { isRunActive, type Investigation } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { Button, EmptyState, HUE_FILL, StepTape } from '@/ui'
import { useLatestRun } from './hooks'
import { groupInvestigations, matchesQuery } from './logic'
import { DepthChip, InvestigationGlyph, TextButton } from './parts'

/**
 * The list pane (§6.5): investigations grouped Running · Ready for review · Failed · Complete · Drafts,
 * each with its glyph, title, depth chip, source count and — while it runs — a mini Step Tape.
 */
export function InvestigationList() {
  const navigate = useNavigate()
  const scope = useScope()
  const [query, setQuery] = useState('')
  const all = useInvestigations({ projectId: scope })
  const visible = useMemo(() => all.filter((i) => matchesQuery(i, query)), [all, query])
  const groups = useMemo(() => groupInvestigations(visible), [visible])

  return (
    <ListPane
      title="Investigations"
      count={all.length}
      onNew={() => navigate('/research/new')}
      newLabel="New"
      search={{ value: query, onChange: setQuery, placeholder: 'Search investigations' }}
    >
      <ScopeFilterRow />
      {all.length === 0 ? (
        <EmptyState
          compact
          icon={Telescope}
          title={scope ? 'No investigations in this project' : 'No investigations yet'}
          description="Ask a question worth a report. Scout gathers sources and drafts it."
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/research/new')}>
              New investigation
            </Button>
          }
          className="px-4 pt-3"
        />
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-start gap-1 px-4 py-3">
          <p className="type-body-sm text-ink-3">No investigations match “{query.trim()}”.</p>
          <TextButton onClick={() => setQuery('')} className="-ml-1.5">
            Clear the search
          </TextButton>
        </div>
      ) : (
        <ListRows label="Investigations">
          {groups.map((g) => (
            <ListGroup key={g.status} label={g.label} count={g.items.length}>
              {g.items.map((inv) => (
                <InvestigationRow key={inv.id} inv={inv} showProject={!scope} />
              ))}
            </ListGroup>
          ))}
        </ListRows>
      )}
    </ListPane>
  )
}

const InvestigationRow = memo(function InvestigationRow({ inv, showProject }: { inv: Investigation; showProject: boolean }) {
  const run = useLatestRun(inv)
  const project = useRow('projects', showProject ? inv.projectId : null)
  const active = inv.status === 'running' && run && isRunActive(run.status)
  const sources = inv.sourceIds.length
  return (
    <ListRow
      to={`/research/${inv.id}`}
      entity={{ kind: 'investigation', id: inv.id }}
      leading={<InvestigationGlyph inv={inv} run={run} />}
      title={inv.title}
      secondary={
        <span className="flex min-w-0 items-center gap-1.5">
          <DepthChip depth={inv.depth} />
          {project && <span aria-label={project.name} title={project.name} className={cn('size-2 shrink-0 rounded-[2px]', HUE_FILL[project.hue])} />}
          <span className="truncate tabular">
            {inv.status === 'draft' ? `${inv.angles.length} angle${inv.angles.length === 1 ? '' : 's'}` : `${sources} source${sources === 1 ? '' : 's'}`}
            {inv.findings.length > 0 && inv.status !== 'draft' ? ` · ${inv.findings.length} finding${inv.findings.length === 1 ? '' : 's'}` : ''}
          </span>
          {active && <StepTape run={run} size="xs" max={10} className="ml-0.5" />}
        </span>
      }
      meta={timeAgo(inv.updatedAt).replace(' ago', '')}
    />
  )
})
