import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { RunsBoardView } from './RunsBoard'
import { ViewSkeleton } from './skeleton'

// Heavier views load on demand; the board (the default) ships with the workspace chunk.
const RosterView = lazy(() => import('./Roster'))
const AgentView = lazy(() => import('./AgentPage'))
const RunPageView = lazy(() => import('./RunPage'))
const NewAgentView = lazy(() => import('./NewAgent'))

/**
 * Agents (§6.4): the command center for every run and every agent.
 * `/agents` All runs · `/agents/roster` · `/agents/new` · `/agents/runs/:runId` · `/agents/:agentId/{now,runs,configure,memory,activity}`.
 */
export default function AgentsWorkspace() {
  return (
    <Routes>
      <Route index element={<RunsBoardView />} />
      <Route path="roster" element={<Lazy kind="grid"><RosterView /></Lazy>} />
      <Route path="new" element={<Lazy kind="form"><NewAgentView /></Lazy>} />
      <Route path="runs" element={<Navigate to="/agents" replace />} />
      <Route path="runs/:runId" element={<Lazy kind="detail"><RunPageView /></Lazy>} />
      <Route path=":agentId/*" element={<Lazy kind="detail"><AgentView /></Lazy>} />
    </Routes>
  )
}

function Lazy({ kind, children }: { kind: 'grid' | 'form' | 'detail'; children: React.ReactNode }) {
  return <Suspense fallback={<ViewSkeleton kind={kind} />}>{children}</Suspense>
}
