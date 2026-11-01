import type { GithubRateLimit } from '@/core/github'
import type { CheckResult, CodeSession, FileChange, Repo, RepoFile, RunStatus, SessionStatus } from '@/core/types'
import type { GlyphShape, GlyphTone } from '@/ui'

/**
 * Code workspace logic (docs/DESIGN.md §6.3), pure: session grouping and status words, change and
 * check summaries, the review sentence, file trees and the small text helpers the views share.
 */

// ------------------------------------------------------------------------------------------------ sessions

/** List-pane groups, in order: Needs review · Working · Idle · Done (archived sessions sit in a footer). */
export type SessionGroup = 'review' | 'working' | 'idle' | 'done' | 'archived'

export const SESSION_GROUPS: readonly Exclude<SessionGroup, 'archived'>[] = ['review', 'working', 'idle', 'done']

export const SESSION_GROUP_LABEL: Record<SessionGroup, string> = {
  review: 'Needs review',
  working: 'Working',
  idle: 'Idle',
  done: 'Done',
  archived: 'Archived',
}

export function sessionGroup(status: SessionStatus): SessionGroup {
  switch (status) {
    case 'needs_review':
      return 'review'
    case 'working':
      return 'working'
    case 'approved':
    case 'merged':
      return 'done'
    case 'archived':
      return 'archived'
    default:
      // idle and failed: nothing is running and nothing waits for review.
      return 'idle'
  }
}

export interface StatusMeta {
  shape: GlyphShape
  tone: GlyphTone
  word: string
  live?: boolean
  /** Capsule tint: live working, attn needs you, fail failed, neutral otherwise. */
  signal: 'live' | 'attn' | 'done' | 'fail' | 'neutral'
}

/**
 * A session's status as a glyph and a word. While a turn works, its run decides: waiting on an
 * approval reads "Needs you", a paused run "Paused", a queued or running one "Working".
 */
export function sessionStatusMeta(status: SessionStatus, runStatus?: RunStatus): StatusMeta {
  if (status === 'working') {
    if (runStatus === 'waiting') return { shape: 'diamond', tone: 'attn', word: 'Needs you', signal: 'attn' }
    if (runStatus === 'paused') return { shape: 'bars', tone: 'ink-2', word: 'Paused', signal: 'neutral' }
    return { shape: 'dot', tone: 'live', word: 'Working', live: true, signal: 'live' }
  }
  switch (status) {
    case 'needs_review':
      return { shape: 'diamond', tone: 'attn', word: 'Needs review', signal: 'attn' }
    case 'approved':
      return { shape: 'check', tone: 'done', word: 'Approved', signal: 'done' }
    case 'merged':
      return { shape: 'check', tone: 'done', word: 'Merged', signal: 'done' }
    case 'failed':
      return { shape: 'cross', tone: 'fail', word: 'Failed', signal: 'fail' }
    case 'archived':
      return { shape: 'slash', tone: 'ink-3', word: 'Archived', signal: 'neutral' }
    default:
      return { shape: 'ring', tone: 'ink-3', word: 'Idle', signal: 'neutral' }
  }
}

/** Sort inside a group: the most recently touched first. */
export const byRecent = (a: Pick<CodeSession, 'updatedAt'>, b: Pick<CodeSession, 'updatedAt'>) => b.updatedAt - a.updatedAt

/** Group sessions for the list pane; archived ones are returned separately. */
export function groupSessions<T extends Pick<CodeSession, 'status' | 'updatedAt'>>(sessions: readonly T[]): { groups: { key: Exclude<SessionGroup, 'archived'>; sessions: T[] }[]; archived: T[] } {
  const buckets = new Map<SessionGroup, T[]>()
  for (const s of sessions) {
    const g = sessionGroup(s.status)
    const list = buckets.get(g)
    if (list) list.push(s)
    else buckets.set(g, [s])
  }
  return {
    groups: SESSION_GROUPS.map((key) => ({ key, sessions: [...(buckets.get(key) ?? [])].sort(byRecent) })).filter((g) => g.sessions.length > 0),
    archived: [...(buckets.get('archived') ?? [])].sort(byRecent),
  }
}

/** Code home groups (brief): Needs review · Working · Recent (everything else that is not archived). */
export function homeGroups<T extends Pick<CodeSession, 'status' | 'updatedAt'>>(sessions: readonly T[], recentLimit = 6): { review: T[]; working: T[]; recent: T[] } {
  const live = sessions.filter((s) => s.status !== 'archived').sort(byRecent)
  return {
    review: live.filter((s) => s.status === 'needs_review'),
    working: live.filter((s) => s.status === 'working'),
    recent: live.filter((s) => s.status !== 'needs_review' && s.status !== 'working').slice(0, recentLimit),
  }
}

/** Search a session by title, branch or repository name. */
export function matchesSession(session: Pick<CodeSession, 'title' | 'branch'>, repoName: string | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [session.title, session.branch, repoName ?? ''].some((v) => v.toLowerCase().includes(q))
}

export function matchesRepo(repo: Pick<Repo, 'fullName' | 'description' | 'language'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [repo.fullName, repo.description ?? '', repo.language ?? ''].some((v) => v.toLowerCase().includes(q))
}

// ------------------------------------------------------------------------------------------------ changes

export interface ChangeStats {
  files: number
  additions: number
  deletions: number
  accepted: number
  rejected: number
  pending: number
}

export function changeStats(changes: readonly FileChange[]): ChangeStats {
  const out: ChangeStats = { files: changes.length, additions: 0, deletions: 0, accepted: 0, rejected: 0, pending: 0 }
  for (const c of changes) {
    out.additions += c.additions
    out.deletions += c.deletions
    if (c.review === 'accepted') out.accepted++
    else if (c.review === 'rejected') out.rejected++
    else out.pending++
  }
  return out
}

/** M/A/D/R, the git status letter of a change. */
export const CHANGE_LETTER: Record<FileChange['changeType'], string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' }
export const CHANGE_WORD: Record<FileChange['changeType'], string> = { added: 'Added', modified: 'Modified', deleted: 'Deleted', renamed: 'Renamed' }

export const REVIEW_WORD: Record<NonNullable<FileChange['review']>, string> = { pending: 'Not reviewed', accepted: 'Accepted', rejected: 'Rejected' }

/** "src/auth/" + "session.ts". */
export function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) }
}

/** Index of the next file to review after a decision: the next pending file after `from`, wrapping. */
export function nextPendingIndex(changes: readonly FileChange[], from: number): number {
  const n = changes.length
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n
    if ((changes[i]?.review ?? 'pending') === 'pending') return i
  }
  return from
}

// ------------------------------------------------------------------------------------------------ checks

const CHECK_LABELS: Record<string, string> = {
  typecheck: 'Typecheck',
  lint: 'Lint',
  unit: 'Unit tests',
  'unit tests': 'Unit tests',
  e2e: 'E2E tests',
  'e2e tests': 'E2E tests',
  build: 'Build',
}

/** Display name of a check, whatever casing the run used ("unit" → "Unit tests"). */
export function checkLabel(name: string): string {
  return CHECK_LABELS[name.trim().toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1)
}

export interface ChecksSummary {
  passed: number
  failed: number
  running: number
  pending: number
  skipped: number
  /** Checks that ran or will run (skipped ones excluded). */
  total: number
}

export function checksSummary(checks: readonly CheckResult[]): ChecksSummary {
  const out: ChecksSummary = { passed: 0, failed: 0, running: 0, pending: 0, skipped: 0, total: 0 }
  for (const c of checks) {
    out[c.status]++
    if (c.status !== 'skipped') out.total++
  }
  return out
}

/** "Checks 4/4", "Checks 2/3 · 1 failed", "Checks running" — the review sentence's checks clause. */
export function checksClause(s: ChecksSummary): string {
  if (!s.total) return 'No checks yet'
  if (s.running || (s.pending && s.pending === s.total)) return s.passed ? `Checks ${s.passed}/${s.total} · running` : 'Checks running'
  return `Checks ${s.passed}/${s.total}${s.failed ? ` · ${s.failed} failed` : ''}`
}

// ------------------------------------------------------------------------------------------------ review sentence

/** The sticky review bar's sentence (§6.3): "2 files · +34 −6 · 1 accepted · 1 rejected". */
export function reviewSentence(stats: ChangeStats): string {
  const parts = [`${stats.files} ${stats.files === 1 ? 'file' : 'files'}`, `+${stats.additions} −${stats.deletions}`]
  if (stats.accepted) parts.push(`${stats.accepted} accepted`)
  if (stats.rejected) parts.push(`${stats.rejected} rejected`)
  if (stats.pending && (stats.accepted || stats.rejected)) parts.push(`${stats.pending} to review`)
  return parts.join(' · ')
}

/** The instruction "Request changes…" starts from: the rejected files, one line each. */
export function requestChangesDraft(changes: readonly FileChange[]): string {
  const rejected = changes.filter((c) => c.review === 'rejected').map((c) => c.path)
  if (!rejected.length) return ''
  return rejected.length === 1 ? `Rework ${rejected[0]}: ` : `Rework ${rejected.join(', ')}: `
}

// ------------------------------------------------------------------------------------------------ files

export interface FileTreeNode {
  id: string
  label: string
  children?: FileTreeNode[]
}

/**
 * A nested tree from a flat file list (directories first, then files, alphabetical). Directories are
 * created for every file's ancestors even when the listing omits them.
 */
export function buildFileTree(files: readonly RepoFile[]): FileTreeNode[] {
  const root: FileTreeNode = { id: '', label: '', children: [] }
  const dirs = new Map<string, FileTreeNode>([['', root]])
  const ensureDir = (path: string): FileTreeNode => {
    const hit = dirs.get(path)
    if (hit) return hit
    const i = path.lastIndexOf('/')
    const parent = ensureDir(i < 0 ? '' : path.slice(0, i))
    const node: FileTreeNode = { id: path, label: i < 0 ? path : path.slice(i + 1), children: [] }
    parent.children!.push(node)
    dirs.set(path, node)
    return node
  }
  for (const f of files) {
    if (f.type === 'dir') {
      ensureDir(f.path)
      continue
    }
    const i = f.path.lastIndexOf('/')
    const parent = ensureDir(i < 0 ? '' : f.path.slice(0, i))
    parent.children!.push({ id: f.path, label: i < 0 ? f.path : f.path.slice(i + 1) })
  }
  const sort = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => Number(!a.children) - Number(!b.children) || a.label.localeCompare(b.label))
    for (const n of nodes) if (n.children) sort(n.children)
  }
  sort(root.children!)
  return root.children!
}

/** Every ancestor directory of a path ("src/auth/session.ts" → ["src", "src/auth"]). */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/** Directories to open by default: the top-level ones that hold code, plus the selected file's ancestors. */
export function defaultExpanded(files: readonly RepoFile[], selected?: string | null): string[] {
  const top = files.filter((f) => f.type === 'dir' && !f.path.includes('/') && /^(src|app|lib|packages|e2e|test|tests)$/.test(f.path)).map((f) => f.path)
  return [...new Set([...top.slice(0, 2), ...(selected ? ancestorsOf(selected) : [])])]
}

export function fileCount(files: readonly RepoFile[] | undefined): number {
  return files?.filter((f) => f.type === 'file').length ?? 0
}

/** The instruction a session about a file starts from. */
export function fileInstruction(path: string): string {
  return `In ${path}: `
}

/** "Ask about this file" in a session composer. */
export function askAboutFile(path: string): string {
  return `About ${path}: `
}

// ------------------------------------------------------------------------------------------------ composer

/** The session composer's slash commands, turned into the instruction a turn receives. */
export function slashInstruction(command: string, args: string): string {
  const rest = args.trim()
  switch (command) {
    case 'plan':
      return rest ? `Plan this without changing code yet: ${rest}` : 'Plan the next step without changing code yet.'
    case 'test':
      return rest ? `Add or update tests, then run them: ${rest}` : 'Run the tests and fix anything that fails.'
    case 'review':
      return rest ? `Review the current changes for ${rest} and fix what you find.` : 'Review the current changes, then fix anything risky you find.'
    default:
      return rest
  }
}

// ------------------------------------------------------------------------------------------------ GitHub

/** "52/60 requests left this hour" (§6.3). */
export function rateLimitText(rl: Pick<GithubRateLimit, 'limit' | 'remaining'>): string {
  return `${rl.remaining}/${rl.limit} requests left this hour`
}

/** The repository's page on GitHub for a file. */
export function githubBlobUrl(repo: Pick<Repo, 'url' | 'defaultBranch'>, path: string): string | undefined {
  return repo.url ? `${repo.url}/blob/${encodeURIComponent(repo.defaultBranch)}/${path.split('/').map(encodeURIComponent).join('/')}` : undefined
}

/** A filename for "Export .patch": the branch with slashes flattened. */
export function patchFilename(branch: string): string {
  return `${branch.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'changes'}.patch`
}
