import { db, useDB, type Tables } from '@/core/db'
import { getFile } from '@/core/github'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import { logActivity } from '@/core/services/activity'
import { CODE_FACTORY, PR_CONFIRM_NOTE, PR_FACTORY, buildPatch, followSessionTask, mergeFileChanges } from '@/core/services/code'
import { markRead, notify } from '@/core/services/notifications'
import {
  editStepTitle, installCommandFor, installOutputFor, pathsToRealize, realizeTurn, structureTurn, type RealizedTurn, type TurnStructure,
} from '@/core/sim/code/design'
import type { WorkingFile } from '@/core/sim/code/files'
import { lintCommand, testCommand, typecheckCommand } from '@/core/sim/code/toolchain'
import { stableId } from '@/core/sim/ids'
import { paramString } from '@/core/sim/params'
import { diffStat } from '@/core/sim/terminal'
import { shorten } from '@/core/sim/text'
import type { ActorRef, CheckResult, CodeSession, EntityRef, FileChange, ID, Repo, Run } from '@/core/types'
import type { Rng } from '@/lib/rng'
import { runEngine } from '../engine'
import { registerRunFactory } from '../registry'
import { updateStep } from '../service'
import type { RunPlan, StepContext, StepPlan } from '../types'

/**
 * Coding-agent simulation scripts.
 *
 * 'code.session' (params { sessionId, turnId, prompt, base? }) — plan → search → read real files →
 * edit (diffs computed from the real contents) → [install] → run the tests (approval-gated) →
 * [fix a failing assertion and re-run] → typecheck, lint, unit tests → summary.
 * - Demo repository: everything is computed at plan time from the bundled sources.
 * - Live GitHub repository: file contents are fetched in step side effects (memoized per run,
 *   usually warm from the prefetch in `createSession`) and the steps are updated in place.
 * `base` holds the session's current content of files changed by earlier turns, so a re-plan
 * after a reload yields the same script. Commands and test output are always simulated.
 *
 * 'code.pull_request' (params { sessionId }) — an approval-gated (repo.pull_request, high risk),
 * simulated pull request for the session's accepted changes.
 */

const CHECK_ORDER = ['Typecheck', 'Lint', 'Unit tests'] as const

/** Display order of every check a session can carry (seeded sessions also report e2e and build). */
const CHECK_KEY_ORDER = ['typecheck', 'lint', 'unit', 'e2e', 'build'] as const

/**
 * One key per check, whatever it was named: 'Typecheck' / 'typecheck', 'Unit tests' / 'unit',
 * 'E2E tests' / 'e2e'. A new turn's result replaces the earlier one of the same key.
 */
export function checkKey(name: string): string {
  const n = name.trim().toLowerCase()
  if (n === 'unit' || n === 'unit tests' || n === 'tests' || n === 'test') return 'unit'
  if (n === 'e2e' || n === 'e2e tests' || n === 'end-to-end tests') return 'e2e'
  if (n === 'types' || n.startsWith('typecheck') || n === 'type check') return 'typecheck'
  return n
}

function checkRank(name: string): number {
  const i = (CHECK_KEY_ORDER as readonly string[]).indexOf(checkKey(name))
  return i < 0 ? CHECK_KEY_ORDER.length : i
}

/** What a check from an earlier turn reads once the code changed under it. */
export const STALE_CHECK_NOTE = 'Not re-run after the latest changes. Each turn runs typecheck, lint and unit tests in the simulated sandbox.'

function failedPlan(message: string): RunPlan {
  return { steps: [{ kind: 'think', title: 'Check the session', durationMs: 400, failChance: 1, failMessage: message }] }
}

function readBase(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'))
}

function demoFiles(base: Readonly<Record<string, string>>): WorkingFile[] {
  const files: WorkingFile[] = DEMO_REPO.files.map((f) => ({ path: f.path, content: base[f.path] ?? f.content }))
  for (const [path, content] of Object.entries(base)) if (!files.some((f) => f.path === path)) files.push({ path, content })
  return files
}

function liveFiles(repo: Repo, base: Readonly<Record<string, string>>): WorkingFile[] {
  const files: WorkingFile[] = (repo.tree ?? []).filter((f) => f.type === 'file').map((f) => ({ path: f.path, size: f.size, content: base[f.path] }))
  for (const [path, content] of Object.entries(base)) if (!files.some((f) => f.path === path)) files.push({ path, content })
  return files
}

function tokensFor(text: string | undefined, min = 300): number {
  return Math.max(min, Math.min(6000, Math.ceil((text?.length ?? 0) / 4)))
}

// ---------------------------------------------------------------- session side effects (idempotent)

function mergeIntoSession(sessionId: ID, changes: readonly FileChange[]): void {
  if (!changes.length) return
  db.update('sessions', sessionId, (s) => ({ ...s, changes: mergeFileChanges(s.changes, changes), updatedAt: Date.now() }))
}

function upsertCheck(sessionId: ID, check: Omit<CheckResult, 'id'>): void {
  const id = stableId('chk', sessionId, check.name)
  const key = checkKey(check.name)
  db.update('sessions', sessionId, (s) => {
    const others = s.checks.filter((c) => c.id !== id && checkKey(c.name) !== key)
    const checks = [...others, { ...check, id }].sort((a, b) => checkRank(a.name) - checkRank(b.name))
    return { ...s, checks, updatedAt: Date.now() }
  })
}

/**
 * At the start of a turn the checks it runs go back to pending; checks it does not run (e2e, build
 * from earlier turns) are marked skipped, so no stale "passed" outlives the code it checked.
 */
function resetChecks(sessionId: ID): void {
  const turnKeys = new Set(CHECK_ORDER.map(checkKey))
  db.update('sessions', sessionId, (s) => {
    const stale = s.checks.filter((c) => !turnKeys.has(checkKey(c.name)) && c.status !== 'skipped')
    if (!stale.length) return s
    return { ...s, checks: s.checks.map((c) => (stale.includes(c) ? { ...c, status: 'skipped' as const, durationMs: undefined, output: STALE_CHECK_NOTE } : c)) }
  })
  for (const name of CHECK_ORDER) upsertCheck(sessionId, { name, status: 'pending' })
}

function readRefs(raw: unknown): EntityRef[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((r): r is EntityRef => !!r && typeof r === 'object' && typeof (r as EntityRef).kind === 'string' && typeof (r as EntityRef).id === 'string')
}

/** "Edit src/a.ts", "Edit src/a.ts and 2 more files". */
function editApprovalTitle(changes: readonly FileChange[] | undefined, fallbackPath: string): string {
  const paths = changes?.length ? changes.map((c) => c.path) : [fallbackPath]
  const more = paths.length - 1
  return `Edit ${paths[0]}${more > 0 ? ` and ${more} more file${more === 1 ? '' : 's'}` : ''}`
}

/**
 * The gate on edit steps. Low risk, so only the Supervised policy asks (§6.3: file edits raise
 * separate repo.write approvals only when the session policy is Supervised).
 */
function editApproval(branch: string, changes: readonly FileChange[] | undefined, fallbackPath: string): NonNullable<StepPlan['approval']> {
  return {
    title: editApprovalTitle(changes, fallbackPath),
    description: `Writes to the session branch ${branch}. You review every file in Changes before anything is merged.`,
    risk: 'low',
    preview: changes?.length
      ? { kind: 'diff', content: buildPatch(changes), label: branch }
      : { kind: 'text', content: `The change to ${fallbackPath} is computed from the file read from GitHub; review it in Changes.`, label: branch },
  }
}

function isLatestTurn(session: CodeSession, turnId: ID): boolean {
  return session.turns[session.turns.length - 1]?.id === turnId
}

function actorOf(run: Run): ActorRef {
  return run.agentId ? { type: 'agent', id: run.agentId } : { type: 'system', id: 'system' }
}

// ---------------------------------------------------------------- live (GitHub) realization

interface LiveContext {
  structure: TurnStructure
  base: Readonly<Record<string, string>>
  repo: Pick<Repo, 'owner' | 'name' | 'defaultBranch'>
  sizes: ReadonlyMap<string, number | undefined>
  branch: string
  prompt: string
  allPaths: readonly string[]
}

const liveRealizations = new Map<ID, Promise<RealizedTurn>>()

/** Fetch the files a turn needs (cache-first) and realize it. Memoized per run; deterministic. */
function realizeLive(runId: ID, live: LiveContext): Promise<RealizedTurn> {
  const cached = liveRealizations.get(runId)
  if (cached) return cached
  const promise = (async () => {
    const contents: Record<string, string | undefined> = {}
    const errors: string[] = []
    await Promise.all(
      pathsToRealize(live.structure).map(async (path) => {
        if (live.base[path] !== undefined) {
          contents[path] = live.base[path]
          return
        }
        const size = live.sizes.get(path)
        const res = await getFile(live.repo.owner, live.repo.name, path, live.repo.defaultBranch, size !== undefined ? { size } : {})
        if (res.ok && !res.data.skipped) contents[path] = res.data.content
        else errors.push(`${path}: ${res.ok ? res.data.content : res.error.message}`)
      }),
    )
    const realized = realizeTurn(live.structure, { repoName: live.repo.name, branch: live.branch, prompt: live.prompt, contents, allPaths: live.allPaths, live: true })
    if (errors.length && !realized.edit) {
      realized.summary = ['Could not read the files needed from GitHub:', ...errors.map((e) => `• ${e}`), 'No change was proposed. Check the connection (or add a token in Integrations) and try again.'].join('\n')
    }
    return realized
  })()
  liveRealizations.set(runId, promise)
  if (liveRealizations.size > 24) liveRealizations.delete(liveRealizations.keys().next().value as ID)
  return promise
}

/** onComplete for live steps: update the step once the live realization resolves (fire-and-forget). */
function liveStep(live: LiveContext | null, apply: (r: RealizedTurn, ctx: StepContext) => void): StepPlan['onComplete'] {
  if (!live) return undefined
  return (ctx) => {
    const runId = ctx.run.id
    const step = ctx.step
    void realizeLive(runId, live)
      .then((r) => apply(r, { ...ctx, step }))
      .catch((error: unknown) => updateStep(runId, step.id, { error: error instanceof Error ? error.message : 'Could not read from GitHub' }))
  }
}

// ---------------------------------------------------------------- code.session

export function planCodeSession(params: Record<string, unknown>, rng: Rng): RunPlan {
  const sessionId = paramString(params, 'sessionId')
  const turnId = paramString(params, 'turnId')
  const prompt = paramString(params, 'prompt')
  const session = sessionId ? db.get('sessions', sessionId) : undefined
  const repo = session ? db.get('repos', session.repoId) : undefined
  if (!session || !repo || !turnId || !prompt) return failedPlan('This coding session or its repository no longer exists.')
  const base = readBase(params.base)
  const isLive = repo.provider === 'github'
  const files = isLive ? liveFiles(repo, base) : demoFiles(base)
  if (!files.length) return failedPlan('The repository has no files to work on. Refresh it and try again.')
  const s = structureTurn({ repoName: repo.name, files, prompt, rng, failChance: isLive ? 0 : 0.2, pathOnly: isLive })
  if (!s.primary) return failedPlan('No source files in this repository match the request.')
  const primary = s.primary

  const allPaths = files.map((f) => f.path)
  const realized = isLive
    ? null
    : realizeTurn(s, { repoName: repo.name, branch: session.branch, prompt, contents: Object.fromEntries(files.map((f) => [f.path, f.content])), allPaths, live: false })
  const live: LiveContext | null = isLive
    ? { structure: s, base, repo, sizes: new Map(files.map((f) => [f.path, f.size])), branch: session.branch, prompt, allPaths }
    : null
  const integrationId = isLive ? 'github' : undefined
  const repoRefs: EntityRef[] = [{ kind: 'repo', id: repo.id }]
  const contextRefs = readRefs(params.context)
  const id = session.id
  const sandbox = { tool: 'terminal', capability: 'shell.execute' as const, integrationId: 'sandbox' }

  const steps: StepPlan[] = [
    {
      kind: 'plan',
      title: 'Plan the change',
      output: s.planText,
      ...(contextRefs.length ? { refs: contextRefs } : {}),
      durationMs: rng.int(1500, 2800),
      tokens: rng.int(600, 1200),
      onComplete: () => resetChecks(id),
    },
    {
      kind: 'search',
      title: 'Search the codebase',
      detail: s.search.paths.length ? `${s.search.paths.length} matching file${s.search.paths.length === 1 ? '' : 's'}` : 'No direct match',
      tool: 'search',
      capability: 'repo.read',
      integrationId,
      input: s.search.input,
      output: s.search.output,
      refs: repoRefs,
      durationMs: rng.int(900, 1800),
      tokens: rng.int(400, 900),
    },
    ...s.readPaths.map(
      (path): StepPlan => ({
        kind: 'read',
        title: `Read ${path}`,
        tool: 'read_file',
        capability: 'repo.read',
        integrationId,
        input: path,
        output: realized ? realized.readOutputs[path] : `Reading ${path} from GitHub…`,
        durationMs: rng.int(700, 1500),
        tokens: tokensFor(realized ? files.find((f) => f.path === path)?.content : undefined, 400),
        onComplete: liveStep(live, (r, ctx) => updateStep(ctx.run.id, ctx.step.id, { output: r.readOutputs[path] })),
      }),
    ),
    {
      kind: 'edit',
      title: realized ? editStepTitle(realized.edit, primary) : `Edit ${primary}`,
      detail: realized ? `${realized.editChanges.length} file${realized.editChanges.length === 1 ? '' : 's'} changed` : 'Changes are computed from the file contents read from GitHub',
      tool: 'edit_file',
      capability: 'repo.write',
      fileChanges: realized ? realized.editChanges : undefined,
      output: realized ? diffStat(realized.editChanges) : 'Preparing the change…',
      approval: editApproval(session.branch, realized?.editChanges, primary),
      durationMs: rng.int(2200, 4200),
      tokens: rng.int(1400, 3200),
      onComplete: realized
        ? () => mergeIntoSession(id, realized.editChanges)
        : liveStep(live, (r, ctx) => {
            updateStep(ctx.run.id, ctx.step.id, {
              title: editStepTitle(r.edit, primary),
              detail: `${r.editChanges.length} file${r.editChanges.length === 1 ? '' : 's'} changed`,
              fileChanges: r.editChanges,
              output: r.editChanges.length ? diffStat(r.editChanges) : r.summary,
            })
            mergeIntoSession(id, r.editChanges)
          }),
    },
  ]

  const install = installCommandFor(s)
  if (install && s.pkg) {
    steps.push({
      kind: 'command',
      title: `Install ${s.pkg.name}`,
      detail: 'Simulated sandbox — nothing is installed',
      ...sandbox,
      input: install,
      output: installOutputFor(s, rng),
      fileChanges: realized?.depChange ? [realized.depChange] : undefined,
      approval: {
        title: `Run \`${install}\``,
        description: `Adds ${s.pkg.name} to package.json in the session sandbox (simulated).`,
        risk: 'medium',
        preview: { kind: 'command', content: install, label: 'Session sandbox' },
      },
      durationMs: rng.int(3500, 7000),
      tokens: rng.int(200, 500),
      onComplete: realized
        ? () => mergeIntoSession(id, realized.depChange ? [realized.depChange] : [])
        : liveStep(live, (r, ctx) => {
            if (!r.depChange) return
            updateStep(ctx.run.id, ctx.step.id, { fileChanges: [r.depChange] })
            mergeIntoSession(id, [r.depChange])
          }),
    })
  }

  const testPath = s.test?.path ?? null
  const testCmd = realized?.testCommand ?? testCommand(s.toolchain, testPath)
  steps.push({
    kind: 'command',
    title: testPath ? `Run ${testPath}` : 'Run the test suite',
    detail: 'Simulated sandbox — test output is generated, nothing executes',
    ...sandbox,
    input: testCmd,
    output: realized ? realized.testOutputFirst : 'Running…',
    approval: {
      title: `Run \`${testCmd}\``,
      description: 'Runs the tests in the session sandbox (simulated).',
      risk: 'medium',
      preview: { kind: 'command', content: testCmd, label: 'Session sandbox' },
    },
    durationMs: rng.int(3000, 6000),
    tokens: rng.int(300, 900),
    onComplete: realized
      ? () => upsertCheck(id, { name: 'Unit tests', status: realized.failed ? 'failed' : 'running', output: realized.testOutputFirst })
      : liveStep(live, (r, ctx) => {
          updateStep(ctx.run.id, ctx.step.id, { output: r.testOutputFirst })
          upsertCheck(id, { name: 'Unit tests', status: 'running', output: r.testOutputFirst })
        }),
  })

  if (realized?.failed && realized.fixChange && realized.test) {
    const fix = realized.fixChange
    steps.push(
      {
        kind: 'edit',
        title: 'Fix failing assertion',
        detail: realized.test.fixDescription,
        tool: 'edit_file',
        capability: 'repo.write',
        fileChanges: [fix],
        output: diffStat([fix]),
        approval: editApproval(session.branch, [fix], fix.path),
        durationMs: rng.int(1600, 3000),
        tokens: rng.int(700, 1500),
        onComplete: () => mergeIntoSession(id, [fix]),
      },
      {
        kind: 'test',
        title: 'Re-run the tests',
        ...sandbox,
        input: testCmd,
        output: realized.testOutputRerun ?? '',
        durationMs: rng.int(2400, 4200),
        tokens: rng.int(200, 600),
        onComplete: () => upsertCheck(id, { name: 'Unit tests', status: 'running', output: realized.testOutputRerun ?? '' }),
      },
    )
  }

  const plannedChecks = realized
    ? realized.checks
    : [
        { name: 'Typecheck' as const, command: typecheckCommand(s.toolchain) },
        { name: 'Lint' as const, command: lintCommand(s.toolchain, [primary]) },
        { name: 'Unit tests' as const, command: testCommand(s.toolchain, null) },
      ].map((c) => ({ ...c, output: 'Running…', status: c.command ? ('passed' as const) : ('skipped' as const), durationMs: rng.int(1800, 7000) }))
  for (const c of plannedChecks) {
    steps.push({
      kind: 'test',
      title: c.status === 'skipped' ? `${c.name} (not configured)` : c.name,
      ...(c.command ? { ...sandbox, input: c.command } : { tool: 'terminal' }),
      output: realized ? c.output : c.status === 'skipped' ? `No ${c.name.toLowerCase() === 'lint' ? 'linter' : 'type checker'} is configured for this repository.` : 'Running…',
      durationMs: c.status === 'skipped' ? 400 : Math.min(6000, Math.max(1200, c.durationMs)),
      tokens: rng.int(100, 400),
      onComplete: realized
        ? () => upsertCheck(id, { name: c.name, status: c.status, durationMs: c.durationMs, output: c.output })
        : liveStep(live, (r, ctx) => {
            const real = r.checks.find((x) => x.name === c.name)
            if (!real) return
            updateStep(ctx.run.id, ctx.step.id, { output: real.output })
            upsertCheck(id, { name: real.name, status: real.status, durationMs: real.durationMs, output: real.output })
          }),
    })
  }

  steps.push({
    kind: 'message',
    title: 'Summarize the change',
    output: realized ? realized.summary : 'Summarizing…',
    durationMs: rng.int(1200, 2200),
    tokens: rng.int(400, 900),
    onComplete: liveStep(live, (r, ctx) => updateStep(ctx.run.id, ctx.step.id, { output: r.summary })),
  })

  const finalize = (r: RealizedTurn, run: Run) => {
    mergeIntoSession(id, r.finalChanges)
    for (const c of r.checks) upsertCheck(id, { name: c.name, status: c.status, durationMs: c.durationMs, output: c.output })
    const cur = db.update('sessions', id, (cur) => ({
      ...cur,
      status: isLatestTurn(cur, turnId) ? (cur.changes.length ? 'needs_review' : 'idle') : cur.status,
      turns: cur.turns.map((t) => (t.id === turnId ? { ...t, summary: r.summary } : t)),
      updatedAt: Date.now(),
    }))
    if (!cur) return
    const n = r.finalChanges.length
    logActivity({
      actor: actorOf(run),
      verb: 'proposed',
      target: { kind: 'session', id },
      summary: n ? `Proposed ${n} change${n === 1 ? '' : 's'} on ${cur.branch} — ready for review` : `Finished a turn on ${cur.branch} without changes`,
      projectId: cur.projectId,
    })
    followSessionTask(id)
  }

  return {
    steps,
    summary: realized ? realized.summary : `Proposed changes on ${session.branch} (simulated run; diffs based on live GitHub contents).`,
    onSuccess: (ctx) => {
      if (realized) {
        finalize(realized, ctx.run)
        return
      }
      if (!live) return
      const run = ctx.run
      void realizeLive(run.id, live)
        .then((r) => {
          finalize(r, run)
          ctx.patchRun({ summary: r.summary })
        })
        .catch(() => undefined)
    },
    onFailure: (ctx) => {
      db.update('sessions', id, (cur) => ({
        ...cur,
        status: isLatestTurn(cur, turnId) ? 'failed' : cur.status,
        turns: cur.turns.map((t) => (t.id === turnId ? { ...t, summary: `Stopped: ${ctx.reason}` } : t)),
        updatedAt: Date.now(),
      }))
    },
  }
}

// ---------------------------------------------------------------- code.pull_request

function nextPrNumber(repoId: ID, rng: Rng): number {
  const numbers = db.filter('sessions', (s) => s.repoId === repoId && !!s.pr).map((s) => s.pr!.number)
  return numbers.length ? Math.max(...numbers) + rng.int(1, 5) : rng.int(120, 480)
}

function prBody(session: CodeSession, accepted: readonly FileChange[]): string {
  const summaries = session.turns.map((t) => t.summary?.split('\n')[0] ?? t.prompt)
  const checks = session.checks.map((c) => `- ${c.name}: ${c.status}`)
  return [
    '## Summary',
    ...session.turns.map((t, i) => `- ${shorten(t.prompt, 120)}${summaries[i] && summaries[i] !== t.prompt ? ` — ${shorten(summaries[i], 120)}` : ''}`),
    '',
    '## Changes',
    ...accepted.map((c) => `- \`${c.path}\` (+${c.additions} −${c.deletions})`),
    ...(checks.length ? ['', '## Checks', ...checks] : []),
    '',
    '_Opened from Atrium. Simulated pull request: no branch was pushed and nothing was sent to GitHub._',
  ].join('\n')
}

export function planPullRequest(params: Record<string, unknown>, rng: Rng): RunPlan {
  const sessionId = paramString(params, 'sessionId')
  const session = sessionId ? db.get('sessions', sessionId) : undefined
  const repo = session ? db.get('repos', session.repoId) : undefined
  if (!session || !repo) return failedPlan('This coding session or its repository no longer exists.')
  const accepted = session.changes.filter((c) => c.review === 'accepted')
  if (!accepted.length) return failedPlan('There are no accepted changes to open a pull request with.')
  const number = nextPrNumber(repo.id, rng)
  const title = session.title
  const body = prBody(session, accepted)
  const id = session.id
  return {
    steps: [
      { kind: 'think', title: 'Prepare the pull request', output: `${title}\n\n${body}`, durationMs: rng.int(1200, 2200), tokens: rng.int(500, 1100) },
      {
        kind: 'tool',
        title: `Open a pull request on ${repo.fullName}`,
        detail: `${session.branch} → ${session.baseBranch}`,
        tool: 'github',
        capability: 'repo.pull_request',
        integrationId: 'github',
        input: `${session.branch} → ${session.baseBranch}`,
        output: `Simulated: pushed ${session.branch} and opened pull request #${number} “${title}”. No request was sent to GitHub.`,
        approval: {
          title: `Open pull request “${shorten(title, 70)}”`,
          description: `Pushes ${session.branch} and opens a pull request against ${session.baseBranch} (simulated in this build).`,
          risk: 'high',
          preview: { kind: 'text', label: `${repo.fullName} · ${session.branch} → ${session.baseBranch}`, content: `${title}\n\n${body}` },
        },
        durationMs: rng.int(1600, 2800),
        tokens: rng.int(200, 500),
      },
      { kind: 'message', title: 'Pull request ready for review', output: `Pull request #${number} is open (simulated) with ${accepted.length} change${accepted.length === 1 ? '' : 's'}.`, durationMs: rng.int(600, 1200), tokens: rng.int(100, 300) },
    ],
    summary: `Opened pull request #${number} “${shorten(title, 80)}” (simulated).`,
    onSuccess: (ctx) => {
      const cur = db.get('sessions', id)
      if (!cur || cur.pr?.number === number) return
      db.update('sessions', id, { pr: { number, title, status: 'open', simulated: true }, status: cur.status === 'needs_review' ? 'approved' : cur.status, updatedAt: Date.now() })
      logActivity({ actor: actorOf(ctx.run), verb: 'opened', target: { kind: 'session', id }, summary: `Opened pull request #${number} “${shorten(title, 80)}” (simulated)`, projectId: cur.projectId })
      notify({ kind: 'run.completed', title: `Pull request #${number} opened (simulated)`, body: `${repo.fullName} · ${session.branch} → ${session.baseBranch}`, ref: { kind: 'session', id }, tone: 'success' })
      followSessionTask(id)
    },
  }
}

// ---------------------------------------------------------------- "Approve & open PR" is one decision

const confirming = new Set<ID>()

/** Pending approvals of pull-request runs started with `confirmed: true` (the human confirmed in review). */
export function confirmedPullRequestApprovals(s: Pick<Tables, 'approvals' | 'runs'>): ID[] {
  const out: ID[] = []
  for (const a of Object.values(s.approvals)) {
    if (a.status !== 'pending') continue
    const script = s.runs[a.runId]?.script
    if (script?.factory === PR_FACTORY && script.params.confirmed === true) out.push(a.id)
  }
  return out
}

/**
 * Resolve the approval of a confirmed pull-request run as approved by you, "Confirmed in review"
 * (§6.3: you never see a second card). Deferred to a microtask: the engine is still finishing the
 * request when the approval row appears. Its approval notification is marked read.
 */
function confirmPending(s: Pick<Tables, 'approvals' | 'runs'>): void {
  for (const approvalId of confirmedPullRequestApprovals(s)) {
    if (confirming.has(approvalId)) continue
    confirming.add(approvalId)
    queueMicrotask(() => {
      confirming.delete(approvalId)
      if (db.get('approvals', approvalId)?.status !== 'pending') return
      runEngine.resolveApproval(approvalId, 'approved', PR_CONFIRM_NOTE)
      for (const n of db.filter('notifications', (x) => x.ref?.kind === 'approval' && x.ref.id === approvalId && !x.readAt)) markRead(n.id)
    })
  }
}

let unwatchConfirmed: (() => void) | null = null

/** Watch for confirmed pull-request approvals (installed once with the factories; survives reloads). */
function watchConfirmedPullRequests(): void {
  if (unwatchConfirmed) return
  unwatchConfirmed = useDB.subscribe((state, prev) => {
    if (state.approvals !== prev.approvals) confirmPending(state)
  })
  // Approvals that were already waiting when the app loaded.
  queueMicrotask(() => confirmPending(useDB.getState()))
}

export function registerCodeFactories(): void {
  registerRunFactory(CODE_FACTORY, planCodeSession)
  registerRunFactory(PR_FACTORY, planPullRequest)
  watchConfirmedPullRequests()
}
