/**
 * Exact edits that turn DEMO_REPO files into each seeded coding session's version.
 * Every `find` must occur exactly once in the file it targets; `applyEdits` throws otherwise,
 * so a change to DEMO_REPO that breaks an anchor fails the seed tests instead of silently
 * producing a wrong diff. FileChange `before`/`after` and line counts are derived from these.
 */
export interface FileEdit {
  find: string
  replace: string
}

/** ses_sso: every sign-in path goes through establishSession(), which always schedules the refresh. */
export const SSO_FIX_EDITS: Record<string, FileEdit[]> = {
  'src/auth/session.ts': [
    {
      find: `
/** Store a token set and notify subscribers. */
export function set(tokens: TokenSet, now = Date.now()): Session {
  current = {
`,
      replace: `
/**
 * The only way to establish a session. Every sign-in path (password, SP-initiated and
 * IdP-initiated SSO) calls this, so no path can store tokens without scheduling the
 * silent refresh (ADR-012). Calling it again replaces the pending refresh.
 */
export function establishSession(tokens: TokenSet): Session {
  const session = store(tokens)
  scheduleRefresh(tokens.expiresIn)
  return session
}

function store(tokens: TokenSet, now = Date.now()): Session {
  current = {
`,
    },
    {
      find: `
/** Password and SP-initiated SSO sign-in finish here: store the tokens and start the silent refresh. */
export function login(tokens: TokenSet): Session {
  const session = set(tokens)
  scheduleRefresh(tokens.expiresIn)
  return session
}

/** Silent refresh. Rotates the atlas_rt cookie; ends the session when the server refuses. */
`,
      replace: `
/** Silent refresh. Rotates the atlas_rt cookie; ends the session when the server refuses. */
`,
    },
    {
      find: `  }
  const tokens = (await res.json()) as TokenSet
  set(tokens)
  scheduleRefresh(tokens.expiresIn)
  return true
`,
      replace: `  }
  establishSession((await res.json()) as TokenSet)
  return true
`,
    },
  ],
  'src/pages/LoginCallback.tsx': [
    {
      find: `import { useNavigate, useSearchParams } from 'react-router'
import * as session from '../auth/session'
import { completeSsoLogin, redeemIdpTicket, safeReturnTo } from '../auth/sso'
`,
      replace: `import { useNavigate, useSearchParams } from 'react-router'
import { establishSession } from '../auth/session'
import { completeSsoLogin, redeemIdpTicket, safeReturnTo } from '../auth/sso'
`,
    },
    {
      find: `  const error = useOnce(async () => {
    const tokens = await completeSsoLogin(params.get('code') ?? '')
    session.login(tokens)
    navigate(safeReturnTo(params.get('return_to')), { replace: true })
`,
      replace: `  const error = useOnce(async () => {
    establishSession(await completeSsoLogin(params.get('code') ?? ''))
    navigate(safeReturnTo(params.get('return_to')), { replace: true })
`,
    },
    {
      find: `  const error = useOnce(async () => {
    const tokens = await redeemIdpTicket(params.get('ticket') ?? '')
    session.set(tokens)
    navigate(safeReturnTo(params.get('relay_state')), { replace: true })
`,
      replace: `  const error = useOnce(async () => {
    establishSession(await redeemIdpTicket(params.get('ticket') ?? ''))
    navigate(safeReturnTo(params.get('relay_state')), { replace: true })
`,
    },
  ],
  'src/pages/Login.tsx': [
    {
      find: `import { Button, Input } from '@northwind/ui'
import { login } from '../auth/session'
import { safeReturnTo, signInWithPassword, startSsoLogin } from '../auth/sso'
`,
      replace: `import { Button, Input } from '@northwind/ui'
import { establishSession } from '../auth/session'
import { safeReturnTo, signInWithPassword, startSsoLogin } from '../auth/sso'
`,
    },
    {
      find: `    try {
      login(await signInWithPassword(email, password))
      navigate(returnTo, { replace: true })
`,
      replace: `    try {
      establishSession(await signInWithPassword(email, password))
      navigate(returnTo, { replace: true })
`,
    },
  ],
  'src/auth/session.test.ts': [
    {
      find: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clear, getSession, login, REFRESH_AT, subscribe, type TokenSet } from './session'

`,
      replace: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clear, establishSession, getSession, REFRESH_AT, subscribe, type TokenSet } from './session'

`,
    },
    {
      find: `  it('stores the session in memory with the access-token expiry', () => {
    const session = login(tokens())
    expect(session).toMatchObject({ userId: 'usr_42', orgId: 'org_halden', accessToken: 'access-1' })
`,
      replace: `  it('stores the session in memory with the access-token expiry', () => {
    const session = establishSession(tokens())
    expect(session).toMatchObject({ userId: 'usr_42', orgId: 'org_halden', accessToken: 'access-1' })
`,
    },
    {
      find: `    vi.stubGlobal('fetch', fetchMock)
    login(tokens())

`,
      replace: `    vi.stubGlobal('fetch', fetchMock)
    establishSession(tokens())

`,
    },
    {
      find: `
    login(tokens())
    await vi.advanceTimersByTimeAsync(12 * MINUTE)
`,
      replace: `
    establishSession(tokens())
    await vi.advanceTimersByTimeAsync(12 * MINUTE)
`,
    },
    {
      find: `  })
})
`,
      replace: `  })

  it('keeps exactly one pending refresh when a session is established twice', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(tokens()))
    vi.stubGlobal('fetch', fetchMock)

    establishSession(tokens())
    establishSession(tokens({ accessToken: 'access-1b' }))
    await vi.advanceTimersByTimeAsync(12 * MINUTE)

    expect(refreshCalls(fetchMock)).toBe(1)
  })
})
`,
    },
  ],
}

/** ses_sso: new component tests for the three sign-in paths (IdP-initiated regression test). */
export const SSO_TEST_FILE = `import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clear, getSession, type TokenSet } from '../auth/session'
import { Login } from './Login'
import { LoginCallback, SamlCallback } from './LoginCallback'

vi.mock('@northwind/ui', () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Input: ({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) => (
    <label>
      {label}
      <input {...props} />
    </label>
  ),
}))

const MINUTE = 60_000
const TOKENS: TokenSet = {
  accessToken: 'access-1',
  expiresIn: 900,
  user: { id: 'usr_7', email: 'dispatch@haldenlogistics.example', orgId: 'org_halden' },
}

/** Fake portal-api: every sign-in endpoint returns TOKENS; /auth/refresh rotates them. */
function mockAuthServer() {
  const paths: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      paths.push(path)
      const body = path === '/auth/refresh' ? { ...TOKENS, accessToken: 'access-2' } : TOKENS
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
    }),
  )
  return { refreshes: () => paths.filter((p) => p === '/auth/refresh').length }
}

function renderRoute(url: string, route: string, element: ReactElement) {
  const router = createMemoryRouter([{ path: route, element }, { path: '*', element: <p>Signed in</p> }], { initialEntries: [url] })
  render(<RouterProvider router={router} />)
}

const SIGN_IN_PATHS: [string, () => void][] = [
  [
    'password',
    () => {
      renderRoute('/login?return_to=/billing', '/login', <Login />)
      fireEvent.change(screen.getByLabelText('Work email'), { target: { value: 'dispatch@haldenlogistics.example' } })
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery staple' } })
      fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    },
  ],
  ['SP-initiated SSO', () => renderRoute('/auth/callback?code=c-1&return_to=/billing', '/auth/callback', <LoginCallback />)],
  ['IdP-initiated SSO', () => renderRoute('/auth/saml/callback?ticket=t-1&relay_state=/billing', '/auth/saml/callback', <SamlCallback />)],
]

describe('sign-in paths (ADR-012)', () => {
  beforeEach(() => vi.useFakeTimers())

  afterEach(() => {
    cleanup()
    clear()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('IdP-initiated callback triggers exactly one /auth/refresh after ~12 minutes', async () => {
    const server = mockAuthServer()
    renderRoute('/auth/saml/callback?ticket=t-1&relay_state=/billing', '/auth/saml/callback', <SamlCallback />)
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(screen.getByText('Signed in')).toBeTruthy()

    await act(() => vi.advanceTimersByTimeAsync(12 * MINUTE))
    expect(server.refreshes()).toBe(1)
    expect(getSession()?.accessToken).toBe('access-2')
  })

  it.each(SIGN_IN_PATHS)('%s sign-in establishes the same session and schedules the refresh', async (_name, signIn) => {
    const server = mockAuthServer()
    signIn()
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getSession()).toMatchObject({ userId: 'usr_7', orgId: 'org_halden', accessToken: 'access-1' })

    await act(() => vi.advanceTimersByTimeAsync(12 * MINUTE))
    expect(server.refreshes()).toBe(1)
  })
})
`

/** ses_stripe (planned by the in-flight run): serve invoices from Stripe Billing behind the flag. */
export const STRIPE_MIGRATION_EDITS: Record<string, FileEdit[]> = {
  'package.json': [
    {
      find: `    "react-router": "^7.8.2",
    "recharts": "^3.1.2"
  },
`,
      replace: `    "react-router": "^7.8.2",
    "recharts": "^3.1.2",
    "stripe": "^18.5.0"
  },
`,
    },
  ],
  'src/billing/stripe.ts': [
    {
      find: `import type { Invoice, Money, Page } from '../types'
`,
      replace: `import type Stripe from 'stripe'
import { api } from '../api/client'
import type { Invoice, Money, Page } from '../types'
`,
    },
    {
      find: `
// TODO(billing-migration): use the official Stripe types once the \`stripe\` package is added.
interface StripeInvoice {
`,
      replace: `
/** The Stripe.Invoice fields portal-api forwards to the browser. */
interface StripeInvoice {
`,
    },
    {
      find: `  number: string | null
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void' | null
  currency: string
`,
      replace: `  number: string | null
  status: Stripe.Invoice.Status | null
  currency: string
`,
    },
    {
      find: `const SUPPORTED_CURRENCIES: readonly Money['currency'][] = ['USD', 'EUR', 'GBP']

`,
      replace: `const SUPPORTED_CURRENCIES: readonly Money['currency'][] = ['USD', 'EUR', 'GBP']
const PAGE_SIZE = 25

`,
    },
    {
      find: `
export async function listStripeInvoices(_accountId: string, _cursor?: string): Promise<Page<Invoice>> {
  // TODO(billing-migration): call GET /v2/billing/invoices (shipped in portal-api 1.42).
  throw new Error('Stripe invoices are not wired up yet')
}
`,
      replace: `
/** Stripe paginates with \`starting_after\` (the last id of the previous page). */
export async function listStripeInvoices(accountId: string, cursor?: string): Promise<Page<Invoice>> {
  const list = await api.get<Stripe.ApiList<StripeInvoice>>('/v2/billing/invoices', {
    account: accountId,
    limit: PAGE_SIZE,
    starting_after: cursor,
  })
  const items = list.data.map(fromStripeInvoice)
  return { items, nextCursor: list.has_more ? (items.at(-1)?.id ?? null) : null }
}

export async function getStripeInvoice(accountId: string, invoiceId: string): Promise<Invoice> {
  const invoice = await api.get<StripeInvoice>(\`/v2/billing/invoices/\${invoiceId}\`, { account: accountId })
  return fromStripeInvoice(invoice)
}

/** Asks Stripe (via portal-api) to email the hosted invoice to the billing contact. */
export function sendStripeInvoice(accountId: string, invoiceId: string): Promise<void> {
  return api.post<void>(\`/v2/billing/invoices/\${invoiceId}/send\`, { account: accountId })
}
`,
    },
  ],
  'src/api/invoices.ts': [
    {
      find: `import type { Invoice, InvoiceStatus, Money, Page } from '../types'
`,
      replace: `import { getStripeInvoice, listStripeInvoices, sendStripeInvoice } from '../billing/stripe'
import { config } from '../config'
import type { Invoice, InvoiceStatus, Money, Page } from '../types'
`,
    },
    {
      find: `/**
 * Invoices from the in-house invoicer (/billing/v1), which Stripe Billing is replacing.
 * See docs/ARCHITECTURE.md → Billing. Amounts arrive as decimal strings and states
 * are upper-case; everything is normalized to the portal's Invoice type here.
 */
`,
      replace: `/**
 * Invoices for an account. While the Stripe Billing migration runs, VITE_FLAG_STRIPE_BILLING
 * picks the source; the in-house invoicer (/billing/v1) stays the default until cutover.
 * See docs/ARCHITECTURE.md → Billing. Invoicer amounts arrive as decimal strings and states
 * are upper-case; both sources are normalized to the portal's Invoice type.
 */
`,
    },
    {
      find: `export async function listInvoices(accountId: string, cursor?: string): Promise<Page<Invoice>> {
  const page = await api.get<LegacyInvoicePage>(\`/billing/v1/accounts/\${accountId}/invoices\`, {
`,
      replace: `export async function listInvoices(accountId: string, cursor?: string): Promise<Page<Invoice>> {
  if (config.flags.stripeBilling) return listStripeInvoices(accountId, cursor)
  const page = await api.get<LegacyInvoicePage>(\`/billing/v1/accounts/\${accountId}/invoices\`, {
`,
    },
    {
      find: `export async function getInvoice(accountId: string, invoiceId: string): Promise<Invoice> {
  const invoice = await api.get<LegacyInvoice>(\`/billing/v1/accounts/\${accountId}/invoices/\${invoiceId}\`)
`,
      replace: `export async function getInvoice(accountId: string, invoiceId: string): Promise<Invoice> {
  if (config.flags.stripeBilling) return getStripeInvoice(accountId, invoiceId)
  const invoice = await api.get<LegacyInvoice>(\`/billing/v1/accounts/\${accountId}/invoices/\${invoiceId}\`)
`,
    },
    {
      find: `export function resendInvoice(accountId: string, invoiceId: string): Promise<void> {
  return api.post<void>(\`/billing/v1/accounts/\${accountId}/invoices/\${invoiceId}/resend\`, {})
`,
      replace: `export function resendInvoice(accountId: string, invoiceId: string): Promise<void> {
  if (config.flags.stripeBilling) return sendStripeInvoice(accountId, invoiceId)
  return api.post<void>(\`/billing/v1/accounts/\${accountId}/invoices/\${invoiceId}/resend\`, {})
`,
    },
  ],
}

/** ses_stripe: new test file for the Stripe invoice mapping. */
export const STRIPE_TEST_FILE = `import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { fromStripeInvoice, listStripeInvoices } from './stripe'

vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const invoice = {
  id: 'in_1QkY2mNw',
  number: 'NW-2025-0142',
  status: 'open' as const,
  currency: 'eur',
  total: 189_000,
  amount_due: 189_000,
  created: 1_748_854_800, // 2025-06-02T09:00:00Z
  due_date: 1_751_446_800,
  invoice_pdf: 'https://files.stripe.example/invoices/in_1QkY2mNw.pdf',
}

describe('fromStripeInvoice', () => {
  it('maps amounts, currency and dates', () => {
    const mapped = fromStripeInvoice(invoice)
    expect(mapped.total).toEqual({ amount: 189_000, currency: 'EUR' })
    expect(mapped.issuedAt).toBe('2025-06-02T09:00:00.000Z')
    expect(mapped.dueAt).toBe('2025-07-02T09:00:00.000Z')
    expect(mapped.source).toBe('stripe')
  })

  it('falls back to the id for drafts without a number', () => {
    const draft = fromStripeInvoice({ ...invoice, number: null, status: 'draft' })
    expect(draft.number).toBe('in_1QkY2mNw')
    expect(draft.status).toBe('draft')
  })

  it('rejects currencies the portal does not bill in', () => {
    expect(() => fromStripeInvoice({ ...invoice, currency: 'jpy' })).toThrow('Unsupported invoice currency: jpy')
  })
})

describe('listStripeInvoices', () => {
  afterEach(() => vi.mocked(api.get).mockReset())

  it('uses the last invoice id as the cursor when Stripe has more', async () => {
    vi.mocked(api.get).mockResolvedValue({ object: 'list', data: [invoice], has_more: true, url: '/v1/invoices' })
    const page = await listStripeInvoices('acc_e2e')
    expect(api.get).toHaveBeenCalledWith('/v2/billing/invoices', { account: 'acc_e2e', limit: 25, starting_after: undefined })
    expect(page.nextCursor).toBe('in_1QkY2mNw')
  })

  it('returns no cursor on the last page', async () => {
    vi.mocked(api.get).mockResolvedValue({ object: 'list', data: [invoice], has_more: false, url: '/v1/invoices' })
    expect((await listStripeInvoices('acc_e2e', 'in_0Prev')).nextCursor).toBeNull()
  })
})
`

/** ses_bundle was merged into main (PR #214); these edits recreate the files as they were before it. */
export const BUNDLE_PRE_MERGE_EDITS: Record<string, FileEdit[]> = {
  'src/routes.tsx': [
    {
      find: `import { lazy } from 'react'
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

`,
      replace: `import type { RouteObject } from 'react-router'
import { App } from './App'
import { Dashboard } from './components/Dashboard'
import { InvoiceList } from './components/InvoiceList'
import { Checkout } from './pages/Checkout'
import { LoginCallback, SamlCallback } from './pages/LoginCallback'
import { Login } from './pages/Login'
import { Shipments } from './pages/Shipments'

`,
    },
  ],
  'src/App.tsx': [
    {
      find: `import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { Spinner } from '@northwind/ui'
import { Header } from './components/Header'
`,
      replace: `import { Navigate, Outlet, useLocation } from 'react-router'
import { Header } from './components/Header'
`,
    },
    {
      find: `      <main className="app-main">
        <Suspense fallback={<FullPageSpinner label="Loading…" />}>
          <Outlet />
        </Suspense>
      </main>
`,
      replace: `      <main className="app-main">
        <Outlet />
      </main>
`,
    },
    {
      find: `}

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="app-loading" aria-live="polite">
      <Spinner size="lg" />
      <span>{label}</span>
    </div>
  )
}
`,
      replace: `}
`,
    },
  ],
  'src/components/Dashboard.tsx': [
    {
      find: `import { lazy, Suspense } from 'react'
import { Card, Skeleton, Stat } from '@northwind/ui'
import { useShipments } from '../hooks/useShipments'
`,
      replace: `import { Card, Stat } from '@northwind/ui'
import { useShipments } from '../hooks/useShipments'
`,
    },
    {
      find: `import { ShipmentTable } from './ShipmentTable'

// recharts + d3 weigh ~430 kB; load the chart after first paint, not in the entry chunk.
const VolumeChart = lazy(() => import('./VolumeChart').then((m) => ({ default: m.VolumeChart })))

`,
      replace: `import { ShipmentTable } from './ShipmentTable'
import { VolumeChart } from './VolumeChart'

`,
    },
    {
      find: `      <Card title="Weekly volume">
        <Suspense fallback={<Skeleton height={240} />}>
          <VolumeChart weeks={12} />
        </Suspense>
      </Card>
`,
      replace: `      <Card title="Weekly volume">
        <VolumeChart weeks={12} />
      </Card>
`,
    },
  ],
  'package.json': [
    {
      find: `    "test:watch": "vitest",
    "e2e": "playwright test",
    "size": "size-limit"
  },
`,
      replace: `    "test:watch": "vitest",
    "e2e": "playwright test"
  },
`,
    },
    {
      find: `    "@playwright/test": "^1.55.0",
    "@size-limit/file": "^11.2.0",
    "@testing-library/react": "^16.3.0",
`,
      replace: `    "@playwright/test": "^1.55.0",
    "@testing-library/react": "^16.3.0",
`,
    },
    {
      find: `    "jsdom": "^26.1.0",
    "size-limit": "^11.2.0",
    "typescript": "^5.9.2",
`,
      replace: `    "jsdom": "^26.1.0",
    "typescript": "^5.9.2",
`,
    },
    {
      find: `    "vitest": "^3.2.4"
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
      replace: `    "vitest": "^3.2.4"
  }
}
`,
    },
  ],
  '.github/workflows/ci.yml': [
    {
      find: `      - run: npm test -- --reporter=dot
      - run: npm run build
      - name: Bundle size budget
        run: npm run size

`,
      replace: `      - run: npm test -- --reporter=dot

`,
    },
  ],
}

/** ses_flaky: Forge's first attempt, waiting for network idle instead of a fixed 2 s sleep. */
export const FLAKY_TEST_EDITS: Record<string, FileEdit[]> = {
  'e2e/checkout.spec.ts': [
    {
      find: `
    // Give the outstanding-balance banner time to load, then pay.
    await page.waitForTimeout(2000)
    await page.getByRole('button', { name: 'Pay $1,890.00' }).click({ timeout: 1_000 })
`,
      replace: `
    // Wait for the invoice and balance requests to settle instead of sleeping.
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Pay $1,890.00' }).click({ timeout: 1_000 })
`,
    },
  ],
}
