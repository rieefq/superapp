import type { Rng } from '@/lib/rng'
import type { FailureInfo } from './code/tests'
import type { PackageManager } from './code/toolchain'

/**
 * Generated terminal output for simulated coding sessions. The formats mirror the real
 * tools (vitest, jest, pytest, go test, cargo, npm) closely enough to read naturally,
 * but nothing is executed — callers always label this output as simulated.
 */

export interface CaseResult {
  name: string
  ok: boolean
  ms: number
}

export interface FileResult {
  path: string
  suite?: string
  /** Known test cases; omit for existing files whose test names are unknown (use `count`). */
  cases?: CaseResult[]
  count?: number
  ms: number
  failure?: FailureInfo & { caseName: string; content: string }
}

const RULE = '⎯'

function caseCount(f: FileResult): number {
  return f.cases?.length ?? f.count ?? 1
}

function failedCount(f: FileResult): number {
  return f.cases?.filter((c) => !c.ok).length ?? (f.failure ? 1 : 0)
}

/** Source lines around a location with a caret, vitest style. */
export function codeFrame(content: string, line: number, column: number): string[] {
  const lines = content.split('\n')
  const out: string[] = []
  for (let n = Math.max(1, line - 2); n <= Math.min(lines.length, line + 2); n++) {
    const text = lines[n - 1] ?? ''
    if (n === line && column > 60) {
      // Keep the caret on screen: show a window of the failing line around the column.
      const start = column - 40
      const window = `…${text.slice(start, start + 70)}${text.length > start + 70 ? '…' : ''}`
      out.push(`${String(n).padStart(7)}| ${window}`, `${' '.repeat(7)}| ${' '.repeat(column - start)}^`)
      continue
    }
    out.push(`${String(n).padStart(7)}| ${text.length > 72 ? `${text.slice(0, 71)}…` : text}`)
    if (n === line) out.push(`${' '.repeat(7)}| ${' '.repeat(Math.max(0, column - 1))}^`)
  }
  return out
}

function percentSplit(rng: Rng, labels: readonly string[]): string {
  const weights = labels.map(() => rng.int(5, 40))
  const sum = weights.reduce((a, b) => a + b, 0)
  return labels.map((l, i) => `${l} ${Math.round((weights[i] / sum) * 100)}%`).join(', ')
}

export function vitestOutput(input: { cwd: string; version?: string; files: readonly FileResult[]; rng: Rng }): string {
  const { files, rng } = input
  const lines = [` RUN  ${input.version ? `v${input.version} ` : ''}${input.cwd}`, '']
  for (const f of files) {
    const n = caseCount(f)
    const failed = failedCount(f)
    if (!failed) {
      lines.push(` ✓ ${f.path} (${n} test${n === 1 ? '' : 's'}) ${f.ms}ms`)
      continue
    }
    lines.push(` ❯ ${f.path} (${n} tests | ${failed} failed) ${f.ms}ms`)
    lines.push(`   ❯ ${f.suite ?? 'suite'} (${n})`)
    for (const c of f.cases ?? []) lines.push(`     ${c.ok ? '✓' : '×'} ${c.name} ${c.ms}ms`)
  }
  const failures = files.filter((f) => f.failure)
  if (failures.length) {
    lines.push('', `${RULE.repeat(7)} Failed Tests ${failures.length} ${RULE.repeat(7)}`, '')
    failures.forEach((f, i) => {
      const fail = f.failure!
      lines.push(` FAIL  ${f.path} > ${f.suite ?? 'suite'} > ${fail.caseName}`, fail.message)
      if (fail.diff.length) lines.push('', ...fail.diff)
      lines.push('', ` ❯ ${f.path}:${fail.line}:${fail.column}`, ...codeFrame(fail.content, fail.line, fail.column), '')
      lines.push(`${RULE.repeat(24)}[${i + 1}/${failures.length}]${RULE}`, '')
    })
  }
  const totalFiles = files.length
  const failedFiles = files.filter((f) => failedCount(f) > 0).length
  const totalTests = files.reduce((a, f) => a + caseCount(f), 0)
  const failedTests = files.reduce((a, f) => a + failedCount(f), 0)
  const passedFiles = totalFiles - failedFiles
  const passedTests = totalTests - failedTests
  const part = (failed: number, passed: number, total: number) =>
    `${failed ? `${failed} failed` : ''}${failed && passed ? ' | ' : ''}${passed ? `${passed} passed` : ''} (${total})`
  const duration = files.reduce((a, f) => a + f.ms, 0) + rng.int(160, 900)
  lines.push(
    '',
    ` Test Files  ${part(failedFiles, passedFiles, totalFiles)}`,
    `      Tests  ${part(failedTests, passedTests, totalTests)}`,
    `   Duration  ${duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`} (${percentSplit(rng, ['transform', 'import', 'tests', 'environment'])})`,
  )
  return lines.join('\n')
}

export function jestOutput(input: { files: readonly FileResult[]; rng: Rng; pattern?: string }): string {
  const { files, rng } = input
  const lines: string[] = []
  for (const f of files) {
    const failed = failedCount(f) > 0
    lines.push(`${failed ? 'FAIL' : 'PASS'} ${f.path}`)
    if (f.cases?.length) {
      lines.push(`  ${f.suite ?? 'suite'}`)
      for (const c of f.cases) lines.push(`    ${c.ok ? '✓' : '✕'} ${c.name} (${c.ms} ms)`)
    }
    if (f.failure) {
      const fail = f.failure
      lines.push('', `  ● ${f.suite ?? 'suite'} › ${fail.caseName}`, '', `    ${fail.message}`)
      if (fail.diff.length) lines.push('', ...fail.diff.map((d) => `    ${d}`))
      lines.push('', ...codeFrame(fail.content, fail.line, fail.column).map((l) => `  ${l}`), '', `      at Object.<anonymous> (${f.path}:${fail.line}:${fail.column})`, '')
    }
  }
  const totalTests = files.reduce((a, f) => a + caseCount(f), 0)
  const failedTests = files.reduce((a, f) => a + failedCount(f), 0)
  const failedSuites = files.filter((f) => failedCount(f) > 0).length
  const count = (failed: number, total: number) => `${failed ? `${failed} failed, ` : ''}${total - failed ? `${total - failed} passed, ` : ''}${total} total`
  lines.push(
    '',
    `Test Suites: ${count(failedSuites, files.length)}`,
    `Tests:       ${count(failedTests, totalTests)}`,
    'Snapshots:   0 total',
    `Time:        ${(rng.int(900, 4200) / 1000).toFixed(3)} s`,
    input.pattern ? `Ran all test suites matching /${input.pattern.replace(/[/.]/g, (c) => `\\${c}`)}/i.` : 'Ran all test suites.',
  )
  return lines.join('\n')
}

function banner(text: string, ch = '='): string {
  const width = 80
  const label = text ? ` ${text} ` : ''
  const left = Math.max(1, Math.floor((width - label.length) / 2))
  return `${ch.repeat(left)}${label}${ch.repeat(Math.max(1, width - left - label.length))}`
}

export function pytestOutput(input: { cwd: string; files: readonly FileResult[]; rng: Rng }): string {
  const { files, rng } = input
  const total = files.reduce((a, f) => a + caseCount(f), 0)
  const failed = files.reduce((a, f) => a + failedCount(f), 0)
  const lines = [banner('test session starts'), 'platform linux -- Python 3.12, pytest-8.3, pluggy-1.5', `rootdir: ${input.cwd}`, `collected ${total} item${total === 1 ? '' : 's'}`, '']
  let done = 0
  for (const f of files) {
    const marks = (f.cases ?? Array.from({ length: caseCount(f) }, () => ({ ok: true }))).map((c) => (c.ok ? '.' : 'F')).join('')
    done += caseCount(f)
    const pct = `[${String(Math.round((done / Math.max(1, total)) * 100)).padStart(3)}%]`
    const head = `${f.path} ${marks}`
    lines.push(`${head}${' '.repeat(Math.max(1, 80 - head.length - pct.length))}${pct}`)
  }
  const failures = files.filter((f) => f.failure)
  if (failures.length) {
    lines.push('', banner('FAILURES'))
    for (const f of failures) {
      const fail = f.failure!
      const src = fail.content.split('\n')
      const defLine = src.findIndex((l) => l.startsWith(`def ${fail.caseName}`))
      lines.push(banner(fail.caseName, '_'), '')
      if (defLine >= 0) lines.push(`    ${src[defLine]}`)
      lines.push(`>   ${src[fail.line - 1] ?? ''}`)
      lines.push(`E       ${fail.message}`, ...fail.diff.map((d) => `E       ${d.trimStart()}`), '', `${f.path}:${fail.line}: AssertionError`)
    }
    lines.push(banner('short test summary info'))
    for (const f of failures) lines.push(`FAILED ${f.path}::${f.failure!.caseName} - ${f.failure!.message}`)
  }
  const secs = (rng.int(40, 900) / 1000).toFixed(2)
  lines.push(banner(`${failed ? `${failed} failed, ` : ''}${total - failed} passed in ${secs}s`))
  return lines.join('\n')
}

/** Playwright list-reporter output for the tests declared in a spec file. */
export function playwrightOutput(input: { path: string; content: string; rng: Rng; project?: string }): string {
  const { rng } = input
  const lines = input.content.split('\n')
  const suite = /test\.describe\(\s*['"`](.+?)['"`]/.exec(input.content)?.[1]
  const tests: Array<{ name: string; line: number; col: number }> = []
  lines.forEach((l, i) => {
    const m = /^(\s*)test\(\s*['"`](.+?)['"`]/.exec(l)
    if (m) tests.push({ name: m[2], line: i + 1, col: m[1].length + 1 })
  })
  if (!tests.length) tests.push({ name: 'spec', line: 1, col: 1 })
  const project = input.project ?? 'chromium'
  let total = 0
  const out = ['', `Running ${tests.length} test${tests.length === 1 ? '' : 's'} using 1 worker`, '']
  tests.forEach((t, i) => {
    const secs = rng.int(600, 4200) / 1000
    total += secs
    out.push(`  ✓  ${i + 1} [${project}] › ${input.path}:${t.line}:${t.col} › ${suite ? `${suite} › ` : ''}${t.name} (${secs.toFixed(1)}s)`)
  })
  out.push('', `  ${tests.length} passed (${(total + rng.int(800, 2400) / 1000).toFixed(1)}s)`)
  return out.join('\n')
}

export function goTestOutput(input: { module: string; packages: readonly string[]; rng: Rng }): string {
  const pkgs = input.packages.length ? input.packages : ['']
  return pkgs.map((p) => `ok  \t${[input.module, p].filter(Boolean).join('/')}\t${(input.rng.int(4, 90) / 1000).toFixed(3)}s`).join('\n')
}

export function cargoTestOutput(input: { crate: string; count: number; rng: Rng }): string {
  const { rng } = input
  return [
    `   Compiling ${input.crate} v0.1.0 (/workspace/${input.crate})`,
    `    Finished \`test\` profile [unoptimized + debuginfo] target(s) in ${(rng.int(900, 6000) / 1000).toFixed(2)}s`,
    `     Running unittests src/lib.rs (target/debug/deps/${input.crate.replace(/-/g, '_')}-${rng.int(0x100000, 0xffffff).toString(16)})`,
    '',
    `running ${input.count} tests`,
    `test result: ok. ${input.count} passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.0${rng.int(1, 9)}s`,
  ].join('\n')
}

/** `git diff --stat` for a set of file changes. */
export function diffStat(changes: ReadonlyArray<{ path: string; additions: number; deletions: number }>): string {
  if (!changes.length) return 'No changes.'
  const width = Math.max(...changes.map((c) => c.path.length))
  const max = Math.max(...changes.map((c) => c.additions + c.deletions), 1)
  const scale = Math.min(1, 40 / max)
  const lines = changes.map((c) => {
    const total = c.additions + c.deletions
    const plus = Math.max(c.additions ? 1 : 0, Math.round(c.additions * scale))
    const minus = Math.max(c.deletions ? 1 : 0, Math.round(c.deletions * scale))
    return ` ${c.path.padEnd(width)} | ${String(total).padStart(3)} ${'+'.repeat(plus)}${'-'.repeat(minus)}`
  })
  const adds = changes.reduce((a, c) => a + c.additions, 0)
  const dels = changes.reduce((a, c) => a + c.deletions, 0)
  const parts = [`${changes.length} file${changes.length === 1 ? '' : 's'} changed`]
  if (adds) parts.push(`${adds} insertion${adds === 1 ? '' : 's'}(+)`)
  if (dels) parts.push(`${dels} deletion${dels === 1 ? '' : 's'}(-)`)
  return [...lines, ` ${parts.join(', ')}`].join('\n')
}

/** The two header lines npm prints before running a package script. */
export function npmScriptHeader(pkg: string, version: string, script: string, command: string): string {
  return ['', `> ${pkg}@${version} ${script}`, `> ${command}`, ''].join('\n')
}

export function installOutput(pm: PackageManager, pkg: string, rng: Rng): string {
  const audited = rng.int(180, 920)
  const seconds = rng.int(2, 9)
  switch (pm) {
    case 'pnpm':
      return [`Packages: +1`, '+', `Progress: resolved ${audited}, reused ${audited - 1}, downloaded 1, added 1, done`, '', 'dependencies:', `+ ${pkg}`, '', `Done in ${seconds}.${rng.int(1, 9)}s`].join('\n')
    case 'yarn':
      return ['[1/4] Resolving packages...', '[2/4] Fetching packages...', '[3/4] Linking dependencies...', '[4/4] Building fresh packages...', 'success Saved 1 new dependency.', 'info Direct dependencies', `└─ ${pkg}`, `Done in ${seconds}.${rng.int(10, 99)}s.`].join('\n')
    case 'bun':
      return [`installed ${pkg}`, '', `1 package installed [${rng.int(300, 1900)}.00ms]`].join('\n')
    case 'pip':
      return [`Collecting ${pkg}`, `  Downloading ${pkg}-py3-none-any.whl`, `Installing collected packages: ${pkg}`, `Successfully installed ${pkg}`].join('\n')
    case 'go':
      return `go: added ${pkg}`
    case 'cargo':
      return [`    Updating crates.io index`, `      Adding ${pkg} to dependencies`].join('\n')
    default:
      return ['', `added 1 package, and audited ${audited} packages in ${seconds}s`, '', `${rng.int(40, 160)} packages are looking for funding`, '  run `npm fund` for details', '', 'found 0 vulnerabilities'].join('\n')
  }
}
