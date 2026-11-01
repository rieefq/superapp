import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router'
import { WorkspaceScreen } from '@/app/templates'
import { CodeHome } from './CodeHome'
import { CodeListPane } from './CodeList'
import { ConnectRepoDialog, openConnectDialog } from './ConnectRepo'
import { NewSession } from './NewSession'
import { RepoView } from './repo/RepoView'
import { SessionView } from './session/SessionView'

/**
 * Code (§6.3): delegate software work to coding agents, watch them work, review their changes.
 * Session template: the list pane (repositories, sessions) stays put while the stage switches between
 * Code home, a new session, a repository and a session.
 */
export default function CodeWorkspace() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const rest = location.pathname.replace(/^\/code\/?/, '')
  const atRoot = rest === ''

  // `/code?connect=1` (⌘K, the repo picker's "Connect a repository") opens the connect dialog.
  const connect = params.get('connect')
  useEffect(() => {
    if (!connect) return
    openConnectDialog()
    navigate({ pathname: location.pathname, search: '' }, { replace: true })
  }, [connect, location.pathname, navigate])

  return (
    <>
      <WorkspaceScreen list={<CodeListPane />} phoneView={atRoot ? 'list' : 'stage'}>
        <Routes>
          <Route index element={<CodeHome />} />
          <Route path="new" element={<NewSession />} />
          <Route path="repos/:repoId/*" element={<RepoView />} />
          <Route path=":sessionId/*" element={<SessionView />} />
        </Routes>
      </WorkspaceScreen>
      <ConnectRepoDialog />
    </>
  )
}
