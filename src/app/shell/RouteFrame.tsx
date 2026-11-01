import { Component, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { resolveEntity } from '@/core/services'
import { Button, ErrorState } from '@/ui'
import { cn } from '@/lib/cn'
import type { WorkspaceManifest } from '../types'
import { useShellStore } from './store'
import { entitiesFromLocation } from './recents'

const CHUNK_ERROR = /dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i

interface BoundaryProps {
  manifest: WorkspaceManifest
  children: ReactNode
  /** Changes when the route changes, so a broken view recovers by navigating away. */
  resetKey: string
}

class WorkspaceBoundary extends Component<BoundaryProps & { onHome: () => void }, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: { error: Error | null; key: string }) {
    if (props.resetKey !== state.key) return { error: null, key: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.manifest.id}] workspace crashed`, error, info.componentStack)
  }

  retry = () => {
    if (this.state.error && CHUNK_ERROR.test(this.state.error.message)) {
      window.location.reload()
      return
    }
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = CHUNK_ERROR.test(error.message)
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-6">
        <ErrorState
          title={`Couldn’t open ${this.props.manifest.label}`}
          message={
            chunk
              ? 'This part of Atrium didn’t load, probably because the connection dropped. Retry reloads it.'
              : 'Something in this workspace failed while drawing. Your data is safe. Retry, or go home and come back.'
          }
          details={`${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`}
          onRetry={this.retry}
          retryLabel="Retry"
          actions={
            <Button size="sm" variant="ghost" onClick={this.props.onHome}>
              Go home
            </Button>
          }
        />
      </div>
    )
  }
}

/** Route-level skeleton in the grammar shapes (row rectangles, capsules), pulsing 0.6↔1 (static under reduced motion). */
export function WorkspaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="flex h-full">
      <style href="atrium-route-skeleton" precedence="default">{`
@keyframes atrium-skeleton-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.6 } }
.atrium-skeleton { animation: atrium-skeleton-pulse var(--dur-breathe, 1600ms) ease-in-out infinite; }
html[data-motion='reduce'] .atrium-skeleton { animation: none; }
@media (prefers-reduced-motion: reduce) { html:not([data-motion='full']) .atrium-skeleton { animation: none; } }
`}</style>
      <div className="atrium-skeleton flex w-full flex-col">
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-5">
          <span className="h-3.5 w-40 rounded-xs bg-hover" />
          <span className="h-4 w-14 rounded-full bg-hover" />
        </div>
        <div className="flex flex-col gap-3 p-5">
          {[72, 56, 64, 48, 60].map((w, i) => (
            <div key={i} className="flex h-9 items-center gap-3">
              <span className="size-5 shrink-0 rounded-xs bg-hover" />
              <span className={cn('h-3 rounded-xs bg-hover')} style={{ width: `${w}%` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Touches recents whenever an entity route opens (§2.7). */
function RecentsTracker() {
  const location = useLocation()
  const touchRecent = useShellStore((s) => s.touchRecent)
  useEffect(() => {
    for (const ref of entitiesFromLocation(location.pathname, location.search)) {
      if (resolveEntity(ref).exists) touchRecent(ref)
    }
  }, [location.pathname, location.search, touchRecent])
  return null
}

/**
 * Wraps one workspace route: error boundary (friendly ErrorState + Retry), route skeleton while
 * the lazy module loads, a content fade on workspace switch (120ms out / 180ms in with a 6px rise,
 * §8.2), and recents tracking.
 */
export function WorkspaceRoute({ manifest, children }: { manifest: WorkspaceManifest; children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <WorkspaceBoundary manifest={manifest} resetKey={location.pathname} onHome={() => navigate('/')}>
      <RecentsTracker />
      <Suspense fallback={<WorkspaceSkeleton />}>
        <div key={manifest.id} className="atrium-route-in h-full">
          <style href="atrium-route-in" precedence="default">{`
@keyframes atrium-route-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.atrium-route-in { animation: atrium-route-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both; }
html[data-motion='reduce'] .atrium-route-in { animation: atrium-fade-in 120ms linear both; }
@keyframes atrium-fade-in { from { opacity: 0 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { html:not([data-motion='full']) .atrium-route-in { animation: atrium-fade-in 120ms linear both; } }
`}</style>
          {children}
        </div>
      </Suspense>
    </WorkspaceBoundary>
  )
}
