/**
 * Bundled demo repository (`northwind/atlas-portal`) used for simulated coding sessions,
 * the code explorer and diffs. No network needed. Northwind Labs and Atlas are fictional.
 *
 * A small but coherent React 19 + TypeScript + vitest + Playwright app (the `main` branch).
 * The seeded coding sessions build on realistic problems that are visible in this code:
 * - Sessions follow ADR-012 (15-minute in-memory access token, `atlas_rt` refresh cookie,
 *   refresh at 80%). src/pages/LoginCallback.tsx: the IdP-initiated SAML callback stores tokens
 *   with `session.set()`, which never schedules the refresh, so those users are signed out after
 *   15 minutes (fixed in session `ses_sso` with a single `establishSession()`).
 * - e2e/checkout.spec.ts › pays an open invoice: sleeps 2 s, then clicks Pay with a 1 s timeout.
 *   Pay stays disabled until the outstanding-balance banner loads, and that request only starts
 *   after the invoice request resolves (session `ses_flaky`).
 * - src/api/invoices.ts + src/billing/stripe.ts: the in-house invoicer midway through a migration
 *   to Stripe Billing behind `VITE_FLAG_STRIPE_BILLING` (session `ses_stripe`).
 * - The dashboard bundle split and size budget from session `ses_bundle` (PR #214) are merged here.
 */
export interface DemoRepoFile {
  path: string
  content: string
}

export interface DemoRepo {
  owner: string
  name: string
  defaultBranch: string
  description: string
  language: string
  files: DemoRepoFile[]
}

const file = (path: string, content: string): DemoRepoFile => ({ path, content })

export const DEMO_REPO: DemoRepo = {
  owner: 'northwind',
  name: 'atlas-portal',
  defaultBranch: 'main',
  description: 'Atlas customer portal for freight & logistics teams (demo repository).',
  language: 'TypeScript',
  files: [
    file(
      '.github/workflows/ci.yml',
      `name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    name: Typecheck, lint, unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test -- --reporter=dot
      - run: npm run build
      - name: Bundle size budget
        run: npm run size

  e2e:
    name: Playwright
    runs-on: ubuntu-latest
    needs: checks
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
`,
    ),
    file(
      'README.md',
      `# Atlas portal

The customer portal for **Atlas**, Northwind Labs' shipment visibility platform. Operations
teams at freight forwarders and shippers use it to track shipments across carriers, manage
invoices and change their plan.

## Getting started

\`\`\`bash
npm ci
npm run dev        # http://localhost:5173
\`\`\`

The portal talks to \`portal-api\` (separate repository). Point it at staging with the
variables below in \`.env.local\`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| \`VITE_API_BASE_URL\` | \`https://api.atlas.northwind.example\` | portal-api base URL (also serves \`/auth/*\`) |
| \`VITE_FLAG_STRIPE_BILLING\` | \`false\` | Serve invoices from Stripe Billing (migration in progress) |
| \`VITE_FLAG_BALANCE_BANNER\` | \`true\` | Outstanding-balance banner on checkout |

## Scripts

| Command | What it does |
| --- | --- |
| \`npm run dev\` | Vite dev server with HMR |
| \`npm run build\` | Typecheck, then production build to \`dist/\` |
| \`npm run typecheck\` | \`tsc --noEmit\` |
| \`npm run lint\` | ESLint, zero warnings allowed |
| \`npm test\` | Unit tests (vitest + jsdom) |
| \`npm run e2e\` | Playwright against \`vite preview\` |
| \`npm run size\` | Bundle budget: the entry chunk must stay under 300 kB gzipped |

## Project layout

\`\`\`
src/
  api/          portal-api client (retries, backoff) and resource modules
  auth/         sign-in flows (password, SSO) and the in-memory session (ADR-012)
  billing/      plans and the Stripe Billing adapter
  components/   UI built on @northwind/ui
  hooks/        data and session hooks
  lib/          pure helpers: dates, money, formatting
  pages/        route-level screens
e2e/            Playwright specs (portal-api is mocked)
docs/           architecture notes
\`\`\`

## Testing

- Unit tests live next to the code (\`*.test.ts\`). Pure helpers in \`src/lib\` must stay at 100% branch coverage.
- E2E specs mock every portal-api call with \`page.route\`; they never need a backend.
- **No fixed sleeps.** Use web-first assertions (\`await expect(locator).toHaveText(...)\`) or wait for
  the request you depend on. \`waitForTimeout\` is how flaky tests are born.

## Contributing

- Branch from \`main\` and keep pull requests under ~600 changed lines. The PR review assistant
  asks for a split above that.
- Every bug fix ships with a regression test that fails without the fix.
- Architecture notes and decisions live in [\`docs/ARCHITECTURE.md\`](docs/ARCHITECTURE.md).
  Anything touching tokens or sessions follows ADR-012.

---

_Demo repository bundled with Atrium for simulated coding sessions. Northwind Labs and Atlas are fictional._
`,
    ),
    file(
      'docs/ARCHITECTURE.md',
      `# Architecture

Atlas portal is a single-page React app served as static files. All data comes from
\`portal-api\`, which owns secrets (Stripe keys, carrier credentials) and enforces
per-organization access. The browser never holds a secret.

\`\`\`
 Browser (this repo)                     Northwind backend
 ┌──────────────────────┐  /auth/*       ┌──────────────────┐   SAML / OIDC
 │ auth/sso, session    │ ─────────────▶ │ portal-api       │ ◀──────────▶ customer IdPs
 │ api/client (retries) │ ── Bearer ───▶ │  /v1  /v2/billing│ ──▶ carriers, Postgres
 │ pages, components    │                │                  │ ──▶ Stripe Billing
 └──────────────────────┘                └──────────────────┘
\`\`\`

## Auth and sessions (ADR-012)

- Sign-in paths (\`src/auth/sso.ts\`): password, SP-initiated SSO (starts on our login page)
  and IdP-initiated SSO (starts on the customer's IdP dashboard and lands on
  \`/auth/saml/callback\`). portal-api speaks SAML/OIDC; every path ends with a token set.
- The access token is a 15-minute JWT held **in memory only** (\`src/auth/session.ts\`).
  The refresh token is the \`atlas_rt\` cookie (\`HttpOnly; Secure; SameSite=Lax; Path=/auth/refresh\`).
- The client refreshes silently at ~80% of the access-token lifetime (about 12 minutes),
  and once on the first \`401\` (\`api/client.ts\`). If the refresh fails, the user signs in again.
- **No sign-in path may store tokens without scheduling the refresh** (ADR-012): if the
  scheduler does not run, the user is logged out after 15 minutes.

## API client

\`src/api/client.ts\` wraps \`fetch\`:

- Idempotent requests (\`GET\`, \`PUT\`, \`DELETE\`) are retried up to 3 times on network errors,
  \`408\`, \`429\` and \`5xx\`, with exponential backoff and equal jitter (300 ms, 600 ms, 1.2 s, capped at 8 s).
- \`Retry-After\` wins over the computed backoff.
- \`POST\` and \`PATCH\` are never retried automatically: bookings and upgrades are not idempotent.

## Billing

Invoices are moving from the legacy invoicing service (\`/billing/v1\`, decimal-string amounts)
to **Stripe Billing**, exposed by portal-api under \`/v2/billing\`.

1. \`src/billing/stripe.ts\` maps Stripe objects to the portal's \`Invoice\` type (the in-house
   invoicer's records keep coming from \`/billing/v1\` until cutover).
2. \`src/api/invoices.ts\` picks the source with \`VITE_FLAG_STRIPE_BILLING\`; legacy stays the default.
3. Cut over per customer once totals reconcile for two consecutive billing cycles, then remove
   the legacy path.

Amounts are integer minor units everywhere (\`src/lib/money.ts\`). Never use floats for money.

Checkout (\`src/pages/Checkout.tsx\`) shows the account's outstanding balance above the Pay button
(\`VITE_FLAG_BALANCE_BANNER\`). Pay stays disabled until the balance has loaded, so nobody pays
against a stale amount. The banner's query caused the checkout latency incident; it is backed by
a composite index on \`invoice_events\` now.

## Performance budget

- Route-level code splitting: every page is its own chunk (\`src/routes.tsx\`).
- The dashboard chart (recharts + d3, ~430 kB) is lazy-loaded after first paint.
- CI fails when the entry chunk exceeds 300 kB gzipped (\`npm run size\`, size-limit).
- \`build.chunkSizeWarningLimit\` is 450 kB; a build warning is a regression.
- Target: dashboard interactive in under 2.5 s on a mid-range laptop over fast 4G.

## Testing strategy

| Layer | Tool | Scope |
| --- | --- | --- |
| Unit | vitest + jsdom | \`lib/\`, \`auth/\`, \`api/\`, \`billing/\` |
| E2E | Playwright | sign-in, billing, checkout; portal-api mocked with \`page.route\` |

E2E tests must not depend on timing. Wait for UI state with web-first assertions, never with
fixed timeouts.
`,
    ),
    file(
      'e2e/checkout.spec.ts',
      `import { expect, test, type Page } from '@playwright/test'

const API = 'https://api.atlas.northwind.example'
const TOKENS = {
  accessToken: 'e2e-access',
  expiresIn: 900,
  user: { id: 'usr_e2e', email: 'qa@e2e-logistics.example', orgId: 'org_e2e' },
}
const OPEN_INVOICE = {
  invoice_id: 'inv_e2e_0142',
  invoice_no: 'NW-2025-0142',
  state: 'ISSUED',
  currency: 'USD',
  total: '1890.00',
  balance: '1890.00',
  issue_date: '2025-06-02T00:00:00Z',
  due_date: '2025-07-02T00:00:00Z',
  pdf_link: null,
}

/** Match one portal-api path, ignoring the query string. */
const api = (path: string) => (url: URL) => url.origin === API && url.pathname === path

async function signIn(page: Page) {
  await page.route(api('/auth/password'), (route) => route.fulfill({ json: TOKENS }))
  await page.goto('/login?return_to=/billing')
  await page.getByLabel('Work email').fill('qa@e2e-logistics.example')
  await page.getByLabel('Password').fill('correct horse battery staple')
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test.describe('billing checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(api('/v1/account'), (route) =>
      route.fulfill({ json: { id: 'acc_e2e', name: 'E2E Logistics', plan: 'growth', seats: 18 } }),
    )
    await page.route(api('/billing/v1/accounts/org_e2e/invoices'), (route) =>
      route.fulfill({ json: { invoices: [OPEN_INVOICE], next_page_token: null } }),
    )
    await page.route(api('/billing/v1/accounts/org_e2e/invoices/inv_e2e_0142'), (route) => route.fulfill({ json: OPEN_INVOICE }))
    await page.route(api('/v1/accounts/org_e2e/balance'), (route) => route.fulfill({ json: { amount: 189_000, currency: 'USD' } }))
    await page.route(api('/v1/accounts/org_e2e/invoices/inv_e2e_0142/pay'), (route) => route.fulfill({ json: { status: 'paid' } }))
    await signIn(page)
  })

  test('lists open invoices with a Pay link', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Pay NW-2025-0142' })).toBeVisible()
  })

  test('pays an open invoice', async ({ page }) => {
    await page.getByRole('link', { name: 'Pay NW-2025-0142' }).click()

    // Give the outstanding-balance banner time to load, then pay.
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Pay $1,890.00' }).click({ timeout: 1_000 })
    await expect(page.getByRole('status')).toHaveText('Payment received. Thank you!')
  })
})
`,
    ),
    file(
      'eslint.config.js',
      `import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { process: 'readonly', Buffer: 'readonly' },
    },
  },
)
`,
    ),
    file(
      'index.html',
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Track shipments, invoices and plans for your Atlas account." />
    <title>Atlas portal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
    ),
    file(
      'package.json',
      `{
  "name": "atlas-portal",
  "version": "2.3.0",
  "private": true,
  "type": "module",
  "description": "Atlas customer portal for freight and logistics teams.",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "size": "size-limit"
  },
  "dependencies": {
    "@northwind/ui": "^4.2.0",
    "react": "^19.1.1",
    "react-dom": "^19.1.1",
    "react-router": "^7.8.2",
    "recharts": "^3.1.2"
  },
  "devDependencies": {
    "@eslint/js": "^9.34.0",
    "@playwright/test": "^1.55.0",
    "@size-limit/file": "^11.2.0",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^22.18.0",
    "@types/react": "^19.1.12",
    "@types/react-dom": "^19.1.9",
    "@vitejs/plugin-react": "^5.0.2",
    "eslint": "^9.34.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "jsdom": "^26.1.0",
    "size-limit": "^11.2.0",
    "typescript": "^5.9.2",
    "typescript-eslint": "^8.41.0",
    "vite": "^7.1.4",
    "vitest": "^3.2.4"
  },
  "size-limit": [
    {
      "name": "Entry chunk (dashboard first load)",
      "path": "dist/assets/index-*.js",
      "limit": "300 kB",
      "gzip": true
    }
  ]
}
`,
    ),
    file(
      'playwright.config.ts',
      `import { defineConfig, devices } from '@playwright/test'

/**
 * E2E runs against the production build served by \`vite preview\`.
 * Every spec mocks portal-api and the IdP with page.route, so no backend is needed.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI keeps the pipeline green on a flaky run; the HTML report
  // still marks the test as flaky so it gets fixed rather than ignored.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
`,
    ),
    file(
      'src/App.tsx',
      `import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '@northwind/ui'
import { Header } from './components/Header'
import { useSession } from './hooks/useSession'

/** Authenticated shell: every route below \`/\` requires a session. */
export function App() {
  const session = useSession()
  const location = useLocation()

  if (!session) {
    // Tokens live in memory (ADR-012), so a reload or an expired session lands here.
    const returnTo = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={\`/login?return_to=\${returnTo}\`} replace />
  }

  return (
    <div className="app-shell">
      <Header email={session.email} />
      <main className="app-main">
        <Suspense fallback={<FullPageSpinner label="Loading…" />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="app-loading" aria-live="polite">
      <Spinner size="lg" />
      <span>{label}</span>
    </div>
  )
}
`,
    ),
    file(
      'src/api/client.test.ts',
      `import { afterEach, describe, expect, it, vi } from 'vitest'
import { refresh } from '../auth/session'
import { ApiError, backoff, request } from './client'

const session = { accessToken: 'test-token' }
vi.mock('../auth/session', () => ({
  getSession: () => session,
  refresh: vi.fn(),
}))

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('request', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.mocked(refresh).mockReset()
    session.accessToken = 'test-token'
  })

  it('retries idempotent requests on 503 and returns the eventual response', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(503, { code: 'unavailable' }))
      .mockResolvedValueOnce(json(200, { items: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = request('/v1/shipments')
    await vi.runAllTimersAsync()

    await expect(pending).resolves.toEqual({ items: [], nextCursor: null })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never retries POST requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(503, { code: 'unavailable', message: 'Try again later' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request('/v1/billing/invoices/inv_1/pay', { method: 'POST', body: {} })).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes once on 401 and retries with the new token', async () => {
    vi.mocked(refresh).mockImplementation(async () => {
      session.accessToken = 'fresh-token'
      return true
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(json(401, { code: 'token_expired' })).mockResolvedValueOnce(json(200, { id: 'acc_1' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request('/v1/account')).resolves.toEqual({ id: 'acc_1' })
    const retried = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect((retried.headers as Record<string, string>).authorization).toBe('Bearer fresh-token')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('gives up when the refresh is refused', async () => {
    vi.mocked(refresh).mockResolvedValue(false)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { code: 'token_expired' })))

    await expect(request('/v1/account')).rejects.toMatchObject({ status: 401, code: 'token_expired' })
    expect(refresh).toHaveBeenCalledOnce()
  })
})

describe('backoff', () => {
  it('doubles the ceiling per attempt and caps it at 8 s', () => {
    expect(backoff(0, () => 1)).toBe(300)
    expect(backoff(2, () => 0)).toBe(600)
    expect(backoff(10, () => 1)).toBe(8000)
  })
})
`,
    ),
    file(
      'src/api/client.ts',
      `import { getSession, refresh } from '../auth/session'
import { config } from '../config'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly retryAfterMs?: number

  constructor(status: number, code: string, message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

type Query = Record<string, string | number | undefined>

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Query
  signal?: AbortSignal
  /** Retries for network errors, 408, 429 and 5xx. Only idempotent methods are retried. */
  retries?: number
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])
const BASE_DELAY_MS = 300
const MAX_DELAY_MS = 8_000

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options
  const idempotent = method === 'GET' || method === 'PUT' || method === 'DELETE'
  const retries = idempotent ? (options.retries ?? 3) : 0
  const url = buildUrl(path, query)
  let refreshed = false

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        signal,
        headers: headers(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (networkError) {
      if (signal?.aborted || attempt >= retries) throw networkError
      await sleep(backoff(attempt), signal)
      continue
    }

    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T

    // ADR-012: refresh on the first 401, then retry once with the new access token.
    if (res.status === 401 && !refreshed) {
      refreshed = true
      if (await refresh()) continue
    }
    const error = await toApiError(res)
    if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
      await sleep(error.retryAfterMs ?? backoff(attempt), signal)
      continue
    }
    throw error
  }
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>(path, { query, signal }),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body }),
}

/** Exponential backoff with equal jitter: ~300 ms, 600 ms, 1.2 s … capped at 8 s. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
  return Math.round(ceiling / 2 + random() * (ceiling / 2))
}

function buildUrl(path: string, query: Query = {}): string {
  const url = new URL(path, config.apiBaseUrl)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  return url.toString()
}

function headers(hasBody: boolean): Record<string, string> {
  const session = getSession()
  return {
    accept: 'application/json',
    ...(hasBody ? { 'content-type': 'application/json' } : {}),
    ...(session ? { authorization: \`Bearer \${session.accessToken}\` } : {}),
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  const payload = (await res.json().catch(() => null)) as { code?: string; message?: string } | null
  const retryAfterSec = Number(res.headers.get('retry-after'))
  return new ApiError(
    res.status,
    payload?.code ?? \`http_\${res.status}\`,
    payload?.message ?? (res.statusText || \`Request failed with \${res.status}\`),
    retryAfterSec > 0 ? retryAfterSec * 1000 : undefined,
  )
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
`,
    ),
    file(
      'src/api/invoices.ts',
      `import type { Invoice, InvoiceStatus, Money, Page } from '../types'
import { api } from './client'

/**
 * Invoices from the in-house invoicer (/billing/v1), which Stripe Billing is replacing.
 * See docs/ARCHITECTURE.md → Billing. Amounts arrive as decimal strings and states
 * are upper-case; everything is normalized to the portal's Invoice type here.
 */
interface LegacyInvoice {
  invoice_id: string
  invoice_no: string
  state: 'DRAFT' | 'ISSUED' | 'PAID' | 'CANCELLED' | 'WRITTEN_OFF'
  currency: Money['currency']
  total: string
  balance: string
  issue_date: string
  due_date: string | null
  pdf_link: string | null
}

interface LegacyInvoicePage {
  invoices: LegacyInvoice[]
  next_page_token: string | null
}

const STATE_MAP: Record<LegacyInvoice['state'], InvoiceStatus> = {
  DRAFT: 'draft',
  ISSUED: 'open',
  PAID: 'paid',
  CANCELLED: 'void',
  WRITTEN_OFF: 'uncollectible',
}

export async function listInvoices(accountId: string, cursor?: string): Promise<Page<Invoice>> {
  const page = await api.get<LegacyInvoicePage>(\`/billing/v1/accounts/\${accountId}/invoices\`, {
    page_token: cursor,
    page_size: 25,
  })
  return { items: page.invoices.map(fromLegacy), nextCursor: page.next_page_token }
}

export async function getInvoice(accountId: string, invoiceId: string): Promise<Invoice> {
  const invoice = await api.get<LegacyInvoice>(\`/billing/v1/accounts/\${accountId}/invoices/\${invoiceId}\`)
  return fromLegacy(invoice)
}

/** Total of the account's open invoices in one currency (powers the checkout balance banner). */
export function getOutstandingBalance(accountId: string, currency: Money['currency'], signal?: AbortSignal): Promise<Money> {
  return api.get<Money>(\`/v1/accounts/\${accountId}/balance\`, { currency }, signal)
}

/** Pay an open invoice with the card on file. Not retried automatically (POST). */
export function payInvoice(accountId: string, invoiceId: string): Promise<{ status: 'paid' | 'failed' }> {
  return api.post<{ status: 'paid' | 'failed' }>(\`/v1/accounts/\${accountId}/invoices/\${invoiceId}/pay\`, {})
}

/** Email the invoice PDF to the account's billing contact again. */
export function resendInvoice(accountId: string, invoiceId: string): Promise<void> {
  return api.post<void>(\`/billing/v1/accounts/\${accountId}/invoices/\${invoiceId}/resend\`, {})
}

export function fromLegacy(invoice: LegacyInvoice): Invoice {
  return {
    id: invoice.invoice_id,
    number: invoice.invoice_no,
    status: STATE_MAP[invoice.state],
    total: { amount: toMinorUnits(invoice.total), currency: invoice.currency },
    amountDue: { amount: toMinorUnits(invoice.balance), currency: invoice.currency },
    issuedAt: invoice.issue_date,
    dueAt: invoice.due_date,
    pdfUrl: invoice.pdf_link,
    source: 'legacy',
  }
}

/** "1234.50" → 123450. The legacy service never sends more than two decimals. */
function toMinorUnits(decimal: string): number {
  return Math.round(Number.parseFloat(decimal) * 100)
}
`,
    ),
    file(
      'src/api/shipments.ts',
      `import type { Page, Shipment, ShipmentStatus } from '../types'
import { api } from './client'

export interface ShipmentQuery {
  status?: ShipmentStatus
  /** Free text: reference, port code or carrier. */
  search?: string
  cursor?: string
}

export interface VolumePoint {
  /** ISO week label, e.g. "2025-W23". */
  week: string
  containers: number
  /** Share of shipments delivered on or before the first ETA, 0..1. */
  onTimeRate: number
}

const PAGE_SIZE = 50

export function listShipments(query: ShipmentQuery = {}, signal?: AbortSignal): Promise<Page<Shipment>> {
  return api.get<Page<Shipment>>(
    '/v1/shipments',
    { status: query.status, q: query.search, cursor: query.cursor, limit: PAGE_SIZE },
    signal,
  )
}

export function getShipment(id: string, signal?: AbortSignal): Promise<Shipment> {
  return api.get<Shipment>(\`/v1/shipments/\${encodeURIComponent(id)}\`, undefined, signal)
}

export function getWeeklyVolume(weeks = 12, signal?: AbortSignal): Promise<VolumePoint[]> {
  return api.get<VolumePoint[]>('/v1/analytics/weekly-volume', { weeks }, signal)
}
`,
    ),
    file(
      'src/auth/session.test.ts',
      `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clear, getSession, login, REFRESH_AT, subscribe, type TokenSet } from './session'

const MINUTE = 60_000

function tokens(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: 'access-1',
    expiresIn: 900,
    user: { id: 'usr_42', email: 'dispatch@haldenlogistics.example', orgId: 'org_halden' },
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const refreshCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh')).length

describe('session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-06-02T09:00:00Z'))
  })

  afterEach(() => {
    clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('stores the session in memory with the access-token expiry', () => {
    const session = login(tokens())
    expect(session).toMatchObject({ userId: 'usr_42', orgId: 'org_halden', accessToken: 'access-1' })
    expect(session.expiresAt).toBe(Date.now() + 15 * MINUTE)
    expect(getSession()).toBe(session)
  })

  it('refreshes at 80% of the access-token lifetime and keeps refreshing', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(tokens({ accessToken: 'access-2' })))
    vi.stubGlobal('fetch', fetchMock)
    login(tokens())

    await vi.advanceTimersByTimeAsync(15 * MINUTE * REFRESH_AT - 1)
    expect(refreshCalls(fetchMock)).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(refreshCalls(fetchMock)).toBe(1)
    expect(getSession()?.accessToken).toBe('access-2')

    await vi.advanceTimersByTimeAsync(12 * MINUTE)
    expect(refreshCalls(fetchMock)).toBe(2)
  })

  it('ends the session when the refresh token is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ code: 'refresh_reuse_detected' }, 401)))
    const seen: Array<string | null> = []
    const unsubscribe = subscribe((s) => seen.push(s?.accessToken ?? null))

    login(tokens())
    await vi.advanceTimersByTimeAsync(12 * MINUTE)

    expect(getSession()).toBeNull()
    expect(seen).toEqual(['access-1', null])
    unsubscribe()
  })
})
`,
    ),
    file(
      'src/auth/session.ts',
      `import { authUrl } from '../config'

/**
 * Client side of ADR-012 (docs/ARCHITECTURE.md → Auth).
 * - The access token is a 15-minute JWT held in memory only, never in localStorage.
 * - The refresh token is the HttpOnly \`atlas_rt\` cookie; the browser sends it to /auth/refresh only.
 * - The client refreshes at about 80% of the access-token lifetime, and on the first 401.
 */
export interface TokenSet {
  accessToken: string
  /** Access-token lifetime in seconds (900 per ADR-012). */
  expiresIn: number
  user: { id: string; email: string; orgId: string }
}

export interface Session {
  userId: string
  email: string
  orgId: string
  accessToken: string
  /** Epoch ms after which portal-api rejects the access token. */
  expiresAt: number
}

type Listener = (session: Session | null) => void

/** Refresh at 80% of the access-token lifetime: about 12 of 15 minutes. */
export const REFRESH_AT = 0.8

let current: Session | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<Listener>()

export function getSession(): Session | null {
  return current
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Store a token set and notify subscribers. */
export function set(tokens: TokenSet, now = Date.now()): Session {
  current = {
    userId: tokens.user.id,
    email: tokens.user.email,
    orgId: tokens.user.orgId,
    accessToken: tokens.accessToken,
    expiresAt: now + tokens.expiresIn * 1000,
  }
  emit()
  return current
}

/** Password and SP-initiated SSO sign-in finish here: store the tokens and start the silent refresh. */
export function login(tokens: TokenSet): Session {
  const session = set(tokens)
  scheduleRefresh(tokens.expiresIn)
  return session
}

/** Silent refresh. Rotates the atlas_rt cookie; ends the session when the server refuses. */
export async function refresh(): Promise<boolean> {
  const res = await fetch(authUrl('/auth/refresh'), { method: 'POST', credentials: 'include' }).catch(() => null)
  if (!res?.ok) {
    clear()
    return false
  }
  const tokens = (await res.json()) as TokenSet
  set(tokens)
  scheduleRefresh(tokens.expiresIn)
  return true
}

/** Sign out here and at portal-api (revokes the refresh-token family). */
export async function logout(): Promise<void> {
  clear()
  await fetch(authUrl('/auth/logout'), { method: 'POST', credentials: 'include' }).catch(() => undefined)
}

/** Drop the in-memory session without calling the server. */
export function clear(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = null
  current = null
  emit()
}

function scheduleRefresh(expiresInSec: number): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void refresh(), expiresInSec * 1000 * REFRESH_AT)
}

function emit(): void {
  for (const listener of listeners) listener(current)
}
`,
    ),
    file(
      'src/auth/sso.ts',
      `import { authUrl } from '../config'
import type { TokenSet } from './session'

/**
 * Sign-in flows. Every flow ends with a call to portal-api that returns a TokenSet and
 * sets the atlas_rt refresh cookie, so requests here always send credentials.
 *
 * - Password: POST /auth/password.
 * - SP-initiated SSO: we send the user to their IdP via /auth/sso/start; the IdP comes back
 *   to /auth/callback with a one-time code (SAML or OIDC, portal-api hides the difference).
 * - IdP-initiated SSO: the user starts from their IdP dashboard; portal-api consumes the SAML
 *   assertion and redirects to /auth/saml/callback with a one-time ticket.
 */

export class SignInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

export function signInWithPassword(email: string, password: string): Promise<TokenSet> {
  return post('/auth/password', { email, password })
}

/** SP-initiated SSO: portal-api picks the customer's IdP from the email domain. */
export function startSsoLogin(email: string, returnTo = '/'): void {
  const url = new URL(authUrl('/auth/sso/start'))
  url.searchParams.set('email', email)
  url.searchParams.set('return_to', returnTo)
  window.location.assign(url.toString())
}

/** SP-initiated callback: exchange the one-time code for tokens. */
export function completeSsoLogin(code: string): Promise<TokenSet> {
  return post('/auth/sso/token', { code })
}

/** IdP-initiated callback: redeem the ticket portal-api issued for the SAML assertion. */
export function redeemIdpTicket(ticket: string): Promise<TokenSet> {
  return post('/auth/saml/ticket', { ticket })
}

/** Only allow same-origin paths as post-login destinations. */
export function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function post(path: string, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(authUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401 || res.status === 403) throw new SignInError('Those details didn’t work. Please try again.')
  if (!res.ok) throw new SignInError(\`Sign-in failed (\${res.status}). Please try again.\`)
  return (await res.json()) as TokenSet
}
`,
    ),
    file(
      'src/billing/plans.ts',
      `import type { Money, PlanId } from '../types'

export interface Plan {
  id: PlanId
  name: string
  /** Monthly platform fee; covers \`includedSeats\`. */
  basePrice: Money
  includedSeats: number
  /** Monthly price for each seat above the included ones. */
  seatPrice: Money
  features: string[]
  /** Stripe Price lookup key, used once billing runs on Stripe (see billing/stripe.ts). */
  stripeLookupKey: string
}

const usd = (dollars: number): Money => ({ amount: Math.round(dollars * 100), currency: 'USD' })

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: 'starter',
    name: 'Starter',
    basePrice: usd(290),
    includedSeats: 5,
    seatPrice: usd(39),
    features: ['Shipment tracking', 'Invoices and payments', 'Email support'],
    stripeLookupKey: 'atlas_starter_monthly',
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    basePrice: usd(890),
    includedSeats: 15,
    seatPrice: usd(35),
    features: ['Everything in Starter', 'SSO (OIDC)', 'API access', 'Priority support'],
    stripeLookupKey: 'atlas_growth_monthly',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    basePrice: usd(2_400),
    includedSeats: 50,
    seatPrice: usd(29),
    features: ['Everything in Growth', 'Custom SLAs', 'Dedicated success manager', 'Audit log export'],
    stripeLookupKey: 'atlas_enterprise_monthly',
  },
}

const ORDER: PlanId[] = ['starter', 'growth', 'enterprise']

export function canUpgrade(from: PlanId, to: PlanId): boolean {
  return ORDER.indexOf(to) > ORDER.indexOf(from)
}

/** Monthly total for a plan and seat count. Seats up to the included amount are free. */
export function monthlyTotal(planId: PlanId, seats: number): Money {
  const plan = PLANS[planId]
  const extraSeats = Math.max(0, seats - plan.includedSeats)
  return {
    amount: plan.basePrice.amount + extraSeats * plan.seatPrice.amount,
    currency: plan.basePrice.currency,
  }
}
`,
    ),
    file(
      'src/billing/stripe.ts',
      `import type { Invoice, Money, Page } from '../types'

/**
 * Stripe Billing adapter (migration in progress, see docs/ARCHITECTURE.md → Billing).
 *
 * The portal never calls Stripe directly: portal-api holds the secret key and exposes
 * Stripe objects under /v2/billing. This module maps them to the portal's Invoice type
 * so components don't care which billing system served a record.
 */

// TODO(billing-migration): use the official Stripe types once the \`stripe\` package is added.
interface StripeInvoice {
  id: string
  number: string | null
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null
  currency: string
  total: number
  amount_due: number
  /** Unix seconds. */
  created: number
  due_date: number | null
  invoice_pdf: string | null
}

const SUPPORTED_CURRENCIES: readonly Money['currency'][] = ['USD', 'EUR', 'GBP']

export function fromStripeInvoice(invoice: StripeInvoice): Invoice {
  const currency = toCurrency(invoice.currency)
  return {
    id: invoice.id,
    // Drafts have no number until Stripe finalizes them.
    number: invoice.number ?? invoice.id,
    status: invoice.status ?? 'draft',
    total: { amount: invoice.total, currency },
    amountDue: { amount: invoice.amount_due, currency },
    issuedAt: new Date(invoice.created * 1000).toISOString(),
    dueAt: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
    pdfUrl: invoice.invoice_pdf,
    source: 'stripe',
  }
}

export async function listStripeInvoices(_accountId: string, _cursor?: string): Promise<Page<Invoice>> {
  // TODO(billing-migration): call GET /v2/billing/invoices (shipped in portal-api 1.42).
  throw new Error('Stripe invoices are not wired up yet')
}

/** Stripe uses lower-case ISO codes ("eur"); the portal only renders the currencies it bills in. */
function toCurrency(code: string): Money['currency'] {
  const upper = code.toUpperCase()
  const match = SUPPORTED_CURRENCIES.find((c) => c === upper)
  if (!match) throw new Error(\`Unsupported invoice currency: \${code}\`)
  return match
}
`,
    ),
    file(
      'src/components/Dashboard.tsx',
      `import { lazy, Suspense } from 'react'
import { Card, Skeleton, Stat } from '@northwind/ui'
import { useShipments } from '../hooks/useShipments'
import { pluralize } from '../lib/format'
import type { Shipment } from '../types'
import { ShipmentTable } from './ShipmentTable'

// recharts + d3 weigh ~430 kB; load the chart after first paint, not in the entry chunk.
const VolumeChart = lazy(() => import('./VolumeChart').then((m) => ({ default: m.VolumeChart })))

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function Dashboard() {
  const { shipments, loading, error } = useShipments({})
  const stats = summarize(shipments)

  return (
    <section className="page">
      <h1>Dashboard</h1>

      <div className="stat-grid">
        <Stat label="In transit" value={stats.inTransit} loading={loading} />
        <Stat label="Past ETA" value={stats.late} tone={stats.late > 0 ? 'warning' : 'neutral'} loading={loading} />
        <Stat label="Exceptions" value={stats.exceptions} tone={stats.exceptions > 0 ? 'danger' : 'neutral'} loading={loading} />
        <Stat label="Delivered (7 days)" value={stats.deliveredThisWeek} loading={loading} />
      </div>

      <Card title="Weekly volume">
        <Suspense fallback={<Skeleton height={240} />}>
          <VolumeChart weeks={12} />
        </Suspense>
      </Card>

      <Card title="Latest shipments" description={pluralize(shipments.length, 'shipment')}>
        {error ? (
          <p role="alert">Couldn’t load shipments: {error.message}</p>
        ) : (
          <ShipmentTable shipments={shipments.slice(0, 8)} loading={loading} />
        )}
      </Card>
    </section>
  )
}

function summarize(shipments: Shipment[], now = Date.now()) {
  const open = shipments.filter((s) => s.status !== 'delivered')
  return {
    inTransit: shipments.filter((s) => s.status === 'in_transit').length,
    late: open.filter((s) => s.etaAt !== null && Date.parse(s.etaAt) < now).length,
    exceptions: open.filter((s) => s.status === 'exception' || s.status === 'customs_hold').length,
    deliveredThisWeek: shipments.filter((s) => s.deliveredAt !== null && Date.parse(s.deliveredAt) >= now - WEEK_MS).length,
  }
}
`,
    ),
    file(
      'src/components/Header.tsx',
      `import { NavLink } from 'react-router'
import { Avatar, Button } from '@northwind/ui'
import { logout } from '../auth/session'
import { initials } from '../lib/format'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/shipments', label: 'Shipments', end: false },
  { to: '/billing', label: 'Billing', end: false },
]

export function Header({ email }: { email: string }) {
  return (
    <header className="app-header">
      <a className="app-header__brand" href="/">
        Atlas
      </a>

      <nav aria-label="Main">
        <ul className="app-header__nav">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'is-active' : undefined)}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="app-header__account">
        <Avatar label={email} initials={initials(email)} />
        <Button variant="ghost" size="sm" onClick={() => void logout()}>
          Sign out
        </Button>
      </div>
    </header>
  )
}
`,
    ),
    file(
      'src/components/InvoiceList.tsx',
      `import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Badge, Button, Card, Skeleton, type BadgeTone } from '@northwind/ui'
import { api } from '../api/client'
import { listInvoices, resendInvoice } from '../api/invoices'
import { PLANS } from '../billing/plans'
import { useRequiredSession } from '../hooks/useSession'
import { formatShortDate, isOverdue } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { Account, Invoice, InvoiceStatus } from '../types'

const STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: 'neutral',
  open: 'info',
  paid: 'success',
  void: 'neutral',
  uncollectible: 'danger',
}

export function InvoiceList() {
  const { orgId } = useRequiredSession()
  const [account, setAccount] = useState<Account | null>(null)
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.get<Account>('/v1/account'), listInvoices(orgId)])
      .then(([acc, page]) => {
        if (cancelled) return
        setAccount(acc)
        setInvoices(page.items)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  async function handleResend(invoice: Invoice) {
    await resendInvoice(orgId, invoice.id)
    setResent(invoice.number)
  }

  const plan = account ? PLANS[account.plan] : null

  return (
    <section className="page">
      <header className="page-header">
        <h1>Billing</h1>
        {plan && account && (
          <p className="muted">
            {plan.name} plan · {account.seats} seats · {formatMoney(plan.basePrice)} / month base
          </p>
        )}
      </header>

      {resent && <p className="notice">Invoice {resent} was sent to your billing contact.</p>}

      <Card title="Invoices">
        {error && <p role="alert">Couldn’t load invoices: {error}</p>}
        {!error && !invoices && <Skeleton rows={5} />}
        {invoices?.length === 0 && <p className="empty">No invoices yet.</p>}
        {invoices && invoices.length > 0 && (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Issued</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col" className="numeric">
                  Amount due
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="mono">{invoice.number}</td>
                  <td>{formatShortDate(invoice.issuedAt)}</td>
                  <td className={invoice.status === 'open' && isOverdue(invoice.dueAt) ? 'text-danger' : undefined}>
                    {invoice.dueAt ? formatShortDate(invoice.dueAt) : '—'}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[invoice.status]}>{invoice.status}</Badge>
                  </td>
                  <td className="numeric">{formatMoney(invoice.amountDue)}</td>
                  <td className="actions">
                    {invoice.status === 'open' && (
                      <Link to={\`/billing/pay/\${invoice.id}\`} aria-label={\`Pay \${invoice.number}\`}>
                        Pay
                      </Link>
                    )}
                    {invoice.pdfUrl && (
                      <a href={invoice.pdfUrl} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => void handleResend(invoice)}>
                      Resend
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
`,
    ),
    file(
      'src/components/ShipmentTable.tsx',
      `import { Badge, Skeleton, type BadgeTone } from '@northwind/ui'
import { formatEta } from '../lib/date'
import { formatWeight, STATUS_LABEL } from '../lib/format'
import type { Shipment, ShipmentStatus } from '../types'

const STATUS_TONE: Record<ShipmentStatus, BadgeTone> = {
  booked: 'neutral',
  in_transit: 'info',
  customs_hold: 'warning',
  delivered: 'success',
  exception: 'danger',
}

interface ShipmentTableProps {
  shipments: Shipment[]
  loading?: boolean
  emptyMessage?: string
}

export function ShipmentTable({ shipments, loading = false, emptyMessage = 'No shipments match these filters.' }: ShipmentTableProps) {
  if (loading && shipments.length === 0) return <Skeleton rows={6} />
  if (shipments.length === 0) return <p className="empty">{emptyMessage}</p>

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Reference</th>
          <th scope="col">Route</th>
          <th scope="col">Mode</th>
          <th scope="col">Status</th>
          <th scope="col">ETA (destination time)</th>
          <th scope="col" className="numeric">
            Weight
          </th>
        </tr>
      </thead>
      <tbody>
        {shipments.map((s) => (
          <tr key={s.id}>
            <td className="mono">{s.reference}</td>
            <td>
              {s.origin.code} → {s.destination.code}
            </td>
            <td className="capitalize">{s.mode}</td>
            <td>
              <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
            </td>
            <td>{formatEta(s.etaAt, s.destination.timezone)}</td>
            <td className="numeric">{formatWeight(s.weightKg)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
`,
    ),
    file(
      'src/components/VolumeChart.tsx',
      `import { useEffect, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getWeeklyVolume, type VolumePoint } from '../api/shipments'
import { formatPercent } from '../lib/format'

/** Containers moved per week (bars) and on-time rate (line). */
export function VolumeChart({ weeks }: { weeks: number }) {
  const [data, setData] = useState<VolumePoint[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getWeeklyVolume(weeks, controller.signal)
      .then(setData)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Unknown error')
      })
    return () => controller.abort()
  }, [weeks])

  if (error) return <p role="alert">Couldn’t load volume: {error}</p>
  if (!data) return <div className="chart-placeholder" aria-busy="true" />

  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="week" tickLine={false} />
        <YAxis yAxisId="containers" allowDecimals={false} width={40} />
        <YAxis yAxisId="onTime" orientation="right" domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v)} width={48} />
        <Tooltip />
        <Bar yAxisId="containers" dataKey="containers" name="Containers" fill="var(--nw-color-accent)" radius={[4, 4, 0, 0]} />
        <Line yAxisId="onTime" dataKey="onTimeRate" name="On time" stroke="var(--nw-color-success)" dot={false} strokeWidth={2} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
`,
    ),
    file(
      'src/config.ts',
      `/** Runtime configuration from Vite env variables (see README → Configuration). */
const env = import.meta.env

export const config = {
  /** portal-api; also serves the /auth/* endpoints (ADR-012). */
  apiBaseUrl: env.VITE_API_BASE_URL ?? 'https://api.atlas.northwind.example',
  flags: {
    /** Serve invoices from Stripe Billing instead of the in-house invoicer. */
    stripeBilling: env.VITE_FLAG_STRIPE_BILLING === 'true',
    /** Outstanding-balance banner on checkout (turned off during the latency incident). */
    balanceBanner: env.VITE_FLAG_BALANCE_BANNER !== 'false',
  },
} as const

export function authUrl(path: string): string {
  return new URL(path, config.apiBaseUrl).toString()
}
`,
    ),
    file(
      'src/hooks/useSession.ts',
      `import { useSyncExternalStore } from 'react'
import { getSession, subscribe, type Session } from '../auth/session'

/** The signed-in user's session. Re-renders when tokens refresh or the session ends. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null)
}

/**
 * For components rendered inside the authenticated shell (App), where a session is
 * guaranteed. Throws anywhere else so the mistake shows up during development.
 */
export function useRequiredSession(): Session {
  const session = useSession()
  if (!session) throw new Error('useRequiredSession must be used inside the authenticated app shell')
  return session
}
`,
    ),
    file(
      'src/hooks/useShipments.ts',
      `import { useCallback, useEffect, useState } from 'react'
import { listShipments, type ShipmentQuery } from '../api/shipments'
import type { Shipment } from '../types'

interface ShipmentsState {
  shipments: Shipment[]
  nextCursor: string | null
  loading: boolean
  error: Error | null
}

const INITIAL: ShipmentsState = { shipments: [], nextCursor: null, loading: true, error: null }

/** Shipments for the given filters with cursor pagination. Refetches when filters change. */
export function useShipments({ status, search }: Omit<ShipmentQuery, 'cursor'>) {
  const [state, setState] = useState<ShipmentsState>(INITIAL)

  useEffect(() => {
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    listShipments({ status, search }, controller.signal)
      .then((page) => setState({ shipments: page.items, nextCursor: page.nextCursor, loading: false, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState((prev) => ({ ...prev, loading: false, error: toError(error) }))
      })
    return () => controller.abort()
  }, [status, search])

  const loadMore = useCallback(async () => {
    if (!state.nextCursor) return
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const page = await listShipments({ status, search, cursor: state.nextCursor })
      setState((prev) => ({
        shipments: [...prev.shipments, ...page.items],
        nextCursor: page.nextCursor,
        loading: false,
        error: null,
      }))
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: toError(error) }))
    }
  }, [state.nextCursor, status, search])

  return { ...state, loadMore }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
`,
    ),
    file(
      'src/lib/date.test.ts',
      `import { describe, expect, it } from 'vitest'
import { daysBetween, formatEta, formatShortDate, isOverdue, relativeDays } from './date'

describe('formatEta', () => {
  it('shows the ETA in the destination time zone', () => {
    const eta = '2025-06-02T22:30:00Z'
    expect(formatEta(eta, 'Europe/Amsterdam')).toBe('Jun 3, 00:30')
    expect(formatEta(eta, 'America/Chicago')).toBe('Jun 2, 17:30')
  })

  it('shows a dash when there is no ETA yet', () => {
    expect(formatEta(null, 'Europe/Amsterdam')).toBe('—')
  })
})

describe('formatShortDate', () => {
  it('formats calendar dates in UTC', () => {
    expect(formatShortDate('2025-06-30T23:30:00Z')).toBe('Jun 30, 2025')
  })
})

describe('relative dates', () => {
  const now = new Date('2025-06-02T09:00:00Z')

  it('counts whole days', () => {
    expect(daysBetween('2025-06-01T00:00:00Z', '2025-06-04T12:00:00Z')).toBe(3)
  })

  it('describes upcoming and late dates', () => {
    expect(relativeDays('2025-06-02T18:00:00Z', now)).toBe('today')
    expect(relativeDays('2025-06-03T10:00:00Z', now)).toBe('tomorrow')
    expect(relativeDays('2025-06-05T10:00:00Z', now)).toBe('in 3 days')
    expect(relativeDays('2025-05-31T08:00:00Z', now)).toBe('2 days late')
  })

  it('flags overdue dates only when a due date exists', () => {
    expect(isOverdue('2025-06-01T00:00:00Z', now)).toBe(true)
    expect(isOverdue('2025-06-09T00:00:00Z', now)).toBe(false)
    expect(isOverdue(null, now)).toBe(false)
  })
})
`,
    ),
    file(
      'src/lib/date.ts',
      `const DAY_MS = 24 * 60 * 60 * 1000

/**
 * ETA in the destination's local time, e.g. "Jun 3, 00:30". Shipments cross time zones;
 * showing the viewer's zone made overnight arrivals look a day off (SUP-401).
 */
export function formatEta(iso: string | null, timeZone: string, locale = 'en-US'): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(iso))
}

/** "Jun 30, 2025". Invoice dates are calendar dates, so they are always shown in UTC. */
export function formatShortDate(iso: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(iso),
  )
}

/** Whole days from \`fromIso\` to \`toIso\`, truncated toward zero. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.trunc((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS)
}

/** "today", "tomorrow", "in 3 days", "1 day late", "4 days late". */
export function relativeDays(targetIso: string, now = new Date()): string {
  const days = daysBetween(now.toISOString(), targetIso)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days > 1) return \`in \${days} days\`
  return days === -1 ? '1 day late' : \`\${-days} days late\`
}

export function isOverdue(dueIso: string | null, now = new Date()): boolean {
  return dueIso !== null && Date.parse(dueIso) < now.getTime()
}
`,
    ),
    file(
      'src/lib/format.ts',
      `import type { ShipmentStatus } from '../types'

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  booked: 'Booked',
  in_transit: 'In transit',
  customs_hold: 'Customs hold',
  delivered: 'Delivered',
  exception: 'Exception',
}

/** 840 → "840 kg", 12_500 → "12.5 t", 240_000 → "240 t". */
export function formatWeight(kg: number): string {
  if (kg < 1_000) return \`\${Math.round(kg)} kg\`
  const tonnes = kg / 1_000
  return \`\${tonnes >= 100 ? Math.round(tonnes) : Number(tonnes.toFixed(1))} t\`
}

/** 0.873 → "87%", or "87.3%" with one digit. */
export function formatPercent(ratio: number, digits = 0): string {
  return \`\${(ratio * 100).toFixed(digits)}%\`
}

export function pluralize(count: number, singular: string, plural = \`\${singular}s\`): string {
  return \`\${count} \${count === 1 ? singular : plural}\`
}

/** "dispatch@meridianfreight.example" → "DI", "Dana Whitfield" → "DW". */
export function initials(nameOrEmail: string): string {
  const name = nameOrEmail.split('@')[0] ?? nameOrEmail
  const parts = name.split(/[\\s._-]+/).filter(Boolean)
  const first = parts[0] ?? ''
  const last = parts[parts.length - 1] ?? ''
  return (parts.length > 1 ? first.charAt(0) + last.charAt(0) : first.slice(0, 2)).toUpperCase()
}

/** Compact counts for stat tiles: 1_284 → "1.3K". */
export function compactNumber(n: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}
`,
    ),
    file(
      'src/lib/money.test.ts',
      `import { describe, expect, it } from 'vitest'
import { addMoney, allocate, formatMoney, sumMoney } from './money'

const usd = (amount: number) => ({ amount, currency: 'USD' as const })

describe('money', () => {
  it('formats minor units with the currency symbol', () => {
    expect(formatMoney(usd(123_450))).toBe('$1,234.50')
    expect(formatMoney({ amount: 4_200, currency: 'GBP' }, 'en-GB')).toBe('£42.00')
  })

  it('adds amounts in the same currency', () => {
    expect(addMoney(usd(1_050), usd(250))).toEqual(usd(1_300))
  })

  it('refuses to mix currencies', () => {
    expect(() => addMoney(usd(100), { amount: 100, currency: 'EUR' })).toThrow('Currency mismatch: USD vs EUR')
  })

  it('sums a list, starting from zero', () => {
    expect(sumMoney([usd(100), usd(250), usd(5)], 'USD')).toEqual(usd(355))
    expect(sumMoney([], 'EUR')).toEqual({ amount: 0, currency: 'EUR' })
  })

  it('allocates without losing cents', () => {
    expect(allocate(usd(1_000), 3).map((m) => m.amount)).toEqual([334, 333, 333])
    expect(() => allocate(usd(1_000), 0)).toThrow()
  })
})
`,
    ),
    file(
      'src/lib/money.ts',
      `import type { Money } from '../types'

const formatters = new Map<string, Intl.NumberFormat>()

function formatterFor(currency: Money['currency'], locale: string): Intl.NumberFormat {
  const key = \`\${locale}:\${currency}\`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
    formatters.set(key, formatter)
  }
  return formatter
}

/** { amount: 123450, currency: 'USD' } → "$1,234.50". */
export function formatMoney(money: Money, locale = 'en-US'): string {
  return formatterFor(money.currency, locale).format(money.amount / 100)
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

export function sumMoney(items: Money[], currency: Money['currency']): Money {
  return items.reduce<Money>((total, item) => addMoney(total, item), { amount: 0, currency })
}

/**
 * Split an amount into \`parts\` that add up exactly, e.g. for per-shipment surcharges.
 * The remainder cents go to the first parts.
 */
export function allocate(money: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error(\`Cannot allocate into \${parts} parts\`)
  const base = Math.floor(money.amount / parts)
  const remainder = money.amount - base * parts
  return Array.from({ length: parts }, (_, i) => ({ amount: base + (i < remainder ? 1 : 0), currency: money.currency }))
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new Error(\`Currency mismatch: \${a.currency} vs \${b.currency}\`)
}
`,
    ),
    file(
      'src/main.tsx',
      `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import '@northwind/ui/styles.css'
import { routes } from './routes'

const router = createBrowserRouter(routes)

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element in index.html')

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
`,
    ),
    file(
      'src/pages/Checkout.tsx',
      `import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { Button, Card, Skeleton } from '@northwind/ui'
import { getInvoice, getOutstandingBalance, payInvoice } from '../api/invoices'
import { config } from '../config'
import { useRequiredSession } from '../hooks/useSession'
import { formatShortDate } from '../lib/date'
import { formatMoney } from '../lib/money'
import type { Invoice, Money } from '../types'

type PayState = 'idle' | 'paying' | 'paid' | 'failed'

/** Pay one open invoice with the card on file (/billing/pay/:invoiceId). */
export function Checkout() {
  const { invoiceId = '' } = useParams()
  const { orgId } = useRequiredSession()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [balance, setBalance] = useState<Money | null>(null)
  const [state, setState] = useState<PayState>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    getInvoice(orgId, invoiceId)
      .then(setInvoice)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
    return () => controller.abort()
  }, [orgId, invoiceId])

  // The banner needs the invoice currency, so its request starts only after the invoice loads.
  useEffect(() => {
    if (!invoice || !config.flags.balanceBanner) return
    const controller = new AbortController()
    getOutstandingBalance(orgId, invoice.amountDue.currency, controller.signal)
      .then(setBalance)
      .catch(() => setBalance(invoice.amountDue))
    return () => controller.abort()
  }, [orgId, invoice])

  // Pay stays disabled until the banner shows the current balance, so nobody pays a stale amount.
  const ready = invoice !== null && (balance !== null || !config.flags.balanceBanner)

  async function pay() {
    if (!invoice) return
    setState('paying')
    const result = await payInvoice(orgId, invoice.id).catch(() => ({ status: 'failed' as const }))
    setState(result.status)
  }

  if (error) return <p role="alert">Couldn’t load this invoice: {error}</p>
  if (!invoice) return <Skeleton rows={4} />

  return (
    <section className="page">
      <h1>Pay invoice {invoice.number}</h1>
      {config.flags.balanceBanner && (
        <div className="balance-banner" data-testid="balance-banner">
          {balance ? \`Outstanding balance: \${formatMoney(balance)}\` : 'Checking your outstanding balance…'}
        </div>
      )}
      <Card>
        <dl className="summary">
          <dt>Issued</dt>
          <dd>{formatShortDate(invoice.issuedAt)}</dd>
          <dt>Due</dt>
          <dd>{invoice.dueAt ? formatShortDate(invoice.dueAt) : 'On receipt'}</dd>
          <dt>Amount due</dt>
          <dd>{formatMoney(invoice.amountDue)}</dd>
        </dl>
        <Button onClick={() => void pay()} disabled={!ready || state === 'paying' || state === 'paid'}>
          Pay {formatMoney(invoice.amountDue)}
        </Button>
        {state === 'paid' && <p role="status">Payment received. Thank you!</p>}
        {state === 'failed' && <p role="alert">The payment didn’t go through. Your card was not charged.</p>}
      </Card>
    </section>
  )
}
`,
    ),
    file(
      'src/pages/Login.tsx',
      `import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button, Input } from '@northwind/ui'
import { login } from '../auth/session'
import { safeReturnTo, signInWithPassword, startSsoLogin } from '../auth/sso'

/** Sign-in page: password, or SP-initiated SSO for accounts with an identity provider. */
export function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('return_to'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      login(await signInWithPassword(email, password))
      navigate(returnTo, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <h1>Sign in to Atlas</h1>
      <form onSubmit={(e) => void onSubmit(e)} noValidate>
        <Input label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy}>
          Sign in
        </Button>
      </form>
      <Button variant="secondary" onClick={() => startSsoLogin(email, returnTo)} disabled={!email.includes('@')}>
        Continue with SSO
      </Button>
    </main>
  )
}
`,
    ),
    file(
      'src/pages/LoginCallback.tsx',
      `import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import * as session from '../auth/session'
import { completeSsoLogin, redeemIdpTicket, safeReturnTo } from '../auth/sso'

/** SP-initiated SSO lands here (/auth/callback?code=…) after the user signed in at their IdP. */
export function LoginCallback() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = useOnce(async () => {
    const tokens = await completeSsoLogin(params.get('code') ?? '')
    session.login(tokens)
    navigate(safeReturnTo(params.get('return_to')), { replace: true })
  })
  return <CallbackStatus error={error} />
}

/**
 * IdP-initiated SSO lands here (/auth/saml/callback?ticket=…) when the user opens Atlas from
 * their identity provider's dashboard. portal-api has already consumed the SAML assertion.
 */
export function SamlCallback() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = useOnce(async () => {
    const tokens = await redeemIdpTicket(params.get('ticket') ?? '')
    session.set(tokens)
    navigate(safeReturnTo(params.get('relay_state')), { replace: true })
  })
  return <CallbackStatus error={error} />
}

/** Run a sign-in exchange once. StrictMode runs effects twice in development; codes are single-use. */
function useOnce(exchange: () => Promise<void>): string | null {
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    exchange().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Sign-in failed'))
  })
  return error
}

function CallbackStatus({ error }: { error: string | null }) {
  if (error) {
    return (
      <main className="auth-page">
        <p role="alert">{error}</p>
        <a href="/login">Back to sign-in</a>
      </main>
    )
  }
  return (
    <main className="auth-page" aria-busy="true">
      <p aria-live="polite">Completing sign-in…</p>
    </main>
  )
}
`,
    ),
    file(
      'src/pages/Shipments.tsx',
      `import { useState } from 'react'
import { Button, Card, Input, Select } from '@northwind/ui'
import { ShipmentTable } from '../components/ShipmentTable'
import { useShipments } from '../hooks/useShipments'
import { STATUS_LABEL } from '../lib/format'
import type { ShipmentStatus } from '../types'

const STATUS_OPTIONS = Object.entries(STATUS_LABEL) as [ShipmentStatus, string][]

export function Shipments() {
  const [status, setStatus] = useState<ShipmentStatus | undefined>()
  const [search, setSearch] = useState('')
  const { shipments, loading, error, nextCursor, loadMore } = useShipments({
    status,
    search: search.trim() || undefined,
  })

  return (
    <section className="page">
      <h1>Shipments</h1>
      <Card>
        <div className="filters">
          <Input
            type="search"
            label="Search"
            placeholder="Reference, port or carrier"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select
            label="Status"
            value={status ?? ''}
            onChange={(e) => setStatus((e.target.value || undefined) as ShipmentStatus | undefined)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {error ? (
          <p role="alert">Couldn’t load shipments: {error.message}</p>
        ) : (
          <ShipmentTable shipments={shipments} loading={loading} />
        )}

        {nextCursor && (
          <Button variant="secondary" onClick={() => void loadMore()} disabled={loading}>
            Load more
          </Button>
        )}
      </Card>
    </section>
  )
}
`,
    ),
    file(
      'src/routes.tsx',
      `import { lazy } from 'react'
import type { RouteObject } from 'react-router'
import { App } from './App'
import { LoginCallback, SamlCallback } from './pages/LoginCallback'
import { Login } from './pages/Login'

// Route-level code splitting: each screen is its own chunk, so the dashboard no longer
// ships the shipments, billing and checkout code (and their dependencies) up front.
const Dashboard = lazy(() => import('./components/Dashboard').then((m) => ({ default: m.Dashboard })))
const Shipments = lazy(() => import('./pages/Shipments').then((m) => ({ default: m.Shipments })))
const InvoiceList = lazy(() => import('./components/InvoiceList').then((m) => ({ default: m.InvoiceList })))
const Checkout = lazy(() => import('./pages/Checkout').then((m) => ({ default: m.Checkout })))

export const routes: RouteObject[] = [
  { path: '/login', element: <Login /> },
  { path: '/auth/callback', element: <LoginCallback /> },
  { path: '/auth/saml/callback', element: <SamlCallback /> },
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'shipments', element: <Shipments /> },
      { path: 'billing', element: <InvoiceList /> },
      { path: 'billing/pay/:invoiceId', element: <Checkout /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]

function NotFound() {
  return (
    <section className="page">
      <h1>Page not found</h1>
      <p>
        That page doesn’t exist (yet). <a href="/">Back to the dashboard</a>
      </p>
    </section>
  )
}
`,
    ),
    file(
      'src/types.ts',
      `/** Domain types shared by the API layer and the UI. Mirrors portal-api's public schema. */

export type ShipmentStatus = 'booked' | 'in_transit' | 'customs_hold' | 'delivered' | 'exception'

export interface Location {
  /** UN/LOCODE, e.g. "NLRTM" for Rotterdam. */
  code: string
  name: string
  /** IANA time zone of the location; ETAs are shown in it. */
  timezone: string
}

export interface Shipment {
  id: string
  reference: string
  carrier: string
  mode: 'ocean' | 'air' | 'road' | 'rail'
  status: ShipmentStatus
  origin: Location
  destination: Location
  /** ISO-8601 timestamps from the tracking pipeline. */
  departedAt: string | null
  etaAt: string | null
  deliveredAt: string | null
  containerCount: number
  weightKg: number
}

export interface Money {
  /** Integer minor units (cents). Never use floats for money. */
  amount: number
  currency: 'USD' | 'EUR' | 'GBP'
}

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

export interface Invoice {
  id: string
  number: string
  status: InvoiceStatus
  total: Money
  amountDue: Money
  issuedAt: string
  dueAt: string | null
  pdfUrl: string | null
  /** Which billing system served the record while the Stripe migration is running. */
  source: 'legacy' | 'stripe'
}

export type PlanId = 'starter' | 'growth' | 'enterprise'

export interface Account {
  id: string
  name: string
  plan: PlanId
  seats: number
}

/** Cursor-paginated list response. */
export interface Page<T> {
  items: T[]
  nextCursor: string | null
}
`,
    ),
    file(
      'tsconfig.json',
      `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "e2e", "vite.config.ts", "playwright.config.ts"]
}
`,
    ),
    file(
      'vite.config.ts',
      `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    // Per-chunk budget in kB. Vite only warns above it, so treat a warning as a
    // regression: the entry chunk should stay far below, and the lazy-loaded
    // dashboard chart (recharts + d3) is the only chunk allowed near the limit.
    chunkSizeWarningLimit: 450,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
`,
    ),
  ],
}
