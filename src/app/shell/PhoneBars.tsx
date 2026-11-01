import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import { Ellipsis, House, MessagesSquare, Orbit, Plus } from 'lucide-react'
import { useActiveRuns } from '@/core/runs'
import { useIsTyping } from '@/ui'
import { cn } from '@/lib/cn'
import { MANIFESTS, NAV_GROUPS } from '../registry'
import { useShellStore } from './store'
import { PhoneSheet } from './overlays'
import { useNeedsYou, needsYouCount, useRailBadges } from './signals'
import { RunGlyph } from './sig'
import { useRunLineRuns } from './RunLine'
import { AttnDiamond } from './NeedsYou'

/**
 * Phone live strip (32px, §3.12): the single most urgent item — `◆ Forge needs approval · Review`
 * beats `● Researching EU suppliers · 3/7` — plus `+N`. Hides on scroll down, returns on scroll up,
 * and never hides while something is waiting.
 */
export function LiveStrip() {
  const navigate = useNavigate()
  const { ordered } = useRunLineRuns()
  const needs = useNeedsYou()
  const approval = needs.approvals[0]
  const runs = ordered.filter((r) => r.status === 'running' || r.status === 'queued' || r.status === 'waiting' || r.status === 'paused')
  const waiting = !!approval
  const [hidden, setHidden] = useState(false)
  const last = useRef(new WeakMap<EventTarget, number>())

  useEffect(() => {
    const main = document.getElementById('main')
    if (!main) return
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement
      if (!(el instanceof HTMLElement)) return
      const prev = last.current.get(el) ?? 0
      const top = el.scrollTop
      last.current.set(el, top)
      if (Math.abs(top - prev) < 4) return
      setHidden(top > prev && top > 24)
    }
    main.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => main.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  if (!waiting && runs.length === 0) return null
  const show = waiting || !hidden
  const first = runs[0]
  const more = Math.max(0, runs.length + needs.approvals.length - 1 - (waiting && first?.status === 'waiting' ? 1 : 0))

  return (
    <div
      className={cn(
        'grid shrink-0 overflow-hidden border-b border-line bg-chrome transition-[grid-template-rows] duration-(--dur-3) ease-standard',
        show ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}
      aria-hidden={!show || undefined}
    >
      <div className="min-h-0">
        <button
          type="button"
          tabIndex={show ? 0 : -1}
          onClick={() => {
            if (waiting) {
              const st = useShellStore.getState()
              st.setNeedsYouTab('needs')
              st.setNeedsYouOpen(true)
            } else navigate('/agents')
          }}
          className="flex h-8 w-full items-center gap-2 px-4 text-left"
        >
          {waiting ? (
            <>
              <AttnDiamond />
              <span className="type-body-sm min-w-0 flex-1 truncate text-ink">{approval.title}</span>
              <span className="type-caption shrink-0 font-medium text-attn-ink">Review</span>
            </>
          ) : first ? (
            <>
              <RunGlyph status={first.status} />
              <span className="type-body-sm min-w-0 flex-1 truncate text-ink">{first.title}</span>
              <span className="type-meta shrink-0 text-ink-3">
                {first.steps.filter((s) => s.status === 'done').length}/{Math.max(first.steps.length, first.plannedSteps ?? 0)}
              </span>
            </>
          ) : null}
          {more > 0 && <span className="type-meta shrink-0 rounded-full border border-line-strong px-1.5 text-ink-2">+{more}</span>}
        </button>
      </div>
    </div>
  )
}

/** Phone bottom bar (§3.12): Home · Chat · Start · Runs · More. Hidden while typing. */
export function PhoneBottomBar() {
  const location = useLocation()
  const openCommand = useShellStore((s) => s.openCommand)
  const setMore = useShellStore((s) => s.setMoreOpen)
  const active = useActiveRuns()
  const needs = needsYouCount(useNeedsYou())
  const typing = useIsTyping()
  const live = active.filter((r) => r.status === 'running' || r.status === 'queued').length
  const onRuns = location.pathname === '/agents' || location.pathname.startsWith('/agents/')
  if (typing) return null
  const tab = 'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-ink-3 transition-colors duration-(--dur-1) aria-[current=page]:text-ink'
  return (
    <nav
      aria-label="Primary"
      data-region="runline"
      className="relative z-(--z-topbar) flex shrink-0 items-stretch border-t border-line bg-chrome px-1 pb-[env(safe-area-inset-bottom)]"
    >
      <NavLink to="/" end className={tab}>
        <House aria-hidden className="size-5" strokeWidth={1.5} />
        <span className="type-micro">Home</span>
      </NavLink>
      <NavLink to="/chat" className={tab}>
        <MessagesSquare aria-hidden className="size-5" strokeWidth={1.5} />
        <span className="type-micro">Chat</span>
      </NavLink>
      <div className="flex flex-1 items-center justify-center">
        <button
          type="button"
          onClick={() => openCommand('')}
          aria-label="Start: search, ask or start work"
          className="grid h-10 w-12 place-items-center rounded-md bg-inverse text-inverse-ink shadow-inset transition-colors duration-(--dur-1) active:bg-inverse/80"
        >
          <Plus aria-hidden className="size-5" strokeWidth={2} />
        </button>
      </div>
      <NavLink to="/agents" className={tab} aria-current={onRuns ? 'page' : undefined} aria-label={`Runs: ${live} running${needs ? `, ${needs} need you` : ''}`}>
        <span className="relative">
          <Orbit aria-hidden className="size-5" strokeWidth={1.5} />
          {needs > 0 ? (
            <AttnDiamond className="absolute -top-0.5 -right-1.5 shadow-[0_0_0_2px_var(--surface-chrome)]" />
          ) : (
            live > 0 && <span className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-live shadow-[0_0_0_2px_var(--surface-chrome)]" />
          )}
        </span>
        <span className="type-micro tabular-nums">{live > 0 ? `Runs · ${live}` : 'Runs'}</span>
      </NavLink>
      <button type="button" onClick={() => setMore(true)} className={tab} aria-haspopup="dialog">
        <Ellipsis aria-hidden className="size-5" strokeWidth={1.5} />
        <span className="type-micro">More</span>
      </button>
    </nav>
  )
}

/** Phone "More" sheet: every workspace under its group label, with live badges, then System. */
export function MoreSheet() {
  const open = useShellStore((s) => s.moreOpen)
  const setOpen = useShellStore((s) => s.setMoreOpen)
  const badges = useRailBadges()
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: MANIFESTS.filter((m) => m.group === g.id) })).filter((g) => g.items.length)
  return (
    <PhoneSheet open={open} onOpenChange={setOpen} title="Workspaces">
      <nav aria-label="All workspaces" className="flex flex-col gap-4 px-2 py-3">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.label || 'Home'}>
            {g.label && <h3 className="type-label px-3 pb-1 text-ink-3">{g.label}</h3>}
            <ul>
              {g.items.map((m) => {
                const Icon = m.icon
                const b = badges[m.id]
                return (
                  <li key={m.id}>
                    <NavLink
                      to={m.path}
                      end={m.path === '/'}
                      onClick={() => setOpen(false)}
                      className="flex h-12 items-center gap-3 rounded-sm px-3 text-ink-2 aria-[current=page]:bg-raised aria-[current=page]:text-ink"
                    >
                      <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.5} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="type-body font-medium">{m.label}</span>
                        <span className="type-caption truncate text-ink-3">{m.description}</span>
                      </span>
                      {b?.attn && <AttnDiamond />}
                      {b?.live && <span aria-label="running" className="size-1.5 rounded-full bg-live" />}
                    </NavLink>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </nav>
    </PhoneSheet>
  )
}
