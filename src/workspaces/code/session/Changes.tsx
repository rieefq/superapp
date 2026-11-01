import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Check, ChevronDown, Copy, Download, GitBranch, GitMerge, GitPullRequestArrow, MessageSquareReply, Undo2, X } from 'lucide-react'
import { useDB, type Tables } from '@/core/db'
import {
  acceptAllChanges, applyChanges, continueSession, mergePullRequest, openPullRequest, PR_FACTORY, rejectAllChanges, reviewChange,
} from '@/core/services'
import { useSettings } from '@/core/settings'
import { isRunActive, type CodeSession, type FileChange } from '@/core/types'
import { cn } from '@/lib/cn'
import {
  Button, DiffStat, DiffView, EmptyState, Menu, Popover, SimBadge, StatusGlyph, StepTape, Textarea, Tooltip, toast, useHotkey, useLocalStorageState,
  type DiffMode,
} from '@/ui'
import { copyDiff, exportPatch, restoreWithToast } from '../actions'
import { insertIntoComposer } from '../drafts'
import { useElementWidth } from '../hooks'
import { CHANGE_LETTER, CHANGE_WORD, changeStats, checksClause, checksSummary, nextPendingIndex, requestChangesDraft, REVIEW_WORD, reviewSentence, splitPath } from '../logic'

/**
 * Changes (§6.3): the file list (path, M/A/D/R, +/−, decision), the selected file's diff (unified by
 * default, split from 720px, `V`), per-file decisions (`A` accept · `R` reject · `U` clear, `J`/`K` move)
 * and the sticky review bar that always reads as one sentence, with Request changes, Reject all and
 * Approve & open PR (simulated) ▾ (Apply to branch only · Export .patch · Copy diff).
 */
export function ChangesPane({ session, selectedPath, onSelectPath, active }: { session: CodeSession; selectedPath: string | null; onSelectPath: (path: string | null) => void; active: boolean }) {
  const changes = session.changes
  const paneRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(paneRef)
  const [storedMode, setStoredMode] = useLocalStorageState<DiffMode>('atrium.code.diffMode', 'unified')
  const mode: DiffMode = width > 0 && width < 720 ? 'unified' : storedMode
  const narrow = width > 0 && width < 560
  const singleKeys = useSettings((s) => s.appearance.singleKeyShortcuts)
  // The selection is the URL's ?file= when it names a changed file, otherwise the first file.
  const index = Math.max(0, changes.findIndex((c) => c.path === selectedPath))
  const selected = changes[index]
  // Archived sessions are read-only; merged ones have nothing left to decide.
  const readOnly = session.status === 'archived' || session.status === 'merged'

  const decide = (change: FileChange | undefined, review: NonNullable<FileChange['review']>, advance = true) => {
    if (!change || readOnly) return
    const next = change.review === review && review !== 'pending' ? 'pending' : review
    reviewChange(session.id, change.path, next)
    if (advance && next !== 'pending') {
      const fresh = useDB.getState().sessions[session.id]?.changes ?? changes
      const i = fresh.findIndex((c) => c.path === change.path)
      const to = nextPendingIndex(fresh, i)
      if (to !== i && fresh[to]) onSelectPath(fresh[to].path)
    }
  }
  const move = (delta: number) => {
    if (!changes.length) return
    const i = (index + delta + changes.length) % changes.length
    onSelectPath(changes[i].path)
    requestAnimationFrame(() => paneRef.current?.querySelector<HTMLElement>(`[data-file-row="${CSS.escape(changes[i].path)}"]`)?.scrollIntoView({ block: 'nearest' }))
  }

  const keysOn = active && singleKeys && changes.length > 0
  useHotkey('j', () => move(1), { enabled: keysOn })
  useHotkey('k', () => move(-1), { enabled: keysOn })
  useHotkey('a', () => decide(selected, 'accepted'), { enabled: keysOn && !readOnly })
  useHotkey('r', () => decide(selected, 'rejected'), { enabled: keysOn && !readOnly })
  useHotkey('u', () => decide(selected, 'pending', false), { enabled: keysOn && !readOnly })
  useHotkey('v', () => setStoredMode(mode === 'unified' ? 'split' : 'unified'), { enabled: keysOn && width >= 720 })

  if (!changes.length) {
    return (
      <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <NoChanges session={session} />
      </div>
    )
  }

  const onLineClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!selected || readOnly) return
    const target = e.target as HTMLElement
    // Line numbers are the right-aligned tabular cells of the diff gutter.
    const cell = target.closest('span.tabular.text-right')
    const n = Number(cell?.textContent?.trim())
    if (!cell || !Number.isFinite(n) || n <= 0) return
    insertIntoComposer(session.id, `${selected.path}:${n}`)
    toast({ title: `Added ${selected.path}:${n} to the instruction`, description: 'Finish the sentence in the composer.' })
  }

  return (
    <div ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <FileList changes={changes} selectedPath={selected?.path ?? null} onSelect={onSelectPath} readOnly={readOnly} onDecide={decide} />
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-4 py-4 md:px-5" data-diff-scroll="">
        {selected && (
          <div onClick={onLineClick} className={cn(!readOnly && '[&_span.tabular.text-right]:cursor-pointer [&_span.tabular.text-right:hover]:text-ink-2')}>
            {/* Narrow panes: the decision sits above the diff so the diff header keeps its path. */}
            {!readOnly && narrow && (
              <div className="mb-2 flex items-center justify-end gap-1">
                <span className="type-caption mr-auto text-ink-3">{REVIEW_WORD[selected.review ?? 'pending']}</span>
                <DecisionButtons change={selected} onDecide={(r) => decide(selected, r)} />
              </div>
            )}
            <DiffView
              key={selected.path}
              oldText={selected.changeType === 'added' ? '' : (selected.before ?? '')}
              newText={selected.changeType === 'deleted' ? '' : (selected.after ?? '')}
              path={selected.path}
              oldPath={selected.oldPath}
              mode={mode}
              onModeChange={setStoredMode}
              actions={readOnly || narrow ? undefined : <DecisionButtons change={selected} onDecide={(r) => decide(selected, r)} />}
            />
            <p className="type-caption mt-2 text-ink-3 pointer-coarse:hidden">
              {readOnly ? (session.status === 'merged' ? 'Merged — these changes are on the base branch (simulated).' : 'Archived sessions are read-only.') : 'Click a line number to reference it in your next instruction · J/K next or previous file · A accept · R reject · U clear · V layout'}
            </p>
          </div>
        )}
      </div>
      <ReviewBar session={session} />
    </div>
  )
}

function NoChanges({ session }: { session: CodeSession }) {
  const runId = session.turns[session.turns.length - 1]?.runId
  const run = useDB((s: Tables) => (runId ? s.runs[runId] : undefined))
  const working = session.status === 'working' && !!run && isRunActive(run.status)
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-10">
      <EmptyState
        compact={false}
        icon={GitPullRequestArrow}
        title={working ? 'No changes yet' : 'No changes proposed'}
        description={
          working
            ? 'Files the agent edits land here for your review as the turn works.'
            : session.status === 'failed'
              ? 'The last turn stopped before changing any file. Retry it from Activity, or give a new instruction.'
              : 'This session has not changed any file. Give an instruction to start.'
        }
        actions={working && run ? <StepTape run={run} size="sm" /> : undefined}
      />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ file list

const DECISION_GLYPH: Record<NonNullable<FileChange['review']>, { shape: 'check' | 'cross' | 'ring'; tone: 'done' | 'fail' | 'ink-3' }> = {
  accepted: { shape: 'check', tone: 'done' },
  rejected: { shape: 'cross', tone: 'fail' },
  pending: { shape: 'ring', tone: 'ink-3' },
}

function FileList({
  changes, selectedPath, onSelect, readOnly, onDecide,
}: { changes: readonly FileChange[]; selectedPath: string | null; onSelect: (path: string) => void; readOnly: boolean; onDecide: (c: FileChange, r: NonNullable<FileChange['review']>, advance?: boolean) => void }) {
  const listRef = useRef<HTMLUListElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = changes.findIndex((c) => c.path === selectedPath)
    let to = -1
    if (e.key === 'ArrowDown') to = Math.min(changes.length - 1, i + 1)
    else if (e.key === 'ArrowUp') to = Math.max(0, i - 1)
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = changes.length - 1
    if (to < 0) return
    e.preventDefault()
    onSelect(changes[to].path)
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-file-row="${CSS.escape(changes[to].path)}"]`)?.focus())
  }
  return (
    <div className="max-h-[40%] min-h-[88px] shrink-0 overflow-y-auto overscroll-contain border-b border-line py-1.5">
      <ul ref={listRef} role="listbox" aria-label="Changed files" onKeyDown={onKeyDown} className="flex flex-col gap-px px-1.5">
        {changes.map((c) => (
          <FileRow key={c.path} change={c} selected={c.path === selectedPath} onSelect={onSelect} readOnly={readOnly} onDecide={onDecide} />
        ))}
      </ul>
    </div>
  )
}

const FileRow = memo(function FileRow({
  change, selected, onSelect, readOnly, onDecide,
}: { change: FileChange; selected: boolean; onSelect: (path: string) => void; readOnly: boolean; onDecide: (c: FileChange, r: NonNullable<FileChange['review']>, advance?: boolean) => void }) {
  const { dir, base } = splitPath(change.path)
  const review = change.review ?? 'pending'
  const glyph = DECISION_GLYPH[review]
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      data-file-row={change.path}
      onClick={() => onSelect(change.path)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(change.path)
        }
      }}
      aria-label={`${change.path}, ${CHANGE_WORD[change.changeType].toLowerCase()}, ${change.additions} additions, ${change.deletions} deletions, ${REVIEW_WORD[review].toLowerCase()}`}
      className={cn(
        'group/file flex h-8 min-w-0 cursor-default items-center gap-2.5 rounded-sm px-2.5 outline-none transition-colors duration-(--dur-1) pointer-coarse:h-11',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--focus-ring)',
        selected ? 'bg-accent-tint' : 'hover:bg-hover',
      )}
    >
      <span aria-hidden className="w-3 shrink-0 text-center font-mono text-[11px] text-ink-3" title={CHANGE_WORD[change.changeType]}>
        {CHANGE_LETTER[change.changeType]}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={change.path}>
        <span className="text-ink-3">{dir}</span>
        <span className={selected ? 'text-ink' : 'text-ink-2 group-hover/file:text-ink'}>{base}</span>
      </span>
      <DiffStat additions={change.additions} deletions={change.deletions} hideBar className="shrink-0" />
      {!readOnly && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/file:opacity-100 group-focus-within/file:opacity-100 pointer-coarse:opacity-100">
          <QuickDecision label={`Accept ${change.path}`} icon={Check} active={review === 'accepted'} onClick={() => onDecide(change, 'accepted', false)} />
          <QuickDecision label={`Reject ${change.path}`} icon={X} active={review === 'rejected'} onClick={() => onDecide(change, 'rejected', false)} />
        </span>
      )}
      <StatusGlyph shape={glyph.shape} tone={glyph.tone} size={12} label={REVIEW_WORD[review]} />
    </li>
  )
})

function QuickDecision({ label, icon: Icon, active, onClick }: { label: string; icon: typeof Check; active: boolean; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation()
          onClick()
        }}
        className={cn(
          'relative grid size-6 place-items-center rounded-xs text-ink-3 transition-colors duration-(--dur-1) hover:bg-press hover:text-ink pointer-coarse:after:absolute pointer-coarse:after:-inset-2.5',
          active && 'bg-press text-ink',
        )}
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={2} />
      </button>
    </Tooltip>
  )
}

/** Accept / Reject for the selected file, in the diff header (toggle: pressing again clears). */
function DecisionButtons({ change, onDecide }: { change: FileChange; onDecide: (r: NonNullable<FileChange['review']>) => void }) {
  const review = change.review ?? 'pending'
  return (
    <span className="flex items-center gap-1">
      <Button size="xs" variant={review === 'accepted' ? 'secondary' : 'ghost'} leadingIcon={Check} aria-pressed={review === 'accepted'} kbd="a" onClick={() => onDecide('accepted')}>
        {review === 'accepted' ? 'Accepted' : 'Accept'}
      </Button>
      <Button size="xs" variant={review === 'rejected' ? 'secondary' : 'ghost'} leadingIcon={X} aria-pressed={review === 'rejected'} kbd="r" onClick={() => onDecide('rejected')}>
        {review === 'rejected' ? 'Rejected' : 'Reject'}
      </Button>
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ review bar

/** The sticky review bar (§6.3): one sentence, then Request changes · Reject all · Approve & open PR (simulated) ▾. */
export function ReviewBar({ session }: { session: CodeSession }) {
  const stats = useMemo(() => changeStats(session.changes), [session.changes])
  const checks = useMemo(() => checksSummary(session.checks), [session.checks])
  const latestRunId = session.turns[session.turns.length - 1]?.runId
  const turnActive = useDB((s: Tables) => (latestRunId ? isRunActive(s.runs[latestRunId]?.status ?? 'succeeded') : false))
  const prRunId = useDB((s: Tables) => {
    for (const r of Object.values(s.runs)) {
      if (r.origin?.kind === 'session' && r.origin.id === session.id && r.script?.factory === PR_FACTORY && isRunActive(r.status)) return r.id
    }
    return null
  })
  const prRunRow = useDB((s: Tables) => (prRunId ? s.runs[prRunId] : undefined))
  const agentName = useDB((s: Tables) => (session.agentId ? s.agents[session.agentId]?.name : undefined)) ?? 'The agent'
  const archived = session.status === 'archived'
  const pr = session.pr

  let state: 'archived' | 'pr-running' | 'pr-open' | 'merged' | 'working' | 'review' = 'review'
  if (archived) state = 'archived'
  else if (prRunRow) state = 'pr-running'
  else if (session.status === 'merged' || pr?.status === 'merged') state = 'merged'
  else if (pr?.status === 'open') state = 'pr-open'
  else if (turnActive) state = 'working'

  const sentence = reviewSentence(stats)
  return (
    <div role="region" aria-label="Review decision" className="@container sticky bottom-0 z-(--z-sticky) shrink-0 border-t border-line bg-canvas px-4 py-2.5 md:px-5">
      <div className="flex flex-col gap-2 @min-[860px]:flex-row @min-[860px]:items-center @min-[860px]:gap-4">
        <p className="type-body-sm min-w-0 flex-1 text-ink-2" aria-live="polite">
          <span className="tabular">{sentence}</span>
          <span aria-hidden className="text-ink-4">
            {' · '}
          </span>
          <span className="tabular">{checksClause(checks)}</span>
          {checks.total > 0 && <SimBadge className="ml-1.5 align-[-3px]" />}
          {state === 'review' && stats.accepted === 0 && stats.pending > 0 && <span className="text-ink-3"> · Accept the files you want in the pull request</span>}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-1.5 @max-[859px]:-mr-1">
          {state === 'archived' && (
            <Button size="sm" variant="secondary" leadingIcon={Undo2} onClick={() => restoreWithToast(session.id)}>
              Restore
            </Button>
          )}
          {state === 'pr-running' && prRunRow && (
            <span className="type-caption inline-flex items-center gap-2 text-ink-2">
              <StepTape run={prRunRow} size="sm" />
              Opening pull request (simulated)…
            </span>
          )}
          {state === 'merged' && (
            <span className="type-body-sm inline-flex items-center gap-1.5 text-ink-2">
              <StatusGlyph shape="check" tone="done" decorative />
              Merged{pr ? ` pull request #${pr.number}` : ''} (simulated)
            </span>
          )}
          {state === 'pr-open' && pr && (
            <>
              <span className="type-body-sm inline-flex items-center gap-1.5 text-ink-2">
                <StatusGlyph shape="check" tone="done" decorative />
                Pull request #{pr.number} (simulated) is open
              </span>
              <Button size="sm" variant="primary" leadingIcon={GitMerge} onClick={() => mergePullRequest(session.id)}>
                Merge (simulated)
              </Button>
            </>
          )}
          {state === 'working' && <span className="type-caption text-ink-3">{agentName} is still working — decisions on files it changes again reset.</span>}
          {(state === 'review' || state === 'working') && (
            <>
              {stats.pending > 0 && (
                <Button size="sm" variant="ghost" leadingIcon={Check} onClick={() => acceptAllChanges(session.id)}>
                  Accept all
                </Button>
              )}
              <RequestChanges session={session} disabled={turnActive} />
              {stats.rejected < stats.files && (
                <Button size="sm" variant="ghost" leadingIcon={X} onClick={() => rejectAllChanges(session.id)}>
                  Reject all
                </Button>
              )}
              <ApproveAndOpen session={session} accepted={stats.accepted} pending={stats.pending} disabled={turnActive} applied={session.status === 'approved'} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** "Request changes…": your instruction becomes the next turn (continueSession). Rejected files start the draft. */
function RequestChanges({ session, disabled }: { session: CodeSession; disabled: boolean }) {
  const [text, setText] = useState('')
  const agentName = useDB((s: Tables) => (session.agentId ? s.agents[session.agentId]?.name : undefined)) ?? 'the agent'
  return (
    <Popover
      placement="top-end"
      aria-label="Request changes"
      onOpenChange={(open) => {
        if (open && !text) setText(requestChangesDraft(session.changes))
      }}
      trigger={
        <Button size="sm" variant="ghost" leadingIcon={MessageSquareReply} disabled={disabled} title={disabled ? 'Wait for the current turn to finish' : undefined}>
          Request changes…
        </Button>
      }
      className="w-[min(380px,calc(100vw-32px))]"
    >
      {({ close }) => {
        const send = () => {
          const instruction = text.trim()
          if (!instruction) return
          const run = continueSession(session.id, instruction)
          if (!run) {
            toast({ tone: 'error', title: 'Couldn’t send the request', description: 'This session can’t take new instructions right now.' })
            return
          }
          setText('')
          close()
          toast({ title: `Sent to ${agentName}`, description: 'A new turn started on the same branch. Rejected files are left out of its starting point.' })
        }
        return (
          <form
            className="flex flex-col gap-2.5 p-3"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <label className="type-body-sm font-medium text-ink" htmlFor={`rc-${session.id}`}>
              What should {agentName} change?
            </label>
            <Textarea
              id={`rc-${session.id}`}
              value={text}
              onValueChange={setText}
              autosize
              minRows={3}
              maxRows={8}
              data-autofocus=""
              placeholder="e.g. keep the legacy retry header"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <div className="flex items-center gap-2">
              <span className="type-caption flex-1 text-ink-3">Runs as the next turn.</span>
              <Button size="sm" variant="ghost" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" type="submit" kbd="mod+enter" disabled={!text.trim()}>
                Send
              </Button>
            </div>
          </form>
        )
      }}
    </Popover>
  )
}

/**
 * Approve & open PR (simulated) — HIGH risk, so it asks to confirm in place for 3 s ("Confirm: open PR
 * (simulated)"); the run's own approval is then resolved as yours, "Confirmed in review" (no second card).
 */
function ApproveAndOpen({ session, accepted, pending, disabled, applied }: { session: CodeSession; accepted: number; pending: number; disabled: boolean; applied: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const none = accepted === 0
  const open = () => {
    if (none) return
    if (!confirming) {
      setConfirming(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setConfirming(false), 3000)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setConfirming(false)
    try {
      // The bar shows the run in place (tape, then the PR); the result also lands as a quiet update.
      openPullRequest(session.id, { confirmed: true })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t open the pull request', description: err instanceof Error ? err.message : String(err) })
    }
  }
  const apply = () => {
    try {
      const next = applyChanges(session.id)
      toast({ tone: 'success', title: `Applied ${accepted} ${accepted === 1 ? 'change' : 'changes'} to ${next.branch} (simulated)`, description: 'The session is approved. Nothing was pushed.' })
    } catch (err) {
      toast({ tone: 'error', title: 'Couldn’t apply', description: err instanceof Error ? err.message : String(err) })
    }
  }
  const label = confirming ? 'Confirm: open PR (simulated)' : applied ? 'Open PR (simulated)' : 'Approve & open PR (simulated)'
  return (
    <span className="inline-flex items-center gap-2">
      {confirming && pending > 0 && (
        <span className="type-caption text-ink-3" role="status">
          {pending} unreviewed {pending === 1 ? 'file is' : 'files are'} left out
        </span>
      )}
    <span className="inline-flex items-stretch">
      <Button
        size="sm"
        variant="primary"
        leadingIcon={GitPullRequestArrow}
        disabled={disabled || none}
        onClick={open}
        aria-live="polite"
        title={none ? 'Accept at least one file first' : undefined}
        className="rounded-r-none"
      >
        {label}
      </Button>
      <Menu
        placement="top-end"
        aria-label="More review actions"
        items={[
          { id: 'apply', label: 'Apply to branch only', icon: GitBranch, description: 'Approve the accepted files without a pull request', disabled: disabled || none || applied, onSelect: apply },
          { type: 'separator' },
          { id: 'patch', label: 'Export .patch', icon: Download, onSelect: () => exportPatch(session.id) },
          { id: 'copy', label: 'Copy diff', icon: Copy, onSelect: () => void copyDiff(session.id) },
        ]}
        trigger={
          <button
            type="button"
            aria-label="More review actions"
            className="relative inline-grid h-7 w-7 place-items-center rounded-r-sm border-l border-inverse-ink/15 bg-inverse text-inverse-ink transition-colors duration-(--dur-1) hover:bg-inverse/88 pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']"
          >
            <ChevronDown aria-hidden className="size-3.5" strokeWidth={2} />
          </button>
        }
      />
    </span>
    </span>
  )
}
