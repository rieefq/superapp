import { describe, expect, it } from 'vitest'
import { createRng } from '@/lib/rng'
import { codeFrame, diffStat, installOutput, jestOutput, npmScriptHeader, playwrightOutput, pytestOutput, vitestOutput } from './terminal'

const testFile = ["import { describe, expect, it } from 'vitest'", '', "describe('isExpired', () => {", "  it('flags past expiry', () => {", '    expect(isExpired({ exp: 0 })).toBe(false)', '  })', '})'].join('\n')

describe('vitestOutput', () => {
  it('mirrors vitest for passing runs', () => {
    const out = vitestOutput({ cwd: '/workspace/app', version: '3.2.4', files: [{ path: 'src/a.test.ts', count: 3, ms: 12 }], rng: createRng(1) })
    expect(out).toMatch(/^ RUN {2}v3\.2\.4 \/workspace\/app\n\n ✓ src\/a\.test\.ts \(3 tests\) 12ms\n\n Test Files {2}1 passed \(1\)\n {6}Tests {2}3 passed \(3\)\n {3}Duration /)
  })

  it('mirrors vitest for a failing assertion, with a code frame', () => {
    const out = vitestOutput({
      cwd: '/workspace/app',
      files: [
        {
          path: 'src/a.test.ts',
          suite: 'isExpired',
          cases: [{ name: 'flags past expiry', ok: false, ms: 4 }, { name: 'other', ok: true, ms: 1 }],
          ms: 19,
          failure: { caseName: 'flags past expiry', message: 'AssertionError: expected true to be false // Object.is equality', diff: ['- Expected', '+ Received', '', '- false', '+ true'], line: 5, column: 35, content: testFile },
        },
      ],
      rng: createRng(2),
    })
    expect(out).toContain(' ❯ src/a.test.ts (2 tests | 1 failed) 19ms\n   ❯ isExpired (2)\n     × flags past expiry 4ms\n     ✓ other 1ms')
    expect(out).toContain('⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯')
    expect(out).toContain(' FAIL  src/a.test.ts > isExpired > flags past expiry\nAssertionError: expected true to be false // Object.is equality')
    expect(out).toContain(' ❯ src/a.test.ts:5:35')
    expect(out).toContain(' Test Files  1 failed (1)\n      Tests  1 failed | 1 passed (2)')
  })
})

describe('code frames and other tools', () => {
  it('points the caret at the column', () => {
    const frame = codeFrame(testFile, 5, 35)
    expect(frame).toContain('      5|     expect(isExpired({ exp: 0 })).toBe(false)')
    expect(frame[frame.indexOf('      5|     expect(isExpired({ exp: 0 })).toBe(false)') + 1]).toBe(`       | ${' '.repeat(34)}^`)
    const long = `${'x'.repeat(100)}.toBe(1)`
    const windowed = codeFrame(long, 1, 102)
    expect(windowed[0].startsWith('      1| …')).toBe(true)
    expect(windowed[1].indexOf('^') - windowed[1].indexOf('|') - 2).toBe(windowed[0].indexOf('.toBe') + 1 - windowed[0].indexOf('|') - 2)
  })

  it('formats diff stats, npm headers and installs', () => {
    expect(diffStat([{ path: 'src/a.ts', additions: 5, deletions: 1 }, { path: 'src/a.test.ts', additions: 12, deletions: 0 }])).toBe(
      [' src/a.ts      |   6 +++++-', ' src/a.test.ts |  12 ++++++++++++', ' 2 files changed, 17 insertions(+), 1 deletion(-)'].join('\n'),
    )
    expect(npmScriptHeader('atlas-portal', '2.3.0', 'typecheck', 'tsc --noEmit')).toBe('\n> atlas-portal@2.3.0 typecheck\n> tsc --noEmit\n')
    expect(installOutput('npm', 'stripe', createRng(1))).toMatch(/added 1 package, and audited \d+ packages in \d+s[\s\S]*found 0 vulnerabilities$/)
    expect(installOutput('pnpm', 'stripe', createRng(1))).toContain('+ stripe')
  })

  it('formats jest, pytest and playwright runs', () => {
    expect(jestOutput({ files: [{ path: 'src/a.test.ts', suite: 's', cases: [{ name: 'works', ok: true, ms: 3 }], ms: 5 }], rng: createRng(1), pattern: 'src/a.test.ts' })).toContain(
      'PASS src/a.test.ts\n  s\n    ✓ works (3 ms)',
    )
    const py = pytestOutput({ cwd: '/workspace/x', files: [{ path: 'tests/test_a.py', count: 2, ms: 3 }], rng: createRng(1) })
    expect(py).toContain('collected 2 items')
    expect(py).toMatch(/tests\/test_a\.py \.\. +\[100%\]/)
    expect(py).toMatch(/=+ 2 passed in \d\.\d\ds =+$/)
    const spec = "test.describe('checkout', () => {\n  test('pays', async () => {})\n})"
    expect(playwrightOutput({ path: 'e2e/c.spec.ts', content: spec, rng: createRng(1) })).toMatch(/✓ {2}1 \[chromium\] › e2e\/c\.spec\.ts:2:3 › checkout › pays \(\d\.\ds\)/)
  })
})
