import { useCallback, useContext, useSyncExternalStore } from 'react'
import { UNSAFE_DataRouterContext, useLocation, type Location } from 'react-router'

/**
 * The router's location, read synchronously from the router the app is using.
 *
 * The app's RouterProvider applies every navigation inside `React.startTransition`, and a transition is
 * restarted by each urgent update — while an answer streams (a store write every 50ms) the new route can
 * stay unpainted for seconds. Chat reads the location the router has already committed, so the stage
 * follows a click (or the send that creates a thread) at once. Outside a data router (tests) it falls
 * back to the route context.
 */
export function useLiveLocation(): Location {
  const router = useContext(UNSAFE_DataRouterContext)?.router
  const fallback = useLocation()
  const subscribe = useCallback((onChange: () => void) => (router ? router.subscribe(() => onChange()) : () => {}), [router])
  const snapshot = useCallback(() => (router ? router.state.location : fallback), [router, fallback])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export type ChatRoute = { route: 'root' | 'new' | 'thread'; threadId?: string }

/** `/chat` → root, `/chat/new` → new, `/chat/:id` → thread. */
export function parseChatPath(pathname: string): ChatRoute {
  const rest = pathname.replace(/^\/chat\/?/, '').split('/')[0] ?? ''
  if (!rest) return { route: 'root' }
  if (rest === 'new') return { route: 'new' }
  return { route: 'thread', threadId: decodeURIComponent(rest) }
}
