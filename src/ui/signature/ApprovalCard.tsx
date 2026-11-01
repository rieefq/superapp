import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useInRouterContext } from 'react-router'
import { Check, ChevronDown, Pencil, X } from 'lucide-react'
import { useRow } from '@/core/db'
import { getIntegration } from '@/core/integrations/catalog'
import { CAPABILITIES } from '@/core/permissions/capabilities'
import { approve, reject } from '@/core/services/approvals'
import { updateAgent } from '@/core/services/agents'
import { useSettings } from '@/core/settings'
import type { Approval, ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { DiffView } from '@/ui/display'
import { isTypingTarget } from '@/ui/hooks'
import { Button, DynamicIcon, IconButton, Input, Menu, Textarea, Tooltip, toast, type MenuItem } from '@/ui/primitives'
import {
  RISK_LABEL, approvalHeadline, grantsWithAlwaysAllow, isEditablePreview, isPatch, stampText, truncatePatch,
} from './approvalLogic'
import { useNow } from './clock'
import { useEntityActions } from './entity'
import { formatAge } from './format'
import { StatusGlyph } from './glyphs'
import { OriginBadge } from './honesty'
import { AgentMark } from './marks'
import { IdCode } from './small'
import { stripTicks } from './tense'
import { CodeSpans } from './text'
import './signature.css'

const RISK_CHIP: Record<Approval['risk'], string> = {
  low: 'border-line-strong text-ink-3',
  medium: 'border-line-input text-ink-2',
  high: 'border-fail/50 text-fail-ink',
}

const CONFIRM_MS = 3000

export interface ApprovalRequester {
  name: string
  mark?: ReactNode
}

export interface ApprovalCardProps {
  approval: Approval
  requester?: ApprovalRequester
  /** compact: Home, popovers, Run Line peek, board rows · full: timelines, Inspector, phone sheet. */
  variant?: 'compact' | 'full'
  onApprove?: (note?: string) => void | Promise<void>
  onReject?: (note?: string) => void | Promise<void>
  className?: string
  /** "Always allow {agent} to {capability}" in the Approve ▾ menu. */
  onAlwaysAllow?: () => void | Promise<void>
  /** The capability is in Settings › Safety › always ask: the always-allow option is replaced by a note. */
  alwaysAskBlocked?: boolean
  /** Edit (message, command and text previews): called with the edited payload, then the card counts as approved. */
  onEdit?: (payload: string) => void | Promise<void>
  /** Later: leave the request pending (e.g. close the popover). */
  onLater?: () => void
  /** The requesting run (handle + title link). */
  run?: { id: ID; title: string }
  onOpenRun?: () => void
  /** The run is simulated (SIM tag; message destinations read "(simulated)"). */
  simulated?: boolean
  /** Integration a message goes through ("Slack"). */
  integrationLabel?: string
  /** Approvals already resolved when the card mounts collapse to their one-line stamp (timelines). */
  collapseResolved?: boolean
}

type Mode = 'idle' | 'deny' | 'edit'

/**
 * The one approval surface (docs/DESIGN.md §5.4.9): risk · capability · LIVE/SIM · age; headline;
 * why asked; exact preview; requester; Approve ▾ · Deny · Edit · Later. HIGH risk approves on a second
 * press within 3s. Y / D / E work while focus is in the card. Resolution wipes the tint left to right,
 * then stamps the decision.
 */
export function ApprovalCard({
  approval, requester, variant = 'full', onApprove, onReject, className, onAlwaysAllow, alwaysAskBlocked, onEdit, onLater, run, onOpenRun,
  simulated, integrationLabel, collapseResolved,
}: ApprovalCardProps) {
  const pending = approval.status === 'pending'
  const compact = variant === 'compact'
  const [mode, setMode] = useState<Mode>('idle')
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState<null | 'approve' | 'deny' | 'edit' | 'always'>(null)
  const [reason, setReason] = useState('')
  const [draft, setDraft] = useState(approval.preview?.content ?? '')
  const [showAllDiff, setShowAllDiff] = useState(false)
  const rootRef = useRef<HTMLElement>(null)
  const denyBtnRef = useRef<HTMLButtonElement>(null)
  const reasonRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  const ids = useId()
  const now = useNow(pending, 30_000)

  // Highlighter wipe only when this card watched the approval resolve.
  const [wasPending, setWasPending] = useState(pending)
  const [justResolved, setJustResolved] = useState(false)
  if (wasPending !== pending) {
    setWasPending(pending)
    if (!pending) setJustResolved(true)
  }

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [armed])

  useEffect(() => {
    if (mode === 'deny') reasonRef.current?.focus()
    if (mode === 'edit') draftRef.current?.focus()
  }, [mode])

  const cap = CAPABILITIES[approval.capability]
  const capLabel = cap?.label ?? approval.capability
  const headline = approvalHeadline(approval.title, requester?.name)
  const high = approval.risk === 'high'
  const preview = approval.preview
  const editable = !!onEdit && isEditablePreview(approval)
  const canAct = pending && !busy

  const run_ = async (kind: NonNullable<typeof busy>, fn?: () => void | Promise<void>) => {
    if (!fn) return
    const hadFocus = rootRef.current?.contains(document.activeElement)
    setBusy(kind)
    try {
      await fn()
      setMode('idle')
      setArmed(false)
    } finally {
      setBusy(null)
      if (hadFocus) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }))
    }
  }

  const doApprove = () => {
    if (!canAct || !onApprove) return
    if (high && !armed) {
      setArmed(true)
      return
    }
    void run_('approve', () => onApprove())
  }
  const doAlwaysAllow = () => {
    if (!canAct || !onAlwaysAllow) return
    void run_('always', onAlwaysAllow)
  }
  const doDeny = () => {
    if (!canAct || !onReject) return
    void run_('deny', () => onReject(reason.trim() || undefined))
  }
  const doEdit = () => {
    if (!canAct || !onEdit) return
    if (high && !armed) {
      setArmed(true)
      return
    }
    void run_('edit', () => onEdit(draft))
  }
  const cancelMode = () => {
    setMode('idle')
    setArmed(false)
    requestAnimationFrame(() => denyBtnRef.current?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!pending || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'Escape' && mode !== 'idle') {
      e.preventDefault()
      e.stopPropagation()
      cancelMode()
      return
    }
    if (isTypingTarget(e.target)) return
    const key = e.key.toLowerCase()
    if (key === 'y' && onApprove) {
      e.preventDefault()
      e.stopPropagation()
      if (mode === 'edit') doEdit()
      else doApprove()
    } else if (key === 'd' && onReject) {
      e.preventDefault()
      e.stopPropagation()
      setArmed(false)
      setMode('deny')
    } else if (key === 'e' && editable) {
      e.preventDefault()
      e.stopPropagation()
      setArmed(false)
      setDraft(approval.preview?.content ?? '')
      setMode('edit')
    }
  }

  const age = formatAge(Math.max(0, now - approval.createdAt))
  const destination =
    preview?.kind === 'message'
      ? [preview.label, integrationLabel ? `${integrationLabel}${simulated ? ' (simulated)' : ''}` : simulated ? '(simulated)' : undefined]
          .filter(Boolean)
          .join(' · ')
      : preview?.label

  const menu: MenuItem[] = [
    {
      id: 'once',
      label: 'Approve once',
      description: alwaysAskBlocked
        ? `Always allow is unavailable: Settings › Safety always asks before ${capLabel.toLowerCase()}.`
        : 'Ask again next time',
      icon: Check,
      onSelect: doApprove,
    },
  ]
  if (onAlwaysAllow && !alwaysAskBlocked) {
    menu.push({
      id: 'always',
      label: `Always allow ${requester?.name ?? 'this agent'} to ${capLabel.toLowerCase()}`,
      description: 'Saves a permission for this agent and approves now',
      onSelect: doAlwaysAllow,
    })
  }
  const showMenu = !!onApprove && (!!onAlwaysAllow || !!alwaysAskBlocked)
  const btn = compact ? 'sm' : 'md'

  if (!pending && !justResolved && collapseResolved) {
    return (
      <p className={cn('type-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-ink-2', className)}>
        <StatusGlyph
          shape={approval.status === 'approved' ? 'check' : approval.status === 'rejected' ? 'cross' : 'slash'}
          tone={approval.status === 'approved' ? 'done' : approval.status === 'rejected' ? 'fail' : 'ink-3'}
          decorative
        />
        <span>{stampText(approval)}</span>
        <span aria-hidden className="text-ink-4">·</span>
        <span className="text-ink-3">{capLabel}</span>
      </p>
    )
  }

  return (
    <article
      ref={rootRef}
      tabIndex={pending ? 0 : -1}
      onKeyDown={onKeyDown}
      aria-label={`Approval: ${stripTicks(headline)}`}
      aria-describedby={approval.reason ? `${ids}-why` : undefined}
      aria-keyshortcuts={pending ? 'Y D E' : undefined}
      data-status={approval.status}
      className={cn(
        'relative isolate overflow-hidden rounded-md border border-line text-left outline-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--focus-ring)',
        className,
      )}
    >
      {(pending || justResolved) && (
        <span
          aria-hidden
          className={cn('absolute inset-0 -z-10 bg-attn-tint shadow-[inset_2px_0_0_var(--attn)]', !pending && 'sig-wipe')}
        />
      )}
      <div className={cn('flex flex-col', compact ? 'gap-2 p-2.5' : 'gap-2.5 p-3')}>
        {/* 1. risk · capability · LIVE/SIM · age */}
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('type-meta-caps inline-flex h-4 shrink-0 items-center rounded-xs border px-1', RISK_CHIP[approval.risk])}>
            {RISK_LABEL[approval.risk]}
          </span>
          <span className="type-caption inline-flex min-w-0 items-center gap-1 font-medium text-ink-2">
            {cap && <DynamicIcon name={cap.icon} className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />}
            <span className="truncate">{capLabel}</span>
          </span>
          {simulated !== undefined && <OriginBadge simulated={simulated} />}
          <span className="flex-1" />
          {pending && <span className="type-meta shrink-0 text-ink-3">waiting {age}</span>}
        </div>

        {/* 2. headline */}
        <p className={cn('font-medium text-ink text-pretty', compact ? 'type-body-sm font-medium' : 'type-body font-medium')}>
          <CodeSpans text={headline} />
        </p>

        {/* description + 3. why asked (full) */}
        {!compact && approval.description && <p className="type-body-sm -mt-1 text-ink-2 text-pretty">{approval.description}</p>}
        {!compact && approval.reason && (
          <p id={`${ids}-why`} className="type-caption text-ink-2">
            <span className="mr-1.5 text-ink-3">Why asked</span>
            {approval.reason}
          </p>
        )}

        {/* 4. exact preview */}
        {preview && mode !== 'edit' && (
          <Preview
            kind={preview.kind}
            content={preview.content}
            label={destination}
            compact={compact}
            showAll={showAllDiff}
            onShowAll={() => setShowAllDiff(true)}
          />
        )}
        {mode === 'edit' && preview && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-draft`} className="type-caption text-ink-3">
              Edit the {preview.kind === 'command' ? 'command' : preview.kind === 'message' ? 'message' : 'text'} before approving
            </label>
            {preview.kind === 'command' ? (
              <Input
                id={`${ids}-draft`}
                ref={draftRef}
                value={draft}
                onValueChange={setDraft}
                prefix={<span className="font-mono text-ink-4">$</span>}
                className="font-mono"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    doEdit()
                  }
                }}
              />
            ) : (
              <Textarea id={`${ids}-draft`} ref={draftRef} value={draft} onValueChange={setDraft} autosize minRows={3} maxRows={10} />
            )}
          </div>
        )}

        {/* 5. requester (full) */}
        {!compact && (requester || run) && (
          <div className="type-caption flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-ink-3">
            {requester?.mark}
            {requester && <span className="font-medium text-ink-2">{requester.name}</span>}
            {run && (
              <>
                <IdCode id={run.id} />
                <span aria-hidden className="text-ink-4">·</span>
                {onOpenRun ? (
                  <button
                    type="button"
                    onClick={onOpenRun}
                    className="min-w-0 truncate rounded-xs text-left text-ink-2 underline decoration-line-input underline-offset-[3px] transition-colors duration-(--dur-1) hover:text-ink hover:decoration-ink"
                  >
                    {run.title}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-ink-2">{run.title}</span>
                )}
              </>
            )}
          </div>
        )}

        {/* 6. actions, or the stamp */}
        {pending ? (
          mode === 'deny' ? (
            <form
              className="flex flex-wrap items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                doDeny()
              }}
            >
              <Input
                ref={reasonRef}
                size={compact ? 'sm' : 'md'}
                value={reason}
                onValueChange={setReason}
                placeholder="Reason (optional)"
                aria-label="Reason for denying (optional), sent back to the run"
                wrapperClassName="min-w-0 flex-[1_1_180px]"
              />
              <Button type="submit" size={btn} variant="danger" loading={busy === 'deny'} leadingIcon={X}>
                Deny
              </Button>
              <Button size={btn} variant="ghost" onClick={cancelMode}>
                Cancel
              </Button>
            </form>
          ) : mode === 'edit' ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size={btn} variant={armed ? 'danger-solid' : 'primary'} loading={busy === 'edit'} onClick={doEdit} disabled={!draft.trim()}>
                {armed ? 'Confirm save and approve' : 'Save and approve'}
              </Button>
              <Button size={btn} variant="ghost" onClick={cancelMode}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {onApprove && (
                <span className="inline-flex">
                  <Tooltip content={armed ? 'Press again within 3 seconds' : 'Approve'} shortcut="y" asLabel>
                    <Button
                      size={btn}
                      variant={armed ? 'danger-solid' : 'primary'}
                      loading={busy === 'approve' || busy === 'always'}
                      onClick={doApprove}
                      aria-keyshortcuts="Y"
                      className={cn(showMenu && !armed && 'rounded-r-none')}
                    >
                      {armed ? 'Confirm approve' : 'Approve'}
                    </Button>
                  </Tooltip>
                  {showMenu && !armed && (
                    <Menu
                      items={menu}
                      placement="bottom-start"
                      aria-label="Approve options"
                      trigger={
                        <IconButton
                          icon={ChevronDown}
                          label="Approve options"
                          variant="primary"
                          size={btn}
                          tooltip={false}
                          disabled={!canAct}
                          className="rounded-l-none border-l border-inverse-ink/20"
                        />
                      }
                    />
                  )}
                </span>
              )}
              {onReject && (
                <Tooltip content="Deny" shortcut="d" asLabel>
                  <Button ref={denyBtnRef} size={btn} variant="ghost" onClick={() => setMode('deny')} disabled={!canAct} aria-keyshortcuts="D">
                    Deny
                  </Button>
                </Tooltip>
              )}
              {editable && (
                <Tooltip content="Edit, then approve" shortcut="e" asLabel>
                  <Button
                    size={btn}
                    variant="ghost"
                    leadingIcon={Pencil}
                    onClick={() => {
                      setDraft(approval.preview?.content ?? '')
                      setMode('edit')
                    }}
                    disabled={!canAct}
                    aria-keyshortcuts="E"
                  >
                    Edit
                  </Button>
                </Tooltip>
              )}
              <span className="flex-1" />
              {onLater && (
                <Button size={btn} variant="ghost" onClick={onLater} className="text-ink-3">
                  Later
                </Button>
              )}
            </div>
          )
        ) : (
          <p className={cn('type-caption flex items-center gap-1.5 text-ink-2', justResolved ? 'sig-stamp-delayed' : undefined)} role="status">
            <StatusGlyph
              shape={approval.status === 'approved' ? 'check' : approval.status === 'rejected' ? 'cross' : 'slash'}
              tone={approval.status === 'approved' ? 'done' : approval.status === 'rejected' ? 'fail' : 'ink-3'}
              decorative
            />
            {stampText(approval)}
          </p>
        )}
        {pending && armed && (
          <p role="status" className="type-caption -mt-1 text-ink-2">
            High risk. {mode === 'edit' ? 'Select Confirm' : 'Press Y again or select Confirm approve'} within 3 seconds.
          </p>
        )}
      </div>
    </article>
  )
}

function Preview({
  kind, content, label, compact, showAll, onShowAll,
}: { kind: NonNullable<Approval['preview']>['kind']; content: string; label?: string; compact: boolean; showAll: boolean; onShowAll: () => void }) {
  if (kind === 'command') {
    return (
      <div className="flex flex-col gap-1">
        {label && !compact && <span className="type-meta text-ink-3">{label}</span>}
        <pre className="type-mono-sm overflow-x-auto rounded-sm border border-line bg-sunken px-3 py-2 whitespace-pre-wrap text-ink [overflow-wrap:anywhere]">
          <span aria-hidden className="mr-2 text-ink-4 select-none">
            $
          </span>
          {content}
        </pre>
      </div>
    )
  }
  if (kind === 'diff' && isPatch(content)) {
    const limit = compact ? 3 : 12
    const { patch, hidden } = showAll ? { patch: content, hidden: 0 } : truncatePatch(content, limit)
    return (
      <div className="flex flex-col gap-1">
        <DiffView patch={patch} path={label} hideHeader={compact} maxHeight={showAll ? 420 : undefined} className="text-xs" />
        {hidden > 0 && (
          <Button size="xs" variant="ghost" onClick={onShowAll} className="self-start text-ink-2">
            Show all · {hidden} more {hidden === 1 ? 'line' : 'lines'}
          </Button>
        )}
      </div>
    )
  }
  return (
    <figure className="flex flex-col gap-1">
      {label && <figcaption className="type-meta text-ink-3">{label}</figcaption>}
      <blockquote
        className={cn(
          'type-body-sm border-l-2 border-line-strong pl-3 whitespace-pre-wrap text-ink-2 [overflow-wrap:anywhere]',
          compact ? 'line-clamp-3' : 'max-h-64 overflow-y-auto',
        )}
      >
        {content}
      </blockquote>
    </figure>
  )
}

// ------------------------------------------------------------------ connected

export interface ApprovalCardConnectedProps {
  approvalId: ID
  variant?: 'compact' | 'full'
  onLater?: () => void
  className?: string
  /** What to show when the approval does not exist: a quiet note (default) or nothing. */
  ifMissing?: 'note' | 'nothing'
  /** Collapse approvals that were already resolved on mount to their stamp line. */
  collapseResolved?: boolean
  /** Show the requesting run's handle and title (default true; off inside that run's own timeline). */
  showRun?: boolean
}

/** ApprovalCard wired to the approvals and agents services, with toasts. */
export function ApprovalCardConnected(props: ApprovalCardConnectedProps) {
  const routed = useInRouterContext()
  return routed ? <RoutedConnected {...props} /> : <ConnectedCard {...props} />
}

function RoutedConnected(props: ApprovalCardConnectedProps) {
  const { inspect } = useEntityActions()
  return <ConnectedCard {...props} onOpenRun={(runId) => inspect({ kind: 'run', id: runId })} />
}

function ConnectedCard({
  approvalId, variant, onLater, className, onOpenRun, ifMissing = 'note', collapseResolved, showRun = true,
}: ApprovalCardConnectedProps & { onOpenRun?: (runId: ID) => void }) {
  const approval = useRow('approvals', approvalId)
  const run = useRow('runs', approval?.runId)
  const agentId = approval?.requestedBy.type === 'agent' ? approval.requestedBy.id : run?.agentId
  const agent = useRow('agents', agentId)
  const blocked = useSettings((s) => !!approval && s.safety.alwaysAsk.includes(approval.capability))

  if (!approval) {
    if (ifMissing === 'nothing') return null
    return <p className={cn('type-caption rounded-md border border-line p-3 text-ink-3', className)}>This approval no longer exists.</p>
  }
  const step = run?.steps.find((s) => s.id === approval.stepId)
  const integration = step?.integrationId ? getIntegration(step.integrationId) : undefined
  const capLabel = CAPABILITIES[approval.capability]?.label ?? approval.capability
  const headline = approvalHeadline(approval.title, agent?.name)

  const guard = (verb: string, fn: () => void) => {
    try {
      fn()
    } catch (error) {
      toast.error(`Couldn't ${verb}`, {
        description: error instanceof Error ? error.message : String(error),
        action: { label: 'Retry', onClick: () => guard(verb, fn) },
      })
    }
  }

  return (
    <ApprovalCard
      approval={approval}
      variant={variant}
      className={className}
      simulated={run?.simulated}
      integrationLabel={integration?.name}
      requester={agent ? { name: agent.name, mark: <AgentMark seed={agent.sigil} hue={agent.hue} size={16} /> } : undefined}
      run={run && showRun ? { id: run.id, title: run.title } : undefined}
      onOpenRun={run && showRun && onOpenRun ? () => onOpenRun(run.id) : undefined}
      alwaysAskBlocked={blocked}
      collapseResolved={collapseResolved}
      onLater={onLater}
      onApprove={(note) =>
        guard('approve', () => {
          approve(approval.id, note)
          toast.success('Approved', { description: headline })
        })
      }
      onReject={(note) =>
        guard('deny', () => {
          reject(approval.id, note)
          toast('Denied', { description: note ? `${headline} · ${note}` : headline })
        })
      }
      onEdit={(payload) =>
        guard('approve', () => {
          approve(approval.id, `Edited before approving: ${payload.length > 140 ? `${payload.slice(0, 139)}…` : payload}`, { payload })
          toast.success('Approved with your edit', { description: headline })
        })
      }
      onAlwaysAllow={
        agent
          ? () =>
              guard('save the permission', () => {
                const previous = agent.capabilities
                updateAgent(agent.id, { capabilities: grantsWithAlwaysAllow(agent, approval.capability) })
                approve(approval.id, `Always allow ${agent.name} to ${capLabel.toLowerCase()}`)
                toast.success(`${agent.name} can ${capLabel.toLowerCase()} without asking`, {
                  description: 'Change it any time in the agent’s permissions.',
                  duration: 8000,
                  action: { label: 'Undo', onClick: () => updateAgent(agent.id, { capabilities: previous }) },
                })
              })
          : undefined
      }
    />
  )
}
