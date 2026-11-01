import { useEffect } from 'react'
import { useParams } from 'react-router'
import { Copy, Link2 } from 'lucide-react'
import { SessionTemplate, StageHeader } from '@/app/templates'
import { markRunOpened } from '@/app/shell/runTracker'
import { useRun } from '@/core/runs'
import { shortCode } from '@/lib/id'
import { RunStatusGlyph, toast, type MenuItem } from '@/ui'
import { AgentsList } from './AgentsList'
import { BoardBoundary } from './boundary'
import { RunDetail } from './RunDetail'

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(`${what} copied`)
  } catch {
    toast.error(`Couldn’t copy the ${what.toLowerCase()}`)
  }
}

/** `/agents/runs/:runId` — the home of runs that have no other (§2.6): the full run detail. */
export default function RunPageView() {
  const { runId = '' } = useParams()
  const run = useRun(runId)
  // Opening a failed run clears its red pill and its unread failure update (§3.6).
  useEffect(() => {
    if (run?.status === 'failed') markRunOpened(run.id)
  }, [run?.id, run?.status])
  const menu: MenuItem[] = run
    ? [
        { id: 'link', label: 'Copy link', icon: Link2, onSelect: () => void copy(`${window.location.origin}/agents/runs/${encodeURIComponent(run.id)}`, 'Link') },
        { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => void copy(shortCode(run.id), 'Handle') },
      ]
    : []
  return (
    <SessionTemplate
      list={<AgentsList />}
      phoneView="stage"
      measure={880}
      primary={run ? { kind: 'run', id: run.id } : null}
      header={
        <StageHeader
          title={run?.title ?? 'Run'}
          leading={run ? <RunStatusGlyph status={run.status} size={14} /> : undefined}
          menu={menu}
          backTo="/agents"
        />
      }
    >
      <BoardBoundary name="this run">
        <RunDetail runId={runId} showTitle={false} back={{ label: 'All runs', to: '/agents' }} />
      </BoardBoundary>
    </SessionTemplate>
  )
}
