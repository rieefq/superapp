import type { ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FileDiff, FolderOpen, Plus } from 'lucide-react'
import type { LensModule, LensProps } from '@/app/lens/types'
import { useDB, type Tables } from '@/core/db'
import { cn } from '@/lib/cn'
import { timeAgo, truncate } from '@/lib/format'
import { AgentMark, Button, DiffStat, EntityChip, StatusGlyph, StepTape } from '@/ui'
import { CHANGE_LETTER, changeStats, checkLabel, checksClause, checksSummary, fileCount, REVIEW_WORD, splitPath } from './logic'
import { BranchLine, ChecksBrief, RepoModeBadge, SessionStatusChip } from './parts'
import { useGo } from './hooks'

/**
 * Lens renderers for the kinds Code owns (§5.4.8): `session` and `repo`, as the Inspector › Item body
 * (panel) and the hover / ⌘K preview (card). The Inspector adds the header, Links and History.
 */

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1.5">{children}</dl>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="type-caption text-ink-3">{label}</dt>
      <dd className="type-body-sm min-w-0 text-ink-2">{children}</dd>
    </>
  )
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="type-label text-ink-3">{title}</h3>
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

const REVIEW_GLYPH = {
  accepted: { shape: 'check', tone: 'done' },
  rejected: { shape: 'cross', tone: 'fail' },
  pending: { shape: 'ring', tone: 'ink-3' },
} as const

// ------------------------------------------------------------------------------------------------ session

function SessionPanel({ entity }: LensProps) {
  const navigate = useGo()
  const session = useDB((s: Tables) => s.sessions[entity.id])
  const repo = useDB((s: Tables) => (session ? s.repos[session.repoId] : undefined))
  const agent = useDB((s: Tables) => (session?.agentId ? s.agents[session.agentId] : undefined))
  const runId = session?.turns[session.turns.length - 1]?.runId
  const run = useDB((s: Tables) => (runId ? s.runs[runId] : undefined))
  if (!session) return null
  const stats = changeStats(session.changes)
  const checks = checksSummary(session.checks)
  const base = `/code/${encodeURIComponent(session.id)}`
  const latest = session.turns[session.turns.length - 1]
  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SessionStatusChip status={session.status} runStatus={run?.status} size="md" />
          {session.pr && (
            <span className="type-meta text-ink-3">
              PR #{session.pr.number} {session.pr.status} (simulated)
            </span>
          )}
        </div>
        <BranchLine repoName={repo?.name ?? 'disconnected'} branch={session.branch} base={session.baseBranch} />
      </div>

      <Facts>
        <Fact label="Repository">{repo ? <EntityChip entity={{ kind: 'repo', id: repo.id }} size="sm" /> : 'Disconnected'}</Fact>
        {agent && (
          <Fact label="Agent">
            <span className="inline-flex items-center gap-1.5">
              <AgentMark seed={agent.sigil} hue={agent.hue} size={14} live={run?.status === 'running'} />
              {agent.name}
            </span>
          </Fact>
        )}
        {session.autonomy && <Fact label="Policy">{session.autonomy.charAt(0).toUpperCase() + session.autonomy.slice(1)}</Fact>}
        {session.taskId && (
          <Fact label="Task">
            <EntityChip entity={{ kind: 'task', id: session.taskId }} size="sm" />
          </Fact>
        )}
        <Fact label="Turns">
          {session.turns.length} · updated {timeAgo(session.updatedAt)}
        </Fact>
      </Facts>

      {latest && (
        <Section title={`Latest turn · v${session.turns.length}`}>
          <p className="type-body-sm line-clamp-3 text-ink">{latest.prompt}</p>
          {run && <StepTape run={run} size="sm" />}
          {latest.summary && <p className="type-caption line-clamp-3 text-ink-3">{latest.summary}</p>}
        </Section>
      )}

      <Section
        title="Changes"
        action={
          stats.files > 0 ? (
            <Button size="xs" variant="ghost" leadingIcon={FileDiff} onClick={() => navigate(`${base}/changes`)}>
              Review
            </Button>
          ) : undefined
        }
      >
        {stats.files === 0 ? (
          <p className="type-caption text-ink-3">No files changed yet.</p>
        ) : (
          <>
            <p className="type-meta flex flex-wrap items-center gap-2 text-ink-3">
              {stats.files} {stats.files === 1 ? 'file' : 'files'}
              <DiffStat additions={stats.additions} deletions={stats.deletions} hideBar />
              <span>
                {stats.accepted} accepted · {stats.rejected} rejected · {stats.pending} to review
              </span>
            </p>
            <ul className="flex flex-col gap-1">
              {session.changes.slice(0, 6).map((c) => {
                const g = REVIEW_GLYPH[c.review ?? 'pending']
                const { dir, base: name } = splitPath(c.path)
                return (
                  <li key={c.path} className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="w-3 shrink-0 text-center font-mono text-[11px] text-ink-3">
                      {CHANGE_LETTER[c.changeType]}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={c.path}>
                      <span className="text-ink-3">{dir}</span>
                      <span className="text-ink-2">{name}</span>
                    </span>
                    <DiffStat additions={c.additions} deletions={c.deletions} hideBar className="shrink-0" />
                    <StatusGlyph shape={g.shape} tone={g.tone} label={REVIEW_WORD[c.review ?? 'pending']} />
                  </li>
                )
              })}
              {session.changes.length > 6 && <li className="type-meta text-ink-3">+{session.changes.length - 6} more files</li>}
            </ul>
          </>
        )}
      </Section>

      <Section title="Checks">
        {checks.total === 0 ? (
          <p className="type-caption text-ink-3">No checks yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {session.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <StatusGlyph
                  shape={c.status === 'passed' ? 'check' : c.status === 'failed' ? 'cross' : c.status === 'running' ? 'dot' : c.status === 'skipped' ? 'dash' : 'ring'}
                  tone={c.status === 'passed' ? 'done' : c.status === 'failed' ? 'fail' : c.status === 'running' ? 'live' : c.status === 'skipped' ? 'ink-4' : 'ink-3'}
                  live={c.status === 'running'}
                  decorative
                />
                <span className="type-body-sm flex-1 text-ink-2">{checkLabel(c.name)}</span>
                <span className="type-meta text-ink-3">{c.status}</span>
              </li>
            ))}
            <li className="type-meta text-ink-3">{checksClause(checks)} · simulated sandbox</li>
          </ul>
        )}
      </Section>
    </div>
  )
}

function SessionCard({ entity }: LensProps) {
  const session = useDB((s: Tables) => s.sessions[entity.id])
  const repoName = useDB((s: Tables) => (session ? s.repos[session.repoId]?.name : undefined))
  const runId = session?.turns[session.turns.length - 1]?.runId
  const run = useDB((s: Tables) => (runId ? s.runs[runId] : undefined))
  if (!session) return null
  const stats = changeStats(session.changes)
  const latest = session.turns[session.turns.length - 1]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SessionStatusChip status={session.status} runStatus={run?.status} />
        <ChecksBrief checks={session.checks} />
        {stats.files > 0 && <DiffStat additions={stats.additions} deletions={stats.deletions} />}
      </div>
      <BranchLine repoName={repoName} branch={session.branch} base={session.baseBranch} />
      {latest && <p className="type-caption line-clamp-2 text-ink-2">{truncate(latest.summary ?? latest.prompt, 220)}</p>}
      {run && <StepTape run={run} size="xs" />}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ repo

function RepoPanel({ entity }: LensProps) {
  const navigate = useGo()
  const repo = useDB((s: Tables) => s.repos[entity.id])
  const sessions = useDB(
    useShallow((s: Tables) =>
      Object.values(s.sessions)
        .filter((x) => x.repoId === entity.id && x.status !== 'archived')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((x) => x.id),
    ),
  )
  if (!repo) return null
  const base = `/code/repos/${encodeURIComponent(repo.id)}`
  return (
    <div className="flex flex-col gap-5 px-4 py-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <RepoModeBadge repo={repo} size="sm" />
          <span className="type-caption text-ink-3">{repo.mode === 'live' ? 'Read live from GitHub' : 'Bundled demo repository'}</span>
        </div>
        {repo.description && <p className="type-body-sm text-ink-2">{repo.description}</p>}
      </div>
      <Facts>
        <Fact label="Branch">
          <span className="font-mono text-xs">{repo.defaultBranch}</span>
        </Fact>
        {repo.language && <Fact label="Language">{repo.language}</Fact>}
        <Fact label="Files">
          {fileCount(repo.tree).toLocaleString('en-US')}
          {repo.treeTruncated ? ' (partial tree)' : ''}
        </Fact>
        {repo.stars !== undefined && <Fact label="Stars">{repo.stars.toLocaleString('en-US')}</Fact>}
        <Fact label="Synced">{repo.lastSyncedAt ? timeAgo(repo.lastSyncedAt) : 'never'}</Fact>
      </Facts>
      <div className="flex flex-wrap gap-1">
        <Button size="xs" variant="secondary" leadingIcon={Plus} onClick={() => navigate(`/code/new?repo=${encodeURIComponent(repo.id)}`)}>
          New session
        </Button>
        <Button size="xs" variant="ghost" leadingIcon={FolderOpen} onClick={() => navigate(base)}>
          Browse files
        </Button>
      </div>
      <Section title={`Sessions · ${sessions.length}`}>
        {sessions.length === 0 ? (
          <p className="type-caption text-ink-3">No sessions on this repository yet.</p>
        ) : (
          <div className={cn('flex flex-wrap gap-1')}>
            {sessions.slice(0, 8).map((id) => (
              <EntityChip key={id} entity={{ kind: 'session', id }} size="sm" />
            ))}
            {sessions.length > 8 && <span className="type-meta self-center text-ink-3">+{sessions.length - 8} more</span>}
          </div>
        )}
      </Section>
    </div>
  )
}

function RepoCard({ entity }: LensProps) {
  const repo = useDB((s: Tables) => s.repos[entity.id])
  const sessions = useDB((s: Tables) => Object.values(s.sessions).filter((x) => x.repoId === entity.id && x.status !== 'archived').length)
  if (!repo) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <RepoModeBadge repo={repo} />
        <span className="type-meta text-ink-3">{[repo.language, repo.defaultBranch, `${fileCount(repo.tree)} files`].filter(Boolean).join(' · ')}</span>
      </div>
      {repo.description && <p className="type-caption line-clamp-3 text-ink-2">{repo.description}</p>}
      <p className="type-meta text-ink-3">
        {sessions} {sessions === 1 ? 'session' : 'sessions'} · synced {repo.lastSyncedAt ? timeAgo(repo.lastSyncedAt) : 'never'}
      </p>
    </div>
  )
}

export const lenses: LensModule['lenses'] = {
  session: { panel: SessionPanel, card: SessionCard },
  repo: { panel: RepoPanel, card: RepoCard },
}
