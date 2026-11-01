import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import { useContextStore } from '@/core/context'
import { db, ID_PREFIX, useRow, useRows } from '@/core/db'
import { GithubRequestError, getFile, getRepo, getTree, invalidateRepoCache, parseRepoInput } from '@/core/github'
import { runEngine } from '@/core/runs/engine'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import { countLineChanges, structureTurn, pathsToRealize } from '@/core/sim/code/design'
import { languageFromPath } from '@/core/sim/code/files'
import { slugify, titleFromText } from '@/core/sim/text'
import { createRng } from '@/lib/rng'
import {
  ME, isRunActive,
  type ActorRef, type Autonomy, type CodeSession, type CodeTurn, type EntityRef, type FileChange, type ID, type KnowledgeItem, type Repo,
  type RepoFile, type Run, type SessionStatus, type TaskStatus,
} from '@/core/types'
import { newId } from '@/lib/id'
import { logActivity } from './activity'
import { createKnowledge, updateKnowledge } from './knowledge'
import { forgetRef, markDerived } from './serviceHelpers'
import { updateTask } from './tasks'

/**
 * Code service: repositories (live GitHub reads or the bundled demo repo) and coding
 * sessions. Each session turn is a 'code.session' run (src/core/runs/factories/code.ts):
 * diffs come from real file contents, while commands, test output and pull requests are
 * simulated and labeled as such.
 */

export { languageFromPath }

export const CODE_FACTORY = 'code.session'
export const PR_FACTORY = 'code.pull_request'
export const CODE_AGENT_ID = 'agt_forge'
export const DEMO_REPO_ID = 'rep_atlas'
/** Stored trees are capped so very large repositories do not fill local storage. */
export const MAX_TREE_ENTRIES = 4000
/**
 * The note on a pull-request approval resolved by "Approve & open PR" in review (§6.3): the human
 * decision was made there, so the run's own approval is resolved with this note instead of asking twice.
 */
export const PR_CONFIRM_NOTE = 'Confirmed in review'

const sessionRef = (id: ID): EntityRef => ({ kind: 'session', id })
const repoRef = (id: ID): EntityRef => ({ kind: 'repo', id })
const quoted = (s: string) => `“${s.length > 80 ? `${s.slice(0, 79)}…` : s}”`

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

function touchSession(id: ID, patch: Partial<CodeSession> | ((s: CodeSession) => CodeSession)): CodeSession | undefined {
  const now = Date.now()
  return db.update('sessions', id, (s) => {
    const next = typeof patch === 'function' ? patch(s) : { ...s, ...patch }
    return next === s ? s : { ...next, updatedAt: now }
  })
}

function addRepoToProject(projectId: ID | null | undefined, repoId: ID): void {
  if (!projectId) return
  db.update('projects', projectId, (p) => (p.repoIds.includes(repoId) ? p : { ...p, repoIds: [...p.repoIds, repoId], updatedAt: Date.now() }))
}

function capTree(files: RepoFile[]): { tree: RepoFile[]; capped: boolean } {
  if (files.length <= MAX_TREE_ENTRIES) return { tree: files, capped: false }
  return { tree: files.slice(0, MAX_TREE_ENTRIES), capped: true }
}

// ---------------------------------------------------------------- repositories

/** File tree of the bundled demo repository: every file plus the directories they live in. */
export function demoTree(): RepoFile[] {
  const dirs = new Set<string>()
  for (const f of DEMO_REPO.files) {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
  }
  return [
    ...[...dirs].map((path): RepoFile => ({ path, type: 'dir' })),
    ...DEMO_REPO.files.map((f): RepoFile => ({ path: f.path, type: 'file', size: utf8Length(f.content) })),
  ].sort((a, b) => a.path.localeCompare(b.path))
}

/** Connect the bundled demo repository (idempotent: returns the existing one). */
export function connectDemoRepo(opts: { projectId?: ID | null } = {}): Repo {
  const existing = db.find('repos', (r) => r.provider === 'demo')
  if (existing) {
    if (opts.projectId && !existing.projectId) db.update('repos', existing.id, { projectId: opts.projectId })
    addRepoToProject(opts.projectId, existing.id)
    return db.get('repos', existing.id) ?? existing
  }
  const now = Date.now()
  const repo: Repo = {
    id: db.get('repos', DEMO_REPO_ID) ? newId(ID_PREFIX.repos) : DEMO_REPO_ID,
    provider: 'demo',
    owner: DEMO_REPO.owner,
    name: DEMO_REPO.name,
    fullName: `${DEMO_REPO.owner}/${DEMO_REPO.name}`,
    description: DEMO_REPO.description,
    defaultBranch: DEMO_REPO.defaultBranch,
    language: DEMO_REPO.language,
    mode: 'simulated',
    projectId: opts.projectId ?? null,
    tree: demoTree(),
    treeTruncated: false,
    connectedAt: now,
    lastSyncedAt: now,
  }
  db.insert('repos', repo)
  addRepoToProject(repo.projectId, repo.id)
  logActivity({ actor: ME, verb: 'connected', target: repoRef(repo.id), summary: `Connected the demo repository ${repo.fullName}`, projectId: repo.projectId })
  return repo
}

/**
 * Connect a GitHub repository ("owner/name" or a GitHub URL). Metadata and the file tree are
 * read live from the GitHub REST API. Rejects with a friendly `GithubRequestError`/`Error`.
 * Connecting the same repository twice returns the existing one.
 */
export async function connectGithubRepo(input: string, opts: { projectId?: ID | null } = {}): Promise<Repo> {
  const coords = parseRepoInput(input)
  if (!coords) throw new Error('Enter a repository as owner/name or a github.com URL.')
  const findExisting = (fullName: string) => db.find('repos', (r) => r.provider === 'github' && r.fullName.toLowerCase() === fullName.toLowerCase())
  const known = findExisting(`${coords.owner}/${coords.name}`)
  if (known) {
    if (opts.projectId && !known.projectId) db.update('repos', known.id, { projectId: opts.projectId })
    addRepoToProject(opts.projectId, known.id)
    return db.get('repos', known.id) ?? known
  }
  const info = await getRepo(coords.owner, coords.name)
  if (!info.ok) throw new GithubRequestError(info.error)
  const tree = await getTree(info.data.owner, info.data.name, info.data.defaultBranch)
  if (!tree.ok && tree.error.kind !== 'empty') throw new GithubRequestError(tree.error)
  const raced = findExisting(info.data.fullName)
  if (raced) return raced
  const { tree: files, capped } = capTree(tree.ok ? tree.data.files : [])
  const now = Date.now()
  const repo: Repo = {
    id: newId(ID_PREFIX.repos),
    provider: 'github',
    owner: info.data.owner,
    name: info.data.name,
    fullName: info.data.fullName,
    description: info.data.description,
    defaultBranch: info.data.defaultBranch,
    url: info.data.htmlUrl,
    language: info.data.language,
    stars: info.data.stars,
    mode: 'live',
    projectId: opts.projectId ?? null,
    tree: files,
    treeTruncated: capped || (tree.ok && tree.data.truncated),
    connectedAt: now,
    lastSyncedAt: now,
  }
  db.insert('repos', repo)
  addRepoToProject(repo.projectId, repo.id)
  logActivity({ actor: ME, verb: 'connected', target: repoRef(repo.id), summary: `Connected ${repo.fullName} from GitHub`, projectId: repo.projectId })
  return repo
}

/** Re-read metadata and the file tree (GitHub), or rebuild the demo tree. */
export async function refreshRepo(repoId: ID): Promise<Repo> {
  const repo = db.get('repos', repoId)
  if (!repo) throw new Error('Repository not found.')
  if (repo.provider === 'demo') {
    return db.update('repos', repoId, { tree: demoTree(), treeTruncated: false, lastSyncedAt: Date.now() }) ?? repo
  }
  const info = await getRepo(repo.owner, repo.name)
  if (!info.ok) throw new GithubRequestError(info.error)
  const tree = await getTree(repo.owner, repo.name, info.data.defaultBranch)
  if (!tree.ok && tree.error.kind !== 'empty') throw new GithubRequestError(tree.error)
  invalidateRepoCache(repo.owner, repo.name)
  const { tree: files, capped } = capTree(tree.ok ? tree.data.files : [])
  const next = db.update('repos', repoId, {
    description: info.data.description,
    defaultBranch: info.data.defaultBranch,
    language: info.data.language,
    stars: info.data.stars,
    url: info.data.htmlUrl,
    tree: files,
    treeTruncated: capped || (tree.ok && tree.data.truncated),
    lastSyncedAt: Date.now(),
  })
  logActivity({ actor: ME, verb: 'synced', target: repoRef(repoId), summary: `Refreshed ${repo.fullName} from GitHub`, projectId: repo.projectId })
  return next ?? repo
}

/** Remove a repository connection. Sessions keep their proposed changes. */
export function disconnectRepo(repoId: ID): void {
  const repo = db.get('repos', repoId)
  if (!repo) return
  if (repo.provider === 'github') invalidateRepoCache(repo.owner, repo.name)
  for (const p of db.filter('projects', (x) => x.repoIds.includes(repoId))) {
    db.update('projects', p.id, (cur) => ({ ...cur, repoIds: cur.repoIds.filter((r) => r !== repoId), updatedAt: Date.now() }))
  }
  forgetRef(repoRef(repoId))
  db.remove('repos', repoId)
  logActivity({ actor: ME, verb: 'disconnected', target: repoRef(repoId), summary: `Disconnected ${repo.fullName}`, projectId: repo.projectId })
}

export interface RepoFileContent {
  content: string
  language?: string
  /** Size in bytes. */
  size: number
  /** Set when the file was not loaded (binary or larger than 1 MB); `content` is a placeholder. */
  skipped?: 'binary' | 'too_large'
  /** True when read live from GitHub. */
  live: boolean
}

/** Read one file: from the bundled demo repository, or live from GitHub (cached in memory). */
export async function getRepoFile(repoId: ID, path: string): Promise<RepoFileContent> {
  const repo = db.get('repos', repoId)
  if (!repo) throw new Error('Repository not found.')
  if (repo.provider === 'demo') {
    const file = DEMO_REPO.files.find((f) => f.path === path)
    if (!file) throw new Error(`File not found: ${path}`)
    return { content: file.content, language: languageFromPath(path), size: utf8Length(file.content), live: false }
  }
  const size = repo.tree?.find((f) => f.path === path)?.size
  const res = await getFile(repo.owner, repo.name, path, repo.defaultBranch, size !== undefined ? { size } : {})
  if (!res.ok) throw new GithubRequestError(res.error)
  return { content: res.data.content, language: languageFromPath(path), size: res.data.size, skipped: res.data.skipped, live: true }
}

// ---------------------------------------------------------------- change sets

/**
 * Merge a step's or turn's changes into a session change set. Each path keeps its original
 * `before` (from the first change) and takes the newest `after`; counts are recomputed.
 * Re-merging identical content is a no-op (review state is kept), otherwise review resets.
 */
export function mergeFileChanges(existing: readonly FileChange[], incoming: readonly FileChange[]): FileChange[] {
  const out = [...existing]
  for (const change of incoming) {
    const idx = out.findIndex((c) => c.path === change.path)
    if (idx < 0) {
      out.push({ ...change, review: 'pending' })
      continue
    }
    const cur = out[idx]
    if (cur.after === change.after) continue
    const before = cur.changeType === 'added' ? undefined : cur.before
    if (change.after !== undefined && before !== undefined && change.after === before) {
      out.splice(idx, 1) // the change was reverted
      continue
    }
    const counts = countLineChanges(before ?? '', change.after ?? '')
    out[idx] = {
      ...change,
      changeType: cur.changeType === 'added' ? 'added' : change.changeType,
      ...(before !== undefined ? { before } : {}),
      additions: counts.additions,
      deletions: counts.deletions,
      review: 'pending',
    }
    if (before === undefined) delete out[idx].before
  }
  return out
}

/** Current content of every changed file at the start of a turn (rejected changes excluded). */
export function sessionBase(session: CodeSession): Record<string, string> {
  const base: Record<string, string> = {}
  for (const c of session.changes) {
    if (c.review === 'rejected' || c.changeType === 'deleted' || c.after === undefined) continue
    base[c.path] = c.after
  }
  return base
}

/** A git-style unified diff for one file change (`diff --git` header, /dev/null for added and deleted files). */
export function fileChangePatch(change: FileChange): string {
  const oldPath = change.changeType === 'renamed' && change.oldPath ? change.oldPath : change.path
  const added = change.changeType === 'added'
  const deleted = change.changeType === 'deleted'
  const header = [`diff --git a/${oldPath} b/${change.path}`]
  if (added) header.push('new file mode 100644')
  if (deleted) header.push('deleted file mode 100644')
  if (change.changeType === 'renamed' && change.oldPath && change.oldPath !== change.path) header.push(`rename from ${change.oldPath}`, `rename to ${change.path}`)
  const before = added ? '' : (change.before ?? '')
  const after = deleted ? '' : (change.after ?? '')
  if (before === after) return `${header.join('\n')}\n`
  const body = createTwoFilesPatch(added ? '/dev/null' : `a/${oldPath}`, deleted ? '/dev/null' : `b/${change.path}`, before, after, undefined, undefined, {
    headerOptions: FILE_HEADERS_ONLY,
  })
  return `${header.join('\n')}\n${body}`
}

/** One patch for several file changes, in order (what "Export .patch" and "Copy diff" produce). */
export function buildPatch(changes: readonly FileChange[]): string {
  return changes.map(fileChangePatch).join('')
}

/**
 * The session's change set as a patch: accepted changes (default, what a pull request would carry),
 * every non-rejected change, or everything.
 */
export function sessionPatch(sessionId: ID, which: 'accepted' | 'proposed' | 'all' = 'accepted'): string {
  const session = db.get('sessions', sessionId)
  if (!session) return ''
  const changes = session.changes.filter((c) => (which === 'all' ? true : which === 'proposed' ? c.review !== 'rejected' : c.review === 'accepted'))
  return buildPatch(changes)
}

// ---------------------------------------------------------------- sessions

export interface CreateSessionInput {
  repoId: ID
  prompt: string
  title?: string
  projectId?: ID | null
  taskId?: ID
  agentId?: ID
  origin?: EntityRef
  /** Approval policy for this session (overrides the agent's autonomy for its runs). */
  autonomy?: Autonomy
  /** Working branch name (default: atrium/<slug-of-title>, made unique). */
  branch?: string
  /** Base branch (default: the repository's default branch). */
  baseBranch?: string
  /**
   * What the composer's Context Line showed (held, attached, project memory items). The turn's plan step
   * records them as refs, so the run's Saw list matches what was offered.
   */
  contextRefs?: EntityRef[]
}

export interface ContinueSessionOptions {
  /** As `CreateSessionInput.contextRefs`, for this turn. */
  contextRefs?: EntityRef[]
}

function codingAgentId(explicit?: ID): ID | undefined {
  if (explicit) return explicit
  const forge = db.get('agents', CODE_AGENT_ID)
  return forge && forge.status === 'active' ? forge.id : undefined
}

function uniqueBranch(repoId: ID, title: string, exact = false): string {
  const base = exact ? title.replace(/\s+/g, '-') : `atrium/${slugify(title, 40)}`
  const taken = new Set(db.filter('sessions', (s) => s.repoId === repoId).map((s) => s.branch))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

/** Serializable, deduplicated context refs for run params (the plan step lists them). */
function contextParam(refs: readonly EntityRef[] | undefined): EntityRef[] | undefined {
  if (!refs?.length) return undefined
  const seen = new Set<string>()
  const out: EntityRef[] = []
  for (const r of refs) {
    if (!r || typeof r.kind !== 'string' || typeof r.id !== 'string') continue
    const key = `${r.kind}:${r.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind: r.kind, id: r.id })
  }
  return out.length ? out.slice(0, 24) : undefined
}

function startTurn(session: CodeSession, turn: CodeTurn, contextRefs?: readonly EntityRef[]): Run {
  const params: Record<string, unknown> = { sessionId: session.id, turnId: turn.id, prompt: turn.prompt }
  const base = sessionBase(session)
  if (Object.keys(base).length) params.base = base
  const context = contextParam(contextRefs)
  if (context) params.context = context
  const run = runEngine.start({
    kind: 'code',
    title: session.turns.length > 1 ? `${session.title} — ${titleFromText(turn.prompt, 60)}` : session.title,
    factory: CODE_FACTORY,
    params,
    projectId: session.projectId,
    agentId: session.agentId,
    origin: sessionRef(session.id),
  })
  touchSession(session.id, (s) => ({ ...s, turns: s.turns.map((t) => (t.id === turn.id ? { ...t, runId: run.id } : t)) }))
  if (session.taskId) {
    db.update('tasks', session.taskId, (t) => (t.runIds.includes(run.id) ? t : { ...t, runIds: [...t.runIds, run.id], updatedAt: Date.now() }))
    followSessionTask(session.id)
  }
  return run
}

// ---------------------------------------------------------------- the linked task follows the session

const TASK_FOR_SESSION: Partial<Record<SessionStatus, TaskStatus>> = {
  working: 'in_progress',
  needs_review: 'review',
  approved: 'done',
  merged: 'done',
}

/**
 * The linked task follows the session (§6.3 Connections, §7.3 journey 3): a working turn moves it to
 * In progress, a turn ready for review to Review, approved or merged changes to Done. Done and
 * cancelled tasks are never reopened by the session. Idempotent.
 */
export function followSessionTask(sessionId: ID): void {
  const session = db.get('sessions', sessionId)
  if (!session?.taskId) return
  const target = TASK_FOR_SESSION[session.status]
  const task = db.get('tasks', session.taskId)
  if (!target || !task || task.status === target || task.status === 'done' || task.status === 'cancelled') return
  const agent: ActorRef | undefined = session.agentId ? { type: 'agent', id: session.agentId } : undefined
  const actor = target === 'done' ? ME : (agent ?? ME)
  updateTask(task.id, { status: target }, { actor })
}

/** Warm the GitHub file cache for the files a turn is likely to read (fire-and-forget). */
function prefetchTurn(session: CodeSession, prompt: string): void {
  const repo = db.get('repos', session.repoId)
  if (!repo || repo.provider !== 'github' || !repo.tree?.length) return
  const files = repo.tree.filter((f) => f.type === 'file').map((f) => ({ path: f.path, size: f.size }))
  const s = structureTurn({ repoName: repo.name, files, prompt, rng: createRng(session.id), failChance: 0 })
  for (const path of pathsToRealize(s).slice(0, 6)) {
    const size = repo.tree.find((f) => f.path === path)?.size
    void getFile(repo.owner, repo.name, path, repo.defaultBranch, size !== undefined ? { size } : {}).catch(() => undefined)
  }
}

/** Start a coding session on a repository; the first turn runs immediately as the coding agent. */
export function createSession(input: CreateSessionInput): CodeSession {
  const repo = db.get('repos', input.repoId)
  if (!repo) throw new Error('Repository not found.')
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Describe the change you want.')
  const task = input.taskId ? db.get('tasks', input.taskId) : undefined
  const title = input.title?.trim() || titleFromText(prompt, 64)
  const now = Date.now()
  const turn: CodeTurn = { id: newId('trn'), prompt, createdAt: now }
  const session: CodeSession = {
    id: newId(ID_PREFIX.sessions),
    repoId: repo.id,
    title,
    projectId: input.projectId !== undefined ? input.projectId : (task?.projectId ?? repo.projectId ?? null),
    branch: input.branch?.trim() ? uniqueBranch(repo.id, input.branch.trim(), true) : uniqueBranch(repo.id, title),
    baseBranch: input.baseBranch?.trim() || repo.defaultBranch,
    status: 'working',
    ...(input.autonomy ? { autonomy: input.autonomy } : {}),
    turns: [turn],
    changes: [],
    checks: [],
    createdAt: now,
    updatedAt: now,
  }
  if (input.taskId) session.taskId = input.taskId
  const agentId = codingAgentId(input.agentId)
  if (agentId) session.agentId = agentId
  db.insert('sessions', session)
  const origin = input.origin ?? (input.taskId ? { kind: 'task' as const, id: input.taskId } : undefined)
  if (origin) markDerived(sessionRef(session.id), origin)
  logActivity({ actor: ME, verb: 'started', target: sessionRef(session.id), summary: `Started coding session ${quoted(title)} on ${repo.fullName}`, projectId: session.projectId })
  prefetchTurn(session, prompt)
  try {
    startTurn(session, turn, input.contextRefs)
  } catch (error) {
    touchSession(session.id, { status: 'failed' })
    throw error
  }
  return db.get('sessions', session.id) ?? session
}

/** The run of the session's turn that is still active (queued, running, waiting or paused), if any. */
export function activeSessionRun(session: CodeSession): Run | undefined {
  for (const t of session.turns) {
    const run = t.runId ? db.get('runs', t.runId) : undefined
    if (run && isRunActive(run.status)) return run
  }
  return undefined
}

/**
 * Give the agent another instruction: a new turn and run on the same branch. While a turn is still
 * active nothing is started and that turn's run is returned (callers queue the message instead).
 */
export function continueSession(sessionId: ID, prompt: string, opts: ContinueSessionOptions = {}): Run | undefined {
  const session = db.get('sessions', sessionId)
  const text = prompt.trim()
  if (!session || !text || session.status === 'archived') return undefined
  const active = activeSessionRun(session)
  if (active) return active
  const turn: CodeTurn = { id: newId('trn'), prompt: text, createdAt: Date.now() }
  const next = touchSession(sessionId, (s) => ({ ...s, status: 'working', turns: [...s.turns, turn] }))
  if (!next) return undefined
  logActivity({ actor: ME, verb: 'instructed', target: sessionRef(sessionId), summary: `Asked for a follow-up in ${quoted(session.title)}: ${quoted(text)}`, projectId: session.projectId })
  prefetchTurn(next, text)
  return startTurn(next, turn, opts.contextRefs)
}

/** Rename a session (the stage header's inline rename). */
export function renameSession(sessionId: ID, title: string): CodeSession | undefined {
  const session = db.get('sessions', sessionId)
  const next = title.replace(/\s+/g, ' ').trim()
  if (!session || !next || next === session.title) return session
  const updated = touchSession(sessionId, { title: next })
  logActivity({ actor: ME, verb: 'renamed', target: sessionRef(sessionId), summary: `Renamed coding session ${quoted(session.title)} to ${quoted(next)}`, projectId: session.projectId })
  return updated
}

export function reviewChange(sessionId: ID, path: string, review: NonNullable<FileChange['review']>): CodeSession | undefined {
  return touchSession(sessionId, (s) => {
    let changed = false
    const changes = s.changes.map((c) => {
      if (c.path !== path || c.review === review) return c
      changed = true
      return { ...c, review }
    })
    return changed ? { ...s, changes } : s
  })
}

function reviewAll(sessionId: ID, review: 'accepted' | 'rejected'): CodeSession | undefined {
  const session = db.get('sessions', sessionId)
  if (!session) return undefined
  const next = touchSession(sessionId, (s) => (s.changes.every((c) => c.review === review) ? s : { ...s, changes: s.changes.map((c) => ({ ...c, review })) }))
  logActivity({
    actor: ME,
    verb: review,
    target: sessionRef(sessionId),
    summary: `${review === 'accepted' ? 'Accepted' : 'Rejected'} all ${session.changes.length} changes in ${quoted(session.title)}`,
    projectId: session.projectId,
  })
  return next
}

export const acceptAllChanges = (sessionId: ID) => reviewAll(sessionId, 'accepted')
export const rejectAllChanges = (sessionId: ID) => reviewAll(sessionId, 'rejected')

/** Apply the accepted changes to the session branch (simulated). Requires at least one accepted change. */
export function applyChanges(sessionId: ID): CodeSession {
  const session = db.get('sessions', sessionId)
  if (!session) throw new Error('Session not found.')
  const accepted = session.changes.filter((c) => c.review === 'accepted')
  if (!accepted.length) throw new Error('Accept at least one change before applying.')
  const next = touchSession(sessionId, { status: 'approved' }) ?? session
  logActivity({
    actor: ME,
    verb: 'applied',
    target: sessionRef(sessionId),
    summary: `Applied ${accepted.length} change${accepted.length === 1 ? '' : 's'} to ${session.branch} (simulated)`,
    projectId: session.projectId,
    meta: { paths: accepted.map((c) => c.path) },
  })
  followSessionTask(sessionId)
  return next
}

export interface OpenPullRequestOptions {
  /**
   * The human already confirmed in review ("Approve & open PR" → "Confirm: open PR"). The run still asks
   * through the approval model, and its approval is resolved at once as approved by you with
   * `PR_CONFIRM_NOTE`, so no second card appears (§6.3, §9 "Don't raise a second approval").
   */
  confirmed?: boolean
}

/**
 * Open a pull request for the accepted changes: a short run whose approval step
 * (repo.pull_request, high risk) previews the PR. Pull requests are simulated in this build.
 */
export function openPullRequest(sessionId: ID, opts: OpenPullRequestOptions = {}): Run {
  const session = db.get('sessions', sessionId)
  if (!session) throw new Error('Session not found.')
  if (session.status === 'archived') throw new Error('This session is archived. Restore it first.')
  if (!session.changes.some((c) => c.review === 'accepted')) throw new Error('Accept at least one change before opening a pull request.')
  if (session.pr && session.pr.status !== 'closed') throw new Error(`Pull request #${session.pr.number} is already ${session.pr.status}.`)
  const running = activePullRequestRun(sessionId)
  if (running) return running
  if (session.status === 'needs_review' || session.status === 'idle') applyChanges(sessionId)
  return runEngine.start({
    kind: 'code',
    title: `Open pull request: ${session.title}`,
    factory: PR_FACTORY,
    params: opts.confirmed ? { sessionId, confirmed: true } : { sessionId },
    projectId: session.projectId,
    agentId: session.agentId,
    origin: sessionRef(sessionId),
  })
}

/** The pull-request run of a session that is still in flight, if any. */
export function activePullRequestRun(sessionId: ID): Run | undefined {
  return db.find('runs', (r) => r.origin?.kind === 'session' && r.origin.id === sessionId && r.script?.factory === PR_FACTORY && isRunActive(r.status))
}

/** Merge the (simulated) pull request. */
export function mergePullRequest(sessionId: ID): CodeSession | undefined {
  const session = db.get('sessions', sessionId)
  if (!session?.pr || session.pr.status !== 'open') return session
  const pr = session.pr
  const next = touchSession(sessionId, { status: 'merged', pr: { ...pr, status: 'merged' } })
  logActivity({ actor: ME, verb: 'merged', target: sessionRef(sessionId), summary: `Merged pull request #${pr.number} ${quoted(pr.title)} (simulated)`, projectId: session.projectId })
  followSessionTask(sessionId)
  return next
}

function cancelSessionRuns(session: CodeSession, reason: string): void {
  const runIds = new Set(session.turns.map((t) => t.runId).filter((r): r is ID => !!r))
  for (const run of db.filter('runs', (r) => r.origin?.kind === 'session' && r.origin.id === session.id)) runIds.add(run.id)
  for (const id of runIds) {
    const run = db.get('runs', id)
    if (run && isRunActive(run.status)) runEngine.cancel(id, reason)
  }
}

export function archiveSession(sessionId: ID): CodeSession | undefined {
  const session = db.get('sessions', sessionId)
  if (!session || session.status === 'archived') return session
  cancelSessionRuns(session, 'Session archived')
  const next = touchSession(sessionId, { status: 'archived' })
  logActivity({ actor: ME, verb: 'archived', target: sessionRef(sessionId), summary: `Archived coding session ${quoted(session.title)}`, projectId: session.projectId })
  return next
}

/** The status an archived session returns to: its PR decides, then whether changes wait for review. */
export function restoredStatus(session: Pick<CodeSession, 'pr' | 'changes'>): SessionStatus {
  if (session.pr?.status === 'merged') return 'merged'
  if (session.pr?.status === 'open') return 'approved'
  if (session.changes.some((c) => c.review === 'pending')) return 'needs_review'
  if (session.changes.length && session.changes.every((c) => c.review === 'accepted')) return 'approved'
  return 'idle'
}

/** Undo an archive (the archive toast's Undo, or Restore on an archived session). */
export function restoreSession(sessionId: ID): CodeSession | undefined {
  const session = db.get('sessions', sessionId)
  if (!session || session.status !== 'archived') return session
  const next = touchSession(sessionId, { status: restoredStatus(session) })
  logActivity({ actor: ME, verb: 'restored', target: sessionRef(sessionId), summary: `Restored coding session ${quoted(session.title)}`, projectId: session.projectId })
  return next
}

export function deleteSession(sessionId: ID): void {
  const session = db.get('sessions', sessionId)
  if (!session) return
  cancelSessionRuns(session, 'Session deleted')
  forgetRef(sessionRef(sessionId))
  db.remove('sessions', sessionId)
  logActivity({ actor: ME, verb: 'deleted', target: sessionRef(sessionId), summary: `Deleted coding session ${quoted(session.title)}`, projectId: session.projectId })
}

// ---------------------------------------------------------------- hold a repository file

function knowledgeCopyOf(repoId: ID, path: string): KnowledgeItem | undefined {
  return db.find('knowledge', (k) => k.source.type === 'code' && k.source.ref?.kind === 'repo' && k.source.ref.id === repoId && k.file?.name === path)
}

/**
 * Hold a repository file (§6.3 Files › Hold file). Held items are entities, so the file is kept as a
 * Knowledge copy (source: code → the repository, read live for GitHub repositories) and that copy is
 * held: it rides along in every new AI action and is retrievable later. An existing copy of the same
 * path is reused (refreshed when the file changed). Binary and oversized files cannot be held.
 */
export async function holdRepoFile(repoId: ID, path: string): Promise<KnowledgeItem> {
  const repo = db.get('repos', repoId)
  if (!repo) throw new Error('Repository not found.')
  const file = await getRepoFile(repoId, path)
  if (file.skipped) throw new Error(file.skipped === 'binary' ? 'Binary files can’t be held.' : 'This file is above the 1 MB preview limit and can’t be held.')
  const language = file.language ?? ''
  const prose = /\.(md|mdx|txt|rst)$/i.test(path)
  const content = prose ? file.content : `\`\`\`${language}\n${file.content.replace(/\n$/, '')}\n\`\`\``
  const lines = file.content.split('\n').length
  const summary = `${path} from ${repo.fullName}${repo.provider === 'github' ? ` (${repo.defaultBranch}, read from GitHub)` : ' (demo repository)'} · ${lines} lines.`
  let item = knowledgeCopyOf(repoId, path)
  if (item && item.content !== content) item = updateKnowledge(item.id, { content, summary }) ?? item
  if (!item) {
    item = createKnowledge(
      {
        kind: prose ? 'doc' : 'snippet',
        title: path,
        content,
        summary,
        tags: ['code'],
        projectIds: repo.projectId ? [repo.projectId] : [],
        source: { type: 'code', ref: repoRef(repoId), ...(repo.url ? { url: `${repo.url}/blob/${repo.defaultBranch}/${path}` } : {}) },
        file: { name: path, mime: 'text/plain', size: file.size },
      },
      { verb: 'saved', summary: `Kept ${path} from ${repo.fullName} in Knowledge to hold it` },
    )
  }
  useContextStore.getState().pin({ kind: 'knowledge', id: item.id })
  return item
}

// ---------------------------------------------------------------- hooks

export interface SessionFilter {
  repoId?: ID
  /** Only this project's sessions (null or omitted: all). */
  projectId?: ID | null
  status?: SessionStatus | SessionStatus[]
}

export function useSessions(filter: SessionFilter = {}): CodeSession[] {
  const statuses = filter.status === undefined ? null : Array.isArray(filter.status) ? filter.status : [filter.status]
  return useRows(
    'sessions',
    (s) => (!filter.repoId || s.repoId === filter.repoId) && (!filter.projectId || s.projectId === filter.projectId) && (!statuses || statuses.includes(s.status)),
    (a, b) => b.updatedAt - a.updatedAt,
  )
}

export function useSession(id: ID | null | undefined): CodeSession | undefined {
  return useRow('sessions', id)
}

export function useRepos(): Repo[] {
  return useRows('repos', undefined, (a, b) => b.connectedAt - a.connectedAt)
}

export function useRepo(id: ID | null | undefined): Repo | undefined {
  return useRow('repos', id)
}
