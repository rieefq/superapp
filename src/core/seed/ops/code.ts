import type { ActorRef, CheckResult, CodeSession, FileChange } from '@/core/types'
import { AGENT, KNOWLEDGE, PROJECT, REPO, SESSION, TASK } from '../ids'
import { demoFile, type SessionChanges } from './repo'
import type { RunSpec } from './runKit'
import { MIN } from './time'
import type { Timeline } from './timeline'
import { lineOf, ref } from './util'

const ME: ActorRef = { type: 'user', id: 'usr_me' }
const forge = { kind: 'code' as const, agentId: AGENT.forge, modelId: 'sim-deep', initiator: ME, projectId: PROJECT.atlas }
const repoRead = { tool: 'repo', capability: 'repo.read' as const, integrationId: 'github' }
const repoWrite = { tool: 'editor', capability: 'repo.write' as const, integrationId: 'github' }
const checksTool = { tool: 'checks', integrationId: 'sandbox' }

export const STRIPE_INFLIGHT_RUN = 'run_seed_ses_stripe'

const BRANCHES = {
  sso: 'atrium/fix-sso-session-expiry',
  stripe: 'atrium/stripe-billing-invoices',
  bundle: 'atrium/dashboard-bundle-size',
  flaky: 'atrium/fix-flaky-checkout-e2e',
} as const

// --- Simulated check output (test counts match the demo repo's real test files) ----------

const UNIT_FILES: [string, number][] = [
  ['src/lib/money.test.ts', 5],
  ['src/lib/date.test.ts', 6],
  ['src/lib/format.test.ts', 6],
  ['src/api/client.test.ts', 4],
  ['src/auth/session.test.ts', 3],
]

export const TYPECHECK_OUTPUT = '$ npm run typecheck\n\n> atlas-portal@2.3.0 typecheck\n> tsc --noEmit\n\nNo type errors.'
export const LINT_OUTPUT = '$ npm run lint\n\n> atlas-portal@2.3.0 lint\n> eslint . --max-warnings 0\n\nNo problems.'

export function unitOutput(files: [string, number][], durationSec: string): string {
  const ms = [4, 21, 9, 15, 13, 11]
  const total = files.reduce((n, [, c]) => n + c, 0)
  const rows = files.map(([path, count], i) => ` ✓ ${path} (${count} tests) ${ms[i % ms.length]}ms`)
  return [
    '$ npm test',
    '',
    ...rows,
    '',
    `  Test Files  ${files.length} passed (${files.length})`,
    `       Tests  ${total} passed (${total})`,
    `    Duration  ${durationSec}s`,
  ].join('\n')
}

/** Unit test files after a change that adds tests to existing files or new test files. */
export function unitFilesWith(extra: Record<string, number>): [string, number][] {
  const files = UNIT_FILES.map(([path, count]): [string, number] => [path, count + (extra[path] ?? 0)])
  for (const [path, count] of Object.entries(extra)) if (!UNIT_FILES.some(([p]) => p === path)) files.push([path, count])
  return files
}

function e2eTitles(spec: string) {
  const at = (name: string) => `e2e/checkout.spec.ts:${lineOf(spec, `test('${name}'`)}:3`
  return {
    total: `${at('shows the monthly total for the selected plan')} › plan upgrade checkout › shows the monthly total for the selected plan`,
    upgrade: `${at('upgrades from Starter to Growth')} › plan upgrade checkout › upgrades from Starter to Growth`,
  }
}

export function e2ePassOutput(spec: string, seconds: [number, number, number]): string {
  const t = e2eTitles(spec)
  return [
    '$ npm run e2e',
    '',
    'Running 2 tests using 2 workers',
    '',
    `  ✓  1 [chromium] › ${t.total} (${seconds[0]}s)`,
    `  ✓  2 [chromium] › ${t.upgrade} (${seconds[1]}s)`,
    '',
    `  2 passed (${seconds[2]}s)`,
  ].join('\n')
}

/** Playwright output of the 20× repeat run where one upgrade attempt sticks on “Processing”. */
function e2eRepeatFailureOutput(spec: string): string {
  const t = e2eTitles(spec)
  const lines = spec.split('\n')
  const assertLine = lineOf(spec, 'toHaveText(/Payment confirmed/')
  const frameLine = (n: number) => {
    const code = lines[n - 1] ?? ''
    return `    ${n === assertLine ? '>' : ' '} ${String(n).padStart(2)} |${code ? ` ${code}` : ''}`
  }
  const caret = `         |${' '.repeat((lines[assertLine - 1] ?? '').indexOf('toHaveText') + 1)}^`
  const frame = [frameLine(assertLine - 2), frameLine(assertLine - 1), frameLine(assertLine), caret, frameLine(assertLine + 1)]
  return [
    '$ npx playwright test e2e/checkout.spec.ts --repeat-each=20',
    '',
    'Running 40 tests using 4 workers',
    '',
    `  ✘  31 [chromium] › ${t.upgrade} (repeat15) (10.6s)`,
    '',
    `  1) [chromium] › ${t.upgrade} (repeat15)`,
    '',
    '    Error: Timed out 10000ms waiting for expect(locator).toHaveText(expected)',
    '',
    "    Locator: getByRole('status')",
    '    Expected pattern: /Payment confirmed/',
    '    Received string:  "Processing payment…"',
    '    Call log:',
    '      - expect.toHaveText with timeout 10000ms',
    "      - waiting for getByRole('status')",
    '        13 × locator resolved to <p role="status" class="checkout-status">Processing payment…</p>',
    '           - unexpected value "Processing payment…"',
    '',
    ...frame,
    '',
    '  1 failed',
    `    [chromium] › ${t.upgrade} (repeat15)`,
    '  39 passed (1.4m)',
  ].join('\n')
}

const BUILD_OUTPUT = [
  '$ npm run build',
  '',
  '> atlas-portal@2.3.0 build',
  '> tsc --noEmit && vite build',
  '',
  'vite v7.1.4 building for production...',
  '✓ 1873 modules transformed.',
  'dist/index.html                         0.62 kB │ gzip:   0.38 kB',
  'dist/assets/index-DmF4kq2Z.css         18.40 kB │ gzip:   4.12 kB',
  'dist/assets/LoginCallback-Dk2Lm9Qa.js   1.94 kB │ gzip:   0.97 kB',
  'dist/assets/Checkout-Bw7tX2pL.js        6.12 kB │ gzip:   2.41 kB',
  'dist/assets/InvoiceList-Cq81TxVe.js     7.85 kB │ gzip:   2.88 kB',
  'dist/assets/Shipments-D3rP0sWm.js       5.07 kB │ gzip:   2.02 kB',
  'dist/assets/Dashboard-C8n1xQwe.js      29.31 kB │ gzip:   9.84 kB',
  'dist/assets/index-Bq3x9TfK.js         318.57 kB │ gzip: 101.18 kB',
  'dist/assets/VolumeChart-B7r2LmPa.js   431.66 kB │ gzip: 139.42 kB',
  '✓ built in 6.82s',
  '',
  'Initial JS for /: 912.40 kB → 347.88 kB (−61.9%). VolumeChart loads after first paint.',
].join('\n')

const check = (id: string, name: string, status: CheckResult['status'], durationMs: number, output: string): CheckResult => ({
  id, name, status, durationMs, output,
})

/** Checks the in-flight Stripe run reports when it completes (set via onSuccessPatches). */
export function stripeChecks(): CheckResult[] {
  const main = demoFile('e2e/checkout.spec.ts')
  return [
    check('chk_seed_stripe_typecheck', 'typecheck', 'passed', 8_900, TYPECHECK_OUTPUT),
    check('chk_seed_stripe_lint', 'lint', 'passed', 6_100, LINT_OUTPUT),
    check('chk_seed_stripe_unit', 'unit', 'passed', 2_300, unitOutput(unitFilesWith({ 'src/billing/stripe.test.ts': 5 }), '2.17')),
    check('chk_seed_stripe_e2e', 'e2e', 'passed', 47_800, e2ePassOutput(main, [1.3, 4.6, 7.4])),
  ]
}

function summaryOf(changes: FileChange[]): string {
  const add = changes.reduce((n, c) => n + c.additions, 0)
  const del = changes.reduce((n, c) => n + c.deletions, 0)
  return `${changes.length} files changed, ${add} insertions(+), ${del} deletions(-)`
}

export function codeRunSpecs(tl: Timeline, changes: SessionChanges): RunSpec[] {
  const mainSpec = demoFile('e2e/checkout.spec.ts')
  const flakySpec = changes.flaky.spec.after ?? mainSpec
  const sessionLines = demoFile('src/auth/session.ts').split('\n').length - 1
  const ssoLines = demoFile('src/auth/sso.ts').split('\n').length - 1
  const invoices = demoFile('src/api/invoices.ts')
  const bundle = [changes.bundle.routes, changes.bundle.app, changes.bundle.dashboard, changes.bundle.vite]
  const prDescription = [
    '## Reduce dashboard bundle size',
    '',
    'The dashboard took 4+ s to become interactive on a mid-range laptop: the entry chunk carried every page plus recharts.',
    '',
    '**Changes**',
    '- Route-level code splitting with `React.lazy` (src/routes.tsx) and a Suspense boundary in the app shell (src/App.tsx)',
    '- The volume chart (recharts + d3) loads after first paint (src/components/Dashboard.tsx)',
    '- `chunkSizeWarningLimit` back to 450 kB so regressions warn again (vite.config.ts)',
    '',
    '**Result** (`vite build`)',
    '| Chunk | Before | After |',
    '| --- | --- | --- |',
    '| entry (index) | 912.4 kB | 318.6 kB |',
    '| Dashboard | in entry | 29.3 kB |',
    '| VolumeChart (lazy) | in entry | 431.7 kB |',
    '',
    'Initial JS for the dashboard: 912 kB → 348 kB (−62%). No behavior change; typecheck, lint, unit and e2e pass.',
  ].join('\n')

  return [
    {
      ...forge,
      id: 'run_seed_code_sso_1',
      title: 'Fix session expiry after SSO login',
      status: 'succeeded',
      at: tl.ssoTurn1,
      origin: ref('session', SESSION.sso),
      summary:
        'Root cause: the refresh timer reused the login token’s lifetime (`tokenLifetimeMs`) after every refresh. When the IdP issues shorter tokens on refresh, the session outlived its token and the next API call returned 401. The timer is now scheduled from the expiry of the token we hold, as ADR-012 requires. Typecheck, lint and unit tests pass; a regression test is still missing.',
      steps: [
        {
          kind: 'plan', title: 'Planned the investigation', ms: 3_100, tokens: 2_100,
          output: '1. Read src/auth/session.ts and src/auth/sso.ts\n2. Compare the refresh logic with ADR-012\n3. Reproduce with fake timers: 1 h login token, 15 min refreshed tokens\n4. Fix the scheduling with the smallest possible change',
        },
        { kind: 'read', title: 'Read src/auth/session.ts and src/auth/sso.ts', ...repoRead, output: `session.ts · ${sessionLines} lines\nsso.ts · ${ssoLines} lines`, ms: 2_400, tokens: 6_900 },
        {
          kind: 'read', title: 'Read ADR-012: Session tokens & refresh', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [ref('knowledge', KNOWLEDGE.adrSessions)], ms: 1_600, tokens: 3_200,
        },
        {
          kind: 'think', title: 'Found the cause', ms: 7_800, tokens: 5_600,
          output:
            'startSession() stores tokenLifetimeMs from the login token (3600 s) and scheduleRefresh() keeps using it after every refresh. This IdP issues 900 s tokens on refresh, so after the first refresh the next one is scheduled 59 min out while the token expires after 15. The next API call gets a 401, the client ends the session and the user lands back on SSO, about 75 minutes after login.',
        },
        { kind: 'edit', title: 'Schedule refreshes from the held token’s expiry', ...repoWrite, fileChanges: [changes.sso.session], ms: 4_600, tokens: 4_800 },
        {
          kind: 'test', title: 'Ran checks: typecheck, lint, unit', ...checksTool, ms: 17_300, tokens: 900,
          output: `${TYPECHECK_OUTPUT}\n\n${LINT_OUTPUT}\n\n${unitOutput(UNIT_FILES, '1.94')}`,
        },
      ],
    },
    {
      ...forge,
      id: 'run_seed_code_sso_2',
      title: 'Add regression tests for the SSO refresh fix',
      status: 'succeeded',
      at: tl.ssoTurn2,
      origin: ref('session', SESSION.sso),
      summary:
        'Added two regression tests: one pins the next refresh to the refreshed token’s lifetime, the other runs six hours of 15-minute tokens and asserts the session never outlives its token. Both fail on main and pass with the fix. All checks pass; ready for review.',
      steps: [
        { kind: 'read', title: 'Read src/auth/session.test.ts', ...repoRead, ms: 1_500, tokens: 3_800 },
        { kind: 'edit', title: 'Added two regression tests', ...repoWrite, fileChanges: [changes.sso.tests], ms: 5_200, tokens: 6_300 },
        {
          kind: 'test', title: 'Verified the new tests fail without the fix', ...checksTool, ms: 6_400, tokens: 1_200,
          output:
            'Against main:\n × schedules the next refresh from the refreshed token, not the login token\n × never lets the session outlive its access token\n Tests  2 failed | 3 passed (5)\n\nWith the fix:\n Tests  5 passed (5)',
        },
        {
          kind: 'test', title: 'Ran checks: typecheck, lint, unit, e2e', ...checksTool, ms: 64_000, tokens: 1_400,
          output: `${unitOutput(unitFilesWith({ 'src/auth/session.test.ts': 2 }), '2.08')}\n\n${e2ePassOutput(mainSpec, [1.4, 5.2, 7.9])}`,
        },
      ],
    },
    {
      ...forge,
      id: 'run_seed_code_stripe_1',
      title: 'Map legacy invoicing calls for the Stripe migration',
      status: 'succeeded',
      at: tl.stripeTurn1,
      origin: ref('session', SESSION.stripe),
      summary:
        'Three call sites in src/api/invoices.ts move to /v2/billing behind config.flags.stripeBilling. src/billing/stripe.ts already maps invoices, but list, get and send are stubs. Plan: add the stripe package for its types, implement the three calls, add mapping tests. No code changed.',
      steps: [
        {
          kind: 'read', title: 'Read the Stripe Billing migration plan', tool: 'knowledge.search', capability: 'knowledge.read',
          refs: [ref('knowledge', KNOWLEDGE.stripePlan)], ms: 2_100, tokens: 7_400,
        },
        {
          kind: 'search', title: 'Searched the repo for legacy billing calls', tool: 'repo.search', capability: 'repo.read', integrationId: 'github',
          input: 'grep -rn "billing/v1" src', ms: 1_100, tokens: 1_300,
          output: [
            `src/api/invoices.ts:${lineOf(invoices, "/billing/v1/accounts/${accountId}/invoices`, {")}  listInvoices`,
            `src/api/invoices.ts:${lineOf(invoices, '/invoices/${invoiceId}`)')}  getInvoice`,
            `src/api/invoices.ts:${lineOf(invoices, '/resend`')}  resendInvoice`,
          ].join('\n'),
        },
        { kind: 'read', title: 'Read src/api/invoices.ts, src/billing/stripe.ts and src/config.ts', ...repoRead, ms: 2_600, tokens: 6_100 },
        {
          kind: 'write', title: 'Wrote the migration map', ms: 6_900, tokens: 6_800,
          output: [
            '1. listInvoices: GET /billing/v1/accounts/:id/invoices → GET /v2/billing/invoices (cursor becomes starting_after)',
            '2. getInvoice: GET /billing/v1/accounts/:id/invoices/:invoiceId → GET /v2/billing/invoices/:id',
            '3. resendInvoice: POST …/resend → POST /v2/billing/invoices/:id/send',
            'Flag: config.flags.stripeBilling (VITE_FLAG_STRIPE_BILLING); legacy stays the default.',
            'Needs: the official `stripe` package for Stripe.Invoice and ApiList types (will ask before installing).',
            'Risks: lower-case currency codes, drafts without numbers, different cursor semantics.',
          ].join('\n'),
        },
      ],
    },
    {
      ...forge,
      id: 'run_seed_code_bundle_1',
      title: 'Reduce dashboard bundle size',
      status: 'succeeded',
      at: tl.bundleTurn1,
      origin: ref('session', SESSION.bundle),
      summary:
        'Initial JS for the dashboard drops from 912 kB to 348 kB (−62%): routes are lazy chunks and the recharts-based chart loads after first paint. The chunk budget is back to 450 kB so regressions show up as build warnings. All checks pass.',
      steps: [
        {
          kind: 'plan', title: 'Planned a bundle investigation', ms: 2_800, tokens: 1_900,
          output: '1. Find what lands in the entry chunk\n2. Split by route\n3. Defer heavy, below-the-fold dependencies\n4. Compare build output before and after',
        },
        { kind: 'read', title: 'Read src/routes.tsx, src/App.tsx, src/components/Dashboard.tsx and vite.config.ts', ...repoRead, ms: 2_900, tokens: 8_200 },
        {
          kind: 'think', title: 'Found the heavy imports', ms: 6_100, tokens: 5_400,
          output:
            'routes.tsx imports every page eagerly, so the entry chunk carries shipments, billing and checkout. Dashboard.tsx imports VolumeChart directly, pulling recharts + d3 (~430 kB) into first paint. vite.config.ts had raised chunkSizeWarningLimit to 1000 kB, which hid the warning.',
        },
        { kind: 'edit', title: 'Split routes into lazy chunks', ...repoWrite, fileChanges: [changes.bundle.routes, changes.bundle.app], ms: 4_400, tokens: 5_900 },
        { kind: 'edit', title: 'Lazy-load the volume chart', ...repoWrite, fileChanges: [changes.bundle.dashboard], ms: 3_100, tokens: 4_100 },
        { kind: 'edit', title: 'Restore a real chunk budget', ...repoWrite, fileChanges: [changes.bundle.vite], ms: 1_400, tokens: 1_600 },
        { kind: 'test', title: 'Ran checks: typecheck, lint, unit, build', ...checksTool, ms: 31_000, tokens: 1_700, output: BUILD_OUTPUT },
      ],
    },
    {
      ...forge,
      id: 'run_seed_code_bundle_2',
      title: 'Open a pull request for the bundle split',
      status: 'succeeded',
      at: tl.bundleTurn2,
      origin: ref('session', SESSION.bundle),
      summary: 'Opened PR #214 “Reduce dashboard bundle size: lazy-load routes and the volume chart” with the before/after build table (simulated pull request).',
      steps: [
        { kind: 'write', title: 'Wrote the pull request description', output: prDescription, ms: 4_800, tokens: 4_600 },
        {
          kind: 'command', title: `Pushed ${BRANCHES.bundle}`, tool: 'git', capability: 'repo.write', integrationId: 'github',
          input: `git push -u origin ${BRANCHES.bundle}`, output: summaryOf(bundle), ms: 2_100, tokens: 300,
        },
        {
          kind: 'tool', title: 'Opened pull request #214', tool: 'github', capability: 'repo.pull_request', integrationId: 'github',
          output: 'PR #214 opened against main (simulated).', ms: 1_300, tokens: 500,
          approval: {
            title: `Open a pull request from ${BRANCHES.bundle}`,
            description: 'Forge wants to open a pull request on northwind/atlas-portal with the bundle-size change.',
            capability: 'repo.pull_request', risk: 'high', requestedBy: { type: 'agent', id: AGENT.forge },
            preview: { kind: 'text', label: 'northwind/atlas-portal · main ← ' + BRANCHES.bundle, content: prDescription },
            decision: 'approved', note: 'Go ahead.', waitMs: 14 * MIN,
          },
        },
      ],
    },
    {
      ...forge,
      id: 'run_seed_code_flaky_1',
      title: 'Fix flaky checkout e2e test',
      status: 'succeeded',
      at: tl.flakyTurn1,
      origin: ref('session', SESSION.flaky),
      summary:
        'Replaced `waitForTimeout(3000)` and a one-shot `textContent()` read with a web-first `toHaveText` assertion (10 s timeout). The spec passes; I suggest a repeat run before merging.',
      steps: [
        { kind: 'plan', title: 'Planned the fix', ms: 2_300, tokens: 1_600, output: '1. Read the spec and the page it drives\n2. Find what the test waits for\n3. Replace timing assumptions with web-first assertions' },
        { kind: 'read', title: 'Read e2e/checkout.spec.ts and src/pages/Checkout.tsx', ...repoRead, ms: 2_200, tokens: 7_100 },
        {
          kind: 'think', title: 'Found the fixed wait', ms: 5_400, tokens: 4_900,
          output:
            'The test sleeps 3 s, then reads the status once. Confirmation arrives on the second poll (~2 s after confirming) plus request time, which a busy CI runner sometimes pushes past 3 s. textContent() does not retry, so the test fails instead of waiting.',
        },
        { kind: 'edit', title: 'Replaced the fixed wait with a web-first assertion', ...repoWrite, fileChanges: [changes.flaky.spec], ms: 2_600, tokens: 3_300 },
        {
          kind: 'test', title: 'Ran checks: typecheck, lint, unit, e2e', ...checksTool, ms: 59_000, tokens: 1_300,
          output: e2ePassOutput(flakySpec, [1.2, 2.9, 5.1]),
        },
      ],
    },
    {
      ...forge,
      id: 'run_seed_code_flaky_2',
      title: 'Stress-test the checkout spec (20 runs)',
      status: 'failed',
      at: tl.flakyTurn2,
      origin: ref('session', SESSION.flaky),
      error: 'Not fixed: 1 of 20 runs still fails. The root cause is in src/pages/Checkout.tsx (out-of-order poll responses), not in the test.',
      steps: [
        {
          kind: 'command', title: 'Ran the checkout spec 20 times', tool: 'terminal', capability: 'shell.execute', integrationId: 'sandbox',
          input: 'npx playwright test e2e/checkout.spec.ts --repeat-each=20', output: e2eRepeatFailureOutput(flakySpec), ms: 84_000, tokens: 2_600,
          approval: {
            title: 'Run npx playwright test e2e/checkout.spec.ts --repeat-each=20',
            description: 'Forge wants to run the checkout spec 20 times in the session sandbox to confirm the fix holds.',
            capability: 'shell.execute', risk: 'medium', requestedBy: { type: 'agent', id: AGENT.forge },
            preview: { kind: 'command', content: 'npx playwright test e2e/checkout.spec.ts --repeat-each=20', label: 'session sandbox' },
            decision: 'approved', note: 'Sure.', waitMs: 3 * MIN,
          },
        },
        {
          kind: 'read', title: 'Read the trace of the failed run', tool: 'playwright', ms: 3_300, tokens: 5_800,
          output:
            'GET /v1/billing/upgrades/upg_e2e #1 sent at +1.0 s, answered at +2.4 s: processing\nGET /v1/billing/upgrades/upg_e2e #2 sent at +2.0 s, answered at +2.1 s: confirmed (polling stops)\n#1’s late answer then sets the status back to “Processing payment…”.',
        },
        {
          kind: 'think', title: 'Root cause: out-of-order poll responses in Checkout.tsx', ms: 6_200, tokens: 6_300,
          output:
            'setInterval starts a new request every second without cancelling the previous one, and every response calls setStatus. When an older “processing” response lands after “confirmed”, the page shows “Processing payment…” forever because polling has already stopped. A test change cannot fix this: the page must ignore stale responses (sequence number or one AbortController per poll).',
        },
        {
          kind: 'test', title: 'Verify the fix holds', ...checksTool, ms: 900, status: 'failed',
          error: '1 of 20 repeated runs failed. The remaining flake is an app bug in src/pages/Checkout.tsx: a stale poll response overwrites the confirmed status.',
        },
      ],
    },
  ]
}

export function buildSessions(tl: Timeline, changes: SessionChanges, stripeRun: { createdAt: number; pausedAt: number }): CodeSession[] {
  const main = demoFile('e2e/checkout.spec.ts')
  const flakySpec = changes.flaky.spec.after ?? main
  const minutesAfter = (t: number, m: number) => t + m * MIN
  return [
    {
      id: SESSION.sso,
      repoId: REPO.atlas,
      title: 'Fix session expiry after SSO login',
      projectId: PROJECT.atlas,
      taskId: TASK.ssoFix,
      agentId: AGENT.forge,
      branch: BRANCHES.sso,
      baseBranch: 'main',
      status: 'needs_review',
      turns: [
        {
          id: 'trn_seed_sso_1',
          prompt:
            'Meridian Freight’s dispatchers are being signed out about an hour after SSO login, even though their IdP sessions last 12 hours. Find the cause in the session code and fix it. ADR-012 describes how refresh is supposed to work.',
          runId: 'run_seed_code_sso_1',
          summary: 'Found it: the refresh timer reused the login token’s lifetime. Now scheduled from the held token’s expiry.',
          createdAt: tl.ssoTurn1,
        },
        {
          id: 'trn_seed_sso_2',
          prompt: 'Add a regression test that fails without the fix. Include the case where the IdP shortens the token lifetime on refresh, then run e2e too.',
          runId: 'run_seed_code_sso_2',
          summary: 'Two regression tests added; both fail on main and pass with the fix. All checks green.',
          createdAt: tl.ssoTurn2,
        },
      ],
      changes: [changes.sso.session, changes.sso.tests],
      checks: [
        check('chk_seed_sso_typecheck', 'typecheck', 'passed', 8_400, TYPECHECK_OUTPUT),
        check('chk_seed_sso_lint', 'lint', 'passed', 5_900, LINT_OUTPUT),
        check('chk_seed_sso_unit', 'unit', 'passed', 2_100, unitOutput(unitFilesWith({ 'src/auth/session.test.ts': 2 }), '2.08')),
        check('chk_seed_sso_e2e', 'e2e', 'passed', 46_200, e2ePassOutput(main, [1.4, 5.2, 7.9])),
      ],
      createdAt: tl.ssoTurn1 - 40_000,
      updatedAt: minutesAfter(tl.ssoTurn2, 2),
    },
    {
      id: SESSION.stripe,
      repoId: REPO.atlas,
      title: 'Migrate invoices to Stripe Billing',
      projectId: PROJECT.atlas,
      taskId: TASK.stripeMigration,
      agentId: AGENT.forge,
      branch: BRANCHES.stripe,
      baseBranch: 'main',
      status: 'working',
      turns: [
        {
          id: 'trn_seed_stripe_1',
          prompt: 'Read the Stripe Billing migration plan and map every place the portal touches the legacy invoicing API. Don’t change any code yet.',
          runId: 'run_seed_code_stripe_1',
          summary: 'Three call sites in src/api/invoices.ts; the Stripe adapter exists but list, get and send are stubs.',
          createdAt: tl.stripeTurn1,
        },
        {
          id: 'trn_seed_stripe_2',
          prompt:
            'Go ahead with step 1 of the plan: serve invoices from Stripe Billing behind VITE_FLAG_STRIPE_BILLING, keep the legacy path as the default, and add tests for the mapping.',
          runId: STRIPE_INFLIGHT_RUN,
          createdAt: stripeRun.createdAt - 1_200,
        },
      ],
      changes: [],
      checks: [],
      createdAt: tl.stripeTurn1 - 35_000,
      updatedAt: stripeRun.pausedAt,
    },
    {
      id: SESSION.bundle,
      repoId: REPO.atlas,
      title: 'Reduce dashboard bundle size',
      projectId: PROJECT.atlas,
      taskId: TASK.bundleSize,
      agentId: AGENT.forge,
      branch: BRANCHES.bundle,
      baseBranch: 'main',
      status: 'merged',
      turns: [
        {
          id: 'trn_seed_bundle_1',
          prompt: 'The dashboard takes 4+ seconds to become interactive on a mid-range laptop. Find what’s bloating the bundle and cut it, without changing behavior.',
          runId: 'run_seed_code_bundle_1',
          summary: 'Lazy routes and a lazy chart: initial JS 912 kB → 348 kB (−62%).',
          createdAt: tl.bundleTurn1,
        },
        {
          id: 'trn_seed_bundle_2',
          prompt: 'Looks good. Open a PR.',
          runId: 'run_seed_code_bundle_2',
          summary: 'Opened PR #214 with the before/after build table.',
          createdAt: tl.bundleTurn2,
        },
      ],
      changes: [changes.bundle.routes, changes.bundle.app, changes.bundle.dashboard, changes.bundle.vite],
      checks: [
        check('chk_seed_bundle_typecheck', 'typecheck', 'passed', 8_100, TYPECHECK_OUTPUT),
        check('chk_seed_bundle_lint', 'lint', 'passed', 5_600, LINT_OUTPUT),
        check('chk_seed_bundle_unit', 'unit', 'passed', 1_900, unitOutput(UNIT_FILES, '1.94')),
        check('chk_seed_bundle_build', 'build', 'passed', 15_400, BUILD_OUTPUT),
        check('chk_seed_bundle_e2e', 'e2e', 'passed', 44_700, e2ePassOutput(main, [1.2, 4.8, 7.1])),
      ],
      pr: { number: 214, title: 'Reduce dashboard bundle size: lazy-load routes and the volume chart', status: 'merged', simulated: true },
      createdAt: tl.bundleTurn1 - 50_000,
      updatedAt: tl.bundleMerged,
    },
    {
      id: SESSION.flaky,
      repoId: REPO.atlas,
      title: 'Fix flaky checkout e2e test',
      projectId: PROJECT.atlas,
      taskId: TASK.flakyTest,
      agentId: AGENT.forge,
      branch: BRANCHES.flaky,
      baseBranch: 'main',
      status: 'failed',
      turns: [
        {
          id: 'trn_seed_flaky_1',
          prompt: 'The checkout e2e test fails on CI about one run in ten. Find out why and fix it properly: no longer sleeps.',
          runId: 'run_seed_code_flaky_1',
          summary: 'Replaced the fixed 3 s wait with a web-first assertion. Spec passes.',
          createdAt: tl.flakyTurn1,
        },
        {
          id: 'trn_seed_flaky_2',
          prompt: 'Before we merge, run the checkout spec 20 times to make sure it’s really fixed.',
          runId: 'run_seed_code_flaky_2',
          summary: '1 of 20 runs still fails: out-of-order poll responses in Checkout.tsx. Needs an app fix, not a test fix.',
          createdAt: tl.flakyTurn2,
        },
      ],
      changes: [changes.flaky.spec],
      checks: [
        check('chk_seed_flaky_typecheck', 'typecheck', 'passed', 8_300, TYPECHECK_OUTPUT),
        check('chk_seed_flaky_lint', 'lint', 'passed', 5_800, LINT_OUTPUT),
        check('chk_seed_flaky_unit', 'unit', 'passed', 2_000, unitOutput(UNIT_FILES, '1.97')),
        check('chk_seed_flaky_e2e', 'e2e', 'failed', 84_000, e2eRepeatFailureOutput(flakySpec)),
      ],
      createdAt: tl.flakyTurn1 - 45_000,
      updatedAt: minutesAfter(tl.flakyTurn2, 3),
    },
  ]
}
