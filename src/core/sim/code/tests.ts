import { escapeRegExp } from '../text'
import { ensureNamedImports, type TestTarget } from './edits'
import { relativeImport } from './files'

/**
 * Generates focused tests for a proposed edit. Each case has a correct version and a
 * "broken" variant with one wrong assertion: on the seeded failure path the coding agent
 * first writes the broken file, sees the (simulated) failure, then fixes the assertion.
 */

export type GeneratedRunner = 'vitest' | 'jest' | 'pytest'

export interface FailureInfo {
  /** First line of the assertion error. */
  message: string
  /** Expected/received block lines. */
  diff: string[]
  /** 1-based location of the failing matcher in the broken file. */
  line: number
  column: number
}

export interface GeneratedTest {
  path: string
  /** Existing content when an existing test file is extended. */
  before?: string
  /** Final, passing content. */
  content: string
  /** The same file with one wrong assertion. */
  brokenContent: string
  suite: string
  /** Names of the test cases this change adds. */
  cases: string[]
  failingCase: string
  failure: FailureInfo
  fixDescription: string
}

interface CaseSpec {
  name: string
  body: string[]
  async?: boolean
}

interface Plan {
  suite: string
  symbols: string[]
  cases: CaseSpec[]
  needsMock: boolean
  /** [case index, body line index, broken line]. */
  broken: [number, number, string]
  failure: Omit<FailureInfo, 'line' | 'column'>
  /** Matcher name the caret points at (e.g. "toThrow"). */
  matcher: string
  fixDescription: string
}

const CALL_EMPTY = (fn: string) => `${fn}(...([] as unknown as Parameters<typeof ${fn}>))`

const WRONG: Record<string, string> = { false: 'true', true: 'false', "''": "'unknown'", '0': '-1', null: 'undefined', undefined: 'null' }

function display(literal: string): string {
  return literal === "''" ? "''" : literal
}

/** Readable form of a literal for test names ("an empty string" rather than ''). */
function spoken(literal: string): string {
  return literal === "''" ? 'an empty string' : literal === '[]' ? 'an empty list' : literal
}

function guardPlan(t: Extract<TestTarget, { kind: 'guard' }>): Plan {
  const frag = escapeRegExp(t.fragment)
  const full = `${t.fn}: ${t.fragment}`
  if (t.mode === 'return') {
    const rv = t.returnValue ?? 'undefined'
    if (rv === '[]') {
      return {
        suite: t.fn,
        symbols: [t.fn],
        cases: [{ name: `returns an empty list when ${t.param} is missing`, body: [`expect(${CALL_EMPTY(t.fn)}).toEqual([])`] }],
        needsMock: false,
        broken: [0, 0, `expect(${CALL_EMPTY(t.fn)}).toHaveLength(1)`],
        failure: { message: 'AssertionError: expected [] to have a length of 1 but got +0', diff: ['- Expected', '+ Received', '', '- 1', '+ 0'] },
        matcher: 'toHaveLength',
        fixDescription: 'Expect an empty list, which is what the guard returns',
      }
    }
    const wrong = WRONG[rv] ?? 'null'
    return {
      suite: t.fn,
      symbols: [t.fn],
      cases: [{ name: `returns ${spoken(rv)} when ${t.param} is missing`, body: [`expect(${CALL_EMPTY(t.fn)}).toBe(${rv})`] }],
      needsMock: false,
      broken: [0, 0, `expect(${CALL_EMPTY(t.fn)}).toBe(${wrong})`],
      failure: {
        message: `AssertionError: expected ${display(rv)} to be ${display(wrong)} // Object.is equality`,
        diff: ['- Expected', '+ Received', '', `- ${display(wrong)}`, `+ ${display(rv)}`],
      },
      matcher: 'toBe',
      fixDescription: `Expect \`${display(rv)}\`, the guard's early return value`,
    }
  }
  if (t.mode === 'reject') {
    return {
      suite: t.fn,
      symbols: [t.fn],
      cases: [{ name: `rejects a missing ${t.param}`, async: true, body: [`await expect(${CALL_EMPTY(t.fn)}).rejects.toThrow(/${frag}/)`] }],
      needsMock: false,
      broken: [0, 0, `await expect(${CALL_EMPTY(t.fn)}).rejects.toThrow(/^${frag}$/)`],
      failure: {
        message: `AssertionError: expected [Error: ${full}] to throw error matching /^${frag}$/ but got '${full}'`,
        diff: ['- Expected:', `/^${frag}$/`, '', '+ Received:', `"${full}"`],
      },
      matcher: 'toThrow',
      fixDescription: 'Match the error message by substring — it is prefixed with the function name',
    }
  }
  return {
    suite: t.fn,
    symbols: [t.fn],
    cases: [{ name: `rejects a missing ${t.param}`, body: [`const call = () => ${CALL_EMPTY(t.fn)}`, `expect(call).toThrow(/${frag}/)`] }],
    needsMock: false,
    broken: [0, 1, `expect(call).toThrow(/^${frag}$/)`],
    failure: {
      message: `AssertionError: expected [Function call] to throw error matching /^${frag}$/ but got '${full}'`,
      diff: ['- Expected:', `/^${frag}$/`, '', '+ Received:', `"${full}"`],
    },
    matcher: 'toThrow',
    fixDescription: 'Match the error message by substring — it is prefixed with the function name',
  }
}

function helperPlan(t: Extract<TestTarget, { kind: 'helper' }>, mock: 'vi' | 'jest'): Plan {
  const fn = t.fn
  const calledTimes = (name: string, expected: number, got: number) =>
    mock === 'vi'
      ? { message: `AssertionError: expected "${name}" to be called ${expected} times, but got ${got} times`, diff: [] }
      : { message: `expect(${name}).toHaveBeenCalledTimes(expected)`, diff: [`Expected number of calls: ${expected}`, `Received number of calls: ${got}`] }
  switch (t.helper) {
    case 'toCsv':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          { name: 'quotes values that contain commas or quotes', body: [String.raw`expect(${fn}([{ name: 'Acme, Inc.', note: 'say "hi"' }], ['name', 'note'])).toBe('name,note\n"Acme, Inc.","say ""hi"""')`] },
          { name: 'leaves plain values unquoted', body: [String.raw`expect(${fn}([{ id: 1, city: 'Rotterdam' }], ['id', 'city'])).toBe('id,city\n1,Rotterdam')`] },
        ],
        needsMock: false,
        broken: [0, 0, String.raw`expect(${fn}([{ name: 'Acme, Inc.', note: 'say "hi"' }], ['name', 'note'])).toBe('name,note\nAcme, Inc.,say "hi"')`],
        failure: {
          message: String.raw`AssertionError: expected 'name,note\n"Acme, Inc.","say ""hi"""' to be 'name,note\nAcme, Inc.,say "hi"' // Object.is equality`,
          diff: ['- Expected', '+ Received', '', '  name,note', '- Acme, Inc.,say "hi"', '+ "Acme, Inc.","say ""hi"""'],
        },
        matcher: 'toBe',
        fixDescription: 'Expect RFC 4180 quoting for values with commas and quotes',
      }
    case 'withRetry':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          {
            name: 'retries transient failures before succeeding',
            async: true,
            body: [
              'let calls = 0',
              `const result = await ${fn}(async () => {`,
              '  calls += 1',
              "  if (calls < 3) throw new Error('transient')",
              "  return 'ok'",
              '}, { baseDelayMs: 0 })',
              "expect(result).toBe('ok')",
              'expect(calls).toBe(3)',
            ],
          },
          {
            name: 'gives up after the configured retries',
            async: true,
            body: [`await expect(${fn}(async () => Promise.reject(new Error('down')), { retries: 1, baseDelayMs: 0 })).rejects.toThrow('down')`],
          },
        ],
        needsMock: false,
        broken: [0, 7, 'expect(calls).toBe(2)'],
        failure: { message: 'AssertionError: expected 3 to be 2 // Object.is equality', diff: ['- Expected', '+ Received', '', '- 2', '+ 3'] },
        matcher: 'toBe',
        fixDescription: 'Count the initial attempt plus two retries',
      }
    case 'debounce':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          {
            name: 'calls once for a burst of calls',
            body: [
              `${mock}.useFakeTimers()`,
              `const spy = ${mock}.fn()`,
              `const debounced = ${fn}(spy, 200)`,
              "debounced('a')",
              "debounced('b')",
              `${mock}.advanceTimersByTime(200)`,
              'expect(spy).toHaveBeenCalledTimes(1)',
              "expect(spy).toHaveBeenCalledWith('b')",
              `${mock}.useRealTimers()`,
            ],
          },
        ],
        needsMock: true,
        broken: [0, 6, 'expect(spy).toHaveBeenCalledTimes(2)'],
        failure: calledTimes(mock === 'vi' ? 'vi.fn()' : 'jest.fn()', 2, 1),
        matcher: 'toHaveBeenCalledTimes',
        fixDescription: 'A burst of calls should produce a single trailing call',
      }
    case 'formatCurrency':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          { name: 'formats minor units as dollars by default', body: [`expect(${fn}(123456)).toBe('$1,234.56')`] },
          { name: 'supports other currencies', body: [`expect(${fn}(500, 'EUR', 'en-US')).toBe('€5.00')`] },
        ],
        needsMock: false,
        broken: [0, 0, `expect(${fn}(123456)).toBe('$1234.56')`],
        failure: { message: "AssertionError: expected '$1,234.56' to be '$1234.56' // Object.is equality", diff: ['- Expected', '+ Received', '', '- $1234.56', '+ $1,234.56'] },
        matcher: 'toBe',
        fixDescription: 'Expect grouping separators in the formatted amount',
      }
    case 'isValidEmail':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          { name: 'accepts a normal address', body: [`expect(${fn}('ops@meridian.example')).toBe(true)`] },
          { name: 'rejects malformed input', body: [`expect(${fn}('ops@meridian')).toBe(false)`, `expect(${fn}('not an email')).toBe(false)`] },
        ],
        needsMock: false,
        broken: [1, 0, `expect(${fn}('ops@meridian')).toBe(true)`],
        failure: { message: 'AssertionError: expected false to be true // Object.is equality', diff: ['- Expected', '+ Received', '', '- true', '+ false'] },
        matcher: 'toBe',
        fixDescription: 'An address without a top-level domain is invalid',
      }
    case 'paginate':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          { name: 'returns the requested page', body: [`expect(${fn}([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pageCount: 3 })`] },
          { name: 'clamps out-of-range pages', body: [`expect(${fn}([1, 2, 3], 9, 2).page).toBe(2)`] },
        ],
        needsMock: false,
        broken: [0, 0, `expect(${fn}([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pageCount: 2 })`],
        failure: {
          message: 'AssertionError: expected { items: [ 3, 4 ], page: 2, pageCount: 3 } to deeply equal { items: [ 3, 4 ], page: 2, pageCount: 2 }',
          diff: ['- Expected', '+ Received', '', '  {', '    "items": [', '      3,', '      4,', '    ],', '    "page": 2,', '-   "pageCount": 2,', '+   "pageCount": 3,', '  }'],
        },
        matcher: 'toEqual',
        fixDescription: 'Five items in pages of two make three pages',
      }
    case 'memoizeWithTtl':
      return {
        suite: fn,
        symbols: [fn],
        cases: [
          {
            name: 'reuses results within the TTL',
            body: [`const compute = ${mock}.fn((n: number) => n * 2)`, `const cached = ${fn}(compute, 1_000)`, 'expect(cached(2)).toBe(4)', 'expect(cached(2)).toBe(4)', 'expect(compute).toHaveBeenCalledTimes(1)'],
          },
        ],
        needsMock: true,
        broken: [0, 4, 'expect(compute).toHaveBeenCalledTimes(2)'],
        failure: calledTimes(mock === 'vi' ? 'vi.fn()' : 'jest.fn()', 2, 1),
        matcher: 'toHaveBeenCalledTimes',
        fixDescription: 'The second call within the TTL must hit the cache',
      }
    case 'featureFlag': {
      const key = t.flagKey ?? 'feature'
      return {
        suite: fn,
        symbols: [fn],
        cases: [{ name: `is enabled only when the ${key} flag is on`, body: [`expect(${fn}({ '${key}': true })).toBe(true)`, `expect(${fn}({})).toBe(false)`] }],
        needsMock: false,
        broken: [0, 1, `expect(${fn}({})).toBe(true)`],
        failure: { message: 'AssertionError: expected false to be true // Object.is equality', diff: ['- Expected', '+ Received', '', '- true', '+ false'] },
        matcher: 'toBe',
        fixDescription: 'A missing flag means the feature is off',
      }
    }
  }
}

function tsPlan(target: TestTarget, mock: 'vi' | 'jest'): Plan {
  switch (target.kind) {
    case 'guard':
      return guardPlan(target)
    case 'helper':
      return helperPlan(target, mock)
    case 'skew':
      return {
        suite: target.name,
        symbols: [target.name],
        cases: [{ name: 'refreshes sessions shortly before they expire', body: [`expect(${target.name}).toBeGreaterThan(0)`, `expect(${target.name}).toBeLessThanOrEqual(60_000)`] }],
        needsMock: false,
        broken: [0, 1, `expect(${target.name}).toBeLessThanOrEqual(10_000)`],
        failure: { message: `AssertionError: expected ${target.value} to be less than or equal to 10000`, diff: [] },
        matcher: 'toBeLessThanOrEqual',
        fixDescription: 'Allow a margin of up to a minute — 30 s is intended',
      }
    case 'expiry': {
      const value = (offset: string) => `{ ${target.field}: now + ${offset} } as Parameters<typeof ${target.fn}>[0]`
      return {
        suite: target.fn,
        symbols: [target.fn, target.lead].sort((a, b) => a.localeCompare(b)),
        cases: [
          {
            name: 'treats a token inside the refresh margin as expiring',
            body: ['const now = Date.now()', `expect(${target.fn}(${value(`${target.lead} - 1`)}, now)).toBe(true)`],
          },
          {
            name: 'keeps a token that is comfortably valid',
            body: ['const now = Date.now()', `expect(${target.fn}(${value(`${target.lead} + 60_000`)}, now)).toBe(false)`],
          },
        ],
        needsMock: false,
        broken: [1, 1, `expect(${target.fn}(${value(`${target.lead} + 60_000`)}, now)).toBe(true)`],
        failure: { message: 'AssertionError: expected false to be true // Object.is equality', diff: ['- Expected', '+ Received', '', '- true', '+ false'] },
        matcher: 'toBe',
        fixDescription: 'A token that expires after the margin is still valid',
      }
    }
    case 'constant': {
      const numeric = Number(target.value.replace(/_/g, ''))
      return {
        suite: target.name,
        symbols: [target.name],
        cases: [{ name: 'keeps the previous value', body: [`expect(${target.name}).toBe(${target.value})`] }],
        needsMock: false,
        broken: [0, 0, `expect(${target.name}).toBe(${numeric * 10})`],
        failure: { message: `AssertionError: expected ${numeric} to be ${numeric * 10} // Object.is equality`, diff: ['- Expected', '+ Received', '', `- ${numeric * 10}`, `+ ${numeric}`] },
        matcher: 'toBe',
        fixDescription: 'Expect the value that was previously inlined',
      }
    }
  }
}

function renderCases(cases: readonly CaseSpec[], unit: string, brokenAt?: [number, number, string]): string[] {
  const out: string[] = []
  cases.forEach((c, ci) => {
    if (ci > 0) out.push('')
    out.push(`${unit}it('${c.name.replace(/'/g, "\\'")}', ${c.async ? 'async ' : ''}() => {`)
    c.body.forEach((line, li) => {
      const text = brokenAt && brokenAt[0] === ci && brokenAt[1] === li ? brokenAt[2] : line
      out.push(`${unit}${unit}${text}`)
    })
    out.push(`${unit}})`)
  })
  return out
}

function renderTsFile(plan: Plan, opts: { runner: 'vitest' | 'jest'; importPath: string; existing?: string; broken: boolean }): string {
  const unit = '  '
  const block = [`describe('${plan.suite}', () => {`, ...renderCases(plan.cases, unit, opts.broken ? plan.broken : undefined), '})']
  const vitestNames = ['describe', 'expect', 'it', ...(plan.needsMock ? ['vi'] : [])]
  if (!opts.existing) {
    const head = opts.runner === 'vitest' ? [`import { ${vitestNames.join(', ')} } from 'vitest'`] : []
    return [...head, `import { ${plan.symbols.join(', ')} } from '${opts.importPath}'`, '', ...block, ''].join('\n')
  }
  const lines = opts.existing.replace(/\s+$/, '').split('\n')
  const vitestIdx = lines.findIndex((l) => /^import\s*\{[^}]*\}\s*from\s*['"]vitest['"]/.test(l))
  if (vitestIdx >= 0) lines[vitestIdx] = ensureNamedImports(lines[vitestIdx], vitestNames)
  const sameModule = lines.findIndex((l) => new RegExp(`^import\\s*\\{[^}]*\\}\\s*from\\s*['"]${escapeRegExp(opts.importPath)}['"]`).test(l))
  if (sameModule >= 0) lines[sameModule] = ensureNamedImports(lines[sameModule], plan.symbols)
  else {
    let lastImport = -1
    lines.forEach((l, i) => {
      if (/^import\s/.test(l)) lastImport = i
    })
    lines.splice(lastImport + 1, 0, `import { ${plan.symbols.join(', ')} } from '${opts.importPath}'`)
  }
  return [...lines, '', ...block, ''].join('\n')
}

function locate(content: string, brokenLine: string, matcher: string): { line: number; column: number } {
  const lines = content.split('\n')
  const idx = lines.findIndex((l) => l.includes(brokenLine))
  const text = lines[idx] ?? ''
  const at = text.lastIndexOf(`.${matcher}(`)
  return { line: idx + 1, column: (at >= 0 ? at : text.search(/\S/)) + 2 }
}

function pythonModule(sourcePath: string): string {
  return sourcePath.replace(/^src\//, '').replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.')
}

function pythonTest(target: Extract<TestTarget, { kind: 'guard' }>, sourcePath: string, testPath: string, existing?: string): GeneratedTest {
  const args = Array.from({ length: Math.max(1, target.arity) }, () => 'None').join(', ')
  const name = `test_${target.fn}_requires_${target.param}`
  const render = (match: string) => [
    `def ${name}():`,
    `    with pytest.raises(ValueError, match="${match}"):`,
    `        ${target.fn}(${args})`,
  ]
  const importLine = `from ${pythonModule(sourcePath)} import ${target.fn}`
  const build = (match: string) => {
    if (!existing) return ['import pytest', '', importLine, '', '', ...render(match), ''].join('\n')
    const lines = existing.replace(/\s+$/, '').split('\n')
    if (!lines.some((l) => /^import pytest\b/.test(l))) lines.unshift('import pytest')
    if (!lines.includes(importLine)) {
      let last = -1
      lines.forEach((l, i) => {
        if (/^(import|from)\s/.test(l)) last = i
      })
      lines.splice(last + 1, 0, importLine)
    }
    return [...lines, '', '', ...render(match), ''].join('\n')
  }
  const wrong = `^${target.param} must be provided$`
  const brokenContent = build(wrong)
  const lineIdx = brokenContent.split('\n').findIndex((l) => l.includes(wrong))
  return {
    path: testPath,
    before: existing,
    content: build(target.fragment),
    brokenContent,
    suite: name,
    cases: [name],
    failingCase: name,
    failure: {
      message: 'AssertionError: Regex pattern did not match.',
      diff: [`  Expected regex: '${wrong}'`, `  Actual message: '${target.fragment}'`],
      line: lineIdx + 1,
      column: 5,
    },
    fixDescription: 'Match the actual error message',
  }
}

/** Build the test for a proposed edit, or null when the target cannot be tested this way. */
export function generateTest(input: {
  target: TestTarget
  sourcePath: string
  testPath: string
  runner: GeneratedRunner
  /** Existing test file content, when extending one. */
  existing?: string
}): GeneratedTest | null {
  const { target, sourcePath, testPath, runner, existing } = input
  if (runner === 'pytest') return target.kind === 'guard' ? pythonTest(target, sourcePath, testPath, existing) : null
  const plan = tsPlan(target, runner === 'jest' ? 'jest' : 'vi')
  const importPath = relativeImport(testPath, sourcePath)
  const content = renderTsFile(plan, { runner, importPath, existing, broken: false })
  const brokenContent = renderTsFile(plan, { runner, importPath, existing, broken: true })
  const [ci] = plan.broken
  return {
    path: testPath,
    before: existing,
    content,
    brokenContent,
    suite: plan.suite,
    cases: plan.cases.map((c) => c.name),
    failingCase: plan.cases[ci].name,
    failure: { ...plan.failure, ...locate(brokenContent, plan.broken[2], plan.matcher) },
    fixDescription: plan.fixDescription,
  }
}
