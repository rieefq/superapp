import type { FileChange, Repo, RepoFile } from '@/core/types'
import { DEMO_REPO } from '../demoRepo'
import { PROJECT, REPO } from '../ids'
import { BUNDLE_PRE_MERGE_EDITS, FLAKY_TEST_EDITS, SSO_FIX_EDITS, STRIPE_MIGRATION_EDITS, STRIPE_TEST_FILE, type FileEdit } from './repoEdits'
import type { Clock } from './time'
import { HOUR } from './time'
import { applyEdits, fileChange, utf8Bytes } from './util'

export function demoFile(path: string): string {
  const file = DEMO_REPO.files.find((f) => f.path === path)
  if (!file) throw new Error(`seed: demo repo has no file ${path}`)
  return file.content
}

/** FileChanges from main → edited versions (before = DEMO_REPO content). */
function editedFrom(edits: Record<string, FileEdit[]>): FileChange[] {
  return Object.entries(edits).map(([path, list]) => {
    const before = demoFile(path)
    return fileChange(path, before, applyEdits(before, list, path))
  })
}

/** FileChanges for work already merged into main: after = DEMO_REPO, before = pre-merge. */
function mergedInto(edits: Record<string, FileEdit[]>): FileChange[] {
  return Object.entries(edits).map(([path, list]) => {
    const after = demoFile(path)
    return fileChange(path, applyEdits(after, list, path), after)
  })
}

export interface SessionChanges {
  /** ses_sso: refresh fix + regression tests. */
  sso: { session: FileChange; tests: FileChange }
  /** ses_stripe (planned by the in-flight run). */
  stripe: { pkg: FileChange; adapter: FileChange; invoices: FileChange; tests: FileChange }
  /** ses_bundle (merged as PR #214). */
  bundle: { routes: FileChange; app: FileChange; dashboard: FileChange; vite: FileChange }
  /** ses_flaky: the web-first assertion. */
  flaky: { spec: FileChange }
}

export function buildSessionChanges(): SessionChanges {
  const [ssoSession, ssoTests] = editedFrom(SSO_FIX_EDITS)
  const [pkg, adapter, invoices] = editedFrom(STRIPE_MIGRATION_EDITS)
  const [routes, app, dashboard, vite] = mergedInto(BUNDLE_PRE_MERGE_EDITS)
  const [spec] = editedFrom(FLAKY_TEST_EDITS)
  if (!ssoSession || !ssoTests || !pkg || !adapter || !invoices || !routes || !app || !dashboard || !vite || !spec) {
    throw new Error('seed: missing session file change')
  }
  return {
    sso: { session: ssoSession, tests: ssoTests },
    stripe: { pkg, adapter, invoices, tests: fileChange('src/billing/stripe.test.ts', undefined, STRIPE_TEST_FILE) },
    bundle: { routes, app, dashboard, vite },
    flaky: { spec },
  }
}

/** File tree: every file plus every ancestor directory, sorted by path. */
export function demoRepoTree(): RepoFile[] {
  const dirs = new Set<string>()
  const files: RepoFile[] = DEMO_REPO.files.map((f) => {
    const parts = f.path.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    return { path: f.path, type: 'file', size: utf8Bytes(f.content) }
  })
  const dirEntries: RepoFile[] = [...dirs].map((path) => ({ path, type: 'dir' }))
  return [...dirEntries, ...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

export function buildRepo(clock: Clock): Repo {
  return {
    id: REPO.atlas,
    provider: 'demo',
    owner: DEMO_REPO.owner,
    name: DEMO_REPO.name,
    fullName: `${DEMO_REPO.owner}/${DEMO_REPO.name}`,
    description: DEMO_REPO.description,
    defaultBranch: DEMO_REPO.defaultBranch,
    language: DEMO_REPO.language,
    mode: 'simulated',
    projectId: PROJECT.atlas,
    tree: demoRepoTree(),
    treeTruncated: false,
    connectedAt: clock.day(40, 10, 12),
    lastSyncedAt: clock.now - 2 * HOUR - 17 * 60_000,
  }
}
