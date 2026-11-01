import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Outlet, useRouteError } from 'react-router'
import { WORKSPACES } from './registry'
import { Shell } from './shell/Shell'

function RouteError() {
  const error = useRouteError() as Error | undefined
  return (
    <div role="alert" className="p-8">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm opacity-70">{error?.message ?? 'Unknown error'}</p>
    </div>
  )
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div data-route-loading className="h-full" />}>{children}</Suspense>
}

const Gallery = lazy(() => import('@/ui/gallery/Gallery'))

export const router = createBrowserRouter([
  { path: '/dev/ui', element: <Lazy><Gallery /></Lazy> },
  {
    element: (
      <Shell>
        <Outlet />
      </Shell>
    ),
    errorElement: <RouteError />,
    children: WORKSPACES.map(({ manifest, Component }) =>
      manifest.path === '/'
        ? { index: true, element: <Lazy><Component /></Lazy> }
        : { path: `${manifest.path.slice(1)}/*`, element: <Lazy><Component /></Lazy> },
    ).concat([{ path: '*', element: <Lazy><NotFound /></Lazy> }]),
  },
])

function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-xl font-semibold">Nothing here</h1>
      <p className="text-sm opacity-70">This page doesn’t exist. Try the command center (⌘K).</p>
    </div>
  )
}
