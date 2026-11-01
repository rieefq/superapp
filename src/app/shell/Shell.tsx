import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { MANIFESTS } from '../registry'

/** TEMPORARY shell — replaced by the real global shell. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div data-app-ready="true" className="flex h-dvh">
      <nav className="flex w-48 flex-col gap-1 border-r p-2">
        {MANIFESTS.map((m) => (
          <NavLink key={m.id} to={m.path} end={m.path === '/'} className="rounded px-2 py-1 text-sm">
            {m.label}
          </NavLink>
        ))}
      </nav>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
