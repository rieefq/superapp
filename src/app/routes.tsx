import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Link, Outlet, useRouteError } from 'react-router'
import { Compass } from 'lucide-react'
import { ButtonLink, EmptyState, ErrorState } from '@/ui'
import { WORKSPACES } from './registry'
import { Shell } from './shell/Shell'
import { WorkspaceRoute, WorkspaceSkeleton } from './shell/RouteFrame'

/** Last-resort error page (the shell itself failed). Workspaces have their own boundaries inside the shell. */
function RootError() {
  const error = useRouteError() as Error | undefined
  return (
    <div data-app-ready="true" className="flex h-dvh items-center justify-center bg-canvas p-6 text-ink">
      <ErrorState
        title="Atrium couldn’t start"
        message="Something failed before the workspace could load. Your data is stored on this device and is safe."
        details={error ? `${error.name}: ${error.message}\n\n${error.stack ?? ''}` : undefined}
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />
    </div>
  )
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<WorkspaceSkeleton />}>{children}</Suspense>
}

const Gallery = lazy(() => import('@/ui/gallery/Gallery'))
const TemplatesDemo = lazy(() => import('./templates/TemplatesDemo'))

function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={Compass}
        title="Nothing here"
        description="This address doesn’t match a workspace or an item. It may have been deleted."
        actions={
          <>
            <ButtonLink to="/" variant="primary">
              Go home
            </ButtonLink>
            <Link to="/agents" className="type-body-sm text-ink-2 underline decoration-line-input underline-offset-2 hover:decoration-ink">
              See all runs
            </Link>
          </>
        }
      />
    </div>
  )
}

export const router = createBrowserRouter([
  // The component gallery lives outside the shell (development only).
  { path: '/dev/ui', element: <Lazy><Gallery /></Lazy> },
  {
    element: (
      <Shell>
        <Outlet />
      </Shell>
    ),
    errorElement: <RootError />,
    children: [
      ...WORKSPACES.map(({ manifest, Component }) => {
        const element = (
          <WorkspaceRoute manifest={manifest}>
            <Component />
          </WorkspaceRoute>
        )
        return manifest.path === '/' ? { index: true, element } : { path: `${manifest.path.slice(1)}/*`, element }
      }),
      // Development only: the five templates inside the real shell.
      ...(import.meta.env.DEV ? [{ path: 'dev/templates', element: <Lazy><TemplatesDemo /></Lazy> }] : []),
      { path: '*', element: <NotFound /> },
    ],
  },
])
