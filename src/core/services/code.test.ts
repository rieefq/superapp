import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, emptyTables } from '@/core/db'
import { clearGithubCache } from '@/core/github'
import { __resetEngineForTests, runEngine } from '@/core/runs/engine'
import { planCodeSession, planPullRequest, registerCodeFactories } from '@/core/runs/factories/code'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import { useSettingsStore } from '@/core/settings'
import { countLineChanges } from '@/core/sim/code/design'
import { isRunActive, type CodeSession, type IntegrationConnection } from '@/core/types'
import { createRng } from '@/lib/rng'
import {
  acceptAllChanges, applyChanges, connectDemoRepo, connectGithubRepo, continueSession, createSession, deleteSession, demoTree, getRepoFile,
  languageFromPath, mergeFileChanges, mergePullRequest, openPullRequest, rejectAllChanges, reviewChange,
} from './code'
import { fx } from './testFixtures'

const NOW = new Date('2026-11-01T10:00:00Z').getTime()

registerCodeFactories()

const connected = (id: string): IntegrationConnection => ({ id, status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, connectedAt: NOW })

/** Advance the simulation, approving every approval request, until no run is active. */
async function drive(): Promise<void> {
  for (let round = 0; round < 60; round++) {
    await vi.advanceTimersByTimeAsync(30_000)
    const pending = db.filter('approvals', (a) => a.status === 'pending')
    for (const a of pending) runEngine.resolveApproval(a.id, 'approved')
    if (!pending.length && !db.all('runs').some((r) => isRunActive(r.status))) return
  }
}

function session(id: string): CodeSession {
  const s = db.get('sessions', id)
  if (!s) throw new Error(`missing session ${id}`)
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  __resetEngineForTests()
  clearGithubCache()
  db.insert('connections', connected('sandbox'))
  db.insert('connections', connected('github'))
})

afterEach(() => {
  __resetEngineForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('repositories', () => {
  it('connects the demo repository once, with files and derived directories', () => {
    db.insert('projects', fx.project({ id: 'prj_atlas' }))
    const repo = connectDemoRepo({ projectId: 'prj_atlas' })
    expect(repo).toMatchObject({ id: 'rep_atlas', provider: 'demo', mode: 'simulated', fullName: 'northwind/atlas-portal', defaultBranch: 'main' })
    expect(repo.tree?.some((f) => f.path === 'src' && f.type === 'dir')).toBe(true)
    expect(repo.tree?.some((f) => f.path === 'src/auth' && f.type === 'dir')).toBe(true)
    expect(repo.tree?.filter((f) => f.type === 'file')).toHaveLength(DEMO_REPO.files.length)
    expect(connectDemoRepo().id).toBe('rep_atlas')
    expect(db.all('repos')).toHaveLength(1)
    expect(db.get('projects', 'prj_atlas')?.repoIds).toEqual(['rep_atlas'])
    expect(demoTree()).toEqual(repo.tree)
  })

  it('reads demo files with language and size', async () => {
    connectDemoRepo()
    const file = await getRepoFile('rep_atlas', 'src/auth/session.ts')
    expect(file.content).toContain('export function startSession')
    expect(file).toMatchObject({ language: 'typescript', live: false })
    expect(file.size).toBeGreaterThan(1000)
    await expect(getRepoFile('rep_atlas', 'nope.ts')).rejects.toThrow('File not found: nope.ts')
    expect(languageFromPath('src/App.tsx')).toBe('tsx')
    expect(languageFromPath('Dockerfile')).toBe('dockerfile')
  })

  it('connects a GitHub repository live (mocked fetch) and reads files', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://api.github.com/repos/octo/widgets') {
        return Response.json({ name: 'widgets', full_name: 'octo/widgets', owner: { login: 'octo' }, default_branch: 'main', description: 'Widgets', language: 'TypeScript', stargazers_count: 7, html_url: 'https://github.com/octo/widgets', private: false })
      }
      if (url.startsWith('https://api.github.com/repos/octo/widgets/git/trees/main')) {
        return Response.json({ truncated: false, tree: [{ path: 'src', type: 'tree' }, { path: 'src/widget.ts', type: 'blob', size: 40 }] })
      }
      if (url === 'https://raw.githubusercontent.com/octo/widgets/main/src/widget.ts') return new Response('export const widget = 1\n')
      return new Response('not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const repo = await connectGithubRepo('https://github.com/octo/widgets')
    expect(repo).toMatchObject({ provider: 'github', mode: 'live', fullName: 'octo/widgets', stars: 7, url: 'https://github.com/octo/widgets' })
    expect(repo.tree).toEqual([{ path: 'src', type: 'dir' }, { path: 'src/widget.ts', type: 'file', size: 40 }])
    expect(await connectGithubRepo('octo/widgets')).toBe(db.get('repos', repo.id))
    expect(db.all('repos')).toHaveLength(1)
    const file = await getRepoFile(repo.id, 'src/widget.ts')
    expect(file).toMatchObject({ content: 'export const widget = 1\n', live: true, language: 'typescript' })
    await expect(connectGithubRepo('octo/missing')).rejects.toThrow('Repository not found (private repositories need a token)')
    await expect(connectGithubRepo('not a repo')).rejects.toThrow('owner/name')
  })
})

describe('code.session plan on the demo repository', () => {
  function setup(prompt: string) {
    connectDemoRepo()
    const s: CodeSession = fx.session({ id: 'ses_t', repoId: 'rep_atlas', branch: 'atrium/test', turns: [{ id: 'trn_1', prompt, createdAt: NOW }] })
    db.insert('sessions', s)
    return (seed: number) => planCodeSession({ sessionId: 'ses_t', turnId: 'trn_1', prompt }, createRng(seed))
  }

  it('explores real files and proposes diffs with consistent line counts', () => {
    const plan = setup('Fix session expiry after SSO login')(11)
    const paths = new Set(DEMO_REPO.files.map((f) => f.path))
    const kinds = plan.steps.map((s) => s.kind)
    expect(kinds.slice(0, 2)).toEqual(['plan', 'search'])
    const reads = plan.steps.filter((s) => s.kind === 'read')
    expect(reads.length).toBeGreaterThanOrEqual(2)
    expect(reads.length).toBeLessThanOrEqual(5)
    for (const r of reads) expect(paths.has(r.input ?? '')).toBe(true)
    expect(reads[0].input).toBe('src/auth/session.ts')
    expect(plan.steps[1].output).toMatch(/^src\/[\w/.]+:\d+:/m)

    const changes = plan.steps.flatMap((s) => s.fileChanges ?? [])
    expect(changes.length).toBeGreaterThan(0)
    for (const c of changes) {
      const counts = countLineChanges(c.before ?? '', c.after ?? '')
      expect([c.additions, c.deletions]).toEqual([counts.additions, counts.deletions])
      if (c.changeType === 'modified') expect(c.before).toBe(DEMO_REPO.files.find((f) => f.path === c.path)?.content ?? c.before)
    }
    const source = changes.find((c) => c.path === 'src/auth/session.ts')
    expect(source?.after).toContain('export function isSessionExpiring(session: Session, now = Date.now()): boolean')

    const commands = plan.steps.filter((s) => s.kind === 'command')
    expect(commands.length).toBeGreaterThanOrEqual(1)
    for (const c of commands) {
      expect(c).toMatchObject({ capability: 'shell.execute', integrationId: 'sandbox', tool: 'terminal' })
      expect(c.approval?.preview).toEqual({ kind: 'command', content: c.input, label: 'Session sandbox' })
    }
    expect(commands.some((c) => c.input === 'npm test -- src/auth/session.test.ts')).toBe(true)
    expect(commands.some((c) => c.input?.startsWith('npm install'))).toBe(false)
    expect(plan.steps.filter((s) => s.kind === 'test').map((s) => s.title)).toEqual(expect.arrayContaining(['Typecheck', 'Lint', 'Unit tests']))
    expect(plan.steps[plan.steps.length - 1].kind).toBe('message')
  })

  it('installs a dependency only when the prompt implies one', () => {
    const plan = setup('Migrate invoices to Stripe Billing')(3)
    const install = plan.steps.find((s) => s.input === 'npm install stripe')
    expect(install?.approval?.risk).toBe('medium')
    expect(install?.fileChanges?.[0]?.path).toBe('package.json')
    expect(install?.fileChanges?.[0]?.after).toContain('"stripe": "^17.0.0"')
  })

  it('sometimes fails a test first, then fixes the assertion and re-runs (seeded ~20%)', () => {
    const plan = setup('Add CSV export to the invoice list')
    const outcomes = Array.from({ length: 40 }, (_, seed) => plan(seed).steps.some((s) => s.title === 'Fix failing assertion'))
    const failures = outcomes.filter(Boolean).length
    expect(failures).toBeGreaterThan(2)
    expect(failures).toBeLessThan(16)
    const seed = outcomes.indexOf(true)
    const steps = plan(seed).steps
    const i = steps.findIndex((s) => s.title === 'Fix failing assertion')
    expect(steps[i - 1].output).toContain('AssertionError')
    expect(steps[i + 1]).toMatchObject({ kind: 'test', title: 'Re-run the tests' })
    expect(steps[i + 1].output).not.toContain('failed')
    // Deterministic for a seed.
    expect(plan(seed).steps.map((s) => s.output)).toEqual(steps.map((s) => s.output))
  })
})

describe('coding sessions', () => {
  it('runs a turn to needs_review with changes, checks and a summary', async () => {
    db.insert('agents', fx.agent({ id: 'agt_forge', name: 'Forge' }))
    db.insert('tasks', fx.task({ id: 'tsk_sso', projectId: null }))
    connectDemoRepo()
    const created = createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login', taskId: 'tsk_sso' })
    expect(created).toMatchObject({ status: 'working', branch: 'atrium/fix-session-expiry-after-sso-login', baseBranch: 'main', agentId: 'agt_forge' })
    expect(created.turns[0].runId).toBeDefined()
    expect(db.get('tasks', 'tsk_sso')?.runIds).toEqual([created.turns[0].runId])
    expect(db.find('links', (l) => l.from.id === created.id && l.to.id === 'tsk_sso' && l.rel === 'derived_from')).toBeDefined()

    await drive()
    const done = session(created.id)
    expect(done.status).toBe('needs_review')
    expect(done.changes.map((c) => c.path)).toEqual(expect.arrayContaining(['src/auth/session.ts', 'src/auth/session.test.ts']))
    expect(done.changes.every((c) => c.review === 'pending')).toBe(true)
    expect(done.checks.map((c) => [c.name, c.status])).toEqual([['Typecheck', 'passed'], ['Lint', 'passed'], ['Unit tests', 'passed']])
    expect(done.turns[0].summary).toContain('nothing was executed')
    const run = db.get('runs', done.turns[0].runId!)
    expect(run).toMatchObject({ status: 'succeeded', simulated: true, kind: 'code', agentId: 'agt_forge', origin: { kind: 'session', id: created.id } })
    expect(createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login' }).branch).toBe('atrium/fix-session-expiry-after-sso-login-2')
  })

  it('builds follow-up turns on the current change set', async () => {
    connectDemoRepo()
    const created = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await drive()
    const first = session(created.id).changes.find((c) => c.path === 'src/components/InvoiceList.tsx')!
    const run = continueSession(created.id, 'Document the CSV export helper')!
    expect(session(created.id).status).toBe('working')
    expect(run.script?.params.base).toMatchObject({ 'src/components/InvoiceList.tsx': first.after })
    await drive()
    const after = session(created.id)
    expect(after.turns).toHaveLength(2)
    const merged = after.changes.find((c) => c.path === 'src/components/InvoiceList.tsx')!
    expect(merged.before).toBe(first.before)
    expect(merged.after).toContain('export function toCsv')
    expect(merged.after).toContain('/**')
  })

  it('reviews, applies, opens and merges a (simulated) pull request', async () => {
    connectDemoRepo()
    const created = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await drive()
    expect(() => applyChanges(created.id)).toThrow('Accept at least one change')
    rejectAllChanges(created.id)
    expect(session(created.id).changes.every((c) => c.review === 'rejected')).toBe(true)
    acceptAllChanges(created.id)
    reviewChange(created.id, session(created.id).changes[1].path, 'rejected')
    expect(applyChanges(created.id).status).toBe('approved')

    const prRun = openPullRequest(created.id)
    await vi.advanceTimersByTimeAsync(10_000)
    const approval = db.find('approvals', (a) => a.runId === prRun.id && a.status === 'pending')
    expect(approval).toMatchObject({ capability: 'repo.pull_request', risk: 'high', preview: { kind: 'text' } })
    expect(approval?.preview?.content).toContain('Simulated pull request')
    await drive()
    const withPr = session(created.id)
    expect(withPr.pr).toMatchObject({ status: 'open', simulated: true, title: created.title })
    expect(() => openPullRequest(created.id)).toThrow('already open')
    expect(mergePullRequest(created.id)).toMatchObject({ status: 'merged', pr: { status: 'merged' } })
    deleteSession(created.id)
    expect(db.get('sessions', created.id)).toBeUndefined()
  })

  it('reads live GitHub contents for diffs (mocked fetch)', async () => {
    const source = ['export interface Token {', '  value: string', '  expiresAt: number', '}', '', 'export const LEAD_MS = 10_000', ''].join('\n')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/src/auth/token.ts')) return new Response(source)
        return new Response('missing', { status: 404 })
      }),
    )
    db.insert('repos', fx.repo({ id: 'rep_live', provider: 'github', mode: 'live', owner: 'octo', name: 'auth-kit', fullName: 'octo/auth-kit', defaultBranch: 'main', tree: [{ path: 'package.json', type: 'file', size: 300 }, { path: 'src/auth/token.ts', type: 'file', size: source.length }, { path: 'vitest.config.ts', type: 'file', size: 100 }] }))
    const created = createSession({ repoId: 'rep_live', prompt: 'Fix token expiry handling' })
    await drive()
    const done = session(created.id)
    const change = done.changes.find((c) => c.path === 'src/auth/token.ts')
    expect(change?.before).toBe(source)
    expect(change?.after).toContain('export function isTokenExpiring(token: Token, now = Date.now()): boolean')
    expect(change?.after).toContain('return token.expiresAt - LEAD_MS <= now')
    expect(done.changes.find((c) => c.path === 'src/auth/token.test.ts')?.changeType).toBe('added')
    expect(done.status).toBe('needs_review')
    const run = db.get('runs', done.turns[0].runId!)!
    const edit = run.steps.find((s) => s.kind === 'edit')
    expect(edit?.fileChanges?.[0]?.before).toBe(source)
    expect(run.steps.find((s) => s.kind === 'read')?.output).toContain('expiresAt: number')
    expect(done.turns[0].summary).toContain('read live from GitHub')
  })
})

describe('mergeFileChanges', () => {
  it('keeps the original before, takes the newest after and drops reverted files', () => {
    const a = { path: 'a.ts', changeType: 'modified' as const, before: 'x\n', after: 'y\n', additions: 1, deletions: 1, review: 'accepted' as const }
    const merged = mergeFileChanges([a], [{ ...a, before: 'y\n', after: 'z\n', review: 'pending' }])
    expect(merged[0]).toMatchObject({ before: 'x\n', after: 'z\n', additions: 1, deletions: 1, review: 'pending' })
    expect(mergeFileChanges([a], [{ ...a }])[0].review).toBe('accepted')
    expect(mergeFileChanges([a], [{ ...a, before: 'y\n', after: 'x\n' }])).toEqual([])
  })

  it('fails the pull-request plan without accepted changes', () => {
    connectDemoRepo()
    db.insert('sessions', fx.session({ id: 'ses_x', repoId: 'rep_atlas' }))
    expect(planPullRequest({ sessionId: 'ses_x' }, createRng(1)).steps[0].failChance).toBe(1)
  })
})
