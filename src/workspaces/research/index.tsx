import { useMemo, useRef } from 'react'
import { Route, Routes, useMatch, useNavigate, useSearchParams } from 'react-router'
import { Telescope } from 'lucide-react'
import { Stage, StageHeader, WorkspaceScreen } from '@/app/templates'
import { useScope } from '@/core/context'
import { useInvestigations } from '@/core/services'
import { Button, EmptyState } from '@/ui'
import InvestigationStage from './InvestigationView'
import { InvestigationList } from './InvestigationList'
import { NewBrief } from './NewBrief'
import { RecentReports } from './RecentReports'
import { exampleQuestions } from './logic'

/**
 * Research (§6.5, Session template): investigations in the list pane; the stage shows a new brief and
 * recent reports (`/research`), the brief alone (`/research/new?q=`), or an investigation
 * (`/research/:id` → Report · Findings · Sources · Activity, `?source=` selects a source).
 */
export default function ResearchWorkspace() {
  const atRoot = useMatch('/research')
  return (
    <WorkspaceScreen list={<InvestigationList />} phoneView={atRoot ? 'list' : 'stage'}>
      <Routes>
        <Route index element={<BriefStage />} />
        <Route path="new" element={<BriefStage focus />} />
        <Route path=":investigationId/:tab?" element={<InvestigationStage />} />
        <Route path="*" element={<MissingStage />} />
      </Routes>
    </WorkspaceScreen>
  )
}

/** `/research` and `/research/new`: the brief, examples and recent reports. */
function BriefStage({ focus }: { focus?: boolean }) {
  const [params] = useSearchParams()
  const scope = useScope()
  const stageRef = useRef<HTMLDivElement>(null)
  const prefill = params.get('q') ?? undefined
  const withReports = useInvestigations({ projectId: scope, status: ['review', 'complete'] })
  const examples = useMemo(() => exampleQuestions(withReports.slice(0, 6)), [withReports])
  return (
    <Stage header={<StageHeader title="New investigation" backTo="/research" />} measure={760}>
      <div ref={stageRef} className="flex flex-col pb-10">
        <h2 className="type-title-2 text-ink">Ask a question worth a report.</h2>
        <p className="type-body mt-1 max-w-[60ch] text-pretty text-ink-3">
          Scout plans the angles, reads your knowledge and the web, judges each source and drafts a report with citations. Web results are simulated in this build.
        </p>
        <div className="mt-5">
          {/* A new key per prefill so `?q=` from ⌘K or Home lands in a fresh brief. */}
          <NewBrief key={prefill ?? 'blank'} initialQuestion={prefill} autoFocus={focus || !!prefill} examples={examples} dropTarget={stageRef} />
        </div>
        {!focus && <RecentReports className="mt-12" />}
      </div>
    </Stage>
  )
}

function MissingStage() {
  const navigate = useNavigate()
  return (
    <Stage header={<StageHeader title="Research" backTo="/research" />}>
      <EmptyState
        icon={Telescope}
        title="Nothing here"
        description="This address doesn’t match an investigation."
        actions={
          <Button variant="primary" onClick={() => navigate('/research/new')}>
            New investigation
          </Button>
        }
      />
    </Stage>
  )
}
