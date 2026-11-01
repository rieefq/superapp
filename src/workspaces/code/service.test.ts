import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useContextStore } from '@/core/context'
import { db, emptyTables, useDB } from '@/core/db'
import { clearGithubCache } from '@/core/github'
import { __resetEngineForTests, runEngine } from '@/core/runs/engine'
import { checkKey, confirmedPullRequestApprovals, planCodeSession, registerCodeFactories, STALE_CHECK_NOTE } from '@/core/runs/factories/code'
import {
  acceptAllChanges, archiveSession, buildPatch, connectDemoRepo, continueSession, createSession, fileChangePatch, holdRepoFile, mergePullRequest,
  openPullRequest, PR_CONFIRM_NOTE, renameSession, restoredStatus, restoreSession, sessionPatch,
} from '@/core/services/code'
import { fx } from '@/core/services/testFixtures'
import { useSettingsStore } from '@/core/settings'
import { isRunActive, type CodeSession, type IntegrationConnection } from '@/core/types'
import { createRng } from '@/lib/rng'

/** The Code workspace's additions to the code service and the code.session / code.pull_request scripts. */

const NOW = new Date('2026-11-01T10:00:00Z').getTime()
registerCodeFactories()

const connected = (id: string): IntegrationConnection => ({ id, status: 'connected', mode: 'simulated', scopes: [], config: {}, usageCount: 0, connectedAt: NOW })

async function drive(approve = true): Promise<void> {
  for (let round = 0; round < 60; round++) {
    await vi.advanceTimersByTimeAsync(30_000)
    const pending = db.filter('approvals', (a) => a.status === 'pending')
    if (approve) for (const a of pending) runEngine.resolveApproval(a.id, 'approved')
    if ((!approve || !pending.length) && !db.all('runs').some((r) => isRunActive(r.status) && r.status !== 'waiting')) return
  }
}

const session = (id: string): CodeSession => {
  const s = db.get('sessions', id)
  if (!s) throw new Error(`missing session ${id}`)
  return s
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  db.replaceAll(emptyTables())
  useSettingsStore.getState().reset()
  useContextStore.setState({ pinned: [], scopeProjectId: null })
  __resetEngineForTests()
  clearGithubCache()
  db.insert('connections', connected('sandbox'))
  db.insert('connections', connected('github'))
  db.insert('agents', fx.agent({
    id: 'agt_forge', name: 'Forge', role: 'Coding agent', autonomy: 'balanced',
    capabilities: [
      { capability: 'repo.read', mode: 'allow', integrationId: 'github' },
      { capability: 'repo.write', mode: 'allow', integrationId: 'github' },
      { capability: 'repo.pull_request', mode: 'ask', integrationId: 'github' },
      { capability: 'shell.execute', mode: 'ask', integrationId: 'sandbox' },
    ],
  }))
})

afterEach(() => {
  __resetEngineForTests()
  vi.useRealTimers()
})

describe('patches', () => {
  it('writes git-style diffs for modified, added and deleted files', () => {
    const modified = fileChangePatch({ path: 'src/a.ts', changeType: 'modified', before: 'a\nb\n', after: 'a\nc\n', additions: 1, deletions: 1 })
    expect(modified).toBe('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n')
    const added = fileChangePatch({ path: 'n.ts', changeType: 'added', after: 'x\n', additions: 1, deletions: 0 })
    expect(added).toContain('new file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,1 @@\n+x\n')
    const deleted = fileChangePatch({ path: 'd.ts', changeType: 'deleted', before: 'y\n', additions: 0, deletions: 1 })
    expect(deleted).toContain('deleted file mode 100644\n--- a/d.ts\n+++ /dev/null\n')
    expect(buildPatch([])).toBe('')
  })

  it('exports the accepted changes, the proposed ones, or all', async () => {
    connectDemoRepo()
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login' })
    await drive()
    const paths = session(s.id).changes.map((c) => c.path)
    expect(sessionPatch(s.id)).toBe('')
    acceptAllChanges(s.id)
    expect(sessionPatch(s.id).match(/^diff --git /gm)).toHaveLength(paths.length)
    expect(sessionPatch('nope')).toBe('')
  })
})

describe('the linked task follows the session', () => {
  it('moves In progress → Review → Done as the session works, waits and is approved', async () => {
    db.insert('tasks', fx.task({ id: 'tsk_t', projectId: null, status: 'todo' }))
    connectDemoRepo()
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login', taskId: 'tsk_t' })
    expect(db.get('tasks', 'tsk_t')?.status).toBe('in_progress')
    await drive()
    expect(session(s.id).status).toBe('needs_review')
    expect(db.get('tasks', 'tsk_t')?.status).toBe('review')
    acceptAllChanges(s.id)
    openPullRequest(s.id, { confirmed: true })
    await drive(false)
    expect(session(s.id).pr?.status).toBe('open')
    expect(db.get('tasks', 'tsk_t')?.status).toBe('done')
    mergePullRequest(s.id)
    expect(db.get('tasks', 'tsk_t')?.status).toBe('done')
  })

  it('never reopens a done task', async () => {
    db.insert('tasks', fx.task({ id: 'tsk_d', projectId: null, status: 'done' }))
    connectDemoRepo()
    createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list', taskId: 'tsk_d' })
    await drive()
    expect(db.get('tasks', 'tsk_d')?.status).toBe('done')
  })
})

describe('Approve & open PR is one decision', () => {
  it('resolves the confirmed pull request’s approval as yours, “Confirmed in review”, with no card left', async () => {
    connectDemoRepo()
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await drive()
    acceptAllChanges(s.id)
    const run = openPullRequest(s.id, { confirmed: true })
    expect(run.script?.params.confirmed).toBe(true)
    await drive(false)
    const approvals = db.filter('approvals', (a) => a.runId === run.id)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ status: 'approved', capability: 'repo.pull_request', resolution: { note: PR_CONFIRM_NOTE } })
    expect(db.get('runs', run.id)?.status).toBe('succeeded')
    expect(session(s.id)).toMatchObject({ status: 'approved', pr: { status: 'open', simulated: true } })
    expect(confirmedPullRequestApprovals(useDB.getState())).toEqual([])
  })

  it('leaves an unconfirmed pull request waiting for you, and returns the run in flight', async () => {
    connectDemoRepo()
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await drive()
    acceptAllChanges(s.id)
    const run = openPullRequest(s.id)
    expect(openPullRequest(s.id).id).toBe(run.id)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(db.find('approvals', (a) => a.runId === run.id)?.status).toBe('pending')
  })
})

describe('checks across turns', () => {
  it('keys checks by name whatever the casing', () => {
    expect(checkKey('Unit tests')).toBe('unit')
    expect(checkKey('unit')).toBe('unit')
    expect(checkKey('Typecheck')).toBe('typecheck')
    expect(checkKey('e2e')).toBe('e2e')
  })

  it('replaces earlier results of the same check and marks the ones a turn does not run as skipped', async () => {
    connectDemoRepo()
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await drive()
    db.update('sessions', s.id, (cur) => ({
      ...cur,
      checks: [{ id: 'chk_old_tc', name: 'typecheck', status: 'failed' }, { id: 'chk_old_e2e', name: 'e2e', status: 'passed', output: 'ok' }, ...cur.checks.filter((c) => c.name !== 'Typecheck')],
    }))
    continueSession(s.id, 'Document the CSV export helper')
    await drive()
    const checks = session(s.id).checks
    expect(checks.map((c) => [checkKey(c.name), c.status])).toEqual([
      ['typecheck', 'passed'],
      ['lint', 'passed'],
      ['unit', 'passed'],
      ['e2e', 'skipped'],
    ])
    expect(checks.find((c) => c.name === 'e2e')?.output).toBe(STALE_CHECK_NOTE)
  })
})

describe('approval policy', () => {
  it('asks before edits only when the session is Supervised', () => {
    connectDemoRepo()
    db.insert('sessions', fx.session({ id: 'ses_p', repoId: 'rep_atlas', branch: 'atrium/p', agentId: 'agt_forge', turns: [{ id: 'trn_1', prompt: 'Fix session expiry after SSO login', createdAt: NOW }] }))
    const plan = planCodeSession({ sessionId: 'ses_p', turnId: 'trn_1', prompt: 'Fix session expiry after SSO login' }, createRng(4))
    const edit = plan.steps.find((s) => s.kind === 'edit')!
    expect(edit.approval).toMatchObject({ risk: 'low', title: expect.stringMatching(/^Edit src\/auth\/session\.ts/) })
    expect(edit.approval?.preview?.kind).toBe('diff')
    expect(edit.approval?.preview?.content).toMatch(/^diff --git a\/src\/auth\/session\.ts/)
  })

  it('a Supervised session pauses on its first edit; a Balanced one goes straight to the test command', async () => {
    connectDemoRepo()
    const balanced = createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login' })
    const supervised = createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login', autonomy: 'supervised' })
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(5_000)
    const first = (sid: string) => db.filter('approvals', (a) => db.get('runs', a.runId)?.origin?.id === sid)[0]
    expect(first(supervised.id)?.capability).toBe('repo.write')
    expect(first(balanced.id)?.capability).toBe('shell.execute')
  })

  it('records the composer’s context as refs of the plan step', async () => {
    connectDemoRepo()
    db.insert('knowledge', fx.knowledge({ id: 'kno_adr' }))
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Fix session expiry after SSO login', contextRefs: [{ kind: 'knowledge', id: 'kno_adr' }, { kind: 'knowledge', id: 'kno_adr' }] })
    await vi.advanceTimersByTimeAsync(5_000)
    const run = db.get('runs', session(s.id).turns[0].runId!)!
    expect(run.script?.params.context).toEqual([{ kind: 'knowledge', id: 'kno_adr' }])
    expect(run.steps[0]).toMatchObject({ kind: 'plan', refs: [{ kind: 'knowledge', id: 'kno_adr' }] })
  })
})

describe('session lifecycle', () => {
  it('renames, archives read-only and restores to where it was', async () => {
    connectDemoRepo()
    const s = createSession({ repoId: 'rep_atlas', prompt: 'Add CSV export to the invoice list' })
    await drive()
    expect(renameSession(s.id, '  CSV   export  ')?.title).toBe('CSV export')
    archiveSession(s.id)
    expect(session(s.id).status).toBe('archived')
    expect(continueSession(s.id, 'More')).toBeUndefined()
    expect(() => openPullRequest(s.id)).toThrow('archived')
    expect(restoreSession(s.id)?.status).toBe('needs_review')
    expect(restoredStatus({ changes: [], pr: { number: 1, title: 'x', status: 'merged', simulated: true } })).toBe('merged')
    expect(restoredStatus({ changes: [], pr: undefined })).toBe('idle')
  })
})

describe('Hold file', () => {
  it('keeps a Knowledge copy of the file (source: code → repository) and holds it; reuses the copy', async () => {
    connectDemoRepo()
    const item = await holdRepoFile('rep_atlas', 'src/auth/session.ts')
    expect(item).toMatchObject({ kind: 'snippet', title: 'src/auth/session.ts', source: { type: 'code', ref: { kind: 'repo', id: 'rep_atlas' } }, file: { name: 'src/auth/session.ts' } })
    expect(item.content).toMatch(/^```typescript\n/)
    expect(useContextStore.getState().pinned.map((p) => p.ref)).toEqual([{ kind: 'knowledge', id: item.id }])
    const again = await holdRepoFile('rep_atlas', 'src/auth/session.ts')
    expect(again.id).toBe(item.id)
    expect(db.filter('knowledge', (k) => k.source.type === 'code')).toHaveLength(1)
    await expect(holdRepoFile('rep_atlas', 'missing.ts')).rejects.toThrow('File not found')
  })
})
