import { describe, expect, it } from 'vitest'
import type { CheckResult, FileChange, RepoFile } from '@/core/types'
import {
  ancestorsOf, buildFileTree, changeStats, checkLabel, checksClause, checksSummary, defaultExpanded, fileInstruction, githubBlobUrl, groupSessions,
  homeGroups, matchesSession, nextPendingIndex, patchFilename, rateLimitText, requestChangesDraft, reviewSentence, sessionGroup, sessionStatusMeta,
  slashInstruction, splitPath, summaryMarkdown,
} from './logic'

const change = (path: string, review?: FileChange['review'], additions = 1, deletions = 0): FileChange => ({
  path, changeType: 'modified', before: 'a\n', after: 'b\n', additions, deletions, ...(review ? { review } : {}),
})

const check = (name: string, status: CheckResult['status']): CheckResult => ({ id: `chk_${name}`, name, status })

describe('sessions', () => {
  it('groups by status: Needs review · Working · Idle · Done, archived apart', () => {
    expect(sessionGroup('needs_review')).toBe('review')
    expect(sessionGroup('working')).toBe('working')
    expect(sessionGroup('idle')).toBe('idle')
    expect(sessionGroup('failed')).toBe('idle')
    expect(sessionGroup('approved')).toBe('done')
    expect(sessionGroup('merged')).toBe('done')
    expect(sessionGroup('archived')).toBe('archived')
    const { groups, archived } = groupSessions([
      { id: 'a', status: 'merged', updatedAt: 1 },
      { id: 'b', status: 'needs_review', updatedAt: 5 },
      { id: 'c', status: 'working', updatedAt: 3 },
      { id: 'd', status: 'needs_review', updatedAt: 9 },
      { id: 'e', status: 'archived', updatedAt: 2 },
    ] as const)
    expect(groups.map((g) => [g.key, g.sessions.map((s) => s.id)])).toEqual([
      ['review', ['d', 'b']],
      ['working', ['c']],
      ['done', ['a']],
    ])
    expect(archived.map((s) => s.id)).toEqual(['e'])
  })

  it('splits Code home into Needs review, Working and a capped Recent', () => {
    const rows = [
      { id: 'r', status: 'needs_review' as const, updatedAt: 1 },
      { id: 'w', status: 'working' as const, updatedAt: 2 },
      ...Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, status: 'merged' as const, updatedAt: 10 + i })),
      { id: 'x', status: 'archived' as const, updatedAt: 99 },
    ]
    const g = homeGroups(rows, 6)
    expect(g.review.map((r) => r.id)).toEqual(['r'])
    expect(g.working.map((r) => r.id)).toEqual(['w'])
    expect(g.recent).toHaveLength(6)
    expect(g.recent[0].id).toBe('d7')
    expect(g.recent.some((r) => r.id === 'x')).toBe(false)
  })

  it('reads a working session from its run: needs you, paused or working', () => {
    expect(sessionStatusMeta('working', 'waiting')).toMatchObject({ shape: 'diamond', tone: 'attn', word: 'Needs you' })
    expect(sessionStatusMeta('working', 'paused')).toMatchObject({ shape: 'bars', word: 'Paused' })
    expect(sessionStatusMeta('working', 'running')).toMatchObject({ shape: 'dot', tone: 'live', live: true, word: 'Working' })
    expect(sessionStatusMeta('needs_review')).toMatchObject({ shape: 'diamond', tone: 'attn', word: 'Needs review', signal: 'attn' })
    expect(sessionStatusMeta('failed')).toMatchObject({ shape: 'cross', tone: 'fail' })
    expect(sessionStatusMeta('merged')).toMatchObject({ shape: 'check', tone: 'done', word: 'Merged' })
    expect(sessionStatusMeta('archived').word).toBe('Archived')
  })

  it('searches title, branch and repository', () => {
    const s = { title: 'Fix session expiry', branch: 'atrium/fix-sso' }
    expect(matchesSession(s, 'atlas-portal', '')).toBe(true)
    expect(matchesSession(s, 'atlas-portal', 'EXPIRY')).toBe(true)
    expect(matchesSession(s, 'atlas-portal', 'fix-sso')).toBe(true)
    expect(matchesSession(s, 'atlas-portal', 'atlas')).toBe(true)
    expect(matchesSession(s, 'atlas-portal', 'stripe')).toBe(false)
  })
})

describe('changes and the review sentence', () => {
  it('counts files, lines and decisions', () => {
    const stats = changeStats([change('a.ts', 'accepted', 10, 2), change('b.ts', 'rejected', 3, 1), change('c.ts', undefined, 5, 0)])
    expect(stats).toEqual({ files: 3, additions: 18, deletions: 3, accepted: 1, rejected: 1, pending: 1 })
    expect(reviewSentence(stats)).toBe('3 files · +18 −3 · 1 accepted · 1 rejected · 1 to review')
    expect(reviewSentence(changeStats([change('a.ts')]))).toBe('1 file · +1 −0')
  })

  it('moves to the next file still to review, wrapping, and stays when none is left', () => {
    const list = [change('a', 'accepted'), change('b', 'accepted'), change('c'), change('d', 'rejected')]
    expect(nextPendingIndex(list, 0)).toBe(2)
    expect(nextPendingIndex(list, 3)).toBe(2)
    expect(nextPendingIndex([change('a', 'accepted'), change('b', 'rejected')], 0)).toBe(0)
  })

  it('starts "Request changes" from the rejected files', () => {
    expect(requestChangesDraft([change('a.ts', 'accepted')])).toBe('')
    expect(requestChangesDraft([change('a.ts', 'rejected')])).toBe('Rework a.ts: ')
    expect(requestChangesDraft([change('a.ts', 'rejected'), change('b.ts', 'rejected')])).toBe('Rework a.ts, b.ts: ')
  })

  it('splits a path into directory and file name', () => {
    expect(splitPath('src/auth/session.ts')).toEqual({ dir: 'src/auth/', base: 'session.ts' })
    expect(splitPath('README.md')).toEqual({ dir: '', base: 'README.md' })
  })
})

describe('checks', () => {
  it('labels checks whatever their casing', () => {
    expect(checkLabel('typecheck')).toBe('Typecheck')
    expect(checkLabel('Typecheck')).toBe('Typecheck')
    expect(checkLabel('unit')).toBe('Unit tests')
    expect(checkLabel('Unit tests')).toBe('Unit tests')
    expect(checkLabel('e2e')).toBe('E2E tests')
    expect(checkLabel('smoke')).toBe('Smoke')
  })

  it('summarizes: skipped checks do not count; running reads as running', () => {
    const s = checksSummary([check('typecheck', 'passed'), check('lint', 'passed'), check('unit', 'failed'), check('e2e', 'skipped')])
    expect(s).toMatchObject({ passed: 2, failed: 1, skipped: 1, total: 3 })
    expect(checksClause(s)).toBe('Checks 2/3 · 1 failed')
    expect(checksClause(checksSummary([check('a', 'passed'), check('b', 'running')]))).toBe('Checks 1/2 · running')
    expect(checksClause(checksSummary([check('a', 'pending'), check('b', 'pending')]))).toBe('Checks running')
    expect(checksClause(checksSummary([]))).toBe('No checks yet')
  })
})

describe('files', () => {
  const files: RepoFile[] = [
    { path: 'src', type: 'dir' },
    { path: 'src/auth/session.ts', type: 'file' },
    { path: 'src/App.tsx', type: 'file' },
    { path: 'README.md', type: 'file' },
    { path: 'e2e', type: 'dir' },
    { path: 'e2e/checkout.spec.ts', type: 'file' },
  ]

  it('builds a nested tree, directories first, creating missing ancestors', () => {
    const tree = buildFileTree(files)
    expect(tree.map((n) => n.id)).toEqual(['e2e', 'src', 'README.md'])
    const src = tree.find((n) => n.id === 'src')!
    expect(src.children?.map((n) => n.id)).toEqual(['src/auth', 'src/App.tsx'])
    expect(src.children?.[0].children?.map((n) => n.label)).toEqual(['session.ts'])
  })

  it('opens code directories and the selected file’s ancestors', () => {
    expect(ancestorsOf('src/auth/session.ts')).toEqual(['src', 'src/auth'])
    expect(defaultExpanded(files, 'src/auth/session.ts')).toEqual(['src', 'e2e', 'src/auth'])
  })

  it('writes instructions, URLs and file names', () => {
    expect(fileInstruction('src/a.ts')).toBe('In src/a.ts: ')
    expect(githubBlobUrl({ url: 'https://github.com/o/r', defaultBranch: 'main' }, 'src/a b.ts')).toBe('https://github.com/o/r/blob/main/src/a%20b.ts')
    expect(githubBlobUrl({ url: undefined, defaultBranch: 'main' }, 'a.ts')).toBeUndefined()
    expect(patchFilename('atrium/fix-sso')).toBe('atrium-fix-sso.patch')
    expect(rateLimitText({ remaining: 52, limit: 60 })).toBe('52/60 requests left this hour')
  })
})

describe('composer and summaries', () => {
  it('turns slash commands into the instruction a turn receives', () => {
    expect(slashInstruction('plan', 'retry policy')).toBe('Plan this without changing code yet: retry policy')
    expect(slashInstruction('test', '')).toBe('Run the tests and fix anything that fails.')
    expect(slashInstruction('review', 'security')).toBe('Review the current changes for security and fix what you find.')
  })

  it('turns simulator bullet lines into a Markdown list and keeps one fact per paragraph', () => {
    const md = summaryMarkdown('Changed 2 files on b:\n• a.ts — guard\n• a.test.ts — 2 tests\nChecks: typecheck passed.\nSimulated run.')
    expect(md).toBe('Changed 2 files on b:\n\n- a.ts — guard\n- a.test.ts — 2 tests\n\nChecks: typecheck passed.\n\nSimulated run.')
    expect(summaryMarkdown('One paragraph only.')).toBe('One paragraph only.')
  })
})
