import { diffLines } from 'diff'
import type { FileChange } from '@/core/types'
import { createRng, type Rng } from '@/lib/rng'
import { capitalize, shorten, titleFromText } from '../text'
import { cargoTestOutput, goTestOutput, installOutput, jestOutput, npmScriptHeader, playwrightOutput, pytestOutput, vitestOutput, type FileResult } from '../terminal'
import { addDependency, lazyEdit, proposeSourceEdit, type SourceEdit } from './edits'
import {
  basename,
  dirname,
  formatExcerpt,
  grepContents,
  grepPattern,
  hasKeywordMatch,
  isCodePath,
  isIgnoredPath,
  isTestPath,
  keywordStems,
  languageFromPath,
  rankRelevantFiles,
  type WorkingFile,
} from './files'
import { classifyIntent, codeKeywords, impliedPackage, type CodeIntent, type ImpliedPackage } from './intent'
import { generateTest, type GeneratedTest } from './tests'
import { detectToolchain, installCommand, isE2EPath, lintCommand, testCommand, testPathFor, typecheckCommand, unitTestFiles, type Toolchain } from './toolchain'

/**
 * A coding-agent turn, designed in two phases:
 * 1. `structureTurn` decides what the agent will do from the file tree (works before any
 *    file content is known, e.g. for live GitHub repositories),
 * 2. `realizeTurn` produces the actual diffs, tests and terminal output from real contents.
 * Both are deterministic for the same inputs and seed.
 */

export interface TurnStructure {
  intent: CodeIntent
  keywords: string[]
  stems: string[]
  toolchain: Toolchain
  /** File the agent modifies (a test file for test-stabilization prompts). */
  primary: string | null
  /** 2–5 real files the agent reads, primary first. */
  readPaths: string[]
  /** Whether any file matched the prompt's keywords (otherwise the agent starts from likely entry points). */
  directMatch: boolean
  search: { input: string; output: string; paths: string[] }
  test: { path: string; exists: boolean } | null
  /** Dependency to install, when the prompt implies one that is not declared yet. */
  pkg: ImpliedPackage | null
  /** Seeded: the first test run fails and the agent fixes an assertion. */
  failFirst: boolean
  editSeed: number
  planText: string
}

export interface StructureInput {
  repoName: string
  files: readonly WorkingFile[]
  prompt: string
  rng: Rng
  /** Probability that the first test run fails (default 0.2). */
  failChance?: number
  /** Search file paths only (live repositories: contents are fetched later). */
  pathOnly?: boolean
}

const INTENT_STEP: Record<CodeIntent, (primary: string, pkg: ImpliedPackage | null) => string> = {
  fix: (p) => `Make the smallest change in ${p} that addresses the problem`,
  feature: (p) => `Implement the new behavior in ${p}`,
  refactor: (p) => `Refactor ${p} without changing its behavior`,
  perf: (p) => `Find what ${p} and its neighbours load eagerly, and defer it`,
  docs: (p) => `Document the behavior in ${p}`,
  deps: (p, pkg) => (pkg ? `Add ${pkg.name} and use it from ${p}` : `Update the integration in ${p}`),
  test: (p) => `Stabilize ${p} so it no longer depends on timing`,
}

export function structureTurn(input: StructureInput): TurnStructure {
  const { files, prompt, rng } = input
  const intent = classifyIntent(prompt)
  const keywords = codeKeywords(prompt, 4)
  const stems = keywordStems(keywords)
  const toolchain = detectToolchain(files, input.repoName)
  const paths = new Set(files.map((f) => f.path))
  const usable = files.filter((f) => !isIgnoredPath(f.path) && (f.content !== undefined || f.size === undefined || f.size < 200_000))

  let ranked = intent === 'test' ? rankRelevantFiles(usable, keywords, { max: 4, tests: 'only' }) : []
  if (!ranked.length) ranked = rankRelevantFiles(usable, keywords, { max: 5, tests: 'exclude' })
  if (intent === 'docs' && (!ranked.length || !hasKeywordMatch(ranked[0], keywords))) {
    const readme = files.find((f) => /^readme\.md$/i.test(f.path))
    if (readme) ranked = [readme, ...ranked]
  }
  const primaryFile = ranked[0] ?? null
  const primary = primaryFile?.path ?? null
  const directMatch = !!primaryFile && hasKeywordMatch(primaryFile, keywords)

  // Perf and docs changes only re-run existing tests; other code changes get a focused test.
  const conventional = primary && isCodePath(primary) ? testPathFor(primary, toolchain, paths) : null
  const test = !primary
    ? null
    : intent === 'test' && isTestPath(primary)
      ? { path: primary, exists: true }
      : intent === 'perf' || intent === 'docs'
        ? conventional?.exists
          ? conventional
          : null
        : conventional

  const related = intent === 'test' ? rankRelevantFiles(usable, keywords, { max: 3, tests: 'exclude' }) : []
  const extraReads = [...related, ...ranked.slice(1)].filter((f, i, arr) => f.path !== primary && arr.findIndex((x) => x.path === f.path) === i)
  const readCount = Math.min(rng.int(2, 4), 1 + extraReads.length + (test?.exists && test.path !== primary ? 1 : 0))
  const readPaths = [primary, ...(test?.exists && test.path !== primary ? [test.path] : []), ...extraReads.map((f) => f.path)]
    .filter((p): p is string => !!p)
    .slice(0, Math.max(primary ? 1 : 0, readCount))

  const pattern = grepPattern(keywords.length ? keywords : [basename(primary ?? 'index')])
  const contentKnown = !input.pathOnly && files.some((f) => f.content !== undefined)
  let search: TurnStructure['search']
  if (contentKnown) {
    const matches = grepContents(files.filter((f) => isCodePath(f.path) || /\.md$/i.test(f.path)), pattern.regex, 10)
    search = {
      input: `rg -n -i "${pattern.source}"`,
      output: matches.length ? matches.map((m) => `${m.path}:${m.line}:${m.text}`).join('\n') : `No matches for "${pattern.source}" — starting from likely entry points.`,
      paths: [...new Set(matches.map((m) => m.path))],
    }
  } else {
    const hits = files
      .filter((f) => !isIgnoredPath(f.path) && stems.some((s) => f.path.toLowerCase().includes(s)))
      .slice(0, 12)
      .map((f) => f.path)
    search = {
      input: `git ls-files | rg -i "${pattern.source}"`,
      output: hits.length ? hits.join('\n') : `No paths matched "${pattern.source}" — starting from likely entry points.`,
      paths: hits,
    }
  }

  let pkg = toolchain.ecosystem === 'node' ? impliedPackage(prompt) : null
  if (pkg && toolchain.dependencies.includes(pkg.name)) pkg = null
  const failFirst = rng.chance(input.failChance ?? 0.2)
  const editSeed = rng.int(1, 2_147_483_646)

  const steps: string[] = []
  steps.push(
    directMatch
      ? `Search the codebase for "${pattern.source}" to find where this is handled`
      : `Search for "${pattern.source}"; if nothing matches, start from the main entry points`,
  )
  if (primary) steps.push(`Read ${readPaths.join(', ')}`)
  if (pkg) steps.push(`Install ${pkg.name}`)
  if (primary) steps.push(INTENT_STEP[intent](primary, pkg))
  if (test && intent !== 'test') steps.push(test.exists ? `Extend the tests in ${test.path}` : `Add a focused test in ${test.path}`)
  steps.push(`Run ${testCommand(toolchain, test?.path ?? null)}, then typecheck and lint`)
  steps.push('Summarize the change for review')
  const planText = [`Goal: ${titleFromText(prompt, 120)}`, '', ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n')

  return { intent, keywords, stems, toolchain, primary, readPaths, directMatch, search, test, pkg, failFirst, editSeed, planText }
}

// ---------------------------------------------------------------- realization

export interface CheckOutput {
  name: 'Typecheck' | 'Lint' | 'Unit tests'
  command: string | null
  output: string
  status: 'passed' | 'skipped'
  durationMs: number
}

export interface RealizedTurn {
  edit: SourceEdit | null
  test: GeneratedTest | null
  /** Changes written by the main edit step (the test in its first — possibly wrong — form). */
  editChanges: FileChange[]
  /** package.json change made by the install step. */
  depChange: FileChange | null
  /** Broken → fixed test change on the failure path. */
  fixChange: FileChange | null
  failed: boolean
  readOutputs: Record<string, string>
  testCommand: string
  testOutputFirst: string
  testOutputRerun: string | null
  checks: CheckOutput[]
  /** The turn's net changes (each relative to the content the turn started from). */
  finalChanges: FileChange[]
  summary: string
}

/** Line-accurate additions/deletions between two texts. */
export function countLineChanges(before: string, after: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const part of diffLines(before, after)) {
    if (part.added) additions += part.count ?? 0
    else if (part.removed) deletions += part.count ?? 0
  }
  return { additions, deletions }
}

export function makeFileChange(path: string, before: string | undefined, after: string, changeType?: FileChange['changeType']): FileChange {
  const counts = countLineChanges(before ?? '', after)
  const change: FileChange = {
    path,
    changeType: changeType ?? (before === undefined ? 'added' : 'modified'),
    after,
    additions: counts.additions,
    deletions: counts.deletions,
    review: 'pending',
  }
  if (before !== undefined) change.before = before
  const language = languageFromPath(path)
  if (language) change.language = language
  return change
}

function focusLine(content: string, stems: readonly string[]): number {
  if (!stems.length) return 1
  const re = new RegExp(stems.join('|'), 'i')
  const idx = content.split('\n').findIndex((l) => re.test(l))
  return idx >= 0 ? idx + 1 : 1
}

export interface RealizeInput {
  repoName: string
  branch: string
  prompt: string
  /** Current contents by path (only the files this turn touches are required). */
  contents: Readonly<Record<string, string | undefined>>
  /** Every path in the repository (for realistic suite output). */
  allPaths: readonly string[]
  live: boolean
}

function fileResult(rng: Rng, path: string, cases: Array<{ name: string; ok: boolean }>, suite: string, extraCount: number): FileResult {
  const timed = cases.map((c) => ({ ...c, ms: rng.int(1, 14) }))
  return { path, suite, cases: extraCount ? undefined : timed, count: timed.length + extraCount, ms: timed.reduce((a, c) => a + c.ms, 0) + rng.int(2, 30) }
}

function runnerOutput(tc: Toolchain, files: FileResult[], rng: Rng, repoName: string, pattern?: string): string {
  const cwd = `/workspace/${repoName}`
  switch (tc.runner) {
    case 'jest':
      return jestOutput({ files, rng, pattern })
    case 'pytest':
      return pytestOutput({ cwd, files, rng })
    case 'go':
      return goTestOutput({ module: `example.com/${repoName}`, packages: [...new Set(files.map((f) => dirname(f.path)))], rng })
    case 'cargo':
      return cargoTestOutput({ crate: repoName, count: files.reduce((a, f) => a + (f.cases?.length ?? f.count ?? 1), 0), rng })
    default:
      return vitestOutput({ cwd, version: tc.runnerVersion, files, rng })
  }
}

function checkOutputs(s: TurnStructure, changedPaths: string[], suite: FileResult[], rng: Rng, repoName: string): CheckOutput[] {
  const tc = s.toolchain
  const header = (script: string, command: string) => npmScriptHeader(tc.packageName, tc.packageVersion, script, command)
  const typecheck = typecheckCommand(tc)
  const lint = lintCommand(tc, changedPaths)
  const typecheckOut = !typecheck
    ? 'No type checker is configured for this repository.'
    : /run typecheck|^\w+ typecheck$/.test(typecheck)
      ? header('typecheck', 'tsc --noEmit')
      : typecheck === 'mypy .'
        ? `Success: no issues found in ${rng.int(12, 140)} source files`
        : typecheck === 'cargo check'
          ? `    Checking ${repoName} v0.1.0 (/workspace/${repoName})\n    Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ${(rng.int(500, 4000) / 1000).toFixed(2)}s`
          : ''
  const lintOut = !lint
    ? 'No linter is configured for this repository.'
    : /run lint|^\w+ lint$/.test(lint)
      ? header('lint', tc.lint === 'biome' ? 'biome check .' : 'eslint .')
      : lint.startsWith('ruff')
        ? 'All checks passed!'
        : lint === 'cargo clippy'
          ? `    Checking ${repoName} v0.1.0 (/workspace/${repoName})\n    Finished \`dev\` profile [unoptimized + debuginfo] target(s) in ${(rng.int(500, 4000) / 1000).toFixed(2)}s`
          : ''
  const suiteCommand = testCommand(tc, null)
  return [
    { name: 'Typecheck', command: typecheck, output: typecheckOut, status: typecheck ? 'passed' : 'skipped', durationMs: typecheck ? rng.int(1800, 7200) : 0 },
    { name: 'Lint', command: lint, output: lintOut, status: lint ? 'passed' : 'skipped', durationMs: lint ? rng.int(1200, 5200) : 0 },
    {
      name: 'Unit tests',
      command: suiteCommand,
      output: (tc.runner === 'jest' || tc.runner === 'vitest') && /run|test$/.test(suiteCommand) && tc.scripts.test
        ? `${header('test', tc.scripts.test)}\n${runnerOutput(tc, suite, rng, repoName)}`
        : runnerOutput(tc, suite, rng, repoName),
      status: 'passed',
      durationMs: rng.int(2400, 9800),
    },
  ]
}

export function realizeTurn(s: TurnStructure, input: RealizeInput): RealizedTurn {
  const rng = createRng(s.editSeed)
  const { contents } = input
  const readOutputs: Record<string, string> = {}
  for (const p of s.readPaths) {
    const c = contents[p]
    readOutputs[p] = c === undefined ? `Could not read ${p}.` : `${p} · ${c.split('\n').length} lines\n\n${formatExcerpt(c, { focusLine: focusLine(c, s.stems) })}`
  }

  const primaryContent = s.primary ? contents[s.primary] : undefined
  let edit =
    s.primary && primaryContent !== undefined
      ? proposeSourceEdit({ path: s.primary, content: primaryContent }, { intent: s.intent, keywords: s.keywords, stems: s.stems, prompt: input.prompt, rng })
      : null
  if (s.intent === 'perf' && edit?.strategy !== 'lazy') {
    // Bundle/perf work: prefer deferring an eagerly imported component in one of the files read.
    for (const p of s.readPaths) {
      const c = contents[p]
      const lazy = c !== undefined ? lazyEdit(p, c) : null
      if (lazy) {
        edit = lazy
        break
      }
    }
  }

  const runner = s.toolchain.runner === 'vitest' || s.toolchain.runner === 'jest' || s.toolchain.runner === 'pytest' ? s.toolchain.runner : null
  const test =
    edit?.test && s.test && runner && s.test.path !== s.primary
      ? generateTest({ target: edit.test, sourcePath: edit.path, testPath: s.test.path, runner, existing: s.test.exists ? contents[s.test.path] : undefined })
      : null
  const failed = s.failFirst && !!test

  const editChanges: FileChange[] = []
  const finalChanges: FileChange[] = []
  if (edit) {
    const change = makeFileChange(edit.path, edit.before, edit.after, 'modified')
    editChanges.push(change)
    finalChanges.push(change)
  }
  let fixChange: FileChange | null = null
  if (test) {
    editChanges.push(makeFileChange(test.path, test.before, failed ? test.brokenContent : test.content))
    finalChanges.push(makeFileChange(test.path, test.before, test.content))
    if (failed) fixChange = makeFileChange(test.path, test.brokenContent, test.content, 'modified')
  }
  let depChange: FileChange | null = null
  if (s.pkg && contents['package.json'] !== undefined) {
    const next = addDependency(contents['package.json'], s.pkg.name, s.pkg.version)
    if (next) {
      depChange = makeFileChange('package.json', contents['package.json'], next, 'modified')
      finalChanges.push(depChange)
    }
  }

  // Terminal output for the targeted test run (and the re-run after the fix).
  const testPath = test?.path ?? (s.intent === 'test' ? s.primary : null)
  const cmd = testCommand(s.toolchain, testPath)
  const extraExisting = test?.before ? rng.int(2, 6) : 0
  let first: string
  let rerun: string | null = null
  if (test && runner) {
    const passing = fileResult(rng, test.path, test.cases.map((name) => ({ name, ok: true })), test.suite, extraExisting)
    if (failed) {
      const failing: FileResult = {
        ...fileResult(rng, test.path, test.cases.map((name) => ({ name, ok: name !== test.failingCase })), test.suite, 0),
        count: test.cases.length + extraExisting,
        failure: { ...test.failure, caseName: test.failingCase, content: test.brokenContent },
      }
      first = runnerOutput(s.toolchain, [failing], rng, input.repoName, test.path)
      rerun = runnerOutput(s.toolchain, [passing], rng, input.repoName, test.path)
    } else first = runnerOutput(s.toolchain, [passing], rng, input.repoName, test.path)
  } else if (testPath && isE2EPath(testPath) && s.toolchain.ecosystem === 'node') {
    const specContent = (edit?.path === testPath ? edit.after : contents[testPath]) ?? ''
    first = playwrightOutput({ path: testPath, content: specContent, rng })
  } else {
    const targets = testPath ? [testPath] : unitTestFiles(s.toolchain).slice(0, 3)
    first = runnerOutput(s.toolchain, targets.map((p) => fileResult(rng, p, [], 'suite', rng.int(2, 9))), rng, input.repoName, testPath ?? undefined)
  }

  const others = unitTestFiles(s.toolchain).filter((p) => p !== test?.path).slice(0, 5)
  const suite: FileResult[] = [
    ...others.map((p) => fileResult(rng, p, [], 'suite', rng.int(2, 11))),
    ...(test ? [fileResult(rng, test.path, test.cases.map((name) => ({ name, ok: true })), test.suite, extraExisting)] : []),
  ].sort((a, b) => a.path.localeCompare(b.path))
  const changedPaths = finalChanges.map((c) => c.path)
  const checks = checkOutputs(s, changedPaths, suite.length ? suite : [fileResult(rng, s.primary ?? 'src', [], 'suite', rng.int(3, 9))], rng, input.repoName)

  const adds = finalChanges.reduce((a, c) => a + c.additions, 0)
  const dels = finalChanges.reduce((a, c) => a + c.deletions, 0)
  const lines: string[] = []
  if (finalChanges.length) {
    lines.push(`Changed ${finalChanges.length} file${finalChanges.length === 1 ? '' : 's'} (+${adds} −${dels}) on ${input.branch}:`)
    if (edit) lines.push(`• ${edit.path} — ${edit.description.replace(/`/g, '')}`)
    if (test) lines.push(`• ${test.path} — ${test.before ? 'extended with' : 'new file with'} ${test.cases.length} test${test.cases.length === 1 ? '' : 's'}`)
    if (depChange && s.pkg) lines.push(`• package.json — add ${s.pkg.name}`)
  } else {
    lines.push(s.primary ? `No change could be proposed for ${s.primary}.` : 'No relevant files were found, so no change was proposed.')
  }
  const checkLine = checks.map((c) => `${c.name.toLowerCase()} ${c.status === 'passed' ? 'passed' : 'skipped'}`).join(' · ')
  lines.push(`Checks: ${checkLine}${failed ? ' (one failing assertion was fixed along the way)' : ''}.`)
  if (!s.directMatch && s.primary) lines.push(`Note: nothing matched “${s.keywords.join(', ')}” directly, so the change targets ${s.primary} — double-check it is the right place.`)
  lines.push(
    input.live
      ? 'Simulated run: diffs are based on file contents read live from GitHub; commands and test output were generated — nothing was executed.'
      : 'Simulated run: diffs are based on the demo repository’s real file contents; commands and test output were generated — nothing was executed.',
  )

  return {
    edit,
    test,
    editChanges,
    depChange,
    fixChange,
    failed,
    readOutputs,
    testCommand: cmd,
    testOutputFirst: first,
    testOutputRerun: rerun,
    checks,
    finalChanges,
    summary: lines.join('\n'),
  }
}

/** Paths whose contents `realizeTurn` needs. */
export function pathsToRealize(s: TurnStructure): string[] {
  const out = new Set<string>(s.readPaths)
  if (s.primary) out.add(s.primary)
  if (s.test?.exists) out.add(s.test.path)
  if (s.pkg) out.add('package.json')
  return [...out]
}

/** Short title for an edit step. */
export function editStepTitle(edit: SourceEdit | null, fallbackPath: string | null): string {
  if (edit) return capitalize(shorten(edit.description.replace(/`/g, ''), 80))
  return fallbackPath ? `Edit ${fallbackPath}` : 'Edit files'
}

/** Install command for a structure (null when no dependency is needed). */
export function installCommandFor(s: TurnStructure): string | null {
  return s.pkg ? installCommand(s.toolchain, s.pkg.name) : null
}

export function installOutputFor(s: TurnStructure, rng: Rng): string {
  return s.pkg ? installOutput(s.toolchain.pm, s.pkg.name, rng) : ''
}
