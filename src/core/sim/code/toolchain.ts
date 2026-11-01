import { basename, dirname, isIgnoredPath, isTestPath, stemName, type WorkingFile } from './files'

export type Ecosystem = 'node' | 'python' | 'go' | 'rust' | 'other'
export type TestRunner = 'vitest' | 'jest' | 'pytest' | 'go' | 'cargo' | 'none'
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'go' | 'cargo' | 'none'
export type LintTool = 'eslint' | 'biome' | 'ruff' | 'flake8' | 'golangci' | 'clippy'

/** What the repository appears to use, inferred from file names and (when known) package.json. */
export interface Toolchain {
  ecosystem: Ecosystem
  runner: TestRunner
  pm: PackageManager
  packageName: string
  packageVersion: string
  /** e.g. "3.2.0" from package.json (no range prefix). */
  runnerVersion?: string
  scripts: { test?: string; typecheck?: string; lint?: string }
  hasTsconfig: boolean
  lint: LintTool | null
  typecheckTool: 'tsc' | 'mypy' | 'go vet' | 'cargo check' | null
  /** Existing test files (paths), used for realistic suite output. */
  testFiles: string[]
  /** Dependencies declared in package.json, when known. */
  dependencies: string[]
}

interface PackageJson {
  name?: string
  version?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function parsePackageJson(content: string | undefined): PackageJson | null {
  if (!content) return null
  try {
    const parsed: unknown = JSON.parse(content)
    return parsed && typeof parsed === 'object' ? (parsed as PackageJson) : null
  } catch {
    return null
  }
}

export function detectToolchain(files: readonly WorkingFile[], repoName: string): Toolchain {
  const paths = new Set(files.map((f) => f.path))
  const has = (re: RegExp) => files.some((f) => re.test(f.path))
  const pkgFile = files.find((f) => f.path === 'package.json')
  const pkg = parsePackageJson(pkgFile?.content)
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) }
  const testFiles = files.map((f) => f.path).filter((p) => isTestPath(p) && !isIgnoredPath(p) && !p.endsWith('/'))

  let ecosystem: Ecosystem = 'other'
  if (pkgFile || has(/\.(tsx?|jsx?|mjs|cjs)$/)) ecosystem = 'node'
  if (paths.has('go.mod')) ecosystem = 'go'
  else if (paths.has('Cargo.toml')) ecosystem = 'rust'
  else if (!pkgFile && (paths.has('pyproject.toml') || paths.has('requirements.txt') || paths.has('setup.py') || has(/\.py$/))) ecosystem = 'python'

  const base: Toolchain = {
    ecosystem,
    runner: 'none',
    pm: 'none',
    packageName: pkg?.name ?? repoName,
    packageVersion: pkg?.version ?? '0.1.0',
    scripts: {},
    hasTsconfig: paths.has('tsconfig.json'),
    lint: null,
    typecheckTool: null,
    testFiles,
    dependencies: Object.keys(deps),
  }

  if (ecosystem === 'node') {
    const pm: PackageManager = paths.has('pnpm-lock.yaml') ? 'pnpm' : paths.has('yarn.lock') ? 'yarn' : paths.has('bun.lockb') || paths.has('bun.lock') ? 'bun' : 'npm'
    const runner: TestRunner =
      'vitest' in deps || has(/(^|\/)vitest\.config\.[cm]?[jt]s$/) || has(/(^|\/)vite\.config\.[cm]?[jt]s$/)
        ? 'vitest'
        : 'jest' in deps || has(/(^|\/)jest\.config\.[cm]?[jt]s$/)
          ? 'jest'
          : 'vitest'
    const version = (runner === 'vitest' ? deps.vitest : deps.jest)?.replace(/^[^\d]*/, '')
    return {
      ...base,
      pm,
      runner,
      runnerVersion: version || undefined,
      scripts: { test: pkg?.scripts?.test, typecheck: pkg?.scripts?.typecheck, lint: pkg?.scripts?.lint },
      lint: has(/(^|\/)(\.eslintrc(\.[a-z]+)?|eslint\.config\.[cm]?[jt]s)$/) || 'eslint' in deps ? 'eslint' : has(/(^|\/)biome\.jsonc?$/) ? 'biome' : null,
      typecheckTool: base.hasTsconfig ? 'tsc' : null,
    }
  }
  if (ecosystem === 'python') {
    return {
      ...base,
      pm: 'pip',
      runner: 'pytest',
      lint: has(/(^|\/)\.?ruff\.toml$/) ? 'ruff' : has(/(^|\/)\.flake8$/) ? 'flake8' : null,
      typecheckTool: has(/(^|\/)mypy\.ini$/) ? 'mypy' : null,
    }
  }
  if (ecosystem === 'go') {
    return { ...base, pm: 'go', runner: 'go', lint: has(/(^|\/)\.golangci\.ya?ml$/) ? 'golangci' : null, typecheckTool: 'go vet' }
  }
  if (ecosystem === 'rust') return { ...base, pm: 'cargo', runner: 'cargo', lint: 'clippy', typecheckTool: 'cargo check' }
  return base
}

function runScript(tc: Toolchain, script: string): string {
  if (tc.pm === 'npm') return `npm run ${script}`
  return `${tc.pm} ${script}`
}

/** Command that runs one test file (or the whole suite). */
export function testCommand(tc: Toolchain, file?: string | null): string {
  switch (tc.runner) {
    case 'pytest':
      return file ? `pytest ${file}` : 'pytest'
    case 'go':
      return file ? `go test ./${dirname(file) || '.'}` : 'go test ./...'
    case 'cargo':
      return 'cargo test'
    case 'none':
      return 'make test'
    default: {
      if (tc.scripts.test === undefined && tc.dependencies.length) {
        return tc.runner === 'jest' ? `npx jest${file ? ` ${file}` : ''}` : `npx vitest run${file ? ` ${file}` : ''}`
      }
      if (tc.pm === 'npm') return file ? `npm test -- ${file}` : 'npm test'
      return file ? `${tc.pm} test ${file}` : `${tc.pm} test`
    }
  }
}

export function installCommand(tc: Toolchain, pkg: string): string {
  switch (tc.pm) {
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return `${tc.pm} add ${pkg}`
    case 'pip':
      return `pip install ${pkg}`
    case 'go':
      return `go get ${pkg}`
    case 'cargo':
      return `cargo add ${pkg}`
    default:
      return `npm install ${pkg}`
  }
}

export function typecheckCommand(tc: Toolchain): string | null {
  if (tc.ecosystem === 'node') {
    if (tc.scripts.typecheck) return runScript(tc, 'typecheck')
    return tc.hasTsconfig ? 'npx tsc --noEmit' : null
  }
  if (tc.typecheckTool === 'mypy') return 'mypy .'
  if (tc.typecheckTool === 'go vet') return 'go vet ./...'
  if (tc.typecheckTool === 'cargo check') return 'cargo check'
  return null
}

export function lintCommand(tc: Toolchain, files: readonly string[]): string | null {
  const list = files.join(' ')
  if (tc.ecosystem === 'node') {
    if (tc.scripts.lint) return runScript(tc, 'lint')
    if (tc.lint === 'eslint') return `npx eslint ${list}`
    if (tc.lint === 'biome') return `npx biome check ${list}`
    return null
  }
  if (tc.lint === 'ruff') return `ruff check ${list}`
  if (tc.lint === 'flake8') return `flake8 ${list}`
  if (tc.lint === 'golangci') return 'golangci-lint run'
  if (tc.lint === 'clippy') return 'cargo clippy'
  return null
}

/**
 * Where a test for `sourcePath` lives (or would live): an existing matching test file when
 * there is one, otherwise the repository's convention (sibling `x.test.ts`, `__tests__/`, `tests/test_x.py`…).
 */
export function testPathFor(sourcePath: string, tc: Toolchain, existing: ReadonlySet<string>): { path: string; exists: boolean } | null {
  const dir = dirname(sourcePath)
  const name = stemName(sourcePath)
  const join = (...parts: string[]) => parts.filter(Boolean).join('/')
  if (tc.ecosystem === 'node') {
    const ext = basename(sourcePath).match(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/)?.[1] ?? 'ts'
    const candidates = [
      join(dir, `${name}.test.${ext}`),
      join(dir, `${name}.spec.${ext}`),
      join(dir, '__tests__', `${name}.test.${ext}`),
      join(dir, '__tests__', `${name}.spec.${ext}`),
      join('tests', `${name}.test.${ext}`),
      join('test', `${name}.test.${ext}`),
    ]
    const found = candidates.find((c) => existing.has(c))
    if (found) return { path: found, exists: true }
    const usesDunder = tc.testFiles.filter((p) => p.includes('__tests__/')).length > tc.testFiles.length / 2
    return { path: usesDunder ? candidates[2] : candidates[0], exists: false }
  }
  if (tc.ecosystem === 'python') {
    const candidates = [join('tests', `test_${name}.py`), join(dir, `test_${name}.py`), join(dir, 'tests', `test_${name}.py`)]
    const found = candidates.find((c) => existing.has(c))
    return found ? { path: found, exists: true } : { path: candidates[0], exists: false }
  }
  if (tc.ecosystem === 'go') {
    const path = join(dir, `${name}_test.go`)
    return { path, exists: existing.has(path) }
  }
  return null
}
