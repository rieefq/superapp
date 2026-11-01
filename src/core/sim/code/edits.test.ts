import { describe, expect, it } from 'vitest'
import { DEMO_REPO } from '@/core/seed/demoRepo'
import { createRng } from '@/lib/rng'
import { countLineChanges, realizeTurn, structureTurn } from './design'
import { addDependency, lazyEdit, proposeSourceEdit, type EditContext } from './edits'
import { keywordStems, rankRelevantFiles, relativeImport } from './files'
import { classifyIntent, codeKeywords, impliedPackage } from './intent'
import { generateTest } from './tests'
import { detectToolchain, testCommand, testPathFor } from './toolchain'

function ctx(prompt: string): EditContext {
  const keywords = codeKeywords(prompt)
  return { intent: classifyIntent(prompt), keywords, stems: keywordStems(keywords), prompt, rng: createRng(1) }
}

const SESSION = [
  "import { refresh } from './api'",
  '',
  'export interface Token {',
  '  value: string',
  '  expiresAt: number',
  '}',
  '',
  'export function isExpired(token: Token): boolean {',
  '  return token.expiresAt < Date.now()',
  '}',
  '',
].join('\n')

describe('intent and keywords', () => {
  it('classifies prompts and finds implied dependencies', () => {
    expect(classifyIntent('Fix session expiry after SSO login')).toBe('fix')
    expect(classifyIntent('Fix flaky checkout e2e test')).toBe('test')
    expect(classifyIntent('Add CSV export to the invoice list')).toBe('feature')
    expect(classifyIntent('Reduce dashboard bundle size')).toBe('perf')
    expect(classifyIntent('Refactor the date utilities')).toBe('refactor')
    expect(codeKeywords('Fix session expiry after SSO login')).toEqual(['session', 'expiry', 'SSO', 'login'])
    expect(impliedPackage('Migrate invoices to Stripe Billing')).toEqual({ name: 'stripe', version: '^17.0.0' })
    expect(impliedPackage('npm install left-pad and use it')).toEqual({ name: 'left-pad', version: 'latest' })
    expect(impliedPackage('Fix the login redirect')).toBeNull()
  })
})

describe('edit strategies', () => {
  it('adds an expiry margin to comparisons with Date.now()', () => {
    const edit = proposeSourceEdit({ path: 'src/token.ts', content: SESSION }, ctx('Fix token expiry'))
    expect(edit.strategy).toBe('skew')
    expect(edit.after).toContain('  return token.expiresAt - EXPIRY_SKEW_MS < Date.now()')
    expect(edit.after.split('\n').slice(0, 5)).toEqual([
      "import { refresh } from './api'",
      '',
      '/** Treat sessions as expiring slightly early so they refresh before the identity provider rejects them. */',
      'export const EXPIRY_SKEW_MS = 30_000',
      '',
    ])
    expect(edit.test).toEqual({ kind: 'skew', name: 'EXPIRY_SKEW_MS', value: 30_000 })
  })

  it('guards a missing parameter with a mode that fits the return type', () => {
    const content = ['export function formatName(name: string): string {', '  return name.trim()', '}', '', 'export async function load(id: string) {', '  return fetch(id)', '}'].join('\n')
    const edit = proposeSourceEdit({ path: 'src/name.ts', content }, ctx('Fix crash when name is missing'))
    expect(edit.strategy).toBe('guard')
    expect(edit.after).toContain(["  if (!name) {", "    return ''", '  }'].join('\n'))
    expect(edit.test).toMatchObject({ kind: 'guard', fn: 'formatName', param: 'name', mode: 'return', returnValue: "''" })
  })

  it('names extracted constants from their context', () => {
    const content = ['export function Chart() {', '  return <VolumeChart height={240} />', '}'].join('\n')
    const edit = proposeSourceEdit({ path: 'src/Chart.tsx', content }, ctx('Refactor the chart component'))
    expect(edit.strategy).toBe('constant')
    expect(edit.after).toContain('export const VOLUME_CHART_HEIGHT = 240')
    expect(edit.after).toContain('<VolumeChart height={VOLUME_CHART_HEIGHT} />')
  })

  it('lazy-loads eagerly imported components (default and named imports)', () => {
    const content = ["import { useState } from 'react'", "import { Table } from './Table'", '', 'export function Page() {', '  return <Table />', '}'].join('\n')
    const edit = lazyEdit('src/Page.tsx', content)!
    expect(edit.after).toContain("import { lazy, useState } from 'react'")
    expect(edit.after).toContain("const Table = lazy(() => import('./Table').then((m) => ({ default: m.Table })))")
    expect(edit.after).not.toContain("import { Table } from './Table'")
  })

  it('stabilizes Playwright specs and annotates unsupported languages', () => {
    const spec = ["import { test } from '@playwright/test'", '', "test('pays', async ({ page }) => {", '  await page.waitForTimeout(3000)', '})'].join('\n')
    expect(proposeSourceEdit({ path: 'e2e/pay.spec.ts', content: spec }, ctx('Fix flaky payment e2e test')).after).toContain("await page.waitForLoadState('networkidle')")
    const go = proposeSourceEdit({ path: 'main.go', content: 'package main\n\nfunc main() {}\n' }, ctx('Fix startup crash'))
    expect(go.strategy).toBe('note')
    expect(go.after).toContain('// TODO(startup): Fix startup crash')
  })

  it('adds dependencies to package.json in sorted order', () => {
    const pkg = '{\n  "name": "x",\n  "dependencies": {\n    "react": "^19.0.0",\n    "zod": "^3.0.0"\n  }\n}\n'
    const next = addDependency(pkg, 'stripe', '^17.0.0')!
    expect(next).toBe('{\n  "name": "x",\n  "dependencies": {\n    "react": "^19.0.0",\n    "stripe": "^17.0.0",\n    "zod": "^3.0.0"\n  }\n}\n')
    expect(addDependency(next, 'stripe', '^17.0.0')).toBeNull()
    expect(countLineChanges(pkg, next)).toEqual({ additions: 1, deletions: 0 })
  })
})

describe('generated tests', () => {
  it('produces a passing test and a variant with exactly one wrong assertion', () => {
    const t = generateTest({ target: { kind: 'guard', fn: 'load', param: 'id', mode: 'reject', fragment: 'id is required', arity: 1 }, sourcePath: 'src/api/load.ts', testPath: 'src/api/load.test.ts', runner: 'vitest' })!
    expect(t.content.split('\n').slice(0, 2)).toEqual(["import { describe, expect, it } from 'vitest'", "import { load } from './load'"])
    expect(t.content).toContain('await expect(load(...([] as unknown as Parameters<typeof load>))).rejects.toThrow(/id is required/)')
    expect(countLineChanges(t.brokenContent, t.content)).toEqual({ additions: 1, deletions: 1 })
    expect(t.brokenContent.split('\n')[t.failure.line - 1].slice(t.failure.column - 1)).toMatch(/^toThrow\(/)
  })

  it('extends existing test files and imports from the right path', () => {
    const existing = "import { describe, expect, it } from 'vitest'\nimport { a } from '../src/thing'\n\ndescribe('a', () => {})\n"
    const t = generateTest({ target: { kind: 'constant', name: 'MAX_ITEMS', value: '500' }, sourcePath: 'src/thing.ts', testPath: 'tests/thing.test.ts', runner: 'vitest', existing })!
    expect(t.content).toContain("import { a, MAX_ITEMS } from '../src/thing'")
    expect(t.content).toContain("describe('MAX_ITEMS', () => {")
    expect(relativeImport('src/a/b.test.ts', 'src/c/d.ts')).toBe('../c/d')
  })
})

describe('turn design on the real demo repository', () => {
  const files = DEMO_REPO.files.map((f) => ({ path: f.path, content: f.content }))

  it('detects the toolchain and test conventions', () => {
    const tc = detectToolchain(files, 'atlas-portal')
    expect(tc).toMatchObject({ ecosystem: 'node', runner: 'vitest', pm: 'npm', packageName: 'atlas-portal', lint: 'eslint', typecheckTool: 'tsc' })
    expect(testCommand(tc, 'src/a.test.ts')).toBe('npm test -- src/a.test.ts')
    expect(testCommand(tc, 'e2e/checkout.spec.ts')).toBe('npm run e2e -- e2e/checkout.spec.ts')
    expect(testPathFor('src/auth/session.ts', tc, new Set(files.map((f) => f.path)))).toEqual({ path: 'src/auth/session.test.ts', exists: true })
    expect(rankRelevantFiles(files, ['session', 'expiry'], { max: 1 })[0].path).toBe('src/auth/session.ts')
  })

  it('realizes consistent, deterministic diffs from real contents', () => {
    const prompt = 'Add CSV export to the invoice list'
    const s = structureTurn({ repoName: 'atlas-portal', files, prompt, rng: createRng(9), failChance: 1 })
    const contents = Object.fromEntries(files.map((f) => [f.path, f.content]))
    const r = realizeTurn(s, { repoName: 'atlas-portal', branch: 'atrium/csv', prompt, contents, allPaths: files.map((f) => f.path), live: false })
    expect(r.failed).toBe(true)
    expect(r.finalChanges.map((c) => c.path)).toEqual(['src/components/InvoiceList.tsx', 'src/components/InvoiceList.test.tsx'])
    for (const c of [...r.finalChanges, ...r.editChanges, r.fixChange!]) expect([c.additions, c.deletions]).toEqual(Object.values(countLineChanges(c.before ?? '', c.after ?? '')))
    expect(r.testOutputFirst).toContain('1 failed')
    expect(r.testOutputRerun).toContain('2 passed (2)')
    expect(r.summary).toContain('one failing assertion was fixed along the way')
    const again = realizeTurn(s, { repoName: 'atlas-portal', branch: 'atrium/csv', prompt, contents, allPaths: files.map((f) => f.path), live: false })
    expect(again).toEqual(r)
  })
})
