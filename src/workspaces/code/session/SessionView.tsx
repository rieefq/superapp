import { useCallback, useMemo, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import {
  Archive, ArchiveRestore, Check, Copy, Download, FileDiff, Layers, Link2, ListChecks, MessageSquareReply, Pause, Play, SquareTerminal, Square, Trash2,
} from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import { Stage, StageHeader } from '@/app/templates'
import { toggleHold } from '@/app/shell/scope'
import type { Command } from '@/app/types'
import { useDB, type Tables } from '@/core/db'
import { runEngine } from '@/core/runs'
import { acceptAllChanges, activeSessionRun, renameSession, useSession } from '@/core/services'
import { isRunActive, type CodeSession, type ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { shortCode } from '@/lib/id'
import {
  AgentMark, Button, EmptyState, EntityChip, Tabs, Tooltip, copyText, formatClock, formatCost, toast, useNow, type MenuItem,
} from '@/ui'
import { ESTIMATE_TOOLTIP } from '@/app/components'
import { archiveWithUndo, copyDiff, deleteWithConfirm, exportPatch, restoreWithToast } from '../actions'
import { changeStats, checksSummary } from '../logic'
import { BranchLine, RepoMark, RepoModeBadge, SessionStatusChip, useLatestRunStatus } from '../parts'
import { ActivityPane, PaneHeader, SimTerminalNote } from './Activity'
import { ChangesPane } from './Changes'
import { ChecksPane } from './Checks'
import { FilesPane } from './Files'
import { useElementWidth, useGo, useUrlValue } from '../hooks'

export type SessionTab = 'activity' | 'changes' | 'files' | 'checks'
type ReviewTab = Exclude<SessionTab, 'activity'>
const TABS: readonly SessionTab[] = ['activity', 'changes', 'files', 'checks']

/** Split Activity | Review when the stage is at least this wide (§6.3). */
export const SPLIT_MIN = 1040

const noop = () => {}

/**
 * A coding session (`/code/:sessionId/(activity|changes|files|checks)`, §6.3). At ≥1040px the stage
 * splits into Activity (44%, min 420) and Review (56%: Changes · Files · Checks); narrower, the four
 * are header tabs. The meta row carries repo · branch → base, the linked task, the agent, elapsed time
 * and the estimated cost.
 */
export function SessionView() {
  const { sessionId = '' } = useParams()
  const session = useSession(sessionId)
  if (!session) return <MissingSession />
  return <SessionStage session={session} />
}

function MissingSession() {
  return (
    <Stage header={<StageHeader title="Session not found" backTo="/code" />}>
      <EmptyState
        className="mt-12"
        icon={SquareTerminal}
        title="This session no longer exists"
        description="It may have been deleted. Its runs stay in Agents › Runs."
        actions={
          <Link to="/code" className="type-body-sm text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
            Back to Code
          </Link>
        }
      />
    </Stage>
  )
}

function SessionStage({ session }: { session: CodeSession }) {
  const navigate = useGo()
  const params = useParams()
  const [search] = useSearchParams()
  const bodyRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(bodyRef)
  const split = width >= SPLIT_MIN
  const rest = (params['*'] ?? '').split('/')[0]
  const urlTab: SessionTab = (TABS as readonly string[]).includes(rest) ? (rest as SessionTab) : 'activity'
  // Tab, changed file and open path answer at once (local state); the URL follows (see useUrlValue).
  const [tabValue, setTab] = useUrlValue(urlTab, noop)
  const [file, setFile] = useUrlValue(search.get('file'), noop)
  const [path, setPath] = useUrlValue(search.get('path'), noop)
  const tab = (tabValue ?? 'activity') as SessionTab
  const reviewTab: ReviewTab = tab === 'activity' ? 'changes' : tab
  const base = `/code/${encodeURIComponent(session.id)}`

  const sync = useCallback(
    (next: { tab: SessionTab; file: string | null; path: string | null }) => {
      const q = new URLSearchParams()
      if (next.file) q.set('file', next.file)
      if (next.path) q.set('path', next.path)
      const qs = q.toString()
      navigate(`${base}/${next.tab}${qs ? `?${qs}` : ''}`, { replace: true })
    },
    [base, navigate],
  )
  const go = useCallback(
    (next: SessionTab, query?: { file?: string | null; path?: string | null }) => {
      setTab(next)
      const nextFile = query && 'file' in query ? (query.file ?? null) : file
      const nextPath = query && 'path' in query ? (query.path ?? null) : path
      if (nextFile !== file) setFile(nextFile)
      if (nextPath !== path) setPath(nextPath)
      sync({ tab: next, file: nextFile, path: nextPath })
    },
    [file, path, setFile, setPath, setTab, sync],
  )
  const setParam = useCallback(
    (key: 'file' | 'path', value: string | null) => {
      if (key === 'file') setFile(value)
      else setPath(value)
      sync({ tab, file: key === 'file' ? value : file, path: key === 'path' ? value : path })
    },
    [file, path, setFile, setPath, sync, tab],
  )
  const reviewFile = useCallback((p: string) => go('changes', { file: p }), [go])
  const toActivity = useCallback(() => {
    if (!split) go('activity')
  }, [split, go])

  const stats = useMemo(() => changeStats(session.changes), [session.changes])
  const checks = useMemo(() => checksSummary(session.checks), [session.checks])
  const runStatus = useLatestRunStatus(session)
  const turnRun = useDB((s: Tables) => {
    const id = session.turns[session.turns.length - 1]?.runId
    return id ? s.runs[id] : undefined
  })
  const archived = session.status === 'archived'

  useSessionCommands(session, go)

  const tabItems = [
    { value: 'activity' as const, label: 'Activity' },
    { value: 'changes' as const, label: 'Changes', count: stats.files || undefined },
    { value: 'files' as const, label: 'Files' },
    { value: 'checks' as const, label: 'Checks', count: checks.failed || undefined },
  ]

  const menu: MenuItem[] = [
    { id: 'patch', label: 'Export .patch', icon: Download, disabled: !stats.files, onSelect: () => exportPatch(session.id) },
    { id: 'diff', label: 'Copy diff', icon: FileDiff, disabled: !stats.files, onSelect: () => void copyDiff(session.id) },
    { type: 'separator' },
    { id: 'hold', label: 'Hold session', icon: Layers, shortcut: 'h', onSelect: () => toggleHold({ kind: 'session', id: session.id }) },
    {
      id: 'link',
      label: 'Copy link',
      icon: Link2,
      onSelect: () => void copyText(`${window.location.origin}${base}`).then((ok) => toast(ok ? { title: 'Link copied' } : { tone: 'error', title: 'Couldn’t copy the link' })),
    },
    { id: 'handle', label: 'Copy handle', icon: Copy, onSelect: () => void copyText(shortCode(session.id)).then((ok) => toast(ok ? { title: `${shortCode(session.id)} copied` } : { tone: 'error', title: 'Couldn’t copy the handle' })) },
    { type: 'separator' },
    archived
      ? { id: 'restore', label: 'Restore', icon: ArchiveRestore, onSelect: () => restoreWithToast(session.id) }
      : { id: 'archive', label: 'Archive', icon: Archive, onSelect: () => archiveWithUndo(session.id) },
    {
      id: 'delete',
      label: 'Delete…',
      icon: Trash2,
      danger: true,
      onSelect: () =>
        void deleteWithConfirm(session.id).then((deleted) => {
          if (deleted) navigate('/code')
        }),
    },
  ]

  const active = !!turnRun && isRunActive(turnRun.status)
  const actions = (
    <>
      {turnRun && (turnRun.status === 'running' || turnRun.status === 'queued') && (
        <Button size="sm" variant="ghost" leadingIcon={Pause} onClick={() => runEngine.pause(turnRun.id)}>
          Pause
        </Button>
      )}
      {turnRun?.status === 'paused' && (
        <Button size="sm" variant="secondary" leadingIcon={Play} onClick={() => runEngine.resume(turnRun.id)}>
          Resume
        </Button>
      )}
      {active && turnRun && (
        <Button size="sm" variant="ghost" leadingIcon={Square} kbd="mod+." onClick={() => runEngine.cancel(turnRun.id, 'Stopped by you')}>
          Stop
        </Button>
      )}
      {archived && (
        <Button size="sm" variant="secondary" leadingIcon={ArchiveRestore} onClick={() => restoreWithToast(session.id)}>
          Restore
        </Button>
      )}
    </>
  )

  return (
    <Stage
      primary={{ kind: 'session', id: session.id }}
      scroll={false}
      padded={false}
      header={
        <StageHeader
          title={session.title}
          onRename={archived ? undefined : (t) => renameSession(session.id, t)}
          status={<SessionStatusChip status={session.status} runStatus={runStatus} />}
          tabs={split ? undefined : { items: tabItems, value: tab, onChange: (v) => go(v), 'aria-label': 'Session views' }}
          actions={actions}
          menu={menu}
          backTo="/code"
        />
      }
      toolbar={<SessionMeta session={session} />}
    >
      <div ref={bodyRef} className="flex h-full min-h-0 w-full">
        {width === 0 ? null : split ? (
          <>
            <section aria-label="Activity" className="flex min-h-0 w-[44%] min-w-[420px] flex-col border-r border-line">
              <ActivityPane session={session} onReviewFile={reviewFile} />
            </section>
            <section aria-label="Review" className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex h-9 shrink-0 items-end gap-3 border-b border-line px-4 md:px-5">
                <Tabs
                  items={tabItems.slice(1)}
                  value={reviewTab}
                  onValueChange={(v) => go(v as ReviewTab)}
                  size="sm"
                  aria-label="Review"
                  className="gap-5 border-b-0"
                />
                <span className="flex-1" />
                {reviewTab === 'checks' && <span className="hidden pb-2 xl:block"><SimTerminalNote /></span>}
              </div>
              <ReviewBody session={session} tab={reviewTab} file={file} path={path} setParam={setParam} onReviewFile={reviewFile} onAsk={toActivity} active />
            </section>
          </>
        ) : tab === 'activity' ? (
          <ActivityPane session={session} onReviewFile={reviewFile} header={false} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === 'checks' && (
              <PaneHeader title="Checks">
                <SimTerminalNote />
              </PaneHeader>
            )}
            <ReviewBody session={session} tab={tab} file={file} path={path} setParam={setParam} onReviewFile={reviewFile} onAsk={toActivity} active />
          </div>
        )}
      </div>
    </Stage>
  )
}

function ReviewBody({
  session, tab, file, path, setParam, onReviewFile, onAsk, active,
}: {
  session: CodeSession
  tab: ReviewTab
  file: string | null
  path: string | null
  setParam: (key: 'file' | 'path', value: string | null) => void
  onReviewFile: (path: string) => void
  onAsk: () => void
  active: boolean
}) {
  const selectFile = useCallback((p: string | null) => setParam('file', p), [setParam])
  const openPath = useCallback((p: string | null) => setParam('path', p), [setParam])
  if (tab === 'changes') return <ChangesPane session={session} selectedPath={file} onSelectPath={selectFile} active={active} />
  if (tab === 'checks') return <ChecksPane session={session} header={false} />
  return <FilesPane session={session} path={path} onPath={openPath} onAsk={onAsk} onReviewFile={onReviewFile} />
}

// ------------------------------------------------------------------------------------------------ meta row

/** repo · branch → base, the linked task, the agent, elapsed and the estimated cost (§6.3 stage header). */
function SessionMeta({ session }: { session: CodeSession }) {
  const repo = useDB((s: Tables) => s.repos[session.repoId])
  const agent = useDB((s: Tables) => (session.agentId ? s.agents[session.agentId] : undefined))
  const runs = useDB(
    useShallow((s: Tables) =>
      Object.values(s.runs)
        .filter((r) => r.origin?.kind === 'session' && r.origin.id === session.id)
        .map((r) => r),
    ),
  )
  const anyRunning = runs.some((r) => r.status === 'running')
  const now = useNow(anyRunning)
  const elapsed = runs.reduce((n, r) => n + Math.max(0, (r.endedAt ?? (isRunActive(r.status) ? now : (r.startedAt ?? r.createdAt))) - (r.startedAt ?? r.createdAt)), 0)
  const cost = runs.reduce((n, r) => n + r.usage.costUsd, 0)
  const simulated = runs.every((r) => r.simulated)
  return (
    <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-3 overflow-x-auto">
      <span className="flex min-w-0 shrink-0 items-center gap-1.5">
        {repo ? <RepoMark repo={repo} size={14} /> : null}
        <BranchLine repoName={repo?.name ?? 'disconnected'} branch={session.branch} base={session.baseBranch} />
        {repo && <RepoModeBadge repo={repo} />}
      </span>
      {session.taskId && (
        <span className="flex shrink-0 items-center">
          <EntityChip entity={{ kind: 'task', id: session.taskId }} size="sm" showKind />
        </span>
      )}
      {agent && (
        <span className="type-meta flex shrink-0 items-center gap-1.5 text-ink-2">
          <AgentMark seed={agent.sigil} hue={agent.hue} size={14} live={anyRunning} label={agent.name} />
          {agent.name}
          {session.autonomy && <span className="text-ink-3">· {session.autonomy.charAt(0).toUpperCase() + session.autonomy.slice(1)}</span>}
        </span>
      )}
      <span className="flex-1" />
      {runs.length > 0 && (
        <span className="type-meta flex shrink-0 items-center gap-2 text-ink-3 tabular">
          <Tooltip content="Time the agent spent across every turn">
            <span tabIndex={0} className={cn(anyRunning && 'text-live-ink')}>
              {formatClock(elapsed)}
            </span>
          </Tooltip>
          <span aria-hidden>·</span>
          <Tooltip content={simulated ? ESTIMATE_TOOLTIP : 'Live spend across every turn'}>
            <span tabIndex={0}>{simulated ? `est. ${formatCost(cost)}` : formatCost(cost)}</span>
          </Tooltip>
        </span>
      )}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ ⌘K

/** Commands for this view (⌘K › Actions for this view). */
function useSessionCommands(session: CodeSession, go: (tab: SessionTab) => void) {
  const id: ID = session.id
  const pending = session.changes.some((c) => (c.review ?? 'pending') === 'pending')
  const commands: Command[] = [
    { id: 'code.session.changes', title: 'Review changes', subtitle: session.title, icon: FileDiff, group: 'Code', keywords: ['diff', 'review'], run: (ctx) => { ctx.close(); go('changes') } },
    { id: 'code.session.checks', title: 'Show checks', subtitle: session.title, icon: ListChecks, group: 'Code', keywords: ['tests', 'ci'], run: (ctx) => { ctx.close(); go('checks') } },
    { id: 'code.session.activity', title: 'Instruct the agent', subtitle: 'Focus the session composer', icon: MessageSquareReply, group: 'Code', keywords: ['follow up', 'continue'], run: (ctx) => {
      ctx.close()
      go('activity')
      setTimeout(() => document.querySelector<HTMLElement>('#main [data-composer-input]')?.focus(), 60)
    } },
    ...(pending ? [{ id: 'code.session.acceptAll', title: 'Accept all changes', subtitle: session.title, icon: Check, group: 'Code', keywords: ['approve', 'review'], run: (ctx: { close: () => void }) => { ctx.close(); acceptAllChanges(id) } }] : []),
    { id: 'code.session.patch', title: 'Export .patch', subtitle: session.branch, icon: Download, group: 'Code', keywords: ['diff', 'download'], run: (ctx) => { ctx.close(); exportPatch(id) } },
    { id: 'code.session.copyDiff', title: 'Copy diff', subtitle: session.branch, icon: Copy, group: 'Code', keywords: ['patch', 'clipboard'], run: (ctx) => { ctx.close(); void copyDiff(id) } },
    ...(activeSessionRun(session)
      ? [{ id: 'code.session.stop', title: 'Stop the current turn', subtitle: session.title, icon: Square, group: 'Code', keywords: ['cancel'], run: (ctx: { close: () => void }) => {
          ctx.close()
          const run = activeSessionRun(session)
          if (run) runEngine.cancel(run.id, 'Stopped by you')
        } }]
      : []),
    session.status === 'archived'
      ? { id: 'code.session.restore', title: 'Restore session', subtitle: session.title, icon: ArchiveRestore, group: 'Code', run: (ctx) => { ctx.close(); restoreWithToast(id) } }
      : { id: 'code.session.archive', title: 'Archive session', subtitle: session.title, icon: Archive, group: 'Code', run: (ctx) => { ctx.close(); archiveWithUndo(id) } },
  ]
  useRegisterCommands(`code.session.${id}`, commands)
}
