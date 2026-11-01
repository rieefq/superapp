import { useCallback } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useShallow } from 'zustand/react/shallow'
import { ExternalLink, FolderGit2, Link2, Plus, RefreshCw, Star, Unplug } from 'lucide-react'
import { useRegisterCommands } from '@/app/commands/registry'
import { Stage, StageHeader } from '@/app/templates'
import type { Command } from '@/app/types'
import { useDB, type Tables } from '@/core/db'
import { useRepo } from '@/core/services'
import type { Repo } from '@/core/types'
import { timeAgo } from '@/lib/format'
import { Button, EmptyState, copyText, toast, type MenuItem } from '@/ui'
import { disconnectWithConfirm, refreshWithToast } from '../actions'
import { SessionOverviewRow } from '../CodeHome'
import { useFetchRateLimit, useRateLimit } from '../hooks'
import { rateLimitText } from '../logic'
import { QuietLine, RepoMark, RepoModeBadge } from '../parts'
import { CopyPathButton, HoldFileButton, OpenOnGithubButton, StartAboutFileButton } from './FileActions'
import { RepoBrowser } from './RepoBrowser'
import { useGo } from '../hooks'

/**
 * Repository explorer (`/code/repos/:repoId`, §6.3): the file tree (filter by name) and a read-only
 * viewer — live GitHub reads for GitHub repositories — plus the repository's sessions. "Start a session
 * about this file" opens the new-session form with the path in the instruction.
 */
export function RepoView() {
  const { repoId = '' } = useParams()
  const repo = useRepo(repoId)
  if (!repo) {
    return (
      <Stage header={<StageHeader title="Repository not found" backTo="/code" />}>
        <EmptyState
          className="mt-12"
          icon={FolderGit2}
          title="This repository isn’t connected"
          description="It may have been disconnected. Connect it again from Code."
          actions={
            <Link to="/code" className="type-body-sm text-ink-2 underline decoration-line-input underline-offset-2 hover:text-ink hover:decoration-ink">
              Back to Code
            </Link>
          }
        />
      </Stage>
    )
  }
  return <RepoStage repo={repo} />
}

function RepoStage({ repo }: { repo: Repo }) {
  const navigate = useGo()
  const params = useParams()
  const [search, setSearch] = useSearchParams()
  const tab = (params['*'] ?? '').startsWith('sessions') ? 'sessions' : 'files'
  const path = search.get('path')
  const base = `/code/repos/${encodeURIComponent(repo.id)}`
  const sessionIds = useDB(
    useShallow((s: Tables) =>
      Object.values(s.sessions)
        .filter((x) => x.repoId === repo.id && x.status !== 'archived')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((x) => x.id),
    ),
  )
  const live = repo.mode === 'live'
  useFetchRateLimit(live)
  const rate = useRateLimit()

  const setPath = useCallback(
    (p: string | null) =>
      setSearch(
        (prev) => {
          const n = new URLSearchParams(prev)
          if (p) n.set('path', p)
          else n.delete('path')
          return n
        },
        { replace: true, flushSync: true },
      ),
    [setSearch],
  )

  const menu: MenuItem[] = [
    ...(repo.url ? [{ id: 'github', label: 'Open on GitHub', icon: ExternalLink, onSelect: () => window.open(repo.url, '_blank', 'noopener') }] : []),
    {
      id: 'link',
      label: 'Copy link',
      icon: Link2,
      onSelect: () => void copyText(`${window.location.origin}${base}`).then((ok) => toast(ok ? { title: 'Link copied' } : { tone: 'error', title: 'Couldn’t copy the link' })),
    },
    { type: 'separator' },
    {
      id: 'disconnect',
      label: 'Disconnect…',
      icon: Unplug,
      danger: true,
      onSelect: () =>
        void disconnectWithConfirm(repo.id).then((done) => {
          if (done) navigate('/code')
        }),
    },
  ]

  const commands: Command[] = [
    { id: 'code.repo.new', title: `New session on ${repo.name}`, subtitle: repo.fullName, icon: Plus, group: 'Code', keywords: ['start', 'session'], run: (ctx) => { ctx.close(); navigate(`/code/new?repo=${encodeURIComponent(repo.id)}${path ? `&path=${encodeURIComponent(path)}` : ''}`) } },
    { id: 'code.repo.refresh', title: `Refresh ${repo.name}`, subtitle: live ? 'Read the tree again from GitHub' : 'Rebuild the demo tree', icon: RefreshCw, group: 'Code', keywords: ['sync', 'reload'], run: (ctx) => { ctx.close(); void refreshWithToast(repo.id) } },
  ]
  useRegisterCommands(`code.repo.${repo.id}`, commands)

  return (
    <Stage
      primary={{ kind: 'repo', id: repo.id }}
      scroll={false}
      padded={false}
      header={
        <StageHeader
          title={<span className="font-mono text-[15px] font-medium">{repo.fullName}</span>}
          leading={<RepoMark repo={repo} size={18} className="mr-1" />}
          status={<RepoModeBadge repo={repo} />}
          tabs={{
            items: [
              { value: 'files', label: 'Files' },
              { value: 'sessions', label: 'Sessions', count: sessionIds.length || undefined },
            ],
            value: tab,
            onChange: (v) => navigate(`${base}${v === 'sessions' ? '/sessions' : ''}${path && v === 'files' ? `?path=${encodeURIComponent(path)}` : ''}`, { replace: true, flushSync: true }),
            'aria-label': 'Repository views',
          }}
          actions={
            <>
              <Button size="sm" variant="ghost" leadingIcon={RefreshCw} onClick={() => void refreshWithToast(repo.id)}>
                Refresh
              </Button>
              <Button size="sm" variant="secondary" leadingIcon={Plus} onClick={() => navigate(`/code/new?repo=${encodeURIComponent(repo.id)}`)}>
                New session
              </Button>
            </>
          }
          menu={menu}
          backTo="/code"
        />
      }
      toolbar={
        <div className="no-scrollbar type-meta flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap text-ink-3">
          {repo.description && <span className="type-caption min-w-0 truncate text-ink-2">{repo.description}</span>}
          {repo.description && <span aria-hidden>·</span>}
          {repo.language && <span>{repo.language}</span>}
          {repo.stars !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Star aria-hidden className="size-3" strokeWidth={1.75} />
              {repo.stars.toLocaleString('en-US')}
            </span>
          )}
          <span>synced {repo.lastSyncedAt ? timeAgo(repo.lastSyncedAt) : 'never'}</span>
          <span className="flex-1" />
          {live && rate && <span>GitHub · {rateLimitText(rate)}</span>}
          {!live && <span>Demo repository — nothing is read from GitHub</span>}
        </div>
      }
    >
      {tab === 'files' ? (
        <RepoBrowser
          repo={repo}
          path={path}
          onPath={setPath}
          actions={(p, file) => (
            <>
              <StartAboutFileButton repo={repo} path={p} />
              <HoldFileButton repo={repo} path={p} file={file} />
              <CopyPathButton path={p} />
              <OpenOnGithubButton repo={repo} path={p} />
            </>
          )}
        />
      ) : (
        <div className="h-full overflow-y-auto overscroll-contain">
          <div className="mx-auto w-full max-w-[880px] px-4 py-5 md:px-6 md:py-6">
            {sessionIds.length === 0 ? (
              <QuietLine>No sessions on this repository yet. Start one with New session.</QuietLine>
            ) : (
              <ul className="-mx-2 flex flex-col" aria-label={`Sessions on ${repo.fullName}`}>
                {sessionIds.map((id) => (
                  <SessionOverviewRow key={id} id={id} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Stage>
  )
}
