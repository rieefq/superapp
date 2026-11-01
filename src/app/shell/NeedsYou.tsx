import { useNavigate } from 'react-router'
import { Check, GitPullRequestArrow, Inbox, SquareCheckBig } from 'lucide-react'
import { approve, entityRoute, markAllRead, markRead, useEntity, useNotifications } from '@/core/services'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import type { Approval, CodeSession, Notification, Task } from '@/core/types'
import { Button, Tabs, VisuallyHidden, confirm, toast } from '@/ui'
import { EntityChip } from '@/ui/signature'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { useShellStore } from './store'
import { ShellPopover } from './overlays'
import { needsYouCount, useNeedsYou, useUnreadUpdates } from './signals'
import { ConnectedApproval, RunGlyph } from './sig'

/** The amber ◆ (attention), drawn as a rotated square — never text on solid amber. */
export function AttnDiamond({ className }: { className?: string }) {
  return <span aria-hidden className={cn('inline-block size-[7px] shrink-0 rotate-45 rounded-[1px] bg-attn', className)} />
}

/** Top-bar Needs-you button + popover (§3.2, §3.8). `!` opens it. */
export function NeedsYouButton({ compact = false }: { compact?: boolean }) {
  const open = useShellStore((s) => s.needsYouOpen)
  const setOpen = useShellStore((s) => s.setNeedsYouOpen)
  const needs = useNeedsYou()
  const count = needsYouCount(needs)
  const unread = useUnreadUpdates()
  const label = count > 0 ? `Needs you: ${count}` : unread > 0 ? `Updates: ${unread} unread` : 'Needs you and updates'

  return (
    <ShellPopover
      open={open}
      onOpenChange={setOpen}
      title="Needs you"
      width={420}
      trigger={(props, state) => (
        <button
          type="button"
          {...(props as object)}
          aria-label={label}
          aria-keyshortcuts="Shift+1"
          className={cn(
            'relative flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-sm px-2 transition-colors duration-(--dur-1) ease-standard',
            'text-ink-3 hover:bg-hover hover:text-ink active:bg-press',
            state.open && 'bg-hover text-ink',
            count > 0 && 'text-ink-2',
          )}
        >
          <Inbox aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
          {count > 0 ? (
            <span className="flex items-center gap-1.5">
              <AttnDiamond />
              <span className="type-meta text-attn-ink tabular-nums">{count}</span>
            </span>
          ) : (
            unread > 0 && !compact && <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-ink-2" />
          )}
          {count === 0 && unread > 0 && compact && <span aria-hidden className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-ink-2" />}
        </button>
      )}
    >
      {({ close }) => <NeedsYouPanel close={close} />}
    </ShellPopover>
  )
}

export function NeedsYouPanel({ close }: { close: () => void }) {
  const tab = useShellStore((s) => s.needsYouTab)
  const setTab = useShellStore((s) => s.setNeedsYouTab)
  const needs = useNeedsYou()
  const count = needsYouCount(needs)
  const unread = useUnreadUpdates()
  return (
    <div className="flex min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-3">
        <Tabs
          size="md"
          value={tab}
          onValueChange={(v) => setTab(v as 'needs' | 'updates')}
          aria-label="Needs you and updates"
          items={[
            { value: 'needs', label: 'Needs you', count },
            { value: 'updates', label: 'Updates', count: unread },
          ]}
        />
      </div>
      {tab === 'needs' ? <NeedsList approvals={needs.approvals} sessions={needs.sessions} tasks={needs.tasks} close={close} /> : <UpdatesList close={close} />}
    </div>
  )
}

function NeedsList({ approvals, sessions, tasks, close }: { approvals: Approval[]; sessions: CodeSession[]; tasks: Task[]; close: () => void }) {
  const total = approvals.length + sessions.length + tasks.length
  const lowRisk = approvals.filter((a) => a.risk === 'low')
  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <span aria-hidden className="grid size-9 place-items-center rounded-md border border-line bg-raised text-ink-3">
          <Check className="size-4" strokeWidth={1.75} />
        </span>
        <p className="type-body-sm font-medium text-ink">Nothing needs you.</p>
        <p className="type-caption text-ink-3">Approvals and reviews show up here the moment an agent asks.</p>
      </div>
    )
  }
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {approvals.length > 0 && (
          <section aria-label="Approvals" className="flex flex-col gap-2 p-3">
            {approvals.map((a) => (
              <ConnectedApproval key={a.id} approvalId={a.id} variant="compact" />
            ))}
          </section>
        )}
        {sessions.length > 0 && (
          <section aria-label="Changes to review" className={cn('px-1.5 pb-1.5', approvals.length > 0 && 'border-t border-line pt-1.5')}>
            <h3 className="type-label px-2.5 pt-2 pb-1.5 text-ink-3">Changes to review</h3>
            {sessions.map((s) => (
              <ReviewRow key={s.id} kind="session" id={s.id} close={close} />
            ))}
          </section>
        )}
        {tasks.length > 0 && (
          <section aria-label="Agent work to review" className={cn('px-1.5 pb-1.5', (approvals.length > 0 || sessions.length > 0) && 'border-t border-line pt-1.5')}>
            <h3 className="type-label px-2.5 pt-2 pb-1.5 text-ink-3">Agent work to review</h3>
            {tasks.map((t) => (
              <ReviewRow key={t.id} kind="task" id={t.id} close={close} />
            ))}
          </section>
        )}
      </div>
      {lowRisk.length > 0 && (
        <footer className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-line px-3">
          <span className="type-caption text-ink-3">Low risk: {lowRisk.length}</span>
          <Button size="sm" variant="secondary" onClick={() => void approveAllLowRisk(lowRisk)}>
            Approve all low-risk ({lowRisk.length})
          </Button>
        </footer>
      )}
    </>
  )
}

async function approveAllLowRisk(list: Approval[]): Promise<void> {
  const ok = await confirm({
    title: `Approve ${list.length} low-risk request${list.length === 1 ? '' : 's'}?`,
    description: (
      <span className="flex flex-col gap-2">
        <span>Each one continues its run right away.</span>
        <span className="flex flex-col gap-1">
          {list.map((a) => (
            <span key={a.id} className="type-body-sm flex gap-2 text-ink">
              <span aria-hidden className="type-meta-caps mt-px shrink-0 text-ink-3">Low</span>
              <span>
                {a.title}
                <span className="text-ink-3"> · {CAPABILITIES[a.capability]?.label ?? a.capability}</span>
              </span>
            </span>
          ))}
        </span>
      </span>
    ),
    confirmLabel: `Approve ${list.length}`,
  })
  if (!ok) return
  let done = 0
  for (const a of list) {
    try {
      approve(a.id)
      done++
    } catch (err) {
      toast.error(`Couldn’t approve “${a.title}”`, { description: err instanceof Error ? err.message : String(err) })
    }
  }
  if (done) toast.success(`Approved ${done} low-risk request${done === 1 ? '' : 's'}`)
}

function ReviewRow({ kind, id, close }: { kind: 'session' | 'task'; id: string; close: () => void }) {
  const navigate = useNavigate()
  const entity = useEntity({ kind, id })
  const Icon = kind === 'session' ? GitPullRequestArrow : SquareCheckBig
  const to = kind === 'session' ? `/code/${encodeURIComponent(id)}/changes` : entityRoute({ kind, id })
  return (
    <button
      type="button"
      onClick={() => {
        close()
        navigate(to)
      }}
      className="flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-left transition-colors duration-(--dur-1) hover:bg-hover"
    >
      <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-sm border border-line-strong bg-raised text-ink-2">
        <Icon className="size-3.5" strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-body-sm truncate font-medium text-ink">{entity.title}</span>
        <span className="type-caption truncate text-ink-3">{entity.subtitle}</span>
      </span>
      <AttnDiamond />
      <span className="type-caption shrink-0 text-ink-2">Review</span>
    </button>
  )
}

function UpdatesList({ close }: { close: () => void }) {
  const notifications = useNotifications(60).filter((n) => n.kind !== 'approval.requested')
  const unread = notifications.filter((n) => !n.readAt).length
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
        <p className="type-body-sm font-medium text-ink">You’re up to date.</p>
        <p className="type-caption text-ink-3">Finished and failed runs land here quietly.</p>
      </div>
    )
  }
  return (
    <>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5" aria-label="Updates">
        {notifications.map((n) => (
          <UpdateRow key={n.id} n={n} close={close} />
        ))}
      </ul>
      <footer className="flex h-11 shrink-0 items-center justify-between gap-3 border-t border-line px-3">
        <span className="type-caption text-ink-3">{unread ? `${unread} unread` : 'All read'}</span>
        <Button size="sm" variant="ghost" disabled={!unread} onClick={markAllRead}>
          Mark all read
        </Button>
      </footer>
    </>
  )
}

const TONE_STATUS = { success: 'succeeded', danger: 'failed', warning: 'waiting' } as const

function UpdateRow({ n, close }: { n: Notification; close: () => void }) {
  const navigate = useNavigate()
  const status = TONE_STATUS[n.tone as keyof typeof TONE_STATUS]
  const open = () => {
    markRead(n.id)
    if (!n.ref) return
    close()
    navigate(entityRoute(n.ref))
  }
  return (
    <li className="relative">
      <button
        type="button"
        onClick={open}
        className={cn(
          'flex w-full items-start gap-3 rounded-sm px-2.5 py-2.5 text-left transition-colors duration-(--dur-1) hover:bg-hover',
          !n.readAt && 'bg-raised/60',
        )}
      >
        <span className="mt-[3px] grid size-3 shrink-0 place-items-center">
          {status ? <RunGlyph status={status} /> : <span aria-hidden className="size-1.5 rounded-full bg-ink-3" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn('type-body-sm text-pretty', n.readAt ? 'text-ink-2' : 'font-medium text-ink')}>{n.title}</span>
          {n.body && <span className="type-caption line-clamp-2 text-ink-3">{n.body}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="type-meta text-ink-3">{timeAgo(n.createdAt)}</span>
          {!n.readAt && (
            <span className="flex items-center">
              <span aria-hidden className="size-1.5 rounded-full bg-ink" />
              <VisuallyHidden>Unread</VisuallyHidden>
            </span>
          )}
        </span>
      </button>
      {n.ref && (
        <div className="pointer-events-none pr-2.5 pb-2.5 pl-8.5 -mt-1">
          <span className="pointer-events-auto inline-flex max-w-full">
            <EntityChip entity={n.ref} size="sm" />
          </span>
        </div>
      )}
    </li>
  )
}
