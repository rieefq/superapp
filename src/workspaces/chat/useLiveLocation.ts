import { useSyncExternalStore } from 'react'
import type { Location } from 'react-router'
import { router } from '@/app/routes'

/**
 * The router's location, read synchronously from the router store.
 *
 * The app's RouterProvider applies every navigation inside `React.startTransition`, and a transition is
 * restarted by each urgent update — while an answer streams (a store write every 50ms) the new route can
 * stay unpainted for seconds. Chat reads the location the router already committed to history, so the
 * stage follows a click (or a send that creates the thread) immediately.
 */
const subscribe = (onChange: () => void) => router.subscribe(() => onChange())
const snapshot = () => router.state.location

export function useLiveLocation(): Location {
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
