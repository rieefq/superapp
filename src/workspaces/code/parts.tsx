import { memo, type ReactNode } from 'react'
import { GitBranch } from 'lucide-react'
import { useDB, type Tables } from '@/core/db'
import type { CheckResult, CodeSession, Repo, RunStatus, SessionStatus } from '@/core/types'
import { cn } from '@/lib/cn'
import { KindTile, LiveBadge, SimBadge, StatusGlyph, Tooltip } from '@/ui'
import { checksSummary, sessionStatusMeta, type StatusMeta } from './logic'

/** Small shared parts of the Code workspace: status glyphs and chips, repository marks and badges. */

export const REPO_LIVE_EXPLANATION = 'Live: files are read from GitHub. Commands, tests and pull requests are still simulated.'
export const REPO_SIM_EXPLANATION = 'Simulated: the bundled demo repository. Nothing is read from or written to GitHub.'

/** The status of a session's latest turn run (undefined when it has none). */
export function useLatestRunStatus(session: Pick<CodeSession, 'turns'> | undefined): RunStatus | undefined {
  const runId = session?.turns[session.turns.length - 1]?.runId
  return useDB((s: Tables) => (runId ? s.runs[runId]?.status : undefined))
}

export function SessionGlyph({ status, runStatus, size = 12, decorative, className }: { status: SessionStatus; runStatus?: RunStatus; size?: number; decorative?: boolean; className?: string }) {
  const meta = sessionStatusMeta(status, runStatus)
  return <StatusGlyph shape={meta.shape} tone={meta.tone} live={meta.live} word={meta.word} size={size} decorative={decorative} className={className} />
}

const CHIP_TONE: Record<StatusMeta['signal'], string> = {
  live: 'bg-live-tint text-live-ink',
  attn: 'bg-attn-tint text-attn-ink',
  done: 'bg-hover text-ink-2',
  fail: 'bg-fail-tint text-fail-ink',
  neutral: 'bg-hover text-ink-2',
}

/** Status capsule for a session (the run badge's grammar): glyph + word. */
export function SessionStatusChip({ status, runStatus, size = 'sm', className }: { status: SessionStatus; runStatus?: RunStatus; size?: 'sm' | 'md'; className?: string }) {
  const meta = sessionStatusMeta(status, runStatus)
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full leading-none font-medium whitespace-nowrap select-none',
        size === 'sm' ? 'h-[18px] gap-1 pr-2 pl-1 text-2xs' : 'h-[22px] gap-1.5 pr-2.5 pl-1.5 text-xs',
        CHIP_TONE[meta.signal],
        className,
      )}
    >
      <StatusGlyph shape={meta.shape} tone={meta.tone} live={meta.live} decorative size={size === 'sm' ? 12 : 14} />
      {meta.word}
    </span>
  )
}

/** Repository mark: a rounded square tile (things that last), dashed for the simulated demo repository. */
export function RepoMark({ repo, size = 16, className }: { repo: Pick<Repo, 'mode'>; size?: number; className?: string }) {
  return <KindTile kind="repo" size={size} simulated={repo.mode === 'simulated'} className={className} />
}

/** LIVE (GitHub reads) or SIM (the demo repository): repo chips are where live and simulated mix (§5.4.5). */
export function RepoModeBadge({ repo, size = 'xs', className }: { repo: Pick<Repo, 'mode'>; size?: 'xs' | 'sm'; className?: string }) {
  return repo.mode === 'live' ? (
    <LiveBadge size={size} explanation={REPO_LIVE_EXPLANATION} className={className} />
  ) : (
    <SimBadge size={size} explanation={REPO_SIM_EXPLANATION} className={className} />
  )
}

/** `repo · branch → base` in mono (the stage meta line and rows). */
export function BranchLine({ repoName, branch, base, className }: { repoName?: string; branch: string; base?: string; className?: string }) {
  return (
    <span className={cn('type-meta inline-flex min-w-0 items-center gap-1.5 text-ink-3', className)}>
      {repoName && (
        <>
          <span className="truncate text-ink-2">{repoName}</span>
          <span aria-hidden>·</span>
        </>
      )}
      <GitBranch aria-hidden className="size-3 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0 truncate" title={branch}>
        {branch}
      </span>
      {base && (
        <>
          <span aria-hidden className="text-ink-4">
            →
          </span>
          <span className="shrink-0">{base}</span>
          <span className="sr-only">into {base}</span>
        </>
      )}
    </span>
  )
}

/** Compact checks summary: ✓ 4/4 · ✕ 1 · ● running — glyph shapes carry the meaning. */
export const ChecksBrief = memo(function ChecksBrief({ checks, className }: { checks: readonly CheckResult[]; className?: string }) {
  const s = checksSummary(checks)
  if (!s.total) return null
  let glyph: ReactNode
  let label: string
  if (s.failed) {
    glyph = <StatusGlyph shape="cross" tone="fail" decorative size={11} />
    label = `${s.failed} of ${s.total} checks failed`
  } else if (s.running || s.pending) {
    glyph = <StatusGlyph shape="dot" tone="live" decorative size={11} />
    label = `Checks running: ${s.passed} of ${s.total} passed so far`
  } else {
    glyph = <StatusGlyph shape="check" tone="done" decorative size={11} />
    label = `${s.passed} of ${s.total} checks passed`
  }
  return (
    <Tooltip content={`${label} (simulated)`}>
      <span className={cn('type-meta inline-flex shrink-0 items-center gap-1 text-ink-3 tabular', className)} aria-label={`${label}, simulated`}>
        {glyph}
        <span aria-hidden>
          {s.passed}/{s.total}
        </span>
      </span>
    </Tooltip>
  )
})

/** A quiet section header in the stage (the Home grammar: `label` kicker, mono count, trailing action). */
export function SectionTitle({ id, title, count, action, className }: { id?: string; title: string; count?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex h-7 min-w-0 items-center gap-2', className)}>
      <h2 id={id} className="type-label text-ink-3">
        {title}
      </h2>
      {count !== undefined && count > 0 && <span className="type-meta text-ink-3 tabular">{count}</span>}
      <span className="flex-1" />
      {action}
    </div>
  )
}

/** One quiet sentence where a section has nothing to show. */
export function QuietLine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('type-body-sm py-1 text-ink-3', className)}>{children}</p>
}
