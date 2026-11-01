import { memo, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Archive, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { ListGroup, ListPane, ListRow, ListRows, ScopeFilterRow } from '@/app/templates'
import { useScope } from '@/core/context'
import { useDB, type Tables } from '@/core/db'
import type { CodeSession, ID, Repo } from '@/core/types'
import { timeAgo } from '@/lib/format'
import { DiffStat, StepTape } from '@/ui'
import { openConnectDialog } from './ConnectRepo'
import { useRateLimit } from './hooks'
import { changeStats, groupSessions, matchesRepo, matchesSession, rateLimitText, SESSION_GROUP_LABEL } from './logic'
import { QuietLine, RepoMark, RepoModeBadge, SessionGlyph } from './parts'
import { useGo } from './hooks'

/**
 * The Code list pane (§6.3): Repositories (owner/name in mono, LIVE or SIM, branch; Connect repository;
 * the GitHub quota), then Sessions grouped Needs review · Working · Idle · Done. Archived sessions fold
 * into the footer.
 */

/** Sessions and repositories in scope, as stable keys (rows select their own data). */
function inScope(scope: ID | null) {
  return (s: Tables) => {
    const project = scope ? s.projects[scope] : undefined
    const repos = Object.values(s.repos)
      .filter((r) => !scope || r.projectId === scope || !!project?.repoIds.includes(r.id))
      .sort((a, b) => a.fullName.localeCompare(b.fullName))
      .map((r) => r.id)
    const sessions = Object.values(s.sessions)
      .filter((x) => !scope || x.projectId === scope)
      .map((x) => `${x.id}|${x.status}|${x.updatedAt}`)
    return { repos, sessions }
  }
}

export function CodeListPane() {
  const navigate = useGo()
  const scope = useScope()
  const [query, setQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const keys = useDB(useShallow((s: Tables) => {
    const v = inScope(scope)(s)
    return [...v.repos.map((id) => `r:${id}`), ...v.sessions.map((k) => `s:${k}`)]
  }))
  const rate = useRateLimit()
  const hasLive = useDB((s: Tables) => Object.values(s.repos).some((r) => r.mode === 'live'))

  // Search reads titles from the store at filter time (rows stay narrow subscriptions).
  const { repoIds, groups, archived, total } = useMemo(() => {
    const s = useDB.getState()
    const repos = keys.filter((k) => k.startsWith('r:')).map((k) => s.repos[k.slice(2)]).filter((r): r is Repo => !!r)
    const sessions = keys
      .filter((k) => k.startsWith('s:'))
      .map((k) => s.sessions[k.slice(2).split('|')[0]])
      .filter((x): x is CodeSession => !!x)
    const q = query.trim()
    const matchingRepos = repos.filter((r) => matchesRepo(r, q)).map((r) => r.id)
    const matching = sessions.filter((x) => matchesSession(x, s.repos[x.repoId]?.name, q))
    const grouped = groupSessions(matching)
    return { repoIds: matchingRepos, groups: grouped.groups, archived: grouped.archived, total: sessions.filter((x) => x.status !== 'archived').length }
  }, [keys, query])

  const searching = query.trim().length > 0
  const nothing = !repoIds.length && !groups.length && !(showArchived && archived.length)

  return (
    <ListPane
      title="Sessions"
      count={total}
      onNew={() => navigate('/code/new')}
      newLabel="New"
      search={{ value: query, onChange: setQuery, placeholder: 'Search sessions and repos' }}
      footer={
        archived.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="type-caption flex h-9 w-full items-center gap-2 px-4 text-left text-ink-3 transition-colors duration-(--dur-1) hover:bg-hover hover:text-ink pointer-coarse:h-11"
          >
            <Archive aria-hidden className="size-3.5" strokeWidth={1.75} />
            <span className="flex-1">Archived</span>
            <span className="type-meta tabular">{archived.length}</span>
            {showArchived ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
          </button>
        ) : undefined
      }
    >
      <ScopeFilterRow />
      <ListRows label="Repositories and sessions">
        {(!searching || repoIds.length > 0) && (
          <ListGroup label="Repositories" count={repoIds.length || undefined}>
            {repoIds.map((id) => (
              <RepoRow key={id} id={id} />
            ))}
            {!searching && (
              <ListRow
                onClick={openConnectDialog}
                leading={
                  <span aria-hidden className="grid size-4 place-items-center rounded-xs border border-line-strong text-ink-3">
                    <Plus className="size-3" strokeWidth={2} />
                  </span>
                }
                title="Connect repository"
                aria-label="Connect a repository"
              />
            )}
            {hasLive && rate && <p className="type-meta px-4 pt-1 pb-1 text-ink-3">{rateLimitText(rate)}</p>}
          </ListGroup>
        )}
        {groups.map((g) => (
          <ListGroup key={g.key} label={SESSION_GROUP_LABEL[g.key]} count={g.sessions.length}>
            {g.sessions.map((x) => (
              <SessionRow key={x.id} id={x.id} />
            ))}
          </ListGroup>
        ))}
        {showArchived && archived.length > 0 && (
          <ListGroup label="Archived" count={archived.length}>
            {archived.map((x) => (
              <SessionRow key={x.id} id={x.id} />
            ))}
          </ListGroup>
        )}
      </ListRows>
      {!groups.length && !searching && <QuietLine className="px-4">No sessions yet. Describe a change and a coding agent starts on it.</QuietLine>}
      {searching && nothing && <QuietLine className="px-4">No sessions or repositories match “{query.trim()}”.</QuietLine>}
    </ListPane>
  )
}

const RepoRow = memo(function RepoRow({ id }: { id: ID }) {
  const repo = useDB((s: Tables) => s.repos[id])
  if (!repo) return null
  return (
    <ListRow
      to={`/code/repos/${encodeURIComponent(repo.id)}`}
      entity={{ kind: 'repo', id: repo.id }}
      leading={<RepoMark repo={repo} size={16} />}
      title={<span className="font-mono text-[12.5px]">{repo.fullName}</span>}
      secondary={[repo.defaultBranch, repo.language].filter(Boolean).join(' · ')}
      trailing={<RepoModeBadge repo={repo} />}
      aria-label={`${repo.fullName}, ${repo.mode === 'live' ? 'live from GitHub' : 'simulated demo repository'}`}
    />
  )
})

const SessionRow = memo(function SessionRow({ id }: { id: ID }) {
  const session = useDB((s: Tables) => s.sessions[id])
  const repoName = useDB((s: Tables) => (session ? s.repos[session.repoId]?.name : undefined))
  const runId = session?.turns[session.turns.length - 1]?.runId
  const run = useDB((s: Tables) => (runId ? s.runs[runId] : undefined))
  if (!session) return null
  const stats = changeStats(session.changes)
  const active = session.status === 'working'
  return (
    <ListRow
      to={`/code/${encodeURIComponent(session.id)}`}
      entity={{ kind: 'session', id: session.id }}
      leading={<SessionGlyph status={session.status} runStatus={run?.status} />}
      title={session.title}
      secondary={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate">{repoName ?? 'Repository removed'}</span>
          {active && run ? (
            <StepTape run={run} size="xs" max={10} className="shrink-0" />
          ) : (
            stats.files > 0 && <DiffStat additions={stats.additions} deletions={stats.deletions} hideBar className="shrink-0 text-[11px]" />
          )}
        </span>
      }
      meta={timeAgo(session.updatedAt).replace(' ago', '')}
    />
  )
})
