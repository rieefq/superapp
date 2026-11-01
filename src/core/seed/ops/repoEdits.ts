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

/** ses_sso: schedule refreshes from the held token's expiry, plus regression tests. */
export const SSO_FIX_EDITS: Record<string, FileEdit[]> = {
  'src/auth/session.ts': [
    {
      find: `let current: Session | null = null
let tokenLifetimeMs = 0
let refreshTimer: ReturnType<typeof setTimeout> | null = null
`,
      replace: `let current: Session | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
`,
    },
    {
      find: `export function startSession(tokens: TokenSet, now = Date.now()): Session {
  tokenLifetimeMs = tokens.expiresIn * 1000
  current = toSession(tokens, now)
  scheduleRefresh()
  emit()
`,
      replace: `export function startSession(tokens: TokenSet, now = Date.now()): Session {
  current = toSession(tokens, now)
  scheduleRefresh(now)
  emit()
`,
    },
    {
      find: `    const tokens = await exchangeRefreshToken(current.refreshToken)
    current = toSession(tokens, Date.now())
    scheduleRefresh()
    emit()
`,
      replace: `    const tokens = await exchangeRefreshToken(current.refreshToken)
    const now = Date.now()
    current = toSession(tokens, now)
    scheduleRefresh(now)
    emit()
`,
    },
    {
      find: `
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  const delay = Math.max(0, tokenLifetimeMs - REFRESH_LEAD_MS)
  refreshTimer = setTimeout(() => void refreshNow(), delay)
`,
      replace: `
/**
 * Schedule the next refresh from the expiry of the token we hold now. The IdP applies the
 * customer's session policy on refresh, so refreshed tokens can live shorter than the one
 * issued at login (ADR-012).
 */
function scheduleRefresh(now: number): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (!current) return
  const delay = Math.max(0, current.expiresAt - now - REFRESH_LEAD_MS)
  refreshTimer = setTimeout(() => void refreshNow(), delay)
`,
    },
  ],
  'src/auth/session.test.ts': [
    {
      find: `  })
})
`,
      replace: `  })

  it('schedules the next refresh from the refreshed token, not the login token', async () => {
    // Login tokens live for an hour; this IdP issues 15-minute tokens on refresh.
    vi.mocked(exchangeRefreshToken)
      .mockResolvedValueOnce(tokens({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 }))
      .mockResolvedValueOnce(tokens({ accessToken: 'access-3', refreshToken: 'refresh-3', expiresIn: 900 }))
    startSession(tokens())

    await vi.advanceTimersByTimeAsync(HOUR_MS - REFRESH_LEAD_MS)
    expect(getSession()?.accessToken).toBe('access-2')

    await vi.advanceTimersByTimeAsync(900 * 1000 - REFRESH_LEAD_MS)
    expect(exchangeRefreshToken).toHaveBeenLastCalledWith('refresh-2')
    expect(getSession()?.accessToken).toBe('access-3')
  })

  it('never lets the session outlive its access token', async () => {
    vi.mocked(exchangeRefreshToken).mockImplementation(async (refreshToken) =>
      tokens({ accessToken: \`access-after-\${refreshToken}\`, refreshToken: \`\${refreshToken}+\`, expiresIn: 900 }),
    )
    startSession(tokens())

    // Six hours in 5-minute steps: the token we hold must always still be valid.
    for (let elapsed = 0; elapsed < 6 * HOUR_MS; elapsed += 5 * 60 * 1000) {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      expect(getSession()!.expiresAt).toBeGreaterThan(Date.now())
    }
  })
})
`,
    },
  ],
}

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
 * Legacy invoicing service (Northwind Billing v1), being replaced by Stripe Billing.
 * See docs/ARCHITECTURE.md → Billing. Amounts arrive as decimal strings and states
 * are upper-case; everything is normalized to the portal's Invoice type here.
 */
`,
      replace: `/**
 * Invoices for an account. While the Stripe Billing migration runs, VITE_FLAG_STRIPE_BILLING
 * decides the source; the legacy invoicing service (Northwind Billing v1) stays the default.
 * See docs/ARCHITECTURE.md → Billing.
 *
 * Legacy amounts arrive as decimal strings and states are upper-case; both sources are
 * normalized to the portal's Invoice type.
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
import { LoginCallback } from './pages/LoginCallback'

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
import { LoginCallback } from './pages/LoginCallback'
import { Shipments } from './pages/Shipments'

`,
    },
  ],
  'src/App.tsx': [
    {
      find: `import { Suspense, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
`,
      replace: `import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
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
  'vite.config.ts': [
    {
      find: `    sourcemap: true,
    // Per-chunk budget in kB. Vite only warns above it, so treat a warning as a
    // regression: the entry chunk should stay far below, and the lazy-loaded
    // dashboard chart (recharts + d3) is the only chunk allowed near the limit.
    chunkSizeWarningLimit: 450,
  },
`,
      replace: `    sourcemap: true,
    // Raised so the build stops warning about the vendor chunk.
    chunkSizeWarningLimit: 1000,
  },
`,
    },
  ],
}

/** ses_flaky: replace the fixed 3 s wait with a web-first assertion. */
export const FLAKY_TEST_EDITS: Record<string, FileEdit[]> = {
  'e2e/checkout.spec.ts': [
    {
      find: `
    // Payment confirmation is polled every second; give it time to arrive.
    await page.waitForTimeout(3000)
    expect(await page.getByRole('status').textContent()).toContain('Payment confirmed')
  })
`,
      replace: `
    // Web-first assertion: retries until the polled confirmation renders. No fixed sleep.
    await expect(page.getByRole('status')).toHaveText(/Payment confirmed/, { timeout: 10_000 })
  })
`,
    },
  ],
}
