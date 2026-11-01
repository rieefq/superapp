import { useNavigate } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { NEXT_ACTION_KINDS, useNextActions, type NextAction } from '@/core/assist'
import { DynamicIcon, Tooltip } from '@/ui'

/** Kinds Home already shows elsewhere (Needs you, Landed). */
const SHOWN_ELSEWHERE = new Set<NextAction['kind']>(['approve', 'review', 'retry'])

/**
 * "All quiet. What's next?" answered from workspace rules (not AI): due tasks, conversations to resume,
 * broken integrations, idle agents. Shown only in the quiet state, under the composer.
 */
export function NextUp() {
  const navigate = useNavigate()
  const actions = useNextActions(8).filter((a) => !SHOWN_ELSEWHERE.has(a.kind)).slice(0, 3)
  if (!actions.length) return null
  return (
    <section aria-labelledby="home-next-up" className="mt-4 flex max-w-[760px] flex-col gap-1">
      <h2 id="home-next-up" className="type-label px-0.5 text-ink-3">
        Next up <span className="font-normal tracking-normal normal-case">· suggested from your workspace, not AI</span>
      </h2>
      <ul className="-mx-2 flex flex-col">
        {actions.map((a) => {
          const meta = NEXT_ACTION_KINDS[a.kind]
          return (
            <li key={a.id}>
              <Tooltip content={a.reason}>
                <button
                  type="button"
                  onClick={() => navigate(a.route)}
                  className="group/next flex h-9 w-full min-w-0 items-center gap-2.5 rounded-sm px-2 text-left transition-colors duration-(--dur-1) hover:bg-hover"
                >
                  <DynamicIcon name={meta.icon} aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                  <span className="type-body-sm min-w-0 flex-1 truncate text-ink-2 group-hover/next:text-ink">{a.title}</span>
                  <span className="type-caption shrink-0 font-medium text-ink-3 group-hover/next:text-ink-2">{a.actionLabel}</span>
                  <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
                </button>
              </Tooltip>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
