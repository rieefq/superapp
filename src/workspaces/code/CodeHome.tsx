import { memo, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpRight, Ellipsis, FolderGit2, Plus, RefreshCw, SquareTerminal, Unplug } from 'lucide-react'
import { Stage, StageHeader } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import type { ID } from '@/core/types'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/format'
import { AgentMark, Button, DiffStat, EmptyState, IconButton, Menu, StepTape } from '@/ui'
import { disconnectWithConfirm, refreshWithToast } from './actions'
import { openConnectDialog } from './ConnectRepo'
import { useFetchRateLimit, useRateLimit } from './hooks'
import { changeStats, fileCount, homeGroups, rateLimitText } from './logic'
import { BranchLine, ChecksBrief, QuietLine, RepoMark, RepoModeBadge, SectionTitle, SessionGlyph } from './parts'
import { StartComposer } from './StartComposer'
import { useGo } from './hooks'

/**
 * Code home (`/code`, §6.3 + brief): start a session, then the sessions that need you or are moving,
 * recent ones, and the connected repositories as cards. No repositories: the two ways to connect one.
 */
export function CodeHome() {
  const scope = useScope()
  const repoIds = useDB(
    useShallow((s: Tables) => {
      const project = scope ? s.projects[scope] : undefined
      return Object.values(s.repos)
        .filter((r) => !scope || r.projectId === scope || !!project?.repoIds.includes(r.id))
        .sort((a, b) => a.fullName.localeCompare(b.fullName))
        .map((r) => r.id)
    }),
  )
  const anyRepo = useDB((s: Tables) => Object.keys(s.repos).length > 0)
  const hasLive = useDB((s: Tables) => Object.values(s.repos).some((r) => r.mode === 'live'))
  useFetchRateLimit(hasLive)

  return (
    <Stage
      measure="home"
      bodyClassName="pb-16 md:pt-8 md:pb-16"
      header={
        <StageHeader
          title="Start a session"
          leading={<SquareTerminal aria-hidden className="mr-1 size-4 text-ink-3" strokeWidth={1.75} />}
          actions={
            <Button size="sm" variant="ghost" leadingIcon={Plus} onClick={openConnectDialog}>
              Connect repository
            </Button>
          }
        />
      }
    >
          {!anyRepo ? (
            <NoRepositories />
          ) : (
            <>
              <StartComposer className="max-w-[760px]" />
              <div className="mt-10 grid gap-x-8 gap-y-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <SessionsColumn />
                <section aria-labelledby="code-home-repos" className="min-w-0">
                  <SectionTitle
                    id="code-home-repos"
                    title="Repositories"
                    count={repoIds.length}
                    action={
                      <Button size="xs" variant="ghost" leadingIcon={Plus} onClick={openConnectDialog}>
                        Connect
                      </Button>
                    }
                  />
                  {repoIds.length === 0 ? (
                    <QuietLine>No repositories in this project. Connect one, or show all work.</QuietLine>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {repoIds.map((id) => (
                        <RepoCard key={id} id={id} />
                      ))}
                    </ul>
                  )}
                  <RateLimitLine />
                </section>
              </div>
            </>
          )}
    </Stage>
  )
}

function RateLimitLine() {
  const rate = useRateLimit()
  const hasLive = useDB((s: Tables) => Object.values(s.repos).some((r) => r.mode === 'live'))
  if (!rate || !hasLive) return null
  return <p className="type-meta mt-2 px-1 text-ink-3">GitHub · {rateLimitText(rate)}</p>
}

function NoRepositories() {
  return (
    <EmptyState
      icon={FolderGit2}
      title="Connect a repository to start"
      description="Coding agents work in a repository: a GitHub one read live, or the bundled demo repository."
      actions={
        <Button variant="primary" leadingIcon={Plus} onClick={openConnectDialog}>
          Connect a repository
        </Button>
      }
      className="mt-10"
    />
  )
}

// ------------------------------------------------------------------------------------------------ sessions

function SessionsColumn() {
  const scope = useScope()
  const keys = useDB(
    useShallow((s: Tables) =>
      Object.values(s.sessions)
        .filter((x) => !scope || x.projectId === scope)
        .map((x) => `${x.id}|${x.status}|${x.updatedAt}`),
    ),
  )
  const groups = useMemo(() => {
    const rows = keys.map((k) => {
      const [id, status, updatedAt] = k.split('|')
      return { id, status: status as Tables['sessions'][string]['status'], updatedAt: Number(updatedAt) }
    })
    return homeGroups(rows)
  }, [keys])
  const empty = !groups.review.length && !groups.working.length && !groups.recent.length
  return (
    <div className="flex min-w-0 flex-col gap-10">
      {empty ? (
        <section aria-labelledby="code-home-sessions">
          <SectionTitle id="code-home-sessions" title="Sessions" />
          <QuietLine>No sessions yet. Describe a change above and a coding agent starts on it.</QuietLine>
        </section>
      ) : (
        <>
          <SessionSection id="code-home-review" title="Needs review" ids={groups.review.map((r) => r.id)} quiet="Nothing waits for your review." />
          <SessionSection id="code-home-working" title="Working" ids={groups.working.map((r) => r.id)} quiet="No agent is working right now." />
          <SessionSection id="code-home-recent" title="Recent" ids={groups.recent.map((r) => r.id)} quiet="Finished sessions show up here." />
        </>
      )}
    </div>
  )
}

function SessionSection({ id, title, ids, quiet }: { id: string; title: string; ids: string[]; quiet: string }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <SectionTitle id={id} title={title} count={ids.length} />
      {ids.length === 0 ? (
        <QuietLine>{quiet}</QuietLine>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {ids.map((sid) => (
            <SessionOverviewRow key={sid} id={sid} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** A session in Code home: glyph, title; repo · branch → base, agent; changes, checks, time. */
export const SessionOverviewRow = memo(function SessionOverviewRow({ id }: { id: ID }) {
  const navigate = useGo()
  const session = useDB((s: Tables) => s.sessions[id])
  const repoName = useDB((s: Tables) => (session ? s.repos[session.repoId]?.name : undefined))
  const agent = useDB((s: Tables) => (session?.agentId ? s.agents[session.agentId] : undefined))
  const runId = session?.turns[session.turns.length - 1]?.runId
  const run = useDB((s: Tables) => (runId ? s.runs[runId] : undefined))
  if (!session) return null
  const stats = changeStats(session.changes)
  const working = session.status === 'working'
  const route = `/code/${encodeURIComponent(session.id)}${session.status === 'needs_review' ? '/changes' : ''}`
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(route)}
        className="group/row flex min-h-14 w-full min-w-0 items-center gap-3 rounded-sm px-2 py-2 text-left transition-colors duration-(--dur-1) hover:bg-hover"
      >
        <SessionGlyph status={session.status} runStatus={run?.status} className="self-start mt-1" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="type-body-sm truncate font-medium text-ink">{session.title}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <BranchLine repoName={repoName} branch={session.branch} base={session.baseBranch} className="max-w-full" />
            {agent && (
              <span className="type-meta hidden items-center gap-1 text-ink-3 sm:inline-flex">
                <AgentMark seed={agent.sigil} hue={agent.hue} size={14} live={run?.status === 'running'} />
                {agent.name}
              </span>
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-center gap-3">
            {working && run ? <StepTape run={run} size="xs" max={12} /> : stats.files > 0 ? <DiffStat additions={stats.additions} deletions={stats.deletions} className="max-sm:[&_[data-bar]]:hidden" /> : null}
            <ChecksBrief checks={session.checks} />
          </span>
          <span className="type-meta text-ink-3">{timeAgo(session.updatedAt)}</span>
        </span>
      </button>
    </li>
  )
})

// ------------------------------------------------------------------------------------------------ repositories

const RepoCard = memo(function RepoCard({ id }: { id: ID }) {
  const navigate = useGo()
  const repo = useDB((s: Tables) => s.repos[id])
  const counts = useDB(
    useShallow((s: Tables) => {
      let total = 0
      let review = 0
      for (const x of Object.values(s.sessions)) {
        if (x.repoId !== id || x.status === 'archived') continue
        total++
        if (x.status === 'needs_review') review++
      }
      return { total, review }
    }),
  )
  if (!repo) return null
  const open = () => navigate(`/code/repos/${encodeURIComponent(repo.id)}`)
  const files = fileCount(repo.tree)
  return (
    <li
      className={cn(
        'group/card relative flex min-w-0 flex-col gap-2 rounded-md border p-3 transition-colors duration-(--dur-1)',
        repo.mode === 'simulated' ? 'border-dashed border-line-input' : 'border-line',
        'hover:bg-hover',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <RepoMark repo={repo} size={20} />
        <button type="button" onClick={open} className="min-w-0 flex-1 truncate text-left font-mono text-[13px] text-ink after:absolute after:inset-0 after:content-['']">
          {repo.fullName}
        </button>
        <RepoModeBadge repo={repo} className="relative" />
        <Menu
          aria-label={`${repo.fullName} actions`}
          placement="bottom-end"
          items={[
            { id: 'open', label: 'Open', icon: ArrowUpRight, onSelect: open },
            { id: 'new', label: 'New session', icon: Plus, onSelect: () => navigate(`/code/new?repo=${encodeURIComponent(repo.id)}`) },
            { id: 'refresh', label: repo.mode === 'live' ? 'Refresh from GitHub' : 'Refresh', icon: RefreshCw, onSelect: () => void refreshWithToast(repo.id) },
            { type: 'separator' },
            { id: 'disconnect', label: 'Disconnect', icon: Unplug, danger: true, onSelect: () => void disconnectWithConfirm(repo.id) },
          ]}
          trigger={<IconButton icon={Ellipsis} label={`${repo.fullName} actions`} size="xs" className="relative" />}
        />
      </div>
      {repo.description && <p className="type-caption line-clamp-2 text-ink-2">{repo.description}</p>}
      <p className="type-meta flex flex-wrap items-center gap-x-1.5 text-ink-3">
        {[repo.language, repo.defaultBranch, `${files.toLocaleString('en-US')} files`].filter(Boolean).join(' · ')}
        <span aria-hidden>·</span>
        <span>synced {repo.lastSyncedAt ? timeAgo(repo.lastSyncedAt) : 'never'}</span>
      </p>
      {counts.total > 0 && (
        <p className="type-meta text-ink-3">
          {counts.total} {counts.total === 1 ? 'session' : 'sessions'}
          {counts.review > 0 && (
            <>
              {' · '}
              <span className="text-attn-ink">◆ {counts.review} to review</span>
            </>
          )}
        </p>
      )}
    </li>
  )
})
